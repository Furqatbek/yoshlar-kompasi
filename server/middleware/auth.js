'use strict';

const jwt = require('jsonwebtoken');
const { config } = require('../config');
const repo = require('../db/repo');
const { asyncHandler, unauthorized, notFound } = require('../utils/http');

// Parent-facing auth (spec §2): the :id path segment IS the unguessable session
// token — it lives in the URL (/mashgulot/:token) and localStorage and doubles
// as the credential, so a resume link works from any device. A wrong/expired
// token resolves to nothing and returns 404 (no existence oracle). The token is
// 256-bit random and looked up by a UNIQUE index, so it is not brute-forceable.
const sessionAuth = asyncHandler(async (req, res, next) => {
  const session = req.params.id ? await repo.getSessionByToken(req.params.id) : null;
  if (!session) throw notFound('Mashg‘ulot topilmadi.');
  req.session = session;
  next();
});

// Parent auth, for the things that outlive a sitting — the reading diary is
// the first. A session token identifies ONE assessment; the diary belongs to
// the child and is kept for months, across sittings and devices, so it needs
// the parent's own token (the one the Telegram login issues).
//
// Unauthorized rather than notFound: unlike a session token, the caller knows
// perfectly well whether they are logged in, so there is no existence oracle
// to protect and "log in again" is the useful answer.
const parentAuth = asyncHandler(async (req, res, next) => {
  const token = String(req.get('x-parent-token') || (req.body && req.body.parent_token) || '');
  const parent = token ? await repo.getParentByToken(token) : null;
  if (!parent) throw unauthorized('Tizimga qayta kiring.');
  req.parent = parent;
  next();
});

// Admin auth: signed JWT in an httpOnly cookie.
function signAdmin(admin) {
  return jwt.sign(
    { sub: admin.id, email: admin.email, role: admin.role },
    config.admin.jwtSecret,
    { expiresIn: config.admin.sessionTtlHours + 'h' }
  );
}

function adminCookieOptions() {
  return {
    httpOnly: true,
    secure: config.admin.cookieSecure,
    sameSite: 'lax',
    maxAge: config.admin.sessionTtlHours * 3600 * 1000,
    path: '/',
  };
}

function adminAuth(req, res, next) {
  const token = req.cookies && req.cookies[config.admin.cookieName];
  if (!token) return next(unauthorized('Admin sifatida kiring.'));
  try {
    req.admin = jwt.verify(token, config.admin.jwtSecret);
    return next();
  } catch (_) {
    return next(unauthorized('Sessiya muddati tugadi. Qayta kiring.'));
  }
}

module.exports = { sessionAuth, parentAuth, adminAuth, signAdmin, adminCookieOptions };
