'use strict';

// The report as a file.
//
// "PDF yuklab olish" used to be window.print(), which opens a dialog where the
// reader has to find "Save as PDF" themselves — two steps on a laptop and an
// awkward Share → Print → Save to Files on a phone, which is where most of
// these are read. This produces the file directly.
//
// It is drawn rather than screenshotted. The alternative is a headless Chromium
// printing the existing page, which is pixel-perfect and costs a 300 MB image
// and a browser process per download — on a server that also runs Postgres for
// a centre in Tashkent. A report is a known document with seven sections, so
// laying it out directly gives real selectable text, a file around 60 KB, and
// no browser. The cost is that this file and the print stylesheet are two
// descriptions of one design: test/unit/pdf.test.js holds them to the rules
// that matter.
//
// Those rules come from the print stylesheet and are not decoration:
//
//   * Ink on paper. Nothing depends on a background fill for its contrast —
//     the letter to the child is an outlined box with dark text, not a
//     terracotta card with light text. A school printer is monochrome and a
//     browser print dialog ships with background graphics off; a card that
//     relies on its fill prints as an empty rectangle, and that card is the
//     one part meant to be read aloud.
//   * The letter is never split across a page break.
//   * A heading never ends a page on its own.

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const FONTS = {
  serif: 'literata-400.ttf',
  serifBold: 'literata-600.ttf',
  serifItalic: 'literata-italic-400.ttf',
  sans: 'public-sans-400.ttf',
  sansBold: 'public-sans-600.ttf',
};

// The design tokens, from _ds/kompas-warm-paper/styles.css.
const INK = '#1e2422';
const MUTED = '#5b615c';
const GREEN = '#124839';      // accent-700, the heading colour
const TERRACOTTA = '#a85630'; // accent-2, the letter
const HAIRLINE = '#cac5ba';   // neutral-400: a hairline that survives printing

const PAGE = { size: 'A4', margin: 40 }; // ~14mm, matching @page in the app

function fontPath(key) {
  const p = path.join(FONT_DIR, FONTS[key]);
  if (!fs.existsSync(p)) {
    throw new Error('pdf: missing font ' + FONTS[key] + ' — run `node server/scripts/fetch-fonts.js`');
  }
  return p;
}

// ---------------------------------------------------------------------------
// The markdown the model writes: `## Heading`, paragraphs, `- bullets`, and
// `**bold**` inside a line. Nothing else is permitted by the report brief, so
// nothing else is handled — an unexpected construct renders as its own text
// rather than disappearing.
// ---------------------------------------------------------------------------
function parseBlocks(md) {
  const blocks = [];
  let para = [];
  const flush = () => { if (para.length) { blocks.push({ type: 'p', text: para.join(' ') }); para = []; } };
  for (const raw of String(md || '').split('\n')) {
    const line = raw.trimEnd();
    if (/^\s*#{1,6}\s+/.test(line)) {
      flush();
      blocks.push({ type: 'h', text: line.replace(/^\s*#{1,6}\s+/, '').trim() });
    } else if (/^\s*([-*]|\d+[.)])\s+/.test(line)) {
      flush();
      blocks.push({ type: 'li', text: line.replace(/^\s*([-*]|\d+[.)])\s+/, '').trim() });
    } else if (!line.trim()) {
      flush();
    } else {
      para.push(line.trim());
    }
  }
  flush();
  return blocks;
}

// `**bold**` -> runs, so a bold area name stays bold instead of showing its
// asterisks. Single asterisks are left alone: they appear in prose.
function runs(text) {
  const out = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), bold: false });
    out.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), bold: false });
  return out.length ? out : [{ text, bold: false }];
}

function writeRuns(doc, parts, opts) {
  const { font, boldFont, size, color } = opts;
  parts.forEach((part, i) => {
    doc.font(part.bold ? boldFont : font).fontSize(size).fillColor(color);
    doc.text(part.text, { continued: i < parts.length - 1 });
  });
}

// Height of a block, so a decision about a page break can be made before any
// ink is on the page.
function heightOf(doc, parts, opts, width) {
  const plain = parts.map((p) => p.text).join('');
  doc.font(opts.font).fontSize(opts.size);
  return doc.heightOfString(plain, { width });
}

// ---------------------------------------------------------------------------

function fmtDate(d) {
  const x = d instanceof Date ? d : new Date(d || Date.now());
  if (isNaN(x.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return p(x.getDate()) + '.' + p(x.getMonth() + 1) + '.' + x.getFullYear();
}

// A filename a parent can find again in a Downloads folder full of files.
function fileNameFor(report, brand) {
  const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, '').trim();
  return [safe(brand), safe(report.nickname), fmtDate(report.created_at)]
    .filter(Boolean).join(' - ') + '.pdf';
}

/**
 * Draw the report. Returns a PDFDocument that has already been `end()`ed —
 * pipe it to a response or collect it with `toBuffer`.
 */
function renderReport(report, opts = {}) {
  const brand = opts.brand || 'CareerKids';
  const phones = opts.phones || [];
  const md = String(report.content_md || '');

  const doc = new PDFDocument({
    ...PAGE,
    // Pages are held until end(), so the footer can be written onto every page
    // once the total is known — a page number needs to know what it is out of.
    bufferPages: true,
    // Content streams are Flate-compressed in production. The tests turn this
    // off so they can read the drawing operators and check the rules the print
    // design rests on — chiefly that nothing is drawn as a filled box.
    ...(opts.compress === false ? { compress: false } : {}),
    info: {
      Title: [brand, report.nickname].filter(Boolean).join(' — '),
      Author: brand,
      // Not a psychological test, and the file says so in its own metadata.
      Subject: 'Qiziqishlar hisoboti — tashxis emas',
      CreationDate: report.created_at ? new Date(report.created_at) : new Date(),
    },
  });
  doc.registerFont('serif', fontPath('serif'));
  doc.registerFont('serif-bold', fontPath('serifBold'));
  doc.registerFont('serif-italic', fontPath('serifItalic'));
  doc.registerFont('sans', fontPath('sans'));
  doc.registerFont('sans-bold', fontPath('sansBold'));

  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;

  // ---- masthead ----------------------------------------------------------
  doc.font('sans-bold').fontSize(9).fillColor(GREEN)
    .text((brand + ' · Hisobot').toUpperCase(), { characterSpacing: 1.2 });
  doc.moveDown(0.6);
  doc.font('serif-bold').fontSize(28).fillColor(INK).text(report.nickname || 'Hisobot');
  doc.moveDown(0.2);
  const meta = [report.grade ? report.grade + '-sinf' : '', fmtDate(report.created_at)]
    .filter(Boolean).join('  ·  ');
  doc.font('sans').fontSize(10).fillColor(MUTED).text(meta);
  if (report.partial) {
    doc.moveDown(0.35);
    doc.font('sans').fontSize(10).fillColor(TERRACOTTA)
      .text('Mashg‘ulot to‘liq yakunlanmagan — hisobot qisman ma’lumotga asoslangan.');
  }
  doc.moveDown(0.9);
  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(1).strokeColor(HAIRLINE).stroke();
  doc.moveDown(1.1);

  // ---- body --------------------------------------------------------------
  const blocks = parseBlocks(md);
  // The letter to the child is the one section that is boxed and must stay
  // whole. It is found by heading rather than by position, because an
  // administrator can reorder the report.
  const LETTER = /dalda|xat/i;
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];

    if (b.type === 'h' && LETTER.test(b.text)) {
      const body = [];
      let j = i + 1;
      while (j < blocks.length && blocks[j].type !== 'h') { body.push(blocks[j]); j++; }
      drawLetter(doc, b.text, body, { left, width, bottom });
      i = j;
      continue;
    }

    if (b.type === 'h') {
      // A heading alone at the foot of a page is a heading in the wrong place:
      // take the next block's height into account before committing.
      const next = blocks[i + 1];
      const need = 26 + (next ? heightOf(doc, runs(next.text), { font: 'sans', size: 11 }, width - 14) : 0);
      if (doc.y + need > bottom()) doc.addPage();
      doc.moveDown(0.5);
      doc.font('serif-bold').fontSize(14).fillColor(GREEN).text(b.text, { width });
      doc.moveDown(0.45);
      i++;
      continue;
    }

    const parts = runs(b.text);
    if (b.type === 'li') {
      const w = width - 14;
      if (doc.y + heightOf(doc, parts, { font: 'sans', size: 11 }, w) > bottom()) doc.addPage();
      const y = doc.y;
      doc.font('sans').fontSize(11).fillColor(GREEN).text('•', left, y + 1, { width: 10 });
      doc.y = y;
      doc.x = left + 14;
      writeRuns(doc, parts, { font: 'sans', boldFont: 'sans-bold', size: 11, color: INK });
      doc.x = left;
      doc.moveDown(0.35);
    } else {
      if (doc.y + heightOf(doc, parts, { font: 'sans', size: 11 }, width) > bottom()) doc.addPage();
      writeRuns(doc, parts, { font: 'sans', boldFont: 'sans-bold', size: 11, color: INK });
      doc.moveDown(0.5);
    }
    i++;
  }

  // ---- the centre --------------------------------------------------------
  if (phones.length) {
    if (doc.y + 56 > bottom()) doc.addPage();
    doc.moveDown(0.8);
    doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(1).strokeColor(HAIRLINE).stroke();
    doc.moveDown(0.7);
    doc.font('sans-bold').fontSize(9).fillColor(GREEN)
      .text('MARKAZ BILAN ALOQA', { characterSpacing: 1.1 });
    doc.moveDown(0.25);
    doc.font('serif-bold').fontSize(12).fillColor(INK).text(phones.join('     '));
  }

  paginate(doc, brand);
  doc.end();
  return doc;
}

// The letter the adult reads to the child: an outlined box, dark text, never
// split. On screen it is a terracotta card with light text on it; on paper that
// is the one block that can print as an empty rectangle, so it is re-cut here
// exactly as the print stylesheet re-cuts it.
function drawLetter(doc, heading, body, { left, width, bottom }) {
  const pad = 14;
  const inner = width - pad * 2;
  const lines = body.filter((b) => b.text && b.text.trim());

  doc.font('serif-italic').fontSize(13);
  let h = pad * 2 + 20;
  for (const b of lines) h += doc.heightOfString(b.text.replace(/\*\*/g, ''), { width: inner }) + 6;

  if (doc.y + h > bottom()) doc.addPage();
  doc.moveDown(0.6);
  const top = doc.y;

  doc.font('sans-bold').fontSize(9).fillColor(TERRACOTTA)
    .text(heading.toUpperCase(), left + pad, top + pad, { width: inner, characterSpacing: 1.1 });
  doc.moveDown(0.5);
  for (const b of lines) {
    doc.font('serif-italic').fontSize(13).fillColor(INK)
      .text(b.text.replace(/\*\*/g, ''), left + pad, doc.y, { width: inner });
    doc.moveDown(0.3);
  }
  const height = doc.y + pad - top;
  doc.lineWidth(1).strokeColor(TERRACOTTA).rect(left, top, width, height).stroke();
  doc.x = left;
  doc.y = top + height;
  doc.moveDown(0.8);
}

// Page numbers and the standing reminder, written after the body so the total
// is known. switchToPage lets the footer be added to pages already drawn.
function paginate(doc, brand) {
  const range = doc.bufferedPageRange ? doc.bufferedPageRange() : { start: 0, count: 1 };
  const total = range.count;
  for (let p = 0; p < total; p++) {
    doc.switchToPage(range.start + p);
    const left = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    // The footer sits in the bottom margin, which is below where pdfkit will
    // write: text past the bottom margin makes it start a new page, and that
    // new page then needs a footer of its own, for ever. Dropping the margin
    // for the duration is how you write into it.
    const keep = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - keep + 14;
    doc.font('sans').fontSize(8).fillColor(MUTED);
    doc.text(brand + ' · Bu hisobot tashxis emas, yo‘l-yo‘riq vositasi.', left, y, {
      width: width - 60, lineBreak: false,
    });
    if (total > 1) {
      doc.text((p + 1) + ' / ' + total, left + width - 60, y, { width: 60, align: 'right', lineBreak: false });
    }
    doc.page.margins.bottom = keep;
  }
}

function toBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

module.exports = { renderReport, toBuffer, fileNameFor, parseBlocks, runs, fmtDate };
