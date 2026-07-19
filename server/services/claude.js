'use strict';

// LLM proxy (backend-spec §1/§4). Holds the API key server-side and forwards the
// conversation to the configured provider. Two providers are supported and both
// return the same shape — { text, inputTokens, outputTokens, stopReason } — so
// the rest of the app never needs to know which one is active:
//
//   LLM_PROVIDER=anthropic   -> Anthropic Messages API (default)
//   LLM_PROVIDER=openrouter  -> OpenRouter (OpenAI-compatible Chat Completions)
//
// OpenRouter exists as an escape hatch: where direct Anthropic API billing is
// unavailable (e.g. cards the Anthropic Console rejects), OpenRouter accepts the
// same conversation and can route to an anthropic/* model. The system prompt and
// stored history only ever contain nickname/grade/age/answers — never the
// parent's contact details (spec §7) — regardless of provider.

const { config } = require('../config');

class ClaudeError extends Error {
  constructor(message, { status = 502, retryable = true } = {}) {
    super(message);
    this.name = 'ClaudeError';
    this.status = status;
    this.retryable = retryable;
  }
}

// 429 and 5xx are transient (retryable); 4xx (bad request, auth, credits) are not.
function statusIsRetryable(status) {
  return status === 429 || status >= 500;
}

// Turn a fetch/network failure into a retryable ClaudeError.
function networkError(err) {
  const aborted = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
  return new ClaudeError(aborted ? 'Model javob bermadi (timeout).' : 'Model bilan bog‘lanib bo‘lmadi.', {
    status: 504,
    retryable: true,
  });
}

// The model id that new sessions are stamped with, for the active provider.
function activeModel() {
  return config.llm.provider === 'openrouter' ? config.openrouter.model : config.anthropic.model;
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

// Anthropic requires the first message to be `user` and roles to alternate.
// Our stored history always alternates, but a failed turn can leave a dangling
// user message; merging consecutive same-role turns keeps the request valid.
function normalizeForAnthropic(messages) {
  const out = [];
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const content = String(m.content == null ? '' : m.content);
    const last = out[out.length - 1];
    if (last && last.role === role) {
      last.content += '\n\n' + content;
    } else {
      out.push({ role, content });
    }
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

async function completeAnthropic({ system, model, maxTokens, messages }) {
  if (!config.anthropic.apiKey) {
    throw new ClaudeError('Claude API kaliti sozlanmagan.', { status: 500, retryable: false });
  }
  const body = {
    model: model || config.anthropic.model,
    max_tokens: maxTokens,
    system,
    messages: normalizeForAnthropic(messages),
  };

  let res;
  try {
    res = await fetch(config.anthropic.baseUrl + '/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': config.anthropic.apiKey,
        'anthropic-version': config.anthropic.version,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.anthropic.timeoutMs),
    });
  } catch (err) {
    throw networkError(err);
  }

  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = (j && j.error && j.error.message) || '';
    } catch (_) { /* ignore */ }
    const retryable = statusIsRetryable(res.status);
    throw new ClaudeError('Claude xatosi (' + res.status + ')' + (detail ? ': ' + detail : ''), {
      status: retryable ? 502 : 500,
      retryable,
    });
  }

  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b && b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  const usage = data.usage || {};
  return {
    text,
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    stopReason: data.stop_reason || null,
  };
}

// ---------------------------------------------------------------------------
// OpenRouter (OpenAI-compatible Chat Completions)
// ---------------------------------------------------------------------------

// OpenAI-format messages: a leading system message, then the turns. Unlike
// Anthropic, alternation is not required, so we map the history straight through
// (a dangling user turn is fine) and skip empty turns.
function toOpenAIMessages(system, messages) {
  const out = [];
  if (system) out.push({ role: 'system', content: String(system) });
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const content = String(m.content == null ? '' : m.content);
    if (content === '') continue;
    out.push({ role, content });
  }
  return out;
}

async function completeOpenRouter({ system, model, maxTokens, messages }) {
  if (!config.openrouter.apiKey) {
    throw new ClaudeError('OpenRouter API kaliti sozlanmagan.', { status: 500, retryable: false });
  }
  const body = {
    model: model || config.openrouter.model,
    max_tokens: maxTokens,
    messages: toOpenAIMessages(system, messages),
  };

  const headers = {
    'authorization': 'Bearer ' + config.openrouter.apiKey,
    'content-type': 'application/json',
  };
  // Optional attribution headers OpenRouter surfaces on its dashboard/rankings.
  if (config.openrouter.siteUrl) headers['HTTP-Referer'] = config.openrouter.siteUrl;
  if (config.openrouter.siteName) headers['X-Title'] = config.openrouter.siteName;

  let res;
  try {
    res = await fetch(config.openrouter.baseUrl + '/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.openrouter.timeoutMs),
    });
  } catch (err) {
    throw networkError(err);
  }

  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      // OpenRouter/OpenAI errors: { error: { message } }; sometimes a string.
      detail = (j && j.error && (j.error.message || j.error)) || '';
      if (typeof detail !== 'string') detail = '';
    } catch (_) { /* ignore */ }
    const retryable = statusIsRetryable(res.status);
    throw new ClaudeError('OpenRouter xatosi (' + res.status + ')' + (detail ? ': ' + detail : ''), {
      status: retryable ? 502 : 500,
      retryable,
    });
  }

  const data = await res.json();
  // A 200 can still carry an error body (upstream provider failure surfaced by
  // OpenRouter). Treat it as retryable so the client's "Qayta urinish" works.
  if (data && data.error) {
    const msg = (data.error.message || (typeof data.error === 'string' ? data.error : '')) || 'noma’lum xato';
    throw new ClaudeError('OpenRouter xatosi: ' + msg, { status: 502, retryable: true });
  }
  const choice = (data.choices && data.choices[0]) || null;
  const text = ((choice && choice.message && choice.message.content) || '').trim();
  const usage = data.usage || {};
  return {
    text,
    inputTokens: usage.prompt_tokens || 0,
    outputTokens: usage.completion_tokens || 0,
    stopReason: (choice && choice.finish_reason) || null,
  };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

async function complete(opts) {
  if (config.llm.provider === 'openrouter') return completeOpenRouter(opts);
  return completeAnthropic(opts);
}

module.exports = {
  complete,
  completeAnthropic,
  completeOpenRouter,
  activeModel,
  normalizeForAnthropic,
  toOpenAIMessages,
  ClaudeError,
};
