// The thirteen headings, and the four places that have to agree about them.
//
// The model is told which headings to write. The paywall decides free from paid
// by reading them back. The PDF finds the letter to the child by reading them
// back. The report page splits on them. None of those four lookups errors when
// a heading does not match — the section simply stops existing, in a report a
// parent paid for.
//
// This file is the only thing standing between "somebody reworded a heading"
// and that outcome.

process.env.DATABASE_URL = 'postgres://u:p@127.0.0.1:5432/none';
process.env.JWT_SECRET = 'x'.repeat(20);
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

const assert = require('assert');
const path = require('path');

const SERVER = path.join(__dirname, '..', '..', 'server');
const { SECTIONS } = require(path.join(SERVER, 'data', 'reportTemplate'));
const prompt = require(path.join(SERVER, 'services', 'prompt'));
const paywall = require(path.join(SERVER, 'services', 'paywall'));
const pdf = require(path.join(SERVER, 'services', 'pdf'));

let pass = 0;
const test = (name, fn) => { fn(); pass++; console.log('  ok  - ' + name); };

test('there are thirteen of them, positioned 1..13 with unique keys', () => {
  assert.strictEqual(SECTIONS.length, 13);
  assert.deepStrictEqual(
    SECTIONS.map((s) => s.position),
    Array.from({ length: 13 }, (_, i) => i + 1),
    'positions must be 1..13 in order — the report is assembled in this order'
  );
  assert.strictEqual(new Set(SECTIONS.map((s) => s.key)).size, 13, 'keys must be unique');
  assert.strictEqual(new Set(SECTIONS.map((s) => s.heading)).size, 13,
    'two identical headings would merge into one section when the report is split');
});

test('every section says what belongs in it', () => {
  for (const s of SECTIONS) {
    assert.ok(s.instruction && s.instruction.length > 40,
      s.key + ' has no usable brief; the model would invent the section');
  }
});

// What the model is actually sent.
const request = prompt.buildReportRequest('Ali', false, null);

test('the report request asks for exactly these headings, in order', () => {
  const asked = [...request.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.deepStrictEqual(asked, SECTIONS.map((s) => s.heading));
});

test('  and tells the model to use them verbatim', () => {
  assert.match(request, /aynan shu tartibda va aynan shu/,
    'without this the model paraphrases headings and every lookup below misses');
});

// A report written exactly as instructed.
const report = SECTIONS
  .map((s) => '## ' + s.heading + '\nMatn.\n')
  .join('\n');

test('splitting such a report finds all thirteen', () => {
  const titles = paywall.sections(report).map((s) => s.title).filter(Boolean);
  assert.deepStrictEqual(titles, SECTIONS.map((s) => s.heading));
});

test('the free/paid split comes out as the template declares', () => {
  const { freeMd, lockedTitles } = paywall.split(report);
  assert.deepStrictEqual(lockedTitles, SECTIONS.filter((s) => !s.free).map((s) => s.heading));
  for (const s of SECTIONS.filter((x) => x.free)) {
    assert.ok(freeMd.includes(s.heading), s.heading + ' should be readable without paying');
  }
  for (const s of SECTIONS.filter((x) => !x.free)) {
    assert.ok(!freeMd.includes(s.heading), s.heading + ' leaked past the paywall');
  }
});

// The PDF boxes the letter to the child and must find exactly one. Two matches
// and it boxes something that is not a letter; none and the letter renders as
// ordinary prose, losing the one piece of the report meant to be read aloud.
test('exactly one heading reads as the letter to the child', () => {
  const LETTER = /dalda|xat/i;
  const matched = SECTIONS.filter((s) => LETTER.test(s.heading)).map((s) => s.key);
  assert.deepStrictEqual(matched, ['encouragement'],
    'the PDF looks for /dalda|xat/i — see services/pdf.js');
});

test('the PDF reads every heading as a heading', () => {
  const blocks = pdf.parseBlocks(report);
  const headings = blocks.filter((b) => b.type === 'h').map((b) => b.text);
  assert.deepStrictEqual(headings, SECTIONS.map((s) => s.heading));
});

// Six of the thirteen are new, and the point of adding them was the content.
// A heading can be present and the brief still fail to ask for what §20 asks
// for, which no structural check would notice.
test('the new sections ask for what the instructions added them for', () => {
  const brief = (key) => SECTIONS.find((s) => s.key === key).instruction;
  assert.match(brief('subjects'), /Matematika/);
  assert.match(brief('subjects'), /ingliz tili/i);
  assert.match(brief('subjects'), /IT/);
  assert.match(brief('teacher'), /2–5 daqiqa/, 'a teacher activity has to fit in a lesson');
  assert.match(brief('parent_steps'), /uchta/, 'three steps, per §20');
  // The two that must refuse to invent, per §16, §17 and §23. This is the rule
  // that makes it safe to ship the prompt before the catalogues exist.
  assert.match(brief('reading'), /uydirmang/, 'no invented book titles');
  assert.match(brief('support'), /uydirmang/, 'no invented tutors, prices or reviews');
});

// §22 draws a line these two sit closest to: recommending maths practice is
// fine, implying the child is behind at maths is not.
test('the subject brief forbids the conclusion it invites', () => {
  assert.match(SECTIONS.find((s) => s.key === 'subjects').instruction,
    /xulosa chiqarmang/, 'must forbid concluding the child is behind');
});

// A deployment that already seeded the old seven sections gets the new six from
// the seeder, but the seeder inserts with ON CONFLICT DO NOTHING and cannot
// move anything — so the retained sections are repositioned by migration 009.
// Reorder this file without touching that migration and fresh installs and
// upgraded ones end up with the report in different orders, which nothing
// downstream would notice and no test but this one would catch.
test('migration 009 repositions the retained sections to where they now sit', () => {
  const fs = require('fs');
  const sql = fs.readFileSync(
    path.join(SERVER, 'db', 'migrations', '009_report_v2.sql'), 'utf8');

  const moved = new Map();
  for (const m of sql.matchAll(
    /UPDATE report_sections SET position =\s*(\d+)[^;]*?WHERE key = '([a-z_]+)'/g)) {
    moved.set(m[2], Number(m[1]));
  }
  assert.ok(moved.size >= 6, 'expected the retained sections to be repositioned, found ' + moved.size);

  for (const [key, position] of moved) {
    const shipped = SECTIONS.find((s) => s.key === key);
    assert.ok(shipped, '009 moves "' + key + '", which the template no longer has');
    assert.strictEqual(position, shipped.position,
      '009 puts ' + key + ' at ' + position + ', the template at ' + shipped.position);
  }

  // The renamed one is handled by its own statement, so it is checked here too.
  assert.match(sql, /SET key = 'sports_clubs', position = 7/,
    'clubs -> sports_clubs must land on the template position');
  assert.strictEqual(SECTIONS.find((s) => s.key === 'sports_clubs').position, 7);
});

console.log('\n' + pass + ' passed, 0 failed');
