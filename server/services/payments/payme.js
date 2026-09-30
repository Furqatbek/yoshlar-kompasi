'use strict';

// Payme (paycom.uz) Merchant API.
//
// Payme is the dominant card-payment rail in Uzbekistan. Its integration is
// inverted from most gateways: Payme calls US. Our endpoint implements a
// JSON-RPC interface that Payme drives through the transaction's whole life,
// and it authenticates with HTTP Basic "Paycom:<merchant key>" — so the key is
// a shared secret we verify, never something a browser sees.
//
// The one thing to keep straight while reading this: Payme's transaction
// states are its own, and we store them unchanged (see migration 004).
//
//   1  created    — money reserved, report still locked
//   2  performed  — paid, report unlocked
//  -1  cancelled from `created`
//  -2  cancelled after `performed` (a refund)
//
// Times are milliseconds since the epoch, because that is what Payme sends and
// what it expects back in CheckTransaction.

const { config } = require('../../config');

// JSON-RPC and Payme error codes. The -31050 range is the merchant's own, used
// here for "that order does not exist".
const ERR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  UNAUTHORIZED: -32504,
  INVALID_AMOUNT: -31001,
  TXN_NOT_FOUND: -31003,
  CANNOT_CANCEL: -31007,
  CANNOT_PERFORM: -31008,
  ORDER_NOT_FOUND: -31050,
};

// Payme shows these to the payer, so all three languages are filled in.
const MESSAGES = {
  [ERR.UNAUTHORIZED]: { uz: 'Ruxsat yo‘q', ru: 'Недостаточно привилегий', en: 'Insufficient privileges' },
  [ERR.METHOD_NOT_FOUND]: { uz: 'Metod topilmadi', ru: 'Метод не найден', en: 'Method not found' },
  [ERR.INVALID_AMOUNT]: { uz: 'Noto‘g‘ri summa', ru: 'Неверная сумма', en: 'Invalid amount' },
  [ERR.TXN_NOT_FOUND]: { uz: 'Tranzaksiya topilmadi', ru: 'Транзакция не найдена', en: 'Transaction not found' },
  [ERR.CANNOT_CANCEL]: { uz: 'Bekor qilib bo‘lmaydi', ru: 'Невозможно отменить', en: 'Unable to cancel' },
  [ERR.CANNOT_PERFORM]: { uz: 'Amalni bajarib bo‘lmaydi', ru: 'Невозможно выполнить операцию', en: 'Unable to perform operation' },
  [ERR.ORDER_NOT_FOUND]: { uz: 'Buyurtma topilmadi', ru: 'Заказ не найден', en: 'Order not found' },
};

// The account field Payme sends back in `params.account`. It must match the
// field name configured in the merchant cabinet.
const ACCOUNT_FIELD = 'order_id';

// Payme's own rule: a transaction still sitting in `created` after 12 hours is
// dead and must be refused with a cancellation.
const TXN_TIMEOUT_MS = 12 * 60 * 60 * 1000;

function configured() {
  return !!(config.payments.payme.merchantId && config.payments.payme.merchantKey);
}

function rpcError(code, extra) {
  const err = { code, message: MESSAGES[code] || { uz: 'Xatolik', ru: 'Ошибка', en: 'Error' } };
  if (extra && extra.data) err.data = extra.data;
  return err;
}

// Verifies the Basic credentials Payme sends. Constant-time compare: this is a
// bearer secret on a public endpoint, and a timing oracle on it is free to
// exploit and cheap to prevent.
function authorize(header) {
  if (!configured()) return false;
  const m = /^Basic\s+(.+)$/i.exec(String(header || ''));
  if (!m) return false;
  let decoded = '';
  try { decoded = Buffer.from(m[1], 'base64').toString('utf8'); } catch (e) { return false; }
  const idx = decoded.indexOf(':');
  if (idx < 0) return false;
  const login = decoded.slice(0, idx);
  const key = decoded.slice(idx + 1);
  if (login !== 'Paycom') return false;
  const a = Buffer.from(key);
  const b = Buffer.from(config.payments.payme.merchantKey);
  if (a.length !== b.length) return false;
  return require('crypto').timingSafeEqual(a, b);
}

// The link the parent opens to pay.
//
// Payme's checkout takes one base64 parameter holding a semicolon-separated
// list: merchant id, the account fields, the amount in tiyin, and where to
// send the payer afterwards.
function checkoutUrl(order, { shareToken, req } = {}) {
  const back = returnUrl(shareToken, req);
  const parts = [
    'm=' + config.payments.payme.merchantId,
    'ac.' + ACCOUNT_FIELD + '=' + order.id,
    'a=' + String(order.amount),
    'l=uz',
  ];
  if (back) parts.push('c=' + back);
  const payload = Buffer.from(parts.join(';'), 'utf8').toString('base64');
  return config.payments.payme.checkoutUrl.replace(/\/+$/, '') + '/' + payload;
}

// Where Payme sends the payer once they are done. Back to their own report,
// which by then has unlocked.
function returnUrl(shareToken, req) {
  const base = config.publicBaseUrl
    || (req ? req.protocol + '://' + req.get('host') : '');
  if (!base || !shareToken) return '';
  return base.replace(/\/+$/, '') + '/hisobot/' + shareToken;
}

// The shape CheckTransaction and CreateTransaction return for a transaction.
function txnResult(payment, extra) {
  return {
    create_time: Number(payment.create_time) || 0,
    perform_time: Number(payment.perform_time) || 0,
    cancel_time: Number(payment.cancel_time) || 0,
    transaction: String(payment.id),
    state: Number(payment.state),
    reason: payment.reason == null ? null : Number(payment.reason),
    ...(extra || {}),
  };
}

module.exports = {
  ERR, MESSAGES, ACCOUNT_FIELD, TXN_TIMEOUT_MS,
  configured, authorize, rpcError, checkoutUrl, returnUrl, txnResult,
};
