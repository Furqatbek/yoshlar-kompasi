'use strict';
// Focused integration test for the OpenRouter provider adapter in
// server/services/claude.js. Spins up a local OpenAI-compatible stub and drives
// the real service against it, asserting request shape, response parsing, error
// classification, dispatch, and activeModel(). No Postgres needed.

const http = require('http');
const path = require('path');

const SERVER_DIR = path.join(__dirname, '..', '..', 'server');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  - ' + name); }
  else { fail++; console.log('  FAIL- ' + name + (extra ? '  :: ' + extra : '')); }
}

// A scriptable stub: `next` controls the response for the following request.
let lastReq = null;
let next = { status: 200, body: null };
function okBody(text) {
  return {
    id: 'gen-stub', object: 'chat.completion', model: 'anthropic/claude-sonnet-4.5',
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 111, completion_tokens: 222, total_tokens: 333 },
  };
}
const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let parsed = {}; try { parsed = JSON.parse(body); } catch (_) {}
    lastReq = { method: req.method, url: req.url, headers: req.headers, body: parsed };
    res.writeHead(next.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(next.body != null ? next.body : okBody('Salom!')));
  });
});

// Load config + service fresh with a given env (config reads env once at require).
function loadWith(env) {
  for (const k of Object.keys(require.cache)) {
    if (k.includes(path.join('server', 'config')) || k.includes(path.join('server', 'services', 'claude'))) {
      delete require.cache[k];
    }
  }
  Object.assign(process.env, env);
  const { config } = require(path.join(SERVER_DIR, 'config'));
  const claude = require(path.join(SERVER_DIR, 'services', 'claude'));
  return { config, claude };
}

async function main() {
  await new Promise((r) => stub.listen(5698, r));
  const BASE = 'http://127.0.0.1:5698/api/v1';

  // --- Scenario 1: happy path, provider=openrouter ------------------------
  {
    const { config, claude } = loadWith({
      LLM_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: 'sk-or-testkey',
      OPENROUTER_BASE_URL: BASE,
      OPENROUTER_MODEL: 'anthropic/claude-sonnet-4.5',
      OPENROUTER_SITE_URL: 'https://kompas.example.uz',
      OPENROUTER_SITE_NAME: 'Yoshlar Kompasi',
    });

    ok('config.llm.provider = openrouter', config.llm.provider === 'openrouter', config.llm.provider);
    ok('activeModel() returns openrouter model', claude.activeModel() === 'anthropic/claude-sonnet-4.5', claude.activeModel());

    next = { status: 200, body: okBody('Assalomu alaykum, Ali!') };
    const out = await claude.complete({
      system: 'SYS-PROMPT',
      model: claude.activeModel(),
      maxTokens: 1500,
      messages: [
        { role: 'user', content: 'intro meta', meta: true },
        { role: 'assistant', content: 'prev reply' },
        { role: 'user', content: 'javob' },
      ],
    });

    // Response parsing
    ok('text parsed from choices[0].message.content', out.text === 'Assalomu alaykum, Ali!', out.text);
    ok('inputTokens <- prompt_tokens', out.inputTokens === 111, String(out.inputTokens));
    ok('outputTokens <- completion_tokens', out.outputTokens === 222, String(out.outputTokens));
    ok('stopReason <- finish_reason', out.stopReason === 'stop', String(out.stopReason));

    // Request shape
    ok('POST to /chat/completions', lastReq.method === 'POST' && lastReq.url === '/api/v1/chat/completions', lastReq.method + ' ' + lastReq.url);
    ok('Authorization: Bearer <key>', lastReq.headers['authorization'] === 'Bearer sk-or-testkey', lastReq.headers['authorization']);
    ok('HTTP-Referer attribution header', lastReq.headers['http-referer'] === 'https://kompas.example.uz', lastReq.headers['http-referer']);
    ok('X-Title attribution header', lastReq.headers['x-title'] === 'Yoshlar Kompasi', lastReq.headers['x-title']);
    ok('body.model set', lastReq.body.model === 'anthropic/claude-sonnet-4.5', lastReq.body.model);
    ok('body.max_tokens set', lastReq.body.max_tokens === 1500, String(lastReq.body.max_tokens));
    const m = lastReq.body.messages;
    ok('first message is system', m[0].role === 'system' && m[0].content === 'SYS-PROMPT', JSON.stringify(m[0]));
    ok('system NOT a top-level field (OpenAI format)', lastReq.body.system === undefined, String(lastReq.body.system));
    ok('history mapped as user/assistant turns', m[1].role === 'user' && m[2].role === 'assistant' && m[3].role === 'user', JSON.stringify(m.map((x) => x.role)));
    ok('meta flag stripped from wire message', m[1].meta === undefined, JSON.stringify(m[1]));
  }

  // --- Scenario 2: 4xx (credits/auth) is non-retryable --------------------
  {
    const { claude } = loadWith({ LLM_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'k', OPENROUTER_BASE_URL: BASE });
    next = { status: 402, body: { error: { message: 'Insufficient credits', code: 402 } } };
    let e = null;
    try { await claude.complete({ system: 's', model: 'x', maxTokens: 10, messages: [{ role: 'user', content: 'hi' }] }); }
    catch (err) { e = err; }
    ok('402 throws ClaudeError', e && e.name === 'ClaudeError', e && e.message);
    ok('402 is non-retryable', e && e.retryable === false, e && String(e.retryable));
    ok('402 error surfaces provider detail', e && /OpenRouter xatosi \(402\)/.test(e.message), e && e.message);
  }

  // --- Scenario 3: 429 and 5xx are retryable ------------------------------
  {
    const { claude } = loadWith({ LLM_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'k', OPENROUTER_BASE_URL: BASE });
    next = { status: 429, body: { error: { message: 'rate limited' } } };
    let e1 = null;
    try { await claude.complete({ system: 's', model: 'x', maxTokens: 10, messages: [{ role: 'user', content: 'hi' }] }); } catch (err) { e1 = err; }
    ok('429 is retryable', e1 && e1.retryable === true, e1 && String(e1.retryable));

    next = { status: 503, body: { error: { message: 'upstream down' } } };
    let e2 = null;
    try { await claude.complete({ system: 's', model: 'x', maxTokens: 10, messages: [{ role: 'user', content: 'hi' }] }); } catch (err) { e2 = err; }
    ok('503 is retryable', e2 && e2.retryable === true, e2 && String(e2.retryable));
  }

  // --- Scenario 4: 200 with an error body (upstream failure surfaced) -----
  {
    const { claude } = loadWith({ LLM_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'k', OPENROUTER_BASE_URL: BASE });
    next = { status: 200, body: { error: { message: 'provider returned no completion' } } };
    let e = null;
    try { await claude.complete({ system: 's', model: 'x', maxTokens: 10, messages: [{ role: 'user', content: 'hi' }] }); } catch (err) { e = err; }
    ok('200+error body throws (retryable)', e && e.name === 'ClaudeError' && e.retryable === true, e && (e.message + ' r=' + e.retryable));
  }

  // --- Scenario 5: missing key is a clear non-retryable config error ------
  {
    const { claude } = loadWith({ LLM_PROVIDER: 'openrouter', OPENROUTER_API_KEY: '', OPENROUTER_BASE_URL: BASE });
    let e = null;
    try { await claude.complete({ system: 's', model: 'x', maxTokens: 10, messages: [{ role: 'user', content: 'hi' }] }); } catch (err) { e = err; }
    ok('missing OPENROUTER_API_KEY -> non-retryable 500', e && e.retryable === false && e.status === 500, e && e.message);
  }

  // --- Scenario 6: dispatcher defaults to Anthropic -----------------------
  {
    const { config, claude } = loadWith({ LLM_PROVIDER: '', ANTHROPIC_API_KEY: 'sk-ant-x', ANTHROPIC_MODEL: 'claude-sonnet-4-6' });
    ok('default provider is anthropic', config.llm.provider === 'anthropic', config.llm.provider);
    ok('activeModel() returns anthropic model by default', claude.activeModel() === 'claude-sonnet-4-6', claude.activeModel());
    // Point the Anthropic path at our stub too, but it speaks Anthropic wire —
    // we only assert the dispatcher hit the Anthropic branch (x-api-key header,
    // /v1/messages path), not the (mismatched) body parse.
    const { claude: c2 } = loadWith({ LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-x', ANTHROPIC_BASE_URL: 'http://127.0.0.1:5698', ANTHROPIC_MODEL: 'claude-sonnet-4-6' });
    next = { status: 200, body: { content: [{ type: 'text', text: 'anthropic-shape' }], usage: { input_tokens: 5, output_tokens: 6 }, stop_reason: 'end_turn' } };
    const out = await c2.complete({ system: 's', model: 'claude-sonnet-4-6', maxTokens: 10, messages: [{ role: 'user', content: 'hi' }] });
    ok('anthropic dispatch hits /v1/messages', lastReq.url === '/v1/messages', lastReq.url);
    ok('anthropic dispatch uses x-api-key (not Bearer)', lastReq.headers['x-api-key'] === 'sk-ant-x' && !lastReq.headers['authorization'], JSON.stringify({ k: lastReq.headers['x-api-key'], a: lastReq.headers['authorization'] }));
    ok('anthropic response parsed', out.text === 'anthropic-shape' && out.inputTokens === 5 && out.outputTokens === 6, JSON.stringify(out));
  }

  // --- Scenario 7: modelFor() resolves provider-specific model ids --------
  {
    // Under OpenRouter, a session stamped with an Anthropic-native id must NOT
    // be sent verbatim (the reported "sonnet 4.6 is not valid model id" bug).
    const { claude } = loadWith({
      LLM_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'k', OPENROUTER_BASE_URL: BASE,
      OPENROUTER_MODEL: 'anthropic/claude-sonnet-4.6', ANTHROPIC_MODEL: 'claude-sonnet-4-6',
    });
    ok('OR: stale anthropic id -> openrouter default', claude.modelFor('claude-sonnet-4-6') === 'anthropic/claude-sonnet-4.6', claude.modelFor('claude-sonnet-4-6'));
    ok('OR: valid slug passes through', claude.modelFor('anthropic/claude-opus-4.8') === 'anthropic/claude-opus-4.8', claude.modelFor('anthropic/claude-opus-4.8'));
    ok('OR: empty stored -> openrouter default', claude.modelFor('') === 'anthropic/claude-sonnet-4.6', claude.modelFor(''));
    ok('OR: null stored -> openrouter default', claude.modelFor(null) === 'anthropic/claude-sonnet-4.6', String(claude.modelFor(null)));

    // Under Anthropic, an OpenRouter slug (from a session created under OR) must
    // fall back to the Anthropic default rather than be sent with a slash.
    const { claude: ca } = loadWith({
      LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant', ANTHROPIC_MODEL: 'claude-sonnet-4-6',
      OPENROUTER_MODEL: 'anthropic/claude-sonnet-4.6',
    });
    ok('ANT: stale openrouter slug -> anthropic default', ca.modelFor('anthropic/claude-sonnet-4.6') === 'claude-sonnet-4-6', ca.modelFor('anthropic/claude-sonnet-4.6'));
    ok('ANT: native id passes through', ca.modelFor('claude-haiku-4-5') === 'claude-haiku-4-5', ca.modelFor('claude-haiku-4-5'));
    ok('ANT: empty stored -> anthropic default', ca.modelFor('') === 'claude-sonnet-4-6', ca.modelFor(''));
  }

  // --- Scenario 8: 200 with a CHOICE-level provider error ------------------
  {
    const { claude } = loadWith({ LLM_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'k', OPENROUTER_BASE_URL: BASE });
    next = { status: 200, body: {
      id: 'g', choices: [{ index: 0, finish_reason: 'error', error: { code: 500, message: 'upstream provider crashed' }, message: { role: 'assistant', content: 'partial' } }], usage: {},
    } };
    let e = null;
    try { await claude.complete({ system: 's', model: 'anthropic/x', maxTokens: 10, messages: [{ role: 'user', content: 'hi' }] }); } catch (err) { e = err; }
    ok('200 choice-level error throws (retryable)', e && e.name === 'ClaudeError' && e.retryable === true, e && (e.message + ' r=' + e.retryable));
    ok('  surfaces the provider error message', e && /upstream provider crashed/.test(e.message), e && e.message);
  }

  // --- Scenario 9: empty choices / null content -> retryable, not blank -----
  {
    const { claude } = loadWith({ LLM_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'k', OPENROUTER_BASE_URL: BASE });
    next = { status: 200, body: { id: 'g', choices: [], usage: {} } };
    let e1 = null;
    try { await claude.complete({ system: 's', model: 'anthropic/x', maxTokens: 10, messages: [{ role: 'user', content: 'hi' }] }); } catch (err) { e1 = err; }
    ok('empty choices[] throws (retryable), not blank success', e1 && e1.name === 'ClaudeError' && e1.retryable === true, e1 && e1.message);

    next = { status: 200, body: { id: 'g', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: null } }], usage: {} } };
    let e2 = null;
    try { await claude.complete({ system: 's', model: 'anthropic/x', maxTokens: 10, messages: [{ role: 'user', content: 'hi' }] }); } catch (err) { e2 = err; }
    ok('null content throws (retryable), not blank success', e2 && e2.name === 'ClaudeError' && e2.retryable === true, e2 && e2.message);
  }

  // --- Scenario 10: a normal finish still succeeds (guards not over-eager) --
  {
    const { claude } = loadWith({ LLM_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'k', OPENROUTER_BASE_URL: BASE });
    next = { status: 200, body: okBody('haqiqiy javob') };
    const out = await claude.complete({ system: 's', model: 'anthropic/x', maxTokens: 10, messages: [{ role: 'user', content: 'hi' }] });
    ok('valid non-empty completion still passes', out.text === 'haqiqiy javob' && out.inputTokens === 111, JSON.stringify(out));
  }

  stub.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
