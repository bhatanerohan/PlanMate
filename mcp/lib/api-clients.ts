// mcp/lib/api-clients.ts - COMPLETE VERSION WITH ALL FIXES
import axios from 'axios';
import { Venue, Event, VenueSearchParams, EventSearchParams } from './types.js';

export class GoogleMapsClient {
  private apiKey: string;
  private baseUrl = 'https://maps.googleapis.com/maps/api/place';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async searchVenues(params: VenueSearchParams): Promise<Venue[]> {
    const { query, location, category, radius = 1500, limit = 5 } = params;

    try {
      // Map category to Google Places type
      let googleType = undefined;
      let searchQuery = query;
      
      if (category === 'food' || category === 'restaurant') {
        googleType = 'restaurant';
        // If query is generic, make it more specific
        if (query === 'lunch restaurant' || query === 'dinner restaurant' || query === 'breakfast restaurant') {
          searchQuery = 'restaurant';
        }
      } else if (category === 'coffee' || category === 'cafe') {
        googleType = 'cafe';
        if (query === 'coffee shop' || query === 'coffee') {
          searchQuery = 'coffee shop cafe';
        }
      } else if (category === 'parks' || category === 'park') {
        googleType = 'park';
        // For Bryant Park specifically
        if (query?.toLowerCase().includes('bryant park')) {
          searchQuery = 'Bryant Park';
        }
      } else if (category === 'landmark' || category === 'tourist_attraction') {
        googleType = 'tourist_attraction';
      } else if (category === 'bar' || category === 'nightlife') {
        googleType = 'bar';
      } else if (category === 'museum') {
        googleType = 'museum';
      }

      console.log(`[GoogleMapsClient] Searching: query="${searchQuery}", type="${googleType}", location=(${location.lat},${location.lng}), radius=${radius}`);

      let places = [];

      // Strategy 1: Try Nearby Search for restaurants/cafes (most reliable for food)
      if (googleType === 'restaurant' || googleType === 'cafe') {
        const nearbyUrl = `${this.baseUrl}/nearbysearch/json`;
        try {
          const nearbyResponse = await axios.get(nearbyUrl, {
            params: {
              location: `${location.lat},${location.lng}`,
              radius: Math.min(radius, 5000), // Cap at 5km for nearby search
              type: googleType,
              key: this.apiKey,
              opennow: false, // Don't restrict to open places
              rankby: 'prominence' // Get popular places
            }
          });

          places = nearbyResponse.data.results || [];
          
          if (places.length > 0) {
            console.log(`[GoogleMapsClient] Found ${places.length} ${googleType}s via nearby search`);
            
            // Sort by rating and number of reviews
            places.sort((a: any, b: any) => {
              const scoreA = (a.rating || 0) * Math.log((a.user_ratings_total || 1) + 1);
              const scoreB = (b.rating || 0) * Math.log((b.user_ratings_total || 1) + 1);
              return scoreB - scoreA;
            });
            
            return this.formatPlaces(places, category || 'venue', limit);
          }
        } catch (nearbyError) {
          console.log('[GoogleMapsClient] Nearby search failed, trying text search');
        }
      }

      // Strategy 2: Text Search with location bias
      if (places.length === 0) {
        const textSearchUrl = `${this.baseUrl}/textsearch/json`;
        const textResponse = await axios.get(textSearchUrl, {
          params: {
            query: `${searchQuery} ${this.getAreaName(location)}`,
            location: `${location.lat},${location.lng}`,
            radius: radius,
            type: googleType,
            key: this.apiKey
          }
        });

        places = textResponse.data.results || [];
        
        if (places.length > 0) {
          console.log(`[GoogleMapsClient] Found ${places.length} places via text search`);
          return this.formatPlaces(places, category || 'venue', limit);
        }
      }

      // Strategy 3: Broader search without type restriction
      if (places.length === 0) {
        console.log(`[GoogleMapsClient] No results with type restriction, trying broader search`);
        
        const textSearchUrl = `${this.baseUrl}/textsearch/json`;
        const finalResponse = await axios.get(textSearchUrl, {
          params: {
            query: `${searchQuery} near ${this.getAreaName(location)} New York`,
            key: this.apiKey
          }
        });
        
        places = finalResponse.data.results || [];
        
        // Filter to nearby results only
        if (places.length > 0) {
          const nearbyPlaces = places.filter((place: any) => {
            if (!place.geometry?.location) return false;
            const distance = this.calculateDistance(
              location,
              { lat: place.geometry.location.lat, lng: place.geometry.location.lng }
            );
            return distance < (radius * 2) / 1000; // Allow 2x radius for broader search
          });
          
          if (nearbyPlaces.length > 0) {
            console.log(`[GoogleMapsClient] Found ${nearbyPlaces.length} places in broader search`);
            return this.formatPlaces(nearbyPlaces, category || 'venue', limit);
          }
        }
      }

      // Strategy 4: For specific landmarks, search without location constraint
      if (places.length === 0 && category === 'landmark') {
        console.log(`[GoogleMapsClient] Searching for landmark without location constraint`);
        
        const textSearchUrl = `${this.baseUrl}/textsearch/json`;
        const landmarkResponse = await axios.get(textSearchUrl, {
          params: {
            query: searchQuery,
            key: this.apiKey
          }
        });
        
        places = landmarkResponse.data.results || [];
        
        if (places.length > 0) {
          console.log(`[GoogleMapsClient] Found ${places.length} landmarks`);
          return this.formatPlaces(places.slice(0, 1), category, 1); // Return just the top match
        }
      }

      console.log('[GoogleMapsClient] No venues found after all strategies');
      return [];
      
    } catch (error: any) {
      console.error('[GoogleMapsClient] Search error:', error.response?.data?.error_message || error.message);
      return [];
    }
  }

  async getVenueDetails(placeId: string): Promise<string | null> {
    try {
      const detailsUrl = `${this.baseUrl}/details/json`;
      const response = await axios.get(detailsUrl, {
        params: {
          place_id: placeId,
          fields: 'editorial_summary,formatted_phone_number,opening_hours,website,price_level',
          key: this.apiKey
        }
      });

      const result = response.data.result;
      if (result?.editorial_summary?.overview) {
        return result.editorial_summary.overview;
      }
      
      // Fallback description
      if (result?.opening_hours?.weekday_text) {
        return `Open ${result.opening_hours.weekday_text[0]}. ${result.website ? `Visit: ${result.website}` : ''}`;
      }
      
      return null;
    } catch (error) {
      console.error('[GoogleMapsClient] Details error:', error);
      return null;
    }
  }

  private formatPlaces(places: any[], category: string, limit: number): Venue[] {
    return places.slice(0, limit).map((place: any) => ({
      id: place.place_id,
      name: place.name,
      category: category || place.types?.[0] || 'venue',
      location: {
        lat: place.geometry?.location?.lat,
        lng: place.geometry?.location?.lng
      },
      address: place.formatted_address || place.vicinity || 'Address not available',
      rating: place.rating,
      priceLevel: place.price_level,
      userRatingsTotal: place.user_ratings_total,
      businessStatus: place.business_status,
      openNow: place.opening_hours?.open_now,
      photos: place.photos?.map((p: any) => p.photo_reference)
    }));
  }

  private getAreaName(location: { lat: number, lng: number }): string {
    // Map coordinates to area names for better search
    if (Math.abs(location.lat - 40.7074) < 0.01 && Math.abs(location.lng - (-74.0113)) < 0.01) {
      return 'Wall Street Financial District';
    }
    if (Math.abs(location.lat - 40.7536) < 0.01 && Math.abs(location.lng - (-73.9832)) < 0.01) {
      return 'Bryant Park Midtown';
    }
    if (Math.abs(location.lat - 40.7580) < 0.01 && Math.abs(location.lng - (-73.9855)) < 0.01) {
      return 'Times Square';
    }
    if (Math.abs(location.lat - 40.7614) < 0.01 && Math.abs(location.lng - (-73.9776)) < 0.01) {
      return 'Rockefeller Center';
    }
    if (Math.abs(location.lat - 40.7829) < 0.01 && Math.abs(location.lng - (-73.9654)) < 0.01) {
      return 'Central Park';
    }
    return 'Manhattan';
  }

  private calculateDistance(loc1: { lat: number, lng: number }, loc2: { lat: number, lng: number }): number {
    const R = 6371; // Earth's radius in km
    const dLat = (loc2.lat - loc1.lat) * Math.PI / 180;
    const dLon = (loc2.lng - loc1.lng) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(loc1.lat * Math.PI / 180) * Math.cos(loc2.lat * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // Distance in km
  }
}

// export class TicketmasterClient {
//   private apiKey: string;
//   private baseUrl = 'https://app.ticketmaster.com/discovery/v2';

//   constructor(apiKey: string) {
//     this.apiKey = apiKey;
//   }

//  async searchEvents(params: EventSearchParams): Promise<Event[]> {
//   const { location, radiusKm = 5, keywords = [], timeWindow, limit = 10 } = params;

//   try {
//     const url = `${this.baseUrl}/events.json`;
    
//     const searchParams: any = {
//       apikey: this.apiKey,
//       latlong: `${location.lat},${location.lng}`,
//       radius: Math.min(Math.round(radiusKm), 100),
//       unit: 'km',
//       size: limit,
//       sort: 'date,asc',
//       includeSpellcheck: 'yes'
//     };

//     // Add keywords if provided
//     if (keywords.length > 0) {
//       searchParams.keyword = keywords.join(' ');
//     }

//     // Add time window if provided, otherwise default to next 7 days
//     if (timeWindow) {
//       searchParams.startDateTime = this.formatDateTime(timeWindow.start);
//       searchParams.endDateTime = this.formatDateTime(timeWindow.end);
//     } else {
//       // Default to next 7 days
//       const now = new Date();
//       const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
//       searchParams.startDateTime = this.formatDateTime(now);
//       searchParams.endDateTime = this.formatDateTime(nextWeek);
//     }

//     console.log(`[TicketmasterClient] Time window: ${searchParams.startDateTime} to ${searchParams.endDateTime}`);
//       console.log('[TicketmasterClient] Searching events:', searchParams);

//       const response = await axios.get(url, { params: searchParams });
      
//       if (!response.data._embedded?.events) {
//         console.log('[TicketmasterClient] No events found');
//         return [];
//       }

//       const events = response.data._embedded.events;
//       console.log(`[TicketmasterClient] Found ${events.length} events`);

//       return events.map((event: any) => {
//         const venue = event._embedded?.venues?.[0] || {};
//         const priceRanges = event.priceRanges?.[0];
        
//         let price = 'Check website';
//         if (priceRanges) {
//           const min = priceRanges.min;
//           const max = priceRanges.max;
//           const currency = priceRanges.currency || 'USD';
//           if (min && max && min !== max) {
//             price = `$${min}-$${max}`;
//           } else if (min) {
//             price = `$${min}`;
//           }
//         }

//         // Get event classification
//         const classification = event.classifications?.[0];
//         const eventType = [
//           classification?.segment?.name,
//           classification?.genre?.name,
//           classification?.subGenre?.name
//         ].filter(Boolean).join(' - ') || 'Event';

//         return {
//           id: event.id,
//           name: event.name,
//           eventType,
//           location: {
//             lat: parseFloat(venue.location?.latitude || location.lat),
//             lng: parseFloat(venue.location?.longitude || location.lng)
//           },
//           venueName: venue.name || 'Venue TBA',
//           startDate: event.dates?.start?.dateTime || event.dates?.start?.localDate,
//           endDate: event.dates?.end?.dateTime,
//           price,
//           url: event.url,
//           imageUrl: event.images?.[0]?.url,
//           isAvailable: event.dates?.status?.code !== 'offsale' && event.dates?.status?.code !== 'cancelled',
//           description: event.info || event.pleaseNote || `${eventType} at ${venue.name}`,
//           isEvent: true
//         };
//       });
      
//     } catch (error: any) {
//       console.error('[TicketmasterClient] Search error:', error.response?.data || error.message);
//       return [];
//     }
//   }

//   private formatDateTime(date: Date): string {
//     // Format as ISO 8601 without milliseconds: YYYY-MM-DDTHH:mm:ssZ
//     return date.toISOString().split('.')[0] + 'Z';
//   }
// }

export class TicketmasterClient {
  private apiKey: string;
  private baseUrl = 'https://app.ticketmaster.com/discovery/v2';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Term precedence for a single search attempt:
   *   1) params.keyword (string)
   *   2) params.keywords[0] (first element)
   *   3) params.query (string)
   */
  private pickKeyword(params: EventSearchParams): string {
    const s1 = (params as any).keyword?.toString()?.trim();
    if (s1) return s1;

    const arr = (params as any).keywords;
    if (Array.isArray(arr) && arr.length > 0) {
      const first = (arr[0] ?? '').toString().trim();
      if (first) return first;
    }

    const s3 = (params as any).query?.toString()?.trim();
    if (s3) return s3;

    return ''; // empty → omit from request
  }

  private buildPriceString(priceRanges?: { min?: number; max?: number; currency?: string }): string {
    if (!priceRanges) return 'Check website';
    const { min, max, currency = 'USD' } = priceRanges;

    const fmt = (n: number) => {
      try { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n); }
      catch { return String(Math.round(n)); }
    };

    if (typeof min === 'number' && typeof max === 'number' && min !== max) {
      return `${currency} ${fmt(min)}-${fmt(max)}`;
    }
    if (typeof min === 'number') return `${currency} ${fmt(min)}`;
    if (typeof max === 'number') return `${currency} ${fmt(max)}`;
    return 'Check website';
  }

  /** Format as ISO 8601 without milliseconds: YYYY-MM-DDTHH:mm:ssZ */
  private formatDateTime(date: Date): string {
    return date.toISOString().split('.')[0] + 'Z';
  }

  async searchEvents(params: EventSearchParams): Promise<Event[]> {
    const {
      location,
      radiusKm = 5,
      timeWindow,
      limit = 10
    } = params;

    // Compute the term for *this* attempt
    const keywordTerm = this.pickKeyword(params);

    try {
      const url = `${this.baseUrl}/events.json`;

      // Build request params
      const req: any = {
        apikey: this.apiKey,
        latlong: `${location.lat},${location.lng}`,
        radius: Math.max(1, Math.min(Math.round(radiusKm), 100)),
        unit: 'km',
        size: Math.max(1, Math.min(limit, 50)),
        sort: 'date,asc',
        includeSpellcheck: 'yes'
      };

      if (keywordTerm) {
        req.keyword = keywordTerm;
      }

      // Time window: use provided or default to next 7 days
      if (timeWindow && timeWindow.start && timeWindow.end) {
        req.startDateTime = this.formatDateTime(timeWindow.start);
        req.endDateTime = this.formatDateTime(timeWindow.end);
      } else {
        const now = new Date();
        const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        req.startDateTime = this.formatDateTime(now);
        req.endDateTime = this.formatDateTime(nextWeek);
      }

      console.log(`[TicketmasterClient] Time window: ${req.startDateTime} to ${req.endDateTime}`);
      console.log('[TicketmasterClient] Searching events:', req);

      const response = await axios.get(url, { params: req });
      const events = response.data?._embedded?.events;
      if (!events || !Array.isArray(events) || events.length === 0) {
        console.log('[TicketmasterClient] No events found');
        return [];
      }

      console.log(`[TicketmasterClient] Found ${events.length} events`);

      return events.map((event: any) => {
        const venue = event?._embedded?.venues?.[0] ?? {};
        const priceRanges = event?.priceRanges?.[0];

        // Classification → eventType
        const classification = event?.classifications?.[0];
        const eventType =
          [
            classification?.segment?.name,
            classification?.genre?.name,
            classification?.subGenre?.name
          ]
            .filter(Boolean)
            .join(' - ') || 'Event';

        // Exact coordinates from TM venue (no fallback to center, so pins are “real”)
        const lat = (venue?.location?.latitude != null)
          ? parseFloat(venue.location.latitude)
          : undefined;
        const lng = (venue?.location?.longitude != null)
          ? parseFloat(venue.location.longitude)
          : undefined;

        return {
          id: event.id,
          name: event.name,
          eventType,
          // keep both shapes for map compatibility
          location: (lat != null && lng != null) ? { lat, lng } : undefined,
          lat,  // top-level for MapView
          lng,  // top-level for MapView
          venueName: venue.name || 'Venue TBA',
          startDate: event?.dates?.start?.dateTime || event?.dates?.start?.localDate,
          endDate: event?.dates?.end?.dateTime,
          price: this.buildPriceString(priceRanges),
          url: event.url,
          imageUrl: event?.images?.[0]?.url,
          isAvailable:
            event?.dates?.status?.code !== 'offsale' &&
            event?.dates?.status?.code !== 'cancelled',
          description:
            event?.info || event?.pleaseNote || `${eventType}${venue?.name ? ` at ${venue.name}` : ''}`,
          isEvent: true
        } as Event;
      });
    } catch (error: any) {
      const payload = error?.response?.data || error?.message || String(error);
      console.error('[TicketmasterClient] Search error:', payload);
      return [];
    }
  }

}