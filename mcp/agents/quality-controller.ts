// mcp/agents/quality-controller.ts - ENHANCED FOR LOCAL SEARCH VALIDATION
import { BaseAgent } from './base-agent.js';
import { AgentMessage } from '../lib/types.js';

export class QualityControllerAgent extends BaseAgent {
  constructor(openaiApiKey: string) {
    super('QualityController', openaiApiKey);
  }

  async process(message: AgentMessage): Promise<any> {
    const itinerary = message.payload;
    const isLocalSearch = itinerary.isLocalSearch;
    
    this.log(`Validating itinerary quality${isLocalSearch ? ' (LOCAL SEARCH)' : ''}`);

    const validationResults = {
      timing: await this.validateTiming(itinerary),
      variety: await this.validateVariety(itinerary),
      distance: await this.validateDistance(itinerary),
      localConstraints: isLocalSearch ? await this.validateLocalConstraints(itinerary) : { valid: true },
      feasibility: await this.validateFeasibility(itinerary),
      completeness: await this.validateCompleteness(itinerary)
    };

    const issues = Object.entries(validationResults)
      .filter(([_, result]: [string, any]) => !result.valid)
      .map(([type, result]: [string, any]) => ({
        type,
        issue: result.issue,
        suggestion: result.suggestion
      }));

    if (issues.length > 0) {
      this.log('Quality issues found:', issues);
      
      // Attempt to fix issues
      const fixedItinerary = await this.attemptFixes(itinerary, issues);
      
      return {
        valid: issues.length === 0,
        issues,
        itinerary: fixedItinerary || itinerary,
        qualityScore: this.calculateQualityScore(validationResults),
        isLocalSearch
      };
    }

    this.log('Itinerary passed quality checks');
    
    return {
      valid: true,
      issues: [],
      itinerary,
      qualityScore: this.calculateQualityScore(validationResults),
      isLocalSearch
    };
  }

  // mcp/agents/quality-controller.ts - Add local validation

private async validateLocalConstraints(itinerary: any): Promise<any> {
  const stops = itinerary.stops || [];
  const centerLocation = this.context?.location || itinerary.location;
  
  if (!centerLocation || stops.length === 0) {
    return { valid: true };
  }
  
  const MAX_LOCAL_DISTANCE_KM = 3; // Maximum 3km from center
  const MAX_WALK_BETWEEN_STOPS_KM = 1.5; // Maximum 1.5km walk between stops
  
  let maxDistanceFromCenter = 0;
  let maxWalkDistance = 0;
  let problematicStops = [];
  
  // Check distance from center for each stop
  stops.forEach((stop: any, index: number) => {
    const distFromCenter = this.calculateDistance(centerLocation, stop.location);
    maxDistanceFromCenter = Math.max(maxDistanceFromCenter, distFromCenter);
    
    if (distFromCenter > MAX_LOCAL_DISTANCE_KM) {
      problematicStops.push({
        name: stop.name,
        distance: distFromCenter.toFixed(2)
      });
    }
    
    // Check walking distance to next stop
    if (index < stops.length - 1) {
      const nextStop = stops[index + 1];
      const walkDist = this.calculateDistance(stop.location, nextStop.location);
      maxWalkDistance = Math.max(maxWalkDistance, walkDist);
    }
  });
  
  // Validate constraints
  if (problematicStops.length > 0) {
    return {
      valid: false,
      issue: `${problematicStops.length} stop(s) exceed 3km from starting point`,
      suggestion: 'Find alternatives closer to the starting point'
    };
  }
  
  if (maxWalkDistance > MAX_WALK_BETWEEN_STOPS_KM) {
    return {
      valid: false,
      issue: `Walking distance between stops exceeds ${MAX_WALK_BETWEEN_STOPS_KM}km`,
      suggestion: 'Reorder stops or find intermediate venues'
    };
  }
  
  return { 
    valid: true,
    maxDistanceFromCenter: maxDistanceFromCenter.toFixed(2),
    maxWalkDistance: maxWalkDistance.toFixed(2)
  };
}

  private async validateTiming(itinerary: any): Promise<any> {
    // Check if events can be reached in time
    const stops = itinerary.stops || [];
    
    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i];
      
      if (stop.startDate) {
        // It's an event
        const eventTime = new Date(stop.startDate);
        
        if (i > 0) {
          const previousStop = stops[i - 1];
          const walkTime = stop.walkTime || 30; // minutes
          
          // Check if there's enough time to get there
          if (previousStop.endTime) {
            const previousEnd = new Date(previousStop.endTime);
            const arrivalTime = new Date(previousEnd.getTime() + walkTime * 60 * 1000);
            
            if (arrivalTime > eventTime) {
              return {
                valid: false,
                issue: `Cannot reach ${stop.name} in time`,
                suggestion: 'Remove previous stop or find closer alternative'
              };
            }
          }
        }
      }
    }
    
    return { valid: true };
  }

  private async validateVariety(itinerary: any): Promise<any> {
    const stops = itinerary.stops || [];
    const categories = stops.map((s: any) => s.category);
    
    // Check for too much repetition
    const categoryCounts: any = {};
    categories.forEach((cat: string) => {
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });
    
    const maxRepetition = Math.max(...Object.values(categoryCounts) as number[]);
    const varietyRatio = Object.keys(categoryCounts).length / stops.length;
    
    if (varietyRatio < 0.3 && stops.length > 3) {
      return {
        valid: false,
        issue: 'Lack of variety in activities',
        suggestion: 'Mix different types of activities'
      };
    }
    
    return { valid: true };
  }

  private async validateDistance(itinerary: any): Promise<any> {
    const { totalDistance, durationType, isLocalSearch } = itinerary;
    
    // Different limits for local vs general searches
    const maxDistances: any = isLocalSearch ? {
      few_hours: 2,      // 2km for local short trips
      full_day: 5,       // 5km for local full day
      multi_day: 8       // 8km per day for local multi-day
    } : {
      few_hours: 3,      // 3km for general short trips
      full_day: 10,      // 10km for general full day
      multi_day: 15      // 15km per day for general multi-day
    };
    
    const maxDistance = maxDistances[durationType] || (isLocalSearch ? 5 : 10);
    
    if (totalDistance > maxDistance) {
      return {
        valid: false,
        issue: `Total walking distance (${totalDistance}km) exceeds ${isLocalSearch ? 'local search' : 'recommended'} limit (${maxDistance}km)`,
        suggestion: isLocalSearch ? 
          'All stops should be within walking distance for local search. Consider removing furthest stops.' :
          'Consider public transportation or reduce stops'
      };
    }
    
    return { valid: true };
  }

  private async validateFeasibility(itinerary: any): Promise<any> {
    // Check if itinerary is actually doable
    const { durationType, stops, isLocalSearch } = itinerary;
    
    // Stricter limits for local searches
    const maxStops: any = isLocalSearch ? {
      few_hours: 3,
      full_day: 5,
      multi_day: 4  // per day for local
    } : {
      few_hours: 3,
      full_day: 6,
      multi_day: 5  // per day for general
    };
    
    const max = maxStops[durationType] || 5;
    
    if (stops && stops.length > max) {
      return {
        valid: false,
        issue: `Too many stops (${stops.length}) for ${isLocalSearch ? 'local search' : 'available time'}`,
        suggestion: `Reduce to ${max} stops maximum${isLocalSearch ? ' to keep everything walkable' : ''}`
      };
    }
    
    return { valid: true };
  }

  private async validateCompleteness(itinerary: any): Promise<any> {
    // Check if all required elements are present
    const required = ['title', 'description', 'stops', 'totalDistance'];
    const missing = required.filter(field => !itinerary[field]);
    
    if (missing.length > 0) {
      return {
        valid: false,
        issue: `Missing required fields: ${missing.join(', ')}`,
        suggestion: 'Ensure all fields are populated'
      };
    }
    
    if (!itinerary.stops || itinerary.stops.length === 0) {
      return {
        valid: false,
        issue: 'No stops in itinerary',
        suggestion: 'Add at least one stop'
      };
    }
    
    return { valid: true };
  }

  private async attemptFixes(itinerary: any, issues: any[]): Promise<any> {
    let fixed = { ...itinerary };
    
    for (const issue of issues) {
      switch (issue.type) {
        case 'localConstraints':
          // For local constraint violations, remove furthest stops
          if (fixed.stops && fixed.stops.length > 0 && this.context?.location) {
            const centerLocation = this.context.location;
            
            // Sort stops by distance from center
            const stopsWithDistance = fixed.stops.map((stop: any) => ({
              ...stop,
              distanceFromCenter: this.calculateDistance(centerLocation, stop.location)
            }));
            
            // Keep only stops within 3km (unless they're explicit requests)
            fixed.stops = stopsWithDistance.filter((stop: any) => 
              stop.distanceFromCenter <= 3 || 
              stop.isExplicitRequest || 
              stop.isPlaceholder || 
              stop.userSpecified
            );
            
            // If we removed stops, add a warning
            if (stopsWithDistance.length > fixed.stops.length) {
              fixed.localSearchAdjusted = true;
              fixed.removedStopsCount = stopsWithDistance.length - fixed.stops.length;
              this.log(`[QualityController] Removed ${fixed.removedStopsCount} stops beyond 3km for local search`);
            }
            
            // Re-sort by order
            fixed.stops.sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
          }
          break;
          
        case 'distance':
          // For distance issues in local search, be more aggressive
          if (fixed.isLocalSearch && fixed.stops && fixed.stops.length > 0) {
            const allExplicit = fixed.stops.every((s: any) => 
              s.isExplicitRequest || s.isPlaceholder || s.userSpecified
            );
            
            if (!allExplicit) {
              // Remove non-explicit stops that are furthest
              const nonExplicitStops = fixed.stops.filter((s: any) => 
                !s.isExplicitRequest && !s.isPlaceholder && !s.userSpecified
              );
              
              if (nonExplicitStops.length > 0 && this.context?.location) {
                // Sort by distance and remove furthest
                nonExplicitStops.sort((a: any, b: any) => {
                  const distA = this.calculateDistance(this.context!.location, a.location);
                  const distB = this.calculateDistance(this.context!.location, b.location);
                  return distB - distA;
                });
                
                const toRemove = nonExplicitStops[0]; // Remove furthest
                fixed.stops = fixed.stops.filter((s: any) => s.id !== toRemove.id);
                this.log(`[QualityController] Removed furthest non-explicit stop: ${toRemove.name}`);
              }
            } else {
              fixed.distanceWarning = true;
              this.log('All stops are explicit user requests - preserving all despite distance');
            }
          } else {
            // Original distance fix logic for non-local searches
            if (fixed.stops && fixed.stops.length > 0) {
              const allExplicit = fixed.stops.every((s: any) => 
                s.isExplicitRequest || s.isPlaceholder || s.userSpecified
              );
              
              if (!allExplicit) {
                const nonExplicitStops = fixed.stops.filter((s: any) => 
                  !s.isExplicitRequest && !s.isPlaceholder && !s.userSpecified
                );
                
                if (nonExplicitStops.length > 0) {
                  const toRemove = nonExplicitStops[nonExplicitStops.length - 1];
                  fixed.stops = fixed.stops.filter((s: any) => s !== toRemove);
                  this.log(`Removed non-explicit stop: ${toRemove.name}`);
                }
              } else {
                fixed.distanceWarning = true;
              }
            }
          }
          break;
          
        case 'timing':
          // Only remove non-explicit stops with timing conflicts
          if (fixed.stops) {
            const before = fixed.stops.length;
            fixed.stops = fixed.stops.filter((s: any) => 
              !s.timingConflict || s.isExplicitRequest || s.isPlaceholder || s.userSpecified
            );
            if (before > fixed.stops.length) {
              this.log(`Removed ${before - fixed.stops.length} stops with timing conflicts`);
            }
          }
          break;
          
        case 'variety':
          fixed.needsVariety = true;
          break;
          
        case 'completeness':
          // Don't remove stops for completeness issues
          this.log('Completeness issue - not removing stops');
          break;
      }
    }
    
    return fixed;
  }

  private calculateQualityScore(validationResults: any): number {
    const scores = Object.values(validationResults)
      .map((result: any) => result.valid ? 1 : 0);
    
    return scores.reduce((a: number, b: number) => a + b, 0) / scores.length;
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