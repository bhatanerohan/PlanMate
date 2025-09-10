import { BaseAgent } from './base-agent.js';
import { AgentMessage } from '../lib/types.js';

export class QualityControllerAgent extends BaseAgent {
  constructor(openaiApiKey: string) {
    super('QualityController', openaiApiKey);
  }

  async process(message: AgentMessage): Promise<any> {
    const itinerary = message.payload;
    
    this.log('Validating itinerary quality');

    const validationResults = {
      timing: await this.validateTiming(itinerary),
      variety: await this.validateVariety(itinerary),
      distance: await this.validateDistance(itinerary),
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
        qualityScore: this.calculateQualityScore(validationResults)
      };
    }

    this.log('Itinerary passed quality checks');
    
    return {
      valid: true,
      issues: [],
      itinerary,
      qualityScore: this.calculateQualityScore(validationResults)
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
    const { totalDistance, durationType } = itinerary;
    
    const maxDistances: any = {
      few_hours: 3,     // km
      full_day: 10,
      multi_day: 15     // per day
    };
    
    const maxDistance = maxDistances[durationType] || 10;
    
    if (totalDistance > maxDistance) {
      return {
        valid: false,
        issue: `Total walking distance (${totalDistance}km) is too much`,
        suggestion: 'Consider public transportation or reduce stops'
      };
    }
    
    return { valid: true };
  }

  private async validateFeasibility(itinerary: any): Promise<any> {
    // Check if itinerary is actually doable
    const { durationType, stops } = itinerary;
    
    const maxStops: any = {
      few_hours: 3,
      full_day: 6,
      multi_day: 5  // per day
    };
    
    const max = maxStops[durationType] || 5;
    
    if (stops && stops.length > max) {
      return {
        valid: false,
        issue: 'Too many stops for available time',
        suggestion: `Reduce to ${max} stops maximum`
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

  // mcp/agents/quality-controller.ts - Fix attemptFixes method
// mcp/agents/quality-controller.ts - Fix the attemptFixes method
private async attemptFixes(itinerary: any, issues: any[]): Promise<any> {
  let fixed = { ...itinerary };
  
  for (const issue of issues) {
    switch (issue.type) {
      case 'distance':
        // NEVER remove stops if they're ALL explicit requests
        if (fixed.stops && fixed.stops.length > 0) {
          const allExplicit = fixed.stops.every((s: any) => 
            s.isExplicitRequest || s.isPlaceholder || s.userSpecified
          );
          
          if (allExplicit) {
            // Don't remove ANYTHING - user explicitly asked for all of these
            fixed.distanceWarning = true;
            this.log('All stops are explicit user requests - preserving all despite distance');
            // Don't actually remove anything!
          } else {
            // Only remove non-explicit stops
            const nonExplicitStops = fixed.stops.filter((s: any) => 
              !s.isExplicitRequest && !s.isPlaceholder && !s.userSpecified
            );
            
            if (nonExplicitStops.length > 0) {
              // Remove only the furthest non-explicit stop
              const toRemove = nonExplicitStops[nonExplicitStops.length - 1];
              fixed.stops = fixed.stops.filter((s: any) => s !== toRemove);
              this.log(`Removed non-explicit stop: ${toRemove.name}`);
            } else {
              // All stops are explicit, keep them all
              fixed.distanceWarning = true;
              this.log('No non-explicit stops to remove - keeping all');
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
}