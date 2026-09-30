'use strict';

// The anonymous visitor id that threads the funnel together.
//
// The browser generates a random UUID once and sends it as `x-visitor-id` on
// every API call, so a request that proves a funnel step happened (a session
// start, a finished report) can be attributed to the same visitor who read the
// landing page earlier. Validating the shape here means a junk or oversized
// header is dropped at the edge rather than reaching an INSERT.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Returns a normalized uuid, or null when absent/malformed. Null is ordinary:
// analytics is best-effort and every caller must work without it.
function visitorIdOf(req) {
  const raw = String(req.get('x-visitor-id') || (req.body && req.body.visitor_id) || '');
  return UUID_RE.test(raw) ? raw.toLowerCase() : null;
}

module.exports = { visitorIdOf, UUID_RE };
