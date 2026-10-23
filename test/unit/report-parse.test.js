// Reading the model's trailing JSON block, in both versions it exists in.
//
// §24 of the consolidated instructions renamed two keys and added twelve. The
// reports already in the database were written against the old schema and
// their share links are in parents' Telegram history, so both shapes have to
// parse — and neither may be mistaken for the other.
//
// The interesting failure is not a crash. It is `String({...})`, which is
// "[object Object]": v1 sent recommendations as strings, v2 sends them as
// objects with a reason and a starting step, and the old coercion would have
// put that literal text on the report page under "Sport va to'garaklar".

const assert = require('assert');
const path = require('path');

const parse = require(path.join(__dirname, '..', '..', 'server', 'services', 'reportParse'));

let pass = 0;
const test = (name, fn) => { fn(); pass++; console.log('  ok  - ' + name); };

const body = [
  '## Qisqacha xulosa',
  'Ali yasash va tekshirishga qiziqadi.',
  '## Bolaga dalda',
  'Ali, sen savol berishdan qo‘rqmaysan.',
].join('\n');

const withJson = (obj) => body + '\n\n```json\n' + JSON.stringify(obj, null, 2) + '\n```\n';

// ---- v1 -------------------------------------------------------------------

test('a v1 block still reads, and claims no v2 blocks', () => {
  const r = parse.parseReport(withJson({
    categories: { logic_math: { answered: 6, average: 4.5, interest: 'strong' } },
    top_interests: ['logic_math'],
    clubs: ['Shaxmat to‘garagi'],
    sports: ['Suzish'],
    data_completeness: 'complete',
  }));
  assert.deepStrictEqual(r.clubs, ['Shaxmat to‘garagi']);
  assert.deepStrictEqual(r.sports, ['Suzish']);
  assert.strictEqual(r.payload, null,
    'a v1 report never had these sections; an empty object would read as '
    + '"considered, nothing to say"');
});

// ---- v2 -------------------------------------------------------------------

const V2 = {
  report_version: '2.0',
  data_completeness: { status: 'complete', answered_total: 70, total_questions: 70, completion_percentage: 100 },
  categories: { logic_math: { answered: 6, average: 4.5, interest: 'strong', evidence_questions: [[7, 5]], interpretation: 'x', suggested_activities: ['y'] } },
  top_interests: ['logic_math'],
  developing_interests: ['creativity'],
  interest_connections: ['logic_math+technology'],
  learning_preferences: { module_completed: false, reported_preferences: [], interpretation: null },
  homework_environment: { module_completed: false, reported_preferences: [], recommendations: [] },
  parent_recommendations: [{ what: 'Model yasash', why: 'Qo‘l mehnati', how: 'Kartondan', watch: 'Jarayonga' }],
  teacher_recommendations: [{ activity: 'Ikki usulni solishtirish', lesson: 'Matematika', minutes: 3 }],
  academic_development: { mathematics: ['Jumboqlar'], english: [], reading_literacy: [], public_speaking: [], it_digital_literacy: [] },
  activity_recommendations: [{ name: 'Shaxmat to‘garagi', reason: 'Mantiq yuqori' }],
  sports_recommendations: [{ sport: 'Suzish', note: 'Xavfsiz' }],
  tutor_recommendations: [],
  reading_program: { applicable: false, age_range: '8-12', approved_book_list_available: false, recommended_books: [], reading_diary_suggestions: [] },
  observation_suggestions: ['Tabiat kuzatuvi'],
  child_encouragement: 'Sen savol berishni yaxshi ko‘rasan.',
  limitations: ['Bu qobiliyat testi emas.'],
};

test('a v2 block fills the payload', () => {
  const r = parse.parseReport(withJson(V2));
  assert.ok(r.payload, 'v2 must produce a payload');
  assert.strictEqual(r.payload.report_version, '2.0');
  assert.strictEqual(r.payload.reading_program.approved_book_list_available, false,
    'the reading programme must carry that no approved list was supplied');
  assert.deepStrictEqual(r.payload.limitations, ['Bu qobiliyat testi emas.']);
});

test('the renamed arrays are read under their new names', () => {
  const r = parse.parseReport(withJson(V2));
  assert.deepStrictEqual(r.clubs, ['Shaxmat to‘garagi'], 'activity_recommendations');
  assert.deepStrictEqual(r.sports, ['Suzish'], 'sports_recommendations');
});

test('an object recommendation becomes its label, never "[object Object]"', () => {
  const r = parse.parseReport(withJson(V2));
  for (const list of [r.clubs, r.sports]) {
    for (const item of list) {
      assert.strictEqual(typeof item, 'string');
      assert.ok(!item.includes('object Object'), 'a parent would have read this: ' + item);
      assert.ok(!item.startsWith('{'), 'nor this: ' + item);
    }
  }
});

test('an unlabelled object falls back to its first words rather than a brace', () => {
  const r = parse.parseReport(withJson({
    activity_recommendations: [{ izoh: 'Kartondan model yasash' }, { n: 7 }],
  }));
  assert.deepStrictEqual(r.clubs, ['Kartondan model yasash'],
    'the numeric-only entry is dropped rather than rendered');
});

test('the scores are NOT carried in the payload', () => {
  // They are computed by scoring.js from the answers table. Storing the
  // model's arithmetic beside the server's invites reading the wrong one.
  const r = parse.parseReport(withJson(V2));
  for (const k of ['categories', 'top_interests', 'developing_interests', 'data_completeness']) {
    assert.ok(!(k in r.payload), k + ' must not be in the payload');
  }
  // But it is still available for the cross-check.
  assert.ok(r.modelJson.categories, 'scoring.compare() needs the raw block');
});

test('a key §24 does not define is not smuggled into the payload', () => {
  const r = parse.parseReport(withJson({ ...V2, invented_by_the_model: ['nonsense'] }));
  assert.ok(!('invented_by_the_model' in r.payload));
});

// ---- the block itself -----------------------------------------------------

test('the JSON block is stripped from what a parent reads', () => {
  const r = parse.parseReport(withJson(V2));
  assert.ok(!r.contentMd.includes('report_version'), 'the block leaked into the report');
  assert.ok(!r.contentMd.includes('```json'));
  assert.match(r.contentMd, /^## Qisqacha xulosa/);
  assert.match(r.contentMd, /Bolaga dalda/);
});

test('a mangled block costs the cross-check, not the report', () => {
  const r = parse.parseReport(body + '\n\n```json\n{ "report_version": "2.0", oops\n```\n');
  assert.strictEqual(r.modelJson, null);
  assert.strictEqual(r.payload, null);
  assert.match(r.contentMd, /Qisqacha xulosa/, 'the prose is what the parent came for');
});

test('no block at all is a report, not an error', () => {
  const r = parse.parseReport(body);
  assert.strictEqual(r.modelJson, null);
  assert.strictEqual(r.payload, null);
  assert.deepStrictEqual(r.clubs, []);
  assert.deepStrictEqual(r.sports, []);
  assert.strictEqual(r.contentMd.trim(), body);
});

console.log('\n' + pass + ' passed, 0 failed');
