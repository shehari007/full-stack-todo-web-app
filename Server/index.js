const express = require('express');
const dotenv = require('dotenv').config();
const cors = require('cors');

// Routes
const routes = require('./routes');

// Middleware
const { generalLimiter, authLimiter } = require('./middleware/rateLimiter');
const { securityHeaders, sanitizeInput, requestSizeLimiter } = require('./middleware/security');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

// Trust proxy (for rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// CORS Configuration
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
    : ['http://localhost:3000'],
  credentials: true,
  methods: process.env.ALLOWED_METHODS 
    ? process.env.ALLOWED_METHODS.split(',').map(method => method.trim())
    : ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400, // 24 hours
};

// Global Middleware
app.use(cors(corsOptions));
app.use(securityHeaders);
app.use(express.json({ limit: '10kb' })); // Limit body size
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use(requestSizeLimiter(10240)); // 10KB max
app.use(sanitizeInput);
app.use(generalLimiter);

// Apply stricter rate limiting to auth routes
app.use('/api/auth', authLimiter);

// Health check endpoint
app.get('/', (req, res) => {
  res.status(200).json({ 
    status: 'ok',
    message: 'TaskFlow API Server',
    version: '1.0.0'
  });
});

// API Routes
app.use('/api', routes);

// Error handling
app.use(notFound);
app.use(errorHandler);

// Server Setup
const PORT = process.env.PORT || 8000;

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║       TaskFlow API Server Started         ║
╠═══════════════════════════════════════════╣
║  Port: ${PORT}                              ║
║  Environment: ${process.env.NODE_ENV || 'development'}               ║
║  API: http://localhost:${PORT}/api           ║
╚═══════════════════════════════════════════╝
  `);
});