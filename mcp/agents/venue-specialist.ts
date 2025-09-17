// mcp/agents/venue-specialist.ts - FIXED VERSION
import { BaseAgent } from './base-agent.js';
import { AgentMessage, Venue, VenueSearchParams } from '../lib/types.js';
import { GoogleMapsClient } from '../lib/api-clients.js';

export class VenueSpecialistAgent extends BaseAgent {
  private googleClient: GoogleMapsClient;
  private usedVenueIds: Set<string> = new Set(); // Track used venues

  constructor(openaiApiKey: string, googleApiKey: string) {
    super('VenueSpecialist', openaiApiKey);
    this.googleClient = new GoogleMapsClient(googleApiKey);
  }

  async process(message: AgentMessage): Promise<Venue[]> {
    const searchParams = message.payload as VenueSearchParams;
    
    // For "local" searches, use smaller radius
    const isLocalSearch = this.context?.currentPlan?.searchStrategy?.type === 'minimal' ||
                         this.context?.constraints?.original_prompt?.toLowerCase().includes('local') ||
                         this.context?.constraints?.original_prompt?.toLowerCase().includes('nearby');
    
    if (isLocalSearch && !searchParams.radius) {
      searchParams.radius = 1000; // 1km for local searches instead of default 5km
    }
    
    this.log('Searching venues:', searchParams);

    // Search Google Places
    let venues = await this.googleClient.searchVenues(searchParams);
    
    if (venues.length === 0) {
      this.log('No venues found from Google Places');
      return [];
    }
    
    // FILTER OUT ALREADY USED VENUES
    const previouslySelectedVenues = this.context?.selectedVenues || [];
    const previousIds = new Set(previouslySelectedVenues.map(v => v.id));
    
    // Filter out duplicates
    venues = venues.filter(v => {
      // Check if venue was already selected
      if (previousIds.has(v.id) || this.usedVenueIds.has(v.id)) {
        this.log(`Filtering out duplicate venue: ${v.name}`);
        return false;
      }
      
      // Check if venue name is too similar to already selected venues
      const similarName = previouslySelectedVenues.some(selected => 
        selected.name.toLowerCase() === v.name.toLowerCase() ||
        selected.name.includes(v.name) || 
        v.name.includes(selected.name)
      );
      
      if (similarName) {
        this.log(`Filtering out venue with similar name: ${v.name}`);
        return false;
      }
      
      return true;
    });
    
    // If all venues were filtered out, try expanding search radius
    if (venues.length === 0 && searchParams.radius) {
      this.log('All venues were duplicates, expanding search radius');
      const expandedParams = {
        ...searchParams,
        radius: searchParams.radius * 2
      };
      venues = await this.googleClient.searchVenues(expandedParams);
      
      // Filter duplicates again
      venues = venues.filter(v => 
        !previousIds.has(v.id) && 
        !this.usedVenueIds.has(v.id)
      );
    }
    
    // Score and rank venues
    const scoredVenues = await this.scoreVenues(venues, searchParams);
    
    // Get descriptions for top venues
    const enrichedVenues = await this.enrichVenues(scoredVenues.slice(0, 5));
    
    // Mark the first venue as used (the one that will be selected)
    if (enrichedVenues.length > 0) {
      this.usedVenueIds.add(enrichedVenues[0].id);
      
      // Also track in context if available
      if (this.context) {
        if (!this.context.selectedVenues) {
          this.context.selectedVenues = [];
        }
        this.context.selectedVenues.push(enrichedVenues[0]);
      }
    }
    
    this.log(`Found ${enrichedVenues.length} unique venues`);
    
    return enrichedVenues;
  }

  private async scoreVenues(venues: Venue[], params: VenueSearchParams): Promise<Venue[]> {
    if (!this.context || venues.length === 0) return venues;

    try {
      const systemPrompt = `Score venues based on:
      1. Relevance to search query
      2. Ratings and popularity
      3. Distance from search location
      4. Variety (avoid duplicates if multiple venues already selected)
      5. Match to trip vibe
      
      Current context:
      - Trip vibe: ${this.context.currentPlan?.vibe || 'general'}
      - Already selected: ${this.context.selectedVenues?.map(v => v.name).join(', ') || 'none'}
      
      IMPORTANT: Prioritize variety - if venues with similar names exist, score them lower.
      
      Return a JSON array with venue scores:
      [{"venue_id": "id", "score": 0.85, "reason": "why"}]
      
      IMPORTANT: Return ONLY a JSON array, nothing else.`;

      const venueData = venues.map(v => ({
        id: v.id,
        name: v.name,
        category: v.category,
        rating: v.rating || 0,
        distance: this.calculateDistance(params.location, v.location)
      }));

      const gptResponse = await this.callGPT(systemPrompt, JSON.stringify(venueData));
      
      // Ensure we have an array
      let scores: any[] = [];
      if (Array.isArray(gptResponse)) {
        scores = gptResponse;
      } else if (gptResponse && typeof gptResponse === 'object') {
        // If it's an object with a property containing the array
        if (gptResponse.scores && Array.isArray(gptResponse.scores)) {
          scores = gptResponse.scores;
        } else if (gptResponse.venues && Array.isArray(gptResponse.venues)) {
          scores = gptResponse.venues;
        } else {
          // Try to extract array from object values
          const values = Object.values(gptResponse);
          const arrayValue = values.find(v => Array.isArray(v));
          if (arrayValue) {
            scores = arrayValue as any[];
          }
        }
      }
      
      // If we still don't have valid scores, create default ones
      if (!Array.isArray(scores) || scores.length === 0) {
        this.log('Invalid or empty scores from GPT, using distance-based scoring');
        scores = venues.map(v => ({
          venue_id: v.id,
          score: (v.rating || 3) / 5 * 0.7 + 0.3, // Simple default scoring
          reason: 'Default scoring based on rating'
        }));
      }
      
      // Apply scores to venues
      return venues
        .map(v => {
          const scoreData = scores.find((s: any) => s.venue_id === v.id);
          return { 
            ...v, 
            score: scoreData?.score || 0.5 
          };
        })
        .sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
        
    } catch (error) {
      this.log('Error scoring venues, using fallback:', error);
      // Fallback scoring based on rating and reviews
      return venues
        .map(v => ({
          ...v,
          score: ((v.rating || 3) / 5) * 0.7 + Math.min((v.userRatingsTotal || 0) / 1000, 0.3)
        }))
        .sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
    }
  }

  private async enrichVenues(venues: Venue[]): Promise<Venue[]> {
    const enriched = [];
    
    for (const venue of venues) {
      try {
        const description = await this.googleClient.getVenueDetails(venue.id);
        enriched.push({
          ...venue,
          description: description || `Popular ${venue.category} in the area`
        });
      } catch (error) {
        this.log(`Failed to enrich venue ${venue.name}:`, error);
        enriched.push({
          ...venue,
          description: `${venue.rating ? 'Highly-rated' : 'Local'} ${venue.category}`
        });
      }
    }
    
    return enriched;
  }

  private calculateDistance(loc1: any, loc2: any): number {
    if (!loc1 || !loc2) return 0;
    
    const R = 6371;
    const dLat = (loc2.lat - loc1.lat) * Math.PI / 180;
    const dLon = (loc2.lng - loc1.lng) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(loc1.lat * Math.PI / 180) * Math.cos(loc2.lat * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }
}