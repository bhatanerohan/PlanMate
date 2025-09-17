// mcp/agents/master-planner.ts - FIXED LOCATION SPACING
import { BaseAgent } from './base-agent.js';
import { AgentMessage, ItineraryPlan, SearchStrategy } from '../lib/types.js';

export class MasterPlannerAgent extends BaseAgent {
  constructor(openaiApiKey: string) {
    super('MasterPlanner', openaiApiKey);
  }

  async process(message: AgentMessage): Promise<ItineraryPlan> {
    const intent = message.payload;
    
    this.log('Creating master plan for duration:', intent.duration_type);
    this.log('User location:', intent.user_location);

    const systemPrompt = this.buildSystemPrompt(intent.duration_type);
    
    // Include user location explicitly in the prompt
    const userPrompt = JSON.stringify({
      ...intent,
      user_current_location: intent.user_location || { lat: 40.7580, lng: -73.9855 },
      instruction: "Use user_current_location for all stops unless specific locations are mentioned"
    });
    
    const plan = await this.callGPT(systemPrompt, userPrompt);
    
    // Adapt plan based on duration
    const adaptedPlan = this.adaptPlanToDuration(plan, intent);
    
    // Ensure nearby locations for local searches
    const localizedPlan = this.ensureNearbyLocations(adaptedPlan, intent);
    
    // FIX: Spread out locations for running routes
    const spacedPlan = this.ensureProperSpacing(localizedPlan, intent);
    
    this.log('Master plan created:', spacedPlan);
    
    return spacedPlan;
  }

  private buildSystemPrompt(durationType: string): string {
    const basePrompt = `You are a master travel planner creating itineraries for New York City.
    Create a detailed plan based on the user's intent analysis.
    
    CRITICAL RULES:
    1. If user asks for "local", "nearby", "around here", "best spots" without specific locations, use their CURRENT LOCATION (user_current_location) for ALL search points
    2. Don't spread stops across different neighborhoods unless user specifically mentions multiple areas
    3. For general requests like "best spots for date", keep everything within 2km of user_current_location
    4. Only use different locations if user mentions specific places (e.g., "Times Square then Brooklyn")
    5. If user ONLY asks for events/concerts, create ONLY event search points, no venues
    6. Don't add tourist venues unless explicitly requested
    7. For RUNNING ROUTES: Space stops at least 1km apart to create an actual route
    8. For BROOKLYN requests: Use actual Brooklyn coordinates (40.678, -73.944) not Manhattan`;
    
    const durationSpecific = {
      few_hours: `
      For SHORT TRIPS (1-4 hours):
      - Maximum 3 stops
      - Keep within 1-2km radius of user_current_location (unless running route)
      - For running routes: space stops 0.5-1.5km apart
      - Include events ONLY if explicitly requested or perfect timing
      - Quick, efficient experiences
      - Consider current time of day heavily`,
      
      full_day: `
      For FULL DAY trips (5-12 hours):
      - 4-6 major stops
      - Mix of activities, food, and possibly events
      - Consider meal times (breakfast, lunch, dinner)
      - Balance active and restful activities
      - Include both must-see and hidden gems
      - Keep stops within reasonable walking distance of each other`,
      
      multi_day: `
      For MULTI-DAY trips (2+ days):
      - 3-5 stops per day maximum
      - Group by neighborhood/area per day
      - Avoid repetition across days
      - Include variety of experiences
      - Consider energy levels (don't pack every day full)
      - Strategic event placement as day anchors`
    };

    return `${basePrompt}
    
    ${durationSpecific[durationType as keyof typeof durationSpecific]}
    
    IMPORTANT: 
    - When user_current_location is provided, use it as the base for all search points unless user explicitly mentions other locations
    - For RUNNING/JOGGING routes: Create a loop or path by spacing stops appropriately
    - If user mentions BROOKLYN, use Brooklyn coordinates (around 40.678, -73.944) not Manhattan
    
    Return JSON structure:
    {
      "title": "Catchy descriptive title",
      "description": "Brief overview",
      "duration": "actual duration string",
      "durationType": "${durationType}",
      "vibe": "adventure|relaxed|cultural|foodie|mixed",
      "numberOfStops": number,
      "searchStrategy": {
        "type": "minimal|balanced|comprehensive",
        "includeEvents": boolean,
        "searchRadius": number (meters),
        "maxStops": number,
        "priorityMode": "event_first|venue_first|mixed"
      },
      "searchPoints": [
        {
          "stopNumber": number,
          "type": "venue|event",
          "query": "search query",
          "category": "category",
          "location": {"lat": number, "lng": number},
          "purpose": "why this stop",
          "estimatedDuration": number (minutes),
          "isExplicitRequest": boolean,
          "dayNumber": number (for multi-day)
        }
      ]
    }`;
  }

  private adaptPlanToDuration(plan: any, intent: any): ItineraryPlan {
    const adapted = { ...plan };
    
    // If user ONLY wants events, filter out all venues
    if (intent.event_interest && !intent.explicit_venues?.length && !intent.venue_categories?.length) {
      adapted.searchPoints = adapted.searchPoints.filter((p: any) => p.type === 'event');
      adapted.numberOfStops = adapted.searchPoints.length;
      console.log('[MasterPlanner] Event-only request detected, removed venue stops');
    }

    if (intent.duration_type === 'few_hours') {
      // Simplify for short trips
      adapted.searchPoints = adapted.searchPoints.slice(0, 3);
      adapted.numberOfStops = Math.min(3, adapted.numberOfStops);
      
      // Only include events if user showed interest
      if (!intent.event_interest && !intent.event_keywords?.length) {
        adapted.searchPoints = adapted.searchPoints.filter((p: any) => p.type !== 'event');
      }
    } else if (intent.duration_type === 'multi_day') {
      // Organize into days
      const stopsPerDay = Math.ceil(adapted.searchPoints.length / intent.day_count);
      adapted.days = [];
      
      for (let i = 0; i < intent.day_count; i++) {
        const dayStops = adapted.searchPoints.slice(
          i * stopsPerDay,
          (i + 1) * stopsPerDay
        );
        
        adapted.days.push({
          dayNumber: i + 1,
          theme: this.generateDayTheme(dayStops),
          stops: dayStops
        });
      }
    }
    
    return adapted;
  }

  private ensureNearbyLocations(plan: any, intent: any): ItineraryPlan {
    const userLocation = intent.user_location || { lat: 40.7580, lng: -73.9855 };
    
    // Check if this is a local/nearby search
    const isLocalSearch = 
      intent.original_prompt?.toLowerCase().includes('local') ||
      intent.original_prompt?.toLowerCase().includes('nearby') ||
      intent.original_prompt?.toLowerCase().includes('around here') ||
      intent.original_prompt?.toLowerCase().includes('best spots') ||
      intent.original_prompt?.toLowerCase().includes('date');
    
    // Check if user specified any explicit locations
    const hasSpecificLocations = 
      intent.explicit_venues?.length > 0 || 
      intent.location_context?.locations?.length > 0 ||
      intent.location_context?.visit_locations?.length > 0;
    
    if (isLocalSearch && !hasSpecificLocations) {
      // Override all search points to use user's location with small variations
      plan.searchPoints = plan.searchPoints.map((point: any) => {
        // Add small random variation (within ~500m)
        const latVariation = (Math.random() - 0.5) * 0.009; // ~500m variation
        const lngVariation = (Math.random() - 0.5) * 0.009;
        
        return {
          ...point,
          location: {
            lat: userLocation.lat + latVariation,
            lng: userLocation.lng + lngVariation
          }
        };
      });
      
      // Also ensure search radius is appropriate for local search
      if (plan.searchStrategy) {
        plan.searchStrategy.searchRadius = 1500; // 1.5km for local searches
      }
      
      this.log('Fixed all search points to be near user location:', userLocation);
    } else if (!hasSpecificLocations) {
      // Even for non-local searches without specific locations, start from user location
      const firstPoint = plan.searchPoints?.[0];
      if (firstPoint) {
        firstPoint.location = {
          lat: userLocation.lat,
          lng: userLocation.lng
        };
      }
    }
    
    return plan;
  }

  // NEW METHOD: Ensure proper spacing for running routes
  private ensureProperSpacing(plan: any, intent: any): ItineraryPlan {
    const promptLower = intent.original_prompt?.toLowerCase() || '';
    const isRunningRoute = 
      promptLower.includes('running') || 
      promptLower.includes('jogging') || 
      promptLower.includes('run');
    
    const mentionsBrooklyn = promptLower.includes('brooklyn');
    
    if (isRunningRoute && plan.searchPoints) {
      this.log('Detected running route request - spacing out stops');
      
      // Determine base location
      let baseLat = intent.user_location?.lat || 40.7580;
      let baseLng = intent.user_location?.lng || -73.9855;
      
      // If Brooklyn is mentioned, use Brooklyn coordinates
      if (mentionsBrooklyn) {
        baseLat = 40.678; // Brooklyn
        baseLng = -73.944;
        this.log('Using Brooklyn coordinates for running route');
      }
      
      // Space out the stops to create a proper running route
      plan.searchPoints = plan.searchPoints.map((point: any, index: number) => {
        let newLat = baseLat;
        let newLng = baseLng;
        
        if (index === 0) {
          // First stop at base location
          newLat = baseLat;
          newLng = baseLng;
        } else if (index === 1) {
          // Second stop ~1km north/east
          newLat = baseLat + 0.009; // ~1km north
          newLng = baseLng + 0.006; // ~0.6km east
        } else if (index === 2) {
          // Third stop ~1km south/east (creates triangle)
          newLat = baseLat - 0.005; // ~0.5km south
          newLng = baseLng + 0.009; // ~1km east
        }
        
        return {
          ...point,
          location: {
            lat: newLat,
            lng: newLng
          },
          query: mentionsBrooklyn ? 'park brooklyn' : 'park'
        };
      });
      
      // Also increase search radius for running routes
      if (plan.searchStrategy) {
        plan.searchStrategy.searchRadius = 2000; // 2km for running routes
      }
    }
    
    return plan;
  }

  private generateDayTheme(stops: any[]): string {
    // Simple theme generation based on stop categories
    const categories = stops.map(s => s.category);
    if (categories.includes('museum')) return 'Culture & Arts';
    if (categories.includes('park')) return 'Nature & Outdoors';
    if (categories.includes('shopping')) return 'Shopping & Dining';
    if (categories.includes('event') || categories.includes('music')) return 'Entertainment & Events';
    if (categories.includes('food') || categories.includes('restaurant')) return 'Culinary Experience';
    return 'Mixed Exploration';
  }
}