// The report as a FILE, not a screen.
//
// "PDF yuklab olish" is window.print(), so the thing a parent keeps, prints
// and shows a teacher is this page under print media. Nothing else tests it,
// and every way it breaks is silent: you only find out when someone prints.
//
// The failure that matters most: Chrome's print dialog ships with "Background
// graphics" OFF, and that overrides print-color-adjust. Anything whose
// contrast comes from a FILL — a terracotta card with light text on it — then
// prints as an empty rectangle. The letter to the child is such a card, it is
// the one part of the report meant to be read aloud, and a blank rectangle
// looks like a rendering bug rather than a missing letter. So the rule is:
// on paper, contrast comes from ink, never from a fill.
//
//   API_PAID=http://… node test/browser/report-print-test.js

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..', 'server', 'public');
const API = process.env.API_PAID || 'http://127.0.0.1:8091';
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || 'test-webhook-secret';
const PAYME_KEY = process.env.PAYME_MERCHANT_KEY || 'test-payme-key';
const PRICE_UZS = Number(process.env.REPORT_PRICE_UZS || 49000);
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  ok  - ' : '  FAIL- ') + n + (x ? '   ' + x : '')); };

const srv = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/') || req.url.startsWith('/hisobot')) {
    const body = await new Promise((r) => { let b = ''; req.on('data', (c) => b += c); req.on('end', () => r(b)); });
    const up = await fetch(API + req.url, {
      method: req.method, headers: { ...req.headers, host: undefined },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
    }).catch(() => null);
    if (!up) { res.statusCode = 502; return res.end('{}'); }
    const t = await up.text();
    res.statusCode = up.status;
    res.setHeader('content-type', up.headers.get('content-type') || 'application/json');
    return res.end(t);
  }
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (e, b) => {
    if (e) { res.statusCode = 404; return res.end(''); }
    res.setHeader('Content-Type', TYPES[path.extname(p)] || 'application/octet-stream');
    res.end(b);
  });
});

const PORT = 8114, BASE = 'http://127.0.0.1:' + PORT;
const jpost = async (p, body, headers = {}) => (await fetch(API + p, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body || {}),
})).json();

// A real finished report, paid for, so the sheet under test is the whole
// document rather than the free portrait.
async function paidReport() {
  const chatId = 879000000 + Math.floor(Math.random() * 900000);
  const start = await jpost('/api/auth/telegram/start', { marketing_consent: true });
  const from = { id: chatId, first_name: 'Chop', last_name: 'Sinov', username: 'c' + chatId };
  const hook = (message) => jpost('/api/telegram/webhook', { update_id: Math.random() * 1e9 | 0, message },
    { 'x-telegram-bot-api-secret-token': SECRET });
  await hook({ message_id: 1, chat: { id: chatId, type: 'private' }, from, text: '/start auth_' + start.nonce });
  await new Promise((r) => setTimeout(r, 400));
  await hook({ message_id: 2, chat: { id: chatId, type: 'private' }, from,
    contact: { phone_number: '+9989' + String(chatId).slice(-8), first_name: 'Chop', user_id: chatId } });
  await new Promise((r) => setTimeout(r, 400));
  const st = await (await fetch(API + '/api/auth/telegram/status?nonce=' + start.nonce)).json();
  const sess = await jpost('/api/sessions', { consent: true, nickname: 'Ali', grade: 2 },
    { 'x-parent-token': st.parent_token });
  const stok = sess.session_token;
  await jpost('/api/sessions/' + stok + '/messages', { content: 'Ali: kvadrat, 5 ta' }, { 'x-session-token': stok });
  const rep = await jpost('/api/sessions/' + stok + '/report', {}, { 'x-session-token': stok });

  const basic = 'Basic ' + Buffer.from('Paycom:' + PAYME_KEY).toString('base64');
  const rpc = (method, params) => jpost('/api/payments/payme',
    { jsonrpc: '2.0', id: Date.now() % 1e6, method, params }, { authorization: basic });
  const checkout = await jpost('/api/reports/' + rep.share_token + '/checkout', {});
  const txid = 'print' + Date.now();
  await rpc('CreateTransaction', { id: txid, time: Date.now(), amount: PRICE_UZS * 100,
    account: { order_id: checkout.order_id } });
  const perf = await rpc('PerformTransaction', { id: txid });
  if (!perf.result) throw new Error('could not pay for the report: ' + JSON.stringify(perf.error));
  return { share: rep.share_token, parentToken: st.parent_token };
}

(async () => {
  await new Promise((r) => srv.listen(PORT, r));
  const { share, parentToken } = await paidReport();

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
  await ctx.addInitScript((t) => { try { localStorage.setItem('yik_parent_v1', JSON.stringify({ tok: t })); } catch (e) {} }, parentToken);
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/CERT|401|404/.test(m.text())) errs.push(m.text()); });
  await page.goto(BASE + '/#/hisobot/' + share, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);

  const seen = await page.locator('body').innerText();
  ok('the report is unlocked for the test', /Tavsiya etilgan sport/i.test(seen) && !/to.lash/i.test(seen),
    seen.slice(0, 60).replace(/\n/g, ' '));

  // Everything below is read under print media, which is what the PDF is.
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(400);

  const vis = (sel) => page.locator(sel).first().isVisible().catch(() => false);
  const css = (sel, props) => page.evaluate(([s, ps]) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const c = getComputedStyle(el);
    return Object.fromEntries(ps.map((p) => [p, c[p]]));
  }, [sel, props]);
  const opaque = (c) => !!c && c !== 'transparent' && !/rgba\([^)]*,\s*0\s*\)$/.test(c);

  // ---- the chrome does not print ----------------------------------------
  ok('the nav does not print', !(await vis('nav.no-print')));
  ok('the print/share buttons do not print', !(await vis('button.btn-primary.no-print'))
    && !(await page.locator('.no-print:visible').count().then((n) => n > 0).catch(() => false)));
  ok('the page footer does not print', !(await vis('footer.no-print')));

  // ---- the letter survives "Background graphics: off" --------------------
  const letter = await css('.rep-letter', ['backgroundColor', 'color', 'borderTopWidth', 'borderTopColor']);
  ok('the letter card is present on paper', letter !== null, JSON.stringify(letter));
  ok('  its contrast does NOT come from a fill', !opaque(letter.backgroundColor), letter.backgroundColor);
  ok('  the quote is ink, not light-on-nothing', letter.color === 'rgb(30, 36, 34)', letter.color);
  ok('  and it is still framed as its own object',
    opaque(letter.borderTopColor) && parseFloat(letter.borderTopWidth) >= 1,
    letter.borderTopWidth + ' ' + letter.borderTopColor);
  ok('  the frame is the letter\'s own colour, not another accent',
    letter.borderTopColor === 'rgb(168, 86, 48)', letter.borderTopColor);
  // The headline inside the card must not be light either.
  const kicker = await css('.rep-letter h6', ['color']);
  ok('  its kicker is legible too', kicker && kicker.color === 'rgb(168, 86, 48)', JSON.stringify(kicker));

  // ---- the same rule for the milestone chips ----------------------------
  const msn = await css('.rep-msn', ['backgroundColor', 'color', 'borderTopWidth']);
  if (msn) {
    ok('the milestone numbers do not depend on a fill either', !opaque(msn.backgroundColor), msn.backgroundColor);
    ok('  they are ink inside a rule', msn.color === 'rgb(30, 36, 34)' && parseFloat(msn.borderTopWidth) >= 1,
      JSON.stringify(msn));
  } else {
    ok('the milestone numbers do not depend on a fill either', true, '(no roadmap in this report)');
    ok('  they are ink inside a rule', true, '(no roadmap in this report)');
  }

  // ---- pagination: a report cut mid-letter is not a document -------------
  const breaks = await page.evaluate(() => {
    const g = (s) => { const el = document.querySelector(s); return el ? getComputedStyle(el).breakInside : null; };
    return { letter: g('.rep-letter'), item: g('.rep-item') };
  });
  ok('the letter is never split across pages', breaks.letter === 'avoid', JSON.stringify(breaks));
  ok('  nor is a single finding', breaks.item === 'avoid' || breaks.item === null, JSON.stringify(breaks));

  ok('no console errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));

  // ---- and it really does produce a PDF ----------------------------------
  const pdf = await page.pdf({ format: 'A4', printBackground: false });
  ok('printing without background graphics still yields a real PDF',
    pdf.length > 5000 && pdf.slice(0, 5).toString() === '%PDF-', 'bytes=' + pdf.length);

  await ctx.close();
  await browser.close();
  srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
