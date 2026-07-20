// Adult-consent enforcement in the real UI:
//  1. Unchecked box -> "Davom etish" blocked with an error, step 2 stays locked.
//  2. Check -> unlock step 2 -> UNCHECK -> step 2 re-locks (the old bypass:
//     consent was validated once, then startSession trusted it forever).
//  3. Re-check -> start -> the API request actually carries consent: true.
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..', '..', 'server', 'public');
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, buf) => {
    if (err) { res.statusCode = 200; return res.end(''); }
    res.setHeader('Content-Type', TYPES[path.extname(p)] || 'application/octet-stream'); res.end(buf);
  });
});
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); };

(async () => {
  await new Promise((r) => srv.listen(8099, r));
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process'] });
  const page = await b.newPage();
  let lastBody = null;
  await page.route('**/api/sessions', (r) => {
    lastBody = JSON.parse(r.request().postData() || '{}');
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ session_id: 's', session_token: 'tok_ct', child: {}, status: 'active', messages: [{ role: 'assistant', content: 'salom', meta: false }], progress: {}, done: false }) });
  });
  await page.goto('http://127.0.0.1:8099/#/boshlash', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1800);

  await page.fill('#yik-name', 'Ali');
  await page.click('button:has-text("2-sinf")');
  const cb = page.locator('input[type="checkbox"]').first();
  const startBtn = () => page.locator('button:has-text("Mashg\'ulotni boshlash")');

  // 1. Unchecked -> blocked.
  await page.click('button:has-text("Davom etish")');
  await page.waitForTimeout(300);
  ok('unchecked: error shown', await page.locator('text=rozilik belgisini').count() > 0);
  ok('unchecked: step 2 locked', await startBtn().count() === 0);

  // 2. Check -> unlock -> uncheck -> re-locked.
  await cb.check();
  await page.click('button:has-text("Davom etish")');
  await page.waitForTimeout(300);
  ok('checked: step 2 unlocked', await startBtn().count() === 1);
  await cb.uncheck();
  await page.waitForTimeout(300);
  ok('unchecked again: step 2 RE-LOCKED', await startBtn().count() === 0);
  ok('no API call happened yet', lastBody === null);

  // 3. Re-check -> start -> request carries consent: true.
  await cb.check();
  await page.click('button:has-text("Davom etish")');
  await page.waitForTimeout(300);
  await startBtn().click();
  await page.waitForTimeout(700);
  ok('start request sent consent: true', !!lastBody && lastBody.consent === true, JSON.stringify(lastBody));

  await b.close(); srv.close();
  console.log('\n==== consent: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('DRIVER ERR', String(e).slice(0, 300)); process.exit(2); });
