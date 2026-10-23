'use strict';

// Is Telegram actually pointed at us?
//
// Registering the webhook is a manual step, and forgetting it fails in the
// quietest way this product has. The site sends the parent to the bot, the
// parent presses Start, the bot says nothing, the page waits forever, and no
// log line anywhere mentions it — because nothing reached us to log. From the
// outside it is indistinguishable from a bug in the login code.
//
// So ask Telegram at boot and say what it answers. One call, nothing fatal:
// this is a diagnosis, not a gate.
//
// It deliberately does NOT register the webhook for us, tempting as that is.
// Two deployments sharing one bot token — a staging box and the real one — have
// exactly one webhook between them, and whichever booted last would silently
// steal every parent's login. A warning that names the mismatch is recoverable
// in a minute; that is not.

const { config } = require('../../config');

const PATH = '/api/telegram/webhook';

function expectedUrl() {
  const base = String(config.publicBaseUrl || '').replace(/\/+$/, '');
  return /^https?:\/\//i.test(base) ? base + PATH : '';
}

// Separated from the logging so a test can assert the verdict rather than
// scrape stdout. Returns { status, detail } where status is one of:
//   skipped | ok | mismatch | unset | error | unknown-base
async function check(fetchImpl) {
  const tg = config.delivery.telegram;
  const needed = config.auth.required || config.delivery.provider === 'telegram';
  if (!needed || !tg.botToken) return { status: 'skipped', detail: 'bot not in use' };

  const want = expectedUrl();
  if (!want) {
    return {
      status: 'unknown-base',
      detail: 'PUBLIC_BASE_URL is not an absolute URL, so the expected webhook '
        + 'address cannot be worked out',
    };
  }

  let info;
  try {
    const res = await (fetchImpl || fetch)(
      tg.apiBase + '/bot' + tg.botToken + '/getWebhookInfo',
      { signal: AbortSignal.timeout(10000) }
    );
    const body = await res.json();
    if (!body || !body.ok) {
      return { status: 'error', detail: (body && body.description) || ('HTTP ' + res.status) };
    }
    info = body.result || {};
  } catch (err) {
    // Telegram unreachable at boot is its own problem, but not this one's to
    // decide — say so and move on.
    return { status: 'error', detail: err.message };
  }

  const got = String(info.url || '');
  if (!got) {
    return {
      status: 'unset',
      detail: 'no webhook is registered, so the bot receives nothing: parents '
        + 'will press Start and wait forever. Register it:\n'
        + '  curl -sS "' + tg.apiBase + '/bot$TELEGRAM_BOT_TOKEN/setWebhook" \\\n'
        + '    -d "url=' + want + '" -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"',
    };
  }
  if (got !== want) {
    return {
      status: 'mismatch',
      detail: 'Telegram is delivering to ' + got + ' but this deployment is '
        + want + '. If another deployment shares this bot token, it is '
        + 'receiving these parents’ logins.',
    };
  }

  // Registered and pointed here. Telegram also remembers its last delivery
  // failure, which is how a secret mismatch (401) shows up from this side.
  const parts = ['url=' + got];
  if (info.pending_update_count) parts.push('pending=' + info.pending_update_count);
  if (info.last_error_message) {
    return {
      status: 'ok',
      detail: parts.join(' ') + ' — but Telegram’s last delivery failed: '
        + info.last_error_message
        + (/40[13]/.test(String(info.last_error_message))
          ? ' (a 401 here means TELEGRAM_WEBHOOK_SECRET does not match the '
            + 'secret_token the webhook was registered with)'
          : ''),
      degraded: true,
    };
  }
  return { status: 'ok', detail: parts.join(' ') };
}

// The boot line. Never prints the token.
async function report(log) {
  const out = log || console;
  const r = await check();
  if (r.status === 'skipped') return r;
  if (r.status === 'ok' && !r.degraded) {
    // eslint-disable-next-line no-console
    out.log('[telegram] webhook ' + r.detail);
  } else {
    // eslint-disable-next-line no-console
    out.warn('[telegram] WEBHOOK PROBLEM (' + r.status + '): ' + r.detail);
  }
  return r;
}

module.exports = { check, report, expectedUrl, PATH };
