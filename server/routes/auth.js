'use strict';

// Telegram authorization — the gate in front of every assessment.
//
// Why a bot deep link rather than the Telegram Login Widget: the widget proves
// who someone is, but it does NOT grant permission to message them. This
// product's whole reason for authorizing is the push channel (report delivery,
// reminders, promotions), and only a chat the user has personally started can
// receive messages. So the login IS the act of starting the bot.
//
// Handshake:
//   1. browser  POST /api/auth/telegram/start  -> { nonce, link }
//   2. adult taps the link, presses Start in Telegram
//   3. bot webhook binds the chat to the nonce (routes/telegram.js)
//   4. bot asks for the phone with a Share-contact button
//   5. browser  GET /api/auth/telegram/status  -> parent_token once complete
//
// The nonce is short-lived and single-use; the parent token it yields is the
// long-lived browser login.

const express = require('express');
const router = express.Router();

const { config } = require('../config');
const repo = require('../db/repo');
const { telegram } = require('../services/delivery');
const { rateLimit, clientIp } = require('../middleware/rateLimit');
const { asyncHandler, badRequest } = require('../utils/http');
const { randomToken } = require('../utils/tokens');
const { visitorIdOf } = require('../utils/visitor');

const startLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  key: (r) => 'authstart:' + clientIp(r),
  message: 'Juda ko‘p urinish. Bir necha daqiqadan so‘ng qayta urinib ko‘ring.',
});

// Polling is frequent by design, so this ceiling is generous but still bounded:
// at one poll every 2s a 15-minute nonce needs ~450 calls.
const statusLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 90,
  key: (r) => 'authpoll:' + clientIp(r),
  message: 'rate limited',
});

function publicParent(p) {
  return {
    name: p.name,
    telegram_first_name: p.telegram_first_name,
    phone: p.phone || null,
    phone_verified: !!p.phone_verified,
    marketing_consent: !!p.marketing_consent,
  };
}

// POST /api/auth/telegram/start — issue a nonce and the deep link to open.
// Consent is captured here, on the page where the adult can actually read it,
// and applied to the parent row once the Telegram side completes.
router.post(
  '/telegram/start',
  startLimiter,
  asyncHandler(async (req, res) => {
    if (!telegram.configured()) {
      throw badRequest('Telegram bot sozlanmagan. Administrator bilan bog‘laning.', 'telegram_not_configured');
    }
    const b = req.body || {};
    const nonce = randomToken(18);
    await repo.createAuthRequest({
      nonce,
      marketing: b.marketing_consent === true,
      consentVersion: config.consentTextVersion,
      ttlMinutes: config.auth.nonceTtlMinutes,
    });
    res.status(201).json({
      nonce,
      link: telegram.authLink(nonce),
      bot_username: config.delivery.telegram.botUsername.replace(/^@/, ''),
      expires_in: config.auth.nonceTtlMinutes * 60,
      needs_phone: config.auth.requirePhone,
    });
  })
);

// GET /api/auth/telegram/status?nonce=… — poll until the bot side completes.
// The parent token is handed over exactly once, then the nonce is burned.
router.get(
  '/telegram/status',
  statusLimiter,
  asyncHandler(async (req, res) => {
    const nonce = String(req.query.nonce || '');
    if (!nonce) throw badRequest('nonce kerak', 'nonce_required');

    const reqRow = await repo.getAuthRequest(nonce);
    // Unknown, expired, or already collected — all indistinguishable to the
    // browser on purpose, and all mean "start over". Without this a consumed
    // nonce would fall through to the pending branch and poll forever.
    if (!reqRow || reqRow.status === 'consumed') return res.json({ status: 'expired' });

    if (reqRow.status === 'linked' && reqRow.token) {
      const claimed = await repo.consumeAuthRequest(nonce);
      if (!claimed) return res.json({ status: 'expired' });
      const parent = await repo.getParentByToken(reqRow.token);
      // Funnel: the login completed. The nonce is burned above, so this runs
      // exactly once per login and is the moment the anonymous visitor becomes
      // a lead — the join that lets the funnel report who never enrolled.
      await repo.recordEvent({
        visitorId: visitorIdOf(req), stage: 'login_done',
        parentId: parent ? parent.id : null,
      });
      return res.json({
        status: 'authorized',
        parent_token: reqRow.token,
        parent: parent ? publicParent(parent) : null,
      });
    }

    // 'awaiting_phone' tells the browser to say "confirm in Telegram" rather
    // than "open Telegram" — the adult is already in the right place.
    return res.json({ status: reqRow.status === 'awaiting_phone' ? 'awaiting_phone' : 'pending' });
  })
);

// GET /api/auth/me — who the browser token belongs to (used on reload).
router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const token = String(req.get('x-parent-token') || req.query.parent_token || '');
    const parent = await repo.getParentByToken(token);
    if (!parent) return res.status(401).json({ error: { code: 'unauthorized', message: 'Tizimga qayta kiring.' } });
    res.json({ parent: publicParent(parent) });
  })
);

// POST /api/auth/logout — drop this browser's login (the Telegram chat stays,
// so the centre keeps its channel; only the web session ends).
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = String(req.get('x-parent-token') || (req.body || {}).parent_token || '');
    if (token) await repo.revokeParentToken(token);
    res.json({ ok: true });
  })
);

module.exports = router;
