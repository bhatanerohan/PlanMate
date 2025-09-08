const { spawn } = require('child_process');
const path = require('path');

// Simple JSONL stdio client for the MCP server
class McpClient {
  constructor() {
    this.child = null;
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map();
    this.initialized = false;
  }

  start() {
    if (this.child) return;
    const mcpPath = path.resolve(__dirname, '..', 'mcp', 'dist', 'index.js');
    this.child = spawn('node', [mcpPath], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      this.buffer += chunk;
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message || 'MCP error'));
          else resolve(msg.result);
        }
      }
    });
    this.child.on('exit', () => {
      this.child = null;
      this.initialized = false;
      for (const { reject } of this.pending.values()) {
        reject(new Error('MCP server exited'));
      }
      this.pending.clear();
    });
  }

  async init() {
    this.start();
    if (this.initialized) return;
    const initRes = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { sampling: {} },
      clientInfo: { name: 'planmate-backend', version: '1.0.0' }
    });
    // Fire-and-forget initialized notification
    this.notify('initialized', {});
    this.initialized = true;
    return initRes;
  }

  request(method, params) {
    if (!this.child) this.start();
    const id = this.nextId++;
    const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(msg + '\n');
    });
  }

  notify(method, params) {
    if (!this.child) this.start();
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
    this.child.stdin.write(msg + '\n');
  }

  async callTool(name, args) {
    await this.init();
    const res = await this.request('tools/call', { name, arguments: args });
    return res;
  }
}

module.exports = new McpClient();


