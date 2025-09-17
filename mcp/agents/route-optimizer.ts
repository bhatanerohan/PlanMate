// mcp/agents/route-optimizer.ts - COMPLETE VERSION WITH LOCAL SEARCH SUPPORT
import { BaseAgent } from './base-agent.js';
import { AgentMessage, Venue, Event, Location, RouteOptimizationResult } from '../lib/types.js';

export class RouteOptimizerAgent extends BaseAgent {
  constructor(openaiApiKey: string) {
    super('RouteOptimizer', openaiApiKey);
  }

  async process(message: AgentMessage): Promise<RouteOptimizationResult> {
    const stops = message.payload.allStops || message.payload.stops || [];
    const preserveOrder = message.payload.preserveOrder;
    const isLocalSearch = message.payload.isLocalSearch;
    
    this.log(`Optimizing route for ${stops.length} stops${isLocalSearch ? ' (LOCAL SEARCH)' : ''}`);
    
    if (stops.length === 0) {
      return { 
        stops: [], 
        totalDistance: 0, 
        totalWalkTime: 0,
        averageDistanceBetweenStops: 0
      };
    }
    
    // For local searches, validate all stops are within bounds
    if (isLocalSearch && this.context?.location) {
      const centerLocation = this.context.location;
      this.log('[RouteOptimizer] Validating distances for local search:');
      
      stops.forEach((stop: any) => {
        const distance = this.calculateDistance(centerLocation, stop.location);
        if (distance > 3) {
          this.log(`  WARNING: ${stop.name} is ${distance.toFixed(2)}km from center (max 3km)`);
        } else {
          this.log(`  ✓ ${stop.name}: ${distance.toFixed(2)}km`);
        }
      });
    }
    
    // If sequence matters OR user specified order, keep as is
    if (preserveOrder || this.context?.constraints?.sequence_matters) {
      const orderedStops = [...stops].sort((a, b) => (a.order || 0) - (b.order || 0));
      return this.calculateRoute(orderedStops, isLocalSearch);
    }
    
    // OPTIMIZE THE ROUTE
    console.log(`[RouteOptimizer] Optimizing route for ${isLocalSearch ? 'minimal LOCAL' : 'minimal'} distance`);
    
    // Separate events (time-constrained) from venues (flexible)
    const events = stops.filter((s: { isEvent: any; startDate: any; }) => s.isEvent && s.startDate);
    const venues = stops.filter((s: { isEvent: any; startDate: any; }) => !s.isEvent || !s.startDate);
    
    // Sort events by time
    events.sort((a: { startDate: string | number | Date; }, b: { startDate: string | number | Date; }) => 
      new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    );
    
    // Optimize venues around events with local constraints
    const optimizedStops = isLocalSearch ?
      this.optimizeLocalRoute(venues, events) :
      this.optimizeWithTimeConstraints(venues, events);
    
    return this.calculateRoute(optimizedStops, isLocalSearch);
  }

  private optimizeLocalRoute(venues: any[], events: any[]): any[] {
    // For local searches, keep everything tight and walkable
    const centerLocation = this.context?.location || { lat: 40.758, lng: -73.9855 };
    
    if (events.length === 0) {
      // No events, optimize venues for minimal walking in a small area
      return this.optimizeByDistanceLocal(venues, centerLocation);
    }
    
    const result = [];
    let remainingVenues = [...venues];
    let lastLocation = centerLocation;
    
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      
      // Add venues before this event (prioritize closest to current location)
      if (remainingVenues.length > 0) {
        const venuesBefore = Math.ceil(remainingVenues.length / (events.length - i + 1));
        
        for (let j = 0; j < venuesBefore && remainingVenues.length > 0; j++) {
          // For local search, find nearest that's also close to center
          const nearest = this.findNearestLocal(lastLocation, remainingVenues, centerLocation);
          if (nearest) {
            result.push(nearest);
            lastLocation = nearest.location;
            remainingVenues = remainingVenues.filter(v => v.id !== nearest.id);
          }
        }
      }
      
      // Add the event
      result.push(event);
      lastLocation = event.location;
    }
    
    // Add remaining venues (closest first)
    while (remainingVenues.length > 0) {
      const nearest = this.findNearestLocal(lastLocation, remainingVenues, centerLocation);
      if (nearest) {
        result.push(nearest);
        lastLocation = nearest.location;
        remainingVenues = remainingVenues.filter(v => v.id !== nearest.id);
      } else {
        break; // No more venues within acceptable distance
      }
    }
    
    return result;
  }

  private findNearestLocal(from: any, candidates: any[], center: any): any {
    let nearest = null;
    let minScore = Infinity;
    
    for (const candidate of candidates) {
      const distFromCurrent = this.calculateDistance(from, candidate.location);
      const distFromCenter = this.calculateDistance(center, candidate.location);
      
      // For local search, penalize venues far from center
      if (distFromCenter > 2) continue; // Skip venues more than 2km from center
      
      // Score combines distance from current location and distance from center
      const score = distFromCurrent + (distFromCenter * 0.5); // Weight center distance less
      
      if (score < minScore) {
        minScore = score;
        nearest = candidate;
      }
    }
    
    return nearest;
  }

  private optimizeByDistanceLocal(stops: any[], center: any): any[] {
    if (stops.length === 0) return [];
    
    // Start with the stop closest to center
    let nearest = stops[0];
    let minDist = this.calculateDistance(center, stops[0].location);
    
    for (const stop of stops) {
      const dist = this.calculateDistance(center, stop.location);
      if (dist < minDist) {
        minDist = dist;
        nearest = stop;
      }
    }
    
    const optimized = [nearest];
    const remaining = stops.filter(s => s.id !== nearest.id);
    
    // Build route minimizing total walking distance
    while (remaining.length > 0) {
      const last = optimized[optimized.length - 1];
      let nearestIdx = -1;
      let nearestDist = Infinity;
      
      for (let i = 0; i < remaining.length; i++) {
        const dist = this.calculateDistance(last.location, remaining[i].location);
        const centerDist = this.calculateDistance(center, remaining[i].location);
        
        // Skip if too far from center (local search constraint)
        if (centerDist > 2.5) continue;
        
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestIdx = i;
        }
      }
      
      if (nearestIdx >= 0) {
        optimized.push(remaining[nearestIdx]);
        remaining.splice(nearestIdx, 1);
      } else {
        // No more venues within acceptable distance
        this.log(`[RouteOptimizer] Skipping ${remaining.length} venues that are too far from center`);
        break;
      }
    }
    
    return optimized;
  }

  private optimizeWithTimeConstraints(venues: any[], events: any[]): any[] {
    if (events.length === 0) {
      // No events, just optimize venues by distance
      return this.optimizeByDistance(venues);
    }
    
    const result = [];
    let remainingVenues = [...venues];
    let lastLocation = this.context?.location || { lat: 40.758, lng: -73.9855 };
    
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      
      // Add venues before this event (find closest ones)
      if (remainingVenues.length > 0) {
        const venuesBefore = Math.ceil(remainingVenues.length / (events.length - i + 1));
        
        for (let j = 0; j < venuesBefore && remainingVenues.length > 0; j++) {
          const nearest = this.findNearest(lastLocation, remainingVenues);
          result.push(nearest);
          lastLocation = nearest.location;
          remainingVenues = remainingVenues.filter(v => v.id !== nearest.id);
        }
      }
      
      // Add the event
      result.push(event);
      lastLocation = event.location;
    }
    
    // Add any remaining venues
    while (remainingVenues.length > 0) {
      const nearest = this.findNearest(lastLocation, remainingVenues);
      result.push(nearest);
      lastLocation = nearest.location;
      remainingVenues = remainingVenues.filter(v => v.id !== nearest.id);
    }
    
    return result;
  }

  private findNearest(from: any, candidates: any[]): any {
    let nearest = candidates[0];
    let minDist = this.calculateDistance(from, candidates[0].location);
    
    for (const candidate of candidates) {
      const dist = this.calculateDistance(from, candidate.location);
      if (dist < minDist) {
        minDist = dist;
        nearest = candidate;
      }
    }
    
    return nearest;
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

  private calculateRoute(stops: (Venue | Event)[], isLocalSearch: boolean = false): RouteOptimizationResult {
    let totalDistance = 0;
    let totalWalkTime = 0;
    let maxDistanceFromCenter = 0;
    
    const centerLocation = this.context?.location || { lat: 40.758, lng: -73.9855 };

    const stopsWithTiming = stops.map((stop, index) => {
      // Calculate distance from center for local search validation
      if (isLocalSearch) {
        const distFromCenter = this.calculateDistance(centerLocation, stop.location);
        maxDistanceFromCenter = Math.max(maxDistanceFromCenter, distFromCenter);
      }
      
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
    
    // Build result object with all properties defined upfront
    let distanceWarning: string | undefined = undefined;
    let finalMaxDistanceFromCenter: number | undefined = undefined;
    
    if (isLocalSearch) {
      finalMaxDistanceFromCenter = maxDistanceFromCenter;
      
      if (maxDistanceFromCenter > 3) {
        distanceWarning = `Some stops are ${maxDistanceFromCenter.toFixed(1)}km from center (recommended max: 3km)`;
        this.log(`[RouteOptimizer] WARNING: Local search exceeds 3km radius`);
      } else {
        this.log(`[RouteOptimizer] ✓ All stops within ${maxDistanceFromCenter.toFixed(1)}km of center`);
      }
    }
    
    // Create result with all properties using spread operator for optional properties
    const result: RouteOptimizationResult = {
      stops: stopsWithTiming,
      totalDistance: Math.round(totalDistance * 10) / 10,
      totalWalkTime,
      averageDistanceBetweenStops: totalDistance / Math.max(stops.length - 1, 1),
      isLocalSearch,
      ...(finalMaxDistanceFromCenter !== undefined && { maxDistanceFromCenter: finalMaxDistanceFromCenter }),
      ...(distanceWarning && { distanceWarning })
    };
    
    return result;
  }

  private calculateDistance(loc1: Location, loc2: Location): number {
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