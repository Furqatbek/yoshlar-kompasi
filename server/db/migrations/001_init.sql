-- Yosh Iste'dodlar Kompasi — initial schema (backend-spec §3).
-- UUIDs for all public-facing ids. Children's data is minimized by design:
-- there is deliberately NO column for surname, address, school number or photo,
-- so the schema makes storing them impossible.

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- Enum types --------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE lead_status AS ENUM ('new', 'contacted', 'interested', 'enrolled', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE session_status AS ENUM ('active', 'paused', 'finished', 'abandoned');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE assessment_level AS ENUM ('shakllanmoqda', 'meyorda', 'kuchli');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE message_role AS ENUM ('user', 'assistant');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- parents -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  phone                 TEXT UNIQUE,                    -- normalized E.164, nullable (view-only)
  email                 TEXT,
  marketing_consent     BOOLEAN NOT NULL DEFAULT FALSE,
  consent_text_version  TEXT,
  consented_at          TIMESTAMPTZ,
  lead_status           lead_status NOT NULL DEFAULT 'new',
  admin_notes           TEXT NOT NULL DEFAULT '',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_parents_created_at ON parents (created_at);
CREATE INDEX IF NOT EXISTS idx_parents_consented_at ON parents (consented_at);
CREATE INDEX IF NOT EXISTS idx_parents_lead_status ON parents (lead_status);

-- children ----------------------------------------------------------------
-- parent_id is nullable: a session starts BEFORE the contact gate, so the child
-- exists first and is linked to a parent at the gate.
CREATE TABLE IF NOT EXISTS children (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id   UUID REFERENCES parents (id) ON DELETE CASCADE,
  nickname    TEXT NOT NULL,
  grade       SMALLINT NOT NULL CHECK (grade BETWEEN 1 AND 4),
  age         SMALLINT CHECK (age IS NULL OR age BETWEEN 3 AND 18),
  goal        TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_children_parent_id ON children (parent_id);

-- sessions ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id       UUID NOT NULL REFERENCES children (id) ON DELETE CASCADE,
  session_token  TEXT UNIQUE NOT NULL,                 -- random 32+ bytes
  status         session_status NOT NULL DEFAULT 'active',
  prompt_version TEXT NOT NULL,
  model          TEXT NOT NULL,
  turn_count     INTEGER NOT NULL DEFAULT 0,
  input_tokens   BIGINT NOT NULL DEFAULT 0,
  output_tokens  BIGINT NOT NULL DEFAULT 0,
  -- Track completion of each assessment track (the [YAKUN: …] markers) so the
  -- report gate can open. Kept as columns for cheap querying.
  done_mantiq      BOOLEAN NOT NULL DEFAULT FALSE,
  done_psixologiya BOOLEAN NOT NULL DEFAULT FALSE,
  done_harakat     BOOLEAN NOT NULL DEFAULT FALSE,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sessions_child_id ON sessions (child_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions (started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_finished_at ON sessions (finished_at);

-- messages ----------------------------------------------------------------
-- A separate table (not a JSON blob) keeps analytics and debugging easy.
-- `meta` marks internal turns (the generated intro, the report request) that
-- the adult should never see in the chat transcript.
CREATE TABLE IF NOT EXISTS messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  role        message_role NOT NULL,
  content     TEXT NOT NULL,
  meta        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_session_id_created ON messages (session_id, created_at);

-- reports -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reports (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     UUID NOT NULL UNIQUE REFERENCES sessions (id) ON DELETE CASCADE,  -- one report per session
  child_id       UUID NOT NULL REFERENCES children (id) ON DELETE CASCADE,
  content_md     TEXT NOT NULL,
  level_logic    assessment_level,
  level_psych    assessment_level,
  level_activity assessment_level,
  sports         JSONB NOT NULL DEFAULT '[]'::jsonb,
  partial        BOOLEAN NOT NULL DEFAULT FALSE,
  share_token    TEXT UNIQUE NOT NULL,
  delivered      BOOLEAN NOT NULL DEFAULT FALSE,
  delivered_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reports_child_id ON reports (child_id);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports (created_at);

-- admins ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admins (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'admin',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
