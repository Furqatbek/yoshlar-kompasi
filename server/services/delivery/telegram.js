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

// Login deep link. The `auth_` prefix lets /start tell a login apart from a
// report share token. Share tokens are base64url, so one could in principle
// begin with "auth_" — handleUpdate therefore falls back to the report path
// when the nonce lookup misses, rather than trusting the prefix alone.
const AUTH_PREFIX = 'auth_';
function authLink(nonce) {
  return deepLink(AUTH_PREFIX + nonce);
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

// A Telegram message is a message, not a page: one short paragraph, one button.
//
// Everything interpolated is escaped. A child's nickname is user input, and an
// unescaped "<" makes Telegram reject the whole send with a 400 — which for a
// reminder releases the claim and leaves us retrying the same broken message
// until the give-up window closes.
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Links ride on a button rather than sitting raw in the text: it is the native
// affordance, and a long URL wraps badly on the phone these are all read on.
const linkButton = (label, url) => ({ inline_keyboard: [[{ text: label, url }]] });

async function sendMessage(chatId, text, extra) {
  return apiCall('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    // No preview card. /hisobot/:token 302s to a hash route and the crawler
    // does not run JS, so the card is a content-free repeat of the site title
    // under every message. Serving real metadata is not the fix either: the
    // card would carry the child's name into every chat the link reaches, and
    // this product asks for a first name precisely so there is nothing to leak.
    disable_web_page_preview: true,
    ...(extra || {}),
  });
}

// One-tap phone sharing. Telegram fills the number from the account itself, so
// it arrives verified — no OTP round-trip, no typos.
const CONTACT_KEYBOARD = {
  keyboard: [[{ text: '📱 Telefon raqamni ulashish', request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};
const HIDE_KEYBOARD = { remove_keyboard: true };

// What the parent is handed at the moment they trust us most. The landing page
// states the split before they spend the evening; saying nothing here and
// letting them discover eight locked sections after tapping would undo exactly
// that. So when the report is sold, the message says so — before the tap.
function reportMessage(childNickname, url) {
  const name = esc(childNickname);
  const lines = ['<b>' + name + '</b> uchun hisobot tayyor.'];
  if (config.payments.enabled) {
    const price = Number(config.payments.priceUzs).toLocaleString('en-US').replace(/,/g, ' ') + ' so‘m';
    lines.push(
      'Bepul: kuchli tomonlari va ' + name + ' uchun xat.\n' +
      'Qolgan sakkiz qism — ' + esc(price) + ', bir marta. Havola doim ishlaydi.'
    );
  } else {
    lines.push('O‘n qismning hammasi ochiq. Havola doim ishlaydi.');
  }
  lines.push('3 oydan so‘ng qayta baholab ko‘rishni tavsiya qilamiz.');
  return { text: lines.join('\n\n'), reply_markup: linkButton('Hisobotni ochish', url) };
}

const provider = {
  name: 'telegram',
  async deliver({ reportUrl, shareToken, chatId, childNickname }) {
    if (!configured()) {
      // No bot configured — let the caller fall back to console.
      return { status: 'skipped', channel: 'telegram', reason: 'not_configured' };
    }
    // Since authorization happens up front we usually already hold the chat id,
    // so the report can be pushed immediately instead of waiting for the parent
    // to discover a deep link.
    if (chatId) {
      const m = reportMessage(childNickname, reportUrl);
      await sendMessage(chatId, m.text, { reply_markup: m.reply_markup });
      return { status: 'sent', channel: 'telegram' };
    }
    // Legacy parents (contact-gate era) have no chat: hand back the deep link
    // and let the /start handler finish delivery.
    return { status: 'pending', channel: 'telegram', link: deepLink(shareToken), reportUrl };
  },
};

// Webhook update handler. `deps` provides DB access without a circular import.
//   deps.findReportByShareToken(token) -> { childNickname, reportUrl } | null
//   deps.markDelivered(shareToken)
//   deps.onAuthStart({ nonce, chatId, username, firstName, lastName })
//       -> { needPhone } | null   (null = unknown or expired nonce)
//   deps.onContact({ chatId, phone }) -> { ok }
async function handleUpdate(update, deps) {
  const msg = update && update.message;
  if (!msg) return;
  const chatId = msg.chat && msg.chat.id;
  if (!chatId) return;

  // 1. A shared contact completes a login that was waiting on a phone number.
  if (msg.contact) {
    // Telegram lets a user forward somebody else's contact card; only a card
    // about the sender is a verified phone for THIS account.
    if (msg.contact.user_id && msg.from && msg.contact.user_id !== msg.from.id) {
      await sendMessage(chatId, 'Iltimos, o‘zingizning raqamingizni ulashing.', {
        reply_markup: CONTACT_KEYBOARD,
      }).catch(() => {});
      return;
    }
    const res = await deps.onContact({ chatId, phone: msg.contact.phone_number });
    await sendMessage(
      chatId,
      res && res.ok
        ? 'Rahmat! Ro‘yxatdan o‘tdingiz. Endi brauzerdagi sahifaga qayting — mashg‘ulotni boshlashingiz mumkin.'
        : 'Raqamni saqlab bo‘lmadi. Iltimos, saytdagi «Telegram orqali kirish» tugmasini qayta bosing.',
      { reply_markup: HIDE_KEYBOARD }
    ).catch(() => {});
    return;
  }

  if (!msg.text) return;

  // 2. /stop — the opt-out. It must work on the first try, with no argument
  // and no follow-up question, because a person who types it has already
  // decided. Report delivery is unaffected: that is something they asked for.
  if (/^\/stop\b/i.test(msg.text.trim())) {
    const ok = deps.onStop ? await deps.onStop({ chatId }) : false;
    await sendMessage(
      chatId,
      ok
        ? 'Eslatmalar to‘xtatildi. Hisobotlaringiz avvalgidek yetkaziladi.'
        : 'Eslatmalar allaqachon o‘chirilgan.'
    ).catch(() => {});
    return;
  }

  const m = /^\/start(?:\s+(\S+))?/.exec(msg.text.trim());
  const payload = m && m[1];
  if (!payload) {
    await sendMessage(
      chatId,
      'Salom! Bu — «Yosh Iste‘dodlar Kompasi» boti. Boshlash uchun saytdagi «Telegram orqali kirish» tugmasini bosing.'
    ).catch(() => {});
    return;
  }

  // 2. Login deep link. A miss falls through to the report path below, because
  // a base64url share token could itself begin with "auth_".
  if (payload.startsWith(AUTH_PREFIX)) {
    const from = msg.from || {};
    const res = await deps.onAuthStart({
      nonce: payload.slice(AUTH_PREFIX.length),
      chatId,
      username: from.username || null,
      firstName: from.first_name || null,
      lastName: from.last_name || null,
    });
    if (res) {
      // A Telegram display name is whatever its owner typed, so it is escaped
      // like any other untrusted value now that parse_mode is on.
      const hi = 'Salom' + (from.first_name ? ', ' + esc(from.first_name) : '') + '! «Yosh Iste‘dodlar Kompasi»ga xush kelibsiz.';
      if (res.needPhone) {
        await sendMessage(
          chatId,
          hi + '\n\nRo‘yxatdan o‘tishni yakunlash uchun pastdagi tugma orqali telefon raqamingizni ulashing. ' +
            'Raqam hisobotni yuborish va eslatmalar uchun kerak bo‘ladi.',
          { reply_markup: CONTACT_KEYBOARD }
        ).catch(() => {});
      } else {
        await sendMessage(chatId, hi + '\n\nTayyor! Brauzerdagi sahifaga qayting — mashg‘ulotni boshlashingiz mumkin.', {
          reply_markup: HIDE_KEYBOARD,
        }).catch(() => {});
      }
      return;
    }
  }

  // 3. Report share token (the original delivery flow).
  const rep = await deps.findReportByShareToken(payload);
  if (!rep) {
    await sendMessage(
      chatId,
      payload.startsWith(AUTH_PREFIX)
        ? 'Bu havola eskirgan. Iltimos, saytdagi «Telegram orqali kirish» tugmasini qayta bosing.'
        : 'Kechirasiz, bu hisobot topilmadi yoki muddati o‘tgan.'
    ).catch(() => {});
    return;
  }
  const rm = reportMessage(rep.childNickname, rep.reportUrl);
  await sendMessage(chatId, rm.text, { reply_markup: rm.reply_markup });
  await deps.markDelivered(payload);
}

module.exports = {
  name: 'telegram', provider, configured, deepLink, authLink, AUTH_PREFIX,
  sendMessage, handleUpdate, reportMessage, esc, linkButton,
};
