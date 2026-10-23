// The reading diary screen (§19).
//
// What is worth checking in a browser, as opposed to in the API test: that the
// one rule §19 states in words is also stated on the screen where the adult
// makes the decision. "Bola o‘qimagan kitobni tugatilgan deb belgilamang" is
// enforced by a CHECK constraint and by the route, but an adult who ticks the
// box and gets a 400 has been told off by a form. The checkbox has to say what
// it needs, next to itself, before it is ticked.
//
// Also: that a blank field stays blank. Every field but the title is optional
// because a blank means the child did not say, and a form that helpfully
// pre-fills one would have the product inventing an opinion for a child.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { stubLogin } = require('./auth-stub');

const ROOT = path.join(__dirname, '..', '..', 'server', 'public');
const CSP = ["default-src 'self'", "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'", "font-src 'self' data:",
  "img-src 'self' data:", "connect-src 'self'"].join('; ');
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
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

const CHILD = { id: 'child-1', nickname: 'Ali', grade: 2, age: 9, entries: '1' };

(async () => {
  await new Promise((r) => srv.listen(8099, r));
  const b = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process'],
  });
  const page = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await stubLogin(page);

  let entries = [{
    id: 'e1', child_id: CHILD.id, title: 'Sinov kitobi', author: 'Muallif',
    started_on: '2026-10-01T00:00:00.000Z', finished_on: null, status: 'reading',
    favourite_moment: null, favourite_character: null, unclear_part: null,
    opinion: null, discussed: null, next_choice: null,
  }];
  const posted = [];

  await page.route('**/api/diary', (route) => {
    if (route.request().method() === 'POST') {
      posted.push(JSON.parse(route.request().postData() || '{}'));
      return route.fulfill({ status: 201, contentType: 'application/json',
        body: JSON.stringify({ entry: entries[0] }) });
    }
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ children: [CHILD], entries }) });
  });

  await page.goto('http://127.0.0.1:8099/#/kundalik', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1800);

  const text = await page.locator('body').innerText();
  ok('the diary screen renders', text.includes('Kundalik'),
    JSON.stringify(text.replace(/\s+/g, ' ').slice(0, 140)));
  ok('  and lists the book being read', text.includes('Sinov kitobi'),
    JSON.stringify(text.replace(/\s+/g, ' ').slice(0, 260)));

  // Asserted on the element's state, not on its label. The label is uppercased
  // by CSS and innerText returns it transformed, so a prose assertion here
  // passes or fails for reasons unrelated to whether the book is finished —
  // the first version of this file had one that could never have failed.
  const cards = page.locator('[data-entry-status]');
  ok('  as one card', await cards.count() === 1, String(await cards.count()));
  ok('  marked as being read, not finished',
    (await cards.first().getAttribute('data-entry-status')) === 'reading',
    await cards.first().getAttribute('data-entry-status'));
  ok('  and its label agrees', /o‘qilyapti/i.test(await cards.first().innerText()),
    JSON.stringify((await cards.first().innerText()).replace(/\s+/g, ' ')));

  // §19 on screen, not only in the constraint.
  ok('the finish checkbox says a date is needed, before it is ticked',
    /tugatilgan sanani ham yozing/.test(text),
    'an adult who ticks and gets a 400 has been told off by a form');
  ok('  and says why', /o‘qilmagan kitob tugatilgan deb belgilanmaydi/.test(text));

  // Every field but the title is optional, and empty.
  for (const id of ['dy-author', 'dy-moment', 'dy-character', 'dy-unclear',
    'dy-opinion', 'dy-discussed', 'dy-next']) {
    const v = await page.locator('#' + id).inputValue();
    if (v !== '') { ok('field ' + id + ' starts empty', false, JSON.stringify(v)); }
  }
  ok('every optional field starts empty', true,
    'a blank means the child did not say; pre-filling one invents an opinion');

  // ---- the rule, from the adult's side ------------------------------------
  await page.fill('#dy-title', 'Yangi kitob');
  await page.locator('input[type="checkbox"]').last().check();
  await page.click('button:has-text("Saqlash")');
  await page.waitForTimeout(500);

  const afterTick = await page.locator('body').innerText();
  ok('ticking finished with no date is refused on the page',
    /Tugatilgan sanani yozing/.test(afterTick) && posted.length === 0,
    'posted=' + posted.length + ' — the request must not even be sent');

  await page.fill('#dy-finish', '2026-10-20');
  await page.click('button:has-text("Saqlash")');
  await page.waitForTimeout(600);

  ok('  with a date it saves', posted.length === 1, JSON.stringify(posted));
  ok('  as finished, with the date the adult entered',
    posted[0] && posted[0].status === 'finished' && posted[0].finished_on === '2026-10-20',
    JSON.stringify(posted[0] && { s: posted[0].status, f: posted[0].finished_on }));

  // ---- editing ------------------------------------------------------------
  await page.click('button:has-text("Tahrirlash")');
  await page.waitForTimeout(400);
  ok('editing loads the entry into the form',
    (await page.locator('#dy-title').inputValue()) === 'Sinov kitobi',
    await page.locator('#dy-title').inputValue());
  ok('  and the form says so', (await page.locator('body').innerText()).includes('Kitobni tahrirlash'));

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await b.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
