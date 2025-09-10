// backend/mcp-http-transport.js - HTTP Transport for MCP
import express from 'express';

export function setupMCPHttpTransport(app, mcpClient) {
  // MCP over HTTP endpoint
  app.post('/api/mcp/execute', async (req, res) => {
    console.log('[MCP-HTTP] Received request via Cequence-protected endpoint');
    
    const { tool, arguments: args } = req.body;
    
    if (!tool) {
      return res.status(400).json({
        error: 'Tool name required',
        gateway: 'Cequence-protected MCP endpoint'
      });
    }
    
    try {
      // Log Cequence validation
      console.log(`[Cequence→MCP] Tool request validated: ${tool}`);
      
      // Execute MCP tool
      const result = await mcpClient.callTool(tool, args || {});
      
      res.json({
        success: true,
        tool,
        result,
        metadata: {
          gateway: 'Cequence AI Gateway',
          transport: 'HTTP/HTTPS',
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error(`[MCP-HTTP] Error executing tool ${tool}:`, error);
      res.status(500).json({
        success: false,
        error: error.message,
        tool
      });
    }
  });

  // List available MCP tools
  app.get('/api/mcp/tools', (req, res) => {
    res.json({
      tools: [
        {
          name: 'generate-itinerary',
          description: 'Generate AI-powered travel itinerary',
          protected: true,
          gateway: 'Cequence AI'
        },
        {
          name: 'analyze-intent',
          description: 'Analyze travel request intent',
          protected: true,
          gateway: 'Cequence AI'
        },
        {
          name: 'quick-trip-pipeline',
          description: 'Quick trip planning (1-4 hours)',
          protected: true,
          gateway: 'Cequence AI'
        }
      ],
      gateway: {
        provider: 'Cequence AI Gateway',
        features: ['rate_limiting', 'bot_protection', 'token_validation']
      }
    });
  });
}