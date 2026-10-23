// The login flow's quietest failure, made loud.
//
// With AUTH_REQUIRED on, a parent cannot start an assessment without logging in
// through the bot. Registering the webhook is a manual step, and forgetting it
// fails like this: the site hands the parent to the bot, the parent presses
// Start, the bot says nothing, the page waits forever, and there is no log line
// anywhere — because the update never reached us to be logged. It is
// indistinguishable from a bug in the login code, and it is what happened on
// the careerkids.uz launch.
//
// These tests cover the boot-time question "is Telegram actually pointed at
// us", including the two answers that look like success: a webhook registered
// at somebody else's deployment, and one registered here whose deliveries
// Telegram says are failing.

process.env.JWT_SECRET = 'x'.repeat(20);
process.env.DATABASE_URL = 'postgres://u:p@127.0.0.1:5432/none';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

const assert = require('assert');
const path = require('path');

let pass = 0;
const atest = async (name, fn) => { await fn(); pass++; console.log('  ok  - ' + name); };

const SERVER = path.join(__dirname, '..', '..', 'server');

// config.js reads the environment once, at require time.
function load(env) {
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(SERVER) && (k.includes('config.js') || k.includes('webhookCheck.js'))) {
      delete require.cache[k];
    }
  }
  const saved = {};
  const keys = ['AUTH_REQUIRED', 'DELIVERY_PROVIDER', 'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_BOT_USERNAME', 'TELEGRAM_WEBHOOK_SECRET', 'PUBLIC_BASE_URL', 'TELEGRAM_API_BASE'];
  for (const k of keys) saved[k] = process.env[k];
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return require(path.join(SERVER, 'services', 'delivery', 'webhookCheck'));
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

const LIVE = {
  AUTH_REQUIRED: 'true',
  DELIVERY_PROVIDER: 'telegram',
  TELEGRAM_BOT_TOKEN: '123456:AA-secret-token-value',
  TELEGRAM_BOT_USERNAME: 'careerkids_bot',
  TELEGRAM_WEBHOOK_SECRET: 'whsec',
  PUBLIC_BASE_URL: 'https://careerkids.uz',
};

// A fetch that answers getWebhookInfo with whatever the case needs, and
// records the URL it was called with.
function fakeTelegram(result, opts) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    if (opts && opts.throw) throw new Error(opts.throw);
    return {
      status: (opts && opts.status) || 200,
      json: async () => (opts && opts.body) || { ok: true, result },
    };
  };
  impl.calls = calls;
  return impl;
}

async function main() {

await atest('a webhook registered here, with no delivery errors, is just reported', async () => {
  const wc = load(LIVE);
  const r = await wc.check(fakeTelegram({ url: 'https://careerkids.uz/api/telegram/webhook' }));
  assert.strictEqual(r.status, 'ok');
  assert.ok(!r.degraded);
});

await atest('no webhook at all is named, with the command that fixes it', async () => {
  const wc = load(LIVE);
  const r = await wc.check(fakeTelegram({ url: '' }));
  assert.strictEqual(r.status, 'unset');
  assert.match(r.detail, /press Start and wait forever/, 'say what the parent experiences');
  assert.match(r.detail, /setWebhook/, 'give the command');
  assert.match(r.detail, /url=https:\/\/careerkids\.uz\/api\/telegram\/webhook/,
    'with this deployment’s own address in it');
});

await atest('the token never appears in what gets printed', async () => {
  const wc = load(LIVE);
  for (const result of [{ url: '' }, { url: 'https://elsewhere.example/api/telegram/webhook' }]) {
    const r = await wc.check(fakeTelegram(result));
    assert.ok(!r.detail.includes('123456:AA-secret-token-value'),
      'the bot token leaked into a log line: ' + r.detail);
    assert.ok(!r.detail.includes('whsec'), 'the webhook secret leaked: ' + r.detail);
  }
});

await atest('a webhook pointed at another deployment is a problem, not an ok', async () => {
  // The dangerous one: two deployments, one bot token, one webhook between
  // them. Whichever registered last is taking these parents' logins.
  const wc = load(LIVE);
  const r = await wc.check(fakeTelegram({ url: 'https://staging.careerkids.uz/api/telegram/webhook' }));
  assert.strictEqual(r.status, 'mismatch');
  assert.match(r.detail, /staging\.careerkids\.uz/, 'name where it is actually going');
  assert.match(r.detail, /receiving these parents/, 'say what that means');
});

await atest('Telegram’s own last delivery error is surfaced', async () => {
  const wc = load(LIVE);
  const r = await wc.check(fakeTelegram({
    url: 'https://careerkids.uz/api/telegram/webhook',
    last_error_message: 'Wrong response from the webhook: 401 Unauthorized',
  }));
  assert.ok(r.degraded, 'a registered webhook whose deliveries fail is not healthy');
  assert.match(r.detail, /401/);
  assert.match(r.detail, /TELEGRAM_WEBHOOK_SECRET/,
    'a 401 from our own endpoint means the secret does not match — say so');
});

await atest('a relative PUBLIC_BASE_URL is called out rather than compared', async () => {
  const wc = load({ ...LIVE, PUBLIC_BASE_URL: '/' });
  const fetchImpl = fakeTelegram({ url: '' });
  const r = await wc.check(fetchImpl);
  assert.strictEqual(r.status, 'unknown-base');
  assert.strictEqual(fetchImpl.calls.length, 0, 'nothing to compare against, so do not ask');
});

await atest('Telegram being unreachable is reported, not thrown', async () => {
  const wc = load(LIVE);
  const r = await wc.check(fakeTelegram(null, { throw: 'fetch failed' }));
  assert.strictEqual(r.status, 'error');
  assert.match(r.detail, /fetch failed/);
});

await atest('a deployment not using the bot is not asked about', async () => {
  const wc = load({ AUTH_REQUIRED: 'false', DELIVERY_PROVIDER: 'console', PUBLIC_BASE_URL: 'https://careerkids.uz' });
  const fetchImpl = fakeTelegram({ url: '' });
  const r = await wc.check(fetchImpl);
  assert.strictEqual(r.status, 'skipped');
  assert.strictEqual(fetchImpl.calls.length, 0);
});

// Reports are delivered through the bot even where the login gate is off, so
// the webhook still has to work.
await atest('delivery alone is enough to want the webhook checked', async () => {
  const wc = load({ ...LIVE, AUTH_REQUIRED: 'false' });
  const r = await wc.check(fakeTelegram({ url: '' }));
  assert.strictEqual(r.status, 'unset');
});

await atest('the boot line warns on a problem and only logs on success', async () => {
  const lines = { log: [], warn: [] };
  const sink = { log: (m) => lines.log.push(m), warn: (m) => lines.warn.push(m) };

  let wc = load(LIVE);
  global.fetch = fakeTelegram({ url: 'https://careerkids.uz/api/telegram/webhook' });
  await wc.report(sink);
  assert.strictEqual(lines.warn.length, 0, 'a healthy webhook must not cry wolf');
  assert.match(lines.log[0], /^\[telegram\] webhook /);

  wc = load(LIVE);
  global.fetch = fakeTelegram({ url: '' });
  await wc.report(sink);
  assert.strictEqual(lines.warn.length, 1, 'a missing webhook must warn');
  assert.match(lines.warn[0], /WEBHOOK PROBLEM \(unset\)/);
});

console.log('\n' + pass + ' passed, 0 failed');
}

main().catch((err) => {
  console.error('\n' + pass + ' passed, 1 failed\n');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
