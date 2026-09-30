// Funnel tracking end to end: the collector, the server-recorded stages, and
// the admin view that reads them back.
//
// The point of this feature is to tell the centre where visitors leave before
// they enrol, so the two things worth proving are that the numbers are (a)
// real — the steps the server records cannot be faked by a client — and (b)
// countable — reloads and repeated beacons do not inflate them.

const { randomUUID } = require('crypto');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8091';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@markaz.uz';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'secret123';

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  ok  - ' : '  FAIL- ') + n + (x ? '   ' + x : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const j = async (method, path, body, headers) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(headers || {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* 204 */ }
  return { status: res.status, data };
};

const track = (visitorId, stage, extra) =>
  j('POST', '/api/track', { visitor_id: visitorId, stage, ...(extra || {}) });

const { authorize } = require('./auth-helper');

(async () => {
  // ---- the collector ------------------------------------------------------
  const v1 = randomUUID();
  const r = await track(v1, 'landing', { source: 'instagram' });
  ok('the collector answers 204 with no body', r.status === 204, 'status=' + r.status);

  // Malformed input is accepted silently rather than answered with an error:
  // a beacon has nobody to report a problem to, and a probe learns nothing.
  ok('a junk visitor id is not an error', (await track('not-a-uuid', 'landing')).status === 204);
  ok('an unknown stage is not an error', (await track(randomUUID(), 'made_up')).status === 204);
  ok('a forged server stage is not an error', (await track(randomUUID(), 'finished')).status === 204);

  // ---- admin login --------------------------------------------------------
  const loginRes = await fetch(BASE + '/admin/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const cookie = (loginRes.headers.get('set-cookie') || '').split(';')[0];
  const asAdmin = { cookie };

  const unauth = await j('GET', '/admin/funnel');
  ok('the funnel is admin-only', unauth.status === 401, 'status=' + unauth.status);

  const read = async () => (await j('GET', '/admin/funnel?days=30', undefined, asAdmin)).data;
  const countOf = (f, key) => (f.rows.find((x) => x.key === key) || {}).n;

  await sleep(300); // the collector answers before it writes
  let f = await read();
  ok('the funnel returns every stage in order', Array.isArray(f.rows) && f.rows.length === 10);
  ok('  a landed visitor is counted', countOf(f, 'landing') >= 1, 'landing=' + countOf(f, 'landing'));

  const before = countOf(f, 'finished');
  ok('  the forged "finished" was NOT counted', before === 0, 'finished=' + before);

  // ---- reloads must not inflate the count --------------------------------
  const v2 = randomUUID();
  const landedBefore = countOf(f, 'landing');
  for (let i = 0; i < 5; i++) await track(v2, 'landing');
  await sleep(300);
  f = await read();
  ok('five beacons from one visitor count once',
    countOf(f, 'landing') === landedBefore + 1,
    landedBefore + ' -> ' + countOf(f, 'landing'));

  // ---- the server records the stages that matter -------------------------
  // A real run: log in through Telegram, start an assessment, answer once.
  const visitor = randomUUID();
  const asVisitor = { 'x-visitor-id': visitor };
  await track(visitor, 'landing');
  await track(visitor, 'setup');
  await track(visitor, 'login_start');

  // A distinctive name: the other suites authorize with the helper's default
  // ("Test Ota"), and this one has to find its own lead among theirs.
  const parentToken = await authorize(BASE, {
    chatId: 833000444, phone: '+998901239988', headers: asVisitor,
    firstName: 'Voronka', lastName: 'Sinov',
  });
  await sleep(300);
  f = await read();
  ok('the server records the completed login', countOf(f, 'login_done') >= 1, 'login_done=' + countOf(f, 'login_done'));

  const sess = await j('POST', '/api/sessions',
    { consent: true, nickname: 'Anvar', grade: 3 },
    { 'x-parent-token': parentToken, ...asVisitor });
  ok('session start succeeds', sess.status === 201, 'status=' + sess.status);
  const stok = sess.data.session_token;

  await sleep(300);
  f = await read();
  ok('the server records the session start', countOf(f, 'session_start') >= 1, 'session_start=' + countOf(f, 'session_start'));
  ok('  a visitor who never answered is not counted as having answered', countOf(f, 'first_answer') === 0,
    'first_answer=' + countOf(f, 'first_answer'));

  await j('POST', '/api/sessions/' + stok + '/messages', { content: 'Anvar: kvadrat' },
    { 'x-session-token': stok, ...asVisitor });
  await sleep(300);
  f = await read();
  ok('the first real answer is recorded', countOf(f, 'first_answer') === 1, 'first_answer=' + countOf(f, 'first_answer'));

  // A second answer must not count the visitor twice.
  await j('POST', '/api/sessions/' + stok + '/messages', { content: 'yana javob' },
    { 'x-session-token': stok, ...asVisitor });
  await sleep(300);
  f = await read();
  ok('  a second answer does not double-count', countOf(f, 'first_answer') === 1, 'first_answer=' + countOf(f, 'first_answer'));

  await j('POST', '/api/sessions/' + stok + '/report', {}, { 'x-session-token': stok, ...asVisitor });
  await sleep(300);
  f = await read();
  ok('a finished report is recorded — by the server, not the client',
    countOf(f, 'finished') === 1, 'finished=' + countOf(f, 'finished'));

  // ---- conversion ---------------------------------------------------------
  ok('nobody has enrolled yet', countOf(f, 'enrolled') === 0, 'enrolled=' + countOf(f, 'enrolled'));

  const leads = await j('GET', '/admin/leads', undefined, asAdmin);
  const lead = (leads.data.leads || []).find((l) => /Voronka Sinov/.test(l.name));
  ok('the lead is visible to the admin', !!lead, JSON.stringify((leads.data.leads || []).map((l) => l.name)));

  await j('PATCH', '/admin/leads/' + lead.id, { lead_status: 'enrolled' },
    Object.assign({ 'content-type': 'application/json' }, asAdmin));
  f = await read();
  ok('marking the lead enrolled closes the funnel', countOf(f, 'enrolled') === 1, 'enrolled=' + countOf(f, 'enrolled'));
  ok('  and end-to-end conversion is reported', typeof f.conversion_pct === 'number', String(f.conversion_pct));

  // ---- the drop-off answer ------------------------------------------------
  ok('the biggest leak is named', !!f.worst && !!f.worst.from && !!f.worst.to,
    f.worst ? f.worst.from + ' -> ' + f.worst.to : 'none');
  ok('  with a head-count attached', !!f.worst && f.worst.lost > 0, f.worst && String(f.worst.lost));

  // ---- attribution --------------------------------------------------------
  ok('traffic sources are reported', Array.isArray(f.sources) && f.sources.length > 0,
    JSON.stringify(f.sources));
  ok('  the source from the first beacon survived', f.sources.some((s) => s.source === 'instagram'),
    JSON.stringify(f.sources.map((s) => s.source)));

  // ---- window ------------------------------------------------------------
  const wide = await j('GET', '/admin/funnel?days=90', undefined, asAdmin);
  ok('the window is selectable', wide.data.days === 90, String(wide.data.days));
  const bogus = await j('GET', '/admin/funnel?days=9999', undefined, asAdmin);
  ok('  an unsupported window falls back to 30 days', bogus.data.days === 30, String(bogus.data.days));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
