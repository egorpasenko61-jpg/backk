/**
 * normalize.js
 *
 * Server-side normalisation of a poker table.
 *
 * Mirrors the client-side `normalizeTable` / `normalizeSeats` from game.js so
 * both ends agree on the shape. Keeping the rules in one place here means a
 * client upgrade doesn't accidentally desync the schema.
 */

export const MAX_SEATS = 5;
export const PHASE = { PRE_FLOP: 0, FLOP: 1, TURN: 2, RIVER: 3, SHOWDOWN: 4 };

export const TABLES_CONFIG = [
  { id: 'table_1', name: 'Стол №1 — Новичок',  bigBlind: 10,  minBuy: 100,  maxBuy: 500 },
  { id: 'table_2', name: 'Стол №2 — Любитель', bigBlind: 25,  minBuy: 250,  maxBuy: 1500 },
  { id: 'table_3', name: 'Стол №3 — Профи',    bigBlind: 100, minBuy: 1000, maxBuy: 5000 },
];

export function isSeatFree(seat) {
  return !seat || seat.playerId === null || seat.playerId === undefined;
}

export function normalizeSeats(seats) {
  const result = [];
  for (let i = 0; i < MAX_SEATS; i++) {
    let s = Array.isArray(seats) ? seats[i] : (seats && seats[i]) || (seats && seats[String(i)]);
    if (!s) {
      s = {
        seatIdx: i, playerId: null, name: null, chips: 0,
        holeCards: [], currentBet: 0, totalBet: 0,
        folded: false, isAllIn: false, isDealer: false, ready: false,
      };
    }
    result.push(s);
  }
  return result;
}

export function normalizeTable(t, tableId) {
  if (!t) return t;
  t.seats = normalizeSeats(t.seats);
  const cfg = TABLES_CONFIG.find((c) => c.id === tableId);
  if (cfg) {
    if (t.smallBlind === undefined || t.smallBlind === null) t.smallBlind = Math.floor(cfg.bigBlind / 2);
    if (t.bigBlind   === undefined || t.bigBlind   === null) t.bigBlind   = cfg.bigBlind;
    if (t.minBuy === undefined) t.minBuy = cfg.minBuy;
    if (t.maxBuy === undefined) t.maxBuy = cfg.maxBuy;
  }
  if (t.phase === undefined)        t.phase = PHASE.PRE_FLOP;
  if (!t.communityCards)            t.communityCards = [];
  if (t.pot === undefined)          t.pot = 0;
  if (t.currentSeat === undefined)  t.currentSeat = -1;
  if (t.dealerSeat === undefined)   t.dealerSeat = -1;
  if (t.smallBlindSeat === undefined) t.smallBlindSeat = -1;
  if (t.bigBlindSeat === undefined)   t.bigBlindSeat   = -1;
  if (t.callAmount === undefined)   t.callAmount = 0;
  if (t.lastRaiser === undefined)   t.lastRaiser = -1;
  if (!t.roundActed)                t.roundActed = [];
  if (t.bbSeatIdx === undefined)    t.bbSeatIdx = -1;
  if (t.handNumber === undefined)   t.handNumber = 0;
  if (!t.winners)                   t.winners = [];
  if (!t.winningCards)              t.winningCards = [];
  if (t.gameStarted === undefined)  t.gameStarted = false;
  if (!t.deck)                      t.deck = [];
  if (t.updatedAt === undefined)    t.updatedAt = Date.now();
  return t;
}

export function defaultTable(tableId) {
  const cfg = TABLES_CONFIG.find((t) => t.id === tableId);
  if (!cfg) throw new Error(`Unknown table id: ${tableId}`);
  return {
    id: tableId,
    name: cfg.name,
    bigBlind: cfg.bigBlind,
    smallBlind: Math.floor(cfg.bigBlind / 2),
    minBuy: cfg.minBuy,
    maxBuy: cfg.maxBuy,
    phase: PHASE.PRE_FLOP,
    communityCards: [],
    pot: 0,
    seats: Array.from({ length: MAX_SEATS }, (_, i) => ({
      seatIdx: i,
      playerId: null,
      name: null,
      chips: 0,
      holeCards: [],
      currentBet: 0,
      totalBet: 0,
      folded: false,
      isAllIn: false,
      isDealer: false,
      ready: false,
    })),
    currentSeat: -1,
    dealerSeat: -1,
    smallBlindSeat: -1,
    bigBlindSeat: -1,
    callAmount: 0,
    lastRaiser: -1,
    roundActed: [],
    bbSeatIdx: -1,
    handNumber: 0,
    winners: [],
    winningCards: [],
    gameStarted: false,
    deck: [],
    updatedAt: Date.now(),
  };
}

export function tableKey(tableId)    { return `tables/${tableId}`; }
export function lobbyKey()           { return 'tables'; }
export function leaderboardKey()     { return 'leaderboard/local'; }