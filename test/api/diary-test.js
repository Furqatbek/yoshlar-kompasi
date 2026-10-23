// The reading diary (§19).
//
// Two things are worth proving here, and neither is "the CRUD works".
//
// One: a diary holds a child's own words — what they liked, what they did not
// understand, what they thought. One parent reading another's is the worst
// failure this table can have, and it is a failure that looks like a working
// feature from the inside.
//
// Two: "Bola o‘qimagan kitobni tugatilgan deb belgilamang." A database cannot
// know whether a child read a book, but it can refuse the shape of the claim —
// finished requires a date somebody entered, and it cannot be reached by
// leaving a field out. Downstream, that is the ONLY thing allowed to tell the
// report a book was read.

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8091';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  (cond ? pass++ : fail++);
  console.log((cond ? '  ok  - ' : '  FAIL- ') + name + (extra ? '   ' + extra : ''));
}

async function j(method, path, body, headers) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(headers || {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* no body */ }
  return { status: res.status, data };
}

const { authorize } = require('./auth-helper');

// Two separate parents, each with their own child, so the isolation below is
// a real question rather than one account talking to itself.
async function parentWithChild(chatId, nickname) {
  const token = await authorize(BASE, { chatId, firstName: nickname });
  const H = { 'x-parent-token': token };
  const s = await fetch(BASE + '/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...H },
    body: JSON.stringify({ consent: true, nickname, grade: 2, age: 9 }),
  });
  const session = await s.json();
  const diary = await j('GET', '/api/diary', undefined, H);
  return { token, H, session, child: diary.data.children[0] };
}

(async () => {
  const a = await parentWithChild(855000101, 'Olma');
  const b = await parentWithChild(855000102, 'Anor');

  ok('a parent sees their own child', !!a.child && a.child.nickname === 'Olma',
    JSON.stringify(a.child));
  ok('  with no entries to begin with', Number(a.child.entries) === 0,
    String(a.child.entries));

  const noAuth = await j('GET', '/api/diary');
  ok('the diary needs a parent login', noAuth.status === 401, 'status=' + noAuth.status);

  // ---- §19's rule --------------------------------------------------------
  const started = await j('POST', '/api/diary', {
    child_id: a.child.id, title: 'Sinov kitobi', author: 'Muallif',
    started_on: '2026-10-01',
  }, a.H);
  ok('a book can be started', started.status === 201 && started.data.entry.status === 'reading',
    JSON.stringify(started.data.entry && { status: started.data.entry.status }));
  ok('  and starting one does not mark it finished',
    started.data.entry.finished_on === null,
    'the default must be reading; finished has to be an act');

  const noDate = await j('POST', '/api/diary', {
    child_id: a.child.id, title: 'Sinov kitobi', status: 'finished',
  }, a.H);
  ok('finished without a date is refused',
    noDate.status === 400 && noDate.data.code === 'finished_needs_date',
    JSON.stringify(noDate.data));

  const backwards = await j('POST', '/api/diary', {
    child_id: a.child.id, title: 'Sinov kitobi', status: 'finished',
    started_on: '2026-10-01', finished_on: '2026-09-01',
  }, a.H);
  ok('  as is finishing it before it was started', backwards.status === 400,
    'this would be read back to a parent as fact');

  const finished = await j('POST', '/api/diary', {
    child_id: a.child.id, title: 'Sinov kitobi', status: 'finished',
    started_on: '2026-10-01', finished_on: '2026-10-20',
    favourite_character: 'Kichkina sayyoh', opinion: 'Oxiri menga yoqdi',
  }, a.H);
  ok('with a date it is accepted', finished.status === 201
    && finished.data.entry.status === 'finished', JSON.stringify(finished.data.entry && {
    status: finished.data.entry.status, finished_on: finished.data.entry.finished_on }));

  const list = await j('GET', '/api/diary', undefined, a.H);
  ok('  and the same book is one row, not two',
    list.data.entries.length === 1, String(list.data.entries.length));
  ok('  with the fields the child gave',
    list.data.entries[0].favourite_character === 'Kichkina sayyoh',
    JSON.stringify(list.data.entries[0].favourite_character));
  ok('  and nothing invented for the ones they did not',
    list.data.entries[0].unclear_part === null && list.data.entries[0].next_choice === null,
    '§19: a blank means the child did not say');

  // Going back to "reading" must clear the date, or the next edit resurrects it.
  const reopened = await j('POST', '/api/diary', {
    child_id: a.child.id, title: 'Sinov kitobi', status: 'reading',
  }, a.H);
  ok('putting a book back down clears the finish date',
    reopened.data.entry.status === 'reading' && reopened.data.entry.finished_on === null,
    JSON.stringify({ s: reopened.data.entry.status, f: reopened.data.entry.finished_on }));

  // ---- THE assertion: one parent cannot reach another's ------------------
  await j('POST', '/api/diary', {
    child_id: b.child.id, title: 'Anorning kitobi', status: 'reading',
  }, b.H);

  const aSeesOwn = await j('GET', '/api/diary', undefined, a.H);
  ok('a parent sees only their own entries',
    aSeesOwn.data.entries.every((e) => e.title !== 'Anorning kitobi'),
    JSON.stringify(aSeesOwn.data.entries.map((e) => e.title)));
  ok('  and only their own children',
    aSeesOwn.data.children.every((c) => c.id !== b.child.id),
    JSON.stringify(aSeesOwn.data.children.map((c) => c.nickname)));

  const crossWrite = await j('POST', '/api/diary', {
    child_id: b.child.id, title: 'Begona yozuv', status: 'reading',
  }, a.H);
  ok('writing into another parent’s child is refused', crossWrite.status === 404,
    'status=' + crossWrite.status);

  const bEntries = await j('GET', '/api/diary', undefined, b.H);
  ok('  and really did not land', bEntries.data.entries.every((e) => e.title !== 'Begona yozuv'),
    JSON.stringify(bEntries.data.entries.map((e) => e.title)));

  const crossDelete = await j('DELETE', '/api/diary/' + bEntries.data.entries[0].id, undefined, a.H);
  ok('deleting another parent’s entry is refused', crossDelete.status === 404,
    'status=' + crossDelete.status);
  const bStill = await j('GET', '/api/diary', undefined, b.H);
  ok('  and it is still there', bStill.data.entries.length === 1,
    String(bStill.data.entries.length));

  // ---- what reaches the report -------------------------------------------
  // Finish the book again so there is something to report, then run a sitting
  // for that child and read what the model was told.
  await j('POST', '/api/diary', {
    child_id: a.child.id, title: 'Sinov kitobi', status: 'finished',
    started_on: '2026-10-01', finished_on: '2026-10-20',
  }, a.H);
  await j('POST', '/api/diary', {
    child_id: a.child.id, title: 'Hali o‘qilyapti', status: 'reading',
  }, a.H);

  const tok = a.session.session_token;
  const sAuth = { 'x-session-token': tok };
  const inv = await j('GET', '/api/sessions/' + tok + '/questions', undefined, sAuth);
  await j('POST', '/api/sessions/' + tok + '/answers',
    { answers: inv.data.questions.map((q) => ({ n: q.n, value: 4 })) }, sAuth);
  await j('POST', '/api/sessions/' + tok + '/report', {}, sAuth);

  const view = await j('GET', '/api/sessions/' + tok, undefined, sAuth);
  const request = String(((view.data.messages || []).find(
    (m) => m.role === 'user' && m.meta && String(m.content).includes('[HISOBOT-SOROVI]')) || {}).content || '');

  ok('a finished book reaches the report', request.includes('Sinov kitobi'),
    'the reading section should build on what the child has read');
  ok('  and a book still being read does not',
    !request.includes('Hali o‘qilyapti'),
    'only the diary may say a book was finished, and it says this one was not');
  ok('  with the diary named as the source',
    /kundalikdan/.test(request),
    'the model must not treat this as something it inferred');
  ok('  and told not to recommend it again',
    /qayta tavsiya qilmang/.test(request));

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
