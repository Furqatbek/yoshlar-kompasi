'use strict';

const { Pool } = require('pg');
const { config } = require('../config');

// A single shared connection pool. `pg` reads ssl/host/etc. from the URL; we
// enable relaxed SSL only when the URL asks for it (managed providers).
const useSsl = /[?&]sslmode=require/i.test(config.databaseUrl) || /\bssl=true\b/i.test(config.databaseUrl);

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[db] idle client error', err.message);
});

async function query(text, params) {
  return pool.query(text, params);
}

// Run a function inside a transaction, rolling back on any throw.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
