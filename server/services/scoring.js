'use strict';

// Scoring the 70-question interest inventory.
//
// The arithmetic lives here rather than in the prompt. The model is asked to
// put the same numbers in its JSON block, but a language model averaging
// seventy items across twelve buckets is not something a paid report should
// rest on, and "unanswered must not count as zero" is exactly the rule such a
// model gets wrong. So the server computes, the model's block is a cross-check,
// and a disagreement is a signal rather than a silent wrong number.
//
// What a score is: the mean of the answers a child actually gave in that area.
// What it is NOT: a measure of ability, and nothing here may imply otherwise.

const { SECTIONS, BANDS } = require('../data/questions');

const SECTION_OF = new Map();
for (const s of SECTIONS) for (const [n] of s.items) SECTION_OF.set(n, s.key);

// Enough answers in an area to say anything at all. Below this the area reports
// "ma'lumot yetarli emas" rather than an average built on one tap.
const MIN_ANSWERS_PER_AREA = 2;
// Below this share of the whole inventory the report is marked partial.
const COMPLETE_AT = 0.9;
// How many areas the "current interests" map names.
const TOP_N = 3;

function bandFor(avg) {
  if (avg == null) return null;
  for (const b of BANDS) if (avg <= b.max) return b;
  return BANDS[BANDS.length - 1];
}

const round2 = (n) => Math.round(n * 100) / 100;

// answers: [{ question_n, value }] — skipped questions are simply absent.
function score(answers) {
  const byArea = new Map(SECTIONS.map((s) => [s.key, []]));
  let counted = 0;
  for (const a of answers || []) {
    const n = Number(a.question_n);
    const v = Number(a.value);
    if (!SECTION_OF.has(n) || !(v >= 1 && v <= 5)) continue;
    byArea.get(SECTION_OF.get(n)).push(v);
    counted += 1;
  }

  const categories = {};
  for (const s of SECTIONS) {
    const vals = byArea.get(s.key);
    const enough = vals.length >= MIN_ANSWERS_PER_AREA;
    const average = enough ? round2(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    const band = enough ? bandFor(average) : null;
    categories[s.key] = {
      answered: vals.length,
      of: s.items.length,
      average,
      interest: band ? band.key : null,
      label: band ? band.label : null,
      title: s.title,
    };
  }

  // Ranking. Areas without enough answers are not ranked at all — an area the
  // child never got to must not read as an area they are not interested in.
  const ranked = Object.entries(categories)
    .filter(([, c]) => c.average != null)
    .sort((a, b) => b[1].average - a[1].average || a[0].localeCompare(b[0]));

  // Ties are kept as ties: if the third and fourth areas score the same, both
  // are named. Picking one would invent a preference the answers do not show.
  const top = [];
  for (const [key, c] of ranked) {
    if (top.length < TOP_N || c.average === top[top.length - 1].average) top.push({ key, ...c });
    else break;
  }
  const developing = ranked
    .filter(([, c]) => c.interest === 'low')
    .map(([key, c]) => ({ key, ...c }));

  const total = SECTIONS.reduce((n, s) => n + s.items.length, 0);
  return {
    categories,
    top_interests: top,
    developing_interests: developing,
    answered: counted,
    total,
    coverage: round2(counted / total),
    data_completeness: counted / total >= COMPLETE_AT ? 'complete' : 'partial',
  };
}

// The model is asked for the same object. Where it disagrees with the server's
// arithmetic we keep ours and report the mismatch, so a prompt that drifts
// shows up in the logs instead of in somebody's report.
function compare(serverScored, modelJson) {
  const diffs = [];
  const m = (modelJson && modelJson.categories) || {};
  for (const [key, c] of Object.entries(serverScored.categories)) {
    const mc = m[key];
    if (!mc) { if (c.average != null) diffs.push(key + ': missing from model JSON'); continue; }
    if (Number(mc.answered) !== c.answered) {
      diffs.push(key + ': answered ' + mc.answered + ' vs ' + c.answered);
    }
    const ma = mc.average == null ? null : round2(Number(mc.average));
    if (ma !== c.average) diffs.push(key + ': average ' + ma + ' vs ' + c.average);
  }
  return diffs;
}

module.exports = {
  score, compare, bandFor, SECTION_OF,
  MIN_ANSWERS_PER_AREA, COMPLETE_AT, TOP_N,
};
