'use strict';

const express = require('express');
const router = express.Router();

const { config } = require('../config');
const repo = require('../db/repo');
const { telegram } = require('../services/delivery');
const { reportUrl } = require('../utils/reportUrl');
const { rateLimit, clientIp } = require('../middleware/rateLimit');
const { timingSafeEqual } = require('../utils/tokens');

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

  if (config.delivery.provider !== 'telegram') return;
  const update = req.body;
  telegram
    .handleUpdate(update, {
      findReportByShareToken: async (tok) => {
        const r = await repo.getReportByShareToken(tok);
        if (!r) return null;
        return { childNickname: r.nickname, reportUrl: reportUrl(req, tok) };
      },
      markDelivered: async (tok) => repo.markReportDelivered(tok),
    })
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[telegram] webhook error: ' + e.message);
    });
});

module.exports = router;
