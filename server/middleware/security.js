'use strict';

const { config } = require('../config');

// Minimal, dependency-free security headers. The frontend is a self-contained
// x-dc app with inline scripts/styles, so the CSP allows 'unsafe-inline' for
// script/style but locks connect/img/etc. to same-origin. React is vendored, so
// no external script origins are needed. 'unsafe-eval' is required: the x-dc
// runtime compiles each component's <script data-dc-script> class with
// `new Function`, which CSP treats as eval — without it the app renders
// "props only" with no interactivity.
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (config.isProd) {
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' data:",
        "connect-src 'self'",
        "frame-ancestors 'self'",
        "base-uri 'self'",
      ].join('; ')
    );
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

module.exports = { securityHeaders };
