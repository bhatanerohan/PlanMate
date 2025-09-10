// mcp/orchestration/coordinator.ts - FIXED VERSION (no failedSearches)
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

      // Step 3: Execute searches
      const searchResults = await this.executeSearches(plan, context);

      // Step 4: Optimize Route
      const optimizedRoute = await this.callAgent('route', {
        venues: searchResults.venues,
        events: searchResults.events,
        allStops: searchResults.allStops,
        preserveOrder: plan.searchStrategy.type === 'minimal' || intent.sequence_matters
      }, sessionId);

      // Step 5: Quality Control
      const qualityResult = await this.callAgent('quality', {
        ...plan,
        ...optimizedRoute,
        durationType: context.durationType,
        noEventsFound: searchResults.noEventsFound
      }, sessionId);

      // Add note about events if none were found but were requested
      if (searchResults.noEventsFound && qualityResult.itinerary) {
        qualityResult.itinerary.eventNote = "No events found for the requested time period and location.";
      }

      // Clean up session
      this.sessions.delete(sessionId);

      return {
        success: true,
        itinerary: qualityResult.itinerary,
        qualityScore: qualityResult.qualityScore,
        issues: qualityResult.issues,
        noEventsFound: searchResults.noEventsFound
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

  // mcp/orchestration/coordinator.ts
private async executeSearches(plan: any, context: AgentContext): Promise<any> {
  const allStops: any[] = [];
  let eventSearchAttempted = false;
  let noEventsFound = false;

  const NEARBY_EVENT_RADIUS_KM = 5; // << hardcoded 5 km

  const searchPromises = plan.searchPoints.map(async (point: any) => {
    console.log(`[Coordinator] Processing stop ${point.stopNumber}: ${point.query} (${point.type})`);

    if (point.type === 'venue') {
      try {
        const venueResults = await this.callAgent('venue', {
          query: point.query,
          location: point.location,
          category: point.category,
          radius: plan.searchStrategy.searchRadius || 2000,
          limit: 3
        }, context.sessionId);

        if (venueResults && venueResults.length > 0) {
          const selected = venueResults[0];
          selected.purpose = point.purpose;
          selected.order = point.stopNumber;
          selected.isExplicitRequest = point.isExplicitRequest;
          selected.userSpecified = true;
          selected.isEvent = false;

          // -------- NEW: fetch nearby events with NO keywords, radius 5 km --------
          try {
            console.log(`[Coordinator] Fetching nearby events (no keywords) around "${selected.name}" within ${NEARBY_EVENT_RADIUS_KM}km`);
            const nearbyEvents = await this.callAgent('event', {
              location: selected.location,   // { lat, lng }
              radiusKm: NEARBY_EVENT_RADIUS_KM,
              noKeywords: true,              // << special flag consumed by EventSpecialist
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
          // ------------------------------------------------------------------------

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

        const eventResults = await this.callAgent('event', {
          location: point.location,
          radiusKm: 5, // can keep 5 here too if you want consistency
          keywords: point.event_keywords?.length ? point.event_keywords : (point.query ? [point.query] : []),
          query: point.query || undefined,
          limit: 5
        }, context.sessionId);

        if (eventResults && eventResults.length > 0) {
          const selected = eventResults[0];
          selected.purpose = point.purpose;
          selected.order = point.stopNumber;
          selected.isExplicitRequest = point.isExplicitRequest;
          selected.userSpecified = true;
          selected.isEvent = true;
          allStops.push(selected);
          console.log(`[Coordinator] Found event: ${selected.name} at stop ${point.stopNumber}`);
        } else {
          console.log(`[Coordinator] No events found at stop ${point.stopNumber}`);
          noEventsFound = true;
        }
      } catch (error) {
        console.error(`[Coordinator] Error searching events:`, error);
        noEventsFound = true;
      }
    }
  });

  await Promise.all(searchPromises);

  allStops.sort((a, b) => (a.order || 0) - (b.order || 0));
  allStops.forEach((stop, index) => { stop.order = index + 1; });

  console.log('[Coordinator] Final order after re-numbering:');
  allStops.forEach(stop => {
    console.log(`  ${stop.order}: ${stop.name} (${stop.isEvent ? 'EVENT' : 'VENUE'}${stop.isPlaceholder ? ' - PLACEHOLDER' : ''})`);
    if (Array.isArray(stop.nearbyEvents)) {
      console.log(`    └─ nearbyEvents: ${stop.nearbyEvents.length}`);
    }
  });

  const venues = allStops.filter(s => !s.isEvent);
  const events = allStops.filter(s => s.isEvent);

  return {
    venues,
    events,
    allStops,
    stops: allStops,
    noEventsFound: eventSearchAttempted && noEventsFound
  };
}

}
