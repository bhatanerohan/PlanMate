export interface Location {
  lat: number;
  lng: number;
}

export interface TimeWindow {
  start: Date;
  end: Date;
}

export interface VenueSearchParams {
  query: string;
  location: Location;
  category?: string;
  radius?: number;
  limit?: number;
}

export interface EventSearchParams {
  location: Location;
  radiusKm?: number;
  keywords?: string[];
  timeWindow?: TimeWindow;
  limit?: number;
}

export interface Venue {
  id: string;
  name: string;
  category: string;
  location: Location;
  address: string;
  rating?: number;
  priceLevel?: number;
  description?: string;
  userRatingsTotal?: number;
  nearbyEvents?: Event[];
  order?: number;
  walkTime?: number;
}

export interface Event {
  id: string;
  name: string;
  eventType: string;
  location: Location;
  venueName: string;
  startDate: string;
  endDate?: string;
  price: string;
  url: string;
  imageUrl?: string;
  isAvailable: boolean;
  description?: string;
}

export interface ItineraryPlan {
  title: string;
  description: string;
  duration: string;
  durationType: 'few_hours' | 'full_day' | 'multi_day';
  vibe: string;
  numberOfStops: number;
  days?: DayPlan[];
  searchStrategy: SearchStrategy;
}

export interface DayPlan {
  dayNumber: number;
  theme: string;
  stops: (Venue | Event)[];
  totalDistance?: number;
  totalWalkTime?: number;
}

export interface SearchStrategy {
  type: 'minimal' | 'balanced' | 'comprehensive';
  includeEvents: boolean;
  searchRadius: number;
  maxStops: number;
  priorityMode: 'event_first' | 'venue_first' | 'mixed';
}

export interface AgentMessage {
  fromAgent: string;
  toAgent: string;
  action: string;
  payload: any;
  sessionId: string;
  timestamp: Date;
}

export interface AgentContext {
  // failedSearches: any;
  sessionId: string;
  userPrompt: string;
  location: Location;
  durationType: 'few_hours' | 'full_day' | 'multi_day';
  constraints: any;
  currentPlan?: ItineraryPlan;
  selectedVenues: Venue[];
  selectedEvents: Event[];
}