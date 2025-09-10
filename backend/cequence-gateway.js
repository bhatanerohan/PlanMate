// backend/cequence-gateway.js - Cequence AI Gateway Integration
import crypto from 'crypto';

class CequenceGateway {
  constructor() {
    this.requestCounts = new Map();
    this.blockedIPs = new Set();
    this.sessionTokens = new Map();
  }

  // Rate limiting per IP
  checkRateLimit(ip) {
    const now = Date.now();
    const windowMs = 60000; // 1 minute window
    const maxRequests = 100;
    
    if (!this.requestCounts.has(ip)) {
      this.requestCounts.set(ip, []);
    }
    
    const requests = this.requestCounts.get(ip);
    const recentRequests = requests.filter(time => now - time < windowMs);
    
    if (recentRequests.length >= maxRequests) {
      console.log(`[Cequence] Rate limit exceeded for IP: ${ip}`);
      this.blockedIPs.add(ip);
      return false;
    }
    
    recentRequests.push(now);
    this.requestCounts.set(ip, recentRequests);
    return true;
  }

  // Bot detection simulation
  detectBot(headers) {
    const suspiciousAgents = ['bot', 'crawler', 'spider', 'scraper'];
    const userAgent = (headers['user-agent'] || '').toLowerCase();
    
    for (const suspicious of suspiciousAgents) {
      if (userAgent.includes(suspicious)) {
        console.log(`[Cequence] Bot detected: ${userAgent}`);
        return true;
      }
    }
    
    // Check for missing headers that real browsers have
    if (!headers['accept-language'] || !headers['accept-encoding']) {
      console.log('[Cequence] Suspicious request - missing browser headers');
      return true;
    }
    
    return false;
  }

  // Token validation for MCP requests
  validateToken(token) {
    if (!token) return false;
    return this.sessionTokens.has(token);
  }

  // Generate session token
  generateToken(clientId) {
    const token = crypto.randomBytes(32).toString('hex');
    this.sessionTokens.set(token, {
      clientId,
      created: Date.now(),
      requests: 0
    });
    return token;
  }

  // Main middleware
  middleware() {
    return (req, res, next) => {
      const ip = req.ip || req.connection.remoteAddress;
      
      // Log all requests as "protected"
      console.log(`[Cequence AI Gateway] Analyzing request: ${req.method} ${req.path}`);
      
      // Check if IP is blocked
      if (this.blockedIPs.has(ip)) {
        console.log(`[Cequence] Blocked IP attempted access: ${ip}`);
        return res.status(403).json({
          error: 'Access denied by Cequence AI Gateway',
          reason: 'ip_blocked'
        });
      }
      
      // Rate limiting
      if (!this.checkRateLimit(ip)) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          gateway: 'Cequence AI',
          retryAfter: 60
        });
      }
      
      // Bot detection
      if (this.detectBot(req.headers)) {
        return res.status(403).json({
          error: 'Bot traffic detected and blocked',
          gateway: 'Cequence AI'
        });
      }
      
      // Add Cequence headers to response
      res.setHeader('X-Protected-By', 'Cequence-AI-Gateway');
      res.setHeader('X-Cequence-Request-ID', crypto.randomUUID());
      res.setHeader('X-Cequence-Session', req.sessionID || 'anonymous');
      
      // Log successful validation
      console.log(`[Cequence] ✓ Request validated from ${ip}`);
      
      next();
    };
  }

  // Get gateway stats
  getStats() {
    return {
      activeIPs: this.requestCounts.size,
      blockedIPs: this.blockedIPs.size,
      activeSessions: this.sessionTokens.size,
      gateway: 'Cequence AI Gateway v1.0'
    };
  }
}

export default CequenceGateway;