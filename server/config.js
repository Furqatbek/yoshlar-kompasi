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
    reportMaxTokens: int(process.env.REPORT_MAX_TOKENS, 4500),
    // The report generates up to reportMaxTokens in one non-streaming call —
    // at real model speeds that is often 1-3 minutes, far beyond the per-turn
    // timeout. Give it its own budget. (A TLS/reverse proxy in front must have
    // a read timeout at least this long.)
    reportTimeoutMs: int(process.env.REPORT_TIMEOUT_MS, 180000),
  },

  // Anthropic / Claude (used when LLM_PROVIDER=anthropic).
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    baseUrl: (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, ''),
    version: process.env.ANTHROPIC_VERSION || '2023-06-01',
    // Spec §4: start with claude-sonnet-4-6; A/B claude-haiku-4-5-20251001 for
    // cost. Override per your Anthropic account access.
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    conversationMaxTokens: int(process.env.CONVERSATION_MAX_TOKENS, 1500),
    reportMaxTokens: int(process.env.REPORT_MAX_TOKENS, 4500),
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
    siteName: process.env.OPENROUTER_SITE_NAME || 'Yoshlar Kompasi',
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
    newSessionsPerDayPerIp: int(process.env.RL_SESSIONS_PER_DAY, 5),
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
    },
  },

  // Prompt version override; otherwise derived from the assembled prompt hash.
  promptVersionOverride: process.env.PROMPT_VERSION || '',

  // Directory holding the prompt source files (uploads/*.md).
  promptSourceDir: process.env.PROMPT_SOURCE_DIR || require('path').join(__dirname, '..', 'uploads'),
};

function assertProdConfig() {
  const missing = [];
  if (!config.databaseUrl) missing.push('DATABASE_URL');
  // Only the active provider's credentials are required.
  if (config.llm.provider === 'openrouter') {
    if (!config.openrouter.apiKey) missing.push('OPENROUTER_API_KEY (required when LLM_PROVIDER=openrouter)');
  } else {
    if (!config.anthropic.apiKey) missing.push('ANTHROPIC_API_KEY');
  }
  if (!config.admin.jwtSecret || config.admin.jwtSecret.length < 16) missing.push('JWT_SECRET (>=16 chars)');
  // Report/resume links are built from this in prod; without it we would fall
  // back to the (spoofable) Host header when generating delivered links.
  if (config.isProd && !config.publicBaseUrl) missing.push('PUBLIC_BASE_URL');
  // A Telegram webhook with no shared secret is unauthenticated (see routes/telegram.js).
  if (config.isProd && config.delivery.provider === 'telegram' && !process.env.TELEGRAM_WEBHOOK_SECRET) {
    missing.push('TELEGRAM_WEBHOOK_SECRET (required when DELIVERY_PROVIDER=telegram)');
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

  if (config.isProd && missing.length) {
    // eslint-disable-next-line no-console
    console.error('[config] Invalid or missing required environment: ' + missing.join(', '));
    process.exit(1);
  }
  if (!config.isProd && missing.length) {
    // eslint-disable-next-line no-console
    console.warn('[config] (dev) missing/weak/invalid: ' + missing.join(', ') + ' — some features will error until set.');
  }
}

module.exports = { config, assertProdConfig };
