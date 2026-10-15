'use strict';

// How a 1-5 answer gets from the chat into the database.
//
// The adult types answers as prose ("1 - 4, 2 - 5, uchinchisini bilmadi"), so
// something has to turn that into rows. The model is the only thing in the
// loop that knows which question each number belongs to, so after recording a
// batch it emits one machine-readable line:
//
//   [JAVOBLAR: 1=4, 2=5, 3=x, 4=2, 5=4, 6=3]
//
// where x means skipped. The line is stripped before the text reaches anyone,
// exactly as the old [YAKUN:] track markers were.
//
// The model reports WHAT WAS ANSWERED. It does not do the arithmetic — that is
// services/scoring.js, on the server, from these rows.

const MARKER_RE = /\[JAVOBLAR:\s*([^\]]*)\]/gi;

// Returns { answers: [{ question_n, value }], skipped: [n] }.
// Anything malformed is dropped rather than guessed: a wrong number here is a
// wrong number in somebody's report, and a missing answer is recoverable
// (the adult is still in the conversation) while a fabricated one is not.
function parseAnswerMarkers(text) {
  const answers = [];
  const skipped = [];
  const seen = new Set();
  const src = String(text == null ? '' : text);
  let m;
  MARKER_RE.lastIndex = 0;
  while ((m = MARKER_RE.exec(src))) {
    for (const pair of m[1].split(',')) {
      const p = /^\s*(\d{1,2})\s*=\s*([1-5]|x|X|-)\s*$/.exec(pair);
      if (!p) continue;
      const n = Number(p[1]);
      if (!(n >= 1 && n <= 70) || seen.has(n)) continue;
      seen.add(n);
      if (/^[1-5]$/.test(p[2])) answers.push({ question_n: n, value: Number(p[2]) });
      else skipped.push(n);
    }
  }
  return { answers, skipped };
}

function stripAnswerMarkers(text) {
  return String(text == null ? '' : text)
    .split('\n')
    .filter((l) => !/^\s*\[JAVOBLAR:[^\]]*\]\s*$/i.test(l))
    .join('\n')
    .replace(MARKER_RE, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

module.exports = { parseAnswerMarkers, stripAnswerMarkers };
