// backend/mcp-client.js - MCP Client Implementation
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class McpClient {
  constructor() {
    this.child = null;
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map();
    this.initialized = false;
  }

  async start() {
    if (this.child) return;
    
    console.log('[MCP Client] Starting MCP server...');
    const mcpPath = path.resolve(__dirname, '..', 'mcp', 'dist', 'index.js');
    
    this.child = spawn('node', [mcpPath], { 
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    });
    
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    
    this.child.stdout.on('data', (chunk) => {
      this.buffer += chunk;
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        try {
          const msg = JSON.parse(line);
          if (msg.id && this.pending.has(msg.id)) {
            const { resolve, reject } = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            
            if (msg.error) {
              reject(new Error(msg.error.message || 'MCP error'));
            } else {
              resolve(msg.result);
            }
          }
        } catch (e) {
          // Not JSON, probably a log message
          if (!line.includes('Initializing') && !line.includes('Starting')) {
            console.log('[MCP]', line);
          }
        }
      }
    });
    
    this.child.stderr.on('data', (data) => {
      const message = data.toString();
      if (!message.includes('ExperimentalWarning')) {
        console.error('[MCP Error]', message);
      }
    });
    
    this.child.on('exit', (code) => {
      console.log(`[MCP Client] MCP server exited with code ${code}`);
      this.child = null;
      this.initialized = false;
      
      for (const { reject } of this.pending.values()) {
        reject(new Error('MCP server exited'));
      }
      this.pending.clear();
    });
    
    await this.initialize();
  }

  async initialize() {
    if (this.initialized) return;
    
    console.log('[MCP Client] Initializing MCP connection...');
    
    const result = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { sampling: {} },
      clientInfo: { name: 'planmate-backend', version: '2.0.0' }
    });
    
    this.notify('initialized', {});
    this.initialized = true;
    
    console.log('[MCP Client] Connection initialized successfully');
    return result;
  }

  request(method, params) {
    const id = this.nextId++;
    const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      
      if (!this.child || !this.child.stdin.writable) {
        reject(new Error('MCP server not running'));
        return;
      }
      
      this.child.stdin.write(msg + '\n');
      
      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('MCP request timeout'));
        }
      }, 30000);
    });
  }

  notify(method, params) {
    if (!this.child || !this.child.stdin.writable) return;
    
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
    this.child.stdin.write(msg + '\n');
  }

  async callTool(name, args) {
    if (!this.child) await this.start();
    
    console.log(`[MCP Client] Calling tool: ${name}`);
    
    const result = await this.request('tools/call', { 
      name, 
      arguments: args 
    });
    
    // Parse the response content
    if (result?.content?.[0]?.text) {
      try {
        return JSON.parse(result.content[0].text);
      } catch {
        return result.content[0].text;
      }
    }
    
    return result;
  }

  async stop() {
    if (this.child) {
      console.log('[MCP Client] Stopping MCP server...');
      this.child.kill();
      this.child = null;
      this.initialized = false;
    }
  }
}

export default McpClient;