require('dotenv').config();
process.env.TZ = process.env.TZ || 'America/Argentina/Buenos_Aires';
const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3005;
const isProduction = process.env.NODE_ENV === 'production';

const routes = require('./routes');

app.disable('x-powered-by');

// Behind a reverse proxy (Vercel / Render / Heroku) req.ip is the proxy's address unless Express
// is told how many proxy hops to trust. Without this every user shares one rate-limit bucket.
// TRUST_PROXY accepts a hop count (e.g. 1); defaults to 1 in production and off in development.
const trustProxyEnv = process.env.TRUST_PROXY;
if (trustProxyEnv !== undefined && trustProxyEnv !== '') {
  const hops = Number(trustProxyEnv);
  app.set('trust proxy', Number.isInteger(hops) ? hops : trustProxyEnv === 'true');
} else if (isProduction) {
  app.set('trust proxy', 1);
}

// Security headers (this is a JSON API: nothing should ever be framed, scripted or embedded)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  if (isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  }
  next();
});

// Never leak internals (Prisma messages, table names, stack details) on 5xx responses in production.
// Handlers keep logging the real error with console.error; only the response body is sanitised.
app.use((req, res, next) => {
  if (!isProduction) return next();
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 500 && body && typeof body === 'object') {
      return originalJson({ error: 'Internal server error' });
    }
    return originalJson(body);
  };
  return next();
});

// In-memory fixed-window rate limiter keyed by client IP.
function createRateLimiter({ windowMs, max, methods }) {
  const buckets = new Map();
  // Expired buckets are purged periodically so the map cannot grow without bound
  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now > bucket.resetAt) buckets.delete(key);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    if (methods && !methods.includes(req.method)) return next();
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const bucket = buckets.get(ip);
    if (!bucket || now > bucket.resetAt) {
      buckets.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > max) {
      res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000));
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    return next();
  };
}

// General limit + a stricter one for state-changing requests
app.use(createRateLimiter({ windowMs: 60 * 1000, max: 300 }));
app.use(createRateLimiter({ windowMs: 60 * 1000, max: 90, methods: ['POST', 'PUT', 'PATCH', 'DELETE'] }));

// Strict CORS allowlist
const envOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((u) => u.trim().replace(/\/$/, ''))
  .filter(Boolean);

const allowedOrigins = new Set([
  ...envOrigins,
  // Exact production aliases of this project's Vercel deployments
  'https://quecomemos-front.vercel.app',
  'https://2025-pitlane-front.vercel.app',
  ...(isProduction
    ? []
    : [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'https://localhost:3000',
        'https://127.0.0.1:3000',
      ]),
]);

// Preview deployments (<project>-<hash>-<team>.vercel.app) are only allowed when the owning team's
// suffix is configured, e.g. VERCEL_PREVIEW_SUFFIX=-ludmilampapa.vercel.app. Anyone can create a
// Vercel project called "quecomemos-front-xyz", so matching on the project prefix alone is unsafe.
const previewSuffix = (process.env.VERCEL_PREVIEW_SUFFIX || '').trim().toLowerCase();
const PREVIEW_ORIGIN =
  previewSuffix && /^-[a-z0-9-]+\.vercel\.app$/.test(previewSuffix)
    ? new RegExp(
        `^https://(quecomemos-front|2025-pitlane-front)(-[a-z0-9]+)*${previewSuffix.replace(/\./g, '\\.')}$`
      )
    : null;

if (isProduction && envOrigins.length === 0) {
  console.warn('[security] FRONTEND_URL is not set: only the default Vercel aliases are allowed by CORS.');
}

app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser / same-origin server-to-server requests with no Origin header
      if (!origin) return callback(null, true);
      const normalized = origin.replace(/\/$/, '');
      if (allowedOrigins.has(normalized) || (PREVIEW_ORIGIN && PREVIEW_ORIGIN.test(normalized))) {
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
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON body' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Payload too large' });
  }
  console.error('Unhandled error:', err);
  return res.status(500).json({
    error: 'Internal server error',
    ...(isProduction ? {} : { details: err?.message }),
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log('Environment:', process.env.NODE_ENV || 'development');
  });
}

module.exports = app;
