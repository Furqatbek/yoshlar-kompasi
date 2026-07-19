'use strict';

// In-memory sliding-window rate limiter (backend-spec §6). Single-instance; for
// multi-instance deployments back this with Redis (see README). Buckets are
// pruned lazily and on a periodic sweep so memory stays bounded.

const { tooMany } = require('../utils/http');

const store = new Map(); // key -> number[] (timestamps ms)

function hit(key, windowMs, max, now) {
  let arr = store.get(key);
  if (!arr) { arr = []; store.set(key, arr); }
  const cutoff = now - windowMs;
  // Drop expired entries (arrays are small and mostly append-only).
  let i = 0;
  while (i < arr.length && arr[i] <= cutoff) i++;
  if (i > 0) arr.splice(0, i);
  if (arr.length >= max) return false;
  arr.push(now);
  return true;
}

// key(req) -> string identifying the caller bucket.
function rateLimit({ windowMs, max, key, message }) {
  return (req, res, next) => {
    const k = key(req);
    if (k == null) return next();
    const ok = hit(String(k), windowMs, max, Date.now());
    if (!ok) return next(tooMany(message));
    return next();
  };
}

// Periodic sweep to evict fully-expired buckets.
const MAX_WINDOW = 24 * 60 * 60 * 1000;
const sweep = setInterval(() => {
  const cutoff = Date.now() - MAX_WINDOW;
  for (const [k, arr] of store) {
    if (!arr.length || arr[arr.length - 1] <= cutoff) store.delete(k);
  }
}, 60 * 60 * 1000);
if (sweep.unref) sweep.unref();

// Client IP honoring a trusted proxy (app.set('trust proxy', ...)).
function clientIp(req) {
  return req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
}

module.exports = { rateLimit, clientIp };
