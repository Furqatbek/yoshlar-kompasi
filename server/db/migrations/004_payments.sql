-- 004_payments.sql
-- Paid reports, and the reminders that chase the people who do not pay.
--
-- The product used to give the report away and earn from course enrolments.
-- Now the report itself is the thing sold: it is generated in full, a free
-- summary is shown, and the detailed part unlocks on payment.
--
-- Money is stored in TIYIN (1 UZS = 100 tiyin), as integers. Payme's API works
-- in tiyin, and floating-point currency is a bug waiting to happen.

-- orders ------------------------------------------------------------------
-- One order per report: the report is the thing bought, and buying it twice
-- makes no sense, so report_id is unique. The order is created together with
-- the report, before anyone has tried to pay, so a payment always has
-- something to attach to.
CREATE TABLE IF NOT EXISTS orders (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id  UUID NOT NULL UNIQUE REFERENCES reports (id) ON DELETE CASCADE,
  -- Kept for lookups and reminders. SET NULL rather than CASCADE: an erased
  -- parent must not erase the financial record of a completed sale.
  parent_id  UUID REFERENCES parents (id) ON DELETE SET NULL,
  amount     BIGINT NOT NULL,                  -- tiyin, frozen at creation
  currency   TEXT NOT NULL DEFAULT 'UZS',
  -- pending   : created, nobody has paid
  -- paid      : money received, the report is unlocked
  -- cancelled : the provider reversed it (refund or failed transaction)
  state      TEXT NOT NULL DEFAULT 'pending'
             CHECK (state IN ('pending', 'paid', 'cancelled')),
  paid_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_parent_id ON orders (parent_id);
CREATE INDEX IF NOT EXISTS idx_orders_state ON orders (state);

-- payments ----------------------------------------------------------------
-- One row per provider transaction. An order can collect several: Payme may
-- create a transaction, have it time out or be cancelled, and then create
-- another for the same order.
--
-- The columns mirror Payme's Merchant API rather than a tidier shape of our
-- own, because Payme reads them back: CheckTransaction must return the same
-- create_time / perform_time / cancel_time / state / reason it was given, in
-- milliseconds. Translating in and out of a prettier schema would be a
-- constant source of protocol bugs for no gain.
CREATE TABLE IF NOT EXISTS payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  provider        TEXT NOT NULL DEFAULT 'payme',
  provider_txn_id TEXT NOT NULL,
  -- Payme's own `time` field from CreateTransaction (ms since epoch).
  provider_time   BIGINT,
  amount          BIGINT NOT NULL,             -- tiyin, as the provider sent it
  -- Payme's transaction state machine, stored with its own numbers:
  --   1 = created, 2 = performed, -1 = cancelled while created,
  --  -2 = cancelled after performing (a refund).
  state           INTEGER NOT NULL DEFAULT 1,
  reason          INTEGER,                     -- Payme cancellation reason
  create_time     BIGINT NOT NULL DEFAULT 0,   -- ms; 0 means "not yet"
  perform_time    BIGINT NOT NULL DEFAULT 0,
  cancel_time     BIGINT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Idempotency: Payme retries, and a retried CreateTransaction must return
  -- the original row rather than open a second one.
  UNIQUE (provider, provider_txn_id)
);
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments (order_id);
-- GetStatement asks for every transaction in a time range.
CREATE INDEX IF NOT EXISTS idx_payments_create_time ON payments (create_time);

-- reminders_sent ----------------------------------------------------------
-- What the bot has already chased someone about. The unique constraint is the
-- whole safety mechanism: a scheduled job that runs every hour must not be
-- able to message the same parent about the same thing twice, whatever else
-- goes wrong.
--
-- session_id is part of the key so a parent testing a second child can still
-- be reminded about that child; COALESCE to a zero UUID because NULL is not
-- equal to NULL in a unique index, which would silently allow duplicates for
-- the reminders that have no session.
CREATE TABLE IF NOT EXISTS reminders_sent (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id  UUID NOT NULL REFERENCES parents (id) ON DELETE CASCADE,
  -- 'abandoned' | 'unpaid' | 'never_started'
  kind       TEXT NOT NULL,
  session_id UUID REFERENCES sessions (id) ON DELETE CASCADE,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reminders_once
  ON reminders_sent (parent_id, kind, COALESCE(session_id, '00000000-0000-0000-0000-000000000000'::uuid));
-- "How many have we sent this parent lately?" — the per-parent cap.
CREATE INDEX IF NOT EXISTS idx_reminders_parent_sent ON reminders_sent (parent_id, sent_at);

-- parents: a working opt-out ------------------------------------------------
-- marketing_consent covers promotions. This is a harder switch: /stop in the
-- bot sets it, and nothing automated is ever sent again — not reminders, not
-- offers. The report they paid for still reaches them; that is not marketing.
ALTER TABLE parents ADD COLUMN IF NOT EXISTS reminders_opted_out BOOLEAN NOT NULL DEFAULT FALSE;
