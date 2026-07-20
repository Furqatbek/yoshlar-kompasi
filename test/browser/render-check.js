// Static render smoke test: serves the built public/ under the prod CSP and
// mounts the app in Chromium. Because renderVals() computes ALL bindings on
// every render (including the new lowEngage / dismissLowEngage ones), a runtime
// throw there would surface here even on the landing route.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..', 'server', 'public');
const CSP = ["default-src 'self'", "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data:", "connect-src 'self'"].join('; ');
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, buf) => {
    res.setHeader('Content-Security-Policy', CSP);
    if (err) { res.statusCode = 200; return res.end(''); }
    res.setHeader('Content-Type', TYPES[path.extname(p)] || 'application/octet-stream');
    res.end(buf);
  });
});

(async () => {
  await new Promise((r) => srv.listen(8099, r));
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process'] });
  const p = await b.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e)));
  await p.goto('http://127.0.0.1:8099/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await p.waitForTimeout(2000);
  // The landing hero button proves the template parsed and the logic class evaluated.
  const bodyText = await p.locator('body').innerText();
  const mounted = /Tayyorgarlik|Kompas|hisobot/i.test(bodyText);
  // Filter benign font/network noise; keep real JS/CSP errors.
  const real = errors.filter((e) => !/font|favicon|net::ERR|Failed to load resource/i.test(e));
  console.log('MOUNTED:', mounted);
  console.log('REAL_ERRORS:', real.length, JSON.stringify(real.slice(0, 5)));
  await b.close(); srv.close();
  process.exit(mounted && real.length === 0 ? 0 : 1);
})().catch((e) => { console.log('RENDER_ERR', String(e).slice(0, 300)); process.exit(3); });
