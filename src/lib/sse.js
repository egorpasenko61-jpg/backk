/**
 * sse.js
 *
 * Tiny pub/sub bus that turns Node's EventEmitter into a per-client SSE stream.
 *
 * The client API mimics Firebase's onValue():
 *   const stop = subscribe('/tables/table_1', (data) => { ... })
 *
 * Internally we emit two kinds of events:
 *   - 'table:changed' (tableId)   when a single table is mutated
 *   - 'tables:changed' ()         when ANY table changes (used by lobby)
 *
 * Each SSE client filters server-side based on the path it subscribed to.
 */

import { EventEmitter } from 'node:events';

class SseBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0); // no limit; we manage per-client teardown ourselves
    this._nextId = 1;
  }

  nextId() { return this._nextId++; }
}

export const bus = new SseBus();

/**
 * Subscribe to changes for a specific "path".
 *
 * @param {import('express').Response} res   Express response, configured for SSE
 * @param {string} path                      Logical path, e.g. '/tables' or '/tables/table_1'
 * @param {() => object|null} snapshot       Initial value getter
 * @returns {() => void}                     Function that tears the subscription down
 */
export function sseSubscribe(res, path, snapshot) {
  // 1) Headers + initial snapshot
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable buffering on nginx-style proxies
  res.flushHeaders?.();

  const id = bus.nextId();
  const write = (eventName, data) => {
    if (res.writableEnded || res.destroyed) return;
    try {
      if (eventName) res.write(`event: ${eventName}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (err) {
      // Connection died mid-write; clean up.
      teardown();
    }
  };

  const sendSnapshot = () => {
    const value = snapshot();
    write('put', { path, data: value });
  };

  // Initial push
  sendSnapshot();

  // 2) Wire up listeners depending on path
  const listenerTable = (changedId) => {
    if (path === `/tables/${changedId}` || path === '/tables') sendSnapshot();
  };
  const listenerLobby = () => {
    if (path === '/tables') sendSnapshot();
  };

  bus.on('table:changed', listenerTable);
  bus.on('tables:changed', listenerLobby);

  // 3) Heartbeat so proxies / Render don't kill an idle connection
  const heartbeatMs = Number(process.env.SSE_HEARTBEAT_MS) || 15000;
  const heartbeat = setInterval(() => {
    if (res.writableEnded || res.destroyed) {
      teardown();
      return;
    }
    try { res.write(`: ping ${Date.now()}\n\n`); } catch { teardown(); }
  }, heartbeatMs);

  // 4) Teardown
  const teardown = () => {
    clearInterval(heartbeat);
    bus.off('table:changed', listenerTable);
    bus.off('tables:changed', listenerLobby);
    if (!res.writableEnded) {
      try { res.end(); } catch { /* ignore */ }
    }
  };

  res.on('close', teardown);
  res.on('error', teardown);

  return teardown;
}

/**
 * Publish a change. Caller still owns persisting via db.set/db.patch.
 */
export function publishTable(tableId) {
  bus.emit('table:changed', tableId);
  bus.emit('tables:changed');
}