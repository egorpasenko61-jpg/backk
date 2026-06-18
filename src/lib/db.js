/**
 * db.js
 *
 * Persistent key-value store backed by SQLite (built-in `node:sqlite`).
 * Every "table" state is stored as a single JSON blob under one key, which
 * mirrors the Firebase RTDB shape the client already understands:
 *
 *   tables/table_1        -> JSON state
 *   tables/table_2        -> JSON state
 *   leaderboard/local      -> JSON object { playerId: { name, score, wins, hands, lastSeen } }
 *
 * Reads use an in-memory cache; writes go through SQLite synchronously.
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DB_PATH = process.env.DB_PATH || path.resolve(process.cwd(), 'data/poker.db');

let db = null;
const cache = new Map();

function ensureDir(p) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function initDb(customPath) {
  const dbPath = customPath || DEFAULT_DB_PATH;
  ensureDir(dbPath);
  db = new DatabaseSync(dbPath);

  // Single key/value table. JSON blob keeps the data shape identical to the
  // original Firebase RTDB layout, which simplifies the client-side port.
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      mtime INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS kv_mtime_idx ON kv(mtime);
  `);

  // Warm the cache from disk so the first request is fast.
  const rows = db.prepare('SELECT key, value FROM kv').all();
  for (const row of rows) {
    try {
      cache.set(row.key, JSON.parse(row.value));
    } catch (err) {
      console.error('[db] failed to parse', row.key, err.message);
    }
  }

  console.log(`[db] ready: ${dbPath} (${cache.size} entries loaded)`);
  return db;
}

export function closeDb() {
  if (db) {
    try { db.close(); } catch (err) { /* ignore */ }
    db = null;
  }
}

function requireDb() {
  if (!db) throw new Error('DB not initialised. Call initDb() first.');
  return db;
}

export function get(key) {
  if (cache.has(key)) return cache.get(key);
  const row = requireDb().prepare('SELECT value FROM kv WHERE key = ?').get(key);
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value);
    cache.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export function set(key, value) {
  cache.set(key, value);
  requireDb()
    .prepare('INSERT INTO kv(key, value, mtime) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, mtime = excluded.mtime')
    .run(key, JSON.stringify(value), Date.now());
}

export function del(key) {
  cache.delete(key);
  requireDb().prepare('DELETE FROM kv WHERE key = ?').run(key);
}

/** Atomic deep-merge like Firebase PATCH at a JSON-pointer path. */
export function patch(rootKey, partial) {
  const current = get(rootKey);
  const next = mergeDeep(current || {}, partial);
  set(rootKey, next);
  return next;
}

function mergeDeep(target, source) {
  if (Array.isArray(source)) return source.slice();
  if (source === null || typeof source !== 'object') return source;
  const out = { ...(target || {}) };
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = mergeDeep(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function keys(prefix) {
  const all = [];
  for (const k of cache.keys()) {
    if (k.startsWith(prefix)) all.push(k);
  }
  return all;
}