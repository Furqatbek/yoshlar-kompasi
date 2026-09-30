'use strict';

// Shared Telegram-authorization helper for the API drivers.
//
// These suites were written before authorization existed and exercise the
// assessment pipeline, not the login. Rather than thread a token through every
// call site, `installAuth` performs the handshake once and transparently
// attaches the parent token to the one request the gate applies to — creating
// a session. Everything else is untouched, so the drivers keep testing the
// real production configuration (AUTH_REQUIRED on) instead of switching it off.
//
// The login behaviour itself is covered by test/api/auth-test.js.

const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || 'test-webhook-secret';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function jsonOf(res) {
  try { return await res.json(); } catch { return null; }
}

// Runs the full deep-link handshake, standing in for Telegram.
// Each driver must pass its OWN chatId: one Telegram account is one parent
// row, so sharing an id across suites would merge their leads.
async function authorize(BASE, { chatId, firstName = 'Test', lastName = 'Ota', phone } = {}) {
  const start = await fetch(BASE + '/api/auth/telegram/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ marketing_consent: true }),
  });
  const { nonce } = await jsonOf(start);
  if (!nonce) throw new Error('auth-helper: no nonce (is the bot configured?)');

  const from = { id: chatId, first_name: firstName, last_name: lastName, username: 'u' + chatId };
  const post = (message) =>
    fetch(BASE + '/api/telegram/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
      body: JSON.stringify({ update_id: Math.floor(Math.random() * 1e9), message }),
    });

  await post({ message_id: 1, chat: { id: chatId, type: 'private' }, from, text: '/start auth_' + nonce });
  await sleep(350); // the webhook acknowledges first and processes after

  // Share-contact step (skipped when the parent already has a verified phone).
  let status = await jsonOf(await fetch(BASE + '/api/auth/telegram/status?nonce=' + nonce));
  if (status.status === 'awaiting_phone') {
    await post({
      message_id: 2,
      chat: { id: chatId, type: 'private' },
      from,
      contact: { phone_number: phone || '+99890' + String(chatId).slice(-7), first_name: firstName, user_id: chatId },
    });
    await sleep(350);
    status = await jsonOf(await fetch(BASE + '/api/auth/telegram/status?nonce=' + nonce));
  }
  if (status.status !== 'authorized' || !status.parent_token) {
    throw new Error('auth-helper: handshake did not authorize (status=' + status.status + ')');
  }
  return status.parent_token;
}

// Authorize, then attach the token to POST /api/sessions for the rest of the run.
async function installAuth(BASE, opts) {
  const token = await authorize(BASE, opts);
  const orig = global.fetch;
  global.fetch = (url, init = {}) => {
    const path = String(url).split('?')[0];
    if ((init.method || 'GET').toUpperCase() === 'POST' && /\/api\/sessions$/.test(path)) {
      init = { ...init, headers: { ...(init.headers || {}), 'x-parent-token': token } };
    }
    return orig(url, init);
  };
  return token;
}

module.exports = { authorize, installAuth };
