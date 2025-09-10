import { BaseAgent } from './base-agent.js';
import { AgentMessage, ItineraryPlan, SearchStrategy } from '../lib/types.js';

export class MasterPlannerAgent extends BaseAgent {
  constructor(openaiApiKey: string) {
    super('MasterPlanner', openaiApiKey);
  }

  async process(message: AgentMessage): Promise<ItineraryPlan> {
    const intent = message.payload;
    
    this.log('Creating master plan for duration:', intent.duration_type);

    const systemPrompt = this.buildSystemPrompt(intent.duration_type);
    const userPrompt = JSON.stringify(intent);
    
    const plan = await this.callGPT(systemPrompt, userPrompt);
    
    // Adapt plan based on duration
    const adaptedPlan = this.adaptPlanToDuration(plan, intent);
    
    this.log('Master plan created:', adaptedPlan);
    
    return adaptedPlan;
  }

  private buildSystemPrompt(durationType: string): string {
    const basePrompt = `You are a master travel planner creating itineraries for New York City.
    Create a detailed plan based on the user's intent analysis.`;

    const durationSpecific = {
      few_hours: `
      For SHORT TRIPS (1-4 hours):
      - Maximum 3 stops
      - Keep within 1-2km radius
      - Include events ONLY if explicitly requested or perfect timing
      - Quick, efficient experiences
      - Consider current time of day heavily`,
      
      full_day: `
      For FULL DAY trips (5-12 hours):
      - 4-6 major stops
      - Mix of activities, food, and possibly events
      - Consider meal times (breakfast, lunch, dinner)
      - Balance active and restful activities
      - Include both must-see and hidden gems`,
      
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

  private generateDayTheme(stops: any[]): string {
    // Simple theme generation based on stop categories
    const categories = stops.map(s => s.category);
    if (categories.includes('museum')) return 'Culture & Arts';
    if (categories.includes('park')) return 'Nature & Outdoors';
    if (categories.includes('shopping')) return 'Shopping & Dining';
    return 'Mixed Exploration';
  }
}