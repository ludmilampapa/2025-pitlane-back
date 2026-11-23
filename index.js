require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3005;
const isProduction = process.env.NODE_ENV === 'production';

const routes = require('./routes');

app.disable('x-powered-by');

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// Lightweight in-memory rate limiter (300 requests / 60s per IP)
const rateBuckets = new Map();
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX_REQUESTS = 300;
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') return next();
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return next();
  }
  bucket.count += 1;
  if (bucket.count > RATE_MAX_REQUESTS) {
    res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000));
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }
  return next();
});

// Strict CORS allowlist (supports comma-separated FRONTEND_URL + this project's Vercel deployment URLs)
const envOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((u) => u.trim().replace(/\/$/, ''))
  .filter(Boolean);

const allowedOrigins = new Set([
  ...envOrigins,
  ...(isProduction
    ? []
    : [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'https://localhost:3000',
        'https://127.0.0.1:3000',
      ]),
]);

const PROJECT_VERCEL_ORIGIN = /^https:\/\/(quecomemos-front|2025-pitlane-front)(-[a-z0-9-]+)?\.vercel\.app$/;

app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser / same-origin server-to-server requests with no Origin header
      if (!origin) return callback(null, true);
      const normalized = origin.replace(/\/$/, '');
      if (allowedOrigins.has(normalized) || PROJECT_VERCEL_ORIGIN.test(normalized)) {
        return callback(null, true);
      }
      if (!isProduction && (normalized.startsWith('http://localhost:') || normalized.startsWith('http://127.0.0.1:'))) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    credentials: true,
    optionsSuccessStatus: 200,
  })
);

app.use(express.json({ limit: '100kb' }));

app.get('/', (req, res) => {
  res.send('Backend is running!');
});

app.use('/', routes);

// Global error handler (avoids leaking stack traces in production)
app.use((err, req, res, next) => {
  if (err && err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  console.error('Unhandled error:', err);
  return res.status(500).json({
    error: 'Internal server error',
    ...(isProduction ? {} : { details: err?.message }),
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log('Environment:', process.env.NODE_ENV || 'development');
});
