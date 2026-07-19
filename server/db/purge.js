'use strict';

// Data retention (spec §7): delete data whose session has had no activity for
// longer than the retention window. Deleting the child cascades to its sessions,
// messages and reports; a phone-less orphan parent is removed too. Parents that
// still have other children are kept. Run from cron (see Makefile `make purge`).
//
//   RETENTION_MONTHS (default 24) — months of inactivity before deletion.

const { pool } = require('./pool');

function months() {
  const n = parseInt(process.env.RETENTION_MONTHS, 10);
  return Number.isFinite(n) && n > 0 ? n : 24;
}

async function run() {
  const m = months();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // "Last activity" = the most recent session timestamp for the child.
    const { rowCount: kids } = await client.query(
      `DELETE FROM children c
        WHERE NOT EXISTS (
          SELECT 1 FROM sessions s
           WHERE s.child_id = c.id
             AND COALESCE(s.finished_at, s.started_at) >= now() - ($1 || ' months')::interval
        )
          AND EXISTS (SELECT 1 FROM sessions s2 WHERE s2.child_id = c.id)`,
      [m]
    );
    // Remove parents left with no children (their contact no longer backs a lead).
    const { rowCount: parents } = await client.query(
      `DELETE FROM parents p WHERE NOT EXISTS (SELECT 1 FROM children c WHERE c.parent_id = p.id)`
    );
    await client.query('COMMIT');
    // eslint-disable-next-line no-console
    console.log(`[purge] retention ${m} months — removed ${kids} child record(s), ${parents} orphan parent(s).`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  run()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[purge] ' + err.message);
      process.exit(1);
    });
}

module.exports = { run };
