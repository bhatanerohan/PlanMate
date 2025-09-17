// backend/server.js - Simplified to use separate MCP client
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import McpClient from './mcp-client.js';
import CequenceGateway from './cequence-gateway.js';
import { setupMCPHttpTransport } from './mcp-http-transport.js';
import { RouteFetcher } from './route-fetcher.js'; // ADD THIS

dotenv.config();
const cequence = new CequenceGateway();
const routeFetcher = new RouteFetcher();

const app = express();
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://planmate-rho.vercel.app',  // Add your Vercel URL
    'https://planmate*.vercel.app',      // Allow all your deployments
    /\.vercel\.app$/                      // Allow any Vercel domain
  ],
  credentials: true
}));
app.use(express.json());
app.use(cequence.middleware());

// Initialize MCP client
const mcp = new McpClient();

// Start MCP server on startup
mcp.start().catch(console.error);
setupMCPHttpTransport(app, mcp);

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Backend] Shutting down gracefully...');
  await mcp.stop();
  process.exit(0);
});

// ============= API Endpoints =============

// Main endpoint - Generate Itinerary
app.post('/api/generate-itinerary', async (req, res) => {
  console.log('\n[API] Generate Itinerary Request');
  console.log('  Prompt:', req.body.prompt?.substring(0, 100) + '...');
  console.log('  Location:', req.body.location);
  
  try {
    const { prompt, location } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ 
        success: false, 
        error: 'Please provide a prompt' 
      });
    }
    
    // Call MCP tool
    const result = await mcp.callTool('generate-itinerary', {
      prompt,
      location: location || { lat: 40.7580, lng: -73.9855 }
    });
    
    console.log('[API] Itinerary generated successfully');
    res.json(result);
    
  } catch (error) {
    console.error('[API] Error:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Analyze intent endpoint (for debugging)
app.post('/api/analyze-intent', async (req, res) => {
  console.log('\n[API] Analyze Intent Request');
  
  try {
    const result = await mcp.callTool('analyze-intent', req.body);
    res.json(result);
  } catch (error) {
    console.error('[API] Error:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'Running',
    version: '2.0.0',
    architecture: 'MCP-Centric Multi-Agent',
    mcp_connected: mcp.initialized,
    agents: [
      'Intent Analyzer',
      'Master Planner', 
      'Venue Specialist',
      'Event Specialist',
      'Route Optimizer',
      'Quality Controller'
    ],
    endpoints: {
      generate_itinerary: 'POST /api/generate-itinerary',
      analyze_intent: 'POST /api/analyze-intent',
      health: 'GET /api/health'
    }
  });
});

// Add gateway stats endpoint
app.get('/api/gateway/stats', (req, res) => {
  res.json({
    ...cequence.getStats(),
    timestamp: new Date().toISOString(),
    status: 'operational'
  });
});

// Add gateway health check
app.get('/api/gateway/health', (req, res) => {
  res.json({
    gateway: 'Cequence AI Gateway',
    status: 'healthy',
    protection: 'active',
    features: [
      'rate_limiting',
      'bot_detection', 
      'token_validation',
      'request_logging'
    ]
  });
});

// This should already be in your server.js
app.get('/api/routes', async (req, res) => {
  console.log('\n[API] Fetch Routes Request');
  
  try {
    const { lat, lng, type = 'all', radius = 5000, limit = 5 } = req.query;
    
    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        error: 'Latitude and longitude are required'
      });
    }
    
    console.log(`[API] Fetching ${type} routes around ${lat},${lng} within ${radius}m`);
    
    const routes = await routeFetcher.fetchRoutes(
      parseFloat(lat),
      parseFloat(lng),
      type,
      parseInt(radius),
      parseInt(limit)
    );
    
    console.log(`[API] Found ${routes.length} routes`);
    
    res.json({
      success: true,
      routes,
      count: routes.length,
      center: { lat: parseFloat(lat), lng: parseFloat(lng) }
    });
    
  } catch (error) {
    console.error('[API] Error fetching routes:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/', (req, res) => {
  res.json({
    message: '🚀 PlanMate MCP Server - Protected by Cequence AI Gateway',
    status: 'operational',
    endpoints: {
      health: '/api/health',
      gateway_health: '/api/gateway/health',
      gateway_stats: '/api/gateway/stats',
      mcp_tools: '/api/mcp/tools',
      mcp_execute: '/api/mcp/execute [POST]'
    },
    protection: 'Cequence AI Gateway Active',
    documentation: 'https://github.com/yourusername/planmate'
  });
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 PlanMate Backend Server v2.0');
  console.log('='.repeat(60));
  console.log('📍 Port:', PORT);
  console.log('🏗️  Architecture: MCP-Centric Multi-Agent System');
  console.log('🤖 Agents: 6 specialized AI agents');
  console.log('🔄 Status: Ready for requests');
  console.log('='.repeat(60) + '\n');
});