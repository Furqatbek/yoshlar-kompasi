'use strict';

// Does the key work, and can this account call this model?
//
// Both are configuration, and until now both were discovered the same way: a
// child answered seventy questions, an adult typed their phone number, and the
// one model call of the whole sitting came back 401. The reason was in the
// server log, which is the right place for it and the last place anyone thinks
// to look when a button appears to do nothing.
//
// Two GETs at boot answer it instead. Neither generates tokens, so neither
// costs anything, and nothing here is fatal: a provider that is briefly
// unreachable at boot must not stop the app from serving a landing page.

const { config } = require('../config');

// Why a rejected key is rejected, when the value itself can say.
//
// A revoked key and a key that lost half of itself to a line wrap in .env both
// come back 401, and the fixes are different: reissue, or re-paste. The second
// is what happened on careerkids.uz — a 108-character key stored as 62, both
// `source .env` and compose reading the same truncated value, so every check
// that compared them agreed and said nothing.
//
// Only ever appended to a failure that the provider has already confirmed, and
// never used to refuse a key on its own: if a provider changes its key format
// tomorrow, a working key must keep working. Reports the length, never a
// character of the value — the prefix it checks for is public.
function shapeHint(name, key, prefix, minLen) {
  const bits = [];
  if (!key.startsWith(prefix)) bits.push('it does not start with "' + prefix + '"');
  if (key.length < minLen) {
    bits.push('it is only ' + key.length + ' characters, which is shorter than any '
      + 'issued key — the likeliest cause is a paste that wrapped onto a second '
      + 'line in .env, leaving the tail of it as a stray line. ' + name
      + ' has to be one unbroken line');
  }
  return bits.length ? ' Also worth checking: ' + bits.join('; ') + '.' : '';
}

// status: skipped | ok | bad-key | model-unavailable | error
async function check(fetchImpl) {
  const f = fetchImpl || fetch;
  return config.llm.provider === 'openrouter'
    ? checkOpenRouter(f)
    : checkAnthropic(f);
}

async function checkAnthropic(f) {
  const { apiKey, baseUrl, version, model } = config.anthropic;
  if (!apiKey) return { status: 'skipped', detail: 'no ANTHROPIC_API_KEY' };
  const headers = { 'x-api-key': apiKey, 'anthropic-version': version };

  let res;
  try {
    res = await f(baseUrl + '/v1/models/' + encodeURIComponent(model), {
      headers, signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    return { status: 'error', detail: 'could not reach ' + baseUrl + ': ' + err.message };
  }

  if (res.status === 401 || res.status === 403) {
    return {
      status: 'bad-key',
      detail: 'the provider rejected ANTHROPIC_API_KEY (HTTP ' + res.status + '). Every '
        + 'report will fail at the last step, after the child has answered '
        + 'everything. A revoked or mistyped key, or a key for a different '
        + 'account, all look like this. Note that editing .env is not enough on '
        + 'its own — the container keeps the environment it started with until '
        + 'it is recreated (make prod-up).'
        + shapeHint('ANTHROPIC_API_KEY', apiKey, 'sk-ant-', 80),
    };
  }
  if (res.status === 404) {
    // The key is fine — a bad key would have been 401 — so we can ask what
    // this account may actually call, which is the next question anyway.
    const ids = await listAnthropicModels(f, baseUrl, headers);
    return {
      status: 'model-unavailable',
      detail: 'ANTHROPIC_MODEL="' + model + '" is not available to this account'
        + (ids.length
          ? '. It can call: ' + ids.join(', ')
          : ' (and the model list could not be read either)'),
    };
  }
  if (!res.ok) return { status: 'error', detail: 'HTTP ' + res.status + ' from ' + baseUrl };
  return { status: 'ok', detail: 'key accepted, model=' + model };
}

async function listAnthropicModels(f, baseUrl, headers) {
  try {
    const res = await f(baseUrl + '/v1/models?limit=100', { headers, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const body = await res.json();
    return ((body && body.data) || []).map((m) => m && m.id).filter(Boolean);
  } catch (_) {
    return [];
  }
}

async function checkOpenRouter(f) {
  const { apiKey, baseUrl, model } = config.openrouter;
  if (!apiKey) return { status: 'skipped', detail: 'no OPENROUTER_API_KEY' };
  let res;
  try {
    res = await f(baseUrl + '/key', {
      headers: { authorization: 'Bearer ' + apiKey },
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    return { status: 'error', detail: 'could not reach ' + baseUrl + ': ' + err.message };
  }
  if (res.status === 401 || res.status === 403) {
    return {
      status: 'bad-key',
      detail: 'the provider rejected OPENROUTER_API_KEY (HTTP ' + res.status + '). Every '
        + 'report will fail at the last step. Note that editing .env is not '
        + 'enough on its own — the container keeps the environment it started '
        + 'with until it is recreated (make prod-up).'
        + shapeHint('OPENROUTER_API_KEY', apiKey, 'sk-or-', 40),
    };
  }
  if (!res.ok) return { status: 'error', detail: 'HTTP ' + res.status + ' from ' + baseUrl };
  // OpenRouter will not tell us whether a slug is callable without spending a
  // token on it, so the model stays unverified here. The boot line says so
  // rather than implying it was checked.
  return { status: 'ok', detail: 'key accepted, model=' + model + ' (not verified)' };
}

// The boot line. Never prints the key.
async function report(log) {
  const out = log || console;
  const r = await check();
  if (r.status === 'skipped') return r;
  if (r.status === 'ok') {
    // eslint-disable-next-line no-console
    out.log('[llm] ' + r.detail);
  } else {
    // eslint-disable-next-line no-console
    out.warn('[llm] PROVIDER PROBLEM (' + r.status + '): ' + r.detail);
  }
  return r;
}

module.exports = { check, report };
