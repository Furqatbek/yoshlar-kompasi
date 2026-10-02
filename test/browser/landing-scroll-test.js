// The landing's scroll device: a sample report sheet that writes itself as
// the reader descends.
//
// The claims test proves the page says true things. This proves the thing
// that makes the page worth scrolling actually works — and, just as
// importantly, that it gets out of the way when it should: reduced motion, a
// low-end device, or a route that is not the landing.
//
// The mobile half of the device is a bottom bar, not a drawer: the design spec
// asks for "a persistent bottom bar on phones with the CTA and the progress of
// the report sheet", which "must never cover text, and must disappear for
// reduced-motion and low-end devices — where the plain CTA bar remains
// instead". Each assertion below is one clause of that.
//
//   API_PAID=http://… node test/browser/landing-scroll-test.js

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..', 'server', 'public');
const API = process.env.API_PAID || 'http://127.0.0.1:8091';
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const GROWTH = 'rgb(31, 111, 92)'; // --color-accent

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
// "N / 10" on the sheet header, "N/10" on the mobile bar.
const filled = async (page) => {
  const t = await page.locator('body').innerText();
  const m = /(\d+)\s*\/\s*10/.exec(t);
  return m ? Number(m[1]) : null;
};
const scrollTo = async (page, frac) => {
  await page.evaluate((f) => window.scrollTo(0, document.body.scrollHeight * f), frac);
  await page.waitForTimeout(450);
};

// Every fixed bar sitting on the bottom edge, whether or not it is parked
// offscreen. Counting them is how a superseded bar from an older design gets
// caught: two CTAs stacked on a phone is not a thing anyone would notice in a
// screenshot taken at the top of the page.
const bottomBars = (page) => page.evaluate(() => [...document.querySelectorAll('div')]
  .filter((d) => {
    const s = getComputedStyle(d);
    return s.position === 'fixed' && s.bottom === '0px' && d.getBoundingClientRect().height > 20;
  })
  .map((d) => {
    const r = d.getBoundingClientRect();
    return { onscreen: r.top < window.innerHeight - 4, text: d.innerText.replace(/\s+/g, ' ').trim() };
  }));

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
  ok('  and says so', /Hozircha bo.sh/.test(await m.page.locator('body').innerText()));
  ok('  the bar is parked offscreen at the top',
    (await bottomBars(m.page)).every((b) => !b.onscreen));

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

  // ---- the mobile bar: progress + CTA, and only one of it --------------
  await scrollTo(m.page, 0.95);
  const mBars = await bottomBars(m.page);
  ok('the bar has arrived once the sheet is behind us',
    mBars.filter((b) => b.onscreen).length === 1, JSON.stringify(mBars.map((b) => b.onscreen)));
  ok('  exactly one bottom bar exists', mBars.length === 1, 'bars=' + mBars.length
    + ' ' + JSON.stringify(mBars.map((b) => b.text.slice(0, 40))));
  const barText = (mBars.find((b) => b.onscreen) || {}).text || '';
  ok('  it carries the sheet progress', /\d+\s*\/\s*10/.test(barText), JSON.stringify(barText));
  ok('  and the CTA', /Boshlash/.test(barText), JSON.stringify(barText));
  // "must never cover text": the page reserves space for the bar rather than
  // letting it float over the last section.
  ok('  the page reserves room for it rather than covering text',
    await m.page.evaluate(() => {
      const bar = [...document.querySelectorAll('div')].find((d) => {
        const s = getComputedStyle(d);
        return s.position === 'fixed' && s.bottom === '0px' && d.getBoundingClientRect().height > 20;
      });
      if (!bar) return false;
      const h = bar.getBoundingClientRect().height;
      const pad = parseFloat(getComputedStyle(document.querySelector('[data-landing-pad]')
        || document.body).paddingBottom) || 0;
      return pad >= h - 12;
    }));
  ok('no console errors on mobile', m.errs.length === 0, JSON.stringify(m.errs.slice(0, 3)));

  // ---- desktop: the sticky sheet ---------------------------------------
  const d = await open({ viewport: { width: 1440, height: 900 } });
  ok('desktop shows the sticky sheet', await d.page.locator('text=/\\d+ \\/ 10/').count() > 0);
  ok('  and no bottom bar at all', (await bottomBars(d.page)).length === 0);
  await scrollTo(d.page, 0.4);
  ok('  which fills on scroll', (await filled(d.page)) > 0, 'filled=' + await filled(d.page));
  ok('no console errors on desktop', d.errs.length === 0, JSON.stringify(d.errs.slice(0, 3)));

  // ---- reduced motion: complete, static, plain CTA ----------------------
  // The spec's fallback is a plain static stack: the sheet arrives already
  // written, the letter already lit, and the bar reduced to a CTA with no
  // progress — so none of it depends on a scroll handler.
  const r = await open({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const sheet = (page) => page.evaluate((growth) => {
    // The sheet's own rows: "28px + 1fr" is the sheet, "48px + 1fr" is the
    // lens list in the same section, which also lights up and would otherwise
    // make a ten-row assertion read twelve.
    const rows = [...document.querySelectorAll('[data-teaser] [style*="grid-template-columns: 28px"]')];
    const nums = rows.map((row) => row.firstElementChild).filter(Boolean);
    return {
      rows: nums.length,
      lit: nums.filter((n) => getComputedStyle(n).color === growth).length,
    };
  }, GROWTH);
  const rs = await sheet(r.page);
  ok('reduced motion shows the sheet already complete', rs.rows === 10 && rs.lit === 10, JSON.stringify(rs));
  const rBars = await bottomBars(r.page);
  ok('  the plain CTA bar is there from the start, no scrolling needed',
    rBars.length === 1 && rBars[0].onscreen, JSON.stringify(rBars));
  ok('  with the CTA but no progress readout',
    /Boshlash/.test(rBars[0].text) && !/\d+\s*\/\s*10/.test(rBars[0].text), JSON.stringify(rBars[0].text));
  await scrollTo(r.page, 0.4);
  ok('  and scrolling changes nothing', JSON.stringify(await sheet(r.page)) === JSON.stringify(rs));
  ok('  the letter is fully legible, not faded', await r.page.evaluate(() => {
    const s = document.querySelector('[data-letter] span[style*="opacity"]');
    return s ? parseFloat(getComputedStyle(s).opacity) === 1 : false;
  }));
  ok('no console errors under reduced motion', r.errs.length === 0, JSON.stringify(r.errs.slice(0, 3)));

  // ---- the device must not run off the landing --------------------------
  const other = await open({ viewport: { width: 390, height: 844 } }, '/#/maxfiylik');
  ok('the scroll device does not run on other routes',
    (await bottomBars(other.page)).length === 0 && (await filled(other.page)) === null);
  ok('  and that route still renders', /Maxfiylik/i.test(await other.page.locator('body').innerText()));

  for (const v of [m, d, r, other]) await v.ctx.close();
  await browser.close();
  srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
