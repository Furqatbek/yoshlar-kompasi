// The two catalogues, and the one thing they are for.
//
// §17 and §16 both forbid inventing a book title, an author, a tutor, a price
// or a review. The failure they guard against is not an error: a model asked
// to recommend a book for an eight-year-old will produce a plausible Uzbek
// title and a plausible author, a parent will go looking for it, and nothing
// anywhere will have logged a problem.
//
// So the model is only ever shown rows somebody approved. This file proves the
// three states that matters in: empty (say so), imported-but-unchecked (still
// say so), and approved (use it, and nothing else).

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8091';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@markaz.uz';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'secret123';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  (cond ? pass++ : fail++);
  console.log((cond ? '  ok  - ' : '  FAIL- ') + name + (extra ? '   ' + extra : ''));
}

let cookie = '';
async function j(method, path, body, headers) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(headers || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  let data = null;
  try { data = await res.json(); } catch (_) { /* no body */ }
  return { status: res.status, data };
}

// The scores and briefs the model is sent live in the report request, stored as
// a hidden user turn. Reading it back is how we see what the model saw.
async function requestFor(token) {
  const v = await j('GET', '/api/sessions/' + token, undefined, { 'x-session-token': token });
  const turn = (v.data.messages || []).find(
    (m) => m.role === 'user' && m.meta && String(m.content).includes('[HISOBOT-SOROVI]'));
  return String((turn && turn.content) || '');
}

const { installAuth } = require('./auth-helper');

async function sittingWithReport(nickname, age) {
  const r = await j('POST', '/api/sessions', { consent: true, nickname, grade: 2, age });
  const tok = r.data.session_token;
  const auth = { 'x-session-token': tok };
  const inv = await j('GET', '/api/sessions/' + tok + '/questions', undefined, auth);
  await j('POST', '/api/sessions/' + tok + '/answers',
    { answers: inv.data.questions.map((q) => ({ n: q.n, value: 4 })) }, auth);
  await j('POST', '/api/sessions/' + tok + '/report', {}, auth);
  return requestFor(tok);
}

(async () => {
  await installAuth(BASE, { chatId: 844000091 });

  // ---- empty: the honest state ------------------------------------------
  const reqEmpty = await sittingWithReport('Bokat', 8);
  ok('with no catalogue, the model is told there is no book list',
    /Tasdiqlangan kitoblar ro‘yxati — kiritilmagan/.test(reqEmpty),
    'silence here is an invitation to invent a title');
  ok('  and told not to write a title or an author',
    /kitob nomi yoki muallifini yozmang/.test(reqEmpty));
  ok('  and what to write instead',
    /umumiy yo‘nalish/.test(reqEmpty), 'refusing is not the same as being useless');
  ok('with no tutor catalogue, the same',
    /Tasdiqlangan ustozlar katalogi — kiritilmagan/.test(reqEmpty)
    && /narx, malaka, sharh/.test(reqEmpty),
    '§16 names price, qualifications and reviews specifically');

  // ---- the admin side ----------------------------------------------------
  const noAuth = await j('GET', '/admin/books');
  ok('the catalogue is admin-only', noAuth.status === 401, 'status=' + noAuth.status);

  const login = await j('POST', '/admin/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  ok('admin logs in', login.status === 200, 'status=' + login.status);

  const empty = await j('GET', '/admin/books');
  ok('the catalogue starts empty', empty.status === 200 && empty.data.books.length === 0,
    String(empty.data.books && empty.data.books.length));

  const noSource = await j('POST', '/admin/books/import', { books: [{ title: 'Kitob' }] });
  ok('an import with no stated source is refused', noSource.status === 400,
    'a row nobody can vouch for is a row nobody can defend to a parent');

  const imported = await j('POST', '/admin/books/import', {
    source: 'Markaz kutubxonasi ro‘yxati, 2026-yil',
    books: [
      { title: 'Sinov kitobi A', author: 'Muallif A', age_min: 8, age_max: 12, genre: 'Sarguzasht', language: 'o‘zbek', list_position: 1 },
      { title: 'Sinov kitobi B', author: 'Muallif B', age_min: 13, age_max: 15, language: 'o‘zbek', list_position: 2 },
      { title: '' },
    ],
  });
  ok('a sourced import is accepted', imported.status === 201 && imported.data.added === 2,
    JSON.stringify(imported.data));
  ok('  blank rows are skipped, not stored as untitled books',
    imported.data.skipped === 1, JSON.stringify(imported.data));
  ok('  and it says the rows are not yet usable',
    /tasdiqlash kerak/.test(imported.data.note || ''),
    'an import that looks finished is when somebody assumes reports use it');

  const afterImport = await j('GET', '/admin/books');
  ok('  imported rows land unapproved',
    afterImport.data.books.every((b) => b.approved === false)
    && afterImport.data.approved_count === 0,
    JSON.stringify(afterImport.data.books.map((b) => b.approved)));

  // ---- THE assertion: unapproved must not reach the model ----------------
  const reqUnapproved = await sittingWithReport('Tekshirilmagan', 8);
  ok('an imported but unchecked list still reads as no list',
    /Tasdiqlangan kitoblar ro‘yxati — kiritilmagan/.test(reqUnapproved),
    'the window between pasting and checking has to be safe');
  ok('  and the unchecked titles are nowhere in the request',
    !reqUnapproved.includes('Sinov kitobi A') && !reqUnapproved.includes('Sinov kitobi B'),
    'a title the model can see is a title the model can recommend');

  // ---- approved: now it is used -----------------------------------------
  const books = afterImport.data.books;
  for (const b of books) await j('POST', '/admin/books/' + b.id + '/approve', { approved: true });
  const approved = await j('GET', '/admin/books');
  ok('approving two books is visible as two', approved.data.approved_count === 2,
    String(approved.data.approved_count));

  const reqApproved = await sittingWithReport('Tasdiq', 8);
  ok('an approved list reaches the model', /Tasdiqlangan kitoblar ro‘yxati \(/.test(reqApproved),
    JSON.stringify(reqApproved.slice(reqApproved.indexOf('Kataloglar'), reqApproved.indexOf('Kataloglar') + 120)));
  ok('  with the title and author as supplied', reqApproved.includes('Sinov kitobi A — Muallif A'),
    'the model must quote, not paraphrase');
  ok('  and is told to use only that list', /FAQAT shu ro‘yxatdan/.test(reqApproved));

  // §17 asks for books matched to the child's age. An eight-year-old must not
  // be handed the 13-15 book, and the filter is also what keeps a hundred-book
  // list from costing input tokens on ninety-seven unusable rows.
  ok('a book outside the child’s age range is not offered',
    !reqApproved.includes('Sinov kitobi B'),
    'book B is 13-15; this child is 8');

  const reqTeen = await sittingWithReport('Katta', 14);
  ok('  and is offered to a child inside it', reqTeen.includes('Sinov kitobi B'),
    'the filter must narrow, not just exclude');
  ok('  while the younger book drops out', !reqTeen.includes('Sinov kitobi A'),
    'book A is 8-12; this child is 14');

  // ---- tutors ------------------------------------------------------------
  const t = await j('POST', '/admin/tutors', {
    subject: 'IT va dasturlash', age_range: '8–12 yosh',
    method: 'Blokli dasturlash, haftasiga 1 marta',
    source: 'Markaz shartnomasi',
  });
  ok('a tutor line can be added', t.status === 201 && t.data.tutor.approved === false,
    JSON.stringify(t.data.tutor && { approved: t.data.tutor.approved }));

  const reqTutorUnapproved = await sittingWithReport('Ustozsiz', 8);
  ok('  and is invisible until approved',
    !reqTutorUnapproved.includes('IT va dasturlash')
    && /Tasdiqlangan ustozlar katalogi — kiritilmagan/.test(reqTutorUnapproved));

  await j('POST', '/admin/tutors/' + t.data.tutor.id + '/approve', { approved: true });
  const reqTutor = await sittingWithReport('Ustozli', 8);
  ok('once approved it reaches the model',
    /Tasdiqlangan ustozlar katalogi \(1 ta\)/.test(reqTutor)
    && reqTutor.includes('IT va dasturlash'),
    JSON.stringify(reqTutor.slice(reqTutor.lastIndexOf('ustozlar'), reqTutor.lastIndexOf('ustozlar') + 140)));

  // There is no column for these, so there is nothing to leak.
  //
  // Bounded to the catalogue block itself. The first version of this read to
  // the end of the request and failed on the word "narx" in the `support`
  // section brief — which is that brief telling the model NOT to invent a
  // price, i.e. the assertion was tripping over the thing working.
  const tutorBlock = (() => {
    const from = reqTutor.indexOf('### Tasdiqlangan ustozlar katalogi');
    const to = reqTutor.indexOf('Markdown formatida', from);
    return from < 0 ? '' : reqTutor.slice(from, to < 0 ? undefined : to);
  })();
  ok('  and the catalogue block carries no price, availability or review',
    tutorBlock.length > 0 && !/narx|so‘m|sharh|bo‘sh vaqt/i.test(tutorBlock),
    '§16 forbids inventing them; the schema has nowhere to put them. Block: '
      + JSON.stringify(tutorBlock.slice(0, 120)));

  // ---- cleanup -----------------------------------------------------------
  for (const b of approved.data.books) await j('DELETE', '/admin/books/' + b.id);
  await j('DELETE', '/admin/tutors/' + t.data.tutor.id);
  const cleaned = await j('GET', '/admin/books');
  ok('rows can be removed again', cleaned.data.books.length === 0,
    String(cleaned.data.books.length));

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
