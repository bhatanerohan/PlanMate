// mcp/agents/event-specialist.ts - COMPLETE (radius hardcoded to 5km + noKeywords mode)
import { BaseAgent } from './base-agent.js';
import { AgentMessage, Event, EventSearchParams } from '../lib/types.js';
import { TicketmasterClient } from '../lib/api-clients.js';

export class EventSpecialistAgent extends BaseAgent {
  private ticketmasterClient: TicketmasterClient;

  constructor(openaiApiKey: string, ticketmasterApiKey: string) {
    super('EventSpecialist', openaiApiKey);
    this.ticketmasterClient = new TicketmasterClient(ticketmasterApiKey);
  }

  async process(message: AgentMessage): Promise<Event[]> {
    const params = message.payload as EventSearchParams;

    this.log('Searching events (raw params):', params);

    // 1) Normalize/adapt params (time window + radius)
    const searchParams = this.adaptSearchParams(params);

    // 2) Build search terms
    //    - noKeywords mode: returns []
    //    - explicit event: analyzer keywords or fallbacks from query
    const terms = this.buildSearchTerms(searchParams);

    // 3) Try Ticketmaster with fallback terms until we get enough results
    const targetCount = this.context?.durationType === 'few_hours' ? 5 : 15;
    const events = await this.searchWithFallback(searchParams, terms, targetCount);

    // 4) Rank results with GPT (same approach as your original)
    const rankedEvents = await this.rankEvents(events, searchParams);

    this.log(
      `[EventSpecialist] Found ${rankedEvents.length} ranked events (tried ${terms.length} term(s))`
    );
    return rankedEvents;
  }

  // ---------- Param adaptation (time window + radius) ----------

  private adaptSearchParams(params: EventSearchParams): EventSearchParams {
    const adapted: EventSearchParams = { ...params };

    // Always search next 7 days from "now"
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    adapted.timeWindow = {
      start: now,
      end: nextWeek
    };

    // HARD-CODE radius to 5 km for all event searches
    adapted.radiusKm = 5;

    // Expose ISO strings if your TM client wants to use them
    (adapted as any).startDateTimeISO = adapted.timeWindow.start.toISOString();
    (adapted as any).endDateTimeISO = adapted.timeWindow.end.toISOString();

    this.log(
      `[EventSpecialist] Time window: ${adapted.timeWindow.start.toISOString()} → ${adapted.timeWindow.end.toISOString()}, radiusKm=${adapted.radiusKm}`
    );

    return adapted;
  }

  // ---------- Flexible search term builder (no dictionary) ----------

  private static STOPWORDS = new Set([
    'a','an','the','any','some','please','event','events','show','shows',
    'to','in','at','for','near','around','of','and','then'
  ]);

  private normalize(s: string): string {
    return (s || '')
      .replace(/[.,;:!?/\\|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private buildFallbackTermsFromPhrase(phrase: string): string[] {
    const original = this.normalize(phrase);
    if (!original) return [];

    const terms: string[] = [];
    terms.push(original);

    // Drop trailing generic word (e.g., "live music event" -> "live music")
    const dropTail = original.replace(/\b(event|events|show|shows)\b$/i, '').trim();
    if (dropTail && dropTail !== original) terms.push(dropTail);

    // Progressive shortening: "live music jazz" -> "live music"
    const tokens = original.toLowerCase().split(/\s+/).filter(Boolean);
    for (let end = tokens.length - 1; end >= 2; end--) {
      const shorter = tokens.slice(0, end).join(' ').trim();
      if (shorter && !terms.includes(shorter)) terms.push(shorter);
    }

    // Singles (filter stopwords), prioritize longer tokens
    const singles = tokens
      .filter(t => !EventSpecialistAgent.STOPWORDS.has(t))
      .sort((a, b) => b.length - a.length);
    for (const t of singles) {
      if (!terms.includes(t)) terms.push(t);
    }

    return Array.from(new Set(terms)).filter(Boolean);
  }

  private mergeUnique(lists: string[][]): string[] {
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

  private buildSearchTerms(params: EventSearchParams): string[] {
    // Special mode: fetch nearby events with NO keywords (for each venue stop)
    if ((params as any).noKeywords === true) {
      this.log('[EventSpecialist] noKeywords=true; performing blank-keyword proximity search');
      return []; // empty list → one blank attempt
    }

    // Otherwise, explicit event request:
    const provided = Array.isArray((params as any).event_keywords)
      ? ((params as any).event_keywords as string[])
      : [];

    if (provided.length) {
      const cleaned = provided.map(t => this.normalize(t)).filter(Boolean);
      this.log('[EventSpecialist] Using analyzer event_keywords:', cleaned);
      return cleaned;
    }

    const base = (params as any).query || (params as any).keyword || '';
    const built = this.buildFallbackTermsFromPhrase(base);
    if (built.length) {
      this.log('[EventSpecialist] Built fallback terms from query:', built);
      return built;
    }

    // Last resort default for explicit event stops
    this.log('[EventSpecialist] No keywords or query provided; defaulting to "music".');
    return ['music'];
  }

  // ---------- Fallback search orchestration (no leakage of old keywords) ----------

  private async searchWithFallback(
    params: EventSearchParams,
    terms: string[],
    targetCount: number
  ): Promise<Event[]> {
    const collected: Event[] = [];
    const seen = new Set<string>();

    // Base params (minimal; prevents keyword leakage between attempts)
    const base: EventSearchParams = {
      location: params.location,
      radiusKm: 5,                 // hard-coded here too, for safety
      timeWindow: params.timeWindow,
      limit: params.limit
    } as EventSearchParams;

    // noKeywords mode: do a single blank attempt (no keyword in request)
    if (terms.length === 0) {
      this.log('[EventSpecialist] Blank keyword attempt (nearby events mode)');
      const batch = await this.ticketmasterClient.searchEvents({ ...base });
      for (const ev of batch || []) {
        if (ev?.id && !seen.has(ev.id)) {
          seen.add(ev.id);
          collected.push(ev);
        }
      }
      return collected;
    }

    // Otherwise, try terms in order
    for (const term of terms) {
      const attemptParams: EventSearchParams = {
        ...base,
        ...( { keywords: [term] } as any ),
        ...( { keyword: term } as any ),
        ...( { query: term } as any )
      };

      this.log(`[EventSpecialist] Ticketmaster attempt with term="${term}"`);
      const batch = await this.ticketmasterClient.searchEvents(attemptParams);

      for (const ev of batch || []) {
        if (!ev?.id || seen.has(ev.id)) continue;
        seen.add(ev.id);
        collected.push(ev);
      }

      this.log(`[EventSpecialist] Got ${batch?.length || 0} for "${term}", total=${collected.length}`);
      if (collected.length >= targetCount) break;
    }

    return collected;
  }

  // ---------- Ranking (same spirit as your original) ----------

  private async rankEvents(events: Event[], _params: EventSearchParams): Promise<Event[]> {
    if (!events.length) return [];

    const systemPrompt = `Rank events based on:
    1. Timing fit with itinerary
    2. User interest match (based on prompt)
    3. Popularity and ratings
    4. Uniqueness (special or limited-time events score higher)
    5. Distance from search location

    For SHORT trips, prioritize:
    - Events starting very soon
    - Short duration events
    - High-quality experiences worth the time

    Context:
    - Trip duration: ${this.context?.durationType}
    - User interests: ${this.context?.currentPlan?.vibe}

    Return JSON array: [{"event_id": "id", "rank": 1, "score": 0.9, "reason": "why"}]`;

    const eventData = events.map(e => ({
      id: e.id,
      name: e.name,
      type: (e as any).eventType,
      startTime: (e as any).startDate,
      price: (e as any).price,
      venue: (e as any).venueName
    }));

    const rankings = await this.callGPT(systemPrompt, JSON.stringify(eventData)).catch(() => []);

    const byId = new Map<string, { score?: number }>();
    if (Array.isArray(rankings)) {
      for (const r of rankings) {
        if (r && r.event_id) byId.set(r.event_id, { score: typeof r.score === 'number' ? r.score : 0.5 });
      }
    }

    const scored = events.map(e => {
      const found = byId.get(e.id);
      return { ...e, score: found?.score ?? 0.5 } as Event & { score: number };
    });

    const limit = this.context?.durationType === 'few_hours' ? 3 : 10;
    return scored.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, limit);
  }
}
