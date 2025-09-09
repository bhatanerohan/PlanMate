// frontend/app/page.js - Updated for MCP Architecture
'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import toast, { Toaster } from 'react-hot-toast';
import { Send, MapPin, Loader2, Clock, RefreshCw, Sparkles, Navigation, Info, AlertCircle, CheckCircle } from 'lucide-react';
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
  "Quick coffee and pastry near Central Park"
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
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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
    });

    console.log('   ✅ Response received');
    setMessages(prev => prev.filter(m => !m.isThinking));

    if (response.data?.success && response.data?.itinerary) {
      const { itinerary, qualityScore, issues, noEventsFound } = response.data;
      
      console.log(`   Title: ${itinerary.title}`);
      console.log(`   Stops: ${itinerary.stops?.length}`);
      console.log(`   Quality Score: ${qualityScore}`);
      console.log(`   Issues: ${issues?.length || 0}`);
      console.log(`   No Events Found: ${noEventsFound}`);
      
      // Transform new format to match MapView expectations
      const transformedItinerary = transformItineraryFormat(itinerary);
      setCurrentItinerary(transformedItinerary);
      
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
      
      // Additional toast for no events
      if (noEventsFound) {
        setTimeout(() => {
          toast('No events found for your criteria, showing venues only', { 
            icon: 'ℹ️',
            duration: 4000 
          });
        }, 1000);
      }
      
    } else if (response.data?.error) {
      throw new Error(response.data.error);
    }
  } catch (error) {
    console.error('   ❌ Error:', error.response?.data || error);
    setMessages(prev => prev.filter(m => !m.isThinking));
    
    let errorMessage = 'Sorry, I encountered an error creating your itinerary.';
    
    if (error.response?.data?.error) {
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
                      
                      {/* Quality Score Badge */}
                      {msg.qualityScore && (
                        <div className="mt-3 flex items-center gap-2">
                          <div className="flex items-center gap-1 px-2 py-1 bg-green-100 rounded-full">
                            <CheckCircle className="w-3 h-3 text-green-600" />
                            <span className="text-xs text-green-700">
                              Quality: {Math.round(msg.qualityScore * 100)}%
                            </span>
                          </div>
                          {msg.issues && msg.issues.length > 0 && (
                            <button
                              onClick={() => setShowQualityDetails(!showQualityDetails)}
                              className="flex items-center gap-1 px-2 py-1 bg-yellow-100 rounded-full hover:bg-yellow-200 transition"
                            >
                              <AlertCircle className="w-3 h-3 text-yellow-600" />
                              <span className="text-xs text-yellow-700">
                                {msg.issues.length} suggestions
                              </span>
                            </button>
                          )}
                        </div>
                      )}
                      
                      {/* Quality Issues */}
                      {showQualityDetails && msg.issues && msg.issues.length > 0 && (
                        <div className="mt-3 p-3 bg-yellow-50 rounded-lg">
                          <p className="text-xs font-semibold text-yellow-800 mb-2">Optimization Suggestions:</p>
                          {msg.issues.map((issue, i) => (
                            <div key={i} className="text-xs text-yellow-700 mb-1">
                              • {issue.suggestion}
                            </div>
                          ))}
                        </div>
                      )}
                      {msg.itinerary && msg.noEventsFound && (
  <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
    <div className="flex items-start gap-2">
      <Info className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
      <div className="flex-1">
        <p className="text-sm text-blue-800 font-medium">No events found</p>
        <p className="text-xs text-blue-700 mt-1">
          We couldn't find any events matching your criteria for the requested time period. 
          Your itinerary includes venue recommendations only.
        </p>
      </div>
    </div>
  </div>
)}
                      {msg.itinerary && (
                        <div className="mt-4 space-y-3">
                          {/* Duration Type Badge */}
                          {msg.itinerary.durationType && (
                            <div className="flex items-center gap-2 text-sm">
                              <span className="text-gray-600">Trip Type:</span>
                              <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
                                {getDurationEmoji(msg.itinerary.durationType)} {msg.itinerary.duration}
                              </span>
                            </div>
                          )}
                          
                          {/* Stops List */}
                          <div className="space-y-2">
                            {msg.itinerary.venues?.map((stop, vIdx) => (
                              <motion.div
                                key={vIdx}
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: vIdx * 0.1 }}
                                className={`rounded-lg p-3 hover:bg-gray-100 transition-colors ${
                                  stop.isEvent ? 'bg-purple-50 border border-purple-200' : 'bg-gray-50'
                                }`}
                              >
                                <div className="flex items-start gap-3">
                                  <div className={`w-8 h-8 ${stop.isEvent ? 'bg-purple-600' : 'bg-gradient-to-r from-purple-600 to-blue-600'} text-white rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0`}>
                                    {stop.order}
                                  </div>
                                  <div className="flex-1">
                                    <div className="flex items-start justify-between">
                                      <div className="flex-1">
                                        <h4 className="font-semibold text-gray-900">{stop.name}</h4>
                                        {stop.isEvent ? (
                                          <div>
                                            <p className="text-xs text-purple-600">
                                              🎟️ {stop.eventType} • {stop.venueName}
                                            </p>
                                            {stop.startDate && (
                                              <p className="text-xs text-purple-700 mt-1">
                                                📅 {formatEventDate(stop.startDate)}
                                              </p>
                                            )}
                                          </div>
                                        ) : (
                                          <p className="text-xs text-gray-500">
                                            {stop.category} • {getPriceSymbol(stop.priceLevel || stop.price)}
                                          </p>
                                        )}
                                      </div>
                                      {stop.isEvent ? (
                                        <div className="text-xs">
                                          {!stop.isAvailable ? (
                                            <span className="text-red-600 font-semibold">SOLD OUT</span>
                                          ) : (
                                            <span className="text-green-600">{stop.price || 'Check site'}</span>
                                          )}
                                        </div>
                                      ) : (
                                        stop.rating && (
                                          <div className="text-sm font-semibold text-amber-500 flex items-center gap-1">
                                            ⭐ {stop.rating}
                                          </div>
                                        )
                                      )}
                                    </div>
                                    
                                    {/* Description Section */}
                                    {stop.description && (
                                      <div className="mt-2">
                                        <div 
                                          className={`text-xs text-gray-600 ${expandedVenue === vIdx ? '' : 'line-clamp-2'}`}
                                        >
                                          {stop.description}
                                        </div>
                                        {stop.description.length > 100 && (
                                          <button
                                            onClick={() => toggleVenueDescription(vIdx)}
                                            className="text-xs text-purple-600 hover:text-purple-700 mt-1 flex items-center gap-1"
                                          >
                                            <Info className="w-3 h-3" />
                                            {expandedVenue === vIdx ? 'Show less' : 'Read more'}
                                          </button>
                                        )}
                                      </div>
                                    )}
                                    
                                    {/* Walk time */}
                                    {stop.walkTime > 0 && (
                                      <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                                        <Clock className="w-3 h-3" />
                                        {stop.walkTime} min walk from previous stop
                                      </p>
                                    )}
                                    
                                    {/* Event URL */}
                                    {stop.url && (
                                      <a 
                                        href={stop.url} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="text-xs text-purple-600 hover:text-purple-700 mt-2 inline-block"
                                      >
                                        🎫 Get Tickets →
                                      </a>
                                    )}
                                  </div>
                                </div>
                              </motion.div>
                            ))}
                          </div>

                          {/* Summary Stats */}
                          <div className="bg-purple-50 rounded-lg p-3 mt-3">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-purple-700">
                                📍 {msg.itinerary.numberOfStops || msg.itinerary.venues?.length} stops
                              </span>
                              <span className="text-purple-700">
                                🚶 {msg.itinerary.totalDistance}km total
                              </span>
                              <span className="text-purple-700">
                                ⏱️ {msg.itinerary.duration}
                              </span>
                            </div>
                            {msg.itinerary.averageDistanceBetweenStops && (
                              <p className="text-xs text-purple-600 mt-2">
                                Average distance between stops: {msg.itinerary.averageDistanceBetweenStops.toFixed(1)}km
                              </p>
                            )}
                          </div>
                        </div>
                      )}
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
                    className="text-left p-3 bg-white rounded-lg border border-gray-200 hover:border-purple-400 hover:bg-purple-50 transition text-sm"
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
            <MapView itinerary={currentItinerary} />
          ) : (
            <div className="h-full flex items-center justify-center bg-gray-50">
              <div className="text-center">
                <MapPin className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">Your map will appear here</p>
                <p className="text-sm text-gray-400 mt-2">Start by telling me what you'd like to do!</p>
                <div className="mt-4 p-4 bg-white rounded-lg max-w-sm mx-auto">
                  <p className="text-xs text-gray-600">
                    <strong>AI Agents Ready:</strong><br/>
                    • Intent Analyzer<br/>
                    • Master Planner<br/>
                    • Venue Specialist<br/>
                    • Event Specialist<br/>
                    • Route Optimizer<br/>
                    • Quality Controller
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}