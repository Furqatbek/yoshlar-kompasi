// End-to-end flow driver. Assumes app on :8091 and stub-claude on :5599.
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8091';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@markaz.uz';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'secret123';
let pass = 0, fail = 0;
function ok(name, cond, extra) { (cond ? pass++ : fail++); console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); }

async function j(path, opts) {
  const res = await fetch(BASE + path, opts);
  let data = null; try { data = await res.json(); } catch (e) {}
  return { status: res.status, data, headers: res.headers };
}

(async () => {
  // 0. Adult consent is enforced server-side, not only in the UI.
  let r0 = await j('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: 'NoConsent', grade: 2 }) });
  ok('POST /api/sessions without consent -> 400 consent_required', r0.status === 400 && r0.data && r0.data.code === 'consent_required', 'status=' + r0.status + ' ' + JSON.stringify(r0.data));

  // 1. Create session
  let r = await j('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ consent: true, nickname: 'Ali', grade: 2, age: 7, goal: 'matematika' }) });
  ok('POST /api/sessions -> 201', r.status === 201, 'status=' + r.status);
  const sid = r.data.session_id, stok = r.data.session_token;
  ok('  returns session_id + token', !!sid && !!stok);
  const visible = (r.data.messages || []).filter((m) => !m.meta);
  ok('  greeting returned (non-meta assistant msg)', visible.some((m) => m.role === 'assistant'));
  ok('  intro user turn is meta (hidden)', (r.data.messages || []).some((m) => m.role === 'user' && m.meta));
  ok('  progress all tracks done (stub emits markers)', r.data.done === true, JSON.stringify(r.data.progress));

  const auth = { 'content-type': 'application/json', 'x-session-token': stok };

  // 2. Auth negative: wrong token -> 401
  r = await j('/api/sessions/badtoken-does-not-exist/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'salom' }) });
  ok('POST messages bad token in path -> 404', r.status === 404, 'status=' + r.status);

  // 3. Send a real turn
  r = await j('/api/sessions/' + stok + '/messages', { method: 'POST', headers: auth, body: JSON.stringify({ content: 'Ali: kvadrat, 5 ta' }) });
  ok('POST messages -> 200 with reply', r.status === 200 && !!r.data.reply, 'status=' + r.status);

  // 4. Over-long message -> 400
  r = await j('/api/sessions/' + stok + '/messages', { method: 'POST', headers: auth, body: JSON.stringify({ content: 'x'.repeat(3000) }) });
  ok('POST messages 3000 chars -> 400', r.status === 400, 'status=' + r.status);

  // 5. Resume
  r = await j('/api/sessions/' + stok, { headers: { 'x-session-token': stok } });
  ok('GET /api/sessions/:id -> 200', r.status === 200);
  ok('  child nickname persisted', r.data.child && r.data.child.nickname === 'Ali');

  // 6. Contact gate (dedupe test uses this phone twice)
  r = await j('/api/sessions/' + stok + '/contact', { method: 'POST', headers: auth, body: JSON.stringify({ parent_name: 'Nilufar', phone: '90 123-45-67', marketing_consent: true }) });
  ok('POST /contact -> 200', r.status === 200 && r.data.ok === true, 'status=' + r.status);

  // 7. Bad phone -> 400
  r = await j('/api/sessions/' + stok + '/contact', { method: 'POST', headers: auth, body: JSON.stringify({ parent_name: 'X', phone: '123' }) });
  ok('POST /contact bad phone -> 400', r.status === 400, 'status=' + r.status);

  // 8. Generate report
  r = await j('/api/sessions/' + stok + '/report', { method: 'POST', headers: auth, body: JSON.stringify({}) });
  ok('POST /report -> 200 with share_token', r.status === 200 && !!r.data.share_token, 'status=' + r.status);
  const share = r.data.share_token;
  ok('  delivered via console provider', r.data.delivered === true, 'delivered=' + r.data.delivered);
  ok('  report_url is absolute /hisobot/', /\/hisobot\//.test(r.data.report_url || ''));

  // 9. One report per session (idempotent)
  r = await j('/api/sessions/' + stok + '/report', { method: 'POST', headers: auth, body: JSON.stringify({}) });
  ok('POST /report again -> same share_token', r.status === 200 && r.data.share_token === share, r.data.share_token === share ? '' : 'GOT ' + r.data.share_token);

  // 10. Public report (no auth)
  r = await j('/api/reports/' + share);
  ok('GET /api/reports/:token -> 200 (public)', r.status === 200);
  ok('  structured levels parsed', r.data.levels && r.data.levels.logic === 'kuchli' && r.data.levels.activity === 'shakllanmoqda', JSON.stringify(r.data.levels));
  ok('  sports parsed', Array.isArray(r.data.sports) && r.data.sports.length === 2, JSON.stringify(r.data.sports));
  ok('  json block stripped from content_md', !/```json/.test(r.data.content_md || ''));
  ok('  markers stripped from content_md', !/YAKUN/.test(r.data.content_md || ''));
  ok('  nickname on report', r.data.nickname === 'Ali');

  // 11. Session now finished -> further messages 403
  r = await j('/api/sessions/' + stok + '/messages', { method: 'POST', headers: auth, body: JSON.stringify({ content: 'yana' }) });
  ok('POST messages after finish -> 403', r.status === 403, 'status=' + r.status);

  // 12. Admin: unauth
  r = await j('/admin/leads');
  ok('GET /admin/leads unauth -> 401', r.status === 401);

  // 13. Admin login (bad)
  r = await j('/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: ADMIN_EMAIL, password: 'wrong' }) });
  ok('POST /admin/login wrong pw -> 401', r.status === 401);

  // 14. Admin login (good) — capture cookie
  const loginRes = await fetch(BASE + '/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }) });
  const setCookie = loginRes.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];
  ok('POST /admin/login -> 200 + cookie', loginRes.status === 200 && /yik_admin=/.test(setCookie), 'status=' + loginRes.status);
  const cookieH = { cookie };

  // 15. Admin leads
  r = await j('/admin/leads', { headers: cookieH });
  ok('GET /admin/leads -> 200', r.status === 200);
  ok('  one lead (Nilufar) present', (r.data.leads || []).some((l) => l.name === 'Nilufar'), JSON.stringify((r.data.leads || []).map((l) => l.name)));
  const lead = (r.data.leads || []).find((l) => l.name === 'Nilufar');
  ok('  lead phone formatted', lead && /\+998 90 123-45-67/.test(lead.phone || ''), lead && lead.phone);
  ok('  lead status label', lead && lead.lead_status_label === 'Yangi');

  // 16. Lead detail
  r = await j('/admin/leads/' + lead.id, { headers: cookieH });
  ok('GET /admin/leads/:id -> 200', r.status === 200);
  ok('  child + report link present', r.data.children && r.data.children[0] && r.data.children[0].sessions[0] && r.data.children[0].sessions[0].share_token === share);

  // 17. Patch lead
  r = await j('/admin/leads/' + lead.id, { method: 'PATCH', headers: Object.assign({ 'content-type': 'application/json' }, cookieH), body: JSON.stringify({ lead_status: 'enrolled', admin_notes: 'Yozildi' }) });
  ok('PATCH /admin/leads/:id -> 200', r.status === 200 && r.data.lead_status === 'enrolled', JSON.stringify(r.data));

  // 18. Stats
  r = await j('/admin/stats', { headers: cookieH });
  ok('GET /admin/stats -> 200', r.status === 200 && Array.isArray(r.data.buckets) && r.data.buckets.length === 4);
  ok('  this-week started>=1, finished>=1, contact>=1, delivered>=1', r.data.buckets[0].started >= 1 && r.data.buckets[0].finished >= 1 && r.data.buckets[0].contact >= 1 && r.data.buckets[0].delivered >= 1, JSON.stringify(r.data.buckets[0]));

  // 19. CSV export
  const csvRes = await fetch(BASE + '/admin/export/leads.csv', { headers: cookieH });
  const csv = await csvRes.text();
  ok('GET /admin/export/leads.csv -> 200 csv', csvRes.status === 200 && /Ota-ona/.test(csv) && /Nilufar/.test(csv));

  // 20. Parent dedupe: a second child with same phone attaches to same parent
  let r2 = await j('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ consent: true, nickname: 'Zuhra', grade: 3 }) });
  const sid2 = r2.data.session_id, stok2 = r2.data.session_token;
  await j('/api/sessions/' + stok2 + '/contact', { method: 'POST', headers: { 'content-type': 'application/json', 'x-session-token': stok2 }, body: JSON.stringify({ parent_name: 'Nilufar X', phone: '901234567', marketing_consent: false }) });
  r = await j('/admin/leads', { headers: cookieH });
  const nilufars = (r.data.leads || []).filter((l) => /Nilufar/.test(l.name));
  ok('parent dedupe by phone (still one Nilufar record, 2 children)', nilufars.length === 1 && nilufars[0].children_count === 2, JSON.stringify(nilufars.map((l) => [l.name, l.children_count])));

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR', e); process.exit(2); });
