'use strict';

// Central configuration, read once from the environment. Fail fast on missing
// secrets in production so misconfiguration never ships silently.
require('dotenv').config();

function bool(v, def) {
  if (v === undefined || v === null || v === '') return def;
  return /^(1|true|yes|on)$/i.test(String(v));
}
function int(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';

const config = {
  nodeEnv: NODE_ENV,
  isProd,
  port: int(process.env.PORT, 8080),

  // Public origin used to build absolute report links for SMS/Telegram delivery.
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),

  // Who the report says it is from. The browser has its own copy of both (the
  // page is editable through its props), and unit/brand.test.js holds the two
  // to the same values — a PDF headed with a different name from the page it
  // was downloaded from is worse than either name alone. Phones are stored in
  // E.164 and formatted where they are shown.
  brand: {
    name: process.env.BRAND_NAME || 'CareerKids',
    phones: String(process.env.CONTACT_PHONES || '+998935157343,+998935657343')
      .split(',').map((s) => s.trim()).filter(Boolean),
  },

  // Postgres.
  databaseUrl: process.env.DATABASE_URL || '',

  // LLM provider selection. 'anthropic' talks to the Anthropic Messages API
  // directly; 'openrouter' routes through OpenRouter's OpenAI-compatible API
  // (useful where direct Anthropic billing is unavailable — e.g. cards that the
  // Anthropic API Console rejects). The rest of the app is provider-agnostic:
  // both paths return { text, inputTokens, outputTokens } (see services/claude.js).
  llm: {
    provider: (process.env.LLM_PROVIDER || 'anthropic').toLowerCase(), // anthropic | openrouter
    // Shared generation budgets, applied regardless of provider.
    conversationMaxTokens: int(process.env.CONVERSATION_MAX_TOKENS, 1500),
    // Headroom, not a target. On the current Claude models thinking is always
    // on and cannot be switched off, and thinking tokens are billed as output
    // and count against max_tokens — so a ceiling sized to the report itself
    // (4500 was) gets eaten from the front and the report stops mid-sentence.
    // Nothing is billed for room left unused, so this is free insurance; what
    // it buys is that `stop_reason: max_tokens` stays the rare case the guard
    // in services/claude.js is for, rather than the normal one.
    reportMaxTokens: int(process.env.REPORT_MAX_TOKENS, 16000),
    // The report generates up to reportMaxTokens in one non-streaming call —
    // at real model speeds that is often 1-3 minutes, far beyond the per-turn
    // timeout. Give it its own budget. (A TLS/reverse proxy in front must have
    // a read timeout at least this long.)
    reportTimeoutMs: int(process.env.REPORT_TIMEOUT_MS, 180000),
    // USD per 1M tokens for the active model — drives the admin cost estimate
    // only. Defaults are claude-opus-5-5 list prices, matching the default
    // model below; change both together or Statistika quotes one model's
    // tokens at another's prices.
    priceInPerMtok: Number(process.env.PRICE_INPUT_PER_MTOK || 4),
    priceOutPerMtok: Number(process.env.PRICE_OUTPUT_PER_MTOK || 20),
  },

  // Anthropic / Claude (used when LLM_PROVIDER=anthropic).
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    baseUrl: (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, ''),
    version: process.env.ANTHROPIC_VERSION || '2023-06-01',
    // One report is one call, and that call is the whole product: a page of
    // careful Uzbek about one named child, read by their parent. At roughly
    // 6.4K input tokens (5.6K of it the cached system prompt, billed at a
    // tenth) and a few thousand out, it costs a few cents against a 49,000 UZS
    // report — so the model is chosen on how well it writes, not on price.
    //
    // The spec's claude-sonnet-4-6 is a generation behind and, at $3/$15 per
    // MTok, dearer than the current claude-sonnet-5-5 at $2/$10 — there is no
    // reading under which it is still the right default. Override per what
    // your account can call:
    //   claude-opus-5-5    $4/$20   the default
    //   claude-sonnet-5-5  $2/$10   about half the bill
    //   claude-haiku-5-5   $0.10/$0.50   a rounding error; read its Uzbek
    //                                    before trusting it with a child
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-5-5',
    conversationMaxTokens: int(process.env.CONVERSATION_MAX_TOKENS, 1500),
    reportMaxTokens: int(process.env.REPORT_MAX_TOKENS, 16000),
    timeoutMs: int(process.env.ANTHROPIC_TIMEOUT_MS, 60000),
  },

  // OpenRouter (used when LLM_PROVIDER=openrouter). OpenAI-compatible chat API.
  // Pick a model slug from https://openrouter.ai/models — the prompt is tuned
  // for Claude, so an anthropic/* slug behaves closest to the direct path.
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    baseUrl: (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, ''),
    // Default mirrors the Anthropic default (claude-sonnet-4-6) so switching
    // providers keeps the same tier. OpenRouter uses vendor/model slugs with dot
    // versions — the bare Anthropic id `claude-sonnet-4-6` is NOT valid here.
    model: process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.6',
    // Optional attribution headers OpenRouter shows on your dashboard/rankings.
    siteUrl: process.env.OPENROUTER_SITE_URL || (process.env.PUBLIC_BASE_URL || ''),
    siteName: process.env.OPENROUTER_SITE_NAME || 'CareerKids',
    timeoutMs: int(process.env.OPENROUTER_TIMEOUT_MS, int(process.env.ANTHROPIC_TIMEOUT_MS, 60000)),
  },

  // Assessment caps (spec §4/§6).
  caps: {
    maxTurns: int(process.env.MAX_TURNS, 60),
    maxMessageChars: int(process.env.MAX_MESSAGE_CHARS, 2000),
    // A report must be grounded in real answers, never fabricated. Refuse to
    // generate one until the child has actually answered at least this many
    // turns. The default (1) blocks only the "finished without answering
    // anything" case; raise it to demand more substance. Floored at 1 so the
    // safeguard can never be silently disabled (0/negative would void the gate).
    minAnswersForReport: Math.max(1, int(process.env.MIN_ANSWERS_FOR_REPORT, 1)),
  },

  // Rate limits (spec §6). In-memory; single-instance. See README for scaling.
  rateLimit: {
    messagesPerMin: int(process.env.RL_MESSAGES_PER_MIN, 20),
    // Per IP, per day. Five was set when starting a sitting cost a model call,
    // so an abandoned sitting still cost money; it no longer does — only a
    // finished report calls the model, and that is one per session. The cap is
    // now a brake on junk rows rather than on spend, and five was below what
    // the actual customer does: a teacher works through a class on one school
    // connection, and a family shares a router.
    newSessionsPerDayPerIp: int(process.env.RL_SESSIONS_PER_DAY, 20),
    adminLoginPerMin: int(process.env.RL_ADMIN_LOGIN_PER_MIN, 5),
  },

  // Admin auth.
  admin: {
    jwtSecret: process.env.JWT_SECRET || '',
    sessionTtlHours: int(process.env.ADMIN_SESSION_TTL_HOURS, 12),
    cookieName: 'yik_admin',
    cookieSecure: bool(process.env.COOKIE_SECURE, isProd),
    // Seed credentials (used by db/seed.js only).
    seedEmail: process.env.ADMIN_EMAIL || '',
    seedPassword: process.env.ADMIN_PASSWORD || '',
  },

  // Consent bookkeeping (spec §5/§7): record which text version the parent saw.
  consentTextVersion: process.env.CONSENT_TEXT_VERSION || 'uz-2026-07',

  // Report delivery.
  delivery: {
    provider: (process.env.DELIVERY_PROVIDER || 'console').toLowerCase(), // console | telegram
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN || '',
      botUsername: process.env.TELEGRAM_BOT_USERNAME || '',
      // Where the Bot API lives. Overridable for two reasons: a local mock, so
      // the delivery path can be exercised end to end without a real bot, and
      // a reverse proxy, for networks where api.telegram.org is not reachable.
      apiBase: (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, ''),
    },
  },

  // Telegram authorization, required before an assessment can start. Logging in
  // through the bot is what gives the centre a push channel for the report,
  // reminders and (with consent) promotions.
  auth: {
    // AUTH_REQUIRED=false reverts to the old flow (session first, contact gate
    // later). Kept as an escape hatch for local development without a bot.
    required: process.env.AUTH_REQUIRED !== 'false',
    // How long a deep-link nonce stays valid while the adult opens Telegram.
    nonceTtlMinutes: Number(process.env.AUTH_NONCE_TTL_MINUTES || 15),
    // How long the browser stays logged in before the bot dance repeats.
    tokenTtlDays: Number(process.env.AUTH_TOKEN_TTL_DAYS || 90),
    // When true the bot asks for the phone with a Share-contact button and the
    // login only completes once it is shared. Set false to make it optional.
    requirePhone: process.env.AUTH_REQUIRE_PHONE !== 'false',
  },

  // Paid reports. The assessment is free to run; the detailed part of the
  // report unlocks on payment. Amounts are held in tiyin (1 UZS = 100 tiyin)
  // because that is what Payme speaks and because integer money is the only
  // kind worth trusting.
  payments: {
    // PAYMENTS_ENABLED=false gives every report away, which is also the
    // behaviour every report created before this feature keeps.
    enabled: process.env.PAYMENTS_ENABLED === 'true',
    priceUzs: Number(process.env.REPORT_PRICE_UZS || 49000),
    get priceTiyin() { return Math.round(this.priceUzs * 100); },
    payme: {
      merchantId: process.env.PAYME_MERCHANT_ID || '',
      // The Merchant API key. Payme authenticates to US with it (Basic
      // "Paycom:<key>"), so it is a shared secret, not a client credential.
      merchantKey: process.env.PAYME_MERCHANT_KEY || '',
      checkoutUrl: process.env.PAYME_CHECKOUT_URL || 'https://checkout.paycom.uz',
    },
  },

  // Telegram reminders for people who stopped partway. Bounded on purpose:
  // this bot is a channel parents granted, and burning it costs more than the
  // sale it might recover.
  reminders: {
    enabled: process.env.REMINDERS_ENABLED === 'true',
    // Hours of silence before each nudge. One per person per situation, ever.
    abandonedAfterHours: Number(process.env.REMIND_ABANDONED_HOURS || 24),
    unpaidAfterHours: Number(process.env.REMIND_UNPAID_HOURS || 24),
    neverStartedAfterHours: Number(process.env.REMIND_NEVER_STARTED_HOURS || 24),
    // Stop chasing eventually: past this, the moment has passed.
    giveUpAfterDays: Number(process.env.REMIND_GIVE_UP_DAYS || 14),
    // Never more than this many messages to one parent in a rolling week.
    maxPerParentPerWeek: Number(process.env.REMIND_MAX_PER_WEEK || 2),
    // Local hours (see tzOffsetHours) outside which nothing is sent. Nobody
    // wants a marketing message at 4am, and it is the fastest way to be blocked.
    quietFromHour: Number(process.env.REMIND_QUIET_FROM || 21),
    quietToHour: Number(process.env.REMIND_QUIET_TO || 9),
    // Uzbekistan is UTC+5 and does not observe daylight saving.
    tzOffsetHours: Number(process.env.REMIND_TZ_OFFSET || 5),
    // Safety valve on a job that sends real messages.
    maxPerRun: Number(process.env.REMIND_MAX_PER_RUN || 200),
  },

  // Prompt version override; otherwise derived from the assembled prompt hash.
  promptVersionOverride: process.env.PROMPT_VERSION || '',

  // Directory holding the prompt source files (uploads/*.md).
  promptSourceDir: process.env.PROMPT_SOURCE_DIR || require('path').join(__dirname, '..', 'uploads'),
};

// A key that cannot physically be put in an HTTP header.
//
// An API key goes out as a header value, and header values are ByteStrings —
// ASCII only. One non-ASCII character and `fetch` throws before anything
// leaves the machine, with the true but unhelpful
//
//   Cannot convert argument to a ByteString because the character at index 8
//   has a value of 8226 which is greater than 255
//
// 8226 is U+2022: a bullet. Which is how it happens — the console masks a key
// as `sk-ant-a••••…` and that display gets copied instead of the key. It is
// the right length to look plausible and every character after the eighth is
// a lie. Caught here, at boot, because no retry can ever help: every report
// would fail this way, one per finished sitting, until someone read the log.
//
// Reports the position and the code point, never the key.
function unsendableKey(name, key) {
  const i = [...key].findIndex((c) => c.charCodeAt(0) > 255);
  if (i < 0) return '';
  const cp = key.codePointAt(i);
  const bullet = cp === 0x2022;
  return name + ' contains a non-ASCII character at position ' + (i + 1)
    + ' (U+' + cp.toString(16).toUpperCase().padStart(4, '0') + ')'
    + (bullet
      ? ' — a bullet, which means a masked key was copied from the provider\'s'
        + ' console rather than the key itself. A key is shown in full only once,'
        + ' at creation, so this one cannot be recovered: create a new key and'
        + ' use the Copy button.'
      : ', which cannot be sent in an HTTP header. Re-copy the key.');
}

function assertProdConfig() {
  const missing = [];
  if (!config.databaseUrl) missing.push('DATABASE_URL');
  // Only the active provider's credentials are required.
  if (config.llm.provider === 'openrouter') {
    if (!config.openrouter.apiKey) missing.push('OPENROUTER_API_KEY (required when LLM_PROVIDER=openrouter)');
    else { const b = unsendableKey('OPENROUTER_API_KEY', config.openrouter.apiKey); if (b) missing.push(b); }
  } else {
    if (!config.anthropic.apiKey) missing.push('ANTHROPIC_API_KEY');
    else { const b = unsendableKey('ANTHROPIC_API_KEY', config.anthropic.apiKey); if (b) missing.push(b); }
  }
  if (!config.admin.jwtSecret || config.admin.jwtSecret.length < 16) missing.push('JWT_SECRET (>=16 chars)');
  // Report/resume links are built from this in prod; without it we would fall
  // back to the (spoofable) Host header when generating delivered links.
  if (config.isProd && !config.publicBaseUrl) missing.push('PUBLIC_BASE_URL');
  // A Telegram webhook with no shared secret is unauthenticated (see routes/telegram.js).
  if (config.isProd && config.delivery.provider === 'telegram' && !process.env.TELEGRAM_WEBHOOK_SECRET) {
    missing.push('TELEGRAM_WEBHOOK_SECRET (required when DELIVERY_PROVIDER=telegram)');
  }
  // Authorization runs through the bot, so an unconfigured bot does not degrade
  // gracefully — it locks every user out of starting an assessment. The webhook
  // secret matters here too: without it routes/telegram.js answers 503 and no
  // login can ever complete.
  //
  // AUTH_REQUIRED defaults to ON, so an existing deployment that upgrades into
  // this without a bot stops booting. That is the right failure — a login
  // screen nobody can get past is worse — but only if the operator is told how
  // to get out of it, which is what authHint below is for.
  let authHint = '';
  if (config.auth.required) {
    if (!config.delivery.telegram.botToken) missing.push('TELEGRAM_BOT_TOKEN (required while AUTH_REQUIRED is on)');
    if (!config.delivery.telegram.botUsername) missing.push('TELEGRAM_BOT_USERNAME (required while AUTH_REQUIRED is on)');
    if (config.isProd && !process.env.TELEGRAM_WEBHOOK_SECRET) {
      missing.push('TELEGRAM_WEBHOOK_SECRET (required while AUTH_REQUIRED is on)');
    }
    if (missing.some((m) => m.startsWith('TELEGRAM_'))) {
      authHint =
        'Telegram login is ON (AUTH_REQUIRED defaults to true). Two ways forward:\n' +
        '  1. Create a bot with @BotFather and set TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME\n' +
        '     and TELEGRAM_WEBHOOK_SECRET in .env — parents then log in through the bot.\n' +
        '  2. Set AUTH_REQUIRED=false in .env to run without the login gate (no bot needed;\n' +
        '     report delivery and reminders are unavailable).';
    }
  }

  // Payments handle money, so a half-configured setup must not boot: the
  // failure mode is a parent who pays and never gets their report, or a
  // Merchant API endpoint that accepts unauthenticated calls.
  if (config.payments.enabled) {
    if (!config.payments.payme.merchantId) missing.push('PAYME_MERCHANT_ID (required while PAYMENTS_ENABLED=true)');
    if (!config.payments.payme.merchantKey) missing.push('PAYME_MERCHANT_KEY (required while PAYMENTS_ENABLED=true)');
    if (!(config.payments.priceUzs > 0)) missing.push('REPORT_PRICE_UZS must be a positive number');
    if (config.isProd && !config.publicBaseUrl) missing.push('PUBLIC_BASE_URL (required while PAYMENTS_ENABLED=true)');
  }
  // Reminders send real messages to real people; without a bot they silently
  // do nothing, which is the kind of failure nobody notices for a month.
  if (config.reminders.enabled && !config.delivery.telegram.botToken) {
    missing.push('TELEGRAM_BOT_TOKEN (required while REMINDERS_ENABLED=true)');
  }

  // Model-id shape check. The most common — and hardest to diagnose —
  // misconfiguration is a provider/model-format mismatch: OpenRouter needs a
  // namespaced `vendor/model` slug (anthropic/claude-sonnet-4.6), while the
  // Anthropic API uses ids WITHOUT a slash (claude-sonnet-4-6). A wrong shape
  // makes every LLM call fail with "not a valid model id", so fail fast at boot
  // with a pointed message instead of 400-ing on each request.
  if (config.llm.provider === 'openrouter') {
    if (config.openrouter.model && !config.openrouter.model.includes('/')) {
      missing.push('OPENROUTER_MODEL="' + config.openrouter.model + '" is not a valid OpenRouter slug — it needs a vendor prefix, e.g. anthropic/claude-sonnet-4.6 (see https://openrouter.ai/models)');
    }
  } else if (config.anthropic.model && config.anthropic.model.includes('/')) {
    missing.push('ANTHROPIC_MODEL="' + config.anthropic.model + '" contains a "/" — that is an OpenRouter-style slug; the Anthropic API uses ids like claude-sonnet-4-6 (set LLM_PROVIDER=openrouter to use vendor/model slugs)');
  }

  // The hint goes out with both, because under Docker NODE_ENV is production
  // even on a laptop — which is exactly when someone is most likely to hit
  // this and have no idea it is opt-out-able.
  if (config.isProd && missing.length) {
    // eslint-disable-next-line no-console
    console.error('[config] Invalid or missing required environment: ' + missing.join(', '));
    // eslint-disable-next-line no-console
    if (authHint) console.error('[config] ' + authHint);
    process.exit(1);
  }
  if (!config.isProd && missing.length) {
    // eslint-disable-next-line no-console
    console.warn('[config] (dev) missing/weak/invalid: ' + missing.join(', ') + ' — some features will error until set.');
    // eslint-disable-next-line no-console
    if (authHint) console.warn('[config] ' + authHint);
  }
}

module.exports = { config, assertProdConfig };
