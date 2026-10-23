// What happens when the model answers with HTTP 200 and nothing usable.
//
// Every failure here arrives as a success. The status is 200, the body is
// well-formed, and the text that comes back reads as finished right up to the
// word it stops at. Downstream nothing can tell: the report is stored, the
// session is marked done, a PDF is drawn from it and a parent gets it in
// Telegram. That is strictly worse than an error, because an error retries and
// a half-written report about someone's child does not.
//
// The OpenRouter path had an empty-response guard from the start; the Anthropic
// path had none, and neither had a truncation guard, while `stop_reason` was
// returned by the adapter and read by nobody. These tests are what holds that
// shut, on both paths, driven through the real adapter over a real socket.

process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
process.env.OPENROUTER_API_KEY = 'sk-or-test';
process.env.JWT_SECRET = 'x'.repeat(20);
process.env.DATABASE_URL = 'postgres://u:p@127.0.0.1:5432/none';

const assert = require('assert');
const http = require('http');
const path = require('path');

const claude = require(path.join(__dirname, '..', '..', 'server', 'services', 'claude'));

let pass = 0;
const atest = async (name, fn) => { await fn(); pass++; console.log('  ok  - ' + name); };

// One server per case, answering whatever the case needs.
async function serving(body, fn) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(typeof body === 'function' ? body(Buffer.concat(chunks)) : body));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    return await fn(base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const ARGS = { system: 'sys', maxTokens: 100, messages: [{ role: 'user', content: 'hi' }], timeoutMs: 5000 };

async function anthropic(base, body) {
  process.env.ANTHROPIC_BASE_URL = base;
  const fresh = reload();
  return fresh.completeAnthropic.call(null, ARGS);
}

// config.js reads the environment once at require time, so a changed base URL
// needs the module graph rebuilt.
function reload() {
  for (const k of Object.keys(require.cache)) {
    if (k.includes(path.join('server', 'config.js')) || k.includes(path.join('server', 'services', 'claude.js'))) {
      delete require.cache[k];
    }
  }
  return require(path.join(__dirname, '..', '..', 'server', 'services', 'claude'));
}

const caught = async (fn) => {
  try { await fn(); } catch (e) { return e; }
  return null;
};

async function main() {
// ---- Anthropic -----------------------------------------------------------

await atest('a refusal is an error, not an empty report', async () => {
  const err = await serving(
    { content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'bio' }, usage: {} },
    (base) => caught(() => anthropic(base))
  );
  assert.ok(err, 'a refusal must not return successfully');
  assert.match(err.message, /bosh tortdi/, 'the message should say it was declined: ' + err.message);
  // Repeating a declined request verbatim gets declined again — retrying it
  // would burn the parent's wait on a certainty.
  assert.strictEqual(err.retryable, false, 'a refusal must not be retried');
});

await atest('a response of nothing but thinking is an error', async () => {
  // The shape every current model returns when display is omitted and it ran
  // out of room before writing any prose.
  const err = await serving(
    { content: [{ type: 'thinking', thinking: '' }], stop_reason: 'end_turn', usage: {} },
    (base) => caught(() => anthropic(base))
  );
  assert.ok(err, 'no text means no report');
  assert.match(err.message, /bo‘sh javob/);
  assert.strictEqual(err.retryable, true, 'an empty body is usually transient');
});

await atest('a report cut off at max_tokens is refused, not delivered', async () => {
  const err = await serving(
    {
      content: [{ type: 'text', text: '## Qisqacha xulosa\nAli hozirda yasash va tekshir' }],
      stop_reason: 'max_tokens',
      usage: { input_tokens: 10, output_tokens: 100 },
    },
    (base) => caught(() => anthropic(base))
  );
  assert.ok(err, 'truncated text must not be returned as a finished report');
  assert.match(err.message, /max_tokens/);
  assert.match(err.message, /REPORT_MAX_TOKENS/, 'say which knob fixes it');
  assert.strictEqual(err.retryable, true);
});

await atest('thinking blocks are dropped, not concatenated into the report', async () => {
  const out = await serving(
    {
      content: [
        { type: 'thinking', thinking: 'internal reasoning that must not reach a parent' },
        { type: 'text', text: '## Qisqacha xulosa\nAli yasashni yaxshi ko‘radi.' },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 20 },
    },
    (base) => anthropic(base)
  );
  assert.ok(!out.text.includes('internal reasoning'), 'reasoning leaked into the report');
  assert.match(out.text, /^## Qisqacha xulosa/);
});

await atest('a complete report comes back with its usage', async () => {
  const out = await serving(
    {
      content: [{ type: 'text', text: 'to‘liq hisobot' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 6400, output_tokens: 3200 },
    },
    (base) => anthropic(base)
  );
  assert.strictEqual(out.text, 'to‘liq hisobot');
  assert.strictEqual(out.inputTokens, 6400);
  assert.strictEqual(out.outputTokens, 3200);
  assert.strictEqual(out.stopReason, 'end_turn');
});

await atest('the request carries no parameter the API has since removed', async () => {
  // temperature, top_p and top_k return a 400 on every current model. The
  // report is one call per paying parent, so this fails the whole product.
  let seen = null;
  await serving(
    (raw) => { seen = JSON.parse(raw.toString()); return { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: {} }; },
    (base) => anthropic(base)
  );
  assert.ok(seen, 'the stub saw no request');
  for (const k of ['temperature', 'top_p', 'top_k']) {
    assert.ok(!(k in seen), k + ' is rejected by every current model');
  }
  // Assistant prefill is a 400 too, so the last turn must never be assistant.
  assert.notStrictEqual(seen.messages[seen.messages.length - 1].role, 'assistant');
  // The system prompt is 5.6K of the 6.4K input and identical every call.
  assert.ok(Array.isArray(seen.system) && seen.system[0].cache_control,
    'the system prompt must stay cached — it is most of the input');
});

// ---- OpenRouter ----------------------------------------------------------

async function openrouter(base, body) {
  process.env.OPENROUTER_BASE_URL = base;
  const fresh = reload();
  return fresh.completeOpenRouter.call(null, ARGS);
}

await atest('OpenRouter truncation is refused too', async () => {
  const err = await serving(
    {
      choices: [{ message: { content: '## Qisqacha xulosa\nAli hozirda yasash va tekshir' }, finish_reason: 'length' }],
      usage: {},
    },
    (base) => caught(() => openrouter(base))
  );
  assert.ok(err, 'finish_reason length is the same bug in OpenAI spelling');
  assert.match(err.message, /REPORT_MAX_TOKENS/);
});

await atest('OpenRouter still returns a complete report', async () => {
  const out = await serving(
    {
      choices: [{ message: { content: 'to‘liq hisobot' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 6400, completion_tokens: 3200 },
    },
    (base) => openrouter(base)
  );
  assert.strictEqual(out.text, 'to‘liq hisobot');
  assert.strictEqual(out.stopReason, 'stop');
});

console.log('\n' + pass + ' passed, 0 failed');
}

main().catch((err) => {
  console.error('\n' + pass + ' passed, 1 failed\n');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
