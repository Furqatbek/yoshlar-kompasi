'use strict';

const jwt = require('jsonwebtoken');
const { config } = require('../config');
const repo = require('../db/repo');
const { timingSafeEqual } = require('../utils/tokens');
const { asyncHandler, unauthorized, notFound } = require('../utils/http');

// Parent-facing auth: an unguessable session token (spec §2). The token arrives
// in the X-Session-Token header (browser localStorage) or a Bearer header.
const sessionAuth = asyncHandler(async (req, res, next) => {
  const header = req.get('x-session-token') || '';
  const bearer = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const token = header || bearer;
  const session = await repo.getSessionById(req.params.id);
  if (!session) throw notFound('Mashg‘ulot topilmadi.');
  if (!token || !timingSafeEqual(token, session.session_token)) {
    throw unauthorized('Mashg‘ulotga ruxsat yo‘q.');
  }
  req.session = session;
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

module.exports = { sessionAuth, adminAuth, signAdmin, adminCookieOptions };
