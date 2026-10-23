// The two optional modules, and the one guarantee they exist under.
//
// §8 and §9 both say their answers never join the seventy. The product reason
// is that neither module measures an interest: "do you like diagrams?" is not
// evidence about mathematics, and a homework preference is not evidence about
// anything at all. If one leaked into the scoring, the damage would be an
// interest average that is wrong by a plausible amount — indistinguishable,
// by looking at it, from a correct one, in a report a parent paid for and
// acted on.
//
// So the modules write to their own tables and services/scoring.js has no path
// to them. This file proves it by running two sittings with byte-identical
// answers to the seventy — one with both modules filled, one with neither — and
// requiring that every scored number in the two reports matches. Comparing one
// sitting with itself before and after would only compare progress counters,
// which cannot move whatever the modules do, and would prove nothing.

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

const { installAuth } = require('./auth-helper');

async function newSession(nickname, grade) {
  const r = await j('POST', '/api/sessions', { consent: true, nickname, grade });
  if (r.status !== 201) throw new Error('could not start a sitting: ' + JSON.stringify(r.data));
  return r.data;
}

(async () => {
  // Sittings are gated on Telegram authorization; log in first. Its own chat
  // id, so this suite's parent row is not merged with another's.
  await installAuth(BASE, { chatId: 833000071 });

  const s = await newSession('Modul', 2);
  const tok = s.session_token;
  const auth = { 'x-session-token': tok };

  // ---- answer the seventy -------------------------------------------------
  const inv = await j('GET', '/api/sessions/' + tok + '/questions', undefined, auth);
  const questions = (inv.data.questions || []);
  ok('the inventory is served', questions.length > 0, String(questions.length));

  // A deterministic spread, so the scores below are stable and comparable —
  // but questions 1-8 are deliberately LEFT UNANSWERED.
  //
  // The module questions are numbered 1-8 too. If a module answer ever leaked
  // into the scored `answers` table, it would land on those numbers. Answer
  // all seventy first and the leak collides with rows that already exist and
  // disappears, so the test passes while the bug is live — which is exactly
  // what happened to the first version of this file, and what the mutation
  // run caught. Leaving 1-8 empty gives a leak somewhere to show up:
  // construction_engineering (1-6) would go from unscored to fully scored.
  const scoredRange = questions.filter((q) => q.n > 8);
  const answers = scoredRange.map((q) => ({ n: q.n, value: (q.n % 5) + 1 }));
  const put = await j('POST', '/api/sessions/' + tok + '/answers', { answers }, auth);
  ok('questions 9-70 are answered, 1-8 left open', put.status === 200,
    'status=' + put.status + ' answered=' + answers.length);

  // A second sitting with byte-identical answers and NO modules, to compare
  // against. Comparing one sitting with itself before and after would only
  // compare the progress counters — which cannot move whatever the modules do,
  // so it would prove nothing. The interest averages are computed at report
  // time, so the only honest comparison is two reports.
  const control = await newSession('Nazorat', 2);
  const ca = { 'x-session-token': control.session_token };
  const cinv = await j('GET', '/api/sessions/' + control.session_token + '/questions', undefined, ca);
  await j('POST', '/api/sessions/' + control.session_token + '/answers',
    { answers: cinv.data.questions.filter((q) => q.n > 8)
      .map((q) => ({ n: q.n, value: (q.n % 5) + 1 })) }, ca);

  // ---- the modules --------------------------------------------------------
  const mods = await j('GET', '/api/sessions/' + tok + '/modules', undefined, auth);
  ok('both modules are offered', mods.status === 200 && mods.data.modules.length === 2,
    JSON.stringify((mods.data.modules || []).map((m) => m.key)));

  const learning = mods.data.modules.find((m) => m.key === 'learning_preferences');
  const homework = mods.data.modules.find((m) => m.key === 'homework_environment');

  ok('  the scale module carries its scale', learning && learning.kind === 'scale'
    && Array.isArray(learning.scale) && learning.scale.length === 5);
  ok('  and eight questions', learning && learning.questions.length === 8,
    String(learning && learning.questions.length));
  ok('  the choice module carries options per question',
    homework && homework.kind === 'choice'
    && homework.questions.every((q) => Array.isArray(q.options) && q.options.length > 1));
  ok('  neither has been offered yet', learning.completed === null && homework.completed === null,
    JSON.stringify([learning.completed, homework.completed]));

  ok('  the module intro says the answers are not scored',
    /qo‘shilmaydi/.test(learning.intro) && /qo‘shilmaydi/.test(homework.intro),
    'a parent has to be told this before answering, not after');
  ok('  and the learning module refuses to label the child',
    /yorliq/.test(learning.intro), learning.intro);

  // ---- validation (before anything finishes the sitting) ------------------
  const wrongKind = await j('POST', '/api/sessions/' + tok + '/modules/homework_environment',
    { answers: [{ n: 1, value: 4 }] }, auth);
  ok('a scale answer to a choice question is refused', wrongKind.status === 400,
    'status=' + wrongKind.status);

  const notAnOption = await j('POST', '/api/sessions/' + tok + '/modules/homework_environment',
    { answers: [{ n: 1, choice: 'Oyda bir marta, daraxt tagida' }] }, auth);
  ok('  as is a choice that was never offered', notAnOption.status === 400,
    'the report quotes these back to a parent verbatim');

  const unknown = await j('POST', '/api/sessions/' + tok + '/modules/astrology',
    { answers: [{ n: 1, value: 3 }] }, auth);
  ok('an unknown module is refused', unknown.status === 400 && unknown.data.code === 'unknown_module',
    JSON.stringify(unknown.data));

  // Fill both, completely.
  const lr = await j('POST', '/api/sessions/' + tok + '/modules/learning_preferences',
    { answers: learning.questions.map((q) => ({ n: q.n, value: 5 })) }, auth);
  ok('the learning module saves', lr.status === 200 && lr.data.completed === true,
    JSON.stringify(lr.data));

  const hr = await j('POST', '/api/sessions/' + tok + '/modules/homework_environment',
    { answers: homework.questions.map((q) => ({ n: q.n, choice: q.options[0] })) }, auth);
  ok('the homework module saves', hr.status === 200 && hr.data.completed === true,
    JSON.stringify(hr.data));

  // ---- THE assertion ------------------------------------------------------
  // Same seventy answers, one sitting with both modules filled and one with
  // neither. Every scored number has to come out identical.
  const withMods = await j('POST', '/api/sessions/' + tok + '/report', {}, auth);
  const without = await j('POST', '/api/sessions/' + control.session_token + '/report', {}, ca);
  ok('both reports generated', withMods.status === 200 && without.status === 200,
    'with=' + withMods.status + ' without=' + without.status);

  // The scores the report is actually built from are embedded verbatim in the
  // report request, as "Hisoblangan natijalar (tizim hisobladi ...)". Read them
  // back from the stored turn rather than from the report page: with payments
  // on, an unpaid report answers `categories: null`, and comparing two nulls
  // would pass while proving nothing.
  const reqOf = async (t, h) => {
    const v = await j('GET', '/api/sessions/' + t, undefined, h);
    const turn = (v.data.messages || []).find(
      (m) => m.role === 'user' && m.meta && String(m.content).includes('[HISOBOT-SOROVI]'));
    return String((turn && turn.content) || '');
  };
  const reqWith = await reqOf(tok, auth);
  const reqWithout = await reqOf(control.session_token, ca);

  const scoresIn = (s) => {
    const i = s.indexOf('Hisoblangan natijalar');
    const j2 = s.indexOf('Jami javob:', i);
    return i < 0 ? '' : s.slice(i, j2 < 0 ? undefined : j2).trim();
  };
  const sWith = scoresIn(reqWith);
  const sWithout = scoresIn(reqWithout);

  ok('  the comparison is of real per-area numbers, not of two empty blocks',
    /o‘rtacha \d/.test(sWith) && sWith.split('\n').length >= 12,
    sWith.split('\n').length + ' area lines');
  // The area a leak would land in has to be visibly empty, or the comparison
  // above has nothing to detect.
  ok('  and the area the module numbers map to is unscored to begin with',
    /Konstruktorlik va muhandislik: yetarli ma’lumot yo‘q/.test(sWith),
    'questions 1-6 must be unanswered for a leak to be visible: '
      + (sWith.split('\n')[1] || ''));
  ok('every per-area score is identical with and without the modules',
    sWith === sWithout,
    'with    = ' + sWith.slice(0, 150).replace(/\n/g, ' | ')
    + '\n            without = ' + sWithout.slice(0, 150).replace(/\n/g, ' | '));

  // ---- what the model is told about the modules ---------------------------
  ok('a filled module reaches the model with its answers',
    /Qanday o‘rganish qulay — to‘ldirildi/.test(reqWith)
    && /Uy vazifasi qanday qulay — to‘ldirildi/.test(reqWith),
    reqWith.includes('Qo‘shimcha modullar') ? 'modules block present' : 'NO modules block');
  ok('  with the label the child chose, not just a number',
    /— Ha \(5\/5\)/.test(reqWith), 'scale answers should read as words');

  // §23: an unfilled module must produce no conclusion at all. A model shown
  // nothing writes the section anyway, from the interest scores — which is the
  // inference §8 exists to forbid. So the silence has to be stated.
  ok('a sitting with no modules is told so explicitly',
    /Qanday o‘rganish qulay — to‘ldirilmadi/.test(reqWithout),
    'an omitted module is an invitation to invent one');
  ok('  and told not to infer it from the interest scores',
    /hatto qiziqish ballariga/.test(reqWithout));
  ok('  and to mark it incomplete in the JSON',
    /module_completed: false/.test(reqWithout));

  // ---- partial and skipped ------------------------------------------------
  const s2 = await newSession('Yarim', 3);
  const a2 = { 'x-session-token': s2.session_token };
  const half = await j('POST', '/api/sessions/' + s2.session_token + '/modules/learning_preferences',
    { answers: [{ n: 1, value: 4 }, { n: 2, value: 3 }] }, a2);
  ok('a half-filled module is saved but not complete',
    half.status === 200 && half.data.completed === false && half.data.answered === 2,
    JSON.stringify(half.data));

  const skip = await j('POST', '/api/sessions/' + s2.session_token + '/modules/homework_environment',
    { skipped: true }, a2);
  ok('skipping is recorded as a decision, not an absence',
    skip.status === 200 && skip.data.completed === false, JSON.stringify(skip.data));

  const after2 = await j('GET', '/api/sessions/' + s2.session_token + '/modules', undefined, a2);
  const hw2 = after2.data.modules.find((m) => m.key === 'homework_environment');
  ok('  and a resumed sitting can tell a skip from an unanswered module',
    hw2.completed === false,
    'null would mean "not offered yet" and the UI would ask again');

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
