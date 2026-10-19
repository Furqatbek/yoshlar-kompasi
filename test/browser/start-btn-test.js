// Verifies the start-button loading feedback: serve the built public/ under the
// prod CSP, intercept POST /api/sessions with a delayed response, walk the real
// form (name -> grade -> consent -> Davom etish -> Mashg'ulotni boshlash), and
// assert the button disables + shows "Tayyorlanmoqda…" + hint while pending,
// and that a rapid double-click fires only ONE request.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { stubLogin } = require('./auth-stub');

const ROOT = path.join(__dirname, '..', '..', 'server', 'public');
const CSP =["default-src 'self'", "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data:", "connect-src 'self'"].join('; ');
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, buf) => {
    res.setHeader('Content-Security-Policy', CSP);
    if (err) { res.statusCode = 200; return res.end(''); }
    res.setHeader('Content-Type', TYPES[path.extname(p)] || 'application/octet-stream');
    res.end(buf);
  });
});

let pass = 0, fail = 0;
function ok(name, cond, extra) { (cond ? pass++ : fail++); console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); }

(async () => {
  await new Promise((r) => srv.listen(8099, r));
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process'] });
  const page = await b.newPage();
  await stubLogin(page); // the form only renders for an authorized adult

  let apiCalls = 0;
  page.on('console', (m) => { const t = m.text(); if (t.startsWith('[trace]')) console.log('  ' + t.replace(/\n/g, '\n    ')); });
  await page.addInitScript(() => {
    const orig = window.fetch;
    let n = 0;
    window.fetch = function (...args) {
      const url = String(args[0]);
      if (url.includes('/api/sessions')) {
        n++;
        console.log('[trace] fetch#' + n + ' ' + url + ' t=' + Math.round(performance.now()) + 'ms\n' + new Error().stack.split('\n').slice(1, 6).join('\n'));
      }
      return orig.apply(this, args);
    };
  });
  page.on('request', (r) => { if (r.url().includes('/api/')) console.log('  [net]', r.method(), new URL(r.url()).pathname); });
  await page.route('**/api/sessions', async (route) => {
    apiCalls++;
    console.log('  [route hit]', route.request().method(), 'call#' + apiCalls);
    // Creating a session is a database insert now, but it is still a network
    // call that can be slow or refused, so the pending state and the
    // double-click latch still have to hold.
    await new Promise((r) => setTimeout(r, 2000));
    route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'stub: upstream slow/down' }) });
  });

  await page.goto('http://127.0.0.1:8099/#/boshlash', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1500);

  await page.fill('#yik-name', 'Ali');
  await page.click('button:has-text("2-sinf")');
  // consent checkbox (the only checkbox on this screen)
  await page.locator('input[type="checkbox"]').first().check();
  await page.click('button:has-text("Davom etish")');
  await page.waitForTimeout(300);

  const startBtn = page.locator('button:has-text("Mashg\'ulotni boshlash")');
  ok('step-2 start button appears', await startBtn.count() === 1);

  // TRUE double-click: two DOM clicks in the same tick, before any re-render
  // can disable the button — the exact race the handler guard must absorb.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes("Mashg'ulotni boshlash"));
    b.click(); b.click();
  });
  await page.waitForTimeout(400);

  const pendingBtn = page.locator('button:has-text("Tayyorlanmoqda")');
  ok('button label flips to Tayyorlanmoqda…', await pendingBtn.count() === 1);
  ok('button is disabled while pending', await pendingBtn.first().isDisabled());
  const hint = page.locator('text=Mashg\'ulot ochilmoqda');
  ok('waiting hint is shown', await hint.count() >= 1);
  ok('same-tick double-click fired only ONE api call', apiCalls === 1, 'calls=' + apiCalls);

  await page.waitForTimeout(2200); // let the delayed 502 land
  ok('still one api call after settle', apiCalls === 1, 'calls=' + apiCalls);
  const backBtn = page.locator('button:has-text("Mashg\'ulotni boshlash")');
  ok('button restored after failure (retry possible)', await backBtn.count() === 1);
  const errText = await page.locator('body').innerText();
  ok('error surfaced to user', /stub: upstream slow\/down|Xatolik|xatosi/i.test(errText));

  // ...and surfaced WHERE THEY PRESSED. The message used to render only in
  // step 1, roughly a screen above this button, so a refused start — the daily
  // session limit, most often — looked like a button that did nothing at all.
  const err = page.locator('text=stub: upstream slow/down').first();
  ok('the error is on screen, not above it', await err.isVisible());
  // The deepest elements holding the text — the runtime may wrap an
  // interpolated value in a span, so "leaf" is found rather than assumed.
  const shown = await page.evaluate(() => {
    const hit = [...document.querySelectorAll('body *')]
      .filter((e) => /upstream slow/.test(e.textContent || ''))
      .filter((e) => ![...e.children].some((c) => /upstream slow/.test(c.textContent || '')));
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes("Mashg'ulotni boshlash"));
    const b = btn && btn.getBoundingClientRect();
    return {
      count: hit.length,
      gap: b ? Math.min(...hit.map((m) => Math.abs(m.getBoundingClientRect().top - b.bottom))) : null,
    };
  });
  ok('  within sight of the button', shown.gap != null && shown.gap < 120, 'gap=' + shown.gap + 'px');
  ok('  and shown once, not twice', shown.count === 1, 'copies=' + shown.count);

  await b.close(); srv.close();
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('DRIVER ERR', String(e).slice(0, 300)); process.exit(2); });
