'use strict';

// LLM credit monitor (cron this daily). Prints usage/remaining and exits
// non-zero when remaining credit falls below BILLING_ALERT_MIN_USD, so cron's
// MAILTO (or any wrapper: healthchecks.io, a Telegram curl, etc.) can alert.
//
//   BILLING_ALERT_MIN_USD=10 npm run billing-check
//
// OpenRouter: tries the account-wide /credits endpoint first, then falls back
// to the key-scoped /key endpoint (whose limit_remaining requires a key limit
// set at openrouter.ai/keys). Anthropic direct has no public credits API.

const { config } = require('../config');

async function getJson(url) {
  const res = await fetch(url, {
    headers: { authorization: 'Bearer ' + config.openrouter.apiKey },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

async function main() {
  const min = Number(process.env.BILLING_ALERT_MIN_USD || 5);
  if (config.llm.provider !== 'openrouter') {
    // eslint-disable-next-line no-console
    console.log('[billing] provider=' + config.llm.provider + ' — no public credits API; check the provider console manually.');
    return 0;
  }
  if (!config.openrouter.apiKey) {
    // eslint-disable-next-line no-console
    console.error('[billing] OPENROUTER_API_KEY not set');
    return 2;
  }

  let remaining = null;
  let detail = '';

  const credits = await getJson(config.openrouter.baseUrl + '/credits');
  if (credits && credits.data && credits.data.total_credits != null) {
    remaining = Number(credits.data.total_credits) - Number(credits.data.total_usage || 0);
    detail = 'account credits=$' + Number(credits.data.total_credits).toFixed(2) + ' used=$' + Number(credits.data.total_usage || 0).toFixed(2);
  } else {
    const key = await getJson(config.openrouter.baseUrl + '/key');
    const d = (key && key.data) || null;
    if (!d) {
      // eslint-disable-next-line no-console
      console.error('[billing] could not read OpenRouter /credits or /key');
      return 2;
    }
    detail = 'key usage=$' + Number(d.usage || 0).toFixed(2);
    if (d.limit_remaining != null) remaining = Number(d.limit_remaining);
  }

  // eslint-disable-next-line no-console
  console.log('[billing] ' + detail + (remaining != null
    ? ' remaining=$' + remaining.toFixed(2)
    : ' remaining=unknown (set a key limit at openrouter.ai/keys to enable alerts)'));

  if (remaining != null && remaining < min) {
    // eslint-disable-next-line no-console
    console.error('[billing] ALERT: remaining credit $' + remaining.toFixed(2) + ' is below the $' + min + ' threshold — top up before sessions start failing.');
    return 1;
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error('[billing] ' + e.message);
    process.exit(2);
  });
