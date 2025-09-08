// Ticketmaster Discovery API - Get Nearby Events
// You'll need to get your API key from: https://developer.ticketmaster.com/

const TICKETMASTER_API_KEY = 'EThgRxTAH18tNFjw3lz19uVaH5fxU2c6'; // Replace with your actual API key
// const TICKETMASTER_API_KEY = 'REPLACE_ME'; // ⚠️ don't commit real keys
const BASE_URL = 'https://app.ticketmaster.com/discovery/v2/events.json';

function isoNoMs(date) {
  // Returns 'YYYY-MM-DDTHH:mm:ssZ'
  return new Date(date).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function getNextWeekUTCWindow(now = new Date()) {
  // Compute next Monday 00:00:00 UTC to next Sunday 23:59:59 UTC
  const d = new Date(now);
  const day = d.getUTCDay(); // 0=Sun...6=Sat
  const daysUntilNextMon = ((8 - day) % 7) || 7; // if today is Mon, jump to next Mon
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
  return { start: isoNoMs(start), end: isoNoMs(end) };
}

/**
 * Fetch nearby events from Ticketmaster API, constrained by a time window.
 */
async function getNearbyEvents(latitude, longitude, {
  radius = 5,
  unit = 'km',
  size = 10,
  startDateTime, // ISO string 'YYYY-MM-DDTHH:mm:ssZ'
  endDateTime    // ISO string 'YYYY-MM-DDTHH:mm:ssZ'
} = {}) {
  try {
    const paramsObj = {
      apikey: TICKETMASTER_API_KEY,
      latlong: `${latitude},${longitude}`,
      radius: String(radius),
      unit,
      size: String(size),
      sort: 'date,asc',
      includeTBA: 'no',
      includeTBD: 'no'
    };

    if (startDateTime) paramsObj.startDateTime = startDateTime;
    if (endDateTime) paramsObj.endDateTime = endDateTime;

    const params = new URLSearchParams(paramsObj);
    const resp = await fetch(`${BASE_URL}?${params}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (err) {
    console.error('Error fetching events:', err);
    throw err;
  }
}

function displayEvents(eventsData) {
  const events = eventsData?._embedded?.events;
  if (!events || events.length === 0) {
    console.log('No events found in the specified window/area.');
    return;
  }
  console.log(`Found ${events.length} events:\n`);
  events.forEach((event, i) => {
    const d = event.dates?.start;
    const venue = event._embedded?.venues?.[0];
    const price = event.priceRanges?.[0];
    console.log(`${i + 1}. ${event.name}`);
    console.log(`   Date: ${d?.localDate || 'TBA'}`);
    console.log(`   Time: ${d?.localTime || 'TBA'}`);
    if (venue) {
      console.log(`   Venue: ${venue.name}`);
      console.log(`   Address: ${venue.address?.line1 || 'N/A'}`);
    }
    if (price) console.log(`   Price: $${price.min} - $${price.max}`);
    console.log(`   URL: ${event.url}`);
    console.log('---');
  });
}

// Example usage: strictly "next week" in UTC
async function main() {
  const latitude = 40.7580;   // Times Square
  const longitude = -73.9855;
  const { start, end } = getNextWeekUTCWindow(new Date()); // compute once

  console.log(`Searching for events next week:\n  start=${start}\n  end  =${end}\n`);

  try {
    const data = await getNearbyEvents(latitude, longitude, {
      radius: 5,
      unit: 'km',
      size: 10,
      startDateTime: start,
      endDateTime: end
    });
    displayEvents(data);
    return data;
  } catch (e) {
    console.error('Failed to fetch events:', e.message);
  }
}

main(); // uncomment to run

// Updated test with date window wired up
async function testAPIConnection() {
  console.log('🧪 === TICKETMASTER API CONNECTION TEST ===\n');
  if (!TICKETMASTER_API_KEY || /REPLACE_ME|YOUR_API_KEY/i.test(TICKETMASTER_API_KEY)) {
    console.error('❌ ERROR: Set your Ticketmaster API key first.');
    return;
  }
  const lat = 40.7580, long = -73.9855;
  const { start, end } = getNextWeekUTCWindow();

  console.log('📍 Times Square, NYC');
  console.log(`📅 Window: ${start} → ${end}`);
  try {
    const t0 = Date.now();
    const res = await getNearbyEvents(lat, long, {
      radius: 5, unit: 'km', size: 10,
      startDateTime: start, endDateTime: end
    });
    console.log(`⏱️ ${Date.now() - t0}ms`);
    const events = res?._embedded?.events || [];
    console.log(`✅ Found ${events.length} events for next week`);
    events.slice(0, 3).forEach((ev, i) =>
      console.log(`  ${i + 1}. ${ev.name} — ${ev.dates?.start?.localDate || 'TBA'}`));
    return res;
  } catch (err) {
    console.error('❌ API TEST FAILED:', err.message);
    if (/401/.test(err.message)) console.error('🔐 Check your API key.');
    if (/429/.test(err.message)) console.error('⚡ Rate limit exceeded.');
  }
}

// testAPIConnection(); // uncomment to run
