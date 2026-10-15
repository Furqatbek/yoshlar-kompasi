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

const strList = (v) => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : []);

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
    // so these do come from the block.
    sports: strList(modelJson && modelJson.sports),
    clubs: strList(modelJson && modelJson.clubs),
  };
}

module.exports = {
  LEGACY_LEVELS, normLevel, parseReport,
  parseAnswerMarkers, stripAnswerMarkers,
  // Back-compat alias: sessions.js strips markers from every reply.
  stripMarkers: stripAnswerMarkers,
};
