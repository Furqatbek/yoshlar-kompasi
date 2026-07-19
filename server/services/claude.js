'use strict';

// Claude proxy (backend-spec §1/§4). Holds the API key server-side and forwards
// the conversation to the Anthropic Messages API. Returns text plus token usage
// so callers can log cost onto the session.

const { config } = require('../config');

class ClaudeError extends Error {
  constructor(message, { status = 502, retryable = true } = {}) {
    super(message);
    this.name = 'ClaudeError';
    this.status = status;
    this.retryable = retryable;
  }
}

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

async function complete({ system, model, maxTokens, messages }) {
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
    const aborted = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new ClaudeError(aborted ? 'Claude javob bermadi (timeout).' : 'Claude bilan bog‘lanib bo‘lmadi.', {
      status: 504,
      retryable: true,
    });
  }

  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = (j && j.error && j.error.message) || '';
    } catch (_) { /* ignore */ }
    // 429 and 5xx are retryable; 4xx (bad request, auth) are not.
    const retryable = res.status === 429 || res.status >= 500;
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

module.exports = { complete, normalizeForAnthropic, ClaudeError };
