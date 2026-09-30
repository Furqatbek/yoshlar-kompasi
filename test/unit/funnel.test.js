// Drop-off arithmetic (services/funnel.js).
//
// Self-contained: no database, no app. The funnel is the number the centre
// will spend money on, so the maths behind it is worth pinning down —
// especially the cases that are easy to get subtly wrong (a stage that
// out-counts the one before it, an empty window, a tiny sample).

const assert = require('assert');
const funnel = require('../../server/services/funnel');

let pass = 0;
const test = (name, fn) => { fn(); pass++; console.log('  ok  - ' + name); };

const at = (o) => Object.fromEntries(funnel.KEYS.map((k) => [k, o[k] || 0]));
const rowOf = (built, key) => built.rows.find((r) => r.key === key);

// A typical shape: losses everywhere, biggest at the top.
const normal = funnel.build(at({
  landing: 500, setup: 300, login_start: 260, login_done: 120, form_done: 110,
  session_start: 100, first_answer: 80, finished: 60, report_view: 55,
  paid: 20, enrolled: 12,
}));

test('every stage appears, in funnel order', () => {
  assert.deepStrictEqual(normal.rows.map((r) => r.key), funnel.KEYS);
});

test('losses are counted against the previous stage', () => {
  assert.strictEqual(rowOf(normal, 'setup').lost, 200);
  assert.strictEqual(rowOf(normal, 'setup').lost_pct, 40);
  assert.strictEqual(rowOf(normal, 'setup').kept_pct, 60);
});

test('the first stage has no loss to report', () => {
  const first = normal.rows[0];
  assert.strictEqual(first.lost, 0);
  assert.strictEqual(first.lost_pct, null);
});

test('the biggest leak is by head-count', () => {
  // 500 -> 300 loses 200 people; 260 -> 120 loses 140 but a larger share.
  assert.strictEqual(normal.worst.to_key, 'setup');
  assert.strictEqual(normal.worst.lost, 200);
});

test('the steepest drop is reported separately, and is a different step', () => {
  // 260 -> 120 is 54%, the sharpest fall in the journey.
  assert.strictEqual(normal.steepest.to_key, 'login_done');
  assert.strictEqual(normal.steepest.lost_pct, 54);
});

// 55 report views -> 20 sales is 64%, steeper than anything before it, and
// would be the answer in almost every real data set. Reporting either sale
// step as "the problem step" would bury every finding the centre can act on.
test('neither sale step is eligible to be the steepest', () => {
  assert.notStrictEqual(normal.steepest.to_key, 'paid');
  assert.notStrictEqual(normal.steepest.to_key, 'enrolled');
  // They are not hidden — the rows and their losses are still there to read.
  assert.strictEqual(rowOf(normal, 'paid').lost, 35);
  assert.strictEqual(rowOf(normal, 'paid').lost_pct, 64);
  assert.strictEqual(rowOf(normal, 'enrolled').lost, 8);
});

// Payment is the conversion the funnel is built around; course enrolment is
// reported beside it, and both are measured against arrivals so neither
// flatters the other.
test('end-to-end conversion is paid over visitors', () => {
  assert.strictEqual(normal.visitors, 500);
  assert.strictEqual(normal.paid, 20);
  assert.strictEqual(normal.conversion_pct, 4);
  assert.strictEqual(normal.enrolled, 12);
  assert.strictEqual(normal.enrolled_pct, 2.4);
});

// A visitor can open a shared report link without ever seeing the landing
// page, so a later stage genuinely can out-count an earlier one. Inventing a
// negative loss there would report drop-offs that never happened.
test('a later stage out-counting an earlier one is not a negative loss', () => {
  const b = funnel.build(at({ landing: 10, setup: 4, report_view: 40 }));
  assert.strictEqual(rowOf(b, 'report_view').lost, 0);
  assert.ok(rowOf(b, 'report_view').lost >= 0);
});

test('an empty window produces zeroes, not NaN or a crash', () => {
  const b = funnel.build({});
  assert.strictEqual(b.visitors, 0);
  assert.strictEqual(b.conversion_pct, null);
  assert.strictEqual(b.worst, null);
  assert.ok(b.rows.every((r) => r.n === 0 && r.width_pct === 0));
  assert.ok(b.rows.every((r) => !Number.isNaN(r.lost)));
});

// Percentages on a handful of people are noise. 3 -> 1 is three people, not a
// "67% collapse", and must not be presented to the centre as a finding.
test('the steepest drop ignores tiny samples', () => {
  const b = funnel.build(at({ landing: 3, setup: 1, login_start: 1, login_done: 1 }));
  assert.strictEqual(b.steepest, null);
  // The head-count leak is still reported — it is only two people, and it says so.
  assert.strictEqual(b.worst.lost, 2);
});

test('steepest is suppressed when it is the same step as worst', () => {
  const b = funnel.build(at({ landing: 100, setup: 10, login_start: 9 }));
  assert.strictEqual(b.worst.to_key, 'setup');
  assert.strictEqual(b.steepest, null);
});

test('bar widths are relative to the widest stage', () => {
  assert.strictEqual(rowOf(normal, 'landing').width_pct, 100);
  assert.strictEqual(rowOf(normal, 'setup').width_pct, 60);
});

// The trust boundary: only stages the browser alone can witness are POSTable.
test('only client-observable stages are accepted from the browser', () => {
  assert.ok(funnel.isClientStage('landing'));
  assert.ok(funnel.isClientStage('report_view'));
  assert.ok(!funnel.isClientStage('finished'), 'a client must not be able to claim a finished report');
  assert.ok(!funnel.isClientStage('session_start'));
  assert.ok(!funnel.isClientStage('login_done'));
  assert.ok(!funnel.isClientStage('enrolled'));
  assert.ok(!funnel.isClientStage('nonsense'));
});

console.log('\n' + pass + ' passed, 0 failed');
