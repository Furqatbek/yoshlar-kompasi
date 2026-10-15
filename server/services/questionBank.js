'use strict';

// The live question bank.
//
// The approved 70 live in data/questions.js and are seeded into the database;
// the admin panel edits the database. The prompt is built from whatever the
// database holds, so an edit reaches the next sitting — and changes the prompt
// version, because a different instrument deserves a different cache key.
//
// Cached in memory because the prompt is assembled on every session start.
// invalidate() is called whenever the panel writes.

const { query, withTransaction } = require('../db/pool');
const { SCALE } = require('../data/questions');

let _cache = null;
// The rendered markdown, kept as a string so prompt.js can stay synchronous:
// it is assembled on every session start and making it async would ripple
// through every request path for no gain.
let _md = null;
let _report = null;   // the report brief, same caching story as the bank

async function load() {
  if (_cache) return _cache;
  const [{ rows: sections }, { rows: questions }, { rows: bands }] = await Promise.all([
    query('SELECT key, title, position FROM question_sections ORDER BY position ASC'),
    query('SELECT n, section_key, text, position, active, is_default FROM questions ORDER BY position ASC, n ASC'),
    query('SELECT key, max_value, label, position FROM score_bands ORDER BY position ASC'),
  ]);
  const bySection = new Map(sections.map((s) => [s.key, { ...s, items: [] }]));
  for (const q of questions) {
    const s = bySection.get(q.section_key);
    if (s) s.items.push(q);
  }
  _cache = {
    sections: sections.map((s) => bySection.get(s.key)),
    bands: bands.map((b) => ({ ...b, max_value: Number(b.max_value) })),
    activeCount: questions.filter((q) => q.active).length,
    total: questions.length,
  };
  return _cache;
}

function invalidate() { _cache = null; _md = null; _report = null; }

// The markdown the prompt embeds. Disabled questions are left out entirely —
// the model must not see a question it is not meant to ask.
function renderMarkdown(bank) {
  const out = [];
  const active = bank.sections.map((s) => ({ ...s, items: s.items.filter((q) => q.active) }))
    .filter((s) => s.items.length);
  const count = active.reduce((n, s) => n + s.items.length, 0);
  out.push('# Savollar banki — 1–4-sinflar (' + count + ' ta tasdiqlangan savol)', '');
  out.push('Bu ro‘yxat — loyihaning tasdiqlangan savollar banki. Savol matnlarini');
  out.push('o‘zgartirish, qisqartirish, almashtirish yoki yangisini qo‘shish mumkin emas.', '');
  out.push('Har bir savolga 1–5 oralig‘ida javob olinadi:', '');
  for (const s of SCALE) out.push('- **' + s.value + '** — ' + s.label);
  out.push('');
  out.push('Bola javob berishni xohlamasa yoki savolni tushunmasa, savolni o‘tkazib');
  out.push('yuborish mumkin. O‘tkazib yuborilgan savol nol deb hisoblanmaydi.', '');
  for (const s of active) {
    out.push('## ' + s.position + '-bo‘lim. ' + s.title, '');
    for (const q of s.items) out.push(q.n + '. ' + q.text);
    out.push('');
  }
  out.push('## Natijalarni guruhlash', '');
  let lo = 1.0;
  for (const b of bank.bands) {
    out.push('- ' + lo.toFixed(2) + '–' + Math.min(b.max_value, 5).toFixed(2) + ' — ' + b.label);
    lo = b.max_value + 0.01;
  }
  out.push('');
  out.push('Bu chegaralar faqat qiziqish javoblarini guruhlash uchun. Ular');
  out.push('tasdiqlangan psixometrik me’yorlar emas.', '');
  return out.join('\n');
}

async function markdown() {
  if (_md) return _md;
  _md = renderMarkdown(await load());
  return _md;
}

// What prompt.js reads. Null until the bank has been loaded once, which the
// app does at boot; prompt.js falls back to the seeded file until then, so a
// cold start can never serve an empty bank.
function cachedMarkdown() { return _md; }

// Reload and re-render. Called at boot and after every admin edit.
async function refresh() {
  invalidate();
  await loadReportSections();
  return markdown();
}

// ---- the report brief ----------------------------------------------------
async function loadReportSections() {
  if (_report) return _report;
  const { rows } = await query(
    'SELECT key, heading, instruction, position, free FROM report_sections ORDER BY position ASC');
  _report = rows.length ? rows : null;
  return _report;
}

function cachedReportSections() { return _report; }

async function updateReportSection(key, { heading, instruction }) {
  const sets = [];
  const params = [key];
  if (typeof heading === 'string' && heading.trim()) { params.push(heading.trim()); sets.push('heading = $' + params.length); }
  if (typeof instruction === 'string' && instruction.trim()) { params.push(instruction.trim()); sets.push('instruction = $' + params.length); }
  if (!sets.length) return null;
  sets.push('updated_at = now()');
  const { rows } = await query(
    'UPDATE report_sections SET ' + sets.join(', ') + ' WHERE key = $1 RETURNING *', params);
  invalidate();
  return rows[0] || null;
}

async function updateQuestion(n, { text, active }) {
  const sets = [];
  const params = [n];
  if (typeof text === 'string' && text.trim()) { params.push(text.trim()); sets.push('text = $' + params.length); }
  if (typeof active === 'boolean') { params.push(active); sets.push('active = $' + params.length); }
  if (!sets.length) return null;
  sets.push('updated_at = now()');
  const { rows } = await query(
    'UPDATE questions SET ' + sets.join(', ') + ' WHERE n = $1 RETURNING *', params);
  invalidate();
  return rows[0] || null;
}

// Append a question to a section. The number carries on from the highest in
// the bank rather than filling a gap: question numbers are referenced by every
// answer row ever recorded, so reusing one would silently attach old answers to
// a new question.
async function addQuestion(sectionKey, text) {
  const { rows: sec } = await query('SELECT key FROM question_sections WHERE key = $1', [sectionKey]);
  if (!sec.length) return null;
  const { rows } = await query(
    `INSERT INTO questions (n, section_key, text, position, is_default, active)
     VALUES (
       (SELECT COALESCE(MAX(n), 0) + 1 FROM questions),
       $1, $2,
       (SELECT COALESCE(MAX(position), 0) + 1 FROM questions WHERE section_key = $1),
       false, true
     )
     RETURNING *`,
    [sectionKey, text]
  );
  invalidate();
  return rows[0] || null;
}

// Move a question up or down inside its section, or a section up or down in
// the running order. Positions are rewritten densely afterwards so a list that
// has been shuffled for a while cannot drift into ties.
async function moveQuestion(n, dir) {
  const { rows } = await query('SELECT n, section_key, position FROM questions WHERE n = $1', [n]);
  if (!rows.length) return null;
  const q = rows[0];
  const { rows: sib } = await query(
    `SELECT n, position FROM questions WHERE section_key = $1
      AND position ${dir < 0 ? '<' : '>'} $2
      ORDER BY position ${dir < 0 ? 'DESC' : 'ASC'} LIMIT 1`,
    [q.section_key, q.position]
  );
  if (!sib.length) return q;            // already at the end; not an error
  await withTransaction(async (c) => {
    await c.query('UPDATE questions SET position = -1 WHERE n = $1', [q.n]);
    await c.query('UPDATE questions SET position = $2, updated_at = now() WHERE n = $1', [sib[0].n, q.position]);
    await c.query('UPDATE questions SET position = $2, updated_at = now() WHERE n = $1', [q.n, sib[0].position]);
  });
  invalidate();
  return { ...q, position: sib[0].position };
}

async function moveSection(key, dir) {
  const { rows } = await query('SELECT key, position FROM question_sections WHERE key = $1', [key]);
  if (!rows.length) return null;
  const cur = rows[0];
  const { rows: sib } = await query(
    `SELECT key, position FROM question_sections WHERE position ${dir < 0 ? '<' : '>'} $1
      ORDER BY position ${dir < 0 ? 'DESC' : 'ASC'} LIMIT 1`,
    [cur.position]
  );
  if (!sib.length) return cur;
  await withTransaction(async (c) => {
    await c.query('UPDATE question_sections SET position = -1 WHERE key = $1', [cur.key]);
    await c.query('UPDATE question_sections SET position = $2 WHERE key = $1', [sib[0].key, cur.position]);
    await c.query('UPDATE question_sections SET position = $2 WHERE key = $1', [cur.key, sib[0].position]);
  });
  invalidate();
  return { ...cur, position: sib[0].position };
}

async function updateBand(key, { maxValue, label }) {
  const sets = [];
  const params = [key];
  if (Number.isFinite(maxValue)) { params.push(maxValue); sets.push('max_value = $' + params.length); }
  if (typeof label === 'string' && label.trim()) { params.push(label.trim()); sets.push('label = $' + params.length); }
  if (!sets.length) return null;
  sets.push('updated_at = now()');
  const { rows } = await query(
    'UPDATE score_bands SET ' + sets.join(', ') + ' WHERE key = $1 RETURNING *', params);
  invalidate();
  return rows[0] || null;
}

module.exports = {
  load, invalidate, markdown, cachedMarkdown, refresh, renderMarkdown,
  updateQuestion, addQuestion, moveQuestion, moveSection, updateBand,
  loadReportSections, cachedReportSections, updateReportSection,
};
