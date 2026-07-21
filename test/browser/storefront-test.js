// Storefront.dc.html end-to-end: drives the white-label storefront through its
// key flows — catalog, search, product, cart + coupon, guest checkout, order
// tracking, phone+OTP sign-in, wishlist, points, notifications, deep-link
// guards, system dark mode and runtime tenant switching.
// Serves a temp copy with vendored React preloaded (same trick as build-web),
// so it runs fully offline.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const WEBROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-web-'));

function buildWebroot() {
  fs.mkdirSync(path.join(WEBROOT, 'vendor'), { recursive: true });
  let html = fs.readFileSync(path.join(ROOT, 'Storefront.dc.html'), 'utf8');
  const tag = '<script src="./support.js"></script>';
  if (!html.includes(tag)) throw new Error('support.js tag not found in Storefront.dc.html');
  html = html.replace(tag, '<script src="/vendor/react.production.min.js"></script>\n<script src="/vendor/react-dom.production.min.js"></script>\n' + tag);
  fs.writeFileSync(path.join(WEBROOT, 'index.html'), html);
  fs.copyFileSync(path.join(ROOT, 'support.js'), path.join(WEBROOT, 'support.js'));
  for (const f of ['react.production.min.js', 'react-dom.production.min.js'])
    fs.copyFileSync(path.join(ROOT, 'server', 'vendor', f), path.join(WEBROOT, 'vendor', f));
}

const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  fs.readFile(path.join(WEBROOT, p), (err, buf) => {
    if (err) { res.statusCode = 404; return res.end(''); }
    res.setHeader('Content-Type', TYPES[path.extname(p)] || 'application/octet-stream');
    res.end(buf);
  });
});

let pass = 0, fail = 0;
const ok = (n, c, extra) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')); };

(async () => {
  buildWebroot();
  await new Promise((r) => srv.listen(8097, r));
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  // ---- launch & home ----
  await page.goto('http://127.0.0.1:8097/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(250);
  ok('launch splash shows', await page.locator('text=Дўкон юкланмоқда').count() > 0);
  await page.waitForTimeout(700);
  ok('home appears after boot', await page.locator('text=Баракат маркет').count() > 0);
  ok('title set from tenant', (await page.title()) === 'Баракат маркет');
  await page.waitForTimeout(800); // skeleton -> catalog
  ok('catalog rendered', await page.locator('text=Помидор, Ўзбекистон').count() > 0);
  ok('kg price shown', await page.locator('text=14 000 сўм').count() > 0);

  // ---- category filter & sale chip ----
  await page.click('button:has-text("Ичимликлар")');
  await page.waitForTimeout(150);
  ok('category filters catalog', await page.locator('text=2 та').count() > 0);
  await page.click('button:has-text("Барчаси")');
  await page.waitForTimeout(150);
  await page.click('button:has-text("Ҳафта чегирмалари")');
  await page.waitForTimeout(150);
  ok('sale chip activates via banner', await page.locator('button[aria-pressed="true"]:has-text("Чегирмалар")').count() > 0);
  ok('sale banner hides on sale cat', await page.locator('text=Ҳафта чегирмалари').count() === 0);
  await page.click('button:has-text("Барчаси")');
  await page.waitForTimeout(150);

  // ---- add to cart from card (kg step) ----
  await page.click('button:has-text("Қўшиш")');
  await page.waitForTimeout(200);
  ok('toast on add', await page.locator('text=Саватга қўшилди').count() > 0);
  ok('stepper shows kg qty', await page.locator('text=0,5 кг').count() > 0);
  ok('cart badge = 1', await page.locator('nav >> text="1"').count() > 0);

  // ---- search -> product ----
  await page.click('nav button:has-text("Қидирув")');
  await page.waitForTimeout(200);
  await page.fill('input[aria-label="Маҳсулот қидириш"]', 'гўшт');
  await page.waitForTimeout(200);
  ok('search finds product', await page.locator('text=Қўй гўшти, янги').count() > 0);
  await page.click('button:has-text("Қўй гўшти, янги")');
  await page.waitForTimeout(300);
  ok('product route', page.url().includes('#/mahsulot/g2'));
  ok('old price struck', await page.locator('text=110 000 сўм').count() > 0);
  ok('sale badge −14%', await page.locator('text=−14%').count() > 0);
  await page.click('button[aria-label="Кўпайтириш"]');
  await page.waitForTimeout(120);
  ok('qty stepped to 0,5 кг', await page.locator('text=0,5 кг').count() > 0);
  ok('CTA shows subtotal', await page.locator('text=Саватга қўшиш · 47 500 сўм').count() > 0);
  await page.click('button:has-text("Саватга қўшиш · 47 500 сўм")');
  await page.waitForTimeout(250);
  await page.click('button[aria-label="Севимлиларга қўшиш"]');
  await page.waitForTimeout(150);
  ok('wish toast', await page.locator('text=Севимлиларга қўшилди').count() > 0);
  await page.click('button:has-text("Орқага")');
  await page.waitForTimeout(250);
  ok('back → search kept query', page.url().includes('#/qidiruv') && await page.locator('input[aria-label="Маҳсулот қидириш"]').inputValue() === 'гўшт');

  // ---- cart: coupon + totals ----
  await page.click('nav button:has-text("Сават")');
  await page.waitForTimeout(200);
  ok('cart shows 2 lines', await page.locator('text=2 хил маҳсулот').count() > 0);
  ok('subtotal 54 500', await page.locator('text=54 500 сўм').count() > 0);
  await page.fill('input[aria-label="Купон коди"]', 'WRONG');
  await page.click('button:has-text("Қўллаш")');
  await page.waitForTimeout(150);
  ok('bad coupon error', await page.locator('text=Бундай купон топилмади').count() > 0);
  await page.fill('input[aria-label="Купон коди"]', 'salom10');
  await page.click('button:has-text("Қўллаш")');
  await page.waitForTimeout(150);
  ok('SALOM10 applied', await page.locator('text=SALOM10 — 10% чегирма қўлланди').count() > 0);
  ok('discount −5 450', await page.locator('text=−5 450 сўм').count() > 0);
  ok('total 49 050', await page.locator('text=Расмийлаштириш · 49 050 сўм').count() > 0);

  // ---- persistence across reload ----
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1600);
  ok('cart + coupon persisted', await page.locator('text=2 хил маҳсулот').count() > 0 && await page.locator('text=SALOM10 — 10% чегирма қўлланди').count() > 0);

  // ---- guest checkout ----
  await page.click('button:has-text("Расмийлаштириш ·")');
  await page.waitForTimeout(300);
  ok('missing fields listed', await page.locator('text=Тўлдириш керак:').count() > 0);
  await page.fill('#sf-co-name', 'Азиз Каримов');
  await page.fill('#sf-co-phone', '901234567');
  await page.click('button[aria-label^="Ҳудуд:"]');
  await page.waitForTimeout(350);
  ok('region sheet open', await page.locator('[role="dialog"] >> text=Тошкент шаҳри').count() > 0);
  await page.click('[role="dialog"] button:has-text("Тошкент шаҳри")');
  await page.waitForTimeout(350);
  ok('village sheet auto-opens', await page.locator('[role="dialog"] >> text=Чилонзор').count() > 0);
  await page.click('[role="dialog"] button:has-text("Чилонзор")');
  await page.waitForTimeout(250);
  ok('free delivery note', await page.locator('text=Етказиб бериш — бепул').count() > 0);
  await page.fill('#sf-co-addr', 'Кўча 1, уй 2');
  await page.waitForTimeout(150);
  ok('missing hint gone', await page.locator('text=Тўлдириш керак:').count() === 0);
  ok('place CTA names cash + total', await page.locator('text=Нақд тўлов · 49 050 сўм').count() > 0);
  await page.click('button:has-text("Буюртма бериш")');
  await page.waitForTimeout(400);

  // ---- success & tracking ----
  ok('success screen', await page.locator('text=Буюртма қабул қилинди').count() > 0);
  ok('order number BM-2401', await page.locator('text=№ BM-2401').count() > 0);
  ok('success route replaced checkout', page.url().includes('#/qabul/BM-2401'));
  await page.click('button:has-text("Буюртмани кузатиш")');
  await page.waitForTimeout(300);
  ok('tracking route', page.url().includes('#/kuzatish/BM-2401'));
  await page.click('button:has-text("Янгилаш")');
  await page.waitForTimeout(250);
  ok('advance toast', await page.locator('text=Ҳолат янгиланди').count() > 0);
  await page.click('button:has-text("Янгилаш")');
  await page.waitForTimeout(150);
  await page.click('button:has-text("Янгилаш")');
  await page.waitForTimeout(250);
  await page.click('button:has-text("Янгилаш")');
  await page.waitForTimeout(250);
  ok('already-delivered toast', await page.locator('text=Буюртма аллақачон етказилган').count() > 0);
  await page.click('button:has-text("Орқага")');
  await page.waitForTimeout(250);
  ok('back → success (history)', page.url().includes('#/qabul/BM-2401'));
  await page.click('button:has-text("Асосий саҳифага")');
  await page.waitForTimeout(250);

  // ---- orders via profile (guest sees own order, not the demo ones) ----
  await page.click('nav button:has-text("Профиль")');
  await page.waitForTimeout(250);
  ok('profile guest card', await page.locator('text=Тизимга киринг').count() > 0);
  await page.click('button:has-text("Буюртмаларим")');
  await page.waitForTimeout(250);
  ok('guest sees only own order', await page.locator('text=№ BM-2401').count() > 0 && await page.locator('text=№ BM-2394').count() === 0);
  ok('order chip Етказилди', await page.locator('text=Етказилди').count() > 0);
  await page.click('button:has-text("№ BM-2401")');
  await page.waitForTimeout(250);
  await page.click('button:has-text("Орқага")');
  await page.waitForTimeout(250);
  ok('back → orders (history)', page.url().includes('#/buyurtmalar'));
  await page.click('button:has-text("Профиль")');
  await page.waitForTimeout(250);

  // ---- passwordless sign-in ----
  await page.click('button:has-text("Телефон орқали кириш")');
  await page.waitForTimeout(250);
  await page.fill('input[aria-label="Телефон рақам"]', '901234567');
  await page.click('button:has-text("Кодни юбориш")');
  await page.waitForTimeout(300);
  ok('otp screen + timer', page.url().includes('#/tasdiqlash') && await page.locator('text=Қайта юбориш — 0:').count() > 0);
  await page.fill('input[aria-label="SMS-код"]', '000000');
  await page.waitForTimeout(600);
  ok('000000 shows error', await page.locator('text=Код нотўғри').count() > 0);
  await page.fill('input[aria-label="SMS-код"]', '123456');
  await page.waitForTimeout(700);
  ok('signed in → profile', page.url().includes('#/profil') && await page.locator('text=+998 90 123 45 67').count() > 0);
  ok('points 12 000', await page.locator('text=12 000').count() > 0);
  ok('orders count 3 (own + 2 demo)', (await page.locator('button:has-text("Буюртмаларим") >> text="3"').count()) > 0);

  // ---- wishlist ----
  await page.click('button:has-text("Севимлилар")');
  await page.waitForTimeout(250);
  ok('wishlist has product', await page.locator('text=Қўй гўшти, янги').count() > 0);
  await page.click('button[aria-label="Севимлилардан олиб ташлаш"]');
  await page.waitForTimeout(200);
  ok('wishlist empties', await page.locator('text=Севимлилар ҳозирча бўш').count() > 0);
  await page.click('button:has-text("Профиль")');
  await page.waitForTimeout(200);

  // ---- points cover a small order ----
  await page.click('nav button:has-text("Асосий")');
  await page.waitForTimeout(250);
  await page.click('button:has-text("Қўшиш")'); // tomato 0.5 кг = 7 000
  await page.waitForTimeout(150);
  await page.click('nav button:has-text("Сават")');
  await page.waitForTimeout(250);
  await page.click('button[role="switch"]');
  await page.waitForTimeout(150);
  ok('points cover total', await page.locator('text=Расмийлаштириш · 0 сўм').count() > 0);

  // ---- notifications ----
  await page.click('nav button:has-text("Асосий")');
  await page.waitForTimeout(200);
  await page.click('button[aria-label="Билдиришномалар"]');
  await page.waitForTimeout(250);
  ok('notifications screen', await page.locator('text=Буюртмангиз йўлда').count() > 0);
  await page.waitForTimeout(900);
  await page.click('button:has-text("Орқага")');
  await page.waitForTimeout(250);
  ok('notif dot cleared', await page.locator('button[aria-label="Билдиришномалар"] span[style*="--red"]').count() === 0);

  // ---- deep links & route guards (fresh loads) ----
  await page.goto('http://127.0.0.1:8097/?f=0#/mahsulot/g4', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  ok('deep link to product', await page.locator('text=Сут «Мусаффо», 1 л').count() > 0);
  await page.evaluate(() => localStorage.clear());
  await page.goto('http://127.0.0.1:8097/?f=1#/rasmiylashtirish', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  ok('empty-cart checkout → cart', page.url().includes('#/savat'));
  await page.goto('http://127.0.0.1:8097/?f=2#/tasdiqlash', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  ok('otp without phone → sign-in', page.url().includes('#/kirish'));
  await page.goto('http://127.0.0.1:8097/?f=3#/kuzatish/NOPE-1', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  ok('unknown order → not-found', await page.locator('text=Буюртма топилмади').count() > 0);

  // ---- system dark mode ----
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('http://127.0.0.1:8097/?f=4#/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1600);
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.sf-app')).backgroundColor);
  ok('dark background', bg === 'rgb(0, 0, 0)', bg);
  await page.emulateMedia({ colorScheme: 'light' });

  // ---- runtime white-label switch ----
  await page.goto('http://127.0.0.1:8097/?f=5#/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1600);
  await page.evaluate(() => window.__dcSetProps(window.__dcRootName(), { tenant: 'electronics' }));
  await page.waitForTimeout(2400);
  ok('tenant switch → electronics catalog', await page.locator('text=Симсиз қулоқчин «SoundGo Pro»').count() > 0);
  ok('electronics title', (await page.title()) === 'Техноплюс');

  const realErrors = errors.filter((e) => !e.includes('favicon'));
  ok('no page errors', realErrors.length === 0, realErrors.slice(0, 4).join(' | '));

  await b.close();
  srv.close();
  fs.rmSync(WEBROOT, { recursive: true, force: true });
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
