// backend/server.js - FIXED VERSION WITH EXPLICIT VENUE PRESERVATION
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { OpenAI } = require('openai');
const axios = require('axios');
const NodeCache = require('node-cache');

dotenv.config();

const app = express();
const cache = new NodeCache({ stdTTL: 7200 }); // 2-hour cache

app.use(cors());
app.use(express.json());

// ======================= OpenAI =======================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// =================== API Keys ==================
const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const TICKETMASTER_API_KEY = process.env.TICKETMASTER_API_KEY;
const TICKETMASTER_BASE_URL = 'https://app.ticketmaster.com/discovery/v2';

// =============== Utilities & Helpers ==================

// Format ISO 8601 WITHOUT milliseconds: 'YYYY-MM-DDTHH:mm:ssZ'
function isoNoMs(date) {
  return new Date(date).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Calendar "next week" window: next Monday 00:00:00 UTC → following Sunday 23:59:59 UTC
function getNextWeekUTCWindow(now = new Date()) {
  const d = new Date(now);
  const day = d.getUTCDay(); // 0=Sun...6=Sat
  // days until next Monday
  const daysUntilNextMon = ((8 - day) % 7) || 7;
  const start = new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() + daysUntilNextMon, 0, 0, 0
  ));
  const end = new Date(Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate() + 6, 23, 59, 59
  ));
  return { start: isoNoMs(start), end: isoNoMs(end), label: 'next_week' };
}

// "this week" window: current Monday 00:00:00 UTC → Sunday 23:59:59 UTC
function getThisWeekUTCWindow(now = new Date()) {
  const d = new Date(now);
  const day = d.getUTCDay(); // 0=Sun...6=Sat
  const daysSinceMon = (day + 6) % 7; // Mon=0
  const start = new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() - daysSinceMon, 0, 0, 0
  ));
  const end = new Date(Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate() + 6, 23, 59, 59
  ));
  return { start: isoNoMs(start), end: isoNoMs(end), label: 'this_week' };
}

// Haversine distance (km)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function mapCategoryToGoogleType(category = '') {
  const c = String(category || '').toLowerCase().trim();
  const mapping = {
    restaurant: 'restaurant',
    lunch: 'restaurant',
    dinner: 'restaurant',
    food: 'restaurant',
    cafe: 'cafe',
    coffee: 'cafe',
    bar: 'bar',
    nightlife: 'bar',
    pub: 'bar',
    fast_food: 'restaurant',
    museum: 'museum',
    art_gallery: 'art_gallery',
    tourist_attraction: 'tourist_attraction',
    monument: 'tourist_attraction',
    park: 'park',
    plaza: 'point_of_interest',
    garden: 'park',
    shopping_mall: 'shopping_mall',
    store: 'store',
    market: 'store',
    hotel: 'lodging',
    lodging: 'lodging',
    entertainment: 'movie_theater',
    cinema: 'movie_theater',
    theatre: 'movie_theater',
    activity: 'tourist_attraction',
    gym: 'gym',
    spa: 'spa',
    library: 'library',
    bookstore: 'book_store',
    aquarium: 'aquarium',
    zoo: 'zoo',
    stadium: 'stadium',
    bowling_alley: 'bowling_alley',
    casino: 'casino',
    amusement_park: 'amusement_park',
    night_club: 'night_club',
    church: 'church',
    cathedral: 'church'
  };
  return mapping[c] || undefined;
}

// Generate better cache key
function generateCacheKey(query, location, category, limit, radius) {
  const latZone = Math.round(location.lat * 100) / 100;
  const lngZone = Math.round(location.lng * 100) / 100;
  return `google-${query}-${category}-${latZone}-${lngZone}-${limit}-${radius}`;
}

// Validate venue distance (MODIFIED to handle explicit venues)
function validateVenueDistance(venue, searchCenter, maxDistanceKm = 5, isExplicitRequest = false) {
  // If user explicitly requested this venue, don't filter by distance
  if (isExplicitRequest) {
    console.log(`   ✅ EXPLICIT REQUEST: ${venue.name} accepted regardless of distance`);
    return true;
  }
  
  const distance = calculateDistance(
    searchCenter.lat,
    searchCenter.lng,
    venue.lat,
    venue.lng
  );
  
  if (distance > maxDistanceKm) {
    console.log(`   ⚠️ REJECTED: ${venue.name} is ${distance.toFixed(1)}km away (max: ${maxDistanceKm}km)`);
    return false;
  }
  return true;
}

// Check if a query is for a specific venue (NEW FUNCTION)
function isSpecificVenueRequest(query) {
  // Common venue name patterns
  const specificVenuePatterns = [
    'madison square garden',
    'brooklyn bridge',
    'central park',
    'times square',
    'statue of liberty',
    'empire state building',
    'one world trade',
    'rockefeller center',
    'high line',
    'chelsea market',
    'grand central',
    'museum of modern art',
    'moma',
    'metropolitan museum',
    'met museum',
    'natural history museum',
    'guggenheim',
    'lincoln center',
    'carnegie hall',
    'radio city',
    'barclays center',
    'yankee stadium',
    'citi field',
    'msg'
  ];
  
  const queryLower = query.toLowerCase();
  
  // Check if query matches known venue names
  for (const pattern of specificVenuePatterns) {
    if (queryLower.includes(pattern)) {
      return true;
    }
  }
  
  // Check for quotes (user quoting a specific place name)
  if (query.includes('"') || query.includes("'")) {
    return true;
  }
  
  // Check for proper nouns (multiple capital letters might indicate a specific place)
  const capitalWords = query.match(/[A-Z][a-z]+/g);
  if (capitalWords && capitalWords.length >= 2) {
    return true;
  }
  
  return false;
}

// Optimize route for shortest distance
function optimizeRoute(venues) {
  if (venues.length <= 2) return venues;
  console.log('\n🔄 [OPTIMIZE] Finding shortest route...');
  const optimized = [venues[0]];
  const remaining = venues.slice(1);
  while (remaining.length > 0) {
    const last = optimized[optimized.length - 1];
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const dist = calculateDistance(last.lat, last.lng, remaining[i].lat, remaining[i].lng);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }
    optimized.push(remaining[nearestIdx]);
    remaining.splice(nearestIdx, 1);
  }
  console.log('   ✅ Route optimized for minimal travel distance');
  return optimized;
}

// Calculate walking route with distance validation
function calculateRoute(venues) {
  if (!venues || venues.length === 0) {
    throw new Error('No venues to calculate route');
  }
  console.log(`\n📏 [ROUTE] Calculating for ${venues.length} venues...`);
  let totalDistance = 0;
  let hasUnreasonableDistance = false;
  const route = venues.map((venue, index) => {
    if (index > 0) {
      const prev = venues[index - 1];
      const distance = calculateDistance(prev.lat, prev.lng, venue.lat, venue.lng);
      if (distance > 20) {
        console.log(`   ⚠️ WARNING: ${distance.toFixed(1)}km between ${prev.name} and ${venue.name}`);
        hasUnreasonableDistance = true;
      }
      totalDistance += distance;
      venue.walkTime = Math.round(distance * 15); // ~15 min/km
    } else {
      venue.walkTime = 0;
    }
    venue.order = index + 1;
    return venue;
  });
  if (hasUnreasonableDistance) {
    console.log('   ❌ ROUTE WARNING: Large distances detected - consider transportation!');
  }
  if (totalDistance > 20) {
    console.log('   ⚠️ WARNING: Total distance is significant for walking!');
  }
  console.log(`   Total distance: ${totalDistance.toFixed(1)}km`);
  console.log(`   Estimated walk time: ${Math.round(totalDistance * 15)} minutes`);
  return {
    venues: route,
    totalWalkTime: Math.round(totalDistance * 15),
    totalDistance: totalDistance.toFixed(1),
    distanceWarning: totalDistance > 20
  };
}

// ================== Get Venue Description ===================
async function getVenueDescription(placeId) {
  try {
    const url = 'https://maps.googleapis.com/maps/api/place/details/json';
    const params = {
      place_id: placeId,
      fields: 'editorial_summary',
      key: GOOGLE_API_KEY
    };
    const response = await axios.get(url, { params });
    if (response.data.result?.editorial_summary?.overview) {
      return response.data.result.editorial_summary.overview;
    }
    return null;
  } catch (error) {
    console.log(`   ⚠️ Error fetching description: ${error.message}`);
    return null;
  }
}

// =================== Enhanced Ticketmaster Helpers ===================
// Simple geoHash encoder for Ticketmaster's geoPoint param
const GEOHASH_BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
function geohashEncode(lat, lon, precision = 9) {
  let idx = 0, bit = 0, evenBit = true, geohash = '';
  let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
  while (geohash.length < precision) {
    if (evenBit) {
      const lonMid = (lonMin + lonMax) / 2;
      if (lon >= lonMid) { idx = idx * 2 + 1; lonMin = lonMid; }
      else { idx = idx * 2; lonMax = lonMid; }
    } else {
      const latMid = (latMin + latMax) / 2;
      if (lat >= latMid) { idx = idx * 2 + 1; latMin = latMid; }
      else { idx = idx * 2; latMax = latMid; }
    }
    evenBit = !evenBit;
    bit++;
    if (bit === 5) {
      geohash += GEOHASH_BASE32.charAt(idx);
      bit = 0;
      idx = 0;
    }
  }
  return geohash;
}

// Enhanced function to extract event keywords from prompt
function extractEventKeywords(prompt) {
  const promptLower = String(prompt || '').toLowerCase();
  const keywords = [];

  const musicGenres = ['rock', 'pop', 'jazz', 'classical', 'hip hop', 'rap', 'country', 'electronic', 'edm', 'metal', 'indie', 'folk', 'blues', 'r&b', 'soul', 'punk', 'alternative'];
  musicGenres.forEach(genre => {
    if (promptLower.includes(genre)) keywords.push(genre);
  });

  const eventTypes = ['concert', 'show', 'festival', 'performance', 'musical', 'opera', 'ballet', 'symphony', 'comedy', 'stand-up', 'theater', 'theatre', 'play', 'broadway'];
  eventTypes.forEach(type => {
    if (promptLower.includes(type)) keywords.push(type);
  });

  const sports = ['basketball', 'football', 'baseball', 'hockey', 'soccer', 'tennis', 'golf', 'boxing', 'mma', 'ufc'];
  sports.forEach(sport => {
    if (promptLower.includes(sport)) keywords.push(sport);
  });

  if (keywords.length === 0) {
    if (promptLower.includes('music') || promptLower.includes('live')) keywords.push('music');
    if (promptLower.includes('event')) keywords.push('event');
  }

  return keywords;
}

// Enhanced date range extraction from prompt (UTC, no ms)
function extractDateRange(prompt, explicitTimeRange = null) {
  const txt = String(prompt || '').toLowerCase();
  const now = new Date();

  // Shortcut explicit time ranges
  if (explicitTimeRange === '48hours') {
    const end = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    return {
      startDateTime: isoNoMs(now),
      endDateTime: isoNoMs(end),
      description: 'next_48_hours'
    };
  }
  if (explicitTimeRange === 'next_week') {
    const { start, end } = getNextWeekUTCWindow(now);
    return { startDateTime: start, endDateTime: end, description: 'next_week' };
  }

  // Natural language
  if (txt.includes('today') || txt.includes('tonight')) {
    const endOfDay = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59
    ));
    return {
      startDateTime: isoNoMs(now),
      endDateTime: isoNoMs(endOfDay),
      description: 'today'
    };
  }

  if (txt.includes('tomorrow')) {
    const t0 = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0
    ));
    const t1 = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 23, 59, 59
    ));
    return { startDateTime: isoNoMs(t0), endDateTime: isoNoMs(t1), description: 'tomorrow' };
  }

  // Weekend (upcoming Saturday/Sunday)
  if (txt.includes('weekend') || txt.includes('saturday') || txt.includes('sunday')) {
    const day = now.getUTCDay(); // 0=Sun ... 6=Sat
    const daysUntilSaturday = (6 - day + 7) % 7 || 7;
    const saturday = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilSaturday, 0, 0, 0
    ));
    const sunday = new Date(Date.UTC(
      saturday.getUTCFullYear(), saturday.getUTCMonth(), saturday.getUTCDate() + 1, 23, 59, 59
    ));
    return { startDateTime: isoNoMs(saturday), endDateTime: isoNoMs(sunday), description: 'weekend' };
  }

  if (txt.includes('next week')) {
    const { start, end } = getNextWeekUTCWindow(now);
    return { startDateTime: start, endDateTime: end, description: 'next_week' };
  }

  if (txt.includes('this week')) {
    const { start, end } = getThisWeekUTCWindow(now);
    return { startDateTime: start, endDateTime: end, description: 'this_week' };
  }

  if (txt.includes('next month') || txt.includes('this month')) {
    const start = isoNoMs(now);
    const end = isoNoMs(new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000));
    return { startDateTime: start, endDateTime: end, description: txt.includes('next') ? 'next_month' : 'this_month' };
  }

  // Default: next 7 days rolling
  const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { startDateTime: isoNoMs(now), endDateTime: isoNoMs(end), description: 'next_7_days' };
}

// Map categories to Ticketmaster segments and classifications
function mapToTicketmasterCategories(categories = [], keywords = []) {
  const segments = new Set();
  const classifications = new Set();

  (categories || []).forEach(cat => {
    const c = String(cat).toLowerCase();
    if (c.includes('music') || c.includes('concert')) segments.add('Music');
    if (c.includes('sport')) segments.add('Sports');
    if (c.includes('art') || c.includes('theatre') || c.includes('theater')) segments.add('Arts & Theatre');
    if (c.includes('family') || c.includes('kids')) segments.add('Family');
  });

  (keywords || []).forEach(k0 => {
    const k = String(k0).toLowerCase();
    if (['rock', 'pop', 'jazz', 'classical', 'hip hop', 'country', 'electronic', 'edm', 'metal', 'indie', 'folk', 'blues'].includes(k)) {
      segments.add('Music');
    }
    if (['basketball', 'football', 'baseball', 'hockey', 'soccer', 'tennis'].includes(k)) {
      segments.add('Sports');
    }
    if (k.includes('comedy') || k.includes('stand-up')) classifications.add('Comedy');
  });

  return {
    segmentNames: Array.from(segments),
    classificationNames: Array.from(classifications)
  };
}

// =================== Enhanced Ticketmaster API Integration ==================
async function searchEventsTicketmaster(location, radiusKm = 5, prompt = '', categories = null, options = {}) {
  console.log('\n' + '='.repeat(60));
  console.log('🎟️ [TICKETMASTER API REQUEST - DYNAMIC]');
  console.log('='.repeat(60));
  console.log(`Location: ${location.lat}, ${location.lng}`);
  console.log(`Radius: ${radiusKm}km`);
  console.log(`Prompt: ${prompt}`);
  if (options.timeRange) console.log(`Time Range: ${options.timeRange}`);

  if (!TICKETMASTER_API_KEY) {
    console.log('⚠️ Ticketmaster API key not configured');
    return [];
  }

  // Extract keywords and date range from prompt / options
  const keywords = extractEventKeywords(prompt);
  const dateRange = extractDateRange(prompt, options.timeRange);
  const keyword = keywords.length > 0 ? keywords.join(' ') : 'event';

  console.log(`Extracted Keywords: ${keywords.join(', ') || 'none'}`);
  console.log(`Date Range: ${dateRange.description} (${dateRange.startDateTime} → ${dateRange.endDateTime})`);

  const geoPoint = geohashEncode(location.lat, location.lng, 9);
  const radiusClamped = Math.max(1, Math.min(150, Math.round(radiusKm)));

  // Ticketmaster category mapping
  const { segmentNames, classificationNames } = mapToTicketmasterCategories(categories, keywords);

  // Build params
  const params = {
    apikey: TICKETMASTER_API_KEY,
    keyword: keyword,
    sort: 'date,asc',
    size: options.timeRange === '48hours' ? 30 : 20,
    geoPoint,
    radius: radiusClamped,
    unit: 'km',
    includeTBA: 'no',
    includeTBD: 'no',
    startDateTime: dateRange.startDateTime,
    endDateTime: dateRange.endDateTime
  };

  // City hint for NYC-ish prompts or generic "event"
  const pl = String(prompt || '').toLowerCase();
  if (pl.includes('nyc') || pl.includes('new york') || keyword === 'event') {
    params.city = 'New York';
    params.stateCode = 'NY';
    params.countryCode = 'US';
  }

  // Add segments/classifications unless doing a very general nearby scan
  if (options.timeRange !== '48hours') {
    if (segmentNames.length > 0) params.segmentName = segmentNames.join(',');
    if (classificationNames.length > 0) params.classificationName = classificationNames.join(',');
  }

  try {
    console.log('📤 Fetching events from Ticketmaster...');
    const url = `${TICKETMASTER_BASE_URL}/events.json`;
    const response = await axios.get(url, { params });

    const events = response.data?._embedded?.events || [];
    if (!Array.isArray(events) || events.length === 0) {
      console.log('No events found on Ticketmaster');
      return [];
    }

    console.log(`📥 Found ${events.length} events`);

    const processedEvents = events.slice(0, 30).map((event) => {
      const venue = event._embedded?.venues?.[0] || {};
      const vLoc = venue.location || {};
      const lat = vLoc.latitude ? parseFloat(vLoc.latitude) : location.lat;
      const lng = vLoc.longitude ? parseFloat(vLoc.longitude) : location.lng;
      const distanceKm = vLoc.latitude && vLoc.longitude ? calculateDistance(location.lat, location.lng, lat, lng) : radiusClamped;

      // Price info
      let priceInfo = 'Check website';
      const pr = event.priceRanges?.[0];
      if (pr && typeof pr.min === 'number') {
        const currency = pr.currency || '$';
        priceInfo = (typeof pr.max === 'number' && pr.max !== pr.min)
          ? `${currency}${pr.min}-${currency}${pr.max}`
          : `${currency}${pr.min}`;
      }

      const startISO = event.dates?.start?.dateTime || event.dates?.start?.localDate || null;
      const statusCode = event.dates?.status?.code;

      // Image
      let imageUrl = null;
      if (Array.isArray(event.images) && event.images.length > 0) {
        const wide = event.images.find(img => img.ratio === '16_9') || event.images[0];
        imageUrl = wide?.url || event.images[0].url;
      }

      // Event type
      const cls = event.classifications?.[0];
      const seg = cls?.segment?.name;
      const gen = cls?.genre?.name;
      const sub = cls?.subGenre?.name;
      const eventType = [seg, gen, sub].filter(Boolean).join(' / ') || 'Event';

      // Address
      const addressParts = [
        venue.address?.line1,
        venue.city?.name,
        venue.state?.name || venue.state?.stateCode,
        venue.postalCode
      ].filter(Boolean).join(', ');

      return {
        id: event.id,
        name: event.name || 'Unnamed Event',
        category: 'event',
        eventType,
        lat,
        lng,
        address: addressParts || 'Address TBA',
        description: event.info || event.pleaseNote || `${eventType} at ${venue.name || 'venue'}`,
        startDate: startISO,
        eventUrl: event.url,
        imageUrl,
        price: priceInfo,
        isEvent: true,
        distance: Math.round(distanceKm * 1000), // meters (rounded)
        venueName: venue.name || 'Venue TBA',
        ticketsAvailable: statusCode !== 'offsale' && statusCode !== 'canceled',
        soldOut: statusCode === 'offsale',
        status: statusCode,
        genre: gen
      };
    });

    // Filter and sort
    const validEvents = processedEvents.filter((e) => {
      // Distance (a bit tighter for 48h scans)
      const maxMeters = (options.timeRange === '48hours' ? 1.2 : 1.5) * radiusClamped * 1000;
      if (e.distance > maxMeters) return false;
      if (e.status === 'canceled') return false;
      if (e.startDate) {
        const eventStart = new Date(e.startDate);
        const now = new Date();
        if (eventStart < new Date(now.getTime() - 24 * 60 * 60 * 1000)) return false;
      }
      return true;
    });

    validEvents.sort((a, b) => {
      // by date then distance
      if (a.startDate && b.startDate) {
        const diff = new Date(a.startDate) - new Date(b.startDate);
        if (diff !== 0) return diff;
      }
      return a.distance - b.distance;
    });

    if (validEvents.length > 0) {
      console.log('\n✅ TICKETMASTER EVENTS (sample):');
      validEvents.slice(0, 5).forEach((e, i) => {
        console.log(`${i + 1}. ${e.name} [${e.eventType}]`);
        if (e.startDate) {
          const date = new Date(e.startDate);
          console.log(`   📅 ${date.toLocaleDateString()} at ${date.toLocaleTimeString()}`);
        }
        console.log(`   📍 ${e.venueName} (${(e.distance / 1000).toFixed(1)}km away)`);
        console.log(`   💵 ${e.price} | 🎫 ${e.soldOut ? 'SOLD OUT' : 'Available'}`);
      });
    }

    return validEvents;
  } catch (error) {
    if (error.response) {
      console.error('❌ Ticketmaster API Error:', {
        status: error.response.status,
        message: error.response.data?.fault?.faultstring || error.response.data
      });
    } else {
      console.error('❌ Ticketmaster Request Error:', error.message);
    }
    return [];
  }
}

// ================ Google Places Search with Descriptions (MODIFIED) =================
async function searchVenuesGoogle(query, location, category, limit = 5, radius = 1500, isExplicitRequest = false) {
  console.log(`\n${'='.repeat(60)}`);
  console.log('🗺️ [GOOGLE PLACES API REQUEST]');
  console.log('='.repeat(60));
  console.log(`Query: "${query}"`);
  console.log(`Location: ${location.lat}, ${location.lng}`);
  console.log(`Category: ${category}`);
  console.log(`Radius: ${radius}m`);
  console.log(`Explicit Request: ${isExplicitRequest ? 'YES' : 'NO'}`);

  if (!GOOGLE_API_KEY) {
    throw new Error('Google Maps API key missing');
  }

  // Skip cache for explicit requests to ensure we get the exact venue
  const cacheKey = generateCacheKey(query, location, category, limit, radius);
  
  if (!isExplicitRequest) {
    const cached = cache.get(cacheKey);
    if (cached && cached.length > 0) {
      const validCached = cached.filter(venue =>
        validateVenueDistance(venue, location, radius / 1000 * 2, false)
      );
      if (validCached.length > 0) {
        console.log(`✅ VALID CACHE HIT: ${validCached.length} venues with descriptions`);
        return validCached;
      } else {
        console.log('❌ CACHE INVALID: Venues too far from search location');
        cache.del(cacheKey);
      }
    }
  }

  const googleType = mapCategoryToGoogleType(category);

  try {
    // For explicit requests, expand search radius significantly
    const searchRadius = isExplicitRequest ? Math.max(radius * 10, 50000) : radius;
    
    const textParams = {
      query: query || googleType || 'point of interest',
      location: `${location.lat},${location.lng}`,
      radius: searchRadius,
      type: googleType,
      region: 'us',
      language: 'en',
      key: GOOGLE_API_KEY
    };

    console.log('\n📤 GOOGLE PLACES TEXT SEARCH REQUEST:');
    if (isExplicitRequest) {
      console.log('   🎯 EXPLICIT VENUE SEARCH - Extended radius for exact match');
    }

    const textSearchURL = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
    const textRes = await axios.get(textSearchURL, { params: textParams });

    console.log(`\n📥 Response: ${textRes.data.status}, Found: ${textRes.data.results?.length || 0} venues`);

    let candidates = Array.isArray(textRes.data.results) ? textRes.data.results : [];

    if (candidates.length === 0 && !isExplicitRequest) {
      console.log('\n⚠️ Trying Nearby Search...');
      const nearbyParams = {
        location: `${location.lat},${location.lng}`,
        radius: radius,
        type: googleType,
        keyword: query,
        key: GOOGLE_API_KEY
      };
      const nearbyURL = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json';
      const nearRes = await axios.get(nearbyURL, { params: nearbyParams });
      candidates = Array.isArray(nearRes.data.results) ? nearRes.data.results : [];
    }

    if (candidates.length === 0) throw new Error('No venues found');

    const venues = candidates
      .slice(0, isExplicitRequest ? 1 : limit * 2) // For explicit requests, take the top match
      .map((place) => {
        const lat = place.geometry?.location?.lat;
        const lng = place.geometry?.location?.lng;
        const distance = calculateDistance(location.lat, location.lng, lat, lng);
        return {
          id: place.place_id,
          place_id: place.place_id,
          name: place.name,
          category: (place.types && place.types[0]) || googleType || category,
          lat,
          lng,
          address: place.formatted_address || place.vicinity || 'Address not available',
          rating: place.rating,
          user_ratings_total: place.user_ratings_total,
          price_level: place.price_level,
          business_status: place.business_status,
          distance: Math.round(distance * 1000),
          distanceKm: distance,
          isExplicitRequest: isExplicitRequest
        };
      })
      .filter(venue => {
        // For explicit requests, accept any distance
        if (isExplicitRequest) {
          console.log(`   ✅ EXPLICIT: ${venue.name} accepted (${venue.distanceKm.toFixed(1)}km away)`);
          return true;
        }
        
        // For general searches, apply distance filter
        const maxDistance = Math.min((radius * 2) / 1000, 5);
        if (venue.distanceKm > maxDistance) {
          console.log(`   ❌ Too far: ${venue.name} (${venue.distanceKm.toFixed(1)}km)`);
          return false;
        }
        return true;
      })
      .slice(0, isExplicitRequest ? 1 : limit);

    if (venues.length === 0) {
      if (isExplicitRequest) {
        throw new Error(`Could not find "${query}". Please check the venue name.`);
      } else {
        throw new Error('No venues found within reasonable distance');
      }
    }

    console.log('\n📝 Fetching venue descriptions...');
    for (let venue of venues) {
      try {
        const description = await getVenueDescription(venue.place_id);
        if (description) {
          venue.description = description;
          console.log(`   ✅ ${venue.name}: "${description.substring(0, 50)}..."`);
        } else {
          venue.description = `Popular ${venue.category} in the area, rated ${venue.rating || 'N/A'}/5`;
        }
      } catch (error) {
        venue.description = `${venue.rating ? 'Highly-rated' : 'Local'} ${venue.category}`;
      }
    }

    if (!isExplicitRequest) {
      cache.set(cacheKey, venues, 7200);
    }

    console.log('\n✅ VENUES WITH DESCRIPTIONS:');
    venues.forEach((v, i) => {
      console.log(`${i + 1}. ${v.name}`);
      console.log(`   📝 ${v.description}`);
      console.log(`   ⭐ ${v.rating || 'N/A'} (${v.user_ratings_total || 0} reviews)`);
      console.log(`   📍 ${Math.round(v.distance)}m away`);
      if (v.isExplicitRequest) {
        console.log(`   🎯 EXPLICIT REQUEST - Distance filter bypassed`);
      }
    });

    return venues;
  } catch (error) {
    const msg = error?.response?.data?.error_message || error.message;
    console.error('❌ Google Places Error:', msg);
    throw new Error(msg);
  }
}

// ================== Enhanced OpenAI Planning (MODIFIED) ===================
async function generateItineraryLogic(prompt, timeOfDay, userLocation = null) {
  console.log('\n' + '='.repeat(60));
  console.log('🤖 [OPENAI GPT-4 REQUEST]');
  console.log('='.repeat(60));
  console.log('📝 User Prompt:', prompt);
  console.log('🕐 Time of Day:', timeOfDay);

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key missing');
  }

  try {
    const systemPrompt = `You are PlanMate, an intelligent travel planning AI that creates personalized itineraries.

CRITICAL: Properly identify what should be searched where:
- Regular venues (restaurants, cafes, bars, museums, parks) → searchType: "venue" (uses Google Places)
- Events (concerts, shows, performances, festivals, sports) → searchType: "event" (uses Ticketmaster)

ENHANCED EVENT DETECTION:
Only set searchType: "event" for actual events that would be on Ticketmaster:
- Event keywords: "concert", "show", "festival", "performance", "live music", "comedy show", "sports game"
- Time-based events: "happening tonight", "events today", "shows this weekend"

For regular venues like restaurants and bars, ALWAYS use searchType: "venue" even if includeEvents is true elsewhere.

CRITICAL: EXPLICIT VENUE DETECTION
When users mention specific venue names (like "Madison Square Garden", "Brooklyn Bridge", "Central Park"), mark these as isExplicitRequest: true
This ensures we find those EXACT venues regardless of distance from the search center.

Examples of explicit venues:
- Named landmarks: "Empire State Building", "Statue of Liberty", "High Line"
- Specific restaurants/bars by name: "Joe's Pizza", "The Dead Rabbit"
- Named museums: "MoMA", "Met Museum", "Natural History Museum"
- Specific venues: "Madison Square Garden", "Barclays Center", "Radio City Music Hall"

CRITICAL ORDER PRESERVATION RULES:
1. When users specify a sequence (using words like "then", "after", "before", "finally", "first", "next", "lastly"), you MUST preserve that exact order
2. NEVER let geographic optimization override user-specified sequences

COORDINATE GUIDELINES:
- Times Square: 40.7580, -73.9855
- Chelsea: 40.7465, -74.0014
- Hell's Kitchen: 40.7638, -73.9918
- Wall Street: 40.7074, -74.0113
- Central Park South: 40.7644, -73.9732
- Madison Square Garden: 40.7505, -73.9934
- Lincoln Center: 40.7725, -73.9835
- Brooklyn Bridge: 40.7061, -73.9969
- West Village: 40.7336, -74.0027

Return this JSON structure:
{
  "title": "Relevant title",
  "description": "Brief description",
  "duration": "Time estimate",
  "vibe": "detected mood",
  "numberOfStops": [Count actual distinct stops],
  "includeEvents": true/false,
  "eventKeywords": ["rock", "concert"],
  "eventCategories": ["music"],
  "timeFrame": "today|tonight|tomorrow|weekend|week",
  "locationStrategy": { "type": "user_sequence", "pattern": "user_defined", "reasoning": "User specified order", "preserveOrder": true },
  "searchPoints": [
    { 
      "stopNumber": 1, 
      "searchType": "venue", 
      "query": "Madison Square Garden", 
      "category": "stadium", 
      "lat": 40.7505, 
      "lng": -73.9934, 
      "searchRadius": 1500, 
      "purpose": "Visit Madison Square Garden", 
      "userOrder": 1,
      "isExplicitRequest": true
    },
    { 
      "stopNumber": 2, 
      "searchType": "venue", 
      "query": "Brooklyn Bridge", 
      "category": "tourist_attraction", 
      "lat": 40.7061, 
      "lng": -73.9969, 
      "searchRadius": 1500, 
      "purpose": "Walk the Brooklyn Bridge", 
      "userOrder": 2,
      "isExplicitRequest": true
    },
    { 
      "stopNumber": 3, 
      "searchType": "venue", 
      "query": "bar", 
      "category": "bar", 
      "lat": 40.7336, 
      "lng": -74.0027, 
      "searchRadius": 1500, 
      "purpose": "Bar in West Village", 
      "userOrder": 3,
      "isExplicitRequest": false
    }
  ],
  "routingPriority": "user_sequence"
}

IMPORTANT: Set isExplicitRequest to true when the user mentions a specific venue by name. Set it to false for generic category searches.

Current time: ${timeOfDay}
User request: "${prompt}"
User location: ${userLocation ? `${userLocation.lat}, ${userLocation.lng}` : 'Manhattan, NYC'}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 1000
    });

    const result = JSON.parse(completion.choices[0].message.content);

    console.log('\n✅ COMPLETE GPT-4 RESPONSE:');
    console.log('='.repeat(60));
    console.log(JSON.stringify(result, null, 2));
    console.log('='.repeat(60));

    console.log('\n📊 STRATEGY DECISION:');
    console.log(`Type: ${result.locationStrategy?.type}`);
    console.log(`Include Events: ${result.includeEvents ? 'YES' : 'NO'}`);
    console.log(`Search Points: ${result.searchPoints?.length || 0}`);

    result.searchPoints?.forEach((point, idx) => {
      console.log(`   ${idx + 1}. ${point.purpose}: ${point.searchType === 'event' ? '🎟️ EVENT' : '📍 VENUE'}`);
      if (point.isExplicitRequest) {
        console.log(`      🎯 EXPLICIT REQUEST - Will find exact venue`);
      }
    });

    return result;
  } catch (error) {
    console.error('❌ OpenAI Error:', error.message);
    throw error;
  }
}

// ===================== Main Progressive Itinerary Endpoint (MODIFIED) ===================
app.post('/api/generate-itinerary', async (req, res) => {
  console.log('\n' + '='.repeat(60));
  console.log('🎯 [NEW REQUEST] Generate Itinerary');
  console.log('='.repeat(60));

  try {
    const { prompt, location } = req.body;
    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Please provide a prompt' });
    }

    console.log(`📝 User Prompt: "${prompt}"`);

    if (!process.env.OPENAI_API_KEY || !GOOGLE_API_KEY) {
      return res.status(500).json({ success: false, error: 'API keys not configured' });
    }

    const hour = new Date().getHours();
    const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    const defaultLocation = location || { lat: 40.7580, lng: -73.9855 }; // Times Square default

    // Step 1: AI Planning
    const itineraryPlan = await generateItineraryLogic(prompt, timeOfDay, defaultLocation);

    // Step 2: Progressive Search
    console.log('\n' + '='.repeat(60));
    console.log('📍 EXECUTING SEARCH PLAN');
    console.log('='.repeat(60));

    const allVenues = [];

    for (let i = 0; i < itineraryPlan.searchPoints.length; i++) {
      const point = itineraryPlan.searchPoints[i];
      const searchLocation = { lat: point.lat, lng: point.lng };

      console.log(`\n🔍 Stop ${point.stopNumber}: ${point.purpose || point.query}`);
      console.log(`   Type: ${point.searchType || 'venue'}`);
      console.log(`   Query: "${point.query}"`);
      console.log(`   Category: ${point.category}`);
      console.log(`   Search Center: ${searchLocation.lat.toFixed(4)}, ${searchLocation.lng.toFixed(4)}`);
      if (point.isExplicitRequest) {
        console.log(`   🎯 EXPLICIT REQUEST - Finding exact venue`);
      }

      try {
        if (point.searchType === 'event') {
          console.log('   🎟️ Searching for events via Ticketmaster...');

          // If the user said "next week", force calendar next week window
          const explicitTimeRange = /next week/i.test(prompt) ? 'next_week' : null;

          const events = await searchEventsTicketmaster(
            searchLocation,
            (point.searchRadius || 2000) / 1000, // meters → km
            point.query || prompt,
            point.category ? [point.category] : null,
            { timeRange: explicitTimeRange }
          );

          if (events.length > 0) {
            const selectedEvent = events[0];
            selectedEvent.purpose = point.purpose;
            selectedEvent.userOrder = point.userOrder || i + 1;
            selectedEvent.stopNumber = point.stopNumber;
            allVenues.push(selectedEvent);

            console.log(`   ✅ Selected Event: ${selectedEvent.name}`);
            if (selectedEvent.startDate) {
              const date = new Date(selectedEvent.startDate);
              console.log(`      📅 ${date.toLocaleDateString()} at ${date.toLocaleTimeString()}`);
            }
            console.log(`      💵 ${selectedEvent.price}`);
            console.log(`      🎫 ${selectedEvent.soldOut ? 'SOLD OUT' : 'Available'}`);
          } else {
            console.log('   ⚠️ No events found');
          }
        } else {
          // Google Venues
          console.log('   📍 Searching for venues via Google Places...');
          
          // Check if this is an explicit venue request
          const isExplicit = point.isExplicitRequest || isSpecificVenueRequest(point.query);
          
          let searchRadius = point.searchRadius || 1500;
          let venues = [];
          let attempts = 0;
          const maxAttempts = isExplicit ? 1 : 3; // For explicit requests, don't retry with expanding radius

          while (venues.length === 0 && attempts < maxAttempts) {
            try {
              venues = await searchVenuesGoogle(
                point.query,
                searchLocation,
                point.category,
                isExplicit ? 1 : 3, // For explicit requests, only get the top match
                isExplicit ? 50000 : searchRadius * (attempts + 1), // Large radius for explicit requests
                isExplicit // Pass the explicit flag
              );
              if (venues.length === 0 && attempts < maxAttempts - 1 && !isExplicit) {
                console.log('   ⚠️ No venues found, expanding search radius...');
              }
            } catch (err) {
              console.log(`   ⚠️ Attempt ${attempts + 1} failed: ${err.message}`);
            }
            attempts++;
          }

          if (venues.length > 0) {
            const selectedVenue = isExplicit ? venues[0] : venues.reduce((best, venue) => {
              const bestScore = (best.rating || 0) * Math.log((best.user_ratings_total || 1) + 1);
              const venueScore = (venue.rating || 0) * Math.log((venue.user_ratings_total || 1) + 1);
              return venueScore > bestScore ? venue : best;
            });

            selectedVenue.purpose = point.purpose;
            selectedVenue.userOrder = point.userOrder || i + 1;
            selectedVenue.stopNumber = point.stopNumber;
            allVenues.push(selectedVenue);

            console.log(`   ✅ Selected Venue: ${selectedVenue.name}`);
            console.log(`      ⭐ Rating: ${selectedVenue.rating || 'N/A'}/5 (${selectedVenue.user_ratings_total || 0} reviews)`);
            if (selectedVenue.isExplicitRequest) {
              console.log(`      🎯 EXPLICIT REQUEST - Found exact venue ${selectedVenue.distanceKm.toFixed(1)}km away`);
            }

            // Optional: nearby events in next 48 hours around a chosen venue
            console.log('   🔍 Checking for nearby events (next 48h)...');
            try {
              const nearbyEvents = await searchEventsTicketmaster(
                { lat: selectedVenue.lat, lng: selectedVenue.lng },
                1.5, // km
                'events near me',
                null,
                { timeRange: '48hours' }
              );
              if (nearbyEvents.length > 0) {
                selectedVenue.nearbyEvents = nearbyEvents.slice(0, 5);
                console.log(`      📌 Found ${nearbyEvents.length} nearby events (next 48h)`);
              } else {
                console.log('      📌 No nearby events found in next 48h');
              }
            } catch (err) {
              console.log(`      ⚠️ Could not fetch nearby events: ${err.message}`);
            }
          }
        }
      } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
      }

      if (i < itineraryPlan.searchPoints.length - 1) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    if (allVenues.length === 0) {
      return res.status(404).json({ success: false, error: 'No venues found. Please try a different search.' });
    }

    console.log(`\n📊 RESULTS: ${allVenues.length} out of ${itineraryPlan.searchPoints.length} stops found`);

    // Step 3: Route ordering - Preserve user order / times
    console.log('\n' + '='.repeat(60));
    console.log('🗺️ FINALIZING ROUTE');
    console.log('='.repeat(60));

    let sortedVenues = [...allVenues];

    if (itineraryPlan.locationStrategy?.preserveOrder) {
      console.log('✅ PRESERVING USER-SPECIFIED ORDER');
      sortedVenues.sort((a, b) => (a.userOrder || a.stopNumber) - (b.userOrder || b.stopNumber));
    } else if (sortedVenues.some(v => v.startDate)) {
      sortedVenues.sort((a, b) => {
        if (a.startDate && b.startDate) return new Date(a.startDate) - new Date(b.startDate);
        if (a.startDate && !b.startDate) return -1;
        if (!a.startDate && b.startDate) return 1;
        return (a.userOrder || 0) - (b.userOrder || 0);
      });
      console.log('📅 Sorted by event times');
    } else {
      sortedVenues = optimizeRoute(allVenues);
    }

    const routeData = calculateRoute(sortedVenues);

    console.log('\n📋 FINAL ITINERARY:');
    routeData.venues.forEach((v, i) => {
      if (v.isEvent) {
        console.log(`${i + 1}. ${v.name} [EVENT - ${v.eventType || 'Event'}]`);
        if (v.startDate) {
          const date = new Date(v.startDate);
          console.log(`   📅 ${date.toLocaleDateString()} at ${date.toLocaleTimeString()}`);
        }
        console.log(`   💵 ${v.price}`);
        console.log(`   📍 ${v.venueName}`);
      } else {
        console.log(`${i + 1}. ${v.name} [${v.category}]`);
        console.log(`   📝 ${v.description?.substring(0, 80)}...`);
        console.log(`   ⭐ ${v.rating || 'N/A'}/5`);
        if (v.isExplicitRequest) {
          console.log(`   🎯 EXPLICIT REQUEST - ${v.distanceKm.toFixed(1)}km from search center`);
        }
      }
    });

    const finalItinerary = {
      title: itineraryPlan.title,
      description: itineraryPlan.description,
      duration: itineraryPlan.duration,
      vibe: itineraryPlan.vibe,
      numberOfStops: routeData.venues.length,
      hasEvents: itineraryPlan.includeEvents,
      eventTimeFrame: itineraryPlan.timeFrame,
      ...routeData,
      strategy: itineraryPlan.locationStrategy,
      dataSource: itineraryPlan.includeEvents ? 'google-and-ticketmaster' : 'google-places',
      generatedAt: new Date().toISOString()
    };

    console.log('\n' + '='.repeat(60));
    console.log('✅ ITINERARY COMPLETE');
    console.log(`Total Stops: ${finalItinerary.numberOfStops}`);
    console.log(`Total Distance: ${finalItinerary.totalDistance}km`);
    console.log(`Has Events: ${finalItinerary.hasEvents ? 'YES' : 'NO'}`);
    console.log(`Events Found: ${routeData.venues.filter(v => v.isEvent).length}`);
    console.log(`Venues Found: ${routeData.venues.filter(v => !v.isEvent).length}`);
    console.log(`Explicit Venues: ${routeData.venues.filter(v => v.isExplicitRequest).length}`);
    console.log('='.repeat(60));

    res.json({ success: true, itinerary: finalItinerary });
  } catch (error) {
    console.error('\n❌ ERROR:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =================== Replan Endpoint ====================
app.post('/api/replan', async (req, res) => {
  const { reason } = req.body;
  console.log('\n🔄 [REPLAN REQUEST]');
  console.log(`Reason: ${reason}`);
  res.json({ success: true, message: `Adjusting itinerary for: ${reason}`, updatedVenues: [] });
});

// ===================== Health Check ====================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'Running - Fixed Version with Explicit Venue Support',
    version: '6.2',
    apis: {
      openai: !!process.env.OPENAI_API_KEY,
      google_maps: !!GOOGLE_API_KEY,
      ticketmaster: !!TICKETMASTER_API_KEY
    },
    features: {
      venue_descriptions: true,
      event_search: true,
      mixed_search: true,
      proper_api_routing: true,
      dynamic_event_extraction: true,
      time_based_search: true,
      genre_detection: true,
      progressive_search: true,
      order_preservation: true,
      distance_validation: true,
      smart_caching: true,
      calendar_next_week_window: true,
      explicit_venue_support: true // NEW FEATURE
    }
  });
});

// ====================== Server Boot ====================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 PlanMate Backend - FIXED VERSION WITH EXPLICIT VENUE SUPPORT');
  console.log('='.repeat(60));
  console.log(`📍 Port: ${PORT}`);
  console.log(`✅ OpenAI: ${process.env.OPENAI_API_KEY ? 'Ready' : 'Missing'}`);
  console.log(`✅ Google Maps: ${GOOGLE_API_KEY ? 'Ready' : 'Missing'}`);
  console.log(`🎟️ Ticketmaster: ${TICKETMASTER_API_KEY ? 'Ready' : 'Not configured'}`);
  console.log('\n📋 Features:');
  console.log('   ✅ Proper API routing (Google for venues, Ticketmaster for events)');
  console.log('   ✅ Date windows (UTC, no ms) for Ticketmaster');
  console.log('   ✅ Calendar-accurate "next week" window');
  console.log('   ✅ Optional next-48h nearby event scan around chosen venues');
  console.log('   ✅ Order preservation / time-aware sorting');
  console.log('   ✅ Smart venue selection & caching');
  console.log('   ✅ EXPLICIT VENUE SUPPORT - Finds exact venues regardless of distance');
  console.log('='.repeat(60) + '\n');
});
