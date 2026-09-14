const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { corsOrigins } = require('./config/env');

const authRoutes = require('./routes/authRoutes');
const wordsRoutes = require('./routes/wordsRoutes');
const userWordsRoutes = require('./routes/userWordsRoutes');
const statsRoutes = require('./routes/statsRoutes');
const categoriesRoutes = require('./routes/categoriesRoutes');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const app = express();

app.set('trust proxy', 1);
app.use(helmet());

// CORS con whitelist. En prod CORS_ORIGIN es obligatorio (ver src/index.js).
// En dev sin CORS_ORIGIN se permite localhost para no romper Vite.
function isDevOrigin(origin) {
  if (!origin) return true; // curl / Postman / mismo origen
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

app.use(
  cors({
    origin: (origin, cb) => {
      if (corsOrigins.length === 0) {
        return process.env.NODE_ENV === 'production'
          ? cb(new Error('CORS_ORIGIN no configurado'))
          : cb(null, isDevOrigin(origin) ? origin : false);
      }
      return corsOrigins.includes(origin) || !origin
        ? cb(null, true)
        : cb(new Error('Origen no permitido por CORS'));
    },
    credentials: true,
  })
);

// Anti-abuso: general suave + estricto en auth y lookup (IA = costo).
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Demasiados intentos, prueba en 15 minutos' },
});
const lookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Demasiadas búsquedas con IA, espera un minuto' },
});

app.use(generalLimiter);
app.use('/api/auth', authLimiter);
app.use('/api/words/lookup', lookupLimiter);

app.use(express.json({ limit: '100kb' }));
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
app.use('/api/categories', categoriesRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
