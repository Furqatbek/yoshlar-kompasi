// Verifies the report engagement gate: a report cannot be generated with zero
// real answers (the "finished without writing answers" bug), but CAN once the
// child has actually answered. Runs against the realistic stub (markerless
// greeting) so a fresh session genuinely has 0 completed directions.
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8091';
let pass = 0, fail = 0;
function ok(name, cond, extra) { (cond ? pass++ : fail++); console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); }
async function j(path, opts) { const res = await fetch(BASE + path, opts); let d = null; try { d = await res.json(); } catch (e) {} return { status: res.status, data: d }; }
const H = { 'content-type': 'application/json' };

(async () => {
  // 1. Create session. The DEFAULT stub emits [YAKUN] markers on the greeting,
  //    so all tracks read "done" while there are STILL zero real answers — the
  //    exact model-controlled bypass the gate must resist.
  let r = await j('/api/sessions', { method: 'POST', headers: H, body: JSON.stringify({ consent: true, nickname: 'Ali', grade: 2, age: 7 }) });
  ok('create session -> 201', r.status === 201, 'status=' + r.status);
  const stok = r.data.session_token;
  ok('  tracks marked done by greeting, but 0 real answers', r.data.done === true, JSON.stringify(r.data.progress));

  // 2. Report WITHOUT any answers -> blocked, EVEN THOUGH tracks are "done"
  //    (proves the anyTrackDone bypass is closed).
  r = await j('/api/sessions/' + stok + '/report', { method: 'POST', headers: H, body: JSON.stringify({}) });
  ok('report with 0 answers -> 400 (bypass closed)', r.status === 400, 'status=' + r.status);
  ok('  code = insufficient_engagement', r.data && r.data.code === 'insufficient_engagement', JSON.stringify(r.data));

  // 3. Confirm no report leaked into the session.
  r = await j('/api/sessions/' + stok, { headers: H });
  ok('  session has no report after block', r.data && r.data.report === null, JSON.stringify(r.data && r.data.report));

  // 4. Answer a real turn.
  r = await j('/api/sessions/' + stok + '/messages', { method: 'POST', headers: H, body: JSON.stringify({ content: 'Ali: kvadrat' }) });
  ok('post a real answer -> 200', r.status === 200 && !!r.data.reply, 'status=' + r.status);

  // 5. Now a report IS allowed.
  r = await j('/api/sessions/' + stok + '/contact', { method: 'POST', headers: H, body: JSON.stringify({ parent_name: 'Nilufar', phone: '901112233' }) });
  ok('contact -> 200', r.status === 200);
  r = await j('/api/sessions/' + stok + '/report', { method: 'POST', headers: H, body: JSON.stringify({}) });
  ok('report after answering -> 200 with share_token', r.status === 200 && !!r.data.share_token, 'status=' + r.status + ' ' + JSON.stringify(r.data));
  ok('  partial flag is a boolean (stub completed tracks -> false)', r.data && typeof r.data.partial === 'boolean', JSON.stringify(r.data && r.data.partial));

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR', e); process.exit(2); });
