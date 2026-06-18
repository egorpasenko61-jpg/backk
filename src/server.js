/**
 * server.js
 *
 * Express entry point. Wires up the routes, CORS, persistence and a graceful
 * shutdown. Run with `node src/server.js` (or via `npm start`).
 */

import express from 'express';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initDb, closeDb } from './lib/db.js';
import tablesRouter from './routes/tables.js';
import leaderboardRouter from './routes/leaderboard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
// `client/` sits one level up from `src/`. We resolve it relative to the
// compiled entry so the server works no matter where `node` is invoked from.
const CLIENT_DIR = path.resolve(__dirname, '..', 'client');

const PORT = Number(process.env.PORT) || 10000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// CORS: allow any origin by default (so the Yandex Games iframe can hit us)
// or restrict to a comma-separated list via ALLOWED_ORIGINS.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const corsOptions = allowedOrigins.length === 1 && allowedOrigins[0] === '*'
  ? { origin: true, credentials: false }
  : {
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);          // same-origin / curl
        if (allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error(`Origin not allowed: ${origin}`));
      },
      credentials: false,
    };

const app = express();

// Behind Render's proxy (and most reverse proxies), trust X-Forwarded-* so
// req.ip and rate-limiters see the real client.
app.set('trust proxy', 1);

app.use(cors(corsOptions));
app.use(compression());
app.use(express.json({ limit: '128kb' })); // tables are tiny; cap the body
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));

// ─── Static client (so the same Express process can serve the Yandex
// Games build as well as the API) ─────────────────────────────────────────
app.use(express.static(CLIENT_DIR, {
  // The client uses `?api=...` / `window.POKER_API_BASE` to point at the
  // backend; with same-origin serving the default `location.origin` already
  // matches the API. index.html is implicit for `/`.
  index: 'index.html',
  // Long cache for the engine + game bundles, no cache for HTML so deploys
  // pick up new code right away.
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  },
}));

// ─── Health & meta ────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    name: 'poker-backend',
    version: '1.0.0',
    node: process.version,
    uptime: process.uptime(),
    endpoints: {
      tables:        'GET /tables, GET /tables/:id',
      tables_write:  'PUT /tables/:id, PATCH /tables/:id, PUT /tables/:id/seats/:i',
      sse_lobby:     'GET /sse/tables',
      sse_table:     'GET /sse/tables/:id',
      leaderboard:   'GET /leaderboard, GET /leaderboard/top, POST /leaderboard/submit',
      sse_leaders:   'GET /sse/leaderboard',
    },
  });
});

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// ─── Routes ───────────────────────────────────────────────────────────────
app.use('/', tablesRouter);
app.use('/', leaderboardRouter);

// 404 with a useful message instead of HTML
app.use((req, res) => {
  res.status(404).json({ error: 'not_found', path: req.originalUrl });
});

// Express error handler — keeps CORS headers on errors too
app.use((err, _req, res, _next) => {
  if (err?.message?.startsWith?.('Origin not allowed')) {
    return res.status(403).json({ error: 'cors_denied', message: err.message });
  }
  console.error('[err]', err);
  res.status(500).json({ error: 'internal' });
});

// ─── Bootstrap ─────────────────────────────────────────────────────────────
initDb();

const server = app.listen(PORT, () => {
  console.log(`[poker-backend] listening on :${PORT}  (env=${NODE_ENV})`);
});

// SSE connections live a long time — bump timeouts so they don't get axed
server.keepAliveTimeout = 70_000;          // > typical 60s LB idle
server.headersTimeout   = 75_000;

// Render sends SIGTERM on redeploy. Cleanly close the DB so WAL is flushed.
function shutdown(signal) {
  console.log(`[poker-backend] ${signal} received, shutting down`);
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  // Hard-kill after 10s if connections refuse to drain.
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));