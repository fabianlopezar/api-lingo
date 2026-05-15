const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/authRoutes');
const wordsRoutes = require('./routes/wordsRoutes');
const userWordsRoutes = require('./routes/userWordsRoutes');
const statsRoutes = require('./routes/statsRoutes');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const app = express();

// CORS abierto para desarrollo con React/Vite (ajusta origin en producción)
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || true,
    credentials: true,
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Colibri API funcionando',
    timestamp: new Date().toISOString(),
  });
});

// Rutas API
app.use('/api/auth', authRoutes);
app.use('/api/words', wordsRoutes);
app.use('/api/user-words', userWordsRoutes);
app.use('/api/stats', statsRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
