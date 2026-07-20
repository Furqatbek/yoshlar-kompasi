// Verifies "quit test without answering": start a session (stubbed API), press
// Yakunlash with 0 answers -> lowEngage dialog offers "Hisobotsiz chiqish" ->
// clicking it lands on the landing page with the resume banner (session kept),
// and "Davom etish" resumes the same session.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..', 'server', 'public');
const CSP = ["default-src 'self'", "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
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

const TOKEN = 'testtok_ABCDEF123456';
const GREETING = { role: 'assistant', content: 'Salom! Ali uchun birinchi savol:\n\n> Qizil, ko\'k, qizil, ... keyin nima?', meta: false };
const SESSION_PAYLOAD = {
  child: { nickname: 'Ali', grade: 2, age: 7, goal: '', notes: '' },
  messages: [{ role: 'user', content: 'intro', meta: true }, GREETING],
  status: 'active',
  progress: { mantiq: false, psixologiya: false, harakat: false },
  done: false, turn_count: 1, report: null,
};

(async () => {
  await new Promise((r) => srv.listen(8099, r));
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process'] });
  const page = await b.newPage();

  await page.route('**/api/sessions', (route) => route.fulfill({
    status: 201, contentType: 'application/json',
    body: JSON.stringify({ session_id: 'sid1', session_token: TOKEN, child: SESSION_PAYLOAD.child, status: 'active', messages: SESSION_PAYLOAD.messages, progress: SESSION_PAYLOAD.progress, done: false }),
  }));
  await page.route('**/api/sessions/' + TOKEN, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(SESSION_PAYLOAD),
  }));

  await page.goto('http://127.0.0.1:8099/#/boshlash', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1500);

  // Start a session.
  await page.fill('#yik-name', 'Ali');
  await page.click('button:has-text("2-sinf")');
  await page.locator('input[type="checkbox"]').first().check();
  await page.click('button:has-text("Davom etish")');
  await page.waitForTimeout(300);
  await page.click('button:has-text("Mashg\'ulotni boshlash")');
  await page.waitForTimeout(800);
  ok('session screen shows greeting', (await page.locator('body').innerText()).includes('birinchi savol'));

  // Try to finish with zero answers -> lowEngage dialog with an exit option.
  await page.click('button:has-text("Yakunlash")');
  await page.waitForTimeout(300);
  ok('lowEngage dialog appears', await page.locator('text=Hali javoblar yo\'q').count() === 1);
  const exitBtn = page.locator('button:has-text("Hisobotsiz chiqish")');
  ok('exit-without-report button offered', await exitBtn.count() >= 1);

  // Quit.
  await exitBtn.first().click();
  await page.waitForTimeout(500);
  ok('navigated to landing', await page.evaluate(() => location.hash) === '#/');
  ok('resume banner shows child name', await page.locator('text=Ali bilan mashg\'ulot yakunlanmagan').count() === 1);
  const saved = await page.evaluate(() => localStorage.getItem('yik_sess_v1'));
  ok('session handle kept (resumable)', !!saved && saved.includes(TOKEN), String(saved));

  // Resume from the banner -> back in the session.
  await page.click('button:has-text("Davom etish")');
  await page.waitForTimeout(700);
  ok('back in session route', (await page.evaluate(() => location.hash)).includes('/mashgulot/' + TOKEN));
  ok('greeting visible again', (await page.locator('body').innerText()).includes('birinchi savol'));

  await b.close(); srv.close();
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('DRIVER ERR', String(e).slice(0, 300)); process.exit(2); });
