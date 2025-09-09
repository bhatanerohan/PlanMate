// backend/server.js - Simplified to use separate MCP client
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import McpClient from './mcp-client.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Initialize MCP client
const mcp = new McpClient();

// Start MCP server on startup
mcp.start().catch(console.error);

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