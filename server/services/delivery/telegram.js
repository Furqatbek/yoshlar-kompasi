'use strict';

// Telegram delivery (backend-spec §5). Without a chat_id we cannot push to a
// parent cold, so delivery is a deep link: the parent taps t.me/<bot>?start=
// <share_token>, and the bot's /start handler (webhook below) sends the report
// and becomes a re-engagement channel for the centre.

const { config } = require('../../config');

function configured() {
  return !!(config.delivery.telegram.botToken && config.delivery.telegram.botUsername);
}

function deepLink(shareToken) {
  const u = config.delivery.telegram.botUsername.replace(/^@/, '');
  return 'https://t.me/' + u + '?start=' + encodeURIComponent(shareToken);
}

async function apiCall(method, payload) {
  const url = 'https://api.telegram.org/bot' + config.delivery.telegram.botToken + '/' + method;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error('telegram ' + method + ' failed: ' + (data.description || res.status));
  }
  return data.result;
}

async function sendMessage(chatId, text) {
  return apiCall('sendMessage', { chat_id: chatId, text, disable_web_page_preview: false });
}

const provider = {
  name: 'telegram',
  async deliver({ reportUrl, shareToken }) {
    if (!configured()) {
      // No bot configured — let the caller fall back to console.
      return { status: 'skipped', channel: 'telegram', reason: 'not_configured' };
    }
    // The push happens when the parent starts the bot; hand back the deep link.
    return { status: 'pending', channel: 'telegram', link: deepLink(shareToken), reportUrl };
  },
};

// Webhook update handler. `deps` provides DB access without a circular import.
//   deps.findReportByShareToken(token) -> { childNickname, reportUrl } | null
//   deps.markDelivered(shareToken)
async function handleUpdate(update, deps) {
  const msg = update && update.message;
  if (!msg || !msg.text) return;
  const chatId = msg.chat && msg.chat.id;
  const m = /^\/start\s+(\S+)/.exec(msg.text.trim());
  if (!m) {
    if (chatId) {
      await sendMessage(chatId, 'Salom! Hisobotni olish uchun ilovadagi "Telegram orqali olish" tugmasini bosing.').catch(() => {});
    }
    return;
  }
  const shareToken = m[1];
  const rep = await deps.findReportByShareToken(shareToken);
  if (!rep) {
    await sendMessage(chatId, 'Kechirasiz, bu hisobot topilmadi yoki muddati o‘tgan.').catch(() => {});
    return;
  }
  const text =
    'Salom! ' + rep.childNickname + ' uchun "Yosh Iste‘dodlar Kompasi" hisoboti tayyor.\n\n' +
    'Hisobotni shu havolada ochishingiz mumkin:\n' + rep.reportUrl + '\n\n' +
    '3 oydan so‘ng qayta baholab ko‘rishni tavsiya qilamiz.';
  await sendMessage(chatId, text);
  await deps.markDelivered(shareToken);
}

module.exports = { name: 'telegram', provider, configured, deepLink, sendMessage, handleUpdate };
