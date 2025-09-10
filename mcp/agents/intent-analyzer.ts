// // mcp/agents/intent-analyzer.ts - COMPLETE VERSION
// import { BaseAgent } from './base-agent.js';
// import { AgentMessage } from '../lib/types.js';

// export class IntentAnalyzerAgent extends BaseAgent {
//   constructor(openaiApiKey: string) {
//     super('IntentAnalyzer', openaiApiKey);
//   }

//   async process(message: AgentMessage): Promise<any> {
//     const { prompt, location } = message.payload;
    
//     this.log('Analyzing intent for prompt:', prompt);

//     const systemPrompt = `You are an intent analyzer for a travel planning system in New York City.
    
//     CRITICAL UNDERSTANDING RULES:
    
//     1. MEAL REQUESTS (search for restaurants, NOT visit the location):
//        - "lunch at [location]" = find lunch restaurants NEAR that location
//        - "dinner at [location]" = find dinner restaurants NEAR that location
//        - "breakfast at [location]" = find breakfast restaurants NEAR that location
//        - "brunch at/near [location]" = find brunch spots NEAR that location
//        - "coffee at/near [location]" = find coffee shops NEAR that location
       
//     2. ACTIVITY REQUESTS (actually visit the location):
//        - "walk at [location]" = visit that location for a walk
//        - "visit [location]" = go to that specific place
//        - "go to [location]" = travel to that destination
//        - "see [location]" = visit that attraction
       
//     3. PREPOSITION RULES:
//        - "at [location]" for meals = search for food venues IN that area
//        - "near [location]" = search in vicinity of that location
//        - "to [location]" = go to that specific place
//        - "then" = indicates sequence, preserve order
    
//     4. DURATION DETECTION:
//        - "few hours", "2-3 hours", "quick" = few_hours (1-4 hours)
//        - "day", "full day", "all day" = full_day (5-12 hours)
//        - "days", "weekend", "week" = multi_day (2+ days)
//        - No time mentioned + 2-3 activities = few_hours
//        - No time mentioned + 4+ activities = full_day
    
//     5. EVENT INTEREST:
//        - Look for: "concert", "show", "broadway", "game", "performance", "festival"
//        - Also check for: "what's happening", "events", "tonight", "this weekend"
    
//     NYC LOCATION CONTEXT:
//     - Wall Street = Financial District (40.7074, -74.0113)
//     - Bryant Park = Midtown (40.7536, -73.9832)
//     - Times Square = Theater District (40.7580, -73.9855)
//     - Central Park = Upper Manhattan (40.7829, -73.9654)
//     - Brooklyn Bridge = Downtown/Brooklyn (40.7061, -73.9969)
//     - Madison Square Garden = Midtown West (40.7505, -73.9934)
    
//     For the prompt: "${prompt}"
    
//     Return JSON with this EXACT structure:
//     {
//       "duration_type": "few_hours|full_day|multi_day",
//       "estimated_hours": number,
//       "day_count": number (0 for single day, 2+ for multi-day),
//       "explicit_venues": ["specific venue names mentioned"],
//       "venue_categories": ["food", "parks", "coffee", "museum", etc],
//       "event_interest": boolean,
//       "event_keywords": ["concert", "show", etc if found],
//       "time_constraints": {
//         "start_time": null or "ISO string",
//         "end_time": null or "ISO string",
//         "specific_times": ["any specific times mentioned"]
//       },
//       "location_context": {
//         "type": "search_near|visit_specific|mixed",
//         "locations": ["locations mentioned"],
//         "meal_locations": ["locations where user wants to eat"],
//         "visit_locations": ["locations user wants to visit"]
//       },
//       "special_requirements": ["budget", "accessible", "family-friendly", etc],
//       "vibe": "adventure|relaxed|cultural|foodie|mixed",
//       "sequence_matters": boolean (true if user uses "then", "after", "before")
//     }
    
//     IMPORTANT: 
//     - If user says "lunch at Wall Street", location_context.meal_locations = ["Wall Street"]
//     - If user says "walk at Bryant Park", location_context.visit_locations = ["Bryant Park"]
//     - Always set sequence_matters = true if the user uses words like "then", "after", "before"`;

//     try {
//       const analysis = await this.callGPT(systemPrompt, prompt);
      
//       // Validate and enhance the analysis
//       const enhanced = this.enhanceAnalysis(analysis, prompt);
      
//       this.log('Intent analysis complete:', enhanced);
      
//       return {
//         ...enhanced,
//         original_prompt: prompt,
//         user_location: location
//       };
//     } catch (error) {
//       this.log('Error in intent analysis:', error);
      
//       // Fallback analysis
//       return this.createFallbackAnalysis(prompt, location);
//     }
//   }

//   private enhanceAnalysis(analysis: any, prompt: string): any {
//     const promptLower = prompt.toLowerCase();
    
//     // Ensure duration_type is set
//     if (!analysis.duration_type) {
//       if (promptLower.includes('day') && !promptLower.includes('days')) {
//         analysis.duration_type = 'full_day';
//       } else if (promptLower.includes('days') || promptLower.includes('week')) {
//         analysis.duration_type = 'multi_day';
//       } else {
//         analysis.duration_type = 'few_hours';
//       }
//     }
    
//     // Ensure sequence_matters is set correctly
//     if (analysis.sequence_matters === undefined) {
//       analysis.sequence_matters = promptLower.includes('then') || 
//                                   promptLower.includes('after') || 
//                                   promptLower.includes('before') ||
//                                   promptLower.includes('first') ||
//                                   promptLower.includes('next') ||
//                                   promptLower.includes('finally');
//     }
    
//     // Double-check meal locations
//     if (!analysis.location_context) {
//       analysis.location_context = {
//         type: 'mixed',
//         locations: [],
//         meal_locations: [],
//         visit_locations: []
//       };
//     }
    
//     // Parse meal patterns more carefully
//     const mealPatterns = [
//       /(?:breakfast|lunch|dinner|brunch|coffee|eat|meal|food)\s+(?:at|near|around)\s+([^,\.]+)/gi,
//       /(?:grab|get|have)\s+(?:breakfast|lunch|dinner|coffee|food)\s+(?:at|near|around)\s+([^,\.]+)/gi
//     ];
    
//     for (const pattern of mealPatterns) {
//       let match;
//       while ((match = pattern.exec(prompt)) !== null) {
//         const location = match[1].trim();
//         if (!analysis.location_context.meal_locations.includes(location)) {
//           analysis.location_context.meal_locations.push(location);
//         }
//       }
//     }
    
//     // Parse visit patterns
//     const visitPatterns = [
//       /(?:visit|go to|see|walk at|walk in|explore|check out)\s+([^,\.]+)/gi,
//       /(?:then|after that|next)\s+([^,\.]+)/gi
//     ];
    
//     for (const pattern of visitPatterns) {
//       let match;
//       while ((match = pattern.exec(prompt)) !== null) {
//         const location = match[1].trim();
//         // Filter out meal-related words
//         if (!location.match(/breakfast|lunch|dinner|coffee|eat|meal|food/i)) {
//           if (!analysis.location_context.visit_locations.includes(location)) {
//             analysis.location_context.visit_locations.push(location);
//           }
//         }
//       }
//     }
    
//     // Set default values
//     analysis.estimated_hours = analysis.estimated_hours || 
//       (analysis.duration_type === 'few_hours' ? 3 : 
//        analysis.duration_type === 'full_day' ? 8 : 24);
    
//     analysis.day_count = analysis.day_count || 
//       (analysis.duration_type === 'multi_day' ? 2 : 0);
    
//     analysis.explicit_venues = analysis.explicit_venues || [];
//     analysis.venue_categories = analysis.venue_categories || [];
//     analysis.event_keywords = analysis.event_keywords || [];
//     analysis.special_requirements = analysis.special_requirements || [];
//     analysis.vibe = analysis.vibe || 'mixed';
    
//     return analysis;
//   }

//   private createFallbackAnalysis(prompt: string, location: any): any {
//     const promptLower = prompt.toLowerCase();
    
//     // Basic duration detection
//     let durationType = 'few_hours';
//     let estimatedHours = 3;
//     let dayCount = 0;
    
//     if (promptLower.includes('day') && !promptLower.includes('days')) {
//       durationType = 'full_day';
//       estimatedHours = 8;
//     } else if (promptLower.includes('days') || promptLower.includes('week')) {
//       durationType = 'multi_day';
//       estimatedHours = 48;
//       dayCount = promptLower.includes('week') ? 7 : 3;
//     }
    
//     // Detect venue categories
//     const categories = [];
//     if (promptLower.match(/lunch|dinner|breakfast|brunch|eat|food|restaurant/)) {
//       categories.push('food');
//     }
//     if (promptLower.match(/coffee|cafe|starbucks/)) {
//       categories.push('coffee');
//     }
//     if (promptLower.match(/park|garden|walk|stroll/)) {
//       categories.push('parks');
//     }
//     if (promptLower.match(/museum|art|gallery/)) {
//       categories.push('museum');
//     }
//     if (promptLower.match(/shop|shopping|store|mall/)) {
//       categories.push('shopping');
//     }
    
//     // Detect events
//     const eventInterest = promptLower.match(/show|concert|broadway|performance|event|festival|game/) !== null;
    
//     // Detect vibe
//     let vibe = 'mixed';
//     if (promptLower.includes('relax') || promptLower.includes('chill')) {
//       vibe = 'relaxed';
//     } else if (promptLower.includes('adventure') || promptLower.includes('explore')) {
//       vibe = 'adventure';
//     } else if (promptLower.includes('romantic')) {
//       vibe = 'romantic';
//     }
    
//     return {
//       duration_type: durationType,
//       estimated_hours: estimatedHours,
//       day_count: dayCount,
//       explicit_venues: [],
//       venue_categories: categories,
//       event_interest: eventInterest,
//       event_keywords: [],
//       time_constraints: {
//         start_time: null,
//         end_time: null,
//         specific_times: []
//       },
//       location_context: {
//         type: 'mixed',
//         locations: [],
//         meal_locations: [],
//         visit_locations: []
//       },
//       special_requirements: [],
//       vibe: vibe,
//       sequence_matters: promptLower.includes('then') || promptLower.includes('after'),
//       original_prompt: prompt,
//       user_location: location
//     };
//   }
// }

// mcp/agents/intent-analyzer.ts - COMPLETE VERSION (updated for flexible event keywords)
import { BaseAgent } from './base-agent.js';
import { AgentMessage } from '../lib/types.js';

export class IntentAnalyzerAgent extends BaseAgent {
  constructor(openaiApiKey: string) {
    super('IntentAnalyzer', openaiApiKey);
  }

  async process(message: AgentMessage): Promise<any> {
    const { prompt, location } = message.payload;

    this.log('Analyzing intent for prompt:', prompt);

    const systemPrompt = `You are an intent analyzer for a travel planning system in New York City.
    
    CRITICAL UNDERSTANDING RULES:
    
    1. MEAL REQUESTS (search for restaurants, NOT visit the location):
       - "lunch at [location]" = find lunch restaurants NEAR that location
       - "dinner at [location]" = find dinner restaurants NEAR that location
       - "breakfast at [location]" = find breakfast restaurants NEAR that location
       - "brunch at/near [location]" = find brunch spots NEAR that location
       - "coffee at/near [location]" = find coffee shops NEAR that location
       
    2. ACTIVITY REQUESTS (actually visit the location):
       - "walk at [location]" = visit that location for a walk
       - "visit [location]" = go to that specific place
       - "go to [location]" = travel to that destination
       - "see [location]" = visit that attraction
       
    3. PREPOSITION RULES:
       - "at [location]" for meals = search for food venues IN that area
       - "near [location]" = search in vicinity of that location
       - "to [location]" = go to that specific place
       - "then" = indicates sequence, preserve order
    
    4. DURATION DETECTION:
       - "few hours", "2-3 hours", "quick" = few_hours (1-4 hours)
       - "day", "full day", "all day" = full_day (5-12 hours)
       - "days", "weekend", "week" = multi_day (2+ days)
       - No time mentioned + 2-3 activities = few_hours
       - No time mentioned + 4+ activities = full_day
    
    5. EVENT INTEREST:
       - Look for: "concert", "show", "broadway", "game", "performance", "festival", "music", "live music"
       - Also check for: "what's happening", "events", "tonight", "this weekend"
    

    
    For the prompt: "${prompt}"
    
    Return JSON with this EXACT structure:
    {
      "duration_type": "few_hours|full_day|multi_day",
      "estimated_hours": number,
      "day_count": number (0 for single day, 2+ for multi-day),
      "explicit_venues": ["specific venue names mentioned"],
      "venue_categories": ["food", "parks", "coffee", "museum", etc],
      "event_interest": boolean,
      "event_keywords": ["concert", "show", etc if found],
      "time_constraints": {
        "start_time": null or "ISO string",
        "end_time": null or "ISO string",
        "specific_times": ["any specific times mentioned"]
      },
      "location_context": {
        "type": "search_near|visit_specific|mixed",
        "locations": ["locations mentioned"],
        "meal_locations": ["locations where user wants to eat"],
        "visit_locations": ["locations user wants to visit"]
      },
      "special_requirements": ["budget", "accessible", "family-friendly", etc],
      "vibe": "adventure|relaxed|cultural|foodie|mixed",
      "sequence_matters": boolean (true if user uses "then", "after", "before")
    }
    
    IMPORTANT: 
    - If user says "lunch at Wall Street", location_context.meal_locations = ["Wall Street"]
    - If user says "walk at Bryant Park", location_context.visit_locations = ["Bryant Park"]
    - Always set sequence_matters = true if the user uses words like "then", "after", "before"`;

    try {
      const analysis = await this.callGPT(systemPrompt, prompt);

      // Validate and enhance the analysis (including robust event keyword fallback terms)
      const enhanced = this.enhanceAnalysis(analysis, prompt);

      this.log('Intent analysis complete:', enhanced);

      return {
        ...enhanced,
        original_prompt: prompt,
        user_location: location
      };
    } catch (error) {
      this.log('Error in intent analysis:', error);

      // Fallback analysis
      return this.createFallbackAnalysis(prompt, location);
    }
  }

  // ---------------------------
  // Helpers for event flexibility
  // ---------------------------

  /** Tiny stopword set to keep event terms clean (no dictionary of synonyms). */
  private static EVENT_STOPWORDS = new Set([
    'a','an','the','any','some','please','event','events','show','shows','to','in','at','for','near','around','of','and'
  ]);

  /** Normalize whitespace/punctuation. */
  private normalize(s: string): string {
    return (s || '')
      .replace(/[.,;:!?/\\|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Find seed phrases for events from the raw prompt:
   * - Pulls text that appears before words like "event", "show", "concert", "performance", "festival", "game".
   * - Also captures "live music" even if "event" isn't present.
   */
  private extractEventSeeds(prompt: string): string[] {
    const p = this.normalize(prompt);
    const seeds = new Set<string>();

    // Phrases like "... <desc> event" / "... <desc> show" / "... concert"
    const patterns = [
      /\b([\w\s]{1,60})\s+(?:event|events)\b/gi,
      /\b([\w\s]{1,60})\s+(?:show|shows)\b/gi,
      /\b([\w\s]{1,60})\s+(?:performance|performances)\b/gi,
      /\b([\w\s]{1,60})\s+(?:festival|festivals)\b/gi,
      // For "concert" and "game", the word itself is a seed (no preceding desc needed)
      /\b([\w\s]{0,60})\bconcerts?\b/gi,
      /\b([\w\s]{0,60})\bgames?\b/gi
    ];

    for (const re of patterns) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(p)) !== null) {
        const left = (m[1] || '').trim();
        if (left) seeds.add(this.normalize(left));
        // If the keyword itself was present without left side, add the keyword
        if (!left && /concert/i.test(re.source)) seeds.add('concert');
        if (!left && /game/i.test(re.source)) seeds.add('game');
      }
    }

    // Explicit capture of "live music" anywhere
    const liveMusic = p.match(/\blive\s+music\b/i);
    if (liveMusic) seeds.add('live music');

    // If no seeds found but global "events/tonight/this weekend" is present, add a generic seed
    if (seeds.size === 0 && /\b(events?|tonight|this weekend)\b/i.test(p)) {
      seeds.add('music');
    }

    return Array.from(seeds).filter(Boolean);
  }

  /**
   * Build ranked fallback terms from a single seed (e.g., "live music"):
   *   1) full phrase
   *   2) progressively shorter phrases (drop rightmost token)
   *   3) individual keywords (longer first)
   */
  private buildFallbackTermsFromSeed(seed: string): string[] {
    const original = this.normalize(seed);
    if (!original) return [];

    const terms: string[] = [];
    terms.push(original); // full phrase first

    const tokens = original.toLowerCase().split(/\s+/).filter(Boolean);

    // progressively shorten ("live music jazz" -> "live music")
    for (let end = tokens.length - 1; end >= 2; end--) {
      const shorter = tokens.slice(0, end).join(' ').trim();
      if (shorter && !terms.includes(shorter)) terms.push(shorter);
    }

    // singles, filtered
    const singles = tokens
      .filter(t => !IntentAnalyzerAgent.EVENT_STOPWORDS.has(t))
      .sort((a, b) => b.length - a.length);
    for (const t of singles) {
      if (!terms.includes(t)) terms.push(t);
    }

    return terms;
  }

  /** Merge/unique a list of term lists, preserving order. */
  private dedupeOrdered(lists: string[][]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const list of lists) {
      for (const item of list) {
        if (item && !seen.has(item)) {
          seen.add(item);
          out.push(item);
        }
      }
    }
    return out;
  }

  // ---------------------------
  // Enhancement & fallback
  // ---------------------------

  private enhanceAnalysis(analysis: any, prompt: string): any {
    const promptLower = (prompt || '').toLowerCase();

    // Ensure duration_type is set
    if (!analysis.duration_type) {
      if (promptLower.includes('day') && !promptLower.includes('days')) {
        analysis.duration_type = 'full_day';
      } else if (promptLower.includes('days') || promptLower.includes('week')) {
        analysis.duration_type = 'multi_day';
      } else {
        analysis.duration_type = 'few_hours';
      }
    }

    // Ensure sequence_matters is set correctly
    if (analysis.sequence_matters === undefined) {
      analysis.sequence_matters =
        promptLower.includes('then') ||
        promptLower.includes('after') ||
        promptLower.includes('before') ||
        promptLower.includes('first') ||
        promptLower.includes('next') ||
        promptLower.includes('finally');
    }

    // Initialize location_context if missing
    if (!analysis.location_context) {
      analysis.location_context = {
        type: 'mixed',
        locations: [],
        meal_locations: [],
        visit_locations: []
      };
    }

    // Parse meal patterns more carefully
    const mealPatterns = [
      /(?:breakfast|lunch|dinner|brunch|coffee|eat|meal|food)\s+(?:at|near|around)\s+([^,\.]+)/gi,
      /(?:grab|get|have)\s+(?:breakfast|lunch|dinner|coffee|food)\s+(?:at|near|around)\s+([^,\.]+)/gi
    ];

    for (const pattern of mealPatterns) {
      let match;
      while ((match = pattern.exec(prompt)) !== null) {
        const loc = (match[1] || '').trim();
        if (loc && !analysis.location_context.meal_locations.includes(loc)) {
          analysis.location_context.meal_locations.push(loc);
        }
      }
    }

    // Parse visit patterns, excluding explicit event phrases from being treated as visit locations
    const visitPatterns = [
      /(?:visit|go to|see|walk at|walk in|explore|check out)\s+([^,\.]+)/gi,
      /(?:then|after that|next)\s+([^,\.]+)/gi
    ];

    for (const pattern of visitPatterns) {
      let match;
      while ((match = pattern.exec(prompt)) !== null) {
        const raw = (match[1] || '').trim();
        // skip if looks like an event phrase (e.g., "a live music event", "a concert")
        if (/\b(event|events|show|shows|concert|performance|festival|game)\b/i.test(raw)) continue;
        if (!raw.match(/breakfast|lunch|dinner|coffee|eat|meal|food/i)) {
          if (!analysis.location_context.visit_locations.includes(raw)) {
            analysis.location_context.visit_locations.push(raw);
          }
        }
      }
    }

    // Defaults
    analysis.estimated_hours =
      analysis.estimated_hours ||
      (analysis.duration_type === 'few_hours' ? 3 :
       analysis.duration_type === 'full_day' ? 8 : 24);

    analysis.day_count =
      analysis.day_count ||
      (analysis.duration_type === 'multi_day' ? 2 : 0);

    analysis.explicit_venues = analysis.explicit_venues || [];
    analysis.venue_categories = analysis.venue_categories || [];
    analysis.event_keywords = analysis.event_keywords || [];
    analysis.special_requirements = analysis.special_requirements || [];
    analysis.vibe = analysis.vibe || 'mixed';

    // ---------------------------
    // Robust event term extraction (NO dictionary)
    // ---------------------------
    const seeds = this.extractEventSeeds(prompt);
    const fallbackLists = seeds.map(seed => this.buildFallbackTermsFromSeed(seed));
    const fallbackTerms = this.dedupeOrdered(fallbackLists);

    // If GPT already gave event_keywords, merge ours (ours prioritized)
    const provided = Array.isArray(analysis.event_keywords) ? analysis.event_keywords : [];
    const merged = this.dedupeOrdered([fallbackTerms, provided]);

    // If we still have nothing but prompt indicates event interest via generic words, seed with "music"
    const genericEventInterest = /\b(show|concert|broadway|performance|festival|event|events|game|tonight|this weekend|music|live music)\b/i.test(prompt);
    if (merged.length === 0 && genericEventInterest) {
      merged.push('music');
    }

    analysis.event_interest = Boolean(analysis.event_interest || genericEventInterest || merged.length > 0);
    analysis.event_keywords = merged;

    return analysis;
  }

  private createFallbackAnalysis(prompt: string, location: any): any {
    const promptLower = (prompt || '').toLowerCase();

    // Basic duration detection
    let durationType: 'few_hours' | 'full_day' | 'multi_day' = 'few_hours';
    let estimatedHours = 3;
    let dayCount = 0;

    if (promptLower.includes('day') && !promptLower.includes('days')) {
      durationType = 'full_day';
      estimatedHours = 8;
    } else if (promptLower.includes('days') || promptLower.includes('week')) {
      durationType = 'multi_day';
      estimatedHours = 48;
      dayCount = promptLower.includes('week') ? 7 : 3;
    }

    // Detect venue categories
    const categories: string[] = [];
    if (promptLower.match(/lunch|dinner|breakfast|brunch|eat|food|restaurant/)) {
      categories.push('food');
    }
    if (promptLower.match(/coffee|cafe|starbucks/)) {
      categories.push('coffee');
    }
    if (promptLower.match(/park|garden|walk|stroll/)) {
      categories.push('parks');
    }
    if (promptLower.match(/museum|art|gallery/)) {
      categories.push('museum');
    }
    if (promptLower.match(/shop|shopping|store|mall/)) {
      categories.push('shopping');
    }

    // Event interest & terms (fallback path)
    const seeds = this.extractEventSeeds(prompt);
    const fallbackTerms = this.dedupeOrdered(seeds.map(s => this.buildFallbackTermsFromSeed(s)));
    const genericEventInterest = /\b(show|concert|broadway|performance|festival|event|events|game|tonight|this weekend|music|live music)\b/i.test(prompt);
    const eventInterest = genericEventInterest || fallbackTerms.length > 0;
    const eventKeywords = fallbackTerms.length ? fallbackTerms : (genericEventInterest ? ['music'] : []);

    // Detect vibe
    let vibe: 'mixed' | 'relaxed' | 'adventure' | 'romantic' = 'mixed';
    if (promptLower.includes('relax') || promptLower.includes('chill')) {
      vibe = 'relaxed';
    } else if (promptLower.includes('adventure') || promptLower.includes('explore')) {
      vibe = 'adventure';
    } else if (promptLower.includes('romantic')) {
      vibe = 'romantic';
    }

    return {
      duration_type: durationType,
      estimated_hours: estimatedHours,
      day_count: dayCount,
      explicit_venues: [],
      venue_categories: categories,
      event_interest: eventInterest,
      event_keywords: eventKeywords,
      time_constraints: {
        start_time: null,
        end_time: null,
        specific_times: []
      },
      location_context: {
        type: 'mixed',
        locations: [],
        meal_locations: [],
        visit_locations: []
      },
      special_requirements: [],
      vibe: vibe,
      sequence_matters: promptLower.includes('then') || promptLower.includes('after'),
      original_prompt: prompt,
      user_location: location
    };
  }
}
