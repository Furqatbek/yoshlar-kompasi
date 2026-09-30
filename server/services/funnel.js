'use strict';

// The funnel: every step between "opened the site" and "enrolled", in order.
//
// One list, three consumers — the collector validates against it, the admin
// view renders it, and the drop-off maths walks it pairwise. Adding a stage
// means adding one entry here.
//
// `client: true` means the browser is the only thing that can observe the step
// (nothing reaches the server when someone reads the landing page and leaves).
// Everything else is recorded by the server from the request that proves it
// happened, so a client cannot report progress it never made — the numbers the
// centre will make decisions on are not a visitor's word for it.

const STAGES = [
  { key: 'landing', label: 'Saytni ochdi', client: true },
  { key: 'setup', label: 'Boshlash sahifasiga o‘tdi', client: true },
  { key: 'login_start', label: 'Telegram kirishni bosdi', client: true },
  { key: 'login_done', label: 'Telegramda ro‘yxatdan o‘tdi' },
  { key: 'form_done', label: 'Bola ma’lumotini to‘ldirdi', client: true },
  { key: 'session_start', label: 'Mashg‘ulotni boshladi' },
  { key: 'first_answer', label: 'Bola birinchi javobini berdi' },
  { key: 'finished', label: 'Hisobot tayyor bo‘ldi' },
  { key: 'report_view', label: 'Hisobotni ochdi', client: true },
  { key: 'enrolled', label: 'Kursga yozildi' },
];

const KEYS = STAGES.map((s) => s.key);
// Everything the browser is allowed to POST to /api/track.
const CLIENT_KEYS = STAGES.filter((s) => s.client).map((s) => s.key);
// Derived from parents.lead_status rather than recorded as an event, so the
// admin marking a lead as enrolled is enough — nothing else has to fire.
const CONVERSION_STAGE = 'enrolled';

const isStage = (k) => KEYS.includes(k);
const isClientStage = (k) => CLIENT_KEYS.includes(k);
const labelOf = (k) => (STAGES.find((s) => s.key === k) || {}).label || k;

// Turn raw per-stage counts into the funnel the admin panel shows.
//
// Counts are NOT forced to decrease. A visitor can arrive straight on a shared
// report link and never see the landing page, so a later stage genuinely can
// out-count an earlier one; pretending otherwise would invent losses that did
// not happen. Drops are therefore floored at zero and the rate is reported
// against the previous stage only when there was something to lose.
// Percentages computed on a handful of visitors say nothing — a step from 3 to
// 1 is not a "67% drop", it is three people. Steepest-drop detection ignores
// anything below this base.
const MIN_BASE_FOR_RATE = 10;

function build(counts) {
  const rows = STAGES.map((s) => ({ key: s.key, label: s.label, n: Number(counts[s.key] || 0) }));
  let worst = null;   // most people lost
  let steepest = null; // largest share lost
  rows.forEach((row, i) => {
    if (i === 0) { row.lost = 0; row.kept_pct = null; row.lost_pct = null; return; }
    const prev = rows[i - 1].n;
    row.lost = Math.max(0, prev - row.n);
    row.kept_pct = prev > 0 ? Math.round((row.n / prev) * 100) : null;
    row.lost_pct = prev > 0 ? Math.round((row.lost / prev) * 100) : null;
    const at = { from: rows[i - 1].label, to: row.label, from_key: rows[i - 1].key, to_key: row.key, lost: row.lost, lost_pct: row.lost_pct };
    // "Biggest leak" by people lost. Ties keep the earlier stage — a funnel is
    // fixed front to back, since everything downstream inherits the loss.
    if (row.lost > 0 && (!worst || row.lost > worst.lost)) worst = at;
    // The steepest rate is the more actionable of the two: the top of the
    // funnel always loses the most people simply because that is where the
    // people are, whereas a step that loses most of what reaches it is a step
    // with something wrong in it.
    //
    // The sale itself is excluded. Far fewer people enrol than read a report,
    // so that step is the steepest in essentially every data set and would
    // crowd out every finding the centre could actually fix. It is not hidden:
    // it keeps its own row and the enrolment rate is a headline number.
    const isSale = row.key === CONVERSION_STAGE;
    if (!isSale && row.lost > 0 && prev >= MIN_BASE_FOR_RATE && (!steepest || row.lost_pct > steepest.lost_pct)) steepest = at;
  });
  const top = rows[0].n;
  // Bar widths are relative to the widest stage, which is usually but not
  // always the first one.
  const max = rows.reduce((m, r) => Math.max(m, r.n), 0);
  rows.forEach((r) => { r.width_pct = max > 0 ? Math.round((r.n / max) * 100) : 0; });
  const enrolled = rows[rows.length - 1].n;
  return {
    rows,
    worst,
    // Only worth showing when it is not the same step as `worst`.
    steepest: steepest && worst && steepest.to_key === worst.to_key ? null : steepest,
    visitors: top,
    enrolled,
    // End-to-end conversion: of everyone who opened the site, who enrolled.
    conversion_pct: top > 0 ? Math.round((enrolled / top) * 1000) / 10 : null,
  };
}

module.exports = { STAGES, KEYS, CLIENT_KEYS, CONVERSION_STAGE, isStage, isClientStage, labelOf, build };
