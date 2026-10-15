'use strict';

// Seeds the question bank from server/data/questions.js.
//
// Idempotent and non-destructive: it inserts what is missing and leaves what is
// there alone. An administrator's edit must survive a redeploy, so this never
// overwrites an existing row — the approved wording lives in the module and in
// unit/questions.test.js, not in whatever the table happens to hold.

const { SECTIONS, BANDS } = require('../data/questions');
const { SECTIONS: REPORT_SECTIONS } = require('../data/reportTemplate');

async function seedQuestions(client) {
  let sections = 0, questions = 0, bands = 0;
  for (const s of SECTIONS) {
    const r = await client.query(
      `INSERT INTO question_sections (key, title, position) VALUES ($1,$2,$3)
       ON CONFLICT (key) DO NOTHING`,
      [s.key, s.title, s.n]
    );
    sections += r.rowCount;
    let pos = 0;
    for (const [n, text] of s.items) {
      pos += 1;
      const q = await client.query(
        `INSERT INTO questions (n, section_key, text, position, is_default)
         VALUES ($1,$2,$3,$4,true) ON CONFLICT (n) DO NOTHING`,
        [n, s.key, text, pos]
      );
      questions += q.rowCount;
    }
  }
  let bp = 0;
  for (const b of BANDS) {
    bp += 1;
    const r = await client.query(
      `INSERT INTO score_bands (key, max_value, label, position) VALUES ($1,$2,$3,$4)
       ON CONFLICT (key) DO NOTHING`,
      [b.key, Math.min(b.max, 5), b.label, bp]
    );
    bands += r.rowCount;
  }
  let report = 0;
  for (const r of REPORT_SECTIONS) {
    const res = await client.query(
      `INSERT INTO report_sections (key, heading, instruction, position, free)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (key) DO NOTHING`,
      [r.key, r.heading, r.instruction, r.position, r.free]
    );
    report += res.rowCount;
  }
  return { sections, questions, bands, report };
}

module.exports = { seedQuestions };
