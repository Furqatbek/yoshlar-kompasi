'use strict';

const { config } = require('../config');

// Absolute, shareable report link. Prefers PUBLIC_BASE_URL; otherwise derives
// from the request (works behind a TLS-terminating proxy when trust proxy is on).
// The server redirects /hisobot/:token -> /#/hisobot/:token so the link opens
// the report directly.
function reportUrl(req, token) {
  const base = config.publicBaseUrl || (req.protocol + '://' + req.get('host'));
  return base.replace(/\/+$/, '') + '/hisobot/' + token;
}

module.exports = { reportUrl };
