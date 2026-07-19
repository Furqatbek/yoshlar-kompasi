'use strict';

const crypto = require('crypto');

// URL-safe random tokens. Session tokens are long (spec: 32+ bytes); share
// tokens are shorter but still unguessable.
function randomToken(bytes) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sessionToken() {
  return randomToken(32); // 256-bit
}

function shareToken() {
  return randomToken(18); // 144-bit, compact for links
}

// Constant-time string comparison to avoid timing leaks on token checks.
function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

module.exports = { randomToken, sessionToken, shareToken, timingSafeEqual };
