// Paid reports, end to end.
//
// Payme's integration is inbound: Payme calls US. So there is nothing to stub —
// this driver simply plays Payme, sending the same JSON-RPC calls in the same
// order, and checks both the protocol answers and what they do to the report.
//
// What must still be checked against Payme's own sandbox before this touches
// real money: their test suite drives edge cases (amount rounding, concurrent
// cancels, statement ranges) against a registered merchant, and the account
// field name here must match the one configured in the merchant cabinet.

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8091';
const MERCHANT_KEY = process.env.PAYME_MERCHANT_KEY || 'test-payme-key';
const PRICE_UZS = Number(process.env.REPORT_PRICE_UZS || 49000);
const PRICE_TIYIN = PRICE_UZS * 100;

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  ok  - ' : '  FAIL- ') + n + (x ? '   ' + x : '')); };

const j = async (method, path, body, headers) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(headers || {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data };
};

// One Payme RPC call, authenticated the way Payme authenticates.
// `auth: null` sends no Authorization header at all — note that passing
// undefined would silently fall back to the valid default.
let rpcId = 0;
const basic = 'Basic ' + Buffer.from('Paycom:' + MERCHANT_KEY).toString('base64');
const rpc = (method, params, auth = basic) =>
  j('POST', '/api/payments/payme', { jsonrpc: '2.0', id: ++rpcId, method, params },
    auth === null ? {} : { authorization: auth });

const { authorize } = require('./auth-helper');

(async () => {
  // ---- produce a real, finished report ------------------------------------
  const parentToken = await authorize(BASE, {
    chatId: 844000555, phone: '+998901234500', firstName: 'Tolov', lastName: 'Sinov',
  });
  const sess = await j('POST', '/api/sessions',
    { consent: true, nickname: 'Sardor', grade: 3 }, { 'x-parent-token': parentToken });
  const stok = sess.data.session_token;
  await j('POST', '/api/sessions/' + stok + '/messages', { content: 'Sardor: kvadrat' },
    { 'x-session-token': stok });
  const rep = await j('POST', '/api/sessions/' + stok + '/report', {}, { 'x-session-token': stok });
  ok('a report is produced', rep.status === 200 && !!rep.data.share_token, 'status=' + rep.status);
  const share = rep.data.share_token;

  // ---- the paywall --------------------------------------------------------
  let view = (await j('GET', '/api/reports/' + share)).data;
  ok('the report reads as locked', view.locked === true);
  ok('  the child\'s portrait is still shown', /##\s*Surat/.test(view.content_md || ''), (view.content_md || '').slice(0, 40));
  ok('  the locked sections are named', Array.isArray(view.locked_sections) && view.locked_sections.length > 0,
    JSON.stringify(view.locked_sections));
  ok('  the price is quoted', view.price_uzs === PRICE_UZS, String(view.price_uzs));
  ok('  the levels are withheld', view.levels && view.levels.logic === null, JSON.stringify(view.levels));
  ok('  the sports are withheld', Array.isArray(view.sports) && view.sports.length === 0, JSON.stringify(view.sports));

  const checkout = await j('POST', '/api/reports/' + share + '/checkout', {});
  ok('checkout returns somewhere to pay', checkout.status === 200 && !!checkout.data.checkout_url);
  ok('  the amount matches the price', checkout.data.amount_uzs === PRICE_UZS, String(checkout.data.amount_uzs));
  const orderId = checkout.data.order_id;
  ok('  and an order id to pay against', !!orderId);
  // The checkout link carries merchant, account and amount, base64 encoded.
  const encoded = String(checkout.data.checkout_url).split('/').pop();
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  ok('  the link encodes the order and the amount in tiyin',
    decoded.includes('ac.order_id=' + orderId) && decoded.includes('a=' + PRICE_TIYIN), decoded);

  // ---- authentication -----------------------------------------------------
  const noAuth = await rpc('CheckPerformTransaction', {}, 'Basic ' + Buffer.from('Paycom:wrong').toString('base64'));
  ok('a wrong merchant key is refused', noAuth.data.error && noAuth.data.error.code === -32504,
    JSON.stringify(noAuth.data.error));
  ok('  and the refusal is a 200 JSON-RPC error, not an HTTP error',
    noAuth.status === 200, 'status=' + noAuth.status);
  const noHeader = await rpc('CheckPerformTransaction', {}, null);
  ok('  a missing header is refused too', noHeader.data.error && noHeader.data.error.code === -32504);

  const badMethod = await rpc('DoSomethingElse', {});
  ok('an unknown method is refused', badMethod.data.error && badMethod.data.error.code === -32601);

  // ---- CheckPerformTransaction -------------------------------------------
  const acc = { account: { order_id: orderId } };
  const unknown = await rpc('CheckPerformTransaction', { amount: PRICE_TIYIN, account: { order_id: '11111111-1111-4111-8111-111111111111' } });
  ok('an unknown order is refused', unknown.data.error && unknown.data.error.code === -31050,
    JSON.stringify(unknown.data.error));

  const wrongAmount = await rpc('CheckPerformTransaction', { amount: 1, ...acc });
  ok('the wrong amount is refused', wrongAmount.data.error && wrongAmount.data.error.code === -31001);

  const canPay = await rpc('CheckPerformTransaction', { amount: PRICE_TIYIN, ...acc });
  ok('a real order may be paid', canPay.data.result && canPay.data.result.allow === true,
    JSON.stringify(canPay.data));

  // ---- CreateTransaction --------------------------------------------------
  const TXN = 'payme_txn_' + Date.now();
  const created = await rpc('CreateTransaction', { id: TXN, time: Date.now(), amount: PRICE_TIYIN, ...acc });
  ok('a transaction is created in state 1', created.data.result && created.data.result.state === 1,
    JSON.stringify(created.data));
  ok('  with a create_time', created.data.result.create_time > 0);

  // Payme retries on any timeout; a retry must not open a second transaction.
  const retry = await rpc('CreateTransaction', { id: TXN, time: Date.now(), amount: PRICE_TIYIN, ...acc });
  ok('a retried create returns the same transaction',
    retry.data.result && retry.data.result.transaction === created.data.result.transaction,
    JSON.stringify(retry.data.result));
  ok('  and does not move its create_time',
    retry.data.result.create_time === created.data.result.create_time);

  // Two live transactions against one order would let it be paid twice.
  const second = await rpc('CreateTransaction', { id: TXN + '_other', time: Date.now(), amount: PRICE_TIYIN, ...acc });
  ok('a second transaction on the same order is refused',
    second.data.error && second.data.error.code === -31008, JSON.stringify(second.data.error));

  // Still locked: creating a transaction only reserves the money.
  view = (await j('GET', '/api/reports/' + share)).data;
  ok('the report stays locked until the payment is performed', view.locked === true);

  // ---- PerformTransaction -------------------------------------------------
  const performed = await rpc('PerformTransaction', { id: TXN });
  ok('performing moves it to state 2', performed.data.result && performed.data.result.state === 2,
    JSON.stringify(performed.data));
  ok('  with a perform_time', performed.data.result.perform_time > 0);

  view = (await j('GET', '/api/reports/' + share)).data;
  ok('THE REPORT UNLOCKS', view.locked === false);
  ok('  the full markdown is served', /Hozirgi o‘rni|Hozirgi o/.test(view.content_md || ''),
    (view.content_md || '').slice(0, 60));
  ok('  locked_sections is gone', view.locked_sections === undefined);
  // The parsed findings, asserted here rather than in e2e-driver because this
  // is the only place a report is unlocked. The values come from the stub's
  // fixed report, so they are exact.
  ok('  the parsed levels come back intact',
    view.levels && view.levels.logic === 'kuchli' && view.levels.activity === 'shakllanmoqda',
    JSON.stringify(view.levels));
  ok('  and the parsed sports', Array.isArray(view.sports) && view.sports.length === 2,
    JSON.stringify(view.sports));
  ok('  with the json block and markers still stripped',
    !/```json/.test(view.content_md || '') && !/YAKUN/.test(view.content_md || ''));

  const performAgain = await rpc('PerformTransaction', { id: TXN });
  ok('performing twice is idempotent',
    performAgain.data.result && performAgain.data.result.state === 2
      && performAgain.data.result.perform_time === performed.data.result.perform_time,
    JSON.stringify(performAgain.data.result));

  const checkoutPaid = await j('POST', '/api/reports/' + share + '/checkout', {});
  ok('checkout on a paid report says so', checkoutPaid.data.paid === true, JSON.stringify(checkoutPaid.data));

  // ---- CheckTransaction / GetStatement ------------------------------------
  const checked = await rpc('CheckTransaction', { id: TXN });
  ok('CheckTransaction reports the state', checked.data.result && checked.data.result.state === 2);
  const missing = await rpc('CheckTransaction', { id: 'no-such-txn' });
  ok('  an unknown transaction is -31003', missing.data.error && missing.data.error.code === -31003);

  const stmt = await rpc('GetStatement', { from: Date.now() - 3600e3, to: Date.now() + 1000 });
  ok('GetStatement lists the transaction',
    stmt.data.result && stmt.data.result.transactions.some((t) => t.id === TXN),
    JSON.stringify((stmt.data.result || {}).transactions || []));
  const stmtEmpty = await rpc('GetStatement', { from: 1, to: 2 });
  ok('  and is empty outside the range', stmtEmpty.data.result.transactions.length === 0);

  // ---- CancelTransaction (a refund) --------------------------------------
  const cancelled = await rpc('CancelTransaction', { id: TXN, reason: 5 });
  ok('cancelling a performed transaction records -2 (a refund)',
    cancelled.data.result && cancelled.data.result.state === -2, JSON.stringify(cancelled.data));
  ok('  with a cancel_time and the reason', cancelled.data.result.cancel_time > 0 && cancelled.data.result.reason === 5);

  view = (await j('GET', '/api/reports/' + share)).data;
  ok('a refund re-locks the report', view.locked === true);

  const cancelAgain = await rpc('CancelTransaction', { id: TXN, reason: 5 });
  ok('cancelling twice is idempotent',
    cancelAgain.data.result && cancelAgain.data.result.state === -2
      && cancelAgain.data.result.cancel_time === cancelled.data.result.cancel_time);

  const cancelMissing = await rpc('CancelTransaction', { id: 'no-such-txn' });
  ok('  cancelling an unknown transaction is -31003',
    cancelMissing.data.error && cancelMissing.data.error.code === -31003);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
