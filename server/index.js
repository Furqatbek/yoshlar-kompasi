'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const compression = require('compression');

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
// The app shell is one 200 KB HTML file and the runtime another 66 KB, and the
// audience is on Uzbek mobile data. Uncompressed that was 610 KB per cold load;
// gzipped it is about a fifth of that, for the cost of this line. nginx is in
// front in production but only for TLS, and a developer running the container
// directly has no proxy at all — so this belongs here, not in the proxy config.
app.use(compression({
  // The default brotli quality is 4, which on this shell is *worse* than gzip
  // (45 KB vs 45 KB, measured) because it trades ratio for streaming latency.
  // 6 gives 41 KB for the same 9ms. 11 would give 37 KB but costs 325ms of CPU
  // per request, which is a build-time job, not a per-request one.
  brotli: { params: { [require('zlib').constants.BROTLI_PARAM_QUALITY]: 6 } },
}));
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());

// How long the server itself took, so "the app is slow" can be answered with a
// number instead of a guess. The browser shows this under Network -> Timing;
// anything the header does not account for happened on the wire or in the page.
// A slow request also says so in the log, which is where a struggling database
// shows up first.
const SLOW_MS = Number(process.env.SLOW_REQUEST_MS || 500);
app.use((req, res, next) => {
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (ms >= SLOW_MS && !req.path.startsWith('/healthz')) {
      // eslint-disable-next-line no-console
      console.warn('[slow] ' + req.method + ' ' + req.path + ' took ' + Math.round(ms) + 'ms');
    }
  });
  const done = res.writeHead;
  res.writeHead = function patched(...args) {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (!res.headersSent) { try { res.setHeader('Server-Timing', 'app;dur=' + ms.toFixed(1)); } catch (_) { /* already sent */ } }
    return done.apply(this, args);
  };
  next();
});

// Health / readiness. The build stamp answers "is the thing I deployed the
// thing I am looking at?", which is otherwise guesswork across a rebuild.
const BUILD = {
  commit: (process.env.GIT_COMMIT || '').slice(0, 12) || null,
  started_at: new Date().toISOString(),
};
app.get('/healthz', (req, res) => res.json({
  ok: true,
  ...BUILD,
  // Both of these were slow once and are the first things to check if starting
  // a sitting ever feels slow again.
  model_called_on_start: false,
  questions_sent_with_session: true,
}));
app.get('/readyz', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: true });
  } catch (e) {
    res.status(503).json({ ok: false, db: false });
  }
});

// API.
app.use('/api/config', require('./routes/config'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/diary', require('./routes/diary'));
app.use('/api/telegram', require('./routes/telegram'));
app.use('/api/track', require('./routes/track'));
app.use('/api/payments', require('./routes/payme'));
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
      // The app shell must always be re-checked: it carries the application
      // itself, so a stale copy is a stale product.
      if (filePath.endsWith('index.html')) return res.setHeader('Cache-Control', 'no-cache');
      // A webfont file is its own version: the name says which family, style
      // and subset it is, and a different cut would be a different file. These
      // are the largest things we serve, so they get the long cache.
      if (/\.(woff2?|ttf|otf)$/.test(filePath)) {
        return res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
      // Everything else is React, the runtime and the design system — none of
      // which changes without a deploy, and all of which is re-downloaded on
      // every visit without this. The filenames are not content-hashed, so this
      // is a day rather than a year, and `must-revalidate` means a deploy is
      // picked up on the next day-old load rather than whenever the browser
      // feels like asking.
      res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
    },
  })
);

// SPA shell for any remaining GET (hash routes never hit the server, but this
// keeps deep links and refreshes working).
app.get('*', (req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/admin/')) return next();
  if (!hasBuild) return res.status(503).send('Frontend not built. Run `npm run build:web`.');
  // Same rule as the static copy: every deep link and refresh re-checks the
  // shell. sendFile's own default is max-age=0, which amounts to the same
  // thing, but saying it means the two paths cannot drift.
  res.setHeader('Cache-Control', 'no-cache');
  return res.sendFile(INDEX_HTML);
});

app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(config.port, async () => {
  // eslint-disable-next-line no-console
  console.log('[yoshlar-kompasi] listening on :' + config.port + ' (' + config.nodeEnv + ')');
  // Load the live question bank before anything assembles a prompt. If the
  // database is unreachable the seeded file still serves, so a bank problem
  // degrades to the shipped default rather than to an empty assessment.
  try {
    const questionBank = require('./services/questionBank');
    await questionBank.refresh();
    require('./services/prompt').invalidate();
    await require('./routes/sessions').refreshTotal();
    const bank = await questionBank.load();
    // eslint-disable-next-line no-console
    console.log('[bank] ' + bank.activeCount + '/' + bank.total + ' questions active across '
      + bank.sections.length + ' sections');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[bank] falling back to the seeded file: ' + err.message);
  }
  // Surface which LLM is actually wired up (a mismatched model id is the most
  // common misconfiguration) and which prompt version this build carries, so a
  // stale image is immediately visible in the logs. Never logs the API key.
  const claude = require('./services/claude');
  const prompt = require('./services/prompt');
  // eslint-disable-next-line no-console
  console.log('[llm] provider=' + config.llm.provider + ' model=' + claude.activeModel() + ' prompt=' + prompt.promptVersion());

  // Whether the key works and the account can call that model. Both are
  // configuration, and both were previously discovered by a child answering
  // seventy questions and the one model call of the sitting coming back 401.
  // Costs no tokens, and is never fatal.
  try {
    await require('./services/llmCheck').report();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[llm] provider check skipped: ' + err.message);
  }

  // Whether Telegram is actually pointed at us. Nothing here is fatal, and it
  // costs one HTTP call at boot — against a login flow that otherwise fails by
  // going quiet, with no log line anywhere, because the thing that failed
  // never reached us.
  try {
    await require('./services/delivery/webhookCheck').report();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[telegram] webhook check skipped: ' + err.message);
  }
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
