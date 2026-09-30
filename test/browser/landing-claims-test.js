// The landing page must not promise something the server does not deliver.
//
// This drives the real page against BOTH configurations and checks the claims
// that went stale as the product changed: "bepul" when the report is sold,
// "faqat ism so'raladi" and "ro'yxatdan o'tish yo'q" after the Telegram login
// went in, "uch qadam" when there are four, and a sample report that showed
// three directions long after the prompt started assessing six things.
//
//   API_PAID=http://…  API_FREE=http://…  node test/browser/landing-claims-test.js
//
// Matching is case-insensitive: these headings render uppercase via CSS and
// innerText returns the transformed text.
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
    const text = await page.locator('body').innerText();
    return { srv, page, text };
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
    ok(`[${label}] shows emotional intelligence`, /Emotsional intellekt/i.test(v.text));
    ok(`[${label}] mentions clubs, not just sport`, /to.garak/i.test(v.text));
  }

  // ---- paid: nothing may be called free except the session ----------------
  ok('[paid] no bare "hisobot ... bepul" promise',
    !/hisobot olasiz — bepul/i.test(paid.text));
  ok('[paid] the session is still correctly called free',
    /Mashg.ulot bepul/i.test(paid.text));
  ok('[paid] the price is stated up front', /49 000 so/.test(paid.text), null);
  ok('[paid] what is free vs paid is explained before the sample',
    /birinchi qismi — bepul/i.test(paid.text));
  ok('[paid] the FAQ answers the price, not "is it really free"',
    /Qancha turadi/i.test(paid.text) && !/Bu chindan bepulmi/i.test(paid.text));

  // ---- free: the old copy is still correct and still shown ----------------
  ok('[free] still promises a free report', /hisobot olasiz — bepul/i.test(free.text));
  ok('[free] does not quote a price', !/49 000 so/.test(free.text));
  ok('[free] keeps the "is it really free" answer', /Bu chindan bepulmi/i.test(free.text));

  // ---- the login step must be visible before someone commits -------------
  ok('[paid/auth] the Telegram step is named in the flow',
    /Telegram orqali kirasiz/i.test(paid.text));
  ok('[paid/auth] the flow says four steps', /To.rt qadam/i.test(paid.text));
  ok('[paid/auth] does not claim there is no registration',
    !/Ro.yxatdan o.tish yo.q/i.test(paid.text));

  ok('[free/no-auth] the flow says three steps', /Uch qadam/i.test(free.text));
  ok('[free/no-auth] no Telegram step is advertised',
    !/Telegram orqali kirasiz/i.test(free.text));
  ok('[free/no-auth] "no registration" is accurate again',
    /Ro.yxatdan o.tish yo.q/i.test(free.text));

  for (const v of [paid, free]) { await v.page.context().close(); v.srv.close(); }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
