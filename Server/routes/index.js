const express = require('express');
const router = express.Router();

const authRoutes = require('./authRoutes');
const todoRoutes = require('./todoRoutes');

// Mount routes
router.use('/auth', authRoutes);
router.use('/todos', todoRoutes);

// Health check
router.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

module.exports = router;
