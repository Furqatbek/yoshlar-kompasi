'use strict';

// POST /api/track — the browser reporting a funnel step it alone can see.
//
// Only the stages marked `client` in services/funnel.js are accepted here.
// Everything that proves real progress (a login completing, a session
// starting, a report finishing) is recorded by the server from the request
// that did it, so nobody can inflate the numbers the centre plans around by
// POSTing `finished` in a loop.
//
// Unauthenticated by necessity — the first stage happens before anyone has
// identified themselves — so it is rate-limited per IP, accepts nothing but a
// stage and an opaque visitor id, and answers 204 with no body to read.

const express = require('express');
const router = express.Router();

const repo = require('../db/repo');
const funnel = require('../services/funnel');
const { rateLimit, clientIp } = require('../middleware/rateLimit');
const { visitorIdOf } = require('../utils/visitor');

// A full run through the funnel is ~6 client events. This leaves room for
// tab-switching and reloads while capping a noisy or malicious client.
const trackLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  key: (r) => 'track:' + clientIp(r),
  message: 'rate limited',
});

// Keep the stored source to a short, low-cardinality label: a utm_source or a
// bare hostname. Anything else (a full referring URL, which can carry a search
// query or a personal identifier) is reduced to its host or dropped.
function cleanSource(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s || s.length > 120) return null;
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(s)) return null;
  return s;
}

router.post('/', trackLimiter, (req, res) => {
  // Answer before doing the work. The client uses sendBeacon and never reads
  // the response, and a rejected beacon must not look any different from an
  // accepted one — there is nothing here worth telling a caller about.
  res.status(204).end();

  // Everything past the response is best-effort and must not throw: an
  // exception here would reach Express after the headers are gone.
  (async () => {
    const b = req.body || {};
    const stage = String(b.stage || '');
    const visitorId = visitorIdOf(req);
    if (!visitorId || !funnel.isClientStage(stage)) return;

    const parent = await repo.getParentByToken(String(req.get('x-parent-token') || ''));
    await repo.recordEvent({
      visitorId,
      stage,
      parentId: parent ? parent.id : null,
      source: cleanSource(b.source),
    });
  })().catch((err) => {
    // eslint-disable-next-line no-console
    console.warn('[analytics] track failed', err.message);
  });
});

module.exports = router;
