'use strict';

// Idempotent seed: create/refresh the admin account from ADMIN_EMAIL /
// ADMIN_PASSWORD. Safe to run repeatedly. No children's data is ever seeded.

const bcrypt = require('bcryptjs');
const { pool } = require('./pool');
const { config } = require('../config');

async function run() {
  const email = (config.admin.seedEmail || '').trim().toLowerCase();
  const password = config.admin.seedPassword || '';
  if (!email || !password) {
    // eslint-disable-next-line no-console
    console.warn('[seed] ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping admin seed.');
    return;
  }
  const hash = await bcrypt.hash(password, 12);
  const { rows } = await pool.query('SELECT id FROM admins WHERE email = $1', [email]);
  if (rows.length) {
    await pool.query('UPDATE admins SET password_hash = $2 WHERE email = $1', [email, hash]);
    // eslint-disable-next-line no-console
    console.log('[seed] admin password updated for ' + email);
  } else {
    await pool.query('INSERT INTO admins (email, password_hash) VALUES ($1, $2)', [email, hash]);
    // eslint-disable-next-line no-console
    console.log('[seed] admin created: ' + email);
  }
}

if (require.main === module) {
  run()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[seed] ' + err.message);
      process.exit(1);
    });
}

module.exports = { run };
