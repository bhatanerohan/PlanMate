// mcp/lib/types.ts - UPDATED WITH LOCAL SEARCH SUPPORT
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
  isLocalSearch?: boolean; // Added for local search support
}

export interface EventSearchParams {
  location: Location;
  radiusKm?: number;
  keywords?: string[];
  timeWindow?: TimeWindow;
  limit?: number;
  isLocalSearch?: boolean; // Added for local search support
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
  distance?: number; // Distance from search center
  photo?: string; // Photo URL
  photoReferences?: string[]; // Additional photo references
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
  isEvent?: boolean; // Marker for events
  lat?: number; // For MapView compatibility
  lng?: number; // For MapView compatibility
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
  isLocalSearch?: boolean; // Added for local search tracking
  searchPoints?: SearchPoint[]; // Added for search points
  totalDistance?: number; // Total walking distance
  totalWalkTime?: number; // Total walking time
  searchRadius?: number; // Search radius used
  maxDistanceFromCenter?: number; // Maximum distance from center point
  distanceWarning?: string; // Warning if distance exceeds limits
  localSearchAdjusted?: boolean; // Flag if adjusted for local search
  removedStopsCount?: number; // Number of stops removed for being too far
}

export interface SearchPoint {
  stopNumber: number;
  type: 'venue' | 'event';
  query: string;
  category?: string;
  location: Location;
  purpose: string;
  estimatedDuration: number;
  isExplicitRequest: boolean;
  dayNumber?: number; // For multi-day trips
  searchRadius?: number; // Individual search radius
  event_keywords?: string[]; // Event-specific keywords
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
  sessionId: string;
  userPrompt: string;
  location: Location;
  durationType: 'few_hours' | 'full_day' | 'multi_day';
  constraints: any;
  currentPlan?: ItineraryPlan;
  selectedVenues: Venue[];
  selectedEvents: Event[];
}

// Additional types for local search support
export interface LocalSearchConstraints {
  maxRadiusKm: number; // Maximum radius from center (default 3km)
  maxWalkBetweenStopsKm: number; // Maximum walk between consecutive stops (default 1.5km)
  preferWalkable: boolean; // Prefer walkable distances
}

export interface QualityValidationResult {
  valid: boolean;
  issue?: string;
  suggestion?: string;
  maxDistanceFromCenter?: string;
  maxWalkDistance?: string;
}

export interface RouteOptimizationResult {
  stops: (Venue | Event)[];
  totalDistance: number;
  totalWalkTime: number;
  averageDistanceBetweenStops: number;
  isLocalSearch?: boolean;
  maxDistanceFromCenter?: number;
  distanceWarning?: string;
}