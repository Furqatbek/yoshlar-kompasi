// The landing page must not promise something the server does not deliver.
//
// This drives the real page against BOTH configurations and checks the claims
// that went stale as the product changed: "bepul" when the report is sold,
// "faqat ism so'raladi" and "ro'yxatdan o'tish yo'q" after the Telegram login
// went in, an undisclosed Telegram detour, and a sample report that showed
// three directions long after the prompt started assessing six things.
//
//   API_PAID=http://…  API_FREE=http://…  node test/browser/landing-claims-test.js
//
// Matching is case-insensitive: these headings render uppercase via CSS and
// innerText returns the transformed text.
//
// Each assertion pins a *claim*, not a sentence, because the copy gets rewritten
// and the claim must survive the rewrite. Where a claim can be carried by more
// than one wording, both are accepted — the failure that matters is the claim
// disappearing, not the words changing. (The warm-paper redesign reworded all
// of these; the only edit needed here was re-pointing the matchers.)
//
// Marketing copy is exactly the kind of thing nobody re-reads after shipping a
// feature, which is why it is worth a test rather than a note.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..', 'server', 'public');
const PAID = process.env.API_PAID || 'http://127.0.0.1:8091';
const FREE = process.env.API_FREE || 'http://127.0.0.1:8092';
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  ok  - ' : '  FAIL- ') + n + (x ? '   ' + x : '')); };

function serve(api, port) {
  const srv = http.createServer(async (req, res) => {
    if (req.url.startsWith('/api/')) {
      const up = await fetch(api + req.url, { headers: { ...req.headers, host: undefined } }).catch(() => null);
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
  return new Promise((r) => srv.listen(port, () => r(srv)));
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const load = async (api, port) => {
    const srv = await serve(api, port);
    const page = await (await browser.newContext({ viewport: { width: 1100, height: 1000 } })).newPage();
    await page.goto('http://127.0.0.1:' + port + '/#/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200); // config fetch + render
    // The FAQ is a <details> stack; its answers are only in innerText when open.
    for (const d of await page.locator('details').all()) await d.evaluate((e) => { e.open = true; });
    await page.waitForTimeout(200);
    const text = await page.locator('body').innerText();
    // `before` lets an assertion check document ORDER, not just presence —
    // "explained before the sample" is a claim about the reading sequence.
    const before = (a, b) => {
      const i = text.search(a), j = text.search(b);
      return i !== -1 && j !== -1 && i < j;
    };
    return { srv, page, text, before };
  };

  // ---- claims that must be true in EVERY configuration --------------------
  const paid = await load(PAID, 8110);
  const free = await load(FREE, 8111);

  for (const [label, v] of [['paid', paid], ['free', free]]) {
    // The child's data minimization is real and worth saying; "only a name is
    // asked" stopped being true of the ADULT once the login arrived.
    ok(`[${label}] does not claim only a name is asked`,
      !/Faqat ism so.raladi/i.test(v.text));
    // The prompt assesses these; the page used to mention none of them.
    ok(`[${label}] shows the talents map`, /Iqtidorlar xaritasi/i.test(v.text));
    ok(`[${label}] shows the learning style`, /O.rganish usuli/i.test(v.text));
    // Named plainly ("his-tuyg'ular") rather than as jargon; either carries it.
    ok(`[${label}] shows emotional intelligence`,
      /(His-tuyg.ular|Emotsional intellekt)/i.test(v.text));
    ok(`[${label}] mentions clubs, not just sport`, /to.garak/i.test(v.text));
  }

  // The money question, read from its own FAQ row rather than the whole page,
  // so "the answer quotes the price" cannot be satisfied by a price elsewhere.
  const money = async (v) =>
    (await v.page.locator('details:has-text("Qancha turadi")').first().innerText()
      .catch(() => '')) || '';
  const paidMoney = await money(paid);
  const freeMoney = await money(free);

  // ---- paid: nothing may be called free except the session ----------------
  // The negative is the free build's own sentence: the strongest guard against
  // a paid page promising a free report is the exact phrase that build uses.
  ok('[paid] no bare "the report is free" promise',
    !/Hisobot to.liq bepul/i.test(paid.text) && !/hisobot olasiz — bepul/i.test(paid.text));
  ok('[paid] the session is still correctly called free',
    /Mashg.ulot bepul/i.test(paid.text));
  ok('[paid] the price is stated up front', /49 000 so/.test(paid.text), null);
  ok('[paid] what is free vs paid is explained before the sample',
    /01 va 10/.test(paid.text) && /Qolgan sakkiz qism/i.test(paid.text)
    && paid.before(/01 va 10/, /Hisobot namunasi/i));
  ok('[paid] every sample row is marked free or paid',
    /bepul/i.test(paid.text) && /to.lovdan keyin/i.test(paid.text));
  ok('[paid] the FAQ answers the price question with the price',
    /Qancha turadi/i.test(paidMoney) && /49 000 so/.test(paidMoney) && /Payme/i.test(paidMoney),
    JSON.stringify(paidMoney.slice(0, 90)));

  // ---- free: the free promise is still correct and still shown ------------
  ok('[free] still promises a free report', /Hisobot to.liq bepul/i.test(free.text));
  ok('[free] does not quote a price', !/49 000 so/.test(free.text));
  ok('[free] the FAQ answers the price question with "nothing"',
    /Qancha turadi/i.test(freeMoney) && /Hech narsa/i.test(freeMoney) && !/49 000/.test(freeMoney),
    JSON.stringify(freeMoney.slice(0, 90)));
  ok('[free] no sample row is marked paid',
    !/to.lovdan keyin/i.test(free.text));

  // ---- the login step must be visible before someone commits -------------
  // Disclosure and frictionlessness are mutually exclusive, so each build is
  // checked for the other's claim as well: the detour is walked through when it
  // exists, and entirely absent — not merely unmentioned — when it does not.
  ok('[paid/auth] the Telegram step is named up front',
    /Telegramda bitta «Start»/i.test(paid.text));
  ok('[paid/auth] the detour is walked through before the parent commits',
    /Boshlashdan oldin bilib qo.ying/i.test(paid.text)
    && /Shu sahifa/i.test(paid.text) && /Telegram boti/i.test(paid.text)
    && /Yana shu yerda/i.test(paid.text));
  ok('[paid/auth] and says the page waits rather than losing their place',
    /Sahifa sizni kutib turadi/i.test(paid.text));
  ok('[paid/auth] does not claim there is no registration',
    !/Ro.yxatdan o.tish yo.q/i.test(paid.text));

  ok('[free/no-auth] no Telegram step is advertised',
    !/Telegram/i.test(free.text));
  ok('[free/no-auth] no login walkthrough is shown',
    !/Boshlashdan oldin bilib qo.ying/i.test(free.text));
  ok('[free/no-auth] "no registration" is accurate again',
    /Ro.yxatdan o.tish yo.q/i.test(free.text));

  for (const v of [paid, free]) { await v.page.context().close(); v.srv.close(); }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
