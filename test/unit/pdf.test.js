// The report as a file: what comes out of services/pdf.js.
//
// This is a second description of a design the print stylesheet already
// describes — two renderings of one document, which is the price of not
// shipping a headless browser to screenshot the first one. So the rules that
// actually matter on paper are asserted here directly, read out of the PDF's
// own drawing operators rather than taken on trust:
//
//   * Ink on paper. Nothing is a filled box. A school printer is monochrome
//     and a browser print dialog ships with background graphics off, so a card
//     that carries its contrast in a fill prints as an empty rectangle — and
//     the card in question is the letter meant to be read to the child aloud.
//   * The letter is never split across a page break.
//   * The type is embedded, or a reader without Literata installed gets
//     something else entirely, and the Uzbek turned commas may not survive.
//
// Content streams are read with compression off; in production they are Flate.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const pdf = require('../../server/services/pdf');

let pass = 0;
const test = (name, fn) => { fn(); pass++; console.log('  ok  - ' + name); };
const atest = async (name, fn) => { await fn(); pass++; console.log('  ok  - ' + name); };

const LETTER_HEADING = 'Bolaga o‘qib beriladigan dalda';
const body = (letterLines, filler) => [
  '## Qisqacha xulosa',
  'Ali hozirda yasash va tekshirishga qiziqadi.',
  ...(filler || []),
  '## 12 yo‘nalish bo‘yicha natijalar',
  '- **Konstruktorlik va muhandislik** — 6/6 javob, o‘rtacha 4.50 — kuchli qiziqish bildirildi.',
  '## ' + LETTER_HEADING,
  ...letterLines,
  '## Kattalar uchun muhim eslatmalar',
  'Bu standartlashtirilgan test emas.',
].join('\n');

const report = (md) => ({
  nickname: 'Ali', grade: 2, partial: false,
  created_at: new Date('2026-10-23T09:00:00Z'), content_md: md,
});

const render = (md, extra) => pdf.toBuffer(pdf.renderReport(report(md), {
  brand: 'CareerKids', phones: ['+998 93 515-73-43', '+998 93 565-73-43'],
  compress: false, ...(extra || {}),
}));

// PDFKit writes one content stream per page.
function streams(buf) {
  const s = buf.toString('latin1');
  const out = [];
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  let m;
  while ((m = re.exec(s))) {
    const raw = Buffer.from(m[1], 'latin1');
    if (raw[0] === 0x78) { try { out.push(zlib.inflateSync(raw).toString('latin1')); continue; } catch (_) { /* not flate */ } }
    out.push(m[1]);
  }
  return out;
}

(async () => {
  // ---- it is a PDF, and a real one ---------------------------------------
  const buf = await render(body(['Ali, sen qiyin savollardan qo‘rqmaysan — bu katta kuch!']));
  test('what comes out is a PDF', () => {
    assert.strictEqual(buf.slice(0, 5).toString(), '%PDF-');
    assert.ok(buf.toString('latin1').trimEnd().endsWith('%%EOF'), 'no EOF marker');
    assert.ok(buf.length > 10000, 'suspiciously small: ' + buf.length + ' bytes');
  });

  test('  with the type embedded, not merely named', () => {
    const s = buf.toString('latin1');
    // FontFile2 is an embedded TrueType program. Without it a reader
    // substitutes whatever it has, and the turned commas in o‘/g‘ are exactly
    // the characters a substitute is likely to miss.
    assert.ok(/\/FontFile2/.test(s), 'no embedded font program');
    assert.ok(/Literata/.test(s) && /PublicSans|Public\+?Sans/i.test(s),
      'the report is not set in the product typeface');
  });

  test('  and it says what it is in its own metadata', () => {
    // PDFKit writes Info strings as UTF-16BE literals, so every character is
    // preceded by a NUL byte; dropping those gives readable text back.
    const s = buf.toString('latin1').replace(/\0/g, '');
    assert.ok(s.includes('CareerKids'), 'brand missing from the document properties');
    assert.ok(s.includes('Ali'), "the child's name is missing from the title");
    assert.ok(/tashxis emas/.test(s),
      'the file does not state, in its own properties, that it is not a diagnosis');
  });

  // ---- ink on paper -------------------------------------------------------
  await atest('nothing is drawn as a filled box', async () => {
    // `re` builds a rectangle; `f`, `F` or `f*` fills it, `S` strokes it. A
    // fill behind text is what disappears on a monochrome printer.
    for (const s of streams(buf)) {
      const fills = s.match(/\bre\b[^A-Za-z]*\b(f\*?|F)\b/g) || [];
      assert.deepStrictEqual(fills, [],
        'a filled rectangle would print as an empty box: ' + JSON.stringify(fills));
    }
  });

  await atest('  the letter is an outline, in the colour it has on screen', async () => {
    // PDFKit writes colours as full-precision floats with SCN (stroking) or
    // scn (filling), so they are compared as numbers.
    const want = [0xa8, 0x56, 0x30].map((v) => v / 255); // --color-accent-2
    const strokes = [];
    for (const s of streams(buf)) {
      const re = /([\d.]+) ([\d.]+) ([\d.]+) SCN/g;
      let m;
      while ((m = re.exec(s))) strokes.push([+m[1], +m[2], +m[3]]);
    }
    const close = strokes.some((c) => c.every((v, i) => Math.abs(v - want[i]) < 0.01));
    assert.ok(close, 'the letter is not stroked in the terracotta the design gives it; '
      + 'stroke colours found: ' + JSON.stringify(strokes.map((c) => c.map((v) => v.toFixed(2)))));
  });

  // ---- the letter is one whole box, at every content length --------------
  // Grown a paragraph at a time so the letter lands at a different place on
  // the page each time. Note what this does and does not show: removing the
  // explicit page-break guard in drawLetter does NOT make it fail, because
  // pdfkit's own pagination already moves the heading to the next page first.
  // So this is a property check — one box, sane height, inside the page,
  // whatever the length — and not a trap set for that particular guard. It
  // would catch the box being drawn from a stale position, which is the shape
  // the failure takes when the letter's geometry and its text disagree.
  await atest('the letter is one whole box at every content length', async () => {
    const filler = [];
    for (let n = 0; n < 26; n++) {
      filler.push('Bolaning javoblari shu kunlardagi qiziqishini ko‘rsatadi, qobiliyatini emas. '
        + 'Qiziqish vaqt o‘tishi bilan o‘zgaradi va bu tabiiy.');
      const b = await render(body(['Ali, sen qiyin savollardan qo‘rqmaysan — bu katta kuch! '
        + 'Har kuni ozgina mashq qilsang, yanada kuchli bo‘lasan.'], filler.slice()));
      // Find the letter's rectangle: `x y w h re` followed by a stroke.
      const boxes = [];
      for (const s of streams(b)) {
        const re = /([\d.]+) ([\d.]+) ([\d.]+) (-?[\d.]+) re\s*S/g;
        let m;
        while ((m = re.exec(s))) boxes.push({ y: parseFloat(m[2]), h: parseFloat(m[4]) });
      }
      assert.strictEqual(boxes.length, 1, 'expected exactly one boxed section, got ' + boxes.length
        + ' at filler length ' + filler.length);
      const box = boxes[0];
      const PAGE_H = 841.89; // A4 points
      // This is what a split looks like: the heading is written near the foot
      // of one page, the text flows onto the next, and the box is then drawn
      // from a top that is no longer on this page — giving it a negative or
      // absurd height. A box that encloses its own text has a sensible one.
      assert.ok(box.h > 30 && box.h < PAGE_H,
        'the letter box is ' + box.h.toFixed(1) + 'pt tall at filler length '
          + filler.length + ' — it has been split across a page break');
      assert.ok(box.y >= 0 && box.y + box.h <= PAGE_H,
        'the letter runs off the page at filler length ' + filler.length
          + ': ' + JSON.stringify(box));
    }
  });

  // ---- structure ----------------------------------------------------------
  test('headings, bullets and bold are read out of the markdown', () => {
    const blocks = pdf.parseBlocks('## Bosh\nMatn bir.\n\n- Birinchi\n- **Ikkinchi** izoh\n');
    assert.deepStrictEqual(blocks.map((b) => b.type), ['h', 'p', 'li', 'li']);
    assert.strictEqual(blocks[0].text, 'Bosh');
    assert.deepStrictEqual(pdf.runs('**Qalin** oddiy').map((r) => [r.text, r.bold]),
      [['Qalin', true], [' oddiy', false]]);
  });

  test('a file name a parent can find again', () => {
    assert.strictEqual(
      pdf.fileNameFor({ nickname: 'Ali', created_at: new Date('2026-10-23T09:00:00Z') }, 'CareerKids'),
      'CareerKids - Ali - 23.10.2026.pdf');
    // A nickname is free text and ends up in a filename.
    assert.ok(!/[/\\:*?"<>|]/.test(
      pdf.fileNameFor({ nickname: 'A/B:C*?"<>|', created_at: new Date() }, 'CareerKids')),
    'a name with path characters in it must not reach the filesystem intact');
  });

  // ---- the fonts have to be in the image ---------------------------------
  test('the embedded faces are present on disk', () => {
    const dir = path.join(__dirname, '..', '..', 'server', 'assets', 'fonts');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    assert.ok(files.length >= 5, 'expected the PDF faces in server/assets/fonts, found ' + files.length
      + ' — run `node server/scripts/fetch-fonts.js`');
    for (const f of files) {
      const head = fs.readFileSync(path.join(dir, f)).slice(0, 4);
      // 0x00010000 is a TrueType font; 'wOF2' would mean a browser font that
      // pdfkit cannot read.
      assert.deepStrictEqual([...head], [0, 1, 0, 0], f + ' is not a TrueType font');
    }
  });

  console.log('\n' + pass + ' passed, 0 failed');
})().catch((e) => { console.error(e); process.exit(1); });
