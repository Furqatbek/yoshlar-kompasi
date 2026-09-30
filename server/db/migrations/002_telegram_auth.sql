-- 002_telegram_auth.sql
-- Authorization moved to the FRONT of the funnel: an adult must log in or
-- register through the Telegram bot before an assessment can start, so the
-- centre always holds a push channel (report delivery, reminders, promotions)
-- and a Telegram-verified phone number.
--
-- Before: child + session created anonymously, parent captured at the report
-- gate (children.parent_id nullable, filled in later).
-- After:  parent exists first; children.parent_id is set at creation. The
-- column stays nullable so rows created under the old flow remain valid.

-- parents: Telegram identity ------------------------------------------------
-- chat_id is the push address; it is what makes notifications possible at all.
-- A parent may exist without it (legacy rows created via the old phone gate).
ALTER TABLE parents ADD COLUMN IF NOT EXISTS telegram_chat_id    BIGINT;
ALTER TABLE parents ADD COLUMN IF NOT EXISTS telegram_username   TEXT;
ALTER TABLE parents ADD COLUMN IF NOT EXISTS telegram_first_name TEXT;
ALTER TABLE parents ADD COLUMN IF NOT EXISTS telegram_linked_at  TIMESTAMPTZ;
ALTER TABLE parents ADD COLUMN IF NOT EXISTS phone_verified      BOOLEAN NOT NULL DEFAULT FALSE;

-- One parent row per Telegram account. Partial index so the many legacy rows
-- with a NULL chat_id do not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS idx_parents_telegram_chat_id
  ON parents (telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;

-- auth_requests: the deep-link login handshake -------------------------------
-- The browser asks for a nonce, shows t.me/<bot>?start=auth_<nonce>, then polls.
-- The bot's /start handler binds the Telegram chat to the nonce. Short-lived by
-- design: a nonce is single-use and expires in minutes.
CREATE TABLE IF NOT EXISTS auth_requests (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nonce                TEXT UNIQUE NOT NULL,
  parent_id            UUID REFERENCES parents (id) ON DELETE CASCADE,
  -- pending  : issued, waiting for the adult to press Start in Telegram
  -- awaiting_phone : chat linked, bot has asked for the contact
  -- linked   : complete; a parent token is ready to hand back once
  -- consumed : the browser has collected the token
  status               TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'awaiting_phone', 'linked', 'consumed')),
  -- Consent is recorded in the browser, before the deep link is opened, so the
  -- adult sees the wording on the page they are actually reading.
  marketing_consent    BOOLEAN NOT NULL DEFAULT FALSE,
  consent_text_version TEXT,
  token                TEXT,                    -- parent token, handed over once
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  linked_at            TIMESTAMPTZ,
  expires_at           TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_requests_expires_at ON auth_requests (expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_requests_parent_id  ON auth_requests (parent_id);

-- parent_tokens: the long-lived browser login -------------------------------
-- Stored in the browser like the existing session handle. Kept in plain text
-- for the same reason session_token is: a database breach already exposes the
-- reports and phone numbers these tokens guard, so hashing buys little here
-- while adding a second convention. Revocation is a DELETE.
CREATE TABLE IF NOT EXISTS parent_tokens (
  token        TEXT PRIMARY KEY,
  parent_id    UUID NOT NULL REFERENCES parents (id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_parent_tokens_parent_id  ON parent_tokens (parent_id);
CREATE INDEX IF NOT EXISTS idx_parent_tokens_expires_at ON parent_tokens (expires_at);
