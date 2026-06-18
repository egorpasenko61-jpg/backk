/**
 * routes/tables.js
 *
 * REST endpoints that match the original Firebase RTDB shape:
 *   GET    /tables                    -> all configured tables (lobby)
 *   GET    /tables/:tableId           -> one table
 *   PUT    /tables/:tableId           -> replace whole table
 *   PATCH  /tables/:tableId           -> shallow merge
 *   PUT    /tables/:tableId/seats/:i  -> replace one seat
 *   GET    /sse/tables                -> SSE stream over the lobby snapshot
 *   GET    /sse/tables/:tableId       -> SSE stream over one table
 */

import express from 'express';
import * as db from '../lib/db.js';
import { bus, sseSubscribe, publishTable } from '../lib/sse.js';
import {
  TABLES_CONFIG, MAX_SEATS, isSeatFree,
  defaultTable, normalizeTable,
  tableKey, lobbyKey,
} from '../lib/normalize.js';

const router = express.Router();

// ─── Lobby: list all tables ────────────────────────────────────────────────
router.get('/tables', (req, res) => {
  const out = {};
  for (const cfg of TABLES_CONFIG) {
    let t = db.get(tableKey(cfg.id));
    if (!t) {
      t = defaultTable(cfg.id);
      db.set(tableKey(cfg.id), t);
    } else {
      t = normalizeTable(t, cfg.id);
    }
    out[cfg.id] = t;
  }
  res.json(out);
});

// ─── One table ─────────────────────────────────────────────────────────────
router.get('/tables/:tableId', (req, res) => {
  const { tableId } = req.params;
  const cfg = TABLES_CONFIG.find((t) => t.id === tableId);
  if (!cfg) return res.status(404).json({ error: 'unknown_table', tableId });

  let t = db.get(tableKey(tableId));
  if (!t) {
    t = defaultTable(tableId);
    db.set(tableKey(tableId), t);
  } else {
    t = normalizeTable(t, tableId);
  }
  res.json(t);
});

// ─── Replace whole table (Firebase `set` on a path) ────────────────────────
router.put('/tables/:tableId', (req, res) => {
  const { tableId } = req.params;
  const cfg = TABLES_CONFIG.find((t) => t.id === tableId);
  if (!cfg) return res.status(404).json({ error: 'unknown_table', tableId });

  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'invalid_body' });
  }
  const next = normalizeTable({ ...req.body, id: tableId }, tableId);
  next.updatedAt = Date.now();
  db.set(tableKey(tableId), next);
  publishTable(tableId);
  res.json(next);
});

// ─── Partial update (Firebase `update`) ────────────────────────────────────
router.patch('/tables/:tableId', (req, res) => {
  const { tableId } = req.params;
  const cfg = TABLES_CONFIG.find((t) => t.id === tableId);
  if (!cfg) return res.status(404).json({ error: 'unknown_table', tableId });

  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'invalid_body' });
  }
  const current = db.get(tableKey(tableId)) || defaultTable(tableId);
  const merged = { ...current, ...req.body, id: tableId };
  merged.updatedAt = Date.now();
  const normalized = normalizeTable(merged, tableId);
  db.set(tableKey(tableId), normalized);
  publishTable(tableId);
  res.json(normalized);
});

// ─── Replace one seat (Firebase `set` on tables/.../seats/<i>) ─────────────
router.put('/tables/:tableId/seats/:seatIdx', (req, res) => {
  const { tableId, seatIdx } = req.params;
  const idx = Number(seatIdx);
  const cfg = TABLES_CONFIG.find((t) => t.id === tableId);
  if (!cfg) return res.status(404).json({ error: 'unknown_table', tableId });
  if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_SEATS) {
    return res.status(400).json({ error: 'invalid_seat', seatIdx });
  }
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'invalid_body' });
  }

  const current = db.get(tableKey(tableId)) || defaultTable(tableId);
  const seats = current.seats.slice();
  seats[idx] = { ...seats[idx], ...req.body, seatIdx: idx };
  const next = { ...current, seats, updatedAt: Date.now() };
  db.set(tableKey(tableId), next);
  publishTable(tableId);
  res.json(seats[idx]);
});

// ─── SSE: lobby ───────────────────────────────────────────────────────────
router.get('/sse/tables', (req, res) => {
  const snapshot = () => {
    const out = {};
    for (const cfg of TABLES_CONFIG) {
      let t = db.get(tableKey(cfg.id));
      if (!t) { t = defaultTable(cfg.id); db.set(tableKey(cfg.id), t); }
      else t = normalizeTable(t, cfg.id);
      out[cfg.id] = t;
    }
    return out;
  };
  sseSubscribe(res, '/tables', snapshot);
});

// ─── SSE: single table ────────────────────────────────────────────────────
router.get('/sse/tables/:tableId', (req, res) => {
  const { tableId } = req.params;
  const cfg = TABLES_CONFIG.find((t) => t.id === tableId);
  if (!cfg) return res.status(404).json({ error: 'unknown_table', tableId });

  const snapshot = () => {
    let t = db.get(tableKey(tableId));
    if (!t) { t = defaultTable(tableId); db.set(tableKey(tableId), t); }
    else t = normalizeTable(t, tableId);
    return t;
  };
  sseSubscribe(res, `/tables/${tableId}`, snapshot);
});

export default router;