/**
 * routes/leaderboard.js
 *
 * Global leaderboard backed by the same SQLite store.
 *
 * Mirrors `LocalLeaderboard` from the client (which used localStorage as a
 * dev-mode fallback) but exposes it over the network so two players in
 * different browsers actually compete against each other.
 *
 * Schema: { [playerId]: { name, score, wins, hands, lastSeen } }
 */

import express from 'express';
import * as db from '../lib/db.js';
import { bus, sseSubscribe } from '../lib/sse.js';
import { leaderboardKey } from '../lib/normalize.js';

const router = express.Router();

function load() {
  return db.get(leaderboardKey()) || {};
}

function save(data) {
  db.set(leaderboardKey(), data);
  bus.emit('leaderboard:changed');
}

router.get('/leaderboard/top', (req, res) => {
  const n = Math.min(Math.max(Number(req.query.n) || 10, 1), 100);
  const data = load();
  const top = Object.entries(data)
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => (b.score - a.score) || (b.wins - a.wins))
    .slice(0, n);
  res.json(top);
});

router.post('/leaderboard/submit', (req, res) => {
  const { playerId, name, score, won } = req.body || {};
  if (!playerId || typeof playerId !== 'string') {
    return res.status(400).json({ error: 'invalid_playerId' });
  }
  const safeName = (typeof name === 'string' && name.trim()) ? name.trim().slice(0, 32) : 'Игрок';
  const safeScore = Math.max(0, Math.floor(Number(score) || 0));
  const wonFlag = !!won;

  const data = load();
  const cur = data[playerId] || { name: safeName, score: 0, wins: 0, hands: 0, lastSeen: 0 };
  data[playerId] = {
    name:     safeName,
    score:    Math.max(Number(cur.score) || 0, safeScore),
    wins:     (Number(cur.wins)  || 0) + (wonFlag ? 1 : 0),
    hands:    (Number(cur.hands) || 0) + 1,
    lastSeen: Date.now(),
  };
  save(data);
  res.json({ ok: true, entry: data[playerId] });
});

router.get('/leaderboard', (req, res) => {
  res.json(load());
});

router.get('/sse/leaderboard', (req, res) => {
  const snapshot = () => load();
  sseSubscribe(res, '/leaderboard', snapshot);
});

export default router;