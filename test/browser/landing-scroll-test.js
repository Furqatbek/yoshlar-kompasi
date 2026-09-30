// The landing's scroll device: a sample report sheet that writes itself as
// the reader descends.
//
// The claims test proves the page says true things. This proves the thing
// that makes the page worth scrolling actually works — and, just as
// importantly, that it gets out of the way when it should: reduced motion, a
// low-end device, or a route that is not the landing.
//
//   API_PAID=http://… node test/browser/landing-scroll-test.js

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..', 'server', 'public');
const API = process.env.API_PAID || 'http://127.0.0.1:8091';
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  ok  - ' : '  FAIL- ') + n + (x ? '   ' + x : '')); };

const srv = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    const up = await fetch(API + req.url, { headers: { ...req.headers, host: undefined } }).catch(() => null);
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

const BASE = 'http://127.0.0.1:8112';
// "N / 10 qator" on the desktop sheet, "N/10" on the mobile strip.
const filled = async (page) => {
  const t = await page.locator('body').innerText();
  const m = /(\d+)\s*\/\s*10(?:\s*qator)?/.exec(t);
  return m ? Number(m[1]) : null;
};
const scrollTo = async (page, frac) => {
  await page.evaluate((f) => window.scrollTo(0, document.body.scrollHeight * f), frac);
  await page.waitForTimeout(450);
};

(async () => {
  await new Promise((r) => srv.listen(8112, r));
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const open = async (opts, url = '/#/') => {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error' && !/CERT|401|404/.test(m.text())) errs.push(m.text()); });
    await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200);
    return { ctx, page, errs };
  };

  // ---- mobile: the sheet fills as you go -------------------------------
  const m = await open({ viewport: { width: 390, height: 844 } });
  ok('the sheet starts empty', (await filled(m.page)) === 0, 'filled=' + await filled(m.page));
  ok('  and says so', /Varaq bo.sh/.test(await m.page.locator('body').innerText()));
  ok('  the strip is hidden at the top', await m.page.locator('text=Ali · hisobot').isVisible().catch(() => false) === false
     || (await m.page.locator('[style*="translateY(110%)"]').count()) > 0);

  await scrollTo(m.page, 0.25);
  const mid = await filled(m.page);
  ok('scrolling fills rows', mid > 0, 'filled=' + mid);

  await scrollTo(m.page, 0.55);
  const later = await filled(m.page);
  ok('  and keeps filling', later > mid, mid + ' -> ' + later);

  // Forward-only: scrolling back must not empty the sheet, or the reader
  // would watch their own progress being undone.
  await scrollTo(m.page, 0.05);
  ok('scrolling back up does NOT empty it', (await filled(m.page)) === later, 'filled=' + await filled(m.page));

  await scrollTo(m.page, 0.95);
  ok('the sheet completes by the end', (await filled(m.page)) === 10, 'filled=' + await filled(m.page));

  // ---- the mobile strip and its drawer ---------------------------------
  await scrollTo(m.page, 0.3);
  const strip = m.page.locator('button:has-text("Ali · hisobot")');
  ok('the strip appears once the hero sheet is gone', await strip.count() === 1);
  await strip.click({ force: true });
  await m.page.waitForTimeout(400);
  ok('  tapping it opens the full sheet', await m.page.locator('button:has-text("Yopish")').count() === 1);
  await m.page.locator('button:has-text("Yopish")').click();
  await m.page.waitForTimeout(300);
  ok('  and it closes again', await m.page.locator('button:has-text("Yopish")').count() === 0);
  ok('no console errors on mobile', m.errs.length === 0, JSON.stringify(m.errs.slice(0, 3)));

  // ---- desktop: the sticky sheet ---------------------------------------
  const d = await open({ viewport: { width: 1440, height: 900 } });
  ok('desktop shows the sticky sheet', await d.page.locator('text=/\\d+ \\/ 10 qator/').count() > 0);
  ok('  and not the mobile strip', await d.page.locator('button:has-text("Ali · hisobot")').count() === 0);
  await scrollTo(d.page, 0.4);
  ok('  which fills on scroll', (await filled(d.page)) > 0, 'filled=' + await filled(d.page));
  ok('no console errors on desktop', d.errs.length === 0, JSON.stringify(d.errs.slice(0, 3)));

  // ---- reduced motion: complete, static, no strip -----------------------
  // The spec's fallback is a "plain static stack": sheet complete, letter lit,
  // no bottom strip. With no strip and no desktop aside there is no count
  // label on a narrow screen, so completeness is read off the cells — all ten
  // filled with the accent rather than empty.
  const r = await open({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const cellsFilled = (page) => page.evaluate(() => {
    const cells = [...document.querySelectorAll('[data-teaser] span')]
      .filter((el) => getComputedStyle(el).borderTopWidth === '2px');
    const accent = cells.filter((el) => getComputedStyle(el).backgroundColor === 'rgb(236, 48, 19)');
    return { total: cells.length, accent: accent.length };
  });
  const rc = await cellsFilled(r.page);
  ok('reduced motion shows the sheet already complete', rc.total === 10 && rc.accent === 10, JSON.stringify(rc));
  await scrollTo(r.page, 0.4);
  ok('  and never shows the strip', await r.page.locator('button:has-text("Ali · hisobot")').count() === 0);
  ok('  the letter is fully legible, not faded', await r.page.evaluate(() => {
    const s = document.querySelector('[data-letter] span[style*="opacity"]');
    return s ? parseFloat(getComputedStyle(s).opacity) === 1 : false;
  }));
  ok('no console errors under reduced motion', r.errs.length === 0, JSON.stringify(r.errs.slice(0, 3)));

  // ---- the device must not run off the landing --------------------------
  const other = await open({ viewport: { width: 390, height: 844 } }, '/#/maxfiylik');
  ok('the scroll device does not run on other routes',
    await other.page.locator('button:has-text("Ali · hisobot")').count() === 0);
  ok('  and that route still renders', /Maxfiylik/i.test(await other.page.locator('body').innerText()));

  for (const v of [m, d, r, other]) await v.ctx.close();
  await browser.close();
  srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
