// frontend/components/MapView.js - FIXED TO SHOW ALL VENUES
'use client';

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Clock, Star, DollarSign, Users, ExternalLink, Navigation, AlertCircle } from 'lucide-react';

// You'll need to get a Mapbox token from https://mapbox.com
mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

export default function MapView({ itinerary }) {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const [selectedVenue, setSelectedVenue] = useState(null);
  const [routeInfo, setRouteInfo] = useState(null);
  const markers = useRef([]);

useEffect(() => {
  console.log('\n🗺️ [MAPVIEW] useEffect triggered');
  console.log('   Itinerary:', itinerary?.title);
  console.log('   Venues count:', itinerary?.venues?.length);
  
  if (map.current) {
    console.log('   🧹 Cleaning up old map');
    markers.current.forEach(marker => marker.remove());
    markers.current = [];
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
  });

  map.current = new mapboxgl.Map({
    container: mapContainer.current,
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [itinerary.venues[0]?.lng || -73.9855, itinerary.venues[0]?.lat || 40.7580],
    zoom: 12
  });
  console.log('   ✅ Map created');
  map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

    // Add ALL venues as markers immediately (don't wait for map load)
    itinerary.venues.forEach((venue, index) => {
      console.log(`Adding marker ${index + 1}:`, venue.name, 'at', venue.lat, venue.lng);
      
      // Create custom marker element
      const el = document.createElement('div');
      el.className = 'custom-marker';
      el.style.width = '40px';
      el.style.height = '40px';
      el.style.cursor = 'pointer';
      el.style.zIndex = 1000 + index; // Ensure markers are on top
      
      // Add inner HTML with styling
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
        .setLngLat([venue.lng, venue.lat])
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
        map.current.flyTo({
          center: [venue.lng, venue.lat],
          zoom: 16,
          pitch: 60,
          duration: 1000
        });
      });

      markers.current.push(marker);
    });

    // Wait for map to load before adding routes and fitting bounds
    map.current.on('load', async () => {
      console.log('Map loaded, adding route...');
      
      // Fetch and draw real walking routes between venues
      const coordinates = itinerary.venues.map(v => [v.lng, v.lat]);
      await drawRealRoute(coordinates);

      // Fit map to show ALL venues with padding
      const bounds = new mapboxgl.LngLatBounds();
      itinerary.venues.forEach(venue => {
        bounds.extend([venue.lng, venue.lat]);
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
      .venue-popup .mapboxgl-popup-content {
        padding: 0;
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      }
    `;
    document.head.appendChild(style);

    return () => {
      style.remove();
      markers.current.forEach(marker => marker.remove());
      markers.current = [];
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, [itinerary]);

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

  return (
    <div className="relative h-full">
      <div ref={mapContainer} className="h-full" />
          {/* ADD THIS DEBUG BUTTON */}
    <button 
      onClick={() => {
        console.log('\n🔍 DEBUG CHECK:');
        console.log('Markers in array:', markers.current.length);
        markers.current.forEach((m, i) => {
          const pos = m.getLngLat();
          console.log(`Marker ${i+1}: ${pos.lat}, ${pos.lng}`);
        });
        console.log('Venues in data:', itinerary?.venues?.length);
        itinerary?.venues?.forEach((v, i) => {
          console.log(`Venue ${i+1}: ${v.name} at ${v.lat}, ${v.lng}`);
        });
      }}
      className="absolute bottom-4 left-4 bg-red-500 text-white px-3 py-2 rounded z-50 text-sm"
    >
      Debug Markers
    </button>
      {/* Data Source Indicator */}
      <div className="absolute top-4 left-4 bg-white rounded-lg shadow-md p-2 text-xs">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${itinerary.dataSource === 'live' ? 'bg-green-500' : 'bg-yellow-500'} animate-pulse`}></div>
          <span className="text-gray-600">
            {itinerary.dataSource === 'live' ? 'Live Data' : 'Demo Mode'}
          </span>
        </div>
      </div>

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

      {/* Venue Details Card */}
      {selectedVenue && (
        <div className="absolute bottom-4 left-4 right-4 bg-white rounded-2xl shadow-2xl p-4 max-w-md mx-auto animate-slide-up">
          <button
            onClick={() => setSelectedVenue(null)}
            className="absolute top-2 right-2 p-1 hover:bg-gray-100 rounded-full"
          >
            ✕
          </button>
          
          {selectedVenue.photo && (
            <img 
              src={selectedVenue.photo} 
              alt={selectedVenue.name}
              className="w-full h-32 object-cover rounded-lg mb-3"
            />
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
            {selectedVenue.crowdLevel && (
              <div className="flex items-center gap-1">
                <Users className="w-4 h-4" />
                <span>{selectedVenue.crowdLevel}</span>
              </div>
            )}
            {selectedVenue.walkTime > 0 && (
              <div className="flex items-center gap-1">
                <Clock className="w-4 h-4" />
                <span>{selectedVenue.walkTime} min walk</span>
              </div>
            )}
          </div>

          {selectedVenue.tips && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-2 mb-3">
              <p className="text-sm text-purple-700">💡 {selectedVenue.tips}</p>
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

      {/* Quick Actions */}
      <div className="absolute top-4 right-4 flex flex-col gap-2">
        <button 
          onClick={() => {
            const url = `${window.location.origin}/itinerary/${Date.now()}`;
            navigator.clipboard.writeText(url);
            alert('Share link copied!');
          }}
          className="bg-white p-2 rounded-lg shadow-lg hover:shadow-xl transition" 
          title="Share"
        >
          🔗
        </button>
        <button 
          onClick={() => window.open(getAllVenuesMapUrl(), '_blank')}
          className="bg-white p-2 rounded-lg shadow-lg hover:shadow-xl transition"
          title="Open in Google Maps"
        >
          🗺️
        </button>
        <button 
          className="bg-white p-2 rounded-lg shadow-lg hover:shadow-xl transition"
          title="Save"
        >
          ⭐
        </button>
      </div>

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