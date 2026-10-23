// Does the key work, and can this account call this model?
//
// On careerkids.uz the answer to the first was no, and it was found out like
// this: a child answered seventy questions, an adult typed their phone number,
// the screen said everything was ready, and the single model call of the whole
// sitting came back `401 invalid x-api-key`. The reason was in the server log,
// which is the right place for it and the last place anyone looks when a button
// appears to do nothing.
//
// Two GETs at boot answer both questions. They generate no tokens, so they
// cost nothing, and they must never be fatal — a provider briefly unreachable
// at boot must not stop the app serving a landing page.

process.env.JWT_SECRET = 'x'.repeat(20);
process.env.DATABASE_URL = 'postgres://u:p@127.0.0.1:5432/none';

const assert = require('assert');
const path = require('path');

let pass = 0;
const atest = async (name, fn) => { await fn(); pass++; console.log('  ok  - ' + name); };

const SERVER = path.join(__dirname, '..', '..', 'server');
const KEY = 'sk-ant-SECRETVALUE0123456789';

function load(env) {
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(SERVER) && (k.includes('config.js') || k.includes('llmCheck.js'))) {
      delete require.cache[k];
    }
  }
  const keys = ['LLM_PROVIDER', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'ANTHROPIC_BASE_URL',
    'OPENROUTER_API_KEY', 'OPENROUTER_MODEL', 'OPENROUTER_BASE_URL'];
  const saved = {};
  for (const k of keys) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, env);
  try {
    return require(path.join(SERVER, 'services', 'llmCheck'));
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

const ANTHROPIC = { LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: KEY, ANTHROPIC_MODEL: 'claude-opus-5-5' };

// Answers by URL so the model lookup and the model list can differ.
function fakeProvider(routes) {
  const calls = [];
  const impl = async (url, opts) => {
    calls.push({ url, headers: (opts && opts.headers) || {} });
    for (const [match, answer] of routes) {
      if (url.includes(match)) {
        if (answer.throw) throw new Error(answer.throw);
        return {
          ok: answer.status >= 200 && answer.status < 300,
          status: answer.status,
          json: async () => answer.body || {},
        };
      }
    }
    return { ok: false, status: 500, json: async () => ({}) };
  };
  impl.calls = calls;
  return impl;
}

async function main() {

await atest('a working key and an available model is one quiet line', async () => {
  const lc = load(ANTHROPIC);
  const r = await lc.check(fakeProvider([['/v1/models/claude-opus-5-5', { status: 200, body: { id: 'claude-opus-5-5' } }]]));
  assert.strictEqual(r.status, 'ok');
  assert.match(r.detail, /claude-opus-5-5/);
});

await atest('a rejected key is named as such, before any parent meets it', async () => {
  const lc = load(ANTHROPIC);
  const r = await lc.check(fakeProvider([['/v1/models/', { status: 401 }]]));
  assert.strictEqual(r.status, 'bad-key');
  assert.match(r.detail, /ANTHROPIC_API_KEY/);
  assert.match(r.detail, /after the child has answered/,
    'say what it costs, so it is not filed as a warning to look at later');
});

await atest('  and it says that editing .env alone will not fix it', async () => {
  // The trap that follows: the key is replaced, the app is restarted rather
  // than recreated, and the container keeps the environment it booted with.
  const lc = load(ANTHROPIC);
  const r = await lc.check(fakeProvider([['/v1/models/', { status: 401 }]]));
  assert.match(r.detail, /make prod-up/);
});

// The careerkids.uz key was 62 characters where it should have been ~108:
// pasted into .env across two lines, so `source .env` and compose both read the
// same truncated value and every check that compared them agreed. "Rejected"
// sends you to reissue a key that was fine; the length sends you to the file.
await atest('a truncated key says so, because the fix is re-paste not reissue', async () => {
  const half = 'sk-ant-api03-TRUNCATEDHALFOFAREALKEY0123456789';
  const lc = load({ ...ANTHROPIC, ANTHROPIC_API_KEY: half });
  const r = await lc.check(fakeProvider([['/v1/models/', { status: 401 }]]));
  assert.strictEqual(r.status, 'bad-key');
  assert.match(r.detail, new RegExp('only ' + half.length + ' characters'),
    'name the length it actually found: ' + r.detail);
  assert.match(r.detail, /wrapped onto a second line/, 'name the likely cause');
  assert.match(r.detail, /one unbroken line/, 'say what right looks like');
});

await atest('a key of the wrong shape entirely is called out', async () => {
  const lc = load({ ...ANTHROPIC, ANTHROPIC_API_KEY: 'sk-or-v1-' + 'a'.repeat(72) });
  const r = await lc.check(fakeProvider([['/v1/models/', { status: 401 }]]));
  assert.match(r.detail, /does not start with "sk-ant-"/, 'an OpenRouter key in the Anthropic slot');
  assert.ok(!/only \d+ characters/.test(r.detail), 'it is long enough; do not also claim truncation');
});

await atest('  but a full-length key is not second-guessed', async () => {
  // The shape check only ever explains a refusal the provider already made. If
  // the format changes tomorrow, a working key must keep working and a rejected
  // one must not be slandered.
  const lc = load({ ...ANTHROPIC, ANTHROPIC_API_KEY: 'sk-ant-api03-' + 'a'.repeat(95) });
  const r = await lc.check(fakeProvider([['/v1/models/', { status: 401 }]]));
  assert.strictEqual(r.status, 'bad-key');
  assert.ok(!/Also worth checking/.test(r.detail),
    'nothing is wrong with the shape, so say nothing about it: ' + r.detail);
});

await atest('  and a working key of any shape is still accepted', async () => {
  const lc = load({ ...ANTHROPIC, ANTHROPIC_API_KEY: 'whatever-the-format-becomes' });
  const r = await lc.check(fakeProvider([['/v1/models/', { status: 200, body: {} }]]));
  assert.strictEqual(r.status, 'ok', 'the shape must never be grounds for refusal on its own');
});

await atest('403 is treated as a rejected key too', async () => {
  const lc = load(ANTHROPIC);
  const r = await lc.check(fakeProvider([['/v1/models/', { status: 403 }]]));
  assert.strictEqual(r.status, 'bad-key');
});

await atest('a model the account cannot call is distinguished from a bad key', async () => {
  const lc = load(ANTHROPIC);
  const r = await lc.check(fakeProvider([
    ['/v1/models/claude-opus-5-5', { status: 404 }],
    ['/v1/models?', { status: 200, body: { data: [{ id: 'claude-sonnet-5-5' }, { id: 'claude-haiku-5-5' }] } }],
  ]));
  assert.strictEqual(r.status, 'model-unavailable');
  // The useful part: not "that one is wrong" but "these are right".
  assert.match(r.detail, /claude-sonnet-5-5/);
  assert.match(r.detail, /claude-haiku-5-5/);
});

await atest('  a 404 still asks for the list, because the key must be good', async () => {
  const lc = load(ANTHROPIC);
  const f = fakeProvider([
    ['/v1/models/claude-opus-5-5', { status: 404 }],
    ['/v1/models?', { status: 200, body: { data: [{ id: 'claude-sonnet-5-5' }] } }],
  ]);
  await lc.check(f);
  assert.strictEqual(f.calls.length, 2, 'a 404 means the credentials passed — ask what IS allowed');
});

await atest('  and a 401 does not, because it would fail the same way', async () => {
  const lc = load(ANTHROPIC);
  const f = fakeProvider([['/v1/models', { status: 401 }]]);
  await lc.check(f);
  assert.strictEqual(f.calls.length, 1);
});

await atest('an unreadable model list still reports the unavailable model', async () => {
  const lc = load(ANTHROPIC);
  const r = await lc.check(fakeProvider([
    ['/v1/models/claude-opus-5-5', { status: 404 }],
    ['/v1/models?', { status: 500 }],
  ]));
  assert.strictEqual(r.status, 'model-unavailable');
  assert.match(r.detail, /claude-opus-5-5/);
});

await atest('the key never appears in anything printed', async () => {
  const lc = load(ANTHROPIC);
  for (const routes of [
    [['/v1/models/', { status: 401 }]],
    [['/v1/models/claude-opus-5-5', { status: 404 }], ['/v1/models?', { status: 200, body: { data: [] } }]],
    [['/v1/models/', { throw: 'fetch failed' }]],
    [['/v1/models/', { status: 500 }]],
  ]) {
    const r = await lc.check(fakeProvider(routes));
    assert.ok(!r.detail.includes(KEY), 'the key leaked into a log line: ' + r.detail);
    assert.ok(!r.detail.includes('SECRETVALUE'), 'a fragment of the key leaked: ' + r.detail);
  }
});

await atest('the key does go in the header, or the check proves nothing', async () => {
  const lc = load(ANTHROPIC);
  const f = fakeProvider([['/v1/models/', { status: 200, body: {} }]]);
  await lc.check(f);
  assert.strictEqual(f.calls[0].headers['x-api-key'], KEY);
  assert.ok(f.calls[0].headers['anthropic-version'], 'the API requires a version header');
});

await atest('an unreachable provider is reported, not thrown', async () => {
  const lc = load(ANTHROPIC);
  const r = await lc.check(fakeProvider([['/v1/models/', { throw: 'ECONNREFUSED' }]]));
  assert.strictEqual(r.status, 'error');
  assert.match(r.detail, /ECONNREFUSED/);
});

await atest('no key configured is left to config.js to complain about', async () => {
  const lc = load({ LLM_PROVIDER: 'anthropic' });
  const f = fakeProvider([]);
  const r = await lc.check(f);
  assert.strictEqual(r.status, 'skipped');
  assert.strictEqual(f.calls.length, 0);
});

// ---- OpenRouter ----------------------------------------------------------

await atest('OpenRouter keys are checked on their own endpoint', async () => {
  const lc = load({ LLM_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'sk-or-SECRETVALUE', OPENROUTER_MODEL: 'anthropic/claude-sonnet-4.6' });
  const f = fakeProvider([['/key', { status: 200, body: { data: {} } }]]);
  const r = await lc.check(f);
  assert.strictEqual(r.status, 'ok');
  assert.match(f.calls[0].headers.authorization, /^Bearer /);
  // OpenRouter will not say whether a slug is callable without spending a
  // token on it, so the line must not imply the model was checked.
  assert.match(r.detail, /not verified/);
});

await atest('a rejected OpenRouter key is named too', async () => {
  const lc = load({ LLM_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'sk-or-SECRETVALUE' });
  const r = await lc.check(fakeProvider([['/key', { status: 401 }]]));
  assert.strictEqual(r.status, 'bad-key');
  assert.match(r.detail, /OPENROUTER_API_KEY/);
  assert.ok(!r.detail.includes('SECRETVALUE'));
});

await atest('the boot line warns on a problem and only logs on success', async () => {
  const lines = { log: [], warn: [] };
  const sink = { log: (m) => lines.log.push(m), warn: (m) => lines.warn.push(m) };

  let lc = load(ANTHROPIC);
  global.fetch = fakeProvider([['/v1/models/', { status: 200, body: {} }]]);
  await lc.report(sink);
  assert.strictEqual(lines.warn.length, 0, 'a working provider must not cry wolf');
  assert.match(lines.log[0], /^\[llm\] key accepted/);

  lc = load(ANTHROPIC);
  global.fetch = fakeProvider([['/v1/models/', { status: 401 }]]);
  await lc.report(sink);
  assert.strictEqual(lines.warn.length, 1);
  assert.match(lines.warn[0], /PROVIDER PROBLEM \(bad-key\)/);
});

console.log('\n' + pass + ' passed, 0 failed');
}

main().catch((err) => {
  console.error('\n' + pass + ' passed, 1 failed\n');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
