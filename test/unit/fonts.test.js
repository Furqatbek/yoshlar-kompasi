// The product's typeface, and the two ways it can disappear without anyone
// noticing.
//
// It is self-hosted now, and the production CSP no longer permits Google's
// origins. That is faster and more private, but it sets two traps:
//
//   1. Re-adding a remote @import or a remote src would be blocked by the CSP
//      in production only — the page keeps working in dev and loses its type
//      on the live site, which is the worst place to find out.
//   2. The italic face is a TEXT subset of one fixed string on the landing
//      page, carrying only the glyphs that string needs. Edit the string and
//      the new letters render in Georgia mid-sentence: a defect you have to
//      already suspect in order to see.
//
// Both are cheap to assert and impossible to spot by reading a diff.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DS = path.join(ROOT, '_ds', 'kompas-warm-paper');
const cssRaw = fs.readFileSync(path.join(DS, 'styles.css'), 'utf8');
// Comments explain the very things being asserted against, so they are not
// part of the stylesheet for these purposes.
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
const app = fs.readFileSync(path.join(ROOT, 'Kompas.dc.html'), 'utf8');
const security = fs.readFileSync(path.join(ROOT, 'server', 'middleware', 'security.js'), 'utf8');
const script = fs.readFileSync(path.join(ROOT, 'server', 'scripts', 'fetch-fonts.js'), 'utf8');

let pass = 0;
const test = (name, fn) => { fn(); pass++; console.log('  ok  - ' + name); };

test('the type is served from here, not from Google', () => {
  assert.ok(!/@import/.test(css), 'an @import is a serial round trip before the page can be set');
  assert.ok(!/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(css), 'remote font origin in styles.css');
});

test('and the production CSP matches where the fonts actually come from', () => {
  // The direction that matters: a remote font with a policy that forbids it
  // fails in production only.
  const remote = (css.match(/url\((['"]?)(https?:)?\/\/[^)]+\)/g) || []);
  const allowsGoogle = /fonts\.gstatic\.com/.test(security);
  assert.ok(remote.length === 0 || allowsGoogle,
    'styles.css loads ' + remote.length + ' remote font file(s) but font-src does not allow them: '
      + JSON.stringify(remote.slice(0, 2)));
  assert.ok(/font-src 'self' data:/.test(security), 'font-src should be local while the fonts are');
});

test('every font file the stylesheet asks for exists', () => {
  const refs = [...css.matchAll(/url\('(fonts\/[^']+)'\)/g)].map((m) => m[1]);
  assert.ok(refs.length >= 3, 'expected the family to be declared, found ' + refs.length + ' faces');
  for (const r of refs) {
    assert.ok(fs.existsSync(path.join(DS, r)), 'missing font file: ' + r);
  }
});

test('nothing blocks first paint on a font arriving', () => {
  const faces = css.split('@font-face').slice(1);
  for (const f of faces) {
    assert.ok(/font-display:\s*swap/.test(f),
      'a face without font-display: swap hides its text until the file lands:\n' + f.slice(0, 120));
  }
});

// ---- the italic text subset --------------------------------------------
// It covers exactly the landing page's sample letter. If that string changes
// and the subset is not regenerated, the new characters fall back silently.
const landingLetter = (app.match(/LND_LETTER\s*=\s*'((?:[^'\\]|\\.)*)'/) || [])[1];
const scriptLetter = (script.match(/LANDING_LETTER\s*=\s*\n?\s*'((?:[^'\\]|\\.)*)'/) || [])[1];

test('the landing letter is where the generator thinks it is', () => {
  assert.ok(landingLetter, 'LND_LETTER not found in Kompas.dc.html');
  assert.ok(scriptLetter, 'LANDING_LETTER not found in fetch-fonts.js');
});

test('  and the italic subset was cut from that exact string', () => {
  assert.strictEqual(scriptLetter, landingLetter,
    'the landing letter changed without regenerating the italic subset.\n'
    + '  landing: ' + JSON.stringify(landingLetter) + '\n'
    + '  script:  ' + JSON.stringify(scriptLetter) + '\n'
    + '  Run: node server/scripts/fetch-fonts.js');
});

// Google declares a text subset with the exact set of code points the file
// carries, which makes the declaration itself checkable: every character of
// the landing letter must fall inside it, or that character renders in Georgia.
test('  and every character of that letter is actually in the italic file', () => {
  const italic = css.split('@font-face').slice(1).find((f) => /font-style:\s*italic/.test(f));
  assert.ok(italic, 'no italic face declared, but the landing letter is set in one');
  const decl = (italic.match(/unicode-range:\s*([^;]+);/) || [])[1];
  assert.ok(decl, 'the italic face declares no unicode-range, so nothing says what it covers');
  const ranges = decl.split(',').map((r) => {
    const [a, b] = r.trim().replace(/^U\+/i, '').split('-');
    return [parseInt(a, 16), parseInt(b || a, 16)];
  });
  const covered = (cp) => ranges.some(([lo, hi]) => cp >= lo && cp <= hi);
  const missing = [...new Set(landingLetter.replace(/\\(.)/g, '$1').split(''))]
    .filter((ch) => !covered(ch.codePointAt(0)));
  assert.deepStrictEqual(missing, [],
    'these characters of the landing letter are not in the italic subset and will '
    + 'render in the fallback face: ' + JSON.stringify(missing)
    + '\n  Run: node server/scripts/fetch-fonts.js');
});

test('italic is used for the landing letter and nothing else', () => {
  // If italic spreads to dynamic text — a report, a child's name — a subset of
  // one fixed sentence is the wrong thing to be shipping.
  const uses = (app.match(/font-style:\s*italic/g) || []).length;
  assert.strictEqual(uses, 1,
    'italic now appears ' + uses + ' times; a text-subset font can only serve fixed copy');
});

console.log('\n' + pass + ' passed, 0 failed');
