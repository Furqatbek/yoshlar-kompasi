// Verify the right-to-erasure path + cascade. App on :8093, stub on :5599.
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8091';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@markaz.uz';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'secret123';
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); };
async function j(path, opts) { const r = await fetch(BASE + path, opts); let d = null; try { d = await r.json(); } catch (e) {} return { status: r.status, data: d }; }

(async () => {
  const H = (t) => ({ 'content-type': 'application/json', 'x-session-token': t });
  // full flow to create a lead + report
  let r = await j('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: 'Deletme', grade: 2 }) });
  const sid = r.data.session_id, stok = r.data.session_token;
  await j('/api/sessions/' + stok + '/messages', { method: 'POST', headers: H(stok), body: JSON.stringify({ content: 'a' }) });
  await j('/api/sessions/' + stok + '/contact', { method: 'POST', headers: H(stok), body: JSON.stringify({ parent_name: 'DeleteParent', phone: '977778899', marketing_consent: false }) });
  r = await j('/api/sessions/' + stok + '/report', { method: 'POST', headers: H(stok), body: '{}' });
  const share = r.data.share_token;
  ok('setup: report created', r.status === 200 && !!share);

  // admin login
  const lg = await fetch(BASE + '/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }) });
  const cookie = (lg.headers.get('set-cookie') || '').split(';')[0];

  // find the lead
  r = await j('/admin/leads', { headers: { cookie } });
  const lead = (r.data.leads || []).find((l) => l.name === 'DeleteParent');
  ok('lead present before delete', !!lead);

  // DELETE unauth -> 401
  r = await j('/admin/leads/' + lead.id, { method: 'DELETE' });
  ok('DELETE without cookie -> 401', r.status === 401, 'status=' + r.status);

  // DELETE authed -> 200
  r = await j('/admin/leads/' + lead.id, { method: 'DELETE', headers: { cookie } });
  ok('DELETE /admin/leads/:id -> 200', r.status === 200 && r.data.deleted === true, JSON.stringify(r.data));

  // lead gone from list
  r = await j('/admin/leads', { headers: { cookie } });
  ok('lead removed from list', !(r.data.leads || []).some((l) => l.name === 'DeleteParent'));

  // report gone (cascade) -> public report 404
  r = await j('/api/reports/' + share);
  ok('report cascade-deleted -> 404', r.status === 404, 'status=' + r.status);

  // session gone (cascade) -> resume 404
  r = await j('/api/sessions/' + stok, { headers: { 'x-session-token': stok } });
  ok('session cascade-deleted -> 404', r.status === 404, 'status=' + r.status);

  // DELETE again -> 404 (already gone)
  r = await j('/admin/leads/' + lead.id, { method: 'DELETE', headers: { cookie } });
  ok('DELETE nonexistent -> 404', r.status === 404, 'status=' + r.status);

  console.log('\n==== delete: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('DELETE ERR', e); process.exit(2); });
