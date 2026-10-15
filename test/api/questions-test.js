// The admin question bank: reading it, editing it, and what an edit does to
// the prompt.
//
// The thread asks for a panel that can edit a question, disable one and tune
// the score thresholds. The part worth testing is not the CRUD but the
// consequence: a bank edit has to reach the prompt, and it has to change the
// prompt version, because an edited bank is a different instrument and a
// sitting scored against the old cached text would be scored against questions
// nobody was asked.
//
//   BASE_URL=http://127.0.0.1:8091 node test/api/questions-test.js

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8091';
const EMAIL = process.env.ADMIN_EMAIL || 'admin@markaz.uz';
const PASSWORD = process.env.ADMIN_PASSWORD || 'secret123';

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  ok  - ' : '  FAIL- ') + n + (x ? '   ' + x : '')); };

let cookie = '';
async function j(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) { data = text; }
  return { status: res.status, data };
}

(async () => {
  const anon = await j('GET', '/admin/questions');
  ok('the bank is admin-only', anon.status === 401, 'status=' + anon.status);

  const login = await j('POST', '/admin/login', { email: EMAIL, password: PASSWORD });
  ok('admin logs in', login.status === 200, 'status=' + login.status);

  const bank = await j('GET', '/admin/questions');
  ok('the bank is returned', bank.status === 200, 'status=' + bank.status);
  ok('  all twelve sections', (bank.data.sections || []).length === 12,
    String((bank.data.sections || []).length));
  ok('  seventy questions', bank.data.total === 70, String(bank.data.total));
  ok('  all of them active to begin with', bank.data.active_count === 70, String(bank.data.active_count));
  ok('  the approved set is marked as such',
    bank.data.sections.every((s) => s.questions.every((q) => q.is_default === true)));
  ok('  the four bands come back', (bank.data.bands || []).length === 4,
    JSON.stringify((bank.data.bands || []).map((b) => b.key)));
  const v0 = bank.data.prompt_version;
  ok('  with the prompt version the bank produces', /^v2-/.test(String(v0)), String(v0));

  // ---- editing a question -------------------------------------------------
  const EDITED = 'Men LEGO yoki konstruktor yig‘ishni juda yaxshi ko‘raman.';
  const edit = await j('PATCH', '/admin/questions/1', { text: EDITED });
  ok('a question can be edited', edit.status === 200 && edit.data.question.text === EDITED,
    JSON.stringify(edit.data).slice(0, 90));
  ok('  and the edit changes the prompt version', edit.data.prompt_version !== v0,
    v0 + ' -> ' + edit.data.prompt_version);

  const after = await j('GET', '/admin/questions');
  const q1 = after.data.sections[0].questions[0];
  ok('  the new text is what the bank now holds', q1.text === EDITED, q1.text);

  // ---- disabling ----------------------------------------------------------
  const off = await j('PATCH', '/admin/questions/70', { active: false });
  ok('a question can be disabled', off.status === 200 && off.data.question.active === false);
  const afterOff = await j('GET', '/admin/questions');
  ok('  it is no longer counted as active', afterOff.data.active_count === 69,
    String(afterOff.data.active_count));
  ok('  but the question itself is kept, not deleted', afterOff.data.total === 70,
    'answers already given to it must not be orphaned');

  const back = await j('PATCH', '/admin/questions/70', { active: true });
  ok('  and it can be put back', back.status === 200 && back.data.question.active === true);

  // ---- bands --------------------------------------------------------------
  const band = await j('PATCH', '/admin/bands/low', { max_value: 2.2, label: 'kamroq qiziqish' });
  ok('a score threshold can be tuned', band.status === 200
    && Number(band.data.band.max_value) === 2.2, JSON.stringify(band.data).slice(0, 80));
  const bad = await j('PATCH', '/admin/bands/low', { max_value: 9 });
  ok('  but not outside the 1-5 scale', bad.status === 400, 'status=' + bad.status);

  // ---- guards -------------------------------------------------------------
  const missing = await j('PATCH', '/admin/questions/999', { text: 'x' });
  ok('an unknown question is a 404, not a silent no-op', missing.status === 404,
    'status=' + missing.status);
  const long = await j('PATCH', '/admin/questions/1', { text: 'x'.repeat(301) });
  ok('an absurdly long question is refused', long.status === 400, 'status=' + long.status);

  // Put question 1 back so a re-run starts from the approved wording.
  await j('PATCH', '/admin/questions/1', { text: 'LEGO yoki konstruktor yig‘ishni yaxshi ko‘raman.' });
  await j('PATCH', '/admin/bands/low', { max_value: 2.49, label: 'hozircha kamroq qiziqish bildirildi' });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
