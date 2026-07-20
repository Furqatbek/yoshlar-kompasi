// Reproduces the user's "sonnet 4.6 is not valid model id" bug end-to-end and
// proves modelFor() fixes it. App runs in OpenRouter mode; the stub rejects bare
// (slash-less) Anthropic ids like real OpenRouter. We create a session, then
// rewrite its stored model to the Anthropic-native 'claude-sonnet-4-6'
// (simulating a session created before the provider switch), and confirm the
// per-turn and report calls still succeed because the server resolves the model
// to the active provider.
const path = require('path');
const { Client } = require(path.join(__dirname, '..', '..', 'server', 'node_modules', 'pg'));

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8091';
const DB = process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:5459/yik';
let pass = 0, fail = 0;
function ok(name, cond, extra) { (cond ? pass++ : fail++); console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); }
async function j(path, opts) { const res = await fetch(BASE + path, opts); let d = null; try { d = await res.json(); } catch (e) {} return { status: res.status, data: d }; }

(async () => {
  // 1. Create a session under OpenRouter (stamps the valid slug).
  let r = await j('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ consent: true, nickname: 'Stale', grade: 2, age: 7 }) });
  ok('create session -> 201', r.status === 201, 'status=' + r.status);
  const sid = r.data.session_id, stok = r.data.session_token;

  // 2. Simulate a pre-switch session: overwrite model with the Anthropic id.
  const cx = new Client({ connectionString: DB });
  await cx.connect();
  await cx.query('update sessions set model=$1 where id=$2', ['claude-sonnet-4-6', sid]);
  const chk = await cx.query('select model from sessions where id=$1', [sid]);
  ok('stored model is now stale claude-sonnet-4-6', chk.rows[0].model === 'claude-sonnet-4-6', chk.rows[0].model);

  // 3. Sanity: the stub really rejects the bare id (proves the bug is live).
  const direct = await fetch('http://127.0.0.1:5602/api/v1/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }], max_tokens: 10 }),
  });
  ok('stub rejects bare claude-sonnet-4-6 (400) — bug is real', direct.status === 400, 'status=' + direct.status);

  // 4. The actual fix: a per-turn call on the stale session must still succeed,
  //    because modelFor() rewrites the id to the active provider's model.
  r = await j('/api/sessions/' + stok + '/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'Stale: javob' }) });
  ok('POST /messages on stale session -> 200 (fix works)', r.status === 200 && !!r.data.reply, 'status=' + r.status + (r.data && r.data.reply ? '' : ' body=' + JSON.stringify(r.data)));

  // 5. And the report call too (also goes through modelFor).
  await j('/api/sessions/' + stok + '/contact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parent_name: 'P', phone: '901112233' }) });
  r = await j('/api/sessions/' + stok + '/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
  ok('POST /report on stale session -> 200 (fix works)', r.status === 200 && !!r.data.share_token, 'status=' + r.status + (r.data && r.data.share_token ? '' : ' body=' + JSON.stringify(r.data)));

  await cx.end();
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR', e); process.exit(2); });
