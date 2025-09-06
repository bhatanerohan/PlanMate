// tm-today-utc-noms.js — fixes DIS1015 by removing milliseconds from ISO datetimes
// Usage:
//   TICKETMASTER_API_KEY=YOUR_KEY node tm-today-utc-noms.js
//   CITY="New York" KEYWORD="live" TICKETMASTER_API_KEY=YOUR_KEY node tm-today-utc-noms.js

const axios = require('axios');

const API_KEY = "EThgRxTAH18tNFjw3lz19uVaH5fxU2c6";
if (!API_KEY) { console.error('Missing TICKETMASTER_API_KEY'); process.exit(1); }

const CITY = process.env.CITY || 'New York';
const KEYWORD = process.env.KEYWORD || 'rock';

// Format: YYYY-MM-DDTHH:mm:ssZ (no milliseconds)
function isoNoMs(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`;
}

const now = new Date();
const end = new Date(now.getTime() + 24*60*60*1000); // +24h
// For "this week" instead, use: const end = new Date(now.getTime() + 7*24*60*60*1000);

(async () => {
  try {
    const params = {
      apikey: API_KEY,
      countryCode: 'US',
      city: CITY,
      keyword: KEYWORD,
      startDateTime: isoNoMs(now),
      endDateTime: isoNoMs(end),
      sort: 'date,asc',
      size: 20
    };

    const { data } = await axios.get('https://app.ticketmaster.com/discovery/v2/events.json', { params });
    const events = data?._embedded?.events || [];
    console.log(`Found ${events.length} events for ${CITY}`);
    for (const e of events.slice(0, 10)) {
      const v = e._embedded?.venues?.[0];
      const when = e.dates?.start?.dateTime || e.dates?.start?.localDate;
      console.log(`- ${e.name} | ${when} | ${v?.name}, ${v?.city?.name} | ${e.url}`);
    }
  } catch (err) {
    console.error('Ticketmaster error:', err.response?.status, err.response?.data || err.message);
  }
})();

// const API_KEY = 'EThgRxTAH18tNFjw3lz19uVaH5fxU2c6';

// fetch(`https://app.ticketmaster.com/discovery/v2/events.json?apikey=${API_KEY}&city=New+York&size=5`)
//   .then(res => res.json())
//   .then(data => {
//     console.log('✅ Connected:', data.page.totalElements, 'events found');
//     data._embedded?.events?.forEach(e => 
//       console.log(`- ${e.name} | ${e.dates.start.localDate}`)
//     );
//   })
//   .catch(err => console.log('❌ Error:', err));