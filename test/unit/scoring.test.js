// Scoring the inventory, and getting answers out of the model's reply.
//
// No database, no app. These are the rules that decide what a parent is told
// their child is interested in, so they are worth pinning on their own — and
// the one that matters most is the easiest to get wrong: a question nobody
// answered must never count as a zero.

const assert = require('assert');
const { score, compare } = require('../../server/services/scoring');
const { parseAnswerMarkers, stripAnswerMarkers } = require('../../server/services/answerMarkers');
const { SECTIONS } = require('../../server/data/questions');

let pass = 0;
const test = (name, fn) => { fn(); pass++; console.log('  ok  - ' + name); };

// Answer a whole section with one value.
const fill = (key, value) => {
  const s = SECTIONS.find((x) => x.key === key);
  return s.items.map(([n]) => ({ question_n: n, value }));
};
const all = (value) => SECTIONS.flatMap((s) => s.items.map(([n]) => ({ question_n: n, value })));

// ---- the rule everything else depends on ---------------------------------

test('a skipped question does not count as a zero', () => {
  // Two answers of 5, four questions skipped. The mean is 5, not 5*2/6.
  const r = score([{ question_n: 1, value: 5 }, { question_n: 2, value: 5 }]);
  assert.strictEqual(r.categories.construction_engineering.average, 5);
  assert.strictEqual(r.categories.construction_engineering.answered, 2);
  assert.strictEqual(r.categories.construction_engineering.of, 6);
});

test('an area with no answers reports no average at all', () => {
  const r = score(fill('logic_math', 4));
  assert.strictEqual(r.categories.creativity.average, null);
  assert.strictEqual(r.categories.creativity.interest, null);
  assert.strictEqual(r.categories.creativity.answered, 0);
});

test('one lone answer is not enough to score an area', () => {
  const r = score([{ question_n: 19, value: 5 }]);
  assert.strictEqual(r.categories.creativity.average, null,
    'a single tap must not become "kuchli qiziqish"');
});

// ---- bands ----------------------------------------------------------------

test('the bands land where the spec puts them', () => {
  const band = (v) => score(fill('logic_math', v)).categories.logic_math.interest;
  assert.strictEqual(band(1), 'low');
  assert.strictEqual(band(2), 'low');       // 2.00 -> 1.00-2.49
  assert.strictEqual(band(3), 'mixed');     // 3.00 -> 2.50-3.49
  assert.strictEqual(band(4), 'notable');   // 4.00 -> 3.50-4.19
  assert.strictEqual(band(5), 'strong');    // 5.00 -> 4.20-5.00
});

test('a perfect 5.00 is inside the top band, not past it', () => {
  const r = score(all(5));
  for (const c of Object.values(r.categories)) assert.strictEqual(c.interest, 'strong', JSON.stringify(c));
});

test('boundary values fall on the documented side', () => {
  // 2.5 exactly -> "mixed", not "low": the low band ends at 2.49.
  const r = score([
    { question_n: 7, value: 2 }, { question_n: 8, value: 3 },
  ]);
  assert.strictEqual(r.categories.logic_math.average, 2.5);
  assert.strictEqual(r.categories.logic_math.interest, 'mixed');
});

// ---- ranking ---------------------------------------------------------------

test('the top interests are the highest-scoring areas', () => {
  const r = score([...fill('technology', 5), ...fill('creativity', 4), ...fill('organization', 1)]);
  assert.strictEqual(r.top_interests[0].key, 'technology');
  assert.strictEqual(r.top_interests[1].key, 'creativity');
});

test('a tie stays a tie rather than being broken arbitrarily', () => {
  // Four areas, all 5.00. Naming only three would invent a preference.
  const r = score([
    ...fill('technology', 5), ...fill('creativity', 5),
    ...fill('leadership', 5), ...fill('curiosity', 5),
  ]);
  assert.strictEqual(r.top_interests.length, 4, JSON.stringify(r.top_interests.map((t) => t.key)));
  for (const t of r.top_interests) assert.strictEqual(t.average, 5);
});

test('an unanswered area is never ranked as a low interest', () => {
  const r = score(fill('technology', 5));
  const keys = r.developing_interests.map((d) => d.key);
  assert.ok(!keys.includes('creativity'),
    'an area the child never reached must not read as one they dislike');
  assert.deepStrictEqual(keys, []);
});

test('low-scoring answered areas are reported as developing', () => {
  const r = score([...fill('technology', 5), ...fill('organization', 1)]);
  assert.deepStrictEqual(r.developing_interests.map((d) => d.key), ['organization']);
});

// ---- completeness ----------------------------------------------------------

test('a full sitting is complete', () => {
  const r = score(all(4));
  assert.strictEqual(r.answered, 70);
  assert.strictEqual(r.data_completeness, 'complete');
  assert.strictEqual(r.coverage, 1);
});

test('a half-finished sitting is partial, and says how far it got', () => {
  const r = score(all(4).slice(0, 35));
  assert.strictEqual(r.answered, 35);
  assert.strictEqual(r.coverage, 0.5);
  assert.strictEqual(r.data_completeness, 'partial');
});

test('nothing answered at all does not crash and claims nothing', () => {
  const r = score([]);
  assert.strictEqual(r.answered, 0);
  assert.strictEqual(r.data_completeness, 'partial');
  assert.deepStrictEqual(r.top_interests, []);
  for (const c of Object.values(r.categories)) assert.strictEqual(c.average, null);
});

test('junk answers are ignored rather than scored', () => {
  const r = score([
    { question_n: 999, value: 5 }, { question_n: 1, value: 9 },
    { question_n: 2, value: 0 }, { question_n: 3, value: null },
    { question_n: 4, value: 4 }, { question_n: 5, value: 4 },
  ]);
  assert.strictEqual(r.answered, 2);
  assert.strictEqual(r.categories.construction_engineering.average, 4);
});

// ---- the model's own JSON is a cross-check, not the source ----------------

test('a model that does the arithmetic wrong is caught, not believed', () => {
  const r = score(fill('logic_math', 4));
  const diffs = compare(r, { categories: { logic_math: { answered: 6, average: 4.9 } } });
  assert.ok(diffs.some((d) => d.includes('logic_math') && d.includes('4.9')), JSON.stringify(diffs));
});

test('a model that agrees produces no noise', () => {
  const r = score(fill('logic_math', 4));
  const model = { categories: {} };
  for (const [k, c] of Object.entries(r.categories)) {
    model.categories[k] = { answered: c.answered, average: c.average };
  }
  assert.deepStrictEqual(compare(r, model), []);
});

// ---- answer markers --------------------------------------------------------

test('answers are read out of the marker line', () => {
  const { answers, skipped } = parseAnswerMarkers('Rahmat!\n\n[JAVOBLAR: 1=4, 2=5, 3=x, 4=2]');
  assert.deepStrictEqual(answers, [
    { question_n: 1, value: 4 }, { question_n: 2, value: 5 }, { question_n: 4, value: 2 },
  ]);
  assert.deepStrictEqual(skipped, [3]);
});

test('the marker never reaches the reader', () => {
  const out = stripAnswerMarkers('Yaxshi.\n\n[JAVOBLAR: 1=4, 2=5]\n');
  assert.strictEqual(out, 'Yaxshi.');
  assert.ok(!out.includes('JAVOBLAR'));
});

test('a malformed pair is dropped, not guessed', () => {
  const { answers } = parseAnswerMarkers('[JAVOBLAR: 1=7, 2=, =3, abc, 71=4, 5=3]');
  assert.deepStrictEqual(answers, [{ question_n: 5, value: 3 }],
    'out-of-range values and numbers must not be coerced into something plausible');
});

test('a repeated question keeps the first answer in the batch', () => {
  const { answers } = parseAnswerMarkers('[JAVOBLAR: 9=5, 9=1]');
  assert.deepStrictEqual(answers, [{ question_n: 9, value: 5 }]);
});

test('no marker is not an error', () => {
  assert.deepStrictEqual(parseAnswerMarkers('Oddiy javob'), { answers: [], skipped: [] });
  assert.strictEqual(stripAnswerMarkers('Oddiy javob'), 'Oddiy javob');
});

console.log('\n' + pass + ' passed, 0 failed');
