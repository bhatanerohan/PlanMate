import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import axios from 'axios';

// Load env from backend/.env if present (ESM compatible)
try {
  const candidates = [
    // Run from project root
    path.resolve(process.cwd(), 'backend/.env'),
    // Run from within mcp/
    path.resolve(process.cwd(), '../backend/.env'),
    // Resolve relative to this file's directory
    path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../backend/.env')
  ];
  const envPath = candidates.find(p => {
    try { return fs.existsSync(p); } catch { return false; }
  });
  if (envPath) {
    const parsed = dotenv.config({ path: envPath }).parsed || {};
    if (!process.env.GOOGLE_MAPS_API_KEY && parsed.GOOGLE_MAPS_API_KEY) {
      process.env.GOOGLE_MAPS_API_KEY = parsed.GOOGLE_MAPS_API_KEY;
    }
  }
} catch {}

// Also try to load Ticketmaster key
try {
  const candidates = [
    path.resolve(process.cwd(), 'backend/.env'),
    path.resolve(process.cwd(), '../backend/.env'),
    path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../backend/.env')
  ];
  const envPath = candidates.find(p => {
    try { return fs.existsSync(p); } catch { return false; }
  });
  if (envPath) {
    const parsed = dotenv.config({ path: envPath }).parsed || {};
    if (!process.env.TICKETMASTER_API_KEY && parsed.TICKETMASTER_API_KEY) {
      process.env.TICKETMASTER_API_KEY = parsed.TICKETMASTER_API_KEY;
    }
  }
} catch {}

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const TICKETMASTER_API_KEY = process.env.TICKETMASTER_API_KEY;

const server = new McpServer({ name: 'planmate-mcp', version: '0.1.0' });

const SearchVenuesInput = z.object({
  query: z.string().default('point of interest').describe('Search query like cafe, restaurant, museum'),
  lat: z.number().describe('Latitude for search center'),
  lng: z.number().describe('Longitude for search center'),
  category: z.string().optional().describe('Google Places type like restaurant, cafe, bar, museum'),
  radius: z.number().int().min(100).max(50000).default(1500).describe('Search radius in meters (100-50000)'),
  limit: z.number().int().min(1).max(10).default(5).describe('Max results to return (1-10)')
});

server.tool(
  'search-venues',
  'Search nearby venues using Google Places Text/Nearby Search',
  SearchVenuesInput.shape,
  async ({ query, lat, lng, category, radius, limit }) => {
    if (!GOOGLE_API_KEY) {
      return { content: [{ type: 'text', text: 'Google Maps API key missing' }] };
    }

    const location = `${lat},${lng}`;

    // First try Text Search
    const textParams: Record<string, any> = {
      query: query || category || 'point of interest',
      location,
      radius,
      type: category,
      region: 'us',
      language: 'en',
      key: GOOGLE_API_KEY
    };

    let candidates: any[] = [];
    try {
      const textRes = await axios.get('https://maps.googleapis.com/maps/api/place/textsearch/json', { params: textParams });
      candidates = Array.isArray(textRes.data.results) ? textRes.data.results : [];
    } catch (e: any) {
      // fall back to nearby only if text fails
    }

    if (candidates.length === 0) {
      const nearbyParams = {
        location,
        radius,
        type: category,
        keyword: query,
        key: GOOGLE_API_KEY
      };
      const nearRes = await axios.get('https://maps.googleapis.com/maps/api/place/nearbysearch/json', { params: nearbyParams });
      candidates = Array.isArray(nearRes.data.results) ? nearRes.data.results : [];
    }

    const toKm = (meters: number) => meters / 1000;

    const venues = candidates.slice(0, limit).map((place: any) => {
      const plat = place.geometry?.location?.lat;
      const plng = place.geometry?.location?.lng;
      return {
        id: place.place_id,
        name: place.name,
        category: (place.types && place.types[0]) || category || 'poi',
        lat: plat,
        lng: plng,
        address: place.formatted_address || place.vicinity || 'Address not available',
        rating: place.rating,
        userRatingsTotal: place.user_ratings_total,
        priceLevel: place.price_level
      };
    });

    return {
      content: [
        { type: 'text', text: JSON.stringify({ count: venues.length, venues }, null, 2) }
      ]
    };
  }
);

// ===================== search-events (Ticketmaster) =====================
const SearchEventsInput = z.object({
  lat: z.number().describe('Latitude for search center'),
  lng: z.number().describe('Longitude for search center'),
  radiusKm: z.number().int().min(1).max(150).default(10).describe('Search radius in kilometers (1-150)'),
  keyword: z.string().optional().describe('Keyword like concert, rock, festival'),
  size: z.number().int().min(1).max(20).default(10).describe('Max number of events to return (1-20)')
});

server.tool(
  'search-events',
  'Search nearby events using Ticketmaster Discovery API',
  SearchEventsInput.shape,
  async ({ lat, lng, radiusKm, keyword, size }) => {
    if (!TICKETMASTER_API_KEY) {
      return { content: [{ type: 'text', text: 'Ticketmaster API key missing' }] };
    }

    const params: Record<string, any> = {
      apikey: TICKETMASTER_API_KEY,
      latlong: `${lat},${lng}`,
      radius: Math.max(1, Math.min(150, Math.round(radiusKm))),
      unit: 'km',
      sort: 'date,asc',
      size
    };
    if (keyword) params.keyword = keyword;

    try {
      const url = 'https://app.ticketmaster.com/discovery/v2/events.json';
      const res = await axios.get(url, { params });
      const events = res.data?._embedded?.events || [];
      const out = events.slice(0, size).map((ev: any) => {
        const venue = ev._embedded?.venues?.[0] || {};
        const vLoc = venue.location || {};
        const eLat = vLoc.latitude ? parseFloat(vLoc.latitude) : undefined;
        const eLng = vLoc.longitude ? parseFloat(vLoc.longitude) : undefined;
        const pr = ev.priceRanges?.[0];
        let price = 'Check website';
        if (pr && typeof pr.min === 'number') {
          const cur = pr.currency || '$';
          price = typeof pr.max === 'number' && pr.max !== pr.min ? `${cur}${pr.min}-${cur}${pr.max}` : `${cur}${pr.min}`;
        }
        return {
          id: ev.id,
          name: ev.name,
          startDate: ev.dates?.start?.dateTime || ev.dates?.start?.localDate || null,
          url: ev.url,
          venueName: venue.name,
          lat: eLat,
          lng: eLng,
          address: [venue.address?.line1, venue.city?.name, venue.state?.stateCode, venue.postalCode].filter(Boolean).join(', '),
          price
        };
      });
      return { content: [{ type: 'text', text: JSON.stringify({ count: out.length, events: out }, null, 2) }] };
    } catch (e: any) {
      return { content: [{ type: 'text', text: `Ticketmaster error: ${e?.response?.status || ''} ${e?.message || e}` }] };
    }
  }
);

// ===================== replan (basic) =====================
const ReplanInput = z.object({
  reason: z.string().describe('Reason for replanning, e.g., rain, crowded'),
  currentItinerary: z.any().optional().describe('Current itinerary object'),
  location: z.object({ lat: z.number(), lng: z.number() }).optional()
});

server.tool(
  'replan',
  'Adjust itinerary based on a reason; returns a status message and optional updates',
  ReplanInput.shape,
  async ({ reason, currentItinerary, location }) => {
    const message = `Adjusting itinerary for: ${reason}`;
    const payload = {
      success: true,
      message,
      updatedVenues: []
    };
    return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('PlanMate MCP server running (stdio). Tool: search-venues');
}

main().catch((err) => {
  console.error('Fatal error in MCP server:', err);
  process.exit(1);
});
