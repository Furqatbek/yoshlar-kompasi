// Telegram authorization gate (migration 002 + routes/auth.js).
//
// Drives the whole handshake against a real app + Postgres, standing in for
// Telegram by posting the exact update shapes the bot would send:
//   browser asks for a nonce -> bot /start auth_<nonce> -> Share-contact
//   -> browser collects the parent token -> session start is allowed.
//
// The bot's outbound sendMessage calls fail (no real bot token) and are
// swallowed by design, so this also proves the handshake does not depend on
// Telegram accepting our replies.

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8091';
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || 'test-webhook-secret';

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  ok  - ' : '  FAIL- ') + n + (x ? '   ' + x : '')); };

const j = async (method, path, body, headers) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(headers || {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  return { status: res.status, data };
};

// A Telegram update as the real webhook would deliver it.
const webhook = (message) =>
  fetch(BASE + '/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
    body: JSON.stringify({ update_id: Math.floor(Math.random() * 1e9), message }),
  });

const CHAT_ID = 777000123;
const FROM = { id: CHAT_ID, first_name: 'Dilnoza', last_name: 'Karimova', username: 'dilnoza' };
const chatMsg = (text) => ({ message_id: 1, chat: { id: CHAT_ID, type: 'private' }, from: FROM, text });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // ---- a session cannot start without authorization -----------------------
  const denied = await j('POST', '/api/sessions', { consent: true, nickname: 'Ali', grade: 2 });
  ok('unauthorized session start is refused', denied.status === 403, 'status=' + denied.status);
  ok('  refusal carries the auth_required code', denied.data?.code === 'auth_required',
    JSON.stringify(denied.data || {}));

  // ---- 1. browser asks for a login nonce ----------------------------------
  const start = await j('POST', '/api/auth/telegram/start', { marketing_consent: true });
  ok('start issues a nonce', start.status === 201 && !!start.data.nonce);
  const nonce = start.data.nonce;
  ok('  deep link targets the bot with an auth_ payload',
    typeof start.data.link === 'string' && start.data.link.includes('start=auth_' + nonce), start.data.link);

  const poll0 = await j('GET', '/api/auth/telegram/status?nonce=' + nonce);
  ok('  status starts as pending', poll0.data.status === 'pending', poll0.data.status);

  // ---- 2. the adult presses Start in Telegram -----------------------------
  await webhook(chatMsg('/start auth_' + nonce));
  await sleep(400); // webhook acknowledges first, processes after

  const poll1 = await j('GET', '/api/auth/telegram/status?nonce=' + nonce);
  ok('after /start the login waits on the phone', poll1.data.status === 'awaiting_phone', poll1.data.status);
  ok('  no token is handed out yet', !poll1.data.parent_token);

  // ---- 3. the adult taps Share contact ------------------------------------
  await webhook({
    message_id: 2,
    chat: { id: CHAT_ID, type: 'private' },
    from: FROM,
    contact: { phone_number: '+998901112233', first_name: 'Dilnoza', user_id: CHAT_ID },
  });
  await sleep(400);

  const poll2 = await j('GET', '/api/auth/telegram/status?nonce=' + nonce);
  ok('sharing the contact authorizes the login', poll2.data.status === 'authorized', poll2.data.status);
  const parentToken = poll2.data.parent_token;
  ok('  a parent token is returned', !!parentToken);
  ok('  the phone arrives verified', poll2.data.parent?.phone_verified === true);
  ok('  the phone is normalized', poll2.data.parent?.phone === '+998901112233', poll2.data.parent?.phone);
  ok('  marketing consent from the browser stuck', poll2.data.parent?.marketing_consent === true);
  ok('  the Telegram name carried over', poll2.data.parent?.name === 'Dilnoza Karimova', poll2.data.parent?.name);

  // ---- 4. the nonce is single-use ----------------------------------------
  const poll3 = await j('GET', '/api/auth/telegram/status?nonce=' + nonce);
  ok('the nonce cannot be replayed for a second token', poll3.data.status === 'expired', poll3.data.status);

  // ---- 5. the token identifies the parent --------------------------------
  const me = await j('GET', '/api/auth/me', undefined, { 'x-parent-token': parentToken });
  ok('/me resolves the token', me.status === 200 && me.data.parent?.phone === '+998901112233');
  const meBad = await j('GET', '/api/auth/me', undefined, { 'x-parent-token': 'not-a-real-token' });
  ok('  a bogus token is rejected', meBad.status === 401);

  // ---- 6. authorized session start ---------------------------------------
  const okSess = await j('POST', '/api/sessions',
    { consent: true, nickname: 'Ali', grade: 2, age: 8 },
    { 'x-parent-token': parentToken });
  ok('authorized session start succeeds', okSess.status === 201, 'status=' + okSess.status);
  ok('  a session token comes back', !!okSess.data.session_token);

  // ---- 7. consent is still enforced on top of authorization --------------
  const noConsent = await j('POST', '/api/sessions',
    { consent: false, nickname: 'Ali', grade: 2 },
    { 'x-parent-token': parentToken });
  ok('authorization does not bypass the adult-consent check',
    noConsent.status === 400 && noConsent.data?.code === 'consent_required',
    'status=' + noConsent.status + ' code=' + noConsent.data?.code);

  // ---- 8. a second login reuses the same parent --------------------------
  const start2 = await j('POST', '/api/auth/telegram/start', { marketing_consent: false });
  await webhook(chatMsg('/start auth_' + start2.data.nonce));
  await sleep(400);
  const poll4 = await j('GET', '/api/auth/telegram/status?nonce=' + start2.data.nonce);
  ok('a returning adult skips the phone step', poll4.data.status === 'authorized', poll4.data.status);
  ok('  and keeps their existing consent', poll4.data.parent?.marketing_consent === true);
  ok('  and gets a fresh token', !!poll4.data.parent_token && poll4.data.parent_token !== parentToken);

  // ---- 9. an unknown nonce never authorizes ------------------------------
  await webhook(chatMsg('/start auth_' + 'x'.repeat(24)));
  await sleep(300);
  const bogus = await j('GET', '/api/auth/telegram/status?nonce=' + 'x'.repeat(24));
  ok('an unknown nonce stays unauthorized', bogus.data.status === 'expired', bogus.data.status);

  // ---- 10. logout drops the browser login, not the Telegram link ---------
  await j('POST', '/api/auth/logout', { parent_token: parentToken });
  const afterLogout = await j('GET', '/api/auth/me', undefined, { 'x-parent-token': parentToken });
  ok('logout revokes the browser token', afterLogout.status === 401);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
