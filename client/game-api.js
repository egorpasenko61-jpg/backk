/**
 * game-api.js
 *
 * Drop-in replacement for the original `FirebaseDB` object that lives inside
 * game.js. Same surface (`get`, `set`, `update`, `subscribe`), same
 * semantics — but talks to the Render-hosted poker-backend instead of
 * Firebase Realtime Database.
 *
 * The optional `API_BASE` global lets you point the client at a custom
 * origin (handy for local dev). When unset we infer:
 *   1) `window.POKER_API_BASE` (set this in HTML for prod)
 *   2) current origin (works when front + back share a host / reverse proxy)
 *   3) `https://poker-backend.onrender.com` (sane default — change it!)
 */

(function (global) {
  'use strict';

  const DEFAULT_API = 'https://poker-backend.onrender.com';

  function resolveBase() {
    if (global.POKER_API_BASE) return String(global.POKER_API_BASE).replace(/\/$/, '');
    if (typeof location !== 'undefined' && location.origin) {
      // Same-origin proxy? Use it. The host can mount /api/* and the backend
      // serves it directly; no need to hard-code a Render URL.
      return location.origin.replace(/\/$/, '');
    }
    return DEFAULT_API;
  }

  const ApiClient = (() => {
    let base = resolveBase();
    // Allow hot-swapping (handy in dev tools)
    global.setPokerApiBase = (url) => { base = String(url).replace(/\/$/, ''); };

    async function req(method, path, body) {
      const url = `${base}${path}`;
      const init = {
        method,
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
      };
      if (body !== undefined) init.body = JSON.stringify(body);
      const res = await fetch(url, init);
      if (!res.ok) {
        let payload = null;
        try { payload = await res.json(); } catch { /* not JSON */ }
        const err = new Error(`HTTP ${res.status} ${res.statusText} on ${method} ${path}`);
        err.status = res.status;
        err.payload = payload;
        throw err;
      }
      const ct = res.headers.get('content-type') || '';
      return ct.includes('application/json') ? res.json() : res.text();
    }

    /**
     * Translate a Firebase-style path like 'tables/table_1' or
     * 'tables/table_1/seats/0' into our REST routes.
     */
    function routeFor(method, path) {
      const parts = path.split('/').filter(Boolean);
      if (parts[0] === 'tables') {
        if (parts.length === 1)               return { method: 'GET',   url: '/tables' };
        if (parts.length === 2)               return methodFromTable(method, parts[1]);
        if (parts.length === 4 && parts[2] === 'seats') {
          return { method: 'PUT', url: `/tables/${parts[1]}/seats/${parts[3]}` };
        }
      }
      if (parts[0] === 'leaderboard' && parts[1] === 'local' && method === 'GET') {
        return { method: 'GET', url: '/leaderboard' };
      }
      throw new Error(`Unsupported path: ${method} ${path}`);
    }

    function methodFromTable(method, tableId) {
      if (method === 'GET')    return { method: 'GET',   url: `/tables/${tableId}` };
      if (method === 'PUT')    return { method: 'PUT',   url: `/tables/${tableId}` };
      if (method === 'PATCH' || method === 'UPDATE') {
        return { method: 'PATCH', url: `/tables/${tableId}` };
      }
      throw new Error(`Unsupported table method: ${method}`);
    }

    // ─── Public API (mirrors the old FirebaseDB object) ──────────────────────

    /** Read a path. Returns the parsed JSON value or `null` if missing. */
    async function get(path) {
      const { method, url } = routeFor('GET', path);
      try { return await req(method, url); }
      catch (err) {
        if (err.status === 404) return null;
        throw err;
      }
    }

    /** Replace the value at a path (Firebase `set`). */
    async function set(path, data) {
      const { method, url } = routeFor('PUT', path);
      return req(method, url, data);
    }

    /** Shallow merge into the value at a path (Firebase `update`). */
    async function update(path, patch) {
      const { method, url } = routeFor('PATCH', path);
      return req(method, url, patch);
    }

    /**
     * Subscribe to changes at a path. Returns a teardown function.
     *
     * Strategy: open an SSE stream to /sse/<path>; the server pushes a fresh
     * `put` event whenever something changes. We forward it to the callback
     * (matching Firebase's onValue semantics — last-write-wins, no batching).
     */
    function subscribe(path, callback) {
      const parts = path.split('/').filter(Boolean);
      let sseUrl;
      if (parts[0] === 'tables') {
        sseUrl = parts.length === 1 ? '/sse/tables' : `/sse/tables/${parts[1]}`;
      } else if (parts[0] === 'leaderboard') {
        sseUrl = '/sse/leaderboard';
      } else {
        // Unsupported path: fire callback once with null, like Firebase would.
        callback(null);
        return () => {};
      }

      let es = null;
      let stopped = false;
      let backoff = 1000;
      let reconnectTimer = null;

      function connect() {
        if (stopped) return;
        try {
          es = new EventSource(`${base}${sseUrl}`, { withCredentials: false });
        } catch (err) {
          scheduleReconnect();
          return;
        }

        es.addEventListener('put', (e) => {
          backoff = 1000;
          try {
            const msg = JSON.parse(e.data);
            callback(msg.data === undefined ? null : msg.data);
          } catch (err) {
            console.error('[api] bad SSE payload', err);
          }
        });

        // Server-side `event: ping` is sent as a comment ("heartbeat"). We
        // don't react to it but we use it as a liveness signal.

        es.onerror = () => {
          if (stopped) return;
          try { es.close(); } catch { /* ignore */ }
          es = null;
          scheduleReconnect();
        };
      }

      function scheduleReconnect() {
        if (stopped || reconnectTimer) return;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, backoff);
        backoff = Math.min(backoff * 2, 30_000);
      }

      connect();
      return () => {
        stopped = true;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        if (es) try { es.close(); } catch { /* ignore */ }
      };
    }

    return { get, set, update, subscribe, base };
  })();

  global.ApiClient = ApiClient;
})(window);