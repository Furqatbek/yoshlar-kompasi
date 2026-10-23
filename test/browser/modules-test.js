// The two optional modules, from the child's side.
//
// The thing that matters here is not that they work — it is that they stay
// optional. A child who has just answered seventy statements is allowed to be
// finished, and the report is complete without these. So the report button
// has to stay the primary one, the offer has to say the answers are not
// scored BEFORE anyone answers them, and stopping halfway has to be a decision
// the product records rather than a dead end.

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

const TOKEN = 'tok_mod_1';
const SECTION = { section: 'construction_engineering', section_title: 'Konstruktorlik va muhandislik' };
const QUESTIONS = {
  questions: [
    { n: 1, text: 'LEGO yoki konstruktor yig‘ishni yaxshi ko‘raman.', ...SECTION },
    { n: 2, text: 'Biror narsa buzilib qolsa, uni qanday tuzatishni o‘ylab ko‘raman.', ...SECTION },
  ],
  answers: {},
  scale: [
    { value: 1, label: 'Yo‘q, bu men emas' }, { value: 2, label: 'Kamdan-kam' },
    { value: 3, label: 'Ba’zan' }, { value: 4, label: 'Ko‘pincha' },
    { value: 5, label: 'Ha, bu aynan men' },
  ],
  progress: { answered: 0, seen: 0, total: 2 },
  done: false,
};

const MODULES = [
  {
    key: 'learning_preferences',
    title: 'Qanday o‘rganish qulay',
    intro: 'Bu savollar bolaning nimani yoqtirishini so‘raydi — to‘g‘ri yoki noto‘g‘ri javob yo‘q. '
      + 'Ular qiziqish ballariga qo‘shilmaydi va bolaga «o‘rganish uslubi» degan yorliq qo‘yilmaydi.',
    kind: 'scale',
    scale: [
      { value: 1, label: 'Yo‘q' }, { value: 2, label: 'Kamdan-kam' },
      { value: 3, label: 'Ba’zan' }, { value: 4, label: 'Ko‘pincha' }, { value: 5, label: 'Ha' },
    ],
    questions: [
      { n: 1, text: 'Rasm, chizma yoki diagrammalar yordamida tushuntirishni yoqtirasanmi?', options: null },
      { n: 2, text: 'Mashqlarni o‘zing bajarib ko‘rishni yoqtirasanmi?', options: null },
    ],
    answers: [], completed: null,
  },
  {
    key: 'homework_environment',
    title: 'Uy vazifasi qanday qulay',
    intro: 'Bu savollar uy vazifasi uchun qanday sharoit qulayroq ekanini so‘raydi. '
      + 'Javoblar qiziqish ballariga qo‘shilmaydi.',
    kind: 'choice',
    scale: null,
    questions: [
      { n: 1, text: 'Uy vazifasini qayerda bajarishni yoqtirasan?',
        options: ['Alohida, tinch joyda', 'Oila a’zolari yaqinida', 'Boshqa joyda'] },
    ],
    answers: [], completed: null,
  },
];

(async () => {
  await new Promise((r) => srv.listen(8098, r));
  const b = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process'],
  });
  const page = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await stubLogin(page);

  let answered = 0, seen = 0;
  const posted = [];       // what the module endpoints received
  let modulesFetched = 0;

  await page.route('**/api/sessions', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    route.fulfill({
      status: 201, contentType: 'application/json',
      body: JSON.stringify({
        session_id: 'sid', session_token: TOKEN, status: 'active',
        child: { nickname: 'Sinov', grade: 2, age: null, goal: '', notes: '' },
        messages: [{ role: 'user', content: 'child context', meta: true }],
        progress: { answered: 0, seen: 0, total: 2 }, done: false, inventory: QUESTIONS,
      }),
    });
  });
  await page.route('**/api/sessions/' + TOKEN + '/answers', (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    for (const a of body.answers || []) { seen++; if (a.value !== null) answered++; }
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ progress: { answered, seen, total: 2 }, done: seen >= 2 }),
    });
  });
  await page.route('**/api/sessions/' + TOKEN + '/modules', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    modulesFetched++;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ modules: MODULES }) });
  });
  await page.route('**/api/sessions/' + TOKEN + '/modules/*', (route) => {
    const key = route.request().url().split('/').pop();
    const body = JSON.parse(route.request().postData() || '{}');
    posted.push({ key, body });
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ module: key, saved: (body.answers || []).length,
        completed: !body.skipped, answered: (body.answers || []).length }),
    });
  });
  await page.route('**/api/sessions/' + TOKEN + '/questions', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ...QUESTIONS, progress: { answered, seen, total: 2 }, done: seen >= 2 }),
  }));
  await page.route('**/api/sessions/' + TOKEN, (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      child: { nickname: 'Sinov', grade: 2, age: null, goal: '', notes: '' },
      messages: [], status: 'active',
      progress: { answered, seen, total: 2 }, done: seen >= 2, report: null,
    }),
  }));

  // ---- answer the inventory ----------------------------------------------
  await page.goto('http://127.0.0.1:8098/#/boshlash', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.fill('#yik-name', 'Sinov');
  await page.click('button:has-text("2-sinf")');
  await page.locator('input[type="checkbox"]').first().check();
  await page.click('button:has-text("Davom etish")');
  await page.waitForTimeout(250);
  await page.click('button:has-text("Mashg\'ulotni boshlash")');
  await page.waitForTimeout(800);

  for (let i = 0; i < 2; i++) {
    const btn = page.locator('button:has-text("Ko‘pincha")').first();
    if (await btn.count()) { await btn.click(); await page.waitForTimeout(400); }
  }
  await page.waitForTimeout(600);

  // ---- the offer ----------------------------------------------------------
  const done = await page.locator('body').innerText();
  ok('the sitting is finished', done.includes('Hammasi tayyor'));
  ok('  the modules were fetched once the seventy were done', modulesFetched === 1,
    'fetched=' + modulesFetched);
  ok('  the report button is still the primary one',
    await page.locator('button.btn-primary:has-text("Hisobotni olish")').count() === 1,
    'optional means the fast path must stay fastest');
  ok('  the first module is offered', done.includes('Qanday o‘rganish qulay'),
    JSON.stringify(done.replace(/\s+/g, ' ').slice(-260)));
  ok('  and the offer says the answers are not scored, before anyone answers',
    /qiziqish ballariga qo‘shilmaydi/.test(done),
    'a parent has to know this to give an honest answer');

  // ---- answer the first module -------------------------------------------
  await page.click('button:has-text("Qanday o‘rganish qulay")');
  await page.waitForTimeout(400);
  const m1 = await page.locator('body').innerText();
  ok('the module opens on its first question',
    m1.includes('Rasm, chizma yoki diagrammalar') && m1.includes('1 / 2'),
    JSON.stringify(m1.replace(/\s+/g, ' ').slice(0, 160)));
  ok('  with the preference scale, not the inventory scale',
    m1.includes('Ha') && !m1.includes('Ha, bu aynan men'),
    'these ask what the child likes, not whether a statement is them');

  await page.click('button:has-text("Ko‘pincha")');
  await page.waitForTimeout(300);
  ok('  and advances', (await page.locator('body').innerText()).includes('2 / 2'));
  await page.locator('button:has-text("Ha")').first().click();
  await page.waitForTimeout(600);

  ok('finishing the last question submits the module', posted.length === 1,
    JSON.stringify(posted.map((p) => p.key)));
  ok('  with scale answers, not choices',
    posted[0] && posted[0].body.answers && posted[0].body.answers.every((a) => Number.isInteger(a.value)),
    JSON.stringify(posted[0] && posted[0].body));

  // ---- the second module, and stopping ------------------------------------
  await page.waitForTimeout(400);
  const after1 = await page.locator('body').innerText();
  ok('the next module is offered once the first is done',
    after1.includes('Uy vazifasi qanday qulay'),
    JSON.stringify(after1.replace(/\s+/g, ' ').slice(-200)));

  await page.click('button:has-text("Uy vazifasi qanday qulay")');
  await page.waitForTimeout(400);
  const m2 = await page.locator('body').innerText();
  ok('a choice module shows that question\'s own options',
    m2.includes('Alohida, tinch joyda') && m2.includes('Oila a’zolari yaqinida'),
    JSON.stringify(m2.replace(/\s+/g, ' ').slice(0, 200)));
  ok('  and not a 1-5 scale', !m2.includes('Kamdan-kam'));

  await page.click('button:has-text("Bu savolnomani to\'xtatish")');
  await page.waitForTimeout(600);
  ok('stopping records a skip rather than nothing',
    posted.length === 2 && posted[1].body.skipped === true,
    JSON.stringify(posted[1] && posted[1].body));

  const after2 = await page.locator('body').innerText();
  ok('  and the offer does not come back', !after2.includes('Uy vazifasi qanday qulay'),
    'a declined module must not keep asking');
  ok('  leaving the report one tap away',
    await page.locator('button.btn-primary:has-text("Hisobotni olish")').count() === 1);

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await b.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
