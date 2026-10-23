-- The two optional modules, §8 and §9.
--
-- The one thing this schema exists to guarantee: a module answer can never be
-- scored as an interest.
--
-- The obvious design is a `module` column on `answers` and a WHERE clause
-- everywhere that reads it. That is one forgotten clause away from a child's
-- homework preference being averaged into "Mantiq va matematika", and the
-- failure is invisible — an interest score that is wrong by a plausible amount
-- is not distinguishable from a correct one by looking at it.
--
-- So they live in their own table. services/scoring.js reads repo.getAnswers(),
-- which selects from `answers` alone; there is no join, no flag and no clause
-- to forget. unit/modules.test.js proves the isolation by filling both modules
-- and checking that every interest score is byte-identical.

CREATE TABLE IF NOT EXISTS module_questions (
  module      TEXT    NOT NULL,
  n           SMALLINT NOT NULL,
  text        TEXT    NOT NULL,
  -- 'scale'  — answered 1-5 (learning preferences)
  -- 'choice' — one of `options` (homework environment)
  kind        TEXT    NOT NULL CHECK (kind IN ('scale', 'choice')),
  -- The allowed answers for a 'choice' question, in order. NULL for 'scale'.
  options     JSONB,
  position    SMALLINT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (module, n),
  -- A choice question with no options cannot be answered, and a scale question
  -- with options would render two different inputs for one question.
  CONSTRAINT module_questions_options_match_kind CHECK (
    (kind = 'choice' AND options IS NOT NULL AND jsonb_array_length(options) > 1)
    OR (kind = 'scale' AND options IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS module_questions_order_idx
  ON module_questions (module, position);

CREATE TABLE IF NOT EXISTS module_answers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  module      TEXT NOT NULL,
  question_n  SMALLINT NOT NULL,
  -- Exactly one of these, matching the question's kind.
  value       SMALLINT CHECK (value BETWEEN 1 AND 5),
  choice      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One answer per question per sitting; re-answering updates in place.
  UNIQUE (session_id, module, question_n),
  CONSTRAINT module_answers_one_kind CHECK (
    (value IS NOT NULL AND choice IS NULL)
    OR (value IS NULL AND choice IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS module_answers_session_idx
  ON module_answers (session_id, module);

-- Which modules a sitting has finished, as opposed to which it has some
-- answers for. §23 turns on this distinction: a module that was offered and
-- skipped must produce no conclusion at all, and a module half-answered is not
-- a module completed. Without a record of completion, "no rows" would mean
-- both "skipped" and "answered nothing yet", which are the same to the report
-- but not to the UI, which has to know whether to offer it again on resume.
CREATE TABLE IF NOT EXISTS module_completions (
  session_id   UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  module       TEXT NOT NULL,
  -- false when the adult chose to skip rather than answer.
  completed    BOOLEAN NOT NULL,
  finished_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, module)
);
