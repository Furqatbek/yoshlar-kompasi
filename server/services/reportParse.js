'use strict';

// Parsing helpers for the model's output.
//
//  - [JAVOBLAR: 1=4, 2=5, 3=x] records the 1-5 answers as they are given;
//    see services/answerMarkers.js. Progress through the 70 is counted from
//    those rows, which replaced the old [YAKUN:] three-track markers when the
//    instrument changed.
//  - the report's trailing ```json block is the model's own copy of the
//    scores. It is kept for comparison, but services/scoring.js on the server
//    is what the report and the admin columns are actually built from.

const { parseAnswerMarkers, stripAnswerMarkers } = require('./answerMarkers');

// Kept so reports written under the previous instrument still read correctly:
// their level columns hold real values and the admin list still shows them.
const LEGACY_LEVELS = ['shakllanmoqda', 'meyorda', 'kuchli'];
function normLevel(v) {
  if (v == null) return null;
  const s = String(v).toLowerCase();
  if (s.includes('kuchli')) return 'kuchli';
  if (s.includes('shakl')) return 'shakllanmoqda';
  if (s.includes('yor') || s.includes('meyor') || s.includes("me'yor")) return 'meyorda';
  return null;
}

// v1 wrote `clubs` and `sports` as arrays of strings. §11 and §16 of the v2
// instructions ask for reasons and starting steps alongside each
// recommendation, so the model now sends objects — and String(object) is
// "[object Object]", which is what a parent would have read on the report page.
//
// The readable label is pulled out for the two legacy columns, which the report
// page and the admin list render as text; the whole object is kept in `payload`
// for anything that wants the detail. Lossy on purpose, and only here.
function label(x) {
  if (x == null) return '';
  if (typeof x !== 'object') return String(x);
  for (const k of ['name', 'title', 'activity', 'text', 'recommendation', 'sport', 'club']) {
    if (typeof x[k] === 'string' && x[k].trim()) return x[k].trim();
  }
  // No obvious label: the first non-empty string field beats stringifying the
  // object, and an empty string drops the entry rather than showing a brace.
  for (const v of Object.values(x)) if (typeof v === 'string' && v.trim()) return v.trim();
  return '';
}

const strList = (v) => (Array.isArray(v) ? v.map(label).filter(Boolean) : []);

// What the v2.0 block carries that the scored columns do not. Listed rather
// than "everything except the scores" so a new key in §24 arrives deliberately:
// the column is JSONB and would otherwise accept anything the model invented.
//
// The scores are deliberately absent. categories/top_interests/
// developing_interests are computed by services/scoring.js from the answers
// table, and scoring.compare() checks the model's arithmetic against the
// server's rather than storing it.
const PAYLOAD_KEYS = [
  'report_version',
  'interest_connections',
  'learning_preferences',
  'homework_environment',
  'parent_recommendations',
  'teacher_recommendations',
  'academic_development',
  'activity_recommendations',
  'sports_recommendations',
  'tutor_recommendations',
  'reading_program',
  'observation_suggestions',
  'child_encouragement',
  'limitations',
];

function payloadOf(j) {
  if (!j || typeof j !== 'object') return null;
  const out = {};
  for (const k of PAYLOAD_KEYS) if (k in j) out[k] = j[k];
  return Object.keys(out).length ? out : null;
}

// Pull the last ```json block out, and strip it (plus any stray answer marker)
// from the markdown stored and shown to people.
function parseReport(rawText) {
  const text = stripAnswerMarkers(rawText);
  const re = /```json\s*([\s\S]*?)```/gi;
  let m;
  let last = null;
  while ((m = re.exec(text))) last = m;

  let modelJson = null;
  let contentMd = text;

  if (last) {
    try {
      const j = JSON.parse(last[1].trim());
      if (j && typeof j === 'object') modelJson = j;
    } catch (_) { /* a mangled block is simply not a cross-check */ }
    contentMd = (text.slice(0, last.index) + text.slice(last.index + last[0].length)).trim();
  }

  return {
    contentMd,
    // The model's own numbers. scoring.compare() checks them against the
    // server's; nothing downstream reads them as truth.
    modelJson,
    // Recommendations are the model's job — they are prose, not arithmetic —
    // so these do come from the block. v2 renamed both; v1 reports are still in
    // the database and still have to parse, so both spellings are read.
    sports: strList(
      (modelJson && (modelJson.sports_recommendations || modelJson.sports)) || null),
    clubs: strList(
      (modelJson && (modelJson.activity_recommendations || modelJson.clubs)) || null),
    // Everything §24 added. Null for a v1 report, which is what a v1 row should
    // hold rather than an empty object pretending the blocks were considered.
    payload: payloadOf(modelJson),
  };
}

module.exports = {
  LEGACY_LEVELS, normLevel, parseReport,
  parseAnswerMarkers, stripAnswerMarkers,
  // Back-compat alias: sessions.js strips markers from every reply.
  stripMarkers: stripAnswerMarkers,
};
