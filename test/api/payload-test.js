// What a cold visit actually costs to download, and how many round trips the
// first question is behind.
//
// The landing page took 610 KB over 15 requests and about a second before the
// hero appeared on a fast connection — twelve on mobile data, which is what
// this audience is on. None of that is visible in a screenshot, in a test that
// asserts on content, or on a developer's laptop next to the server. It only
// shows up as "the page is slow", which is how it was reported.
//
// Four things got it to 180 KB, and each one can be undone by a change that
// looks unrelated:
//
//   * compression — off by default in Express, and 200 KB of markup is the
//     single biggest thing we serve
//   * the runtime's second download of the whole shell, suppressed by
//     declaring an empty resource map (see server/scripts/build-web.js)
//   * cache headers, absent by default, so React and the fonts came down again
//     on every visit
//   * the inventory riding along with the session, instead of a second request
//     the first question waits on
//
//   BASE_URL=http://127.0.0.1:8091 node test/api/payload-test.js
//
// Thresholds are deliberately loose: they are there to catch something
// switching off, not to police a few kilobytes.

const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8091';
const PUBLIC = path.join(__dirname, '..', '..', 'server', 'public');

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  ok  - ' : '  FAIL- ') + n + (x ? '   ' + x : '')); };

const { installAuth } = require('./auth-helper');

// Raw bytes off the socket, which is the number that matters and the one
// fetch() will not give you: undici decodes the body transparently, so a
// compressed response measured with fetch reads at its full decoded size and
// the test passes while the page stays slow.
const http = require('http');
function fetchEncoded(p, enc) {
  const u = new URL(BASE + p);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET',
      headers: { 'accept-encoding': enc || 'br, gzip' },
    }, (res) => {
      let bytes = 0;
      res.on('data', (c) => { bytes += c.length; });
      res.on('end', () => resolve({
        status: res.statusCode, bytes,
        enc: res.headers['content-encoding'] || null,
        cache: res.headers['cache-control'] || null,
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  // ---- the shell ----------------------------------------------------------
  const shell = await fetchEncoded('/');
  const raw = fs.statSync(path.join(PUBLIC, 'index.html')).size;
  ok('the app shell is served', shell.status === 200, 'status=' + shell.status);
  ok('  compressed', !!shell.enc, 'content-encoding=' + shell.enc);
  ok('  to a fraction of its size', shell.bytes < raw / 3,
    Math.round(shell.bytes / 1024) + ' KB on the wire vs ' + Math.round(raw / 1024) + ' KB on disk');
  ok('  and always revalidated, since it carries the application',
    /no-cache|max-age=0/.test(shell.cache || ''), 'cache-control=' + shell.cache);

  const runtime = await fetchEncoded('/support.js');
  ok('the runtime is compressed too', !!runtime.enc && runtime.bytes < 30 * 1024,
    Math.round(runtime.bytes / 1024) + ' KB, encoding=' + runtime.enc);

  // ---- caching ------------------------------------------------------------
  const vendor = await fetchEncoded('/vendor/react-dom.production.min.js');
  ok('React is cacheable', /max-age=\d{4,}/.test(vendor.cache || ''), 'cache-control=' + vendor.cache);
  const font = await fetchEncoded('/_ds/kompas-warm-paper/fonts/literata-normal-latin.woff2');
  ok('the fonts are cached for a long time', /immutable/.test(font.cache || ''),
    'cache-control=' + font.cache);
  ok('  and are local, not fetched from Google by the browser',
    font.status === 200, 'status=' + font.status);

  // ---- the shell is downloaded once --------------------------------------
  // The x-dc runtime re-fetches the whole page after booting unless a resource
  // map is declared. That was a second 200 KB download on every cold load, and
  // it is invisible: the page works perfectly either way.
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const guard = html.indexOf('window.__resources');
  const support = html.indexOf('support.js');
  ok('the runtime is told not to download the page a second time', guard !== -1);
  ok('  before it has a chance to', guard !== -1 && guard < support,
    'guard at ' + guard + ', support.js at ' + support);

  // ---- the first question is one round trip away -------------------------
  const parentToken = await installAuth(BASE, { chatId: 816000055, phone: '+998901110055' });
  const r = await fetch(BASE + '/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-parent-token': parentToken },
    body: JSON.stringify({ consent: true, nickname: 'Yuk', grade: 2 }),
  });
  const d = await r.json();
  ok('a sitting starts', r.status === 201, 'status=' + r.status);
  ok('  and the questions come back with it', (d.inventory && d.inventory.questions || []).length >= 60,
    'n=' + ((d.inventory && d.inventory.questions || []).length));
  ok('  with the scale, so the choices can be drawn immediately',
    (d.inventory && d.inventory.scale || []).length === 5);
  ok('  and the progress, so the header is right on the first frame',
    !!(d.inventory && d.inventory.progress && d.inventory.progress.total >= 60),
    JSON.stringify(d.inventory && d.inventory.progress));

  // The same payload the separate endpoint returns — one shape, one source.
  const sep = await (await fetch(BASE + '/api/sessions/' + d.session_token + '/questions',
    { headers: { 'x-session-token': d.session_token } })).json();
  ok('  and it is the same payload the questions endpoint serves',
    JSON.stringify(sep.questions) === JSON.stringify(d.inventory.questions)
    && JSON.stringify(sep.scale) === JSON.stringify(d.inventory.scale),
    'one shape from one source, or the two quietly drift');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
