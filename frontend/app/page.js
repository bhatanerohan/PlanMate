// frontend/app/page.js - Updated to show descriptions
'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import toast, { Toaster } from 'react-hot-toast';
import { Send, MapPin, Loader2, Clock, RefreshCw, Sparkles, Navigation, Info } from 'lucide-react';
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
  "Show me the best local spots for a first date"
];

export default function Home() {
  const [messages, setMessages] = useState([
    { type: 'bot', content: "Hey! I'm PlanMate 🗺️ Tell me what kind of experience you're looking for and I'll create the perfect itinerary!" }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentItinerary, setCurrentItinerary] = useState(null);
  const [view, setView] = useState('chat'); // 'chat' or 'map'
  const [expandedVenue, setExpandedVenue] = useState(null); // Track which venue description is expanded
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
    setMessages(prev => [...prev, { type: 'bot', content: 'thinking', isThinking: true }]);

    try {
      console.log('   📡 Sending to backend...');
      const response = await axios.post(`${API_URL}/api/generate-itinerary`, {
        prompt: userMessage
      });

      console.log('   ✅ Response received');
      setMessages(prev => prev.filter(m => !m.isThinking));

      if (response.data.success) {
        const itinerary = response.data.itinerary;
        
        console.log(`   Venues received: ${itinerary.venues?.length}`);
        setCurrentItinerary(itinerary);
        
        setMessages(prev => [...prev, { 
          type: 'bot', 
          content: `I've created "${itinerary.title}" for you! ${itinerary.description}. Ready to explore?`,
          itinerary: itinerary
        }]);

        toast.success('Itinerary created! 🎉');
      }
    } catch (error) {
      console.error('   ❌ Error:', error.response?.data || error);
      setMessages(prev => prev.filter(m => !m.isThinking));
      
      let errorMessage = 'Sorry, I encountered an error creating your itinerary.';
      
      if (error.response?.data?.details) {
        errorMessage += ` ${error.response.data.details}`;
      } else if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
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

  const handleReplan = async (reason) => {
    if (!currentItinerary) return;
    
    toast.loading(`Adjusting for ${reason}...`);
    
    try {
      const response = await axios.post(`${API_URL}/api/replan`, {
        reason,
        currentItinerary,
        location: { lat: 40.7580, lng: -73.9855 }
      });

      if (response.data.success) {
        toast.dismiss();
        toast.success(response.data.message);
        
        const updated = { ...currentItinerary };
        if (response.data.updatedVenues?.length > 0) {
          updated.venues[0] = { ...response.data.updatedVenues[0], order: 1 };
        }
        setCurrentItinerary(updated);
      }
    } catch (error) {
      toast.dismiss();
      toast.error('Failed to replan');
    }
  };

  const toggleVenueDescription = (venueIndex) => {
    setExpandedVenue(expandedVenue === venueIndex ? null : venueIndex);
  };

  const getPriceSymbol = (priceLevel) => {
    if (!priceLevel) return '$';
    return '$'.repeat(priceLevel);
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
              AI Travel Companion
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
                    <div className="bg-white rounded-2xl px-6 py-3 max-w-md shadow-sm border border-gray-100">
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-purple-600" />
                        <span className="text-gray-500">Creating your perfect itinerary...</span>
                      </div>
                    </div>
                  ) : (
                    <div className={`rounded-2xl px-6 py-3 max-w-md shadow-sm ${
                      msg.type === 'user' 
                        ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white' 
                        : 'bg-white border border-gray-100'
                    }`}>
                      <p className={msg.type === 'user' ? 'text-white' : 'text-gray-800'}>
                        {msg.content}
                      </p>
                      
                      {msg.itinerary && (
                        <div className="mt-4 space-y-3">
                          {/* Weather Widget */}
                          {msg.itinerary.weather && (
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                              <span className="text-2xl">{msg.itinerary.weather.icon}</span>
                              <span>{msg.itinerary.weather.temp}°F - {msg.itinerary.weather.condition}</span>
                            </div>
                          )}
                          
                          {/* Venues List with Descriptions */}
                          <div className="space-y-2">
                            {msg.itinerary.venues?.map((venue, vIdx) => (
                              <motion.div
                                key={vIdx}
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: vIdx * 0.1 }}
                                className="bg-gray-50 rounded-lg p-3 hover:bg-gray-100 transition-colors"
                              >
                                <div className="flex items-start gap-3">
                                  <div className="w-8 h-8 bg-purple-600 text-white rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">
                                    {venue.order}
                                  </div>
                                  <div className="flex-1">
                                    <div className="flex items-start justify-between">
                                      <div className="flex-1">
                                        <h4 className="font-semibold text-gray-900">{venue.name}</h4>
                                        <p className="text-xs text-gray-500">
                                          {venue.category} • {getPriceSymbol(venue.price_level || venue.price)}
                                        </p>
                                      </div>
                                      {venue.rating && (
                                        <div className="text-sm font-semibold text-amber-500 flex items-center gap-1">
                                          ⭐ {venue.rating}
                                        </div>
                                      )}
                                    </div>
                                    
                                    {/* Description Section */}
                                    {venue.description && (
                                      <div className="mt-2">
                                        <div 
                                          className={`text-xs text-gray-600 ${expandedVenue === vIdx ? '' : 'line-clamp-2'}`}
                                        >
                                          {venue.description}
                                        </div>
                                        {venue.description.length > 100 && (
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
                                    
                                    {/* Tips if available */}
                                    {venue.tips && (
                                      <p className="text-xs text-purple-600 mt-2">💡 {venue.tips}</p>
                                    )}
                                    
                                    {/* Walk time */}
                                    {venue.walkTime > 0 && (
                                      <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                                        <Clock className="w-3 h-3" />
                                        {venue.walkTime} min walk from previous stop
                                      </p>
                                    )}
                                    
                                    {/* Address */}
                                    {venue.address && (
                                      <p className="text-xs text-gray-400 mt-1">
                                        📍 {venue.address.split(',').slice(0, 2).join(',')}
                                      </p>
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
                          </div>

                          {/* Action Buttons */}
                          <div className="flex gap-2 mt-3">
                            <button
                              onClick={() => handleReplan('rain')}
                              className="flex-1 px-3 py-2 bg-blue-100 text-blue-700 rounded-lg text-sm hover:bg-blue-200 transition flex items-center justify-center gap-1"
                            >
                              <RefreshCw className="w-3 h-3" />
                              It's raining!
                            </button>
                            <button
                              onClick={() => handleReplan('crowded')}
                              className="flex-1 px-3 py-2 bg-orange-100 text-orange-700 rounded-lg text-sm hover:bg-orange-200 transition"
                            >
                              Too crowded
                            </button>
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
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}