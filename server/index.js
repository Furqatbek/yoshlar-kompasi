'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');

const { config, assertProdConfig } = require('./config');
const { securityHeaders } = require('./middleware/security');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { pool } = require('./db/pool');

assertProdConfig();

const app = express();
// Behind a TLS-terminating reverse proxy: honor X-Forwarded-* for req.ip/proto.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(securityHeaders);
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());

// Health / readiness.
app.get('/healthz', (req, res) => res.json({ ok: true }));
app.get('/readyz', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: true });
  } catch (e) {
    res.status(503).json({ ok: false, db: false });
  }
});

// API.
app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/telegram', require('./routes/telegram'));
app.use('/admin', require('./routes/admin'));

// Clean shareable links -> the hash-routed SPA.
app.get('/hisobot/:token', (req, res) => res.redirect(302, '/#/hisobot/' + encodeURIComponent(req.params.token)));
app.get('/mashgulot/:token', (req, res) => res.redirect(302, '/#/mashgulot/' + encodeURIComponent(req.params.token)));

// Static frontend (built by scripts/build-web.js into ./public).
const PUBLIC_DIR = path.join(__dirname, 'public');
const INDEX_HTML = path.join(PUBLIC_DIR, 'index.html');
const hasBuild = fs.existsSync(INDEX_HTML);
if (!hasBuild) {
  // eslint-disable-next-line no-console
  console.warn('[web] public/index.html not found — run `npm run build:web`. API still serves.');
}
app.use(
  express.static(PUBLIC_DIR, {
    index: false,
    setHeaders: (res, filePath) => {
      // The app shell must not be cached; hashed assets can be.
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

// SPA shell for any remaining GET (hash routes never hit the server, but this
// keeps deep links and refreshes working).
app.get('*', (req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/admin/')) return next();
  if (!hasBuild) return res.status(503).send('Frontend not built. Run `npm run build:web`.');
  return res.sendFile(INDEX_HTML);
});

app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log('[yoshlar-kompasi] listening on :' + config.port + ' (' + config.nodeEnv + ')');
  // Surface which LLM is actually wired up (a mismatched model id is the most
  // common misconfiguration) and which prompt version this build carries, so a
  // stale image is immediately visible in the logs. Never logs the API key.
  const claude = require('./services/claude');
  const prompt = require('./services/prompt');
  // eslint-disable-next-line no-console
  console.log('[llm] provider=' + config.llm.provider + ' model=' + claude.activeModel() + ' prompt=' + prompt.promptVersion());
});

function shutdown(sig) {
  // eslint-disable-next-line no-console
  console.log('[shutdown] ' + sig);
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
