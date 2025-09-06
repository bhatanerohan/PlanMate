// backend/server.js - FIXED MIXED SEARCH VERSION
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

// Generate better cache key
function generateCacheKey(query, location, category, limit, radius) {
  const latZone = Math.round(location.lat * 100) / 100;
  const lngZone = Math.round(location.lng * 100) / 100;
  return `google-${query}-${category}-${latZone}-${lngZone}-${limit}-${radius}`;
}

// Validate venue distance
function validateVenueDistance(venue, searchCenter, maxDistanceKm = 5) {
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
    console.log('   ❌ ROUTE ERROR: Unreasonable distances detected!');
  }
  if (totalDistance > 20) {
    console.log('   ⚠️ WARNING: Total distance seems unreasonable for a walking itinerary!');
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
  const promptLower = prompt.toLowerCase();
  const keywords = [];
  
  // Music genres
  const musicGenres = ['rock', 'pop', 'jazz', 'classical', 'hip hop', 'rap', 'country', 'electronic', 'edm', 'metal', 'indie', 'folk', 'blues', 'r&b', 'soul', 'punk', 'alternative'];
  musicGenres.forEach(genre => {
    if (promptLower.includes(genre)) keywords.push(genre);
  });
  
  // Event types
  const eventTypes = ['concert', 'show', 'festival', 'performance', 'musical', 'opera', 'ballet', 'symphony', 'comedy', 'stand-up', 'theater', 'theatre', 'play', 'broadway'];
  eventTypes.forEach(type => {
    if (promptLower.includes(type)) keywords.push(type);
  });
  
  // Sports
  const sports = ['basketball', 'football', 'baseball', 'hockey', 'soccer', 'tennis', 'golf', 'boxing', 'mma', 'ufc'];
  sports.forEach(sport => {
    if (promptLower.includes(sport)) keywords.push(sport);
  });
  
  // Default to general event terms if nothing specific found
  if (keywords.length === 0) {
    if (promptLower.includes('music') || promptLower.includes('live')) keywords.push('music');
    if (promptLower.includes('event')) keywords.push('event');
    if (promptLower.includes('tonight') || promptLower.includes('today')) keywords.push('live');
  }
  
  return keywords;
}

// Enhanced date range extraction from prompt
function extractDateRange(prompt) {
  const promptLower = prompt.toLowerCase();
  const now = new Date();
  
  // Format date without milliseconds for Ticketmaster
  function isoNoMs(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`;
  }
  
  // Today
  if (promptLower.includes('today') || promptLower.includes('tonight')) {
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 0);
    return {
      startDateTime: isoNoMs(now),
      endDateTime: isoNoMs(endOfDay),
      isToday: true
    };
  }
  
  // Tomorrow
  if (promptLower.includes('tomorrow')) {
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    tomorrow.setHours(0, 0, 0, 0);
    const endOfTomorrow = new Date(tomorrow);
    endOfTomorrow.setHours(23, 59, 59, 0);
    return {
      startDateTime: isoNoMs(tomorrow),
      endDateTime: isoNoMs(endOfTomorrow),
      isToday: false
    };
  }
  
  // This weekend
  if (promptLower.includes('weekend') || promptLower.includes('saturday') || promptLower.includes('sunday')) {
    const dayOfWeek = now.getDay();
    const daysUntilSaturday = (6 - dayOfWeek + 7) % 7 || 7;
    const saturday = new Date(now.getTime() + daysUntilSaturday * 24 * 60 * 60 * 1000);
    saturday.setHours(0, 0, 0, 0);
    const sunday = new Date(saturday.getTime() + 2 * 24 * 60 * 60 * 1000);
    sunday.setHours(23, 59, 59, 0);
    return {
      startDateTime: isoNoMs(saturday),
      endDateTime: isoNoMs(sunday),
      isToday: false
    };
  }
  
  // Next week
  if (promptLower.includes('next week') || promptLower.includes('this week')) {
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return {
      startDateTime: isoNoMs(now),
      endDateTime: isoNoMs(nextWeek),
      isToday: false
    };
  }
  
  // Next month
  if (promptLower.includes('next month') || promptLower.includes('this month')) {
    const nextMonth = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    return {
      startDateTime: isoNoMs(now),
      endDateTime: isoNoMs(nextMonth),
      isToday: false
    };
  }
  
  // Default: next 7 days
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    startDateTime: isoNoMs(now),
    endDateTime: isoNoMs(nextWeek),
    isToday: false
  };
}

// Map categories to Ticketmaster segments and classifications
function mapToTicketmasterCategories(categories = [], keywords = []) {
  const segments = new Set();
  const classifications = new Set();
  
  // Process categories
  categories.forEach(cat => {
    const c = String(cat).toLowerCase();
    if (c.includes('music') || c.includes('concert')) segments.add('Music');
    if (c.includes('sport')) segments.add('Sports');
    if (c.includes('art') || c.includes('theatre') || c.includes('theater')) segments.add('Arts & Theatre');
    if (c.includes('family') || c.includes('kids')) segments.add('Family');
  });
  
  // Process keywords for more specific classifications
  keywords.forEach(kw => {
    const k = String(kw).toLowerCase();
    // Music genres
    if (['rock', 'pop', 'jazz', 'classical', 'hip hop', 'country', 'electronic'].includes(k)) {
      segments.add('Music');
    }
    // Sports
    if (['basketball', 'football', 'baseball', 'hockey', 'soccer', 'tennis'].includes(k)) {
      segments.add('Sports');
    }
    // Comedy
    if (k.includes('comedy') || k.includes('stand-up')) {
      classifications.add('Comedy');
    }
  });
  
  return {
    segmentNames: Array.from(segments),
    classificationNames: Array.from(classifications)
  };
}

// =================== Enhanced Ticketmaster API Integration ==================
async function searchEventsTicketmaster(location, radiusKm = 5, prompt = '', categories = null) {
  console.log('\n' + '='.repeat(60));
  console.log('🎟️ [TICKETMASTER API REQUEST - DYNAMIC]');
  console.log('='.repeat(60));
  console.log(`Location: ${location.lat}, ${location.lng}`);
  console.log(`Radius: ${radiusKm}km`);
  console.log(`Prompt: ${prompt}`);
  
  if (!TICKETMASTER_API_KEY) {
    console.log('⚠️ Ticketmaster API key not configured');
    return [];
  }

  // Extract keywords and date range from prompt
  const keywords = extractEventKeywords(prompt);
  const dateRange = extractDateRange(prompt);
  const keyword = keywords.length > 0 ? keywords.join(' ') : 'event';
  
  console.log(`Extracted Keywords: ${keywords.join(', ') || 'none'}`);
  console.log(`Date Range: ${dateRange.isToday ? 'TODAY' : 'Custom range'}`);

  const geoPoint = geohashEncode(location.lat, location.lng, 9);
  const radiusClamped = Math.max(1, Math.min(150, Math.round(radiusKm)));

  // Map to Ticketmaster categories
  const { segmentNames, classificationNames } = mapToTicketmasterCategories(categories, keywords);
  
  console.log(`Segments: ${segmentNames.join(', ') || 'all'}`);
  console.log(`Classifications: ${classificationNames.join(', ') || 'all'}`);

  // Build params
  const params = {
    apikey: TICKETMASTER_API_KEY,
    keyword: keyword,
    sort: 'date,asc',
    size: 20, // Reduced size for better performance
    geoPoint,
    radius: radiusClamped,
    unit: 'km',
    startDateTime: dateRange.startDateTime,
    endDateTime: dateRange.endDateTime
  };

  // Add city hint for better results
  if (prompt.toLowerCase().includes('nyc') || prompt.toLowerCase().includes('new york')) {
    params.city = 'New York';
    params.stateCode = 'NY';
    params.countryCode = 'US';
  }

  // Add segments and classifications if found
  if (segmentNames.length > 0) {
    params.segmentName = segmentNames.join(',');
  }
  if (classificationNames.length > 0) {
    params.classificationName = classificationNames.join(',');
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

    const processedEvents = events.slice(0, 20).map((event) => {
      const venue = event._embedded?.venues?.[0] || {};
      const vLoc = venue.location || {};
      const lat = vLoc.latitude ? parseFloat(vLoc.latitude) : location.lat;
      const lng = vLoc.longitude ? parseFloat(vLoc.longitude) : location.lng;
      let distance = vLoc.latitude && vLoc.longitude ? calculateDistance(location.lat, location.lng, lat, lng) : radiusClamped;

      // Price information
      let priceInfo = 'Check website';
      const pr = event.priceRanges?.[0];
      if (pr && typeof pr.min === 'number') {
        const currency = pr.currency || '$';
        priceInfo = (typeof pr.max === 'number' && pr.max !== pr.min)
          ? `${currency}${pr.min}-${currency}${pr.max}`
          : `${currency}${pr.min}`;
      }

      // Date and time
      const startISO = event.dates?.start?.dateTime || event.dates?.start?.localDate;
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
        startDate: startISO || null,
        eventUrl: event.url,
        imageUrl,
        price: priceInfo,
        isEvent: true,
        distance: distance * 1000, // meters
        venueName: venue.name || 'Venue TBA',
        ticketsAvailable: statusCode !== 'offsale' && statusCode !== 'canceled',
        soldOut: statusCode === 'offsale',
        status: statusCode,
        genre: gen
      };
    });

    // Filter and sort events
    const validEvents = processedEvents.filter((event) => {
      // Distance filter
      if (event.distance > (radiusClamped * 1000 * 1.5)) return false;
      
      // Status filter
      if (event.status === 'canceled') return false;
      
      // Date filter for past events
      if (event.startDate) {
        const eventStart = new Date(event.startDate);
        const now = new Date();
        if (eventStart < new Date(now.getTime() - 24 * 60 * 60 * 1000)) return false;
      }
      
      return true;
    });

    // Sort by relevance (date, then distance)
    validEvents.sort((a, b) => {
      // First by date
      if (a.startDate && b.startDate) {
        const dateA = new Date(a.startDate);
        const dateB = new Date(b.startDate);
        const dateDiff = dateA - dateB;
        if (dateDiff !== 0) return dateDiff;
      }
      // Then by distance
      return a.distance - b.distance;
    });

    console.log('\n✅ TICKETMASTER EVENTS FOUND:');
    validEvents.slice(0, 5).forEach((e, i) => {
      console.log(`${i + 1}. ${e.name} [${e.eventType}]`);
      if (e.startDate) {
        const date = new Date(e.startDate);
        console.log(`   📅 ${date.toLocaleDateString()} at ${date.toLocaleTimeString()}`);
      }
      console.log(`   📍 ${e.venueName} (${Math.round(e.distance)}m away)`);
      console.log(`   💵 ${e.price} | 🎫 ${e.soldOut ? 'SOLD OUT' : 'Available'}`);
    });

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

// ================ Google Places Search with Descriptions =================
async function searchVenuesGoogle(query, location, category, limit = 5, radius = 1500) {
  console.log(`\n${'='.repeat(60)}`);
  console.log('🗺️ [GOOGLE PLACES API REQUEST]');
  console.log('='.repeat(60));
  console.log(`Query: "${query}"`);
  console.log(`Location: ${location.lat}, ${location.lng}`);
  console.log(`Category: ${category}`);
  console.log(`Radius: ${radius}m`);

  if (!GOOGLE_API_KEY) {
    throw new Error('Google Maps API key missing');
  }

  const cacheKey = generateCacheKey(query, location, category, limit, radius);
  const cached = cache.get(cacheKey);
  
  if (cached && cached.length > 0) {
    const validCached = cached.filter(venue => 
      validateVenueDistance(venue, location, radius / 1000 * 2)
    );
    if (validCached.length > 0) {
      console.log(`✅ VALID CACHE HIT: ${validCached.length} venues with descriptions`);
      return validCached;
    } else {
      console.log('❌ CACHE INVALID: Venues too far from search location');
      cache.del(cacheKey);
    }
  }

  const googleType = mapCategoryToGoogleType(category);

  try {
    const textParams = {
      query: query || googleType || 'point of interest',
      location: `${location.lat},${location.lng}`,
      radius: radius,
      type: googleType,
      region: 'us',
      language: 'en',
      key: GOOGLE_API_KEY
    };
    
    console.log('\n📤 GOOGLE PLACES TEXT SEARCH REQUEST:');

    const textSearchURL = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
    const textRes = await axios.get(textSearchURL, { params: textParams });
    
    console.log(`\n📥 Response: ${textRes.data.status}, Found: ${textRes.data.results?.length || 0} venues`);
    
    let candidates = Array.isArray(textRes.data.results) ? textRes.data.results : [];

    if (candidates.length === 0) {
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
      .slice(0, limit * 2)
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
          distance: distance * 1000,
          distanceKm: distance
        };
      })
      .filter(venue => {
        const maxDistance = Math.min((radius * 2) / 1000, 5);
        if (venue.distanceKm > maxDistance) {
          console.log(`   ❌ Too far: ${venue.name} (${venue.distanceKm.toFixed(1)}km)`);
          return false;
        }
        return true;
      })
      .slice(0, limit);

    if (venues.length === 0) throw new Error('No venues found within reasonable distance');

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

    cache.set(cacheKey, venues, 7200);
    
    console.log('\n✅ VENUES WITH DESCRIPTIONS:');
    venues.forEach((v, i) => {
      console.log(`${i+1}. ${v.name}`);
      console.log(`   📝 ${v.description}`);
      console.log(`   ⭐ ${v.rating || 'N/A'} (${v.user_ratings_total || 0} reviews)`);
      console.log(`   📍 ${Math.round(v.distance)}m away`);
    });

    return venues;
  } catch (error) {
    const msg = error?.response?.data?.error_message || error.message;
    console.error('❌ Google Places Error:', msg);
    throw new Error(msg);
  }
}

// ================== Enhanced OpenAI Planning ===================
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
  "includeEvents": true/false, // true if ANY stop is an event
  "eventKeywords": ["rock", "concert"], // Only for event stops
  "eventCategories": ["music"], // Only for event stops
  "timeFrame": "today|tonight|tomorrow|weekend|week",
  "locationStrategy": {
    "type": "user_sequence",
    "pattern": "user_defined",
    "reasoning": "User specified order",
    "preserveOrder": true
  },
  "searchPoints": [
    {
      "stopNumber": 1,
      "searchType": "venue", // IMPORTANT: "venue" for restaurants/bars, "event" for concerts
      "query": "lunch restaurants", // Be specific
      "category": "restaurant", // Use actual category, not "lunch"
      "lat": 40.7074,
      "lng": -74.0113,
      "searchRadius": 1500,
      "purpose": "Lunch at Wall Street",
      "userOrder": 1
    },
    {
      "stopNumber": 2,
      "searchType": "event", // Only for actual events
      "query": "rock concert",
      "category": "music",
      "lat": 40.7580,
      "lng": -73.9855,
      "searchRadius": 2000,
      "purpose": "Live rock event near Times Square",
      "userOrder": 2
    },
    {
      "stopNumber": 3,
      "searchType": "venue", // Bars are venues, not events
      "query": "bar",
      "category": "bar",
      "lat": 40.7336,
      "lng": -74.0027,
      "searchRadius": 1500,
      "purpose": "Bar in West Village",
      "userOrder": 3
    }
  ],
  "routingPriority": "user_sequence"
}

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
    
    // Log each search point type
    result.searchPoints?.forEach((point, idx) => {
      console.log(`   ${idx + 1}. ${point.purpose}: ${point.searchType === 'event' ? '🎟️ EVENT' : '📍 VENUE'}`);
    });

    return result;
  } catch (error) {
    console.error('❌ OpenAI Error:', error.message);
    throw error;
  }
}

// ===================== Main Progressive Itinerary Endpoint ===================
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

    // Step 1: AI Planning with enhanced event detection
    const itineraryPlan = await generateItineraryLogic(prompt, timeOfDay, defaultLocation);

    // Step 2: Progressive Search - FIXED LOGIC
    console.log('\n' + '='.repeat(60));
    console.log('📍 EXECUTING SEARCH PLAN');
    console.log('='.repeat(60));
    
    const allVenues = [];
    let lastVenueLocation = null;

    for (let i = 0; i < itineraryPlan.searchPoints.length; i++) {
      const point = itineraryPlan.searchPoints[i];
      let searchLocation = { lat: point.lat, lng: point.lng };
      
      console.log(`\n🔍 Stop ${point.stopNumber}: ${point.purpose || point.query}`);
      console.log(`   Type: ${point.searchType || 'venue'}`);
      console.log(`   Query: "${point.query}"`);
      console.log(`   Category: ${point.category}`);
      console.log(`   Search Center: ${searchLocation.lat.toFixed(4)}, ${searchLocation.lng.toFixed(4)}`);

      try {
        // FIXED: Only search events when searchType is explicitly "event"
        if (point.searchType === 'event') {
          console.log('   🎟️ Searching for events via Ticketmaster...');

          const events = await searchEventsTicketmaster(
            searchLocation,
            point.searchRadius / 1000 || 2, // Convert to km
            point.query || prompt, // Use point query or full prompt
            point.category ? [point.category] : null
          );

          if (events.length > 0) {
            // Select the best event for this stop
            const selectedEvent = events[0]; // Take the first (best) event
            selectedEvent.purpose = point.purpose;
            selectedEvent.userOrder = point.userOrder || i + 1;
            selectedEvent.stopNumber = point.stopNumber;
            
            lastVenueLocation = { lat: selectedEvent.lat, lng: selectedEvent.lng, name: selectedEvent.name };
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
          // Regular venue search using Google Places
          console.log('   📍 Searching for venues via Google Places...');
          
          let searchRadius = point.searchRadius || 1500;
          let venues = [];
          let attempts = 0;
          const maxAttempts = 3;

          while (venues.length === 0 && attempts < maxAttempts) {
            try {
              venues = await searchVenuesGoogle(
                point.query,
                searchLocation,
                point.category,
                3, // Limit to 3 venues per search
                searchRadius * (attempts + 1)
              );
              if (venues.length === 0 && attempts < maxAttempts - 1) {
                console.log(`   ⚠️ No venues found, expanding search radius...`);
              }
            } catch (searchError) {
              console.log(`   ⚠️ Attempt ${attempts + 1} failed: ${searchError.message}`);
            }
            attempts++;
          }

          if (venues.length > 0) {
            // Select the best venue based on rating and reviews
            const selectedVenue = venues.reduce((best, venue) => {
              const bestScore = (best.rating || 0) * Math.log((best.user_ratings_total || 1) + 1);
              const venueScore = (venue.rating || 0) * Math.log((venue.user_ratings_total || 1) + 1);
              return venueScore > bestScore ? venue : best;
            });
            
            selectedVenue.purpose = point.purpose;
            selectedVenue.userOrder = point.userOrder || i + 1;
            selectedVenue.stopNumber = point.stopNumber;
            lastVenueLocation = { lat: selectedVenue.lat, lng: selectedVenue.lng, name: selectedVenue.name };
            allVenues.push(selectedVenue);
            console.log(`   ✅ Selected Venue: ${selectedVenue.name}`);
            console.log(`      ⭐ Rating: ${selectedVenue.rating || 'N/A'}/5 (${selectedVenue.user_ratings_total || 0} reviews)`);
          }
        }
      } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
      }

      if (i < itineraryPlan.searchPoints.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    if (allVenues.length === 0) {
      return res.status(404).json({ success: false, error: 'No venues found. Please try a different search.' });
    }

    console.log(`\n📊 RESULTS: ${allVenues.length} out of ${itineraryPlan.searchPoints.length} stops found`);

    // Step 3: Route ordering - Preserve user order
    console.log('\n' + '='.repeat(60));
    console.log('🗺️ FINALIZING ROUTE');
    console.log('='.repeat(60));
    
    let sortedVenues = [...allVenues];
    
    // Always preserve user order when specified
    if (itineraryPlan.locationStrategy?.preserveOrder) {
      console.log('✅ PRESERVING USER-SPECIFIED ORDER');
      sortedVenues.sort((a, b) => (a.userOrder || a.stopNumber) - (b.userOrder || b.stopNumber));
    } else if (sortedVenues.some(v => v.startDate)) {
      // Sort by event times if we have time-sensitive events
      sortedVenues.sort((a, b) => {
        if (a.startDate && b.startDate) {
          return new Date(a.startDate) - new Date(b.startDate);
        }
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
    console.log('='.repeat(60));

    res.json({ success: true, itinerary: finalItinerary });
  } catch (error) {
    console.error('\n❌ ERROR:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =================== Replan Endpoint ====================
app.post('/api/replan', async (req, res) => {
  const { reason, currentItinerary, location } = req.body;
  console.log('\n🔄 [REPLAN REQUEST]');
  console.log(`Reason: ${reason}`);
  res.json({ success: true, message: `Adjusting itinerary for: ${reason}`, updatedVenues: [] });
});

// ===================== Health Check ====================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'Running - Fixed Mixed Search Version',
    version: '6.0',
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
      smart_caching: true
    }
  });
});

// ====================== Server Boot ====================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 PlanMate Backend - FIXED MIXED SEARCH VERSION');
  console.log('='.repeat(60));
  console.log(`📍 Port: ${PORT}`);
  console.log(`✅ OpenAI: ${process.env.OPENAI_API_KEY ? 'Ready' : 'Missing'}`);
  console.log(`✅ Google Maps: ${GOOGLE_API_KEY ? 'Ready' : 'Missing'}`);
  console.log(`🎟️ Ticketmaster: ${TICKETMASTER_API_KEY ? 'Ready' : 'Not configured'}`);
  console.log('\n📋 Features:');
  console.log('   ✅ Fixed: Proper API routing (Google for venues, Ticketmaster for events)');
  console.log('   ✅ Fixed: Returns correct number of stops (3 not 9)');
  console.log('   ✅ Dynamic event keyword extraction');
  console.log('   ✅ Intelligent date range detection');
  console.log('   ✅ Preserves user-specified order');
  console.log('   ✅ Smart venue selection based on ratings');
  console.log('   ✅ Enhanced error handling and fallbacks');
  console.log('='.repeat(60) + '\n');
});