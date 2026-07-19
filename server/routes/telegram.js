'use strict';

const express = require('express');
const router = express.Router();

const { config } = require('../config');
const repo = require('../db/repo');
const { telegram } = require('../services/delivery');
const { reportUrl } = require('../utils/reportUrl');

// POST /api/telegram/webhook — completes Telegram delivery when a parent starts
// the bot with the report's share token. Acknowledge fast, process after.
router.post('/webhook', (req, res) => {
  // Optional shared-secret check (set the same value when calling setWebhook).
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || '';
  if (secret && req.get('x-telegram-bot-api-secret-token') !== secret) {
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
