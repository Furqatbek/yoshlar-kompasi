'use strict';

const { Pool } = require('pg');
const { config } = require('../config');

// Three characters in a password make DATABASE_URL unparsable, and "/" is the
// one that actually happens: compose assembles the URL from POSTGRES_PASSWORD,
// and `openssl rand -base64 24` emits a "/" about four times in ten. The URL
// then reads as host "yik", port "ab", and pg says only "Invalid URL" — over
// and over in a crash loop, prefixed `[migrate]`, with nothing anywhere
// pointing at the password. It cost a production launch an evening, so the
// check says which character and what to do about it.
//
// Checked here because this module is the single place the URL is used, and
// every entry point — migrate, seed, the server, the cron jobs — comes through
// it before it can get as far as validating anything else.
function assertParsableDatabaseUrl(url) {
  if (!url) return; // absence is config.js's complaint to make, with better words
  try {
    new URL(url); // eslint-disable-line no-new
    return;
  } catch (_) { /* diagnose below */ }

  // Name the characters without printing the credentials.
  const userinfo = (/^[a-z][a-z0-9+.-]*:\/\/([^@]*)@/i.exec(url) || [, ''])[1];
  const offenders = [...new Set([...userinfo].filter((c) => '/?#'.includes(c)))];
  throw new Error(
    'DATABASE_URL is not a parsable URL.'
    + (offenders.length
      ? ' The user:password part contains ' + offenders.map((c) => '"' + c + '"').join(' and ')
        + ', which a URL cannot hold literally — percent-encode it ('
        + offenders.map((c) => '"' + c + '" as %' + c.charCodeAt(0).toString(16).toUpperCase()).join(', ')
        + ') or use a password without it.'
      : '')
    + '\n[db] When compose builds the URL from POSTGRES_PASSWORD, the simplest'
    + ' fix is a password with no URL syntax in it:'
    + ' POSTGRES_PASSWORD=$(openssl rand -hex 32)'
    + '\n[db] Avoid "%" too: it parses, but it percent-decodes, so the password'
    + ' pg sends is not the one in .env.'
    + '\n[db] Postgres only reads POSTGRES_PASSWORD when it initialises its data'
    + ' directory, so changing it on an existing deployment also needs the'
    + ' volume recreated (docker compose down -v — that deletes the database).'
  );
}

assertParsableDatabaseUrl(config.databaseUrl);

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
