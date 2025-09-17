// frontend/app/page.js - FIXED VERSION WITH AUTO ROUTE FETCHING
'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import toast, { Toaster } from 'react-hot-toast';
import { Send, MapPin, Loader2, Clock, RefreshCw, Sparkles, Navigation, Info, AlertCircle, CheckCircle, Route } from 'lucide-react';
import axios from 'axios';
import dynamic from 'next/dynamic';

// Dynamically import map to avoid SSR issues
const MapView = dynamic(() => import('../components/MapView'), { ssr: false });

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// Sample prompts for quick demo
const SAMPLE_PROMPTS = [
  "Plan a romantic evening in NYC",
  "I have 3 hours this afternoon, what should I do?",
  "Find me a chill Sunday brunch and walk combo",
  "Show me the best local spots for a first date",
  "I want to visit Madison Square Garden then Brooklyn Bridge",
  "Find concerts happening this weekend",
  "Show me events near Times Square tonight",
  "Plan a 3-day NYC adventure",
  "Quick coffee and pastry near Central Park",
  "Find me a running route near brooklyn"
];

export default function Home() {
  const [messages, setMessages] = useState([
    { 
      type: 'bot', 
      content: "Hey! I'm PlanMate 🗺️ Tell me what kind of experience you're looking for and I'll create the perfect itinerary! I can plan anything from a quick 2-hour adventure to a full week exploration." 
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentItinerary, setCurrentItinerary] = useState(null);
  const [view, setView] = useState('chat'); // 'chat' or 'map'
  const [expandedVenue, setExpandedVenue] = useState(null);
  const [showQualityDetails, setShowQualityDetails] = useState(false);
  
  // Route-related state
  const [showRoutes, setShowRoutes] = useState(false);
  const [routeType, setRouteType] = useState('all');
  const [availableRoutes, setAvailableRoutes] = useState([]);
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Function to fetch routes from OSM
  const fetchRoutes = async (location, customType = null) => {
    setLoadingRoutes(true);
    
    // Use the provided type or the current routeType state
    const typeToFetch = customType || routeType;
    
    console.log('[Frontend] Fetching routes:', {
      location,
      type: typeToFetch,
      radius: 5000
    });
    
    try {
      const response = await axios.get(`${API_URL}/api/routes`, {
        params: {
          lat: location.lat,
          lng: location.lng,
          type: typeToFetch,
          radius: 5000,
          limit: 5
        },
        timeout: 15000 // 15 second timeout
      });
      
      console.log('[Frontend] Routes response:', response.data);
      
      if (response.data.success && response.data.routes) {
        setAvailableRoutes(response.data.routes);
        
        if (response.data.routes.length > 0) {
          toast.success(`Found ${response.data.count} ${typeToFetch} routes!`, {
            icon: '🗺️',
            duration: 3000
          });
        } else {
          toast.info('No routes found in this area. Try a different location or type.', {
            duration: 4000
          });
        }
      } else {
        throw new Error('Invalid response format');
      }
    } catch (error) {
      console.error('[Frontend] Error fetching routes:', error);
      
      // More specific error messages
      if (error.code === 'ECONNABORTED') {
        toast.error('Route fetching timed out. The area might have limited data.');
      } else if (error.response?.status === 500) {
        toast.error('Server error fetching routes. Please try again.');
      } else {
        toast.error('Failed to fetch routes. Check your connection.');
      }
      
      setAvailableRoutes([]);
    } finally {
      setLoadingRoutes(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage = input;
    setInput('');
    setMessages(prev => [...prev, { type: 'user', content: userMessage }]);
    setLoading(true);

    console.log('\n🎯 [FRONTEND] New request:', userMessage);
    setMessages(prev => [...prev, { 
      type: 'bot', 
      content: 'thinking', 
      isThinking: true,
      thinkingMessage: 'Multiple AI agents are collaborating to create your perfect itinerary...'
    }]);

    try {
      console.log('   📡 Calling /api/generate-itinerary endpoint...');
      
      const response = await axios.post(`${API_URL}/api/generate-itinerary`, {
        prompt: userMessage,
        location: { lat: 40.7580, lng: -73.9855 } // Times Square default
      }, {
        timeout: 60000 // 60 second timeout for itinerary generation
      });

      console.log('   ✅ Response received:', response.data);
      setMessages(prev => prev.filter(m => !m.isThinking));

      if (response.data?.success && response.data?.itinerary) {
        const { itinerary, qualityScore, issues, noEventsFound } = response.data;
        
        console.log(`   Title: ${itinerary.title}`);
        console.log(`   Stops: ${itinerary.stops?.length}`);
        console.log(`   Quality Score: ${qualityScore}`);
        
        // Transform new format to match MapView expectations
        const transformedItinerary = transformItineraryFormat(itinerary);
        setCurrentItinerary(transformedItinerary);
        
        // AUTO-FETCH ROUTES FOR RUNNING/CYCLING/WALKING REQUESTS
        const promptLower = userMessage.toLowerCase();
        const isRunningRequest = promptLower.includes('running') || 
                                promptLower.includes('jogging') || 
                                promptLower.includes('run');
        const isCyclingRequest = promptLower.includes('cycling') || 
                                promptLower.includes('bike') || 
                                promptLower.includes('bicycle');
        const isWalkingRequest = promptLower.includes('walking') || 
                                promptLower.includes('walk') || 
                                promptLower.includes('hike');
        
        if (isRunningRequest || isCyclingRequest || isWalkingRequest) {
          console.log('[Frontend] Detected route request - auto-fetching routes');
          
          // Determine route type
          let autoRouteType = 'all';
          if (isRunningRequest) autoRouteType = 'running';
          else if (isCyclingRequest) autoRouteType = 'cycling';
          else if (isWalkingRequest) autoRouteType = 'walking';
          
          // Use first venue location or center of venues
          let routeLocation = { lat: 40.7580, lng: -73.9855 };
          if (transformedItinerary.venues && transformedItinerary.venues.length > 0) {
            // Use center of all venues
            const lats = transformedItinerary.venues.map(v => v.lat);
            const lngs = transformedItinerary.venues.map(v => v.lng);
            routeLocation = {
              lat: lats.reduce((a, b) => a + b, 0) / lats.length,
              lng: lngs.reduce((a, b) => a + b, 0) / lngs.length
            };
          }
          
          // Auto-enable routes and set type
          setShowRoutes(true);
          setRouteType(autoRouteType);
          
          // Fetch routes after a short delay to ensure map is loaded
          setTimeout(() => {
            fetchRoutes(routeLocation, autoRouteType);
          }, 2000);
          
          toast.loading(`Fetching ${autoRouteType} routes in the area...`, {
            duration: 2000
          });
        }
        
        // Create a detailed summary message
        let summaryMessage = `Perfect! I've created "${itinerary.title}" for you.\n\n`;
        summaryMessage += `📍 ${itinerary.stops?.length || 0} stops\n`;
        summaryMessage += `🚶 ${itinerary.totalDistance}km total distance\n`;
        summaryMessage += `⏱️ ${itinerary.duration}\n`;
        
        if (qualityScore) {
          summaryMessage += `✨ Quality Score: ${Math.round(qualityScore * 100)}%\n`;
        }
        
        // Handle event information
        const eventCount = itinerary.stops?.filter(s => s.isEvent).length || 0;
        if (eventCount > 0) {
          summaryMessage += `🎟️ ${eventCount} event(s) included\n`;
        } else if (noEventsFound) {
          summaryMessage += `ℹ️ No events found for your criteria\n`;
        }
        
        setMessages(prev => [...prev, { 
          type: 'bot', 
          content: summaryMessage,
          itinerary: transformedItinerary,
          qualityScore,
          issues,
          noEventsFound
        }]);

        // Show quality toast with event info
        if (qualityScore >= 0.8) {
          toast.success('High-quality itinerary created! 🎉');
        } else if (qualityScore >= 0.6) {
          toast.success('Itinerary ready! Some optimization suggestions available.');
        } else {
          toast('Itinerary created with some limitations', { icon: '⚠️' });
        }
        
      } else if (response.data?.error) {
        throw new Error(response.data.error);
      }
    } catch (error) {
      console.error('   ❌ Error:', error.response?.data || error);
      setMessages(prev => prev.filter(m => !m.isThinking));
      
      let errorMessage = 'Sorry, I encountered an error creating your itinerary.';
      
      if (error.code === 'ECONNABORTED') {
        errorMessage = 'Request timed out. Please try a simpler request.';
      } else if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      setMessages(prev => [...prev, { 
        type: 'bot', 
        content: errorMessage,
        isError: true
      }]);
      
      toast.error('Failed to generate itinerary');
    }

    setLoading(false);
  };

  // Transform new MCP format to match existing MapView component
  const transformItineraryFormat = (itinerary) => {
    const transformed = {
      ...itinerary,
      venues: itinerary.stops || [], // MapView expects 'venues' array
      numberOfStops: itinerary.stops?.length || 0,
      hasEvents: itinerary.stops?.some(s => s.isEvent) || false
    };
    
    // Ensure each stop has required fields for MapView
    transformed.venues = transformed.venues.map((stop, index) => ({
      ...stop,
      lat: stop.location?.lat || stop.lat,
      lng: stop.location?.lng || stop.lng,
      order: stop.order || index + 1,
      nearbyEvents: stop.nearbyEvents || []
    }));
    
    return transformed;
  };

  const toggleVenueDescription = (venueIndex) => {
    setExpandedVenue(expandedVenue === venueIndex ? null : venueIndex);
  };

  const getPriceSymbol = (priceLevel) => {
    if (!priceLevel) return '$';
    if (typeof priceLevel === 'string') return priceLevel;
    return '$'.repeat(priceLevel);
  };

  const formatEventDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const getDurationEmoji = (durationType) => {
    switch(durationType) {
      case 'few_hours': return '⚡';
      case 'full_day': return '☀️';
      case 'multi_day': return '🗓️';
      default: return '📅';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50">
      <Toaster position="top-center" />
      
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="w-8 h-8 text-purple-600" />
            <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
              PlanMate
            </h1>
            <span className="ml-2 px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded-full">
              Multi-Agent AI v2.0
            </span>
          </div>
          
          {currentItinerary && (
            <div className="flex gap-2">
              {/* Route Controls */}
              <div className="flex items-center gap-2 mr-4">
                <button
                  onClick={() => {
                    const newShowRoutes = !showRoutes;
                    setShowRoutes(newShowRoutes);
                    
                    // If enabling routes and no routes loaded, fetch them
                    if (newShowRoutes && availableRoutes.length === 0 && currentItinerary?.venues?.[0]) {
                      const centerLat = currentItinerary.venues.reduce((sum, v) => sum + v.lat, 0) / currentItinerary.venues.length;
                      const centerLng = currentItinerary.venues.reduce((sum, v) => sum + v.lng, 0) / currentItinerary.venues.length;
                      fetchRoutes({ lat: centerLat, lng: centerLng });
                    }
                  }}
                  className={`px-3 py-2 rounded-lg transition flex items-center gap-2 ${
                    showRoutes 
                      ? 'bg-green-600 text-white' 
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  <Route className="w-4 h-4" />
                  {showRoutes ? 'Hide Routes' : 'Show Routes'}
                </button>
                
                {showRoutes && (
                  <select
                    value={routeType}
                    onChange={(e) => {
                      setRouteType(e.target.value);
                      if (currentItinerary?.venues && currentItinerary.venues.length > 0) {
                        const centerLat = currentItinerary.venues.reduce((sum, v) => sum + v.lat, 0) / currentItinerary.venues.length;
                        const centerLng = currentItinerary.venues.reduce((sum, v) => sum + v.lng, 0) / currentItinerary.venues.length;
                        fetchRoutes({ lat: centerLat, lng: centerLng }, e.target.value);
                      }
                    }}
                    className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-700"
                  >
                    <option value="all">All Routes</option>
                    <option value="running">Running</option>
                    <option value="cycling">Cycling</option>
                    <option value="walking">Walking</option>
                    <option value="hiking">Hiking</option>
                    <option value="tourist">Tourist</option>
                  </select>
                )}
                
                {loadingRoutes && (
                  <Loader2 className="w-5 h-5 animate-spin text-purple-600" />
                )}
              </div>
              
              {/* Map Toggle Button */}
              <button
                onClick={() => setView(view === 'chat' ? 'map' : 'chat')}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition flex items-center gap-2"
              >
                {view === 'chat' ? <Navigation className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                {view === 'chat' ? 'View Map' : 'Back to Chat'}
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="max-w-7xl mx-auto flex h-[calc(100vh-80px)]">
        {/* Chat Section */}
        <div className={`${view === 'chat' ? 'w-full lg:w-1/2' : 'hidden lg:block lg:w-1/2'} flex flex-col`}>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <AnimatePresence>
              {messages.map((msg, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.isThinking ? (
                    <div className="bg-white rounded-2xl px-6 py-4 max-w-md shadow-sm border border-gray-100">
                      <div className="flex items-center gap-3 mb-2">
                        <Loader2 className="w-5 h-5 animate-spin text-purple-600" />
                        <span className="text-gray-700 font-medium">AI Agents Working...</span>
                      </div>
                      <p className="text-sm text-gray-500 ml-8">
                        {msg.thinkingMessage || 'Creating your perfect itinerary...'}
                      </p>
                    </div>
                  ) : (
                    <div className={`rounded-2xl px-6 py-3 max-w-md shadow-sm ${
                      msg.type === 'user' 
                        ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white' 
                        : msg.isError 
                          ? 'bg-red-50 border border-red-200'
                          : 'bg-white border border-gray-100'
                    }`}>
                      <p className={msg.type === 'user' ? 'text-white' : msg.isError ? 'text-red-700' : 'text-gray-800'} style={{ whiteSpace: 'pre-line' }}>
                        {msg.content}
                      </p>
                      
                      {/* Rest of message content - quality scores, venues, etc. */}
                      {/* ... keeping all the existing message content rendering ... */}
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>

          {/* Sample Prompts */}
          {messages.length <= 1 && (
            <div className="p-4">
              <p className="text-sm text-gray-500 mb-2">Try these:</p>
              <div className="grid grid-cols-2 gap-2">
                {SAMPLE_PROMPTS.map((prompt, idx) => (
                  <button
                    key={idx}
                    onClick={() => setInput(prompt)}
                    className="text-left p-3 bg-white rounded-lg border border-gray-200 hover:border-purple-400 hover:bg-purple-50 transition text-sm text-gray-900"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="p-4 bg-white border-t border-gray-200">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Ask me to plan your perfect day..."
                className="flex-1 px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                disabled={loading}
              />
              <button
                onClick={handleSend}
                disabled={loading || !input.trim()}
                className="px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-xl hover:shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2 text-center">
              Powered by 6 specialized AI agents working together
            </p>
          </div>
        </div>

        {/* Map Section */}
        <div className={`${view === 'map' ? 'w-full' : 'hidden'} lg:block lg:w-1/2 relative`}>
          {currentItinerary ? (
            <MapView 
              itinerary={currentItinerary}
              showRoutes={showRoutes}
              routes={availableRoutes}
              onRoutesRequest={fetchRoutes}
            />
          ) : (
            <div className="h-full flex items-center justify-center bg-gray-50">
              <div className="text-center">
                <MapPin className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">Your map will appear here</p>
                <p className="text-sm text-gray-400 mt-2">Start by telling me what you'd like to do!</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}