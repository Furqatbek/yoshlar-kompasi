// The end of the sitting: answers given, "Yakunlash" pressed, report on screen.
//
// This is the path the product exists for and the suite never walked. It had
// been broken outright: the finish gate counted CHAT MESSAGES to decide whether
// the child had answered anything, and the sitting stopped producing chat
// messages when the inventory became a form. So after seventy answers the count
// was still zero, "Yakunlash" always opened the "no answers yet" dialog, and
// there was no way to reach a report at all.
//
// Nothing caught it. exit-test presses Yakunlash with zero answers and asserts
// that dialog appears — the correct behaviour for that case, and the bug's
// behaviour for every other. The API tests post to /report directly and never
// touch the button. A defect can sit behind one `if` that only ever fails for
// people who got far enough to matter.
//
// So: answer, finish, and assert the parent arrives somewhere they can keep the
// report from.
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

const TOKEN = 'tok_finish_1';
const SHARE = 'share_finish_1';
const SECTION = { section: 'construction_engineering', section_title: 'Konstruktorlik va muhandislik' };
// Four questions, so "every question seen" is reachable in a test run.
const QUESTIONS = {
  questions: [
    { n: 1, text: 'LEGO yoki konstruktor yig‘ishni yaxshi ko‘raman.', ...SECTION },
    { n: 2, text: 'Biror narsa buzilib qolsa, uni qanday tuzatishni o‘ylab ko‘raman.', ...SECTION },
    { n: 3, text: 'O‘yinchoqning ichida nima borligini bilishga qiziqaman.', ...SECTION },
    { n: 4, text: 'Biror narsani qo‘lim bilan yasashni yaxshi ko‘raman.', ...SECTION },
  ],
  answers: {},
  scale: [
    { value: 1, label: 'Yo‘q, bu men emas' }, { value: 2, label: 'Kamdan-kam' },
    { value: 3, label: 'Ba’zan' }, { value: 4, label: 'Ko‘pincha' },
    { value: 5, label: 'Ha, bu aynan men' },
  ],
  progress: { answered: 0, seen: 0, total: 4 },
  done: false,
};
const REPORT_MD = [
  '## Qisqacha xulosa',
  'Sinov hozirda yasash va tekshirishga qiziqadi.',
  '## Bolaga o‘qib beriladigan dalda',
  'Sinov, sen qiyin savollardan qo‘rqmaysan!',
].join('\n');

(async () => {
  await new Promise((r) => srv.listen(8097, r));
  const b = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process'],
  });
  const page = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await stubLogin(page);

  // Server-side state the mocks share, so progress moves as answers are posted.
  let answered = 0, seen = 0;
  let reportRequests = 0;

  await page.route('**/api/sessions', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    route.fulfill({
      status: 201, contentType: 'application/json',
      body: JSON.stringify({
        session_id: 'sid', session_token: TOKEN, status: 'active',
        child: { nickname: 'Sinov', grade: 2, age: null, goal: '', notes: '' },
        messages: [{ role: 'user', content: 'child context', meta: true }],
        progress: { answered: 0, seen: 0, total: 4 }, done: false,
        inventory: QUESTIONS,
      }),
    });
  });
  await page.route('**/api/sessions/' + TOKEN + '/answers', (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    for (const a of body.answers || []) { seen++; if (a.value !== null) answered++; }
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ progress: { answered, seen, total: 4 }, done: seen >= 4 }),
    });
  });
  await page.route('**/api/sessions/' + TOKEN + '/contact', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }),
  }));
  await page.route('**/api/sessions/' + TOKEN + '/report', (route) => {
    reportRequests++;
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ report_url: 'http://127.0.0.1:8097/hisobot/' + SHARE, share_token: SHARE, partial: false, delivered: false, delivery: null }),
    });
  });
  await page.route('**/api/reports/' + SHARE, (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      nickname: 'Sinov', grade: 2, partial: false, date: '2026-10-23T10:00:00Z',
      locked: false, content_md: REPORT_MD, categories: {}, top_interests: [],
      developing_areas: [], clubs: [], sports: [], data_completeness: 'complete',
    }),
  }));
  await page.route('**/api/sessions/' + TOKEN + '/questions', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ...QUESTIONS, progress: { answered, seen, total: 4 }, done: seen >= 4 }),
  }));
  await page.route('**/api/sessions/' + TOKEN, (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      child: { nickname: 'Sinov', grade: 2, age: null, goal: '', notes: '' },
      messages: [{ role: 'user', content: 'child context', meta: true }],
      status: 'active', progress: { answered, seen, total: 4 }, done: seen >= 4, report: null,
    }),
  }));

  // ---- start and answer ---------------------------------------------------
  await page.goto('http://127.0.0.1:8097/#/boshlash', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.fill('#yik-name', 'Sinov');
  await page.click('button:has-text("2-sinf")');
  await page.locator('input[type="checkbox"]').first().check();
  await page.click('button:has-text("Davom etish")');
  await page.waitForTimeout(250);
  await page.click('button:has-text("Mashg\'ulotni boshlash")');
  await page.waitForTimeout(800);
  ok('the sitting opens on the first question',
    (await page.locator('body').innerText()).includes('LEGO yoki konstruktor'));

  // One answer, then try to finish early.
  await page.click('button:has-text("Ko‘pincha")');
  await page.waitForTimeout(400);
  ok('an answer is recorded', answered === 1, 'answered=' + answered);

  await page.click('button:has-text("Yakunlash")');
  await page.waitForTimeout(400);
  const afterOne = await page.locator('body').innerText();
  // THE regression: one answer given, and the app must not claim there are none.
  ok('one answer is not "no answers yet"', !afterOne.includes("Hali javoblar yo'q"),
    'the finish gate is counting something other than answers again');
  ok('  it offers the early-finish warning instead', afterOne.includes('Hozir yakunlaymizmi'),
    JSON.stringify(afterOne.replace(/\s+/g, ' ').slice(0, 120)));
  await page.click('button:has-text("Ortga")');
  await page.waitForTimeout(300);

  // ---- answer the rest ----------------------------------------------------
  for (let i = 0; i < 3; i++) {
    const btn = page.locator('button:has-text("Ko‘pincha")').first();
    if (await btn.count()) { await btn.click(); await page.waitForTimeout(350); }
  }
  ok('every question is answered', answered === 4, 'answered=' + answered);
  const doneScreen = await page.locator('body').innerText();
  ok('the sitting says so', doneScreen.includes('Hammasi tayyor'),
    JSON.stringify(doneScreen.replace(/\s+/g, ' ').slice(0, 100)));

  // ---- finish -------------------------------------------------------------
  await page.click('button:has-text("Hisobotni olish")');
  await page.waitForTimeout(500);
  const afterFinish = await page.locator('body').innerText();
  // The heading renders uppercase via CSS, and innerText returns it transformed.
  ok('a completed sitting goes straight to the contact step',
    !afterFinish.includes("Hali javoblar yo'q") && /oxirgi qadam/i.test(afterFinish),
    JSON.stringify(afterFinish.replace(/\s+/g, ' ').slice(0, 140)));

  await page.fill('#yik-parent', 'Ota-ona');
  await page.locator('input[type="checkbox"]').first().check();
  await page.click('button:has-text("Hisobotni ochish")');
  await page.waitForTimeout(1500);

  // ---- the report ---------------------------------------------------------
  ok('the report was generated', reportRequests === 1, 'requests=' + reportRequests);
  const report = await page.locator('body').innerText();
  ok('  and is on screen', report.includes('Qisqacha xulosa'),
    JSON.stringify(report.replace(/\s+/g, ' ').slice(0, 120)));
  ok('  at its own URL, so it can be reopened later',
    (await page.evaluate(() => location.hash)).includes('/hisobot/' + SHARE));
  ok('  with a way to keep it', report.includes('PDF yuklab olish'));

  // The saved PDF is named by the document title, so it has to identify the
  // child rather than being the brand name four times in a Downloads folder.
  const title = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('PDF yuklab olish'));
    let seenTitle = null;
    const print = window.print;
    window.print = () => { seenTitle = document.title; };
    btn.click();
    window.print = print;
    return seenTitle;
  });
  ok('  and the file will be named after the child', !!title && /Sinov/.test(title), JSON.stringify(title));
  ok('  without leaving the tab renamed afterwards',
    await page.evaluate(() => new Promise((r) => setTimeout(() => r(!/Sinov/.test(document.title)), 2300))));

  await b.close(); srv.close();
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('DRIVER ERR', String(e).slice(0, 400)); process.exit(2); });
