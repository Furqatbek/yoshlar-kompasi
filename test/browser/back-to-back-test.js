// Two children, one after the other, on one device — a teacher's actual
// afternoon, and the thing a parent does when a neighbour asks "can you do
// mine too?".
//
// What this pins:
//
//  * The setup screen belongs to the NEXT child. Returning to #/boshlash used
//    to re-open step 2 with the previous child's name, grade and ticked
//    consent — the two-step guard skipped, and one wrong tap away from
//    starting a sitting labelled with the wrong child's name.
//  * Starting again works at all. The second start is the one that used to
//    queue behind the first: session creation waited on a model greeting the
//    screen never showed, so back-to-back sittings meant two long waits.
//  * The reset is not a wipe. An adult who stepped out of an unfinished
//    sitting must still be offered it back, so the saved session handle
//    survives a visit to the setup screen.
//
// Stubbed API: this exercises the client's state transitions, which is where
// all three defects lived.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { stubLogin } = require('./auth-stub');

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

const Q1 = 'LEGO yoki konstruktor yig‘ishni yaxshi ko‘raman.';
const QUESTIONS = {
  questions: [
    { n: 1, text: Q1, section: 'construction_engineering', section_title: 'Konstruktorlik va muhandislik' },
    { n: 2, text: 'Biror narsa buzilib qolsa, uni qanday tuzatishni o‘ylab ko‘raman.',
      section: 'construction_engineering', section_title: 'Konstruktorlik va muhandislik' },
  ],
  answers: {},
  scale: [
    { value: 1, label: 'Yo‘q, bu men emas' }, { value: 2, label: 'Kamdan-kam' },
    { value: 3, label: 'Ba’zan' }, { value: 4, label: 'Ko‘pincha' },
    { value: 5, label: 'Ha, bu aynan men' },
  ],
  progress: { answered: 0, seen: 0, total: 70 },
  done: false,
};

(async () => {
  await new Promise((r) => srv.listen(8098, r));
  const b = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process'],
  });
  // A phone: the viewport the scrolling defects actually happen on.
  const page = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await stubLogin(page);

  // Each start gets its own session, as the server would give it — questions
  // included, which is how the real response comes back.
  const created = [];
  let starts = 0;
  await page.route('**/api/sessions', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = JSON.parse(route.request().postData() || '{}');
    const token = 'tok_child_' + (++starts);
    created.push({ token, nickname: body.nickname, grade: body.grade });
    route.fulfill({
      status: 201, contentType: 'application/json',
      body: JSON.stringify({
        session_id: 'sid' + starts, session_token: token, status: 'active',
        child: { nickname: body.nickname, grade: body.grade, age: body.age || null, goal: '', notes: '' },
        // Creating a session stores one hidden turn and nothing else: no model
        // is called, so there is nothing for the adult to read here.
        messages: [{ role: 'user', content: 'child context', meta: true }],
        progress: { answered: 0, seen: 0, total: 70 }, done: false,
        inventory: QUESTIONS,
      }),
    });
  });
  // Kept for the resume path, and counted: starting a sitting must NOT come
  // here. The questions arrive with the session, so a request landing on this
  // route means the first question is waiting on a second round trip again —
  // about a second of staring at a pressed button on mobile data.
  let questionFetches = 0;
  await page.route(/\/api\/sessions\/tok_child_\d+\/questions/, (route) => {
    questionFetches++;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(QUESTIONS) });
  });
  await page.route(/\/api\/sessions\/tok_child_\d+$/, (route) => {
    const tok = route.request().url().split('/').pop();
    const c = created.find((x) => x.token === tok) || {};
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        child: { nickname: c.nickname, grade: c.grade, age: null, goal: '', notes: '' },
        messages: [{ role: 'user', content: 'child context', meta: true }],
        status: 'active', progress: { answered: 0, seen: 0, total: 70 }, done: false, report: null,
      }),
    });
  });

  const startSitting = async (name, gradeLabel) => {
    await page.fill('#yik-name', name);
    await page.click('button:has-text("' + gradeLabel + '")');
    await page.locator('input[type="checkbox"]').first().check();
    await page.click('button:has-text("Davom etish")');
    await page.waitForTimeout(250);
    await page.click('button:has-text("Mashg\'ulotni boshlash")');
    await page.waitForTimeout(700);
  };

  // ---- first child --------------------------------------------------------
  await page.goto('http://127.0.0.1:8098/#/boshlash', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1500);
  await startSitting('Ali', '2-sinf');
  ok('first sitting reaches the questions', (await page.locator('body').innerText()).includes('LEGO yoki konstruktor'));
  ok('  under the first child\'s name', (await page.locator('body').innerText()).includes('Ali'));
  ok('  in one round trip, not two', questionFetches === 0,
    'the inventory came back with the session, so nothing should have fetched it; got '
      + questionFetches + ' request(s)');

  // Answer one, then walk away to start the next child.
  await page.click('button:has-text("Ko‘pincha")');
  await page.waitForTimeout(300);

  // ---- back to the setup screen -------------------------------------------
  await page.evaluate(() => { location.hash = '#/boshlash'; });
  await page.waitForTimeout(700);

  const nameVal = await page.inputValue('#yik-name');
  ok('the form is empty for the next child', nameVal === '', JSON.stringify(nameVal));
  const consent = await page.locator('input[type="checkbox"]').first().isChecked();
  ok('  consent is not pre-ticked for them', consent === false);
  ok('  and it opens at step 1, not step 2',
    await page.locator('button:has-text("Davom etish")').count() === 1
    && await page.locator('button:has-text("Mashg\'ulotni boshlash")').count() === 0);
  ok('  the previous child\'s name is gone from the screen',
    !(await page.locator('body').innerText()).includes('Ali'));
  const stillSaved = await page.evaluate(() => localStorage.getItem('yik_sess_v1'));
  ok('  but the unfinished sitting is still saved', !!stillSaved && stillSaved.includes('tok_child_1'),
    String(stillSaved));

  // ---- second child, immediately ------------------------------------------
  const t = Date.now();
  await startSitting('Vali', '4-sinf');
  const secondMs = Date.now() - t;
  const txt = await page.locator('body').innerText();
  ok('second sitting reaches the questions', txt.includes('LEGO yoki konstruktor'));
  ok('  under the second child\'s name', txt.includes('Vali') && !txt.includes('Ali bilan'));
  ok('  on its own session', (await page.evaluate(() => location.hash)).includes('tok_child_2'));
  ok('  and the second start is no slower than the first', secondMs < 5000, secondMs + 'ms');
  ok('two sittings were created, not one reused', starts === 2, 'starts=' + starts);
  ok('  with the right names on them',
    JSON.stringify(created.map((c) => c.nickname + '/' + c.grade)) === '["Ali/2","Vali/4"]',
    JSON.stringify(created));

  await b.close(); srv.close();
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('DRIVER ERR', String(e).slice(0, 400)); process.exit(2); });
