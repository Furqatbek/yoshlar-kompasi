'use strict';

// POST /api/payments/payme — the Merchant API endpoint Payme calls.
//
// Payme drives the whole transaction from its side; this endpoint answers.
// The sequence for a successful payment:
//
//   CheckPerformTransaction  "can this order be paid?"      -> {allow: true}
//   CreateTransaction        "I am holding the money"       -> state 1
//   PerformTransaction       "money taken, deliver it"      -> state 2, report unlocks
//
// and at any point CancelTransaction, plus CheckTransaction and GetStatement
// for reconciliation.
//
// Two rules govern everything here:
//
//   1. Every method is idempotent. Payme retries on any timeout, and a retried
//      CreateTransaction must return the transaction it already made rather
//      than open a second one against the same order.
//   2. Errors are JSON-RPC errors with Payme's codes inside an HTTP 200. A
//      404 or a 500 is not a protocol answer and gets read as a failed
//      merchant, which suspends the account.

const express = require('express');
const router = express.Router();

const { config } = require('../config');
const repo = require('../db/repo');
const payme = require('../services/payments/payme');
const { ERR, ACCOUNT_FIELD, TXN_TIMEOUT_MS } = payme;

const now = () => Date.now();

// Payme's cancellation reasons. 4 is "transaction timed out".
const REASON_TIMEOUT = 4;

async function orderFromAccount(params) {
  const account = (params && params.account) || {};
  const id = account[ACCOUNT_FIELD];
  // A malformed uuid would make the lookup throw; treat it as "no such order",
  // which is what it is.
  if (!id || !/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  return repo.getOrder(String(id));
}

// --- methods ---------------------------------------------------------------

async function checkPerformTransaction(params) {
  const order = await orderFromAccount(params);
  if (!order) throw payme.rpcError(ERR.ORDER_NOT_FOUND, { data: ACCOUNT_FIELD });
  if (Number(params.amount) !== Number(order.amount)) throw payme.rpcError(ERR.INVALID_AMOUNT);
  if (order.state === 'paid') throw payme.rpcError(ERR.CANNOT_PERFORM);
  return { allow: true };
}

async function createTransaction(params) {
  const existing = await repo.getPaymentByTxn('payme', String(params.id));
  if (existing) {
    // A retry. Answer with the transaction we already have — unless it has
    // since been cancelled, which cannot be resurrected.
    if (Number(existing.state) !== 1) throw payme.rpcError(ERR.CANNOT_PERFORM);
    // Payme's own timeout: a transaction left in `created` too long is dead.
    if (now() - Number(existing.create_time) > TXN_TIMEOUT_MS) {
      await repo.cancelPayment(existing.id, { state: -1, reason: REASON_TIMEOUT, cancelTime: now() });
      throw payme.rpcError(ERR.CANNOT_PERFORM);
    }
    return payme.txnResult(existing);
  }

  const order = await orderFromAccount(params);
  if (!order) throw payme.rpcError(ERR.ORDER_NOT_FOUND, { data: ACCOUNT_FIELD });
  if (Number(params.amount) !== Number(order.amount)) throw payme.rpcError(ERR.INVALID_AMOUNT);
  if (order.state === 'paid') throw payme.rpcError(ERR.CANNOT_PERFORM);

  // One live transaction per order. Without this an order could collect two
  // and be paid twice.
  const live = await repo.activePaymentForOrder(order.id);
  if (live) throw payme.rpcError(ERR.CANNOT_PERFORM);

  const created = await repo.createPayment({
    orderId: order.id,
    txnId: String(params.id),
    providerTime: Number(params.time) || null,
    amount: Number(params.amount),
    createTime: now(),
  });
  return payme.txnResult(created);
}

async function performTransaction(params) {
  const p = await repo.getPaymentByTxn('payme', String(params.id));
  if (!p) throw payme.rpcError(ERR.TXN_NOT_FOUND);

  // Already performed: answer with the same result. Payme retries this.
  if (Number(p.state) === 2) return payme.txnResult(p);
  if (Number(p.state) !== 1) throw payme.rpcError(ERR.CANNOT_PERFORM);

  if (now() - Number(p.create_time) > TXN_TIMEOUT_MS) {
    await repo.cancelPayment(p.id, { state: -1, reason: REASON_TIMEOUT, cancelTime: now() });
    throw payme.rpcError(ERR.CANNOT_PERFORM);
  }

  const performed = await repo.performPayment(p.id, now());
  // This is the moment the parent has bought the report.
  await repo.markOrderPaid(p.order_id);
  return payme.txnResult(performed);
}

async function cancelTransaction(params) {
  const p = await repo.getPaymentByTxn('payme', String(params.id));
  if (!p) throw payme.rpcError(ERR.TXN_NOT_FOUND);

  // Idempotent: a second cancel returns the first one's result.
  if (Number(p.state) < 0) return payme.txnResult(p);

  // -1 cancels a transaction that only ever held the money; -2 records a
  // reversal of one that was already performed, i.e. a refund.
  const state = Number(p.state) === 2 ? -2 : -1;
  const cancelled = await repo.cancelPayment(p.id, {
    state, reason: params.reason == null ? null : Number(params.reason), cancelTime: now(),
  });
  // A refund re-locks the report: the order is no longer paid.
  await repo.markOrderCancelled(p.order_id);
  return payme.txnResult(cancelled);
}

async function checkTransaction(params) {
  const p = await repo.getPaymentByTxn('payme', String(params.id));
  if (!p) throw payme.rpcError(ERR.TXN_NOT_FOUND);
  return payme.txnResult(p);
}

async function getStatement(params) {
  const rows = await repo.paymentsBetween(Number(params.from) || 0, Number(params.to) || 0);
  return {
    transactions: rows.map((p) => ({
      id: p.provider_txn_id,
      time: Number(p.provider_time) || Number(p.create_time),
      amount: Number(p.amount),
      account: { [ACCOUNT_FIELD]: p.order_id },
      ...payme.txnResult(p),
    })),
  };
}

const METHODS = {
  CheckPerformTransaction: checkPerformTransaction,
  CreateTransaction: createTransaction,
  PerformTransaction: performTransaction,
  CancelTransaction: cancelTransaction,
  CheckTransaction: checkTransaction,
  GetStatement: getStatement,
};

// --- transport -------------------------------------------------------------

router.post('/payme', async (req, res) => {
  const body = req.body || {};
  const id = body.id == null ? null : body.id;
  const send = (payload) => res.status(200).json({ jsonrpc: '2.0', id, ...payload });

  if (!payme.configured()) return send({ error: payme.rpcError(ERR.UNAUTHORIZED) });
  // Authenticate before looking at anything else: this endpoint exposes order
  // state and moves money, and it is public by necessity.
  if (!payme.authorize(req.get('authorization'))) {
    return send({ error: payme.rpcError(ERR.UNAUTHORIZED) });
  }

  const fn = METHODS[body.method];
  if (!fn) return send({ error: payme.rpcError(ERR.METHOD_NOT_FOUND) });

  try {
    return send({ result: await fn(body.params || {}) });
  } catch (err) {
    // A thrown rpcError is a protocol answer; anything else is our bug, and
    // Payme should see it as "cannot perform" rather than a broken merchant.
    if (err && typeof err.code === 'number') return send({ error: err });
    // eslint-disable-next-line no-console
    console.error('[payme] ' + body.method + ' failed: ' + (err && err.message));
    return send({ error: payme.rpcError(ERR.CANNOT_PERFORM) });
  }
});

module.exports = router;
