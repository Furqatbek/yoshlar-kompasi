'use strict';

// The report as a file, with the paywall applied in one place.
//
// Three callers want this — the download endpoint, Telegram delivery when the
// report is created, and the /start deep link — and each of them has to make
// the same decision about whether the reader is entitled to the whole thing. A
// second copy of that decision is a second place for it to be wrong, and the
// failure is silent: nobody notices a PDF of a paid report going out for free
// until it has gone out for free.
//
// Returns null when the report has not been bought. Null means "no file", not
// "a shorter file": a PDF of the free excerpt is a document that looks complete
// and is not, and it would be the only version a parent keeps.

const { config } = require('../config');
const repo = require('../db/repo');
const { formatUzPhone } = require('../utils/phone');

function brandPhones() {
  return config.brand.phones.map((p) => formatUzPhone(p) || p);
}

function draw(report) {
  // Required here rather than at the top: pdfkit and fontkit are 17 MB of
  // module, and the cron container runs this same image without ever drawing
  // a report.
  const pdf = require('./pdf');
  const doc = pdf.renderReport(report, { brand: config.brand.name, phones: brandPhones() });
  return pdf.toBuffer(doc).then((buffer) => ({
    filename: pdf.fileNameFor(report, config.brand.name),
    buffer,
  }));
}

/**
 * Both facts a delivery needs, from one paywall check: whether the reader may
 * read the whole report, and the file if so.
 *
 * They are returned together because they are the same question asked twice,
 * and answering it twice is how a message ends up quoting the price to someone
 * who has just paid it.
 *
 * @param {object} report  a row from getReportByShareToken (it carries the
 *                         child's nickname and grade from the join).
 * @returns {Promise<{unlocked: boolean, document: {filename, buffer} | null}>}
 */
async function forDelivery(report) {
  if (!report) return { unlocked: false, document: null };
  const unlocked = !config.payments.enabled || (await repo.isReportPaid(report.id));
  return { unlocked, document: unlocked ? await draw(report) : null };
}

/** Just the file, for the download endpoint. Null means it is not bought. */
async function documentFor(report) {
  return (await forDelivery(report)).document;
}

/** The delivery pair, from a share token. */
async function forDeliveryByToken(shareToken) {
  return forDelivery(await repo.getReportByShareToken(shareToken));
}

module.exports = { forDelivery, forDeliveryByToken, documentFor };
