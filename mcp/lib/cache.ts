import NodeCache from 'node-cache';
import crypto from 'crypto';

export class SmartCache {
  private venueCache: NodeCache;
  private eventCache: NodeCache;
  private itineraryCache: NodeCache;

  constructor() {
    this.venueCache = new NodeCache({ stdTTL: 7200 }); // 2 hours
    this.eventCache = new NodeCache({ stdTTL: 1800 }); // 30 minutes
    this.itineraryCache = new NodeCache({ stdTTL: 3600 }); // 1 hour
  }

  generateKey(params: any): string {
    const str = JSON.stringify(params);
    return crypto.createHash('md5').update(str).digest('hex');
  }

  get(key: string): any {
    // Try all caches
    return this.itineraryCache.get(key) || 
           this.venueCache.get(key) || 
           this.eventCache.get(key);
  }

  set(key: string, value: any, ttl?: number): void {
    // Determine which cache based on content
    if (value.itinerary) {
      this.itineraryCache.set(key, value, ttl || 3600);
    } else if (value.events) {
      this.eventCache.set(key, value, ttl || 1800);
    } else {
      this.venueCache.set(key, value, ttl || 7200);
    }
  }

  clear(): void {
    this.venueCache.flushAll();
    this.eventCache.flushAll();
    this.itineraryCache.flushAll();
  }

  getStats(): any {
    return {
      venues: this.venueCache.getStats(),
      events: this.eventCache.getStats(),
      itineraries: this.itineraryCache.getStats()
    };
  }
}