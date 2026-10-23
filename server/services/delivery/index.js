'use strict';

// Delivery provider selection. `deliver()` never throws into the request path —
// a failed delivery must not fail report generation; it just reports a status.

const { config } = require('../../config');
const consoleProvider = require('./console');
const telegram = require('./telegram');

function selected() {
  return config.delivery.provider === 'telegram' ? telegram.provider : consoleProvider;
}

async function deliver(args) {
  const primary = selected();
  try {
    const res = await primary.deliver(args);
    // If Telegram isn't configured it returns 'skipped' — fall back to console.
    if (res && res.status === 'skipped') {
      return consoleProvider.deliver(args);
    }
    return res;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[delivery] ' + primary.name + ' error: ' + err.message);
    return { status: 'error', channel: primary.name, detail: err.message };
  }
}

// The moment a paid report becomes the buyer's.
//
// On a paid deployment nothing is unlocked when the report is written, so the
// delivery at that point is a message and a link — correct, and the parent then
// pays and gets nothing new in the chat. This pushes the file when it becomes
// theirs, which is the one moment they are certainly looking at their phone.
//
// Best effort, and deliberately not awaited by the caller: this runs inside
// Payme's PerformTransaction, which must answer promptly and must not fail
// because Telegram was slow — a failed RPC there means Payme retries a payment
// that already succeeded.
async function pushPaidReport(orderId) {
  if (config.delivery.provider !== 'telegram' || !telegram.configured()) return;
  const repo = require('../../db/repo');
  const row = await repo.getPaidReportTarget(orderId);
  if (!row || !row.telegram_chat_id) return;

  const base = String(config.publicBaseUrl || '').replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) return; // a button needs an absolute URL

  const d = await require('../reportFile').forDelivery(row);
  await telegram.provider.deliver({
    reportUrl: base + '/hisobot/' + row.share_token,
    shareToken: row.share_token,
    chatId: row.telegram_chat_id,
    childNickname: row.nickname,
    unlocked: d.unlocked,
    getDocument: d.document ? async () => d.document : null,
  });
  await repo.markReportDelivered(row.share_token);
}

module.exports = { deliver, telegram, pushPaidReport };
