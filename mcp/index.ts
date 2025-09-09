// mcp/index.ts - CORRECTED VERSION
import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { 
  CallToolRequestSchema,
  ListToolsRequestSchema 
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { AgentCoordinator } from './orchestration/coordinator.js';  // Remove .js for local imports
import { SmartCache } from './lib/cache.js';  // Remove .js for local imports

// Environment variables
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY!;
const TICKETMASTER_API_KEY = process.env.TICKETMASTER_API_KEY!;

// Validate environment variables
if (!OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY is required');
  process.exit(1);
}
if (!GOOGLE_API_KEY) {
  console.error('❌ GOOGLE_MAPS_API_KEY is required');
  process.exit(1);
}

// Initialize components
const coordinator = new AgentCoordinator({
  openaiApiKey: OPENAI_API_KEY,
  googleApiKey: GOOGLE_API_KEY,
  ticketmasterApiKey: TICKETMASTER_API_KEY || ''
});

const cache = new SmartCache();

// Initialize MCP server
const server = new Server(
  {
    name: 'planmate-mcp-multiagent',
    version: '2.0.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// Define tool schemas
const TOOLS = [
  {
    name: 'generate-itinerary',
    description: 'Generate complete itinerary using multi-agent system',
    inputSchema: {
      type: 'object' as const,
      properties: {
        prompt: { type: 'string' as const, description: 'User request in natural language' },
        location: {
          type: 'object' as const,
          properties: {
            lat: { type: 'number' as const },
            lng: { type: 'number' as const }
          },
          required: ['lat', 'lng']
        }
      },
      required: ['prompt']
    }
  },
  {
    name: 'quick-trip-pipeline',
    description: 'Optimized pipeline for short trips (1-4 hours)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        prompt: { type: 'string' as const },
        location: {
          type: 'object' as const,
          properties: {
            lat: { type: 'number' as const },
            lng: { type: 'number' as const }
          },
          required: ['lat', 'lng']
        },
        maxStops: { type: 'number' as const, minimum: 1, maximum: 3, default: 2 }
      },
      required: ['prompt', 'location']
    }
  },
  {
    name: 'multi-day-pipeline',
    description: 'Comprehensive pipeline for multi-day trips',
    inputSchema: {
      type: 'object' as const,
      properties: {
        prompt: { type: 'string' as const },
        location: {
          type: 'object' as const,
          properties: {
            lat: { type: 'number' as const },
            lng: { type: 'number' as const }
          },
          required: ['lat', 'lng']
        },
        days: { type: 'number' as const, minimum: 2, maximum: 7 }
      },
      required: ['prompt', 'location', 'days']
    }
  },
  {
    name: 'analyze-intent',
    description: 'Analyze user intent from prompt',
    inputSchema: {
      type: 'object' as const,
      properties: {
        prompt: { type: 'string' as const },
        location: {
          type: 'object' as const,
          properties: {
            lat: { type: 'number' as const },
            lng: { type: 'number' as const }
          }
        }
      },
      required: ['prompt']
    }
  }
];

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOLS
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'generate-itinerary': {
        const { prompt, location } = args as any;
        
        // Check cache first
        const cacheKey = cache.generateKey({ prompt, location });
        const cached = cache.get(cacheKey);
        if (cached) {
          console.log('[MCP] Returning cached itinerary');
          return {
            content: [{ type: 'text', text: JSON.stringify(cached) }]
          };
        }

        // Use coordinator to process through all agents
        console.log('[MCP] Processing new itinerary request');
        const result = await coordinator.processItinerary(
          prompt,
          location || { lat: 40.7580, lng: -73.9855 }
        );

        // Cache successful result
        if (result.success) {
          cache.set(cacheKey, result, 3600); // 1 hour cache
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(result) }]
        };
      }

      case 'quick-trip-pipeline': {
        const { prompt, location, maxStops = 2 } = args as any;
        
        console.log('[MCP] Processing quick trip request');
        const result = await coordinator.processItinerary(prompt, location);
        
        // Ensure it's optimized for short duration
        if (result.itinerary && result.itinerary.stops) {
          result.itinerary.stops = result.itinerary.stops.slice(0, maxStops);
          result.itinerary.numberOfStops = result.itinerary.stops.length;
        }
        
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }]
        };
      }

      case 'multi-day-pipeline': {
        const { prompt, location, days } = args as any;
        
        console.log(`[MCP] Processing ${days}-day trip request`);
        const result = await coordinator.processItinerary(
          `${prompt} (${days} days)`,
          location
        );
        
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }]
        };
      }

      case 'analyze-intent': {
        const { prompt, location } = args as any;
        
        console.log('[MCP] Analyzing intent only');
        const tempCoordinator = new AgentCoordinator({
          openaiApiKey: OPENAI_API_KEY,
          googleApiKey: GOOGLE_API_KEY,
          ticketmasterApiKey: TICKETMASTER_API_KEY || ''
        });
        
        const result = await tempCoordinator.processItinerary(
          prompt, 
          location || { lat: 40.7580, lng: -73.9855 }
        );
        
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    console.error(`[MCP] Error in tool ${name}:`, error);
    return {
      content: [{ 
        type: 'text', 
        text: JSON.stringify({ 
          success: false, 
          error: error.message || 'Unknown error' 
        }) 
      }]
    };
  }
});

// ============= Server Startup =============

async function main() {
  console.log('🚀 Starting PlanMate Multi-Agent MCP Server v2.0');
  console.log('📦 Configuration:');
  console.log(`   ✅ OpenAI API: ${OPENAI_API_KEY ? 'Configured' : '❌ Missing'}`);
  console.log(`   ✅ Google Maps API: ${GOOGLE_API_KEY ? 'Configured' : '❌ Missing'}`);
  console.log(`   ${TICKETMASTER_API_KEY ? '✅' : '⚠️'} Ticketmaster API: ${TICKETMASTER_API_KEY ? 'Configured' : 'Not configured (optional)'}`);
  console.log('\n📦 Agents initialized:');
  console.log('   ✅ Intent Analyzer');
  console.log('   ✅ Master Planner');
  console.log('   ✅ Venue Specialist');
  console.log('   ✅ Event Specialist');
  console.log('   ✅ Route Optimizer');
  console.log('   ✅ Quality Controller');
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  console.log('\n✅ MCP Server running (stdio transport)');
  console.log('🔄 Waiting for connections...\n');
}

// Error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the server
main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});