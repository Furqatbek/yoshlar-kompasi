'use strict';

const express = require('express');
const router = express.Router();

const { config } = require('../config');
const repo = require('../db/repo');
const { telegram } = require('../services/delivery');
const { reportUrl } = require('../utils/reportUrl');
const { rateLimit, clientIp } = require('../middleware/rateLimit');
const { timingSafeEqual, randomToken } = require('../utils/tokens');
const { normalizeUzPhone } = require('../utils/phone');

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  key: (r) => 'tgwebhook:' + clientIp(r),
  message: 'rate limited',
});

// POST /api/telegram/webhook — completes Telegram delivery when a parent starts
// the bot with the report's share token. Acknowledge fast, process after.
// Fails closed: without a configured shared secret the endpoint is disabled,
// so forged updates can never trigger a send or flip delivery state.
router.post('/webhook', webhookLimiter, (req, res) => {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || '';
  if (!secret) return res.sendStatus(503); // webhook not configured
  if (!timingSafeEqual(req.get('x-telegram-bot-api-secret-token') || '', secret)) {
    return res.sendStatus(401);
  }
  res.json({ ok: true });

  // Report delivery is opt-in via DELIVERY_PROVIDER, but authorization runs
  // through this same bot — so the webhook must keep working for logins even
  // when reports are delivered some other way.
  if (config.delivery.provider !== 'telegram' && !config.auth.required) return;
  const update = req.body;
  telegram
    .handleUpdate(update, {
      findReportByShareToken: async (tok) => {
        if (config.delivery.provider !== 'telegram') return null;
        const r = await repo.getReportByShareToken(tok);
        if (!r) return null;
        return { childNickname: r.nickname, reportUrl: reportUrl(req, tok) };
      },
      markDelivered: async (tok) => repo.markReportDelivered(tok),

      // Login: bind this Telegram chat to the nonce the browser is polling.
      onAuthStart: async ({ nonce, chatId, username, firstName, lastName }) => {
        const reqRow = await repo.getAuthRequest(nonce);
        if (!reqRow || reqRow.status === 'consumed') return null;

        const parent = await repo.upsertParentByTelegram({ chatId, username, firstName, lastName });
        // Consent was ticked in the browser before the link was opened.
        await repo.applyAuthConsent(parent.id, reqRow.marketing_consent, reqRow.consent_text_version);

        const needPhone = config.auth.requirePhone && !parent.phone_verified;
        const bound = await repo.bindAuthRequest(nonce, parent.id, needPhone ? 'awaiting_phone' : 'pending');
        if (!bound) return null;
        if (!needPhone) {
          await repo.completeAuthRequest(nonce, randomToken(32), config.auth.tokenTtlDays);
        }
        return { needPhone };
      },

      // The Share-contact tap: a Telegram-verified number, and the last step of
      // the handshake when a phone is required.
      onContact: async ({ chatId, phone }) => {
        const parent = await repo.getParentByChatId(chatId);
        if (!parent) return { ok: false };
        const saved = await repo.setParentPhone(parent.id, normalizeUzPhone(phone) || phone);
        if (!saved) {
          // The number already belongs to another (legacy) parent row. Keep the
          // Telegram identity and let the login through rather than dead-ending.
          // eslint-disable-next-line no-console
          console.warn('[auth] phone already linked to another parent; leaving it unset');
        }
        const pending = await repo.getPendingAuthRequestForParent(parent.id);
        if (!pending) return { ok: true }; // already authorized in another tab
        const done = await repo.completeAuthRequest(pending.nonce, randomToken(32), config.auth.tokenTtlDays);
        return { ok: !!done };
      },
    })
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[telegram] webhook error: ' + e.message);
    });
});

module.exports = router;
