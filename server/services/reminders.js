'use strict';

// Telegram reminders for people who stopped partway.
//
// This bot is a channel every parent granted deliberately, by starting it, and
// it is the same channel their report arrives on. Burning it with nagging
// costs more than the sale a reminder might recover — so the rules here are
// strict, and they are enforced in code rather than left to good intentions:
//
//   * one reminder per person per situation, EVER (a unique index, not a flag)
//   * at most `maxPerParentPerWeek` messages to anyone, across all kinds
//   * nothing sent during quiet hours, in the parent's local time
//   * nothing sent about something that happened longer ago than giveUpAfterDays
//   * a working opt-out, honoured for everything automated
//   * a hard ceiling on how many a single run may send
//
// The claim-before-send order matters: a reminder recorded but not delivered
// is a much better failure than one delivered twice.

const { config } = require('../config');
const repo = require('../db/repo');
const { telegram } = require('./delivery');

const KINDS = ['abandoned', 'unpaid', 'never_started'];

// Nobody should be woken up by a marketing message. Times are the parent's,
// which for this product means Uzbekistan — a single timezone, no DST.
function withinQuietHours(date = new Date()) {
  const { quietFromHour, quietToHour, tzOffsetHours } = config.reminders;
  const local = new Date(date.getTime() + tzOffsetHours * 3600 * 1000);
  const h = local.getUTCHours();
  // The window wraps midnight (21:00 -> 09:00), so it is "at or after the
  // start OR before the end", not a simple between.
  if (quietFromHour > quietToHour) return h >= quietFromHour || h < quietToHour;
  return h >= quietFromHour && h < quietToHour;
}

function baseUrl() {
  return String(config.publicBaseUrl || '').replace(/\/+$/, '');
}

// A reminder's whole purpose is the link, and the link now rides on an inline
// button — where a relative URL is not merely useless but rejected outright by
// Telegram. A 400 releases the claim, so we would retry the same broken message
// every run until the give-up window closed. Without an absolute base there is
// nothing worth sending, so we send nothing. PUBLIC_BASE_URL is required in
// production (config.js), so this only bites a half-configured dev box.
const absolute = (u) => /^https?:\/\//i.test(u);

const money = (tiyin) =>
  Math.round(Number(tiyin) / 100).toLocaleString('en-US').replace(/,/g, ' ') + ' so‘m';

// Every message names the child, says what is unfinished, gives one button and
// one way out. No urgency tricks, no second ask.
//
// Returns { text, button } rather than a string: the link rides on an inline
// button instead of sitting raw in the paragraph. The child's name is escaped
// because parse_mode is on — see the note in delivery/telegram.js.
function messageFor(kind, row) {
  const child = telegram.esc(row.nickname || 'farzandingiz');
  const stop = '\n\nEslatmalarni to‘xtatish: /stop';
  if (kind === 'abandoned') {
    return {
      text:
        `<b>${child}</b> bilan boshlagan mashg‘ulot tugallanmay qoldi.\n\n` +
        'Javoblar saqlanib turibdi — istalgan qurilmadan davom ettirsangiz bo‘ladi.' + stop,
      button: { label: 'Davom ettirish', url: baseUrl() + '/mashgulot/' + row.session_token },
    };
  }
  if (kind === 'unpaid') {
    return {
      text:
        `<b>${child}</b> uchun hisobot tayyor.\n\n` +
        'Bepul qismini o‘qigan bo‘lsangiz kerak. To‘liq tahlil — hozirgi o‘rni, ' +
        'iqtidorlar xaritasi, qiziqishlar, o‘rganish usuli va tavsiyalar — ' +
        `${telegram.esc(money(row.amount))} evaziga ochiladi va havola doim ishlaydi.` + stop,
      button: { label: 'Hisobotni ochish', url: baseUrl() + '/hisobot/' + row.share_token },
    };
  }
  if (kind === 'never_started') {
    return {
      text:
        'Ro‘yxatdan o‘tdingiz, lekin mashg‘ulotni hali boshlamadingiz.\n\n' +
        'Bu 15–20 daqiqa oladi va farzandingizning kuchli tomonlari haqida ' +
        'hisobot bilan tugaydi.' + stop,
      button: { label: 'Boshlash', url: baseUrl() + '/boshlash' },
    };
  }
  return null;
}

// messageFor's three branches all build their URL the same way, so the check
// sits once, here, rather than three times above.
const buildMessage = (kind, row) => {
  const m = messageFor(kind, row);
  return m && absolute(m.button.url) ? m : null;
};

// Send one reminder. Claims it first, and gives the claim back if Telegram
// refuses, so a transient failure does not silently consume someone's single
// chance of being reminded.
async function sendOne(kind, row) {
  const claim = await repo.claimReminder({
    parentId: row.parent_id, kind, sessionId: row.session_id || null,
  });
  if (!claim) return { sent: false, reason: 'already_sent' };

  const msg = buildMessage(kind, row);
  if (!msg) { await repo.releaseReminder(claim.id); return { sent: false, reason: 'no_message' }; }

  try {
    const ok = await telegram.sendMessage(row.telegram_chat_id, msg.text, {
      reply_markup: telegram.linkButton(msg.button.label, msg.button.url),
    });
    if (ok === false) throw new Error('telegram refused');
    return { sent: true };
  } catch (err) {
    await repo.releaseReminder(claim.id);
    return { sent: false, reason: (err && err.message) || 'send_failed' };
  }
}

// One pass over all three kinds. Returns what it did, so the cron log is
// worth reading.
async function run({ now = new Date(), dryRun = false } = {}) {
  const r = config.reminders;
  const summary = { skipped: null, sent: 0, failed: 0, byKind: {} };

  if (!r.enabled) { summary.skipped = 'disabled'; return summary; }
  if (!telegram.configured()) { summary.skipped = 'no_bot'; return summary; }
  if (withinQuietHours(now)) { summary.skipped = 'quiet_hours'; return summary; }

  const common = {
    giveUpDays: r.giveUpAfterDays,
    weeklyCap: r.maxPerParentPerWeek,
    limit: r.maxPerRun,
  };
  const queries = {
    abandoned: () => repo.remindersAbandoned({ ...common, afterHours: r.abandonedAfterHours }),
    unpaid: () => repo.remindersUnpaid({ ...common, afterHours: r.unpaidAfterHours }),
    never_started: () => repo.remindersNeverStarted({ ...common, afterHours: r.neverStartedAfterHours }),
  };

  let budget = r.maxPerRun;
  for (const kind of KINDS) {
    const rows = budget > 0 ? await queries[kind]() : [];
    let sent = 0, failed = 0;
    for (const row of rows) {
      if (budget <= 0) break;
      if (dryRun) { sent++; budget--; continue; }
      const res = await sendOne(kind, row);
      if (res.sent) { sent++; budget--; } else if (res.reason !== 'already_sent') failed++;
    }
    summary.byKind[kind] = { candidates: rows.length, sent, failed };
    summary.sent += sent;
    summary.failed += failed;
  }
  return summary;
}

module.exports = { run, sendOne, messageFor, buildMessage, withinQuietHours, KINDS };
