// mcp/orchestration/coordinator.ts - FIXED FOR LOCAL SEARCHES
import { IntentAnalyzerAgent } from '../agents/intent-analyzer.js';
import { MasterPlannerAgent } from '../agents/master-planner.js';
import { VenueSpecialistAgent } from '../agents/venue-specialist.js';
import { EventSpecialistAgent } from '../agents/event-specialist.js';
import { RouteOptimizerAgent } from '../agents/route-optimizer.js';
import { QualityControllerAgent } from '../agents/quality-controller.js';
import { AgentContext, AgentMessage } from '../lib/types.js';
import { v4 as uuidv4 } from 'uuid';

export class AgentCoordinator {
  private agents: Map<string, any>;
  private sessions: Map<string, AgentContext>;

  constructor(config: {
    openaiApiKey: string;
    googleApiKey: string;
    ticketmasterApiKey: string;
  }) {
    this.agents = new Map();
    this.sessions = new Map();

    // Initialize all agents
    this.agents.set('intent', new IntentAnalyzerAgent(config.openaiApiKey));
    this.agents.set('planner', new MasterPlannerAgent(config.openaiApiKey));
    this.agents.set('venue', new VenueSpecialistAgent(config.openaiApiKey, config.googleApiKey));
    this.agents.set('event', new EventSpecialistAgent(config.openaiApiKey, config.ticketmasterApiKey));
    this.agents.set('route', new RouteOptimizerAgent(config.openaiApiKey));
    this.agents.set('quality', new QualityControllerAgent(config.openaiApiKey));
  }

  async processItinerary(prompt: string, location: any): Promise<any> {
    const sessionId = uuidv4();
    console.log(`[Coordinator] Starting session ${sessionId}`);

    try {
      // Step 1: Analyze Intent
      const intent = await this.callAgent('intent', {
        prompt,
        location
      }, sessionId);
      
      if (!intent.user_location) {
        intent.user_location = location;
      }

      // Create session context
      const context: AgentContext = {
        sessionId,
        userPrompt: prompt,
        location,
        durationType: intent.duration_type,
        constraints: intent,
        selectedVenues: [],
        selectedEvents: []
      };
      this.sessions.set(sessionId, context);

      // Step 2: Create Master Plan
      const plan = await this.callAgent('planner', intent, sessionId);
      context.currentPlan = plan;
      
      // Log if this is a local search
      if (plan.isLocalSearch) {
        console.log('[Coordinator] LOCAL SEARCH MODE - Enforcing 3km constraint');
        console.log(`[Coordinator] Search radius: ${plan.searchStrategy?.searchRadius}m`);
      }

      // Step 3: Execute searches with local constraints
      const searchResults = await this.executeSearches(plan, context);

      // Step 4: Optimize Route
      const optimizedRoute = await this.callAgent('route', {
        venues: searchResults.venues,
        events: searchResults.events,
        allStops: searchResults.allStops,
        preserveOrder: plan.searchStrategy.type === 'minimal' || intent.sequence_matters,
        isLocalSearch: plan.isLocalSearch
      }, sessionId);

      // Step 5: Quality Control with distance validation for local searches
      const qualityResult = await this.callAgent('quality', {
        ...plan,
        ...optimizedRoute,
        durationType: context.durationType,
        noEventsFound: searchResults.noEventsFound,
        isLocalSearch: plan.isLocalSearch,
        maxAllowedDistance: plan.isLocalSearch ? 3 : 10 // 3km for local, 10km otherwise
      }, sessionId);

      // Add note about events if none were found but were requested
      if (searchResults.noEventsFound && qualityResult.itinerary) {
        qualityResult.itinerary.eventNote = "No events found for the requested time period and location.";
      }
      
      // Add local search indicator to response
      if (plan.isLocalSearch && qualityResult.itinerary) {
        qualityResult.itinerary.isLocalSearch = true;
        qualityResult.itinerary.searchRadius = plan.searchStrategy?.searchRadius || 1500;
      }

      // Clean up session
      this.sessions.delete(sessionId);

      return {
        success: true,
        itinerary: qualityResult.itinerary,
        qualityScore: qualityResult.qualityScore,
        issues: qualityResult.issues,
        noEventsFound: searchResults.noEventsFound,
        isLocalSearch: plan.isLocalSearch
      };

    } catch (error) {
      console.error(`[Coordinator] Session ${sessionId} failed:`, error);
      this.sessions.delete(sessionId);
      throw error;
    }
  }

  private async callAgent(agentName: string, payload: any, sessionId: string): Promise<any> {
    const agent = this.agents.get(agentName);
    if (!agent) {
      throw new Error(`Agent ${agentName} not found`);
    }

    const context = this.sessions.get(sessionId);
    if (context) {
      agent.setContext(context);
    }

    const message: AgentMessage = {
      fromAgent: 'coordinator',
      toAgent: agentName,
      action: 'process',
      payload,
      sessionId,
      timestamp: new Date()
    };

    console.log(`[Coordinator] Calling ${agentName} agent`);
    return await agent.process(message);
  }

  private async executeSearches(plan: any, context: AgentContext): Promise<any> {
    const allStops: any[] = [];
    let eventSearchAttempted = false;
    let noEventsFound = false;
    const existingEventIds = new Set<string>();
    
    // For local searches, use tighter radius for nearby events
    const NEARBY_EVENT_RADIUS_KM = plan.isLocalSearch ? 1.5 : 2; // 1.5km for local, 2km otherwise
    
    // For local searches, override individual search radii
    const venueSearchRadius = plan.isLocalSearch ? 
      Math.min(plan.searchStrategy?.searchRadius || 1500, 1500) : // Cap at 1.5km for local
      (plan.searchStrategy?.searchRadius || 2000);

    for (const point of plan.searchPoints) {
      console.log(`[Coordinator] Processing stop ${point.stopNumber}: ${point.query} (${point.type})`);
      
      // For local searches, validate that this point is within bounds
      if (plan.isLocalSearch && context.location) {
        const distance = this.calculateDistance(context.location, point.location);
        if (distance > 1.5) {
          console.log(`[Coordinator] WARNING: Stop ${point.stopNumber} is ${distance.toFixed(2)}km from center (max 1.5km for local)`)          ;
          // Adjust location to be within bounds
          const angle = Math.atan2(
            point.location.lng - context.location.lng,
            point.location.lat - context.location.lat
          );
          const maxOffset = 0.0135; // ~1.5km in degrees
          point.location = {
            lat: context.location.lat + maxOffset * Math.sin(angle),
            lng: context.location.lng + maxOffset * Math.cos(angle)
          };
          console.log(`[Coordinator] Adjusted stop location to be within 1.5km`);
        }
      }
      
      if (point.type === 'venue') {
        try {
          const venueResults = await this.callAgent('venue', {
            query: point.query,
            location: point.location,
            category: point.category,
            radius: point.searchRadius || venueSearchRadius, // Use local-aware radius
            limit: 3,
            isLocalSearch: plan.isLocalSearch
          }, context.sessionId);

          if (venueResults && venueResults.length > 0) {
            const selected = venueResults[0];
            
            // For local searches, verify venue is within bounds
            if (plan.isLocalSearch && context.location) {
              const venueDistance = this.calculateDistance(context.location, selected.location);
              if (venueDistance > 2) { // Give a bit more leeway for actual venues (2km)
                console.log(`[Coordinator] Venue "${selected.name}" is ${venueDistance.toFixed(2)}km away, looking for closer alternative`);
                // Try to find a closer venue from the results
                const closerVenue = venueResults.find((v: any) => 
                  this.calculateDistance(context.location, v.location) < 2
                );
                if (closerVenue) {
                  selected.location = closerVenue.location;
                  selected.name = closerVenue.name;
                  console.log(`[Coordinator] Using closer venue: ${closerVenue.name}`);
                }
              }
            }
            
            selected.purpose = point.purpose;
            selected.order = point.stopNumber;
            selected.isExplicitRequest = point.isExplicitRequest;
            selected.userSpecified = true;
            selected.isEvent = false;

            // Fetch nearby events with adjusted radius for local searches
            try {
              console.log(`[Coordinator] Fetching nearby events within ${NEARBY_EVENT_RADIUS_KM}km of "${selected.name}"`);
              const nearbyEvents = await this.callAgent('event', {
                location: selected.location,
                radiusKm: NEARBY_EVENT_RADIUS_KM,
                noKeywords: true,
                limit: 5
              }, context.sessionId);

              if (Array.isArray(nearbyEvents) && nearbyEvents.length) {
                selected.nearbyEvents = nearbyEvents;
                console.log(`[Coordinator] Attached ${nearbyEvents.length} nearby events to "${selected.name}"`);
              } else {
                console.log(`[Coordinator] No nearby events found for "${selected.name}"`);
              }
            } catch (err) {
              console.warn('[Coordinator] Nearby event search failed for venue:', selected?.name, err);
            }

            allStops.push(selected);
            console.log(`[Coordinator] Found venue: ${selected.name} at stop ${point.stopNumber}`);
          } else {
            const placeholder = {
              id: `placeholder_${point.stopNumber}`,
              name: point.query,
              category: point.category || 'venue',
              location: point.location,
              address: 'Location to be determined',
              purpose: point.purpose,
              order: point.stopNumber,
              isExplicitRequest: point.isExplicitRequest,
              isPlaceholder: true,
              isEvent: false
            };
            allStops.push(placeholder);
            console.log(`[Coordinator] Created placeholder for venue: ${point.query} at stop ${point.stopNumber}`);
          }
        } catch (error) {
          console.error(`[Coordinator] Error searching venue ${point.query}:`, error);
          const placeholder = {
            id: `placeholder_${point.stopNumber}`,
            name: point.query,
            category: point.category || 'venue',
            location: point.location,
            address: 'Search failed',
            purpose: point.purpose,
            order: point.stopNumber,
            isExplicitRequest: point.isExplicitRequest,
            isPlaceholder: true,
            isEvent: false
          };
          allStops.push(placeholder);
        }

      } else if (point.type === 'event') {
        eventSearchAttempted = true;
        try {
          console.log(`[Coordinator] Searching for event at stop ${point.stopNumber}: ${point.query}`);
          
          // Use tighter radius for local searches
          const eventSearchRadius = plan.isLocalSearch ? 2 : 5; // 2km for local, 5km otherwise

          const eventResults = await this.callAgent('event', {
            location: point.location,
            radiusKm: eventSearchRadius,
            keywords: point.event_keywords?.length ? point.event_keywords : (point.query ? [point.query] : []),
            query: point.query || undefined,
            limit: 5
          }, context.sessionId);

          if (eventResults && eventResults.length > 0) {
            // Find first non-duplicate event
            let selected = null;
            for (const event of eventResults) {
              if (!existingEventIds.has(event.id)) {
                // For local searches, verify event is within bounds
                if (plan.isLocalSearch && context.location && event.location) {
                  const eventDistance = this.calculateDistance(context.location, event.location);
                  if (eventDistance > 3) { // 3km max for events in local search
                    console.log(`[Coordinator] Event "${event.name}" is ${eventDistance.toFixed(2)}km away, skipping`);
                    continue;
                  }
                }
                selected = event;
                existingEventIds.add(event.id);
                break;
              }
            }
            
            if (selected) {
              selected.purpose = point.purpose;
              selected.order = point.stopNumber;
              selected.isExplicitRequest = point.isExplicitRequest;
              selected.userSpecified = true;
              selected.isEvent = true;
              allStops.push(selected);
              console.log(`[Coordinator] Found event: ${selected.name} at stop ${point.stopNumber}`);
            } else {
              console.log(`[Coordinator] All events are duplicates or too far for stop ${point.stopNumber}`);
            }
          } else {
            console.log(`[Coordinator] No events found at stop ${point.stopNumber}`);
            noEventsFound = true;
          }
        } catch (error) {
          console.error(`[Coordinator] Error searching events:`, error);
          noEventsFound = true;
        }
      }
    }

    // Re-sort and renumber
    allStops.sort((a, b) => (a.order || 0) - (b.order || 0));
    allStops.forEach((stop, index) => { 
      stop.order = index + 1; 
    });

    // For local searches, do final validation
    if (plan.isLocalSearch && context.location) {
      console.log('[Coordinator] Final distance validation for local search:');
      let maxDistance = 0;
      allStops.forEach(stop => {
        const distance = this.calculateDistance(context.location, stop.location);
        maxDistance = Math.max(maxDistance, distance);
        console.log(`  ${stop.order}: ${stop.name} - ${distance.toFixed(2)}km from center`);
      });
      
      if (maxDistance > 3) {
        console.log(`[Coordinator] WARNING: Maximum distance is ${maxDistance.toFixed(2)}km (should be ≤3km for local)`);
      } else {
        console.log(`[Coordinator] ✓ All stops within 3km (max: ${maxDistance.toFixed(2)}km)`);
      }
    }

    const venues = allStops.filter(s => !s.isEvent);
    const events = allStops.filter(s => s.isEvent);

    return {
      venues,
      events,
      allStops,
      stops: allStops,
      noEventsFound: eventSearchAttempted && noEventsFound,
      isLocalSearch: plan.isLocalSearch
    };
  }

  private calculateDistance(loc1: any, loc2: any): number {
    if (!loc1 || !loc2) return 0;
    
    const R = 6371; // Earth's radius in km
    const dLat = (loc2.lat - loc1.lat) * Math.PI / 180;
    const dLon = (loc2.lng - loc1.lng) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(loc1.lat * Math.PI / 180) * Math.cos(loc2.lat * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // Distance in km
  }
}