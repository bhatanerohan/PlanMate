import { BaseAgent } from './base-agent.js';
import { AgentMessage, Venue, Event, Location } from '../lib/types.js';

export class RouteOptimizerAgent extends BaseAgent {
  constructor(openaiApiKey: string) {
    super('RouteOptimizer', openaiApiKey);
  }

  // mcp/agents/route-optimizer.ts - Fix to preserve order
// mcp/agents/route-optimizer.ts - Fix to handle all stops
async process(message: AgentMessage): Promise<any> {
  // Accept multiple possible field names
  const stops = message.payload.allStops || 
                message.payload.stops || 
                [...(message.payload.venues || []), ...(message.payload.events || [])];
  
  this.log(`Optimizing route for ${stops.length} stops`);
  
  if (stops.length === 0) {
    return {
      stops: [],
      totalDistance: 0,
      totalWalkTime: 0
    };
  }
  
  // Always preserve order for explicit requests
  const orderedStops = [...stops].sort((a, b) => (a.order || 0) - (b.order || 0));
  
  this.log('Processing stops in order:');
  orderedStops.forEach(s => {
    this.log(`  ${s.order}: ${s.name}`);
  });
  
  return this.calculateRoute(orderedStops);
}
  private optimizeRoute(stops: (Venue | Event)[]): (Venue | Event)[] {
    if (stops.length <= 2) return stops;

    // For events, sort by time first
    const events = stops.filter(s => 'startDate' in s) as Event[];
    const venues = stops.filter(s => !('startDate' in s)) as Venue[];

    if (events.length > 0) {
      // Sort events by start time
      events.sort((a, b) => 
        new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
      );

      // Interleave venues between events optimally
      return this.interleaveVenuesWithEvents(venues, events);
    }

    // No events, just optimize venue order by distance
    return this.optimizeByDistance(venues);
  }

  private optimizeByDistance(stops: (Venue | Event)[]): (Venue | Event)[] {
    if (stops.length === 0) return [];
    
    const optimized = [stops[0]];
    const remaining = [...stops.slice(1)];

    while (remaining.length > 0) {
      const last = optimized[optimized.length - 1];
      let nearestIdx = 0;
      let nearestDist = Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const dist = this.calculateDistance(
          last.location,
          remaining[i].location
        );
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestIdx = i;
        }
      }

      optimized.push(remaining[nearestIdx]);
      remaining.splice(nearestIdx, 1);
    }

    return optimized;
  }

  private interleaveVenuesWithEvents(venues: Venue[], events: Event[]): (Venue | Event)[] {
    const result: (Venue | Event)[] = [];
    
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const eventTime = new Date(event.startDate);
      
      // Add venues that can be visited before this event
      const availableVenues = venues.filter(v => {
        // Simple time estimation: 1 hour per venue
        const venueTime = 60; // minutes
        const walkTime = 30; // buffer for walking
        return true; // Simplified - in reality, check timing
      });

      if (availableVenues.length > 0 && result.length === 0) {
        // Add a venue before first event
        result.push(availableVenues[0]);
        venues.splice(venues.indexOf(availableVenues[0]), 1);
      }

      result.push(event);

      // Add a venue after if not last event
      if (i < events.length - 1 && venues.length > 0) {
        result.push(venues[0]);
        venues.splice(0, 1);
      }
    }

    // Add remaining venues at the end
    result.push(...venues);

    return result;
  }

  private calculateRoute(stops: (Venue | Event)[]): any {
    let totalDistance = 0;
    let totalWalkTime = 0;

    const stopsWithTiming = stops.map((stop, index) => {
      if (index > 0) {
        const distance = this.calculateDistance(
          stops[index - 1].location,
          stop.location
        );
        totalDistance += distance;
        const walkTime = Math.round(distance * 15); // 15 min/km
        totalWalkTime += walkTime;
        
        return {
          ...stop,
          walkTime,
          distanceFromPrevious: distance,
          order: index + 1
        };
      }
      
      return {
        ...stop,
        walkTime: 0,
        distanceFromPrevious: 0,
        order: index + 1
      };
    });

    return {
      stops: stopsWithTiming,
      totalDistance: Math.round(totalDistance * 10) / 10,
      totalWalkTime,
      averageDistanceBetweenStops: totalDistance / Math.max(stops.length - 1, 1)
    };
  }

  private calculateDistance(loc1: Location, loc2: Location): number {
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