// How many times a sitting talks to the model: once, for the report.
//
// Starting a sitting used to generate a greeting and wait for it. The question
// screen never displayed that greeting — the app serves the questions from its
// own bank — so the parent watched "Sun'iy intellekt birinchi savollarni
// tayyorlamoqda" for as long as the model took, in front of a database insert.
// Measured against a model that answers in five seconds and queues a second
// request inside the minute, that was 30 seconds per start; on a timeout, a
// full 60. Two sittings back to back meant two of those waits, and the second
// was reliably the slower because the first had just spent the quota. That is
// what "the service sticks if I take the test back to back" was.
//
// The defect is invisible from the outside: a greeting nobody renders looks the
// same as no greeting at all, and a slow start looks like a slow network. Only
// the upstream call count distinguishes them, so that is what this asserts.
//
//   BASE_URL=http://127.0.0.1:8091 STUB_URL=http://127.0.0.1:5602 \
//     node test/api/one-call-test.js
//
// STUB_URL must be the openrouter stub this app is pointed at (it counts the
// completions it is asked for at /__calls).

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8091';
const STUB = process.env.STUB_URL || 'http://127.0.0.1:5602';

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  ok  - ' : '  FAIL- ') + n + (x ? '   ' + x : '')); };

async function j(method, path, body, headers) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(headers || {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null; try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}
const calls = async () => (await (await fetch(STUB + '/__calls')).json()).calls;

const { installAuth } = require('./auth-helper');

(async () => {
  const before = await calls().catch(() => null);
  if (before == null) {
    console.log('  SKIP - no counting stub at ' + STUB + ' (start it with test/stubs/openrouter-stub.js)');
    process.exit(0);
  }
  const parentToken = await installAuth(BASE, { chatId: 814000077, phone: '+998901110077' });
  const parentHeaders = { 'x-parent-token': parentToken };

  // ---- starting a sitting -------------------------------------------------
  const c0 = await calls();
  const t0 = Date.now();
  const s = await j('POST', '/api/sessions',
    { consent: true, nickname: 'Behruz', grade: 3, age: 8 }, parentHeaders);
  const startMs = Date.now() - t0;
  ok('a sitting starts', s.status === 201, 'status=' + s.status + ' ' + JSON.stringify(s.data).slice(0, 120));
  const tok = s.data.session_token;

  ok('starting a sitting makes NO model call', (await calls()) === c0,
    c0 + ' -> ' + (await calls()));
  ok('  so it returns at database speed, not model speed', startMs < 2000, startMs + 'ms');
  ok('  and creates nothing for the parent to read',
    (s.data.messages || []).filter((m) => !m.meta).length === 0);

  // ---- a second sitting, immediately ---------------------------------------
  // The complaint was specifically about back to back. A per-call cost shows up
  // here or nowhere: the second start is the one that used to queue behind the
  // first.
  const c1 = await calls();
  const t1 = Date.now();
  const s2 = await j('POST', '/api/sessions',
    { consent: true, nickname: 'Dilnoza', grade: 2 }, parentHeaders);
  const start2Ms = Date.now() - t1;
  ok('a second sitting starts straight after the first', s2.status === 201, 'status=' + s2.status);
  ok('  also with no model call', (await calls()) === c1, c1 + ' -> ' + (await calls()));
  ok('  also at database speed', start2Ms < 2000, start2Ms + 'ms');

  // ---- answering ----------------------------------------------------------
  // Seventy questions, seventy recorded answers, still no model call: the
  // inventory is a form and the app scores it.
  const h = { 'x-session-token': tok };
  const q = await j('GET', '/api/sessions/' + tok + '/questions', undefined, h);
  ok('the questions come from the bank', q.status === 200 && (q.data.questions || []).length >= 65,
    'n=' + ((q.data.questions || []).length));
  const c2 = await calls();
  const answers = q.data.questions.map((x) => ({ n: x.n, value: ((x.n % 5) + 1) }));
  const a = await j('POST', '/api/sessions/' + tok + '/answers', { answers }, h);
  ok('every answer is recorded', a.status === 200, 'status=' + a.status);
  ok('  answering makes no model call either', (await calls()) === c2,
    c2 + ' -> ' + (await calls()));

  // ---- the report ---------------------------------------------------------
  const c3 = await calls();
  const rep = await j('POST', '/api/sessions/' + tok + '/report', {}, h);
  ok('the report is produced', rep.status === 200 && !!rep.data.share_token, 'status=' + rep.status);
  ok('  and THAT is the one model call', (await calls()) === c3 + 1,
    c3 + ' -> ' + (await calls()));

  // And it is a REPORT, not whatever the model said when asked nothing in
  // particular. The route appends the report request once per sitting; a check
  // that got this wrong still produced a 200 and a share token, and stored an
  // ordinary conversational reply as the thing the parent pays for. A status
  // code cannot tell the two apart, so read the document.
  const pub = await j('GET', '/api/reports/' + rep.data.share_token);
  const md = (pub.data && pub.data.content_md) || '';
  ok('  what was stored is a report, not a chat reply',
    (md.match(/^## /gm) || []).length >= 1 && md.length > 200,
    'headings=' + ((md.match(/^## /gm) || []).length) + ' len=' + md.length
      + ' :: ' + JSON.stringify(md.slice(0, 80)));

  // A re-request returns the stored report rather than paying for another.
  const c4 = await calls();
  const again = await j('POST', '/api/sessions/' + tok + '/report', {}, h);
  ok('asking twice returns the same report', again.status === 200
    && again.data.share_token === rep.data.share_token);
  ok('  without calling the model again', (await calls()) === c4, c4 + ' -> ' + (await calls()));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
