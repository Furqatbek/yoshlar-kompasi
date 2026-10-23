'use strict';

const express = require('express');
const router = express.Router();

const { config } = require('../config');
const repo = require('../db/repo');
const paywall = require('../services/paywall');
const payme = require('../services/payments/payme');
const { rateLimit, clientIp } = require('../middleware/rateLimit');
const { asyncHandler, notFound, badRequest } = require('../utils/http');

// A modest IP limiter; share tokens are 144-bit so brute force is infeasible,
// but this bounds scraping.
const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  key: (r) => 'report:' + clientIp(r),
  message: 'Juda ko‘p so‘rov.',
});

// GET /api/reports/:token — public report data (unguessable token, no login).
router.get(
  '/:token',
  readLimiter,
  asyncHandler(async (req, res) => {
    const r = await repo.getReportByShareToken(req.params.token);
    if (!r) throw notFound('Hisobot topilmadi.');
    // With payments off, every report reads as bought — which is also what
    // keeps reports created before this feature fully readable.
    const paid = !config.payments.enabled || (await repo.isReportPaid(r.id));
    res.json(paywall.publicReport(r, { paid, priceUzs: config.payments.priceUzs }));
  })
);

// GET /api/reports/:token/pdf — the report as a file.
//
// Drawn here rather than printed by the browser: "PDF yuklab olish" was
// window.print(), which opens a dialog and leaves the reader to find "Save as
// PDF" — and on a phone, where most of these are read, that is Share → Print →
// Save to Files. This hands over the file.
//
// Generating it server-side also means the same document can be sent through
// Telegram later, which a print dialog could never do.
router.get(
  '/:token/pdf',
  readLimiter,
  asyncHandler(async (req, res) => {
    const r = await repo.getReportByShareToken(req.params.token);
    if (!r) throw notFound('Hisobot topilmadi.');

    // Null means it has not been bought. A PDF of the free excerpt would be a
    // document that looks complete and is not; the reader is better served by
    // the page, which says plainly what is still behind the payment.
    const file = await require('../services/reportFile').documentFor(r);
    if (!file) throw badRequest('Hisobot hali sotib olinmagan.', 'payment_required');
    const { filename: name, buffer: body } = file;

    res.setHeader('Content-Type', 'application/pdf');
    // Sent in one piece, so there is a Content-Length — which is what lets a
    // browser show a progress bar and a download manager resume.
    res.setHeader('Content-Length', body.length);
    // Both forms: the plain one for anything that cannot read RFC 5987, the
    // encoded one so a child's name keeps its letters.
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="' + name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '') + '"'
        + "; filename*=UTF-8''" + encodeURIComponent(name)
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(body);
  })
);

// POST /api/reports/:token/checkout — where to send the parent to pay.
//
// The share token is the credential, exactly as it is for reading the report:
// whoever holds the link may buy it. No login is required, because the person
// paying is not always the person who ran the assessment.
router.post(
  '/:token/checkout',
  readLimiter,
  asyncHandler(async (req, res) => {
    if (!config.payments.enabled) throw badRequest('To‘lov yoqilmagan.', 'payments_disabled');
    const r = await repo.getReportByShareToken(req.params.token);
    if (!r) throw notFound('Hisobot topilmadi.');

    // Normally the order was created with the report. Create it on demand if
    // not: a report generated before payments were switched on, or by the
    // loser of a concurrent double-report, would otherwise be locked forever
    // with no way to buy it. createOrder is idempotent on report_id.
    let order = await repo.getOrderByReport(r.id);
    if (!order) {
      const child = await repo.getChildById(r.child_id);
      order = await repo.createOrder({
        reportId: r.id,
        parentId: (child && child.parent_id) || null,
        amount: config.payments.priceTiyin,
      });
    }
    if (!order) throw notFound('Buyurtma topilmadi.');
    if (order.state === 'paid') return res.json({ paid: true });

    res.json({
      paid: false,
      order_id: order.id,
      amount_uzs: Math.round(Number(order.amount) / 100),
      checkout_url: payme.checkoutUrl(order, { shareToken: r.share_token, req }),
    });
  })
);

module.exports = router;
