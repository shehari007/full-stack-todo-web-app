/**
 * Security middleware for Express
 */

/**
 * Add security headers to responses
 */
const securityHeaders = (req, res, next) => {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Enable XSS filter
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Remove X-Powered-By header
  res.removeHeader('X-Powered-By');
  
  next();
};

/**
 * Sanitize request body to prevent NoSQL injection
 */
const sanitizeInput = (req, res, next) => {
  if (req.body) {
    const sanitize = (obj) => {
      for (const key in obj) {
        if (typeof obj[key] === 'string') {
          // Remove potential SQL injection patterns (but not for password)
          if (key !== 'password') {
            obj[key] = obj[key].replace(/['";\\]/g, '');
          }
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          sanitize(obj[key]);
        }
      }
    };
    sanitize(req.body);
  }
  next();
};

/**
 * Request size limiter (additional check)
 */
const requestSizeLimiter = (maxSize = 10240) => (req, res, next) => {
  const contentLength = parseInt(req.headers['content-length'], 10);
  
  if (contentLength && contentLength > maxSize) {
    return res.status(413).json({ error: 'Request entity too large' });
  }
  
  next();
};

module.exports = {
  securityHeaders,
  sanitizeInput,
  requestSizeLimiter,
};
