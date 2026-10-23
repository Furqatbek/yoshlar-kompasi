// The product's name and the centre's phone numbers, as the built page carries
// them.
//
// A rename is the kind of change that looks finished long before it is: the
// title, the wordmark, the report header, the bot's self-introduction and the
// system prompt all say the name, and missing one leaves the old brand sitting
// somewhere a customer eventually reads.
//
// The numbers earned their own assertions the hard way. They are written once
// in E.164 (the form a tel: link needs) and formatted for display — and the
// display formatter collided with an existing method of the same name, the
// contact gate's input mask, which takes the nine local digits a parent types
// under a fixed "+998" label. Handing it a full number produced
// "99 893-51-57": a plausible Uzbek number, rendered under a correct tel:
// link, that belonged to nobody.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const app = fs.readFileSync(path.join(ROOT, 'Kompas.dc.html'), 'utf8');

const BRAND = 'CareerKids';
const PHONES = ['+998935157343', '+998935657343'];
const PRETTY = ['+998 93 515-73-43', '+998 93 565-73-43'];

let pass = 0;
const test = (name, fn) => { fn(); pass++; console.log('  ok  - ' + name); };

test('the page is titled with the product name', () => {
  const m = app.match(/<title>([^<]*)<\/title>/);
  assert.ok(m, 'no <title>');
  assert.strictEqual(m[1].trim(), BRAND);
});

test('the brand falls back to it in code, not to a previous name', () => {
  const m = app.match(/brand\(\)\s*\{[^}]*\}/);
  assert.ok(m && m[0].includes(BRAND), m && m[0]);
});

test('and the editable default agrees with the code', () => {
  const props = JSON.parse(
    (app.match(/data-props="([^"]*)"/)[1])
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  );
  assert.strictEqual(props.brandName.default, BRAND);
});

// Every screen but the landing draws its name from brand(); the landing's
// wordmark and the comparison card are literal, which is how half a rename
// survives.
test('no earlier name is left anywhere in the page', () => {
  const old = app.match(/Yosh Iste[’'‘]dodlar|Yoshlar Kompasi|>Kompas</g) || [];
  assert.deepStrictEqual(old, [], 'left over: ' + JSON.stringify(old));
});

// ---- the centre's numbers ------------------------------------------------
test('both numbers are declared, in a form that can be dialled', () => {
  const m = app.match(/PHONES\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, 'no PHONES list');
  const got = m[1].match(/\+\d+/g) || [];
  assert.deepStrictEqual(got, PHONES, got.join(' '));
});

test('  and the editable default carries the same two', () => {
  const props = JSON.parse(
    (app.match(/data-props="([^"]*)"/)[1])
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  );
  const got = String(props.ctaPhones.default).split(',').map((x) => x.trim());
  assert.deepStrictEqual(got, PHONES, props.ctaPhones.default);
});

test('  the old placeholder number is gone', () => {
  assert.ok(!/200-70-07/.test(app), 'the placeholder +998 71 200-70-07 is still in the page');
});

// The real check: run the page's own formatter and compare with the number a
// person would read out. A formatter that silently mangles this still produces
// something that looks like a phone number.
test('the displayed number is the number', () => {
  const body = app.match(/fmtE164\(e164\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(body, 'fmtE164 not found — if it was renamed, check what it collides with');
  // eslint-disable-next-line no-new-func
  const fmt = new Function('e164', body[1]);
  for (let i = 0; i < PHONES.length; i++) {
    assert.strictEqual(fmt(PHONES[i]), PRETTY[i], PHONES[i] + ' formatted as ' + fmt(PHONES[i]));
  }
});

// The server has its own copy, because it draws the PDF. A file headed with a
// different name from the page it was downloaded from is worse than either name
// alone, so the two are held to the same values here.
test('the server and the page agree on the name and the numbers', () => {
  const cfg = fs.readFileSync(path.join(ROOT, 'server', 'config.js'), 'utf8');
  const name = (cfg.match(/BRAND_NAME \|\| '([^']+)'/) || [])[1];
  assert.strictEqual(name, BRAND, 'server default is ' + JSON.stringify(name));
  const nums = (cfg.match(/CONTACT_PHONES \|\| '([^']+)'/) || [])[1];
  assert.deepStrictEqual(String(nums).split(',').map((x) => x.trim()), PHONES, nums);
});

test('  and it does not share a name with the gate\'s input mask', () => {
  // Two methods of the same name in one class body: the later one wins and the
  // earlier one is silently dead. That is exactly how the wrong number shipped.
  const names = (app.match(/^  ([A-Za-z_$][\w$]*)\s*\(/gm) || [])
    .map((s) => s.trim().replace(/\($/, ''));
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  assert.deepStrictEqual([...new Set(dupes)], [],
    'these methods are declared twice, so the first of each is dead code: ' + JSON.stringify([...new Set(dupes)]));
});

console.log('\n' + pass + ' passed, 0 failed');
