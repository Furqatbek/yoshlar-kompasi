// Telegram authorization gate in the real UI:
//  1. /#/boshlash shows the login card, NOT the child form.
//  2. Pressing "Telegram orqali kirish" issues a nonce and shows the waiting state.
//  3. Simulating the bot (/start + Share contact) flips the page to the form
//     without a reload, purely from polling.
//  4. The login survives a reload (localStorage token + /api/auth/me).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..', 'server', 'public');
const API = process.env.BASE_URL || 'http://127.0.0.1:8091';
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || 'test-webhook-secret';
const CHAT_ID = 822000777;

const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
// Serve the built app, proxying /api and /admin to the real server.
const srv = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/') || req.url.startsWith('/admin')) {
    const body = await new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
    const up = await fetch(API + req.url, {
      method: req.method,
      headers: { ...req.headers, host: undefined },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
    }).catch(() => null);
    if (!up) { res.statusCode = 502; return res.end('{}'); }
    const text = await up.text();
    res.statusCode = up.status;
    res.setHeader('content-type', up.headers.get('content-type') || 'application/json');
    return res.end(text);
  }
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, buf) => {
    if (err) { res.statusCode = 404; return res.end(''); }
    res.setHeader('Content-Type', TYPES[path.extname(p)] || 'application/octet-stream');
    res.end(buf);
  });
});

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '   ' + x : '')); };

const from = { id: CHAT_ID, first_name: 'Aziza', last_name: 'Yusupova', username: 'aziza' };
const webhook = (message) =>
  fetch(API + '/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
    body: JSON.stringify({ update_id: Math.floor(Math.random() * 1e9), message }),
  });

(async () => {
  await new Promise((r) => srv.listen(8100, r));
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const page = await (await b.newContext({ viewport: { width: 1000, height: 900 } })).newPage();

  await page.goto('http://127.0.0.1:8100/#/boshlash', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  ok('setup shows the login card', await page.locator('text=Telegram orqali kiring').count() > 0);
  ok('  the child form is hidden until login', await page.locator('#yik-name').count() === 0);
  ok('  marketing consent is offered, unticked', await page.locator('input[type=checkbox]').first().isChecked() === false);

  // Opt in, then start the handshake.
  await page.locator('input[type=checkbox]').first().check();
  await page.click('button:has-text("Telegram orqali kirish")');
  await page.waitForTimeout(1200);
  ok('waiting state appears', await page.locator('text=Telegramni ochish').count() > 0);
  ok('  it tells the adult to press Start', await page.locator('text=«Start» tugmasini bosing').count() > 0);

  const link = await page.locator('a:has-text("Telegramni ochish")').getAttribute('href');
  ok('  the deep link is an auth link', /t\.me\/.+\?start=auth_/.test(link || ''), link);
  const nonce = decodeURIComponent((link.split('start=auth_')[1] || ''));

  // The adult presses Start in Telegram.
  await webhook({ message_id: 1, chat: { id: CHAT_ID, type: 'private' }, from, text: '/start auth_' + nonce });
  await page.waitForTimeout(3000);
  ok('page switches to asking for the phone', await page.locator('text=Telefon raqamni ulashish').count() > 0);

  // The adult shares the contact.
  await webhook({
    message_id: 2, chat: { id: CHAT_ID, type: 'private' }, from,
    contact: { phone_number: '+998935554433', first_name: 'Aziza', user_id: CHAT_ID },
  });
  await page.waitForTimeout(3500);

  ok('the form unlocks without a reload', await page.locator('#yik-name').count() > 0);
  ok('  the login card is gone', await page.locator('text=Telegram orqali kiring').count() === 0);

  // The login must survive a reload.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  ok('login persists across reload', await page.locator('#yik-name').count() > 0);
  ok('  no login card flash after reload', await page.locator('text=Telegram orqali kiring').count() === 0);

  // And an authorized adult can actually start an assessment.
  await page.fill('#yik-name', 'Ali');
  await page.click('button:has-text("2-sinf")');
  await page.locator('input[type=checkbox]').last().check();
  await page.click('button:has-text("Davom etish")');
  await page.waitForTimeout(600);
  const startBtn = page.locator('button:has-text("Mashg\'ulotni boshlash")');
  ok('step 2 unlocks for an authorized adult', await startBtn.count() === 1);

  await b.close();
  srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
