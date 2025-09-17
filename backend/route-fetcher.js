// backend/route-fetcher.js - FIXED OSM PARSING
import axios from 'axios';

export class RouteFetcher {
  constructor() {
    this.overpassUrl = 'https://overpass-api.de/api/interpreter';
    this.cache = new Map();
  }

  async fetchRoutes(lat, lon, type = 'all', radius = 5000, limit = 5) {
    const cacheKey = `${lat}_${lon}_${type}_${radius}`;
    
    // Check cache first (1 hour TTL)
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < 3600000) {
        console.log('[RouteFetcher] Returning cached routes');
        return cached.data;
      }
    }

    console.log(`[RouteFetcher] Fetching ${type} routes around ${lat},${lon}`);

    const queries = {
      running: `way["route"="running"](around:${radius},${lat},${lon});
                way["leisure"="track"]["sport"="running"](around:${radius},${lat},${lon});`,
      cycling: `way["route"="bicycle"](around:${radius},${lat},${lon});
                way["highway"="cycleway"](around:${radius},${lat},${lon});`,
      hiking: `way["route"="hiking"](around:${radius},${lat},${lon});
               way["highway"="path"]["sac_scale"](around:${radius},${lat},${lon});`,
      walking: `way["highway"="footway"]["name"](around:${radius},${lat},${lon});
                way["highway"="pedestrian"](around:${radius},${lat},${lon});`,
      tourist: `way["route"="tourist"](around:${radius},${lat},${lon});
                node["tourism"="attraction"](around:${radius},${lat},${lon});`,
      all: `way["route"~"running|bicycle|hiking|walking"](around:${radius},${lat},${lon});
            way["highway"~"footway|cycleway|path"]["name"](around:${radius},${lat},${lon});`
    };

    // IMPORTANT: Request full geometry with 'out geom'
    const query = `
      [out:json][timeout:25];
      (
        ${queries[type] || queries.all}
      );
      out body;
      >;
      out skel qt;
    `;

    try {
      const response = await axios.post(this.overpassUrl, query, {
        headers: { 'Content-Type': 'text/plain' },
        timeout: 20000 // 20 second timeout
      });

      const routes = this.parseOSMData(response.data, type, lat, lon);
      
      // SORT BY DISTANCE AND LIMIT TO TOP 5
      const limitedRoutes = this.sortAndLimitRoutes(routes, lat, lon, limit);
      
      // Cache the results
      this.cache.set(cacheKey, {
        data: limitedRoutes,
        timestamp: Date.now()
      });

      console.log(`[RouteFetcher] Found ${routes.length} routes, returning top ${limitedRoutes.length}`);
      
      // Debug: Log first route structure
      if (limitedRoutes.length > 0) {
        console.log('[RouteFetcher] Sample route structure:', {
          name: limitedRoutes[0].name,
          type: limitedRoutes[0].type,
          coordinateCount: limitedRoutes[0].coordinates?.length,
          firstCoord: limitedRoutes[0].coordinates?.[0],
          lastCoord: limitedRoutes[0].coordinates?.[limitedRoutes[0].coordinates.length - 1]
        });
      }
      
      return limitedRoutes;
    } catch (error) {
      console.error('[RouteFetcher] Error fetching routes:', error.message);
      return [];
    }
  }

  parseOSMData(osmData, type, centerLat, centerLon) {
    const routes = [];
    const nodes = new Map();
    const ways = [];

    // Debug log
    console.log(`[RouteFetcher] Parsing OSM data: ${osmData.elements?.length} elements`);

    // First pass: collect all nodes
    osmData.elements.forEach(element => {
      if (element.type === 'node') {
        nodes.set(element.id, {
          lat: element.lat,
          lon: element.lon
        });
      } else if (element.type === 'way') {
        ways.push(element);
      }
    });

    console.log(`[RouteFetcher] Found ${nodes.size} nodes and ${ways.length} ways`);

    // Second pass: build routes from ways
    ways.forEach(way => {
      const coordinates = [];
      
      // Build coordinate array from node references
      if (way.nodes && way.nodes.length > 0) {
        way.nodes.forEach(nodeId => {
          const node = nodes.get(nodeId);
          if (node) {
            // IMPORTANT: Mapbox expects [longitude, latitude] order
            coordinates.push([node.lon, node.lat]);
          }
        });
      }

      // Only create route if we have at least 2 coordinates
      if (coordinates.length > 1) {
        // Calculate route metrics
        let distance = 0;
        let minDistanceToCenter = Infinity;
        
        for (let i = 1; i < coordinates.length; i++) {
          distance += this.calculateDistance(
            coordinates[i-1], 
            coordinates[i]
          );
          
          // Calculate minimum distance to center point
          const distToCenter = this.calculateDistanceToPoint(
            coordinates[i],
            [centerLon, centerLat]
          );
          minDistanceToCenter = Math.min(minDistanceToCenter, distToCenter);
        }

        const routeData = {
          id: way.id,
          type: this.getRouteType(way.tags, type),
          name: way.tags?.name || this.generateRouteName(way.tags, type),
          description: this.generateDescription(way.tags),
          distance: Math.round(distance * 100) / 100, // in km
          distanceToCenter: minDistanceToCenter, // for sorting
          difficulty: this.getDifficulty(way.tags),
          surface: way.tags?.surface || 'unknown',
          coordinates: coordinates, // Array of [lon, lat] pairs
          tags: way.tags || {},
          qualityScore: this.calculateQualityScore(way.tags)
        };

        // Validate route before adding
        if (this.isValidRoute(routeData)) {
          routes.push(routeData);
        } else {
          console.log(`[RouteFetcher] Skipping invalid route: ${routeData.name}`);
        }
      }
    });

    console.log(`[RouteFetcher] Parsed ${routes.length} valid routes`);
    return routes;
  }

  isValidRoute(route) {
    // Check if route has valid coordinates
    if (!route.coordinates || route.coordinates.length < 2) {
      return false;
    }
    
    // Check if coordinates are in valid range
    for (let coord of route.coordinates) {
      if (!Array.isArray(coord) || coord.length !== 2) {
        return false;
      }
      const [lon, lat] = coord;
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        return false;
      }
    }
    
    // Check if route is not too short (at least 100m)
    if (route.distance < 0.1) {
      return false;
    }
    
    return true;
  }

  sortAndLimitRoutes(routes, centerLat, centerLon, limit) {
    // Sort by multiple criteria:
    // 1. Quality score (prefer named, official routes)
    // 2. Distance to center
    // 3. Route length (prefer reasonable lengths)
    
    const sorted = routes.sort((a, b) => {
      // First, prioritize by quality
      const qualityDiff = b.qualityScore - a.qualityScore;
      if (Math.abs(qualityDiff) > 0.2) {
        return qualityDiff;
      }
      
      // Then by distance to center
      const distDiff = a.distanceToCenter - b.distanceToCenter;
      if (Math.abs(distDiff) > 0.5) { // 500m difference
        return distDiff;
      }
      
      // Finally, prefer routes between 2-10km
      const idealLength = 5; // 5km is ideal
      const aLengthDiff = Math.abs(a.distance - idealLength);
      const bLengthDiff = Math.abs(b.distance - idealLength);
      return aLengthDiff - bLengthDiff;
    });
    
    // Return only the top N routes
    return sorted.slice(0, limit);
  }

  calculateQualityScore(tags) {
    let score = 0;
    
    // Named routes are better
    if (tags?.name) score += 0.4;
    
    // Official routes are better
    if (tags?.operator) score += 0.2;
    if (tags?.network) score += 0.2;
    
    // Routes with more information are better
    if (tags?.distance) score += 0.1;
    if (tags?.description) score += 0.1;
    if (tags?.ref) score += 0.1;
    
    // Specific route types are better than generic paths
    if (tags?.route) score += 0.3;
    
    // Surface information is helpful
    if (tags?.surface && tags.surface !== 'unknown') score += 0.1;
    
    return Math.min(score, 1); // Cap at 1
  }

  calculateDistanceToPoint(coord1, coord2) {
    const R = 6371; // Earth's radius in km
    const dLat = (coord2[1] - coord1[1]) * Math.PI / 180;
    const dLon = (coord2[0] - coord1[0]) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(coord1[1] * Math.PI / 180) * Math.cos(coord2[1] * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  getRouteType(tags, requestedType) {
    if (tags?.route) return tags.route;
    if (tags?.highway === 'cycleway') return 'cycling';
    if (tags?.highway === 'footway') return 'walking';
    if (tags?.sport === 'running') return 'running';
    return requestedType;
  }

  generateRouteName(tags, type) {
    if (tags?.ref) return `Route ${tags.ref}`;
    if (tags?.highway) return `${tags.highway} path`;
    return `${type.charAt(0).toUpperCase() + type.slice(1)} route`;
  }

  generateDescription(tags) {
    const parts = [];
    if (tags?.distance) parts.push(`Distance: ${tags.distance}`);
    if (tags?.duration) parts.push(`Duration: ${tags.duration}`);
    if (tags?.ascent) parts.push(`Ascent: ${tags.ascent}m`);
    if (tags?.difficulty) parts.push(`Difficulty: ${tags.difficulty}`);
    return parts.join(' • ') || 'Community-mapped route';
  }

  getDifficulty(tags) {
    if (tags?.difficulty) return tags.difficulty;
    if (tags?.sac_scale) {
      const sacMap = {
        'hiking': 'easy',
        'mountain_hiking': 'moderate',
        'demanding_mountain_hiking': 'hard',
        'alpine_hiking': 'expert'
      };
      return sacMap[tags.sac_scale] || 'moderate';
    }
    return 'easy';
  }

  calculateDistance(coord1, coord2) {
    const R = 6371; // Earth's radius in km
    const dLat = (coord2[1] - coord1[1]) * Math.PI / 180;
    const dLon = (coord2[0] - coord1[0]) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(coord1[1] * Math.PI / 180) * Math.cos(coord2[1] * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }
}