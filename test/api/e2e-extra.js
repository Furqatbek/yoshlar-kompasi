// Extra assertions for the review fixes. App on :8091, stub on :5599.
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8091';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@markaz.uz';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'secret123';
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); };
async function j(path, opts) { const r = await fetch(BASE + path, opts); let d = null; try { d = await r.json(); } catch (e) {} return { status: r.status, data: d }; }

(async () => {
  const H = (t) => ({ 'content-type': 'application/json', 'x-session-token': t });

  // Fresh session
  let r = await j('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: 'Retrykid', grade: 1 }) });
  const sid = r.data.session_id, stok = r.data.session_token;

  // send a turn
  r = await j('/api/sessions/' + stok + '/messages', { method: 'POST', headers: H(stok), body: JSON.stringify({ content: 'javob 1' }) });
  ok('message ok', r.status === 200);

  // [15] retry after a SUCCESSFUL turn echoes the same assistant, does not advance turn_count
  const before = r.data.turn_count;
  r = await j('/api/sessions/' + stok + '/messages', { method: 'POST', headers: H(stok), body: JSON.stringify({ retry: true }) });
  ok('[15] retry after success echoes (no new Claude turn)', r.status === 200 && r.data.turn_count === before, 'turn_count ' + before + '->' + r.data.turn_count);

  // [11] contact idempotency: call /contact twice, then check only one parent/child in admin
  await j('/api/sessions/' + stok + '/contact', { method: 'POST', headers: H(stok), body: JSON.stringify({ parent_name: 'Rustam', phone: '911112233', marketing_consent: false }) });
  await j('/api/sessions/' + stok + '/contact', { method: 'POST', headers: H(stok), body: JSON.stringify({ parent_name: 'Rustam Updated', phone: '911112233', marketing_consent: true }) });

  // [2] concurrent report double-submit -> same share_token, no 500
  const [a, b] = await Promise.all([
    j('/api/sessions/' + stok + '/report', { method: 'POST', headers: H(stok), body: '{}' }),
    j('/api/sessions/' + stok + '/report', { method: 'POST', headers: H(stok), body: '{}' }),
  ]);
  ok('[2] concurrent /report: both 200 (no 500)', a.status === 200 && b.status === 200, a.status + '/' + b.status);
  ok('[2] concurrent /report: identical share_token', a.data.share_token && a.data.share_token === b.data.share_token, a.data.share_token + ' vs ' + b.data.share_token);

  // admin login + verify single parent, single child, updated name/marketing
  const lg = await fetch(BASE + '/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }) });
  const cookie = (lg.headers.get('set-cookie') || '').split(';')[0];
  r = await j('/admin/leads', { headers: { cookie } });
  const rus = (r.data.leads || []).filter((l) => /Rustam/.test(l.name));
  ok('[11] contact idempotent: exactly one Rustam parent, one child', rus.length === 1 && rus[0].children_count === 1, JSON.stringify(rus.map((l) => [l.name, l.children_count])));
  ok('[11]+[12] re-contact updated name to latest', rus[0] && rus[0].name === 'Rustam Updated', rus[0] && rus[0].name);

  // cross-device resume: a fresh client with only the URL token can load state
  const nd = await j('/api/sessions/' + stok);
  ok('[v2] resume from any device via token URL', nd.status === 200 && nd.data.child && nd.data.child.nickname === 'Retrykid', 'status=' + nd.status);

  console.log('\n==== extra: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('EXTRA ERR', e); process.exit(2); });
