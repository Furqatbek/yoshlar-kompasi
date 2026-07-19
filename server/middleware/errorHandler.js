'use strict';

const { config } = require('../config');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  // Never leak internals or children's data into responses/logs. Log ids only.
  if (status >= 500) {
    // Log ids only, never nicknames/answers (spec §6); key by session when known.
    const sid = req.session && req.session.id ? ' session=' + req.session.id : '';
    // eslint-disable-next-line no-console
    console.error('[error] ' + req.method + ' ' + req.path + sid + ' -> ' + status + ': ' + err.message);
    if (!config.isProd && err.stack) {
      // eslint-disable-next-line no-console
      console.error(err.stack);
    }
  }
  const body = {
    error: status >= 500 ? 'Serverda xatolik. Birozdan so‘ng urinib ko‘ring.' : err.message || 'Xatolik',
  };
  if (err.code) body.code = err.code;
  if (err.retryable) body.retryable = true;
  res.status(status).json(body);
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Topilmadi.' });
}

module.exports = { errorHandler, notFoundHandler };
