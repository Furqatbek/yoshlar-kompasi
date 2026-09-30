'use strict';

// Sends the pending Telegram reminders. Run from the in-stack cron (hourly);
// see deploy/cron/root.
//
//   node scripts/send-reminders.js            send
//   node scripts/send-reminders.js --dry-run  count what WOULD be sent
//
// Safe to run often: the rules live in services/reminders.js, every reminder
// is claimed before it is sent, and a run outside daytime hours does nothing.
// Running hourly is what makes "24 hours after they stopped" land at roughly
// the same time of day rather than whenever a nightly job happens to fire.

const { pool } = require('../db/pool');
const reminders = require('../services/reminders');

const dryRun = process.argv.includes('--dry-run');

reminders
  .run({ dryRun })
  .then((s) => {
    if (s.skipped) {
      // eslint-disable-next-line no-console
      console.log('[reminders] skipped: ' + s.skipped);
    } else {
      const detail = Object.entries(s.byKind)
        .map(([k, v]) => `${k} ${v.sent}/${v.candidates}` + (v.failed ? ` (${v.failed} failed)` : ''))
        .join(', ');
      // eslint-disable-next-line no-console
      console.log(`[reminders]${dryRun ? ' DRY RUN' : ''} sent ${s.sent}, failed ${s.failed} — ${detail}`);
    }
    return pool.end();
  })
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[reminders] failed: ' + (err && err.message));
    process.exit(1);
  });
