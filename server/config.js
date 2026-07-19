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

  // Anthropic / Claude.
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    baseUrl: (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, ''),
    version: process.env.ANTHROPIC_VERSION || '2023-06-01',
    // The frontend used claude-sonnet-4-5; the backend now owns the choice.
    // Override per your Anthropic access (e.g. a Haiku tier to cut cost).
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
    conversationMaxTokens: int(process.env.CONVERSATION_MAX_TOKENS, 1500),
    reportMaxTokens: int(process.env.REPORT_MAX_TOKENS, 3000),
    timeoutMs: int(process.env.ANTHROPIC_TIMEOUT_MS, 60000),
  },

  // Assessment caps (spec §4/§6).
  caps: {
    maxTurns: int(process.env.MAX_TURNS, 60),
    maxMessageChars: int(process.env.MAX_MESSAGE_CHARS, 2000),
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
  if (!config.anthropic.apiKey) missing.push('ANTHROPIC_API_KEY');
  if (!config.admin.jwtSecret || config.admin.jwtSecret.length < 16) missing.push('JWT_SECRET (>=16 chars)');
  if (config.isProd && missing.length) {
    // eslint-disable-next-line no-console
    console.error('[config] Missing required environment: ' + missing.join(', '));
    process.exit(1);
  }
  if (!config.isProd && missing.length) {
    // eslint-disable-next-line no-console
    console.warn('[config] (dev) missing/weak: ' + missing.join(', ') + ' — some features will error until set.');
  }
}

module.exports = { config, assertProdConfig };
