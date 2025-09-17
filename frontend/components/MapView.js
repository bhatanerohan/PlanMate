// frontend/components/MapView.js - COMPLETE VERSION WITH OSM ROUTES
'use client';

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Clock, Star, DollarSign, Users, ExternalLink, Navigation, AlertCircle, Music, Calendar, Ticket, MapPin, Layers, Route, Info } from 'lucide-react';
import toast from 'react-hot-toast';

// You'll need to get a Mapbox token from https://mapbox.com
mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

const getLocationFromStop = (stop) => {
  // Handle both old format (lat, lng) and new format (location: {lat, lng})
  if (stop.location) {
    return { lat: stop.location.lat, lng: stop.location.lng };
  }
  return { lat: stop.lat, lng: stop.lng };
};

export default function MapView({ 
  itinerary, 
  showRoutes = false, 
  routes = [],
  onRoutesRequest 
}) {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const [selectedVenue, setSelectedVenue] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [routeInfo, setRouteInfo] = useState(null);
  const markers = useRef([]);
  const eventMarkers = useRef([]);
  const routeLayers = useRef([]);

  useEffect(() => {
    console.log('\n🗺️ [MAPVIEW] useEffect triggered');
    console.log('   Itinerary:', itinerary?.title);
    console.log('   Venues count:', itinerary?.venues?.length);
    
    if (map.current) {
      console.log('   🧹 Cleaning up old map');
      markers.current.forEach(marker => marker.remove());
      eventMarkers.current.forEach(marker => marker.remove());
      markers.current = [];
      eventMarkers.current = [];
      removeOSMRoutes();
      map.current.remove();
      map.current = null;
    }

    if (!itinerary?.venues || itinerary.venues.length === 0) {
      console.log('   ⚠️ No venues, exiting');
      return;
    }

    console.log('\n📍 [MAPVIEW] Creating map with venues:');
    itinerary.venues.forEach((v, i) => {
      console.log(`   ${i+1}. ${v.name} at (${v.lat}, ${v.lng})`);
      if (v.nearbyEvents?.length) {
        console.log(`      📌 Has ${v.nearbyEvents.length} nearby events (next 5 days)`);
      }
    });

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [itinerary.venues[0]?.lng || -73.9855, itinerary.venues[0]?.lat || 40.7580],
      zoom: 12
    });
    console.log('   ✅ Map created');
    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

    // Add ALL main venues as markers
    itinerary.venues.forEach((venue, index) => {
      const loc = getLocationFromStop(venue); 
      console.log(`Adding marker ${index + 1}:`, venue.name, 'at', venue.lat, venue.lng);
      
      // Create custom marker element for main venues
      const el = document.createElement('div');
      el.className = 'custom-marker';
      el.style.width = '40px';
      el.style.height = '40px';
      el.style.cursor = 'pointer';
      el.style.zIndex = 1000 + index;
      
      // Add inner HTML with styling for main venues
      el.innerHTML = `
        <div style="
          width: 100%;
          height: 100%;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 6px rgba(0,0,0,0.2);
          border: 3px solid white;
          position: relative;
        ">
          <span style="
            color: white;
            font-weight: bold;
            font-size: 16px;
          ">${venue.order || index + 1}</span>
        </div>
      `;

      // Add pulse animation for first venue
      if (index === 0) {
        el.style.animation = 'pulse 2s infinite';
      }

      // Create marker and add to map
      const marker = new mapboxgl.Marker(el, { 
        anchor: 'center',
        offset: [0, 0] 
      })
        .setLngLat([loc.lng, loc.lat])
        .addTo(map.current);

      // Add popup on hover
      const popup = new mapboxgl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 25,
        className: 'venue-popup'
      });

      el.addEventListener('mouseenter', () => {
        popup.setLngLat([venue.lng, venue.lat])
          .setHTML(`
            <div style="padding: 8px; font-family: system-ui; background: white;">
              <strong style="color: #000; font-size: 14px;">${venue.name}</strong><br/>
              <span style="color: #666; font-size: 12px;">${venue.category}</span>
              ${venue.nearbyEvents?.length ? `<br/><span style="color: #7c3aed; font-size: 11px;">🎟️ ${venue.nearbyEvents.length} events nearby (5 days)</span>` : ''}
            </div>
          `)
          .addTo(map.current);
      });

      el.addEventListener('mouseleave', () => {
        popup.remove();
      });

      // Add click handler
      el.addEventListener('click', () => {
        setSelectedVenue(venue);
        setSelectedEvent(null);
        setSelectedRoute(null);
        map.current.flyTo({
          center: [venue.lng, venue.lat],
          zoom: 16,
          duration: 1000
        });
      });

      markers.current.push(marker);

      // Add nearby event markers for this venue
      if (venue.nearbyEvents && venue.nearbyEvents.length > 0) {
        console.log(`   Adding ${venue.nearbyEvents.length} event markers for ${venue.name}:`);
        
        venue.nearbyEvents.forEach((event, eventIdx) => {
          // USE ACTUAL EVENT COORDINATES
          let eventLat, eventLng;
          
          if (event.lat && event.lng) {
            // Use real coordinates from the event
            eventLat = event.lat;
            eventLng = event.lng;
            console.log(`      Event ${eventIdx + 1}: "${event.name}" at real location (${eventLat}, ${eventLng})`);
          } else {
            // Fallback to circle pattern if no coordinates (shouldn't happen with Ticketmaster data)
            console.log(`      Event ${eventIdx + 1}: "${event.name}" - No coordinates, using circle pattern`);
            const angle = (eventIdx / venue.nearbyEvents.length) * 2 * Math.PI;
            const radius = 0.003; // About 300m at this latitude
            eventLat = venue.lat + radius * Math.sin(angle);
            eventLng = venue.lng + radius * Math.cos(angle);
          }

          // Calculate actual distance from venue to event
          const distance = event.lat && event.lng ? 
            Math.round(calculateDistance(venue.lat, venue.lng, event.lat, event.lng) * 1000) : 
            null;

          // Create event marker with different style
          const eventEl = document.createElement('div');
          eventEl.className = 'event-marker';
          eventEl.style.width = '30px';
          eventEl.style.height = '30px';
          eventEl.style.cursor = 'pointer';
          eventEl.style.zIndex = 900 + eventIdx;
          eventEl.style.transition = 'transform 0.2s';
          
          // Different colors based on event type
          let bgColor = '#ef4444'; // Red default
          let icon = '🎵'; // Default music icon
          
          if (event.eventType?.toLowerCase().includes('sport')) {
            bgColor = '#10b981';
            icon = '⚽';
          } else if (event.eventType?.toLowerCase().includes('comedy')) {
            bgColor = '#f59e0b';
            icon = '😄';
          } else if (event.eventType?.toLowerCase().includes('theatre') || event.eventType?.toLowerCase().includes('theater')) {
            bgColor = '#8b5cf6';
            icon = '🎭';
          } else if (event.eventType?.toLowerCase().includes('family')) {
            bgColor = '#3b82f6';
            icon = '👨‍👩‍👧‍👦';
          }
          
          eventEl.innerHTML = `
            <div style="
              width: 100%;
              height: 100%;
              background: ${bgColor};
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              box-shadow: 0 2px 4px rgba(0,0,0,0.2);
              border: 2px solid white;
              opacity: 0.85;
              font-size: 14px;
            " onmouseover="this.style.transform='scale(1.2)'" onmouseout="this.style.transform='scale(1)'">${icon}</div>
          `;

          // Create marker for event at its actual location
          const eventMarker = new mapboxgl.Marker(eventEl, { 
            anchor: 'center',
            offset: [0, 0] 
          })
            .setLngLat([eventLng, eventLat])
            .addTo(map.current);

          // Add popup on hover for event
          const eventPopup = new mapboxgl.Popup({
            closeButton: false,
            closeOnClick: false,
            offset: 20,
            className: 'event-popup'
          });

          eventEl.addEventListener('mouseenter', () => {
            const eventDate = event.startDate ? new Date(event.startDate) : null;
            const daysFromNow = eventDate ? 
              Math.ceil((eventDate - new Date()) / (1000 * 60 * 60 * 24)) : null;
            
            eventPopup.setLngLat([eventLng, eventLat])
              .setHTML(`
                <div style="padding: 10px; font-family: system-ui; background: white; max-width: 250px;">
                  <strong style="color: #000; font-size: 13px;">${event.name}</strong><br/>
                  <span style="color: #666; font-size: 11px;">${event.eventType}</span><br/>
                  ${eventDate ? `<span style="color: #7c3aed; font-size: 11px;">📅 ${eventDate.toLocaleDateString()} at ${eventDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span><br/>` : ''}
                  ${daysFromNow !== null ? `<span style="color: #0ea5e9; font-size: 11px;">⏰ In ${daysFromNow} day${daysFromNow !== 1 ? 's' : ''}</span><br/>` : ''}
                  <span style="color: #059669; font-size: 11px;">💵 ${event.price}</span><br/>
                  <span style="color: #dc2626; font-size: 11px;">📍 ${event.venueName || 'Venue'}</span>
                  ${distance !== null ? `<br/><span style="color: #6b7280; font-size: 11px;">📏 ${distance}m from ${venue.name}</span>` : ''}
                  ${event.soldOut ? '<br/><span style="color: #dc2626; font-size: 11px; font-weight: bold;">SOLD OUT</span>' : '<br/><span style="color: #059669; font-size: 11px;">🎫 Tickets Available</span>'}
                </div>
              `)
              .addTo(map.current);
          });

          eventEl.addEventListener('mouseleave', () => {
            eventPopup.remove();
          });

          // Add click handler for event
          eventEl.addEventListener('click', () => {
            setSelectedEvent(event);
            setSelectedVenue(null);
            setSelectedRoute(null);
            map.current.flyTo({
              center: [eventLng, eventLat],
              zoom: 17,
              duration: 800
            });
          });

          eventMarkers.current.push(eventMarker);
        });
      }
    });

    // Helper function to calculate distance between two points
    function calculateDistance(lat1, lon1, lat2, lon2) {
      const R = 6371; // Radius of the Earth in km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return R * c; // Distance in km
    }

    // Wait for map to load before adding routes and fitting bounds
    map.current.on('load', async () => {
      console.log('Map loaded, adding route...');
      
      // Fetch and draw real walking routes between venues
      const coordinates = itinerary.venues.map(v => [v.lng, v.lat]);
      await drawRealRoute(coordinates);

      // ADD ROUTE DISPLAY LOGIC
      if (showRoutes && routes.length > 0) {
        displayOSMRoutes(routes);
      }

      // Fit map to show ALL venues AND events with padding
      const bounds = new mapboxgl.LngLatBounds();
      
      // Add all venue locations
      itinerary.venues.forEach(venue => {
        bounds.extend([venue.lng, venue.lat]);
        
        // Also add event locations to bounds
        if (venue.nearbyEvents) {
          venue.nearbyEvents.forEach(event => {
            if (event.lat && event.lng) {
              bounds.extend([event.lng, event.lat]);
            }
          });
        }
      });
      
      // Fit bounds with good padding to see all markers
      map.current.fitBounds(bounds, { 
        padding: { top: 100, bottom: 100, left: 100, right: 100 },
        duration: 1000
      });
    });

    // Function to fetch and draw real routes
    async function drawRealRoute(waypoints) {
      if (!mapboxgl.accessToken || mapboxgl.accessToken === 'YOUR_MAPBOX_TOKEN_HERE') {
        console.log('No valid Mapbox token, drawing simple lines');
        drawFallbackRoute(waypoints);
        return;
      }

      try {
        // Build the Mapbox Directions API URL
        const coordinates = waypoints.map(coord => coord.join(',')).join(';');
        const url = `https://api.mapbox.com/directions/v5/mapbox/walking/${coordinates}?geometries=geojson&steps=true&access_token=${mapboxgl.accessToken}`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.routes && data.routes[0]) {
          const route = data.routes[0];
          
          // Store route info
          setRouteInfo({
            distance: (route.distance / 1000).toFixed(2), // Convert to km
            duration: Math.round(route.duration / 60), // Convert to minutes
          });

          // Add the route as a layer
          if (map.current.getSource('route')) {
            map.current.removeLayer('route');
            map.current.removeLayer('routearrows');
            map.current.removeSource('route');
          }

          map.current.addSource('route', {
            type: 'geojson',
            data: {
              type: 'Feature',
              properties: {},
              geometry: route.geometry
            }
          });

          // Add the route layer with gradient effect
          map.current.addLayer({
            id: 'route',
            type: 'line',
            source: 'route',
            layout: {
              'line-join': 'round',
              'line-cap': 'round'
            },
            paint: {
              'line-color': '#764ba2',
              'line-width': 5,
              'line-opacity': 0.7
            }
          });

          // Add direction arrows
          map.current.addLayer({
            id: 'routearrows',
            type: 'symbol',
            source: 'route',
            layout: {
              'symbol-placement': 'line',
              'text-field': '▶',
              'text-size': ['interpolate', ['linear'], ['zoom'], 12, 12, 22, 20],
              'symbol-spacing': ['interpolate', ['linear'], ['zoom'], 12, 30, 22, 100],
              'text-keep-upright': false,
              'text-rotation-alignment': 'map',
              'text-pitch-alignment': 'viewport',
              'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular']
            },
            paint: {
              'text-color': '#764ba2',
              'text-halo-color': 'white',
              'text-halo-width': 2
            }
          });
        }
      } catch (error) {
        console.error('Error fetching route:', error);
        drawFallbackRoute(waypoints);
      }
    }

    // Fallback function for simple lines
    function drawFallbackRoute(waypoints) {
      if (!map.current.getSource('route')) {
        map.current.addSource('route', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: waypoints
            }
          }
        });

        map.current.addLayer({
          id: 'route',
          type: 'line',
          source: 'route',
          layout: {
            'line-join': 'round',
            'line-cap': 'round'
          },
          paint: {
            'line-color': '#764ba2',
            'line-width': 4,
            'line-opacity': 0.6,
            'line-dasharray': [2, 1]
          }
        });
      }
    }

    // Add CSS for pulse animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulse {
        0% {
          box-shadow: 0 0 0 0 rgba(102, 126, 234, 0.7);
        }
        70% {
          box-shadow: 0 0 0 10px rgba(102, 126, 234, 0);
        }
        100% {
          box-shadow: 0 0 0 0 rgba(102, 126, 234, 0);
        }
      }
      .venue-popup {
        font-family: system-ui, -apple-system, sans-serif;
      }
      .venue-popup .mapboxgl-popup-content,
      .event-popup .mapboxgl-popup-content {
        padding: 0;
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      }
      .event-marker:hover {
        transform: scale(1.2);
      }
    `;
    document.head.appendChild(style);

    return () => {
      style.remove();
      markers.current.forEach(marker => marker.remove());
      eventMarkers.current.forEach(marker => marker.remove());
      markers.current = [];
      eventMarkers.current = [];
      removeOSMRoutes();
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, [itinerary]);

  // ADD NEW EFFECT for route updates
  useEffect(() => {
    if (!map.current || !map.current.loaded()) return;

    if (showRoutes && routes.length > 0) {
      displayOSMRoutes(routes);
    } else {
      removeOSMRoutes();
    }
  }, [showRoutes, routes]);

  // ADD FUNCTION to display OSM routes
  const displayOSMRoutes = (routes) => {
  console.log(`[MapView] Displaying ${routes.length} OSM routes`);
  console.log('[MapView] First route sample:', routes[0]); // Debug log
  
  // Remove existing route layers first
  removeOSMRoutes();

  // Check if map is loaded
  if (!map.current || !map.current.loaded()) {
    console.log('[MapView] Map not loaded yet, waiting...');
    map.current.once('load', () => displayOSMRoutes(routes));
    return;
  }

  routes.forEach((route, index) => {
    // Validate route data
    if (!route.coordinates || route.coordinates.length < 2) {
      console.warn(`[MapView] Skipping route ${route.id} - invalid coordinates`);
      return;
    }

    const sourceId = `osm-route-${route.id || index}`;
    const layerId = `osm-route-layer-${route.id || index}`;
    
    console.log(`[MapView] Adding route ${route.name} with ${route.coordinates.length} points`);
    
    // Create GeoJSON from route coordinates
    const routeGeoJSON = {
      type: 'Feature',
      properties: {
        id: 0, // Add ID for feature state
        name: route.name || 'Unnamed Route',
        type: route.type || 'unknown',
        distance: route.distance || 0,
        difficulty: route.difficulty || 'unknown'
      },
      geometry: {
        type: 'LineString',
        coordinates: route.coordinates // Should be [[lng, lat], [lng, lat], ...]
      }
    };

    // Validate coordinates format
    const firstCoord = route.coordinates[0];
    if (!Array.isArray(firstCoord) || firstCoord.length !== 2) {
      console.error(`[MapView] Invalid coordinate format for route ${route.id}`);
      return;
    }

    try {
      // Add source
      if (!map.current.getSource(sourceId)) {
        map.current.addSource(sourceId, {
          type: 'geojson',
          data: routeGeoJSON
        });
      } else {
        // Update existing source
        map.current.getSource(sourceId).setData(routeGeoJSON);
      }

      // Route type colors
      const routeColors = {
        running: '#FF6B6B',
        cycling: '#4ECDC4',
        walking: '#95E77E',
        hiking: '#DDA15E',
        tourist: '#A78BFA',
        default: '#6B7280'
      };

      // Add layer
      if (!map.current.getLayer(layerId)) {
        map.current.addLayer({
          id: layerId,
          type: 'line',
          source: sourceId,
          layout: {
            'line-join': 'round',
            'line-cap': 'round'
          },
          paint: {
            'line-color': routeColors[route.type] || routeColors.default,
            'line-width': 4,
            'line-opacity': 0.8
          }
        });

        // Add hover effect
        let hoverId = null;
        
        map.current.on('mouseenter', layerId, (e) => {
          map.current.getCanvas().style.cursor = 'pointer';
          
          // Show popup on hover
          const coordinates = e.lngLat;
          const description = `
            <div style="padding: 8px;">
              <strong>${route.name}</strong><br/>
              Type: ${route.type}<br/>
              Distance: ${route.distance} km<br/>
              ${route.difficulty !== 'unknown' ? `Difficulty: ${route.difficulty}` : ''}
            </div>
          `;
          
          new mapboxgl.Popup({
            closeButton: false,
            closeOnClick: false
          })
            .setLngLat(coordinates)
            .setHTML(description)
            .addTo(map.current);
        });

        map.current.on('mouseleave', layerId, () => {
          map.current.getCanvas().style.cursor = '';
          // Remove popups
          const popups = document.getElementsByClassName('mapboxgl-popup');
          for (let popup of popups) {
            popup.remove();
          }
        });

        // Add click handler
        map.current.on('click', layerId, (e) => {
          e.originalEvent.cancelBubble = true; // Prevent other click handlers
          
          setSelectedRoute(route);
          setSelectedVenue(null);
          setSelectedEvent(null);
          
          // Zoom to route bounds
          const bounds = new mapboxgl.LngLatBounds();
          route.coordinates.forEach(coord => {
            bounds.extend(coord);
          });
          map.current.fitBounds(bounds, { 
            padding: 100,
            duration: 1000
          });
        });

        routeLayers.current.push({ sourceId, layerId });
        console.log(`[MapView] Successfully added route layer: ${layerId}`);
      }
    } catch (error) {
      console.error(`[MapView] Error adding route ${route.id}:`, error);
    }
  });

  // Log success
  if (routes.length > 0) {
    console.log(`[MapView] Successfully displayed ${routeLayers.current.length} routes`);
    
    // Optionally zoom to show all routes
    const bounds = new mapboxgl.LngLatBounds();
    let hasValidBounds = false;
    
    routes.forEach(route => {
      if (route.coordinates && route.coordinates.length > 0) {
        route.coordinates.forEach(coord => {
          if (Array.isArray(coord) && coord.length === 2) {
            bounds.extend(coord);
            hasValidBounds = true;
          }
        });
      }
    });
    
    if (hasValidBounds) {
      map.current.fitBounds(bounds, { 
        padding: 100,
        duration: 1000
      });
    }
  }
};

  // ADD FUNCTION to remove OSM routes
  const removeOSMRoutes = () => {
    if (!map.current) return;
    
    routeLayers.current.forEach(({ sourceId, layerId }) => {
      if (map.current.getLayer(layerId)) {
        map.current.removeLayer(layerId);
      }
      if (map.current.getSource(sourceId)) {
        map.current.removeSource(sourceId);
      }
    });
    routeLayers.current = [];
    setSelectedRoute(null);
  };

  // Generate Google Maps directions URL
  const getDirectionsUrl = (venue) => {
    const destination = `${venue.lat},${venue.lng}`;
    return `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=walking`;
  };

  // Generate Google Maps URL with all venues
  const getAllVenuesMapUrl = () => {
    if (!itinerary?.venues) return '';
    const waypoints = itinerary.venues.map(v => `${v.lat},${v.lng}`).join('/');
    return `https://www.google.com/maps/dir/${waypoints}`;
  };

  // Count total nearby events
  const totalNearbyEvents = itinerary?.venues?.reduce((acc, venue) => 
    acc + (venue.nearbyEvents?.length || 0), 0) || 0;

  return (
    <div className="relative h-full">
      <div ref={mapContainer} className="h-full" />

      {/* Event Discovery Indicator */}
      {totalNearbyEvents > 0 && (
        <div className="absolute top-4 left-4 bg-white rounded-lg shadow-md p-2">
          <div className="flex items-center gap-2">
            <Music className="w-4 h-4 text-purple-600 animate-pulse" />
            <span className="text-sm text-gray-700">
              {totalNearbyEvents} events nearby (next 5 days)
            </span>
          </div>
        </div>
      )}

      {/* ADD ROUTE LEGEND */}
      {showRoutes && routes.length > 0 && (
        <div className="absolute top-4 right-4 bg-white rounded-lg shadow-md p-3 max-w-xs">
          <h3 className="font-bold text-sm mb-2 text-gray-900 flex items-center gap-2">
            <Route className="w-4 h-4" />
            Available Routes ({routes.length})
          </h3>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs">
              <div className="w-3 h-3 bg-red-400 rounded"></div>
              <span className="text-gray-700">Running</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <div className="w-3 h-3 bg-teal-400 rounded"></div>
              <span className="text-gray-700">Cycling</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <div className="w-3 h-3 bg-green-400 rounded"></div>
              <span className="text-gray-700">Walking</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <div className="w-3 h-3 bg-orange-400 rounded"></div>
              <span className="text-gray-700">Hiking</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <div className="w-3 h-3 bg-purple-400 rounded"></div>
              <span className="text-gray-700">Tourist</span>
            </div>
          </div>
        </div>
      )}

      {/* Venue List Panel */}
      <div className="absolute top-16 left-4 bg-white rounded-xl shadow-lg p-3 max-w-xs">
        <h3 className="font-bold text-sm mb-2 text-gray-900">{itinerary.title}</h3>
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {itinerary.venues?.map((venue, idx) => (
            <div 
              key={idx}
              className="flex items-center gap-2 text-xs text-gray-800 cursor-pointer hover:bg-gray-50 p-1 rounded"
              onClick={() => {
                setSelectedVenue(venue);
                setSelectedEvent(null);
                setSelectedRoute(null);
                map.current.flyTo({
                  center: [venue.lng, venue.lat],
                  zoom: 16
                });
              }}
            >
              <div className="w-6 h-6 bg-purple-600 text-white rounded-full flex items-center justify-center text-xs font-bold">
                {venue.order}
              </div>
              <span className="flex-1 truncate">{venue.name}</span>
              {venue.nearbyEvents?.length > 0 && (
                <span className="text-purple-500 text-xs">
                  🎟️ {venue.nearbyEvents.length}
                </span>
              )}
            </div>
          ))}
        </div>
        <div className="mt-2 pt-2 border-t flex items-center gap-3 text-xs text-gray-600">
          <span>📍 {itinerary.venues?.length} stops</span>
          {routeInfo ? (
            <>
              <span>🚶 {routeInfo.duration} min</span>
              <span>📏 {routeInfo.distance} km</span>
            </>
          ) : (
            <>
              <span>🚶 {itinerary.totalWalkTime} min</span>
              <span>📏 {itinerary.totalDistance} km</span>
            </>
          )}
        </div>
      </div>

      {/* ADD SELECTED ROUTE CARD */}
      {selectedRoute && (
        <div className="absolute bottom-4 left-4 right-4 bg-white rounded-2xl shadow-2xl p-4 max-w-md mx-auto animate-slide-up">
          <button
            onClick={() => setSelectedRoute(null)}
            className="absolute top-2 right-2 p-1 hover:bg-gray-100 rounded-full"
          >
            ✕
          </button>
          
          <div className="flex items-start justify-between mb-2">
            <div>
              <h3 className="font-bold text-lg text-gray-900">{selectedRoute.name}</h3>
              <p className="text-sm text-gray-600 capitalize">{selectedRoute.type} Route</p>
            </div>
            <div className={`px-2 py-1 rounded-full text-sm font-bold ${
              selectedRoute.type === 'running' ? 'bg-red-100 text-red-700' :
              selectedRoute.type === 'cycling' ? 'bg-teal-100 text-teal-700' :
              selectedRoute.type === 'walking' ? 'bg-green-100 text-green-700' :
              selectedRoute.type === 'hiking' ? 'bg-orange-100 text-orange-700' :
              'bg-purple-100 text-purple-700'
            }`}>
              {selectedRoute.distance} km
            </div>
          </div>

          <div className="flex items-center gap-4 text-sm text-gray-600 mb-3">
            <div className="flex items-center gap-1">
              <Info className="w-4 h-4" />
              <span>Difficulty: {selectedRoute.difficulty}</span>
            </div>
            {selectedRoute.surface !== 'unknown' && (
              <div className="flex items-center gap-1">
                <Layers className="w-4 h-4" />
                <span>Surface: {selectedRoute.surface}</span>
              </div>
            )}
          </div>

          {selectedRoute.description && (
            <p className="text-sm text-gray-500 mb-3">{selectedRoute.description}</p>
          )}

          <div className="flex gap-2">
            <button 
              onClick={() => {
                // Implement navigation to route start
                const firstCoord = selectedRoute.coordinates[0];
                window.open(
                  `https://www.google.com/maps/dir/?api=1&destination=${firstCoord[1]},${firstCoord[0]}&travelmode=walking`,
                  '_blank'
                );
              }}
              className="flex-1 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition flex items-center justify-center gap-2"
            >
              <Navigation className="w-4 h-4" />
              Navigate to Start
            </button>
          </div>
        </div>
      )}

      {/* Selected Event Card */}
      {selectedEvent && (
        <div className="absolute bottom-4 left-4 right-4 bg-white rounded-2xl shadow-2xl p-4 max-w-md mx-auto animate-slide-up">
          <button
            onClick={() => setSelectedEvent(null)}
            className="absolute top-2 right-2 p-1 hover:bg-gray-100 rounded-full"
          >
            ✕
          </button>
          
          {selectedEvent.imageUrl && (
            <img 
              src={selectedEvent.imageUrl} 
              alt={selectedEvent.name}
              className="w-full h-32 object-cover rounded-lg mb-3"
            />
          )}
          
          <div className="flex items-start justify-between mb-2">
            <div>
              <h3 className="font-bold text-lg text-gray-900">{selectedEvent.name}</h3>
              <p className="text-sm text-gray-600">{selectedEvent.eventType}</p>
            </div>
            <div className="bg-red-100 text-red-700 px-2 py-1 rounded-full text-sm font-bold">
              Event
            </div>
          </div>

          <div className="flex items-center gap-4 text-sm text-gray-600 mb-3">
            {selectedEvent.startDate && (
              <div className="flex items-center gap-1">
                <Calendar className="w-4 h-4" />
                <span>{new Date(selectedEvent.startDate).toLocaleDateString()}</span>
              </div>
            )}
            {selectedEvent.price && (
              <div className="flex items-center gap-1">
                <DollarSign className="w-4 h-4" />
                <span>{selectedEvent.price}</span>
              </div>
            )}
            {selectedEvent.venueName && (
              <div className="flex items-center gap-1">
                <MapPin className="w-4 h-4" />
                <span>{selectedEvent.venueName}</span>
              </div>
            )}
          </div>

          {selectedEvent.soldOut ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-2 mb-3">
              <p className="text-sm text-red-700">🚫 This event is sold out</p>
            </div>
          ) : (
            <div className="bg-green-50 border border-green-200 rounded-lg p-2 mb-3">
              <p className="text-sm text-green-700">🎫 Tickets available!</p>
            </div>
          )}

          {selectedEvent.description && (
            <p className="text-xs text-gray-500 mb-3">{selectedEvent.description}</p>
          )}

          {/* UPDATED BUTTONS SECTION */}
          <div className="flex gap-2">
            {(selectedEvent.eventUrl || selectedEvent.url) ? (
              <>
                <button 
                  onClick={() => window.open(selectedEvent.eventUrl || selectedEvent.url, '_blank')}
                  className="flex-1 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition flex items-center justify-center gap-2"
                >
                  <Ticket className="w-4 h-4" />
                  Get Tickets
                </button>
                <button 
                  onClick={() => window.open(selectedEvent.eventUrl || selectedEvent.url, '_blank')}
                  className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition flex items-center justify-center gap-2"
                >
                  <ExternalLink className="w-4 h-4" />
                  Visit Ticketmaster
                </button>
              </>
            ) : (
              <div className="w-full bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-center">
                <Info className="w-4 h-4 inline mr-2" />
                No ticket link available
              </div>
            )}
          </div>
        </div>
      )}

      {/* Venue Details Card */}
      {selectedVenue && !selectedEvent && (
        <div className="absolute bottom-4 left-4 right-4 bg-white rounded-2xl shadow-2xl p-4 max-w-md mx-auto animate-slide-up">
          <button
            onClick={() => setSelectedVenue(null)}
            className="absolute top-2 right-2 p-1 hover:bg-gray-100 rounded-full"
          >
            ✕
          </button>
          
          {/* VENUE PHOTO - This should now work! */}
          {selectedVenue.photo ? (
            <img 
              src={selectedVenue.photo} 
              alt={selectedVenue.name}
              className="w-full h-32 object-cover rounded-lg mb-3"
              onError={(e) => {
                // Fallback if image fails to load
                e.target.style.display = 'none';
              }}
            />
          ) : (
            // Placeholder when no photo available
            <div className="w-full h-32 bg-gradient-to-br from-purple-100 to-blue-100 rounded-lg mb-3 flex items-center justify-center">
              <MapPin className="w-12 h-12 text-purple-400" />
            </div>
          )}          
          <div className="flex items-start justify-between mb-2">
            <div>
              <h3 className="font-bold text-lg text-gray-900">{selectedVenue.name}</h3>
              <p className="text-sm text-gray-600">{selectedVenue.category}</p>
            </div>
            <div className="bg-purple-100 text-purple-700 px-2 py-1 rounded-full text-sm font-bold">
              #{selectedVenue.order}
            </div>
          </div>

          <div className="flex items-center gap-4 text-sm text-gray-600 mb-3">
            {selectedVenue.rating && (
              <div className="flex items-center gap-1">
                <Star className="w-4 h-4 text-amber-500" />
                <span>{selectedVenue.rating}</span>
              </div>
            )}
            {selectedVenue.price && (
              <div className="flex items-center gap-1">
                <DollarSign className="w-4 h-4" />
                <span>{selectedVenue.price}</span>
              </div>
            )}
            {selectedVenue.walkTime > 0 && (
              <div className="flex items-center gap-1">
                <Clock className="w-4 h-4" />
                <span>{selectedVenue.walkTime} min walk</span>
              </div>
            )}
          </div>

          {selectedVenue.nearbyEvents && selectedVenue.nearbyEvents.length > 0 && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-2 mb-3">
              <p className="text-sm text-purple-700 font-semibold mb-1">
                🎟️ {selectedVenue.nearbyEvents.length} events happening nearby (5 days):
              </p>
              <div className="space-y-1">
                {selectedVenue.nearbyEvents.slice(0, 3).map((event, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs">
                    <span className="text-purple-600">
                      • {event.name} - {event.price}
                    </span>
                    {event.url && (
                      <button
                        onClick={() => window.open(event.url, '_blank')}
                        className="text-purple-700 hover:text-purple-900 underline ml-2"
                      >
                        View
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedVenue.tips && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-2 mb-3">
              <p className="text-sm text-blue-700">💡 {selectedVenue.tips}</p>
            </div>
          )}

          {selectedVenue.address && (
            <p className="text-xs text-gray-500 mb-3">{selectedVenue.address}</p>
          )}

          <div className="flex gap-2">
            {selectedVenue.bookable && (
              <button className="flex-1 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition flex items-center justify-center gap-2">
                <ExternalLink className="w-4 h-4" />
                Book Now
              </button>
            )}
            <button 
              onClick={() => window.open(getDirectionsUrl(selectedVenue), '_blank')}
              className="flex-1 bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition flex items-center justify-center gap-2"
            >
              <Navigation className="w-4 h-4" />
              Get Directions
            </button>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes slide-up {
          from {
            transform: translateY(100%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
        .animate-slide-up {
          animation: slide-up 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}