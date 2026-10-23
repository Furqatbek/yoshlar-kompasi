'use strict';

const express = require('express');
const router = express.Router();

const { config } = require('../config');
const repo = require('../db/repo');
const prompt = require('../services/prompt');
const claude = require('../services/claude');
const delivery = require('../services/delivery');
// stripAnswerMarkers stays as a guard: the model is no longer asked for an
// answer line, and a hallucinated one must never reach a reader — nor be
// recorded, which is why nothing parses it any more. The app is the only thing
// that writes answers.
const { stripAnswerMarkers, parseReport } = require('../services/reportParse');
const scoring = require('../services/scoring');
const { sessionAuth } = require('../middleware/auth');
const { rateLimit, clientIp } = require('../middleware/rateLimit');
const { asyncHandler, badRequest, forbidden } = require('../utils/http');
const v = require('../utils/validate');
const { sessionToken, shareToken } = require('../utils/tokens');
const { normalizeUzPhone } = require('../utils/phone');
const { reportUrl } = require('../utils/reportUrl');
const { visitorIdOf } = require('../utils/visitor');

const newSessionLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: config.rateLimit.newSessionsPerDayPerIp,
  key: (r) => 'newsess:' + clientIp(r),
  message: 'Kunlik mashg‘ulot chegarasiga yetdingiz. Ertaga urinib ko‘ring.',
});
const messageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.rateLimit.messagesPerMin,
  key: (r) => 'msg:' + r.params.id,
  message: 'Juda tez yuborilmoqda. Bir daqiqadan so‘ng urinib ko‘ring.',
});
// Report generation is expensive and one-per-session; bound double-clicks.
const reportLimiter = rateLimit({
  windowMs: 30 * 1000,
  max: 2,
  key: (r) => 'report:' + r.params.id,
  message: 'Hisobot tayyorlanmoqda — biroz kuting.',
});

// Progress is now "how far through the 70", counted from answers that exist
// rather than from flags a model set. `done` means every question has an
// answer or was deliberately skipped past; the adult can still finish early.
const DEFAULT_TOTAL = require('../data/questions').COUNT;

// How many questions this sitting has to get through. Follows the live bank so
// a disabled question shortens the sitting instead of making it unfinishable.
let _total = DEFAULT_TOTAL;
async function refreshTotal() {
  try {
    const bank = await require('../services/questionBank').load();
    if (bank && bank.activeCount > 0) _total = bank.activeCount;
  } catch (_) { /* keep the shipped count */ }
  return _total;
}

function progressOf(session) {
  const answered = Number(session.answered_count || 0);
  const seen = Number(session.seen_count || 0);
  return { answered, seen, total: _total, pct: Math.min(100, Math.round((seen / _total) * 100)) };
}
// The inventory is finished when every question has been put to the child —
// counting the ones they passed on. A child who skips fourteen questions must
// still be able to reach the end; measuring by answers alone would strand them.
function allDone(session) {
  return Number(session.seen_count || 0) >= _total;
}

// POST /api/sessions — create the child and the sitting. No model call.
router.post(
  '/',
  newSessionLimiter,
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    // Telegram authorization gate. Enforced HERE, not only in the UI: the whole
    // point is that every assessment belongs to a reachable adult, so a client
    // that skips the login must not be able to start one.
    let parent = null;
    if (config.auth.required) {
      parent = await repo.getParentByToken(String(req.get('x-parent-token') || b.parent_token || ''));
      if (!parent) {
        throw forbidden('Mashg‘ulotni boshlash uchun Telegram orqali tizimga kiring.', 'auth_required');
      }
    }
    // The adult assertion (parent/teacher, 18+, privacy accepted) is enforced
    // HERE, not only in the UI — client-side checks can be stale or bypassed.
    if (b.consent !== true) {
      throw badRequest('Davom etish uchun rozilik belgisini qo‘ying: siz bolaning ota-onasi yoki o‘qituvchisi ekaningizni tasdiqlashingiz kerak.', 'consent_required');
    }
    const nickname = v.reqStr(b.nickname, 'Ism', 60);
    const grade = v.grade(b.grade);
    const age = v.optAge(b.age);
    const goal = v.optStr(b.goal, 300);
    const notes = v.optStr(b.notes, 500);
    // Who is running the sitting. Anything we do not recognise is stored as
    // nothing rather than guessed — it feeds reporting, not the assessment.
    const administeredBy = ['parent', 'teacher'].includes(b.administered_by) ? b.administered_by : null;

    const model = claude.activeModel();
    const promptVersion = prompt.promptVersion();
    const token = sessionToken();
    // The child belongs to the authorized adult from the start — no orphan row
    // waiting for a contact gate to claim it later.
    const { child, session } = await repo.createChildAndSession({
      nickname, grade, age, goal, notes, model, promptVersion, sessionToken: token,
      parentId: parent ? parent.id : null, administeredBy,
    });

    // Funnel: the assessment actually began. Recorded here rather than trusted
    // from the browser, and never allowed to fail the request.
    await repo.recordEvent({
      visitorId: visitorIdOf(req), stage: 'session_start',
      parentId: parent ? parent.id : null, sessionId: session.id,
    });

    // Who the sitting is about, stored as an internal (meta) turn so the report
    // call knows whose report it is writing. Data minimization: goal/notes stay
    // in OUR db — this line carries nothing but nickname/grade/age.
    //
    // Starting a sitting does NOT call the model. It used to: a greeting was
    // generated here and waited for before the parent could see question 1.
    // The app serves the questions itself, so nothing ever displayed that
    // greeting — it was a 30-second wait (a full minute when the model timed
    // out) in front of a database insert, and two sittings back to back meant
    // two of them, with the second usually the slower because the first had
    // just spent the minute's quota. The model is now called once per sitting,
    // for the report.
    await repo.addMessage(session.id, 'user', prompt.childContext({ nickname, grade, age }), true);

    return res.status(201).json({
      session_id: session.id,
      session_token: token,
      child: { nickname, grade, age, goal, notes },
      status: 'active',
      messages: await repo.getMessages(session.id),
      progress: progressOf(session),
      done: false,
      // The first question, in the same response. The client used to create the
      // session and then fetch the inventory, which is two serial round trips
      // before anything is on screen — about a second of staring at a button on
      // mobile data, for data we already have in hand here.
      inventory: await inventoryFor(session),
    });
  })
);

// POST /api/sessions/:id/messages — adult's turn (or {retry:true} to re-call).
router.post(
  '/:id/messages',
  messageLimiter,
  sessionAuth,
  asyncHandler(async (req, res) => {
    const session = req.session;
    if (session.status === 'finished') throw forbidden('Mashg‘ulot allaqachon yakunlangan.');
    const retry = req.body && req.body.retry === true;
    const capMsg = 'Savollar chegarasiga yetdik. Iltimos, mashg‘ulotni yakunlab, hisobotni oling.';

    if (retry) {
      // Idempotent retry: if the previous turn actually produced an assistant
      // reply (its response was just lost in transit), echo it instead of
      // re-calling Claude. Only a dangling user turn re-generates.
      const msgs0 = await repo.getMessages(session.id);
      const last0 = msgs0[msgs0.length - 1];
      if (last0 && last0.role === 'assistant') {
        return res.json({
          reply: last0.content, progress: progressOf(session), done: allDone(session),
          turn_count: session.turn_count, cap_reached: false,
        });
      }
      // Dangling user turn — still bounded by the turn cap.
      if (session.turn_count >= config.caps.maxTurns) {
        return res.json({ reply: capMsg, progress: progressOf(session), done: allDone(session), turn_count: session.turn_count, cap_reached: true });
      }
    } else {
      const content = v.reqStr(req.body && req.body.content, 'Xabar', config.caps.maxMessageChars);
      // Turn cap: store the message, then ask them to finish (no Claude call).
      if (session.turn_count >= config.caps.maxTurns) {
        await repo.addMessage(session.id, 'user', content, false);
        await repo.addMessage(session.id, 'assistant', capMsg, false);
        return res.json({
          reply: capMsg, progress: progressOf(session), done: allDone(session),
          turn_count: session.turn_count, cap_reached: true,
        });
      }
      // Store first, call Claude second (spec §4) — a failed call keeps the turn.
      await repo.addMessage(session.id, 'user', content, false);

      // Funnel: the child engaged, as opposed to the adult opening the
      // assessment and closing it at the first question. turn_count is 1 after
      // the greeting, or 0 if the greeting call failed — either way this fires
      // on the first real answer. A rare double-record costs nothing: the
      // funnel counts distinct visitors, not events.
      if (session.turn_count <= 1) {
        await repo.recordEvent({ visitorId: visitorIdOf(req), stage: 'first_answer', sessionId: session.id });
      }
    }

    const history = await repo.getMessages(session.id);
    const out = await claude.complete({
      system: prompt.systemPrompt(), model: claude.modelFor(session.model),
      maxTokens: config.llm.conversationMaxTokens, messages: history,
    });
    await repo.addMessage(session.id, 'assistant', stripAnswerMarkers(out.text), false);
    const updated = await repo.applyTurn(session.id, {
      inputTokens: out.inputTokens, outputTokens: out.outputTokens, incTurn: true,
    });
    res.json({
      reply: stripAnswerMarkers(out.text), progress: progressOf(updated), done: allDone(updated),
      turn_count: updated.turn_count, cap_reached: false,
    });
  })
);

// GET /api/sessions/:id — resume.
router.get(
  '/:id',
  sessionAuth,
  asyncHandler(async (req, res) => {
    const session = req.session;
    const child = await repo.getChildById(session.child_id);
    const messages = await repo.getMessages(session.id);
    const report = await repo.getReportBySession(session.id);
    res.json({
      child: { nickname: child.nickname, grade: child.grade, age: child.age, goal: child.goal, notes: child.notes },
      messages,
      status: session.status,
      progress: progressOf(session),
      done: allDone(session),
      turn_count: session.turn_count,
      report: report ? { share_token: report.share_token, partial: report.partial } : null,
    });
  })
);

// POST /api/sessions/:id/contact — the report gate.
router.post(
  '/:id/contact',
  sessionAuth,
  asyncHandler(async (req, res) => {
    const session = req.session;
    const b = req.body || {};
    const parentName = v.reqStr(b.parent_name, 'Ismingiz', 100);
    let phone = null;
    if (b.phone != null && String(b.phone).trim() !== '') {
      phone = normalizeUzPhone(b.phone);
      if (!phone) throw badRequest('Telefon raqami noto‘g‘ri — 9 ta raqam kerak.', 'bad_phone');
    }
    const email = v.optStr(b.email, 120);
    const marketing = v.bool(b.marketing_consent);
    const consentVersion = config.consentTextVersion;

    // Idempotent per session: if the child is already linked (re-submit),
    // update that parent instead of creating a duplicate phone-less record.
    const child = await repo.getChildById(session.child_id);
    if (child && child.parent_id) {
      await repo.updateParentContact(child.parent_id, { phone, name: parentName, email, marketing, consentVersion });
      return res.json({ ok: true });
    }
    const parent = await repo.upsertParent({ phone, name: parentName, email, marketing, consentVersion });
    await repo.linkChildToParent(session.child_id, parent.id);
    res.json({ ok: true });
  })
);

// POST /api/sessions/:id/report — final Claude call, parse, store, deliver.
router.post(
  '/:id/report',
  reportLimiter,
  sessionAuth,
  asyncHandler(async (req, res) => {
    const session = req.session;

    const respond = (rep, delivery) => res.json({
      report_url: reportUrl(req, rep.share_token),
      share_token: rep.share_token,
      partial: rep.partial,
      delivered: rep.delivered,
      delivery: delivery || null,
    });

    // One report per session (spec §4). Return the existing one if present.
    const existing = await repo.getReportBySession(session.id);
    if (existing) return respond(existing);

    const child = await repo.getChildById(session.child_id);
    const partial = !allDone(session);

    // Engagement gate: a report is only ever built from the child's real answers
    // (spec §4 / the product promise). Count real (non-meta) answers only — we
    // deliberately do NOT accept a completed [YAKUN] direction as a substitute,
    // since the model controls those markers and could emit one with no answers,
    // bypassing the gate. A legitimately-assessed direction always has answers.
    // The gate counts ANSWERS, not chat turns. The inventory is a form now, so
    // a finished sitting can have no user messages at all — counting messages
    // would refuse every real report while passing a conversation that
    // answered nothing.
    const msgs = await repo.getMessages(session.id);
    const realAnswers = Number(session.answered_count || 0)
      || msgs.filter((m) => m.role === 'user' && !m.meta).length;
    if (realAnswers < config.caps.minAnswersForReport) {
      throw badRequest(
        'Hisobot uchun avval bolaning savollarga bergan javobini yozing — hisobot aynan shu javoblardan tuziladi.',
        'insufficient_engagement'
      );
    }

    // Append the report-request meta turn once (retry-safe).
    // Score first: the report request carries the results, because with the
    // inventory served as a form there is no transcript for the model to read
    // them out of. It writes prose about numbers it is given, and is told not
    // to recompute them.
    const liveBankForReq = await require('../services/questionBank').load().catch(() => null);
    const scoredForReq = scoring.score(await repo.getAnswers(session.id), scoring.shapeOf(liveBankForReq));

    // Appended once, however many times this is retried. The test is the
    // marker, not "the last turn is a hidden one": the child-context turn is
    // also a hidden user turn, and with the greeting gone it is the last
    // message in a sitting nobody typed into — so a "is the last turn hidden?"
    // check reads a brand-new session as one that has already been asked, and
    // the model is sent a name with no request attached. It then answers
    // conversationally and that reply is stored as the report.
    const alreadyAsked = msgs.some((m) => m.role === 'user' && m.meta
      && String(m.content || '').includes(prompt.REPORT_MARKER));
    if (!alreadyAsked) {
      // The optional modules, which the report must either use or explicitly
      // say nothing about (§23). Fetched here rather than inside the prompt so
      // the prompt layer stays free of database calls.
      const [moduleQuestions, moduleState] = await Promise.all([
        repo.getModuleQuestions(),
        repo.getModuleState(session.id),
      ]);
      await repo.addMessage(session.id, 'user',
        prompt.buildReportRequest(child.nickname, partial, scoredForReq,
          { questions: moduleQuestions, state: moduleState }), true);
    }

    const history = await repo.getMessages(session.id);
    const out = await claude.complete({
      system: prompt.systemPrompt(), model: claude.modelFor(session.model),
      maxTokens: config.llm.reportMaxTokens, messages: history,
      timeoutMs: config.llm.reportTimeoutMs,
    });
    await repo.applyTurn(session.id, { inputTokens: out.inputTokens, outputTokens: out.outputTokens, incTurn: false });

    const parsed = parseReport(out.text);

    // The scores are computed here, from the answers in the database, not taken
    // from the model's JSON block. A language model averaging seventy items
    // across twelve buckets is not something a paid report should rest on, and
    // "a skipped question is not a zero" is exactly the rule it gets wrong.
    // Its block is kept only as a cross-check.
    // Scored against the bank as it stands, not the shipped default: an
    // administrator can add or disable questions, and an answer to a question
    // the static module has never heard of would otherwise be dropped.
    const liveBank = await require('../services/questionBank').load().catch(() => null);
    const scored = scoring.score(await repo.getAnswers(session.id), scoring.shapeOf(liveBank));
    const drift = scoring.compare(scored, parsed.modelJson);
    if (drift.length) {
      console.warn('[scoring] session=' + session.id + ' model JSON disagrees with the server: '
        + drift.slice(0, 5).join('; '));
    }

    const shareTok = shareToken();

    // Atomic claim: ON CONFLICT DO NOTHING means a concurrent request that
    // already inserted wins; we return their report and skip delivery so it is
    // never sent twice.
    const created = await repo.createReport({
      sessionId: session.id, childId: child.id, contentMd: parsed.contentMd,
      sports: parsed.sports, clubs: parsed.clubs,
      categories: scored.categories, topInterests: scored.top_interests,
      developingAreas: scored.developing_interests, dataCompleteness: scored.data_completeness,
      // The v2.0 blocks: recommendations, the two optional modules, the reading
      // programme and the limitations. The scores above are the server's; this
      // is the model's prose.
      payload: parsed.payload,
      partial, shareToken: shareTok, delivered: false,
    });
    if (!created) {
      const winner = await repo.getReportBySession(session.id);
      return respond(winner);
    }

    await repo.setSessionStatus(session.id, 'finished', true);

    // The report is the thing sold, so its order exists from the moment it
    // does — before anyone has tried to pay. The price is frozen here: a later
    // change to REPORT_PRICE_UZS must not alter what an existing order costs.
    if (config.payments.enabled) {
      await repo.createOrder({
        reportId: created.id,
        parentId: child.parent_id || null,
        amount: config.payments.priceTiyin,
      });
    }

    // Funnel: the assessment produced a report. Only reached once per session,
    // since a second call returns the existing report above.
    await repo.recordEvent({
      visitorId: visitorIdOf(req), stage: 'finished',
      parentId: child.parent_id || null, sessionId: session.id,
    });

    // Deliver to whichever channel we hold: a Telegram chat (the normal case
    // now that authorization comes first) or, for legacy rows, a phone.
    let deliveryInfo = null;
    const reportParent = child.parent_id ? await repo.getParent(child.parent_id) : null;
    if (reportParent && (reportParent.telegram_chat_id || reportParent.phone)) {
      deliveryInfo = await delivery.deliver({
        reportUrl: reportUrl(req, shareTok), shareToken: shareTok,
        chatId: reportParent.telegram_chat_id || null,
        parentPhone: reportParent.phone, childNickname: child.nickname,
        // The file itself, so the report arrives in the chat rather than as a
        // link to a tab the parent has to still have open in three months.
        // Lazy: only drawn if there is somewhere to send it, and null while
        // the report is still behind the paywall — which at this moment it
        // always is on a paid deployment, since nobody has had the chance to
        // buy it yet. That case is handled when the payment lands.
        unlocked: !config.payments.enabled,
        getDocument: async () =>
          (await require('../services/reportFile').forDeliveryByToken(shareTok)).document,
      });
      if (deliveryInfo.status === 'sent') {
        await repo.markReportDelivered(shareTok);
        created.delivered = true;
      }
    }

    respond(created, deliveryInfo ? { channel: deliveryInfo.channel, status: deliveryInfo.status, link: deliveryInfo.link || null } : null);
  })
);

// ---------------------------------------------------------------------------
// The inventory itself.
//
// The questions are served straight from the bank and the answers are posted
// back. The model is not in this loop at all: it has seventy fixed statements
// to read out and a 1-5 answer to record, which is a form, not a conversation.
// Keeping the model out of it removes a dozen LLM calls per sitting, removes the
// [JAVOBLAR:] contract it could fail silently, and lets the adult tap an answer
// instead of typing "1, 4, 5" and hoping the order was right.
// ---------------------------------------------------------------------------

// The inventory plus whatever has been answered so far, so a part-finished
// sitting restores exactly. Shared, because creating a session hands this back
// in the same response: two serial requests to put the first question on screen
// is one round trip too many on a connection where a round trip is 400ms, and a
// second copy of the shape would be a second thing to keep in step.
async function inventoryFor(session) {
  const bank = await require('../services/questionBank').load();
  const rows = await repo.getAnswerRows(session.id);
  const answered = {};
  for (const r of rows) answered[r.question_n] = r.value;  // null = skipped

  const questions = [];
  for (const sec of bank.sections) {
    for (const q of sec.items) {
      if (!q.active) continue;
      questions.push({ n: q.n, text: q.text, section: sec.key, section_title: sec.title });
    }
  }
  return {
    questions,
    answers: answered,
    scale: require('../data/questions').SCALE,
    progress: progressOf(session),
    done: allDone(session),
  };
}

// GET /api/sessions/:token/questions
router.get(
  '/:id/questions',
  sessionAuth,
  asyncHandler(async (req, res) => res.json(await inventoryFor(req.session)))
);

// POST /api/sessions/:token/answers — record a batch.
//   { answers: [ { n: 12, value: 4 }, { n: 13, value: null } ] }
// value null means skipped: addressed, never scored.
router.post(
  '/:id/answers',
  sessionAuth,
  asyncHandler(async (req, res) => {
    const session = req.session;
    if (session.status === 'finished') throw badRequest('Mashg\u2018ulot yakunlangan', 'session_finished');

    const list = Array.isArray((req.body || {}).answers) ? req.body.answers : [];
    if (!list.length) throw badRequest('Javob yuborilmadi');
    if (list.length > 80) throw badRequest('Juda ko\u2018p javob');

    const answers = [];
    const skipped = [];
    for (const a of list) {
      const n = Number(a && a.n);
      if (!Number.isInteger(n) || n < 1) continue;
      const v = a.value === null || a.value === undefined ? null : Number(a.value);
      // Anything that is not 1-5 and not an explicit skip is dropped rather
      // than coerced: a wrong value here is a wrong number in a report.
      if (v === null) skipped.push(n);
      else if (Number.isInteger(v) && v >= 1 && v <= 5) answers.push({ question_n: n, value: v });
    }
    if (!answers.length && !skipped.length) throw badRequest('Javoblar noto\u2018g\u2018ri');

    const updated = (await repo.saveAnswers(session.id, answers, skipped)) || session;

    // Funnel: the child actually answered something. Recorded once.
    if (answers.length && Number(session.answered_count || 0) === 0) {
      await repo.recordEvent({
        visitorId: visitorIdOf(req), stage: 'first_answer',
        parentId: null, sessionId: session.id,
      }).catch(() => {});
    }

    res.json({ progress: progressOf(updated), done: allDone(updated) });
  })
);

// ---------------------------------------------------------------------------
// The two optional modules (§8 learning preferences, §9 homework environment).
//
// Deliberately a separate pair of endpoints from /questions and /answers. The
// 70 and these sixteen are different instruments with different consequences —
// one is scored, the other must never be — and sharing a route would mean one
// handler deciding which table a batch of answers lands in. That decision is
// exactly what should not exist.

// GET /api/sessions/:token/modules — the questions and whatever has been
// answered so far, so a resumed sitting shows what was already filled.
router.get(
  '/:id/modules',
  sessionAuth,
  asyncHandler(async (req, res) => {
    const { MODULES } = require('../data/modules');
    const [rows, state] = await Promise.all([
      repo.getModuleQuestions(),
      repo.getModuleState(req.session.id),
    ]);
    const byModule = new Map();
    for (const q of rows) {
      if (!byModule.has(q.module)) byModule.set(q.module, []);
      byModule.get(q.module).push({ n: q.n, text: q.text, options: q.options || null });
    }
    res.json({
      modules: MODULES
        .filter((m) => byModule.has(m.key))
        .map((m) => ({
          key: m.key,
          title: m.title,
          intro: m.intro,
          kind: m.kind,
          scale: m.kind === 'scale' ? m.scale : null,
          questions: byModule.get(m.key),
          answers: (state.answers[m.key] || []),
          // true = filled, false = deliberately skipped, undefined = not offered yet.
          completed: Object.prototype.hasOwnProperty.call(state.completion, m.key)
            ? state.completion[m.key] : null,
        })),
    });
  })
);

// POST /api/sessions/:token/modules/:module — save answers, or record a skip.
//   { answers: [ { n: 1, value: 4 }, { n: 2, choice: 'Tinch muhit' } ] }
//   { skipped: true }
router.post(
  '/:id/modules/:module',
  sessionAuth,
  asyncHandler(async (req, res) => {
    const session = req.session;
    if (session.status === 'finished') throw badRequest('Mashg‘ulot yakunlangan', 'session_finished');

    const { BY_KEY } = require('../data/modules');
    const moduleKey = String(req.params.module || '');
    const mod = BY_KEY.get(moduleKey);
    if (!mod) throw badRequest('Noma’lum modul', 'unknown_module');

    const body = req.body || {};
    if (body.skipped === true) {
      // A skip is recorded, not merely an absence of answers: §23 needs the
      // report to know the module was offered and declined, and the UI needs to
      // stop asking on resume.
      await repo.setModuleCompletion(session.id, moduleKey, false);
      return res.json({ module: moduleKey, completed: false, saved: 0 });
    }

    const list = Array.isArray(body.answers) ? body.answers : [];
    if (!list.length) throw badRequest('Javob yuborilmadi');
    if (list.length > 40) throw badRequest('Juda ko‘p javob');

    // Validate against the question's own kind. A scale answer to a choice
    // question, or a choice that is not one of the offered options, is dropped
    // rather than stored — the report quotes these back to a parent verbatim.
    const allowed = new Map(mod.items.map(([n, , options]) => [n, options || null]));
    const clean = [];
    for (const a of list) {
      const n = Number(a && a.n);
      if (!allowed.has(n)) continue;
      const options = allowed.get(n);
      if (mod.kind === 'scale') {
        const v = Number(a.value);
        if (Number.isInteger(v) && v >= 1 && v <= 5) clean.push({ n, value: v });
      } else {
        const c = typeof a.choice === 'string' ? a.choice.trim() : '';
        if (c && options && options.includes(c)) clean.push({ n, choice: c });
      }
    }
    if (!clean.length) throw badRequest('Javoblar noto‘g‘ri');

    const saved = await repo.saveModuleAnswers(session.id, moduleKey, clean);
    // Complete only when every question has an answer. A half-filled module is
    // not a completed one, and §23 treats the two the same way: say nothing.
    const state = await repo.getModuleState(session.id);
    const answeredCount = (state.answers[moduleKey] || []).length;
    const complete = answeredCount >= mod.items.length;
    await repo.setModuleCompletion(session.id, moduleKey, complete);

    res.json({
      module: moduleKey, saved, completed: complete,
      answered: answeredCount, total: mod.items.length,
    });
  })
);

module.exports = router;
module.exports.refreshTotal = refreshTotal;
