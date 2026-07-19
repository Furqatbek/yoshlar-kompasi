'use strict';

const express = require('express');
const router = express.Router();

const { config } = require('../config');
const repo = require('../db/repo');
const prompt = require('../services/prompt');
const claude = require('../services/claude');
const delivery = require('../services/delivery');
const { parseTrackMarkers, parseReport } = require('../services/reportParse');
const { sessionAuth } = require('../middleware/auth');
const { rateLimit, clientIp } = require('../middleware/rateLimit');
const { asyncHandler, badRequest, forbidden } = require('../utils/http');
const v = require('../utils/validate');
const { sessionToken, shareToken } = require('../utils/tokens');
const { normalizeUzPhone } = require('../utils/phone');
const { reportUrl } = require('../utils/reportUrl');

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

function progressOf(session) {
  return { mantiq: session.done_mantiq, psixologiya: session.done_psixologiya, harakat: session.done_harakat };
}
function allDone(session) {
  return session.done_mantiq && session.done_psixologiya && session.done_harakat;
}
function markerFlags(text) {
  const p = parseTrackMarkers(text);
  return { MANTIQ: p.MANTIQ, PSIXOLOGIYA: p.PSIXOLOGIYA, HARAKAT: p.HARAKAT };
}

// POST /api/sessions — create child + session, greet + first batch.
router.post(
  '/',
  newSessionLimiter,
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const nickname = v.reqStr(b.nickname, 'Ism', 60);
    const grade = v.grade(b.grade);
    const age = v.optAge(b.age);
    const goal = v.optStr(b.goal, 300);
    const notes = v.optStr(b.notes, 500);

    const model = config.anthropic.model;
    const promptVersion = prompt.promptVersion();
    const token = sessionToken();
    const { child, session } = await repo.createChildAndSession({
      nickname, grade, age, goal, notes, model, promptVersion, sessionToken: token,
    });

    // Store the generated intro as an internal (meta) user turn, then greet.
    await repo.addMessage(session.id, 'user', prompt.buildIntro({ nickname, grade, age, goal, notes }), true);

    const base = {
      session_id: session.id,
      session_token: token,
      child: { nickname, grade, age, goal, notes },
      status: 'active',
    };

    try {
      const history = await repo.getMessages(session.id);
      const out = await claude.complete({
        system: prompt.systemPrompt(), model,
        maxTokens: config.anthropic.conversationMaxTokens, messages: history,
      });
      await repo.addMessage(session.id, 'assistant', out.text, false);
      const updated = await repo.applyTurn(session.id, {
        inputTokens: out.inputTokens, outputTokens: out.outputTokens, progress: markerFlags(out.text), incTurn: true,
      });
      const messages = await repo.getMessages(session.id);
      return res.status(201).json({ ...base, messages, progress: progressOf(updated), done: allDone(updated) });
    } catch (err) {
      // The session exists; let the client enter it and retry the first turn.
      const messages = await repo.getMessages(session.id);
      return res.status(201).json({
        ...base, messages, progress: progressOf(session), done: false,
        api_error: err.retryable ? 'Claude javob bermadi. Qayta urinib ko‘ring.' : (err.message || 'Xatolik'),
      });
    }
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

    if (!retry) {
      const content = v.reqStr(req.body && req.body.content, 'Xabar', config.caps.maxMessageChars);
      // Turn cap: store the message, then ask them to finish (no Claude call).
      if (session.turn_count >= config.caps.maxTurns) {
        await repo.addMessage(session.id, 'user', content, false);
        const capMsg = 'Savollar chegarasiga yetdik. Iltimos, mashg‘ulotni yakunlab, hisobotni oling.';
        await repo.addMessage(session.id, 'assistant', capMsg, false);
        return res.json({
          reply: capMsg, progress: progressOf(session), done: allDone(session),
          turn_count: session.turn_count, cap_reached: true,
        });
      }
      // Store first, call Claude second (spec §4) — a failed call keeps the turn.
      await repo.addMessage(session.id, 'user', content, false);
    }

    const history = await repo.getMessages(session.id);
    const out = await claude.complete({
      system: prompt.systemPrompt(), model: session.model,
      maxTokens: config.anthropic.conversationMaxTokens, messages: history,
    });
    await repo.addMessage(session.id, 'assistant', out.text, false);
    const updated = await repo.applyTurn(session.id, {
      inputTokens: out.inputTokens, outputTokens: out.outputTokens, progress: markerFlags(out.text), incTurn: true,
    });
    res.json({
      reply: out.text, progress: progressOf(updated), done: allDone(updated),
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
    const parent = await repo.upsertParent({
      phone, name: parentName, email, marketing, consentVersion: config.consentTextVersion,
    });
    await repo.linkChildToParent(session.child_id, parent.id);
    res.json({ ok: true });
  })
);

// POST /api/sessions/:id/report — final Claude call, parse, store, deliver.
router.post(
  '/:id/report',
  sessionAuth,
  asyncHandler(async (req, res) => {
    const session = req.session;

    // One report per session (spec §4). Return the existing one if present.
    const existing = await repo.getReportBySession(session.id);
    if (existing) {
      return res.json({
        report_url: reportUrl(req, existing.share_token),
        share_token: existing.share_token,
        partial: existing.partial,
        delivered: existing.delivered,
        delivery: null,
      });
    }

    const child = await repo.getChildById(session.child_id);
    const partial = !allDone(session);

    // Append the report-request meta turn once (retry-safe).
    const msgs = await repo.getMessages(session.id);
    const last = msgs[msgs.length - 1];
    if (!(last && last.role === 'user' && last.meta)) {
      await repo.addMessage(session.id, 'user', prompt.buildReportRequest(child.nickname, partial), true);
    }

    const history = await repo.getMessages(session.id);
    const out = await claude.complete({
      system: prompt.systemPrompt(), model: session.model,
      maxTokens: config.anthropic.reportMaxTokens, messages: history,
    });
    await repo.applyTurn(session.id, { inputTokens: out.inputTokens, outputTokens: out.outputTokens, incTurn: false });

    const parsed = parseReport(out.text);
    const shareTok = shareToken();
    const publicUrl = reportUrl(req, shareTok);

    // Deliver only when a phone was left (delivery consent is enforced at the gate).
    let delivered = false;
    let deliveryInfo = null;
    const parent = child.parent_id ? await repo.getParent(child.parent_id) : null;
    if (parent && parent.phone) {
      const d = await delivery.deliver({
        reportUrl: publicUrl, shareToken: shareTok, parentPhone: parent.phone, childNickname: child.nickname,
      });
      deliveryInfo = d;
      delivered = d.status === 'sent';
    }

    await repo.createReport({
      sessionId: session.id, childId: child.id, contentMd: parsed.contentMd,
      levelLogic: parsed.levelLogic, levelPsych: parsed.levelPsych, levelActivity: parsed.levelActivity,
      sports: parsed.sports, partial, shareToken: shareTok, delivered,
    });
    await repo.setSessionStatus(session.id, 'finished', true);

    res.json({
      report_url: publicUrl,
      share_token: shareTok,
      partial,
      delivered,
      delivery: deliveryInfo ? { channel: deliveryInfo.channel, status: deliveryInfo.status, link: deliveryInfo.link || null } : null,
    });
  })
);

module.exports = router;
