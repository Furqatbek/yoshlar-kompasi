-- The 70-question interest inventory.
--
-- The assessment changed from an adaptive conversation of performance tasks to
-- a fixed self-report inventory, so what a session produces changed with it:
-- not three class-group levels but twelve interest means, each computed from
-- the items that were actually answered.
--
-- Forward-only, like every migration here. The old level_* columns stay: they
-- hold real results for every report produced before this, and dropping them
-- would rewrite history rather than move it on. Nothing writes them any more.

-- One row per question the child was actually taken through. A skipped question
-- is a row with a NULL value: recorded as addressed, so the sitting can finish,
-- but excluded from every average. It must never read as a zero, which would
-- drag the mean down and turn "did not want to answer" into "not interested".
CREATE TABLE IF NOT EXISTS answers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  question_n   SMALLINT NOT NULL CHECK (question_n BETWEEN 1 AND 70),
  value        SMALLINT CHECK (value IS NULL OR value BETWEEN 1 AND 5),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A child answers each question once; a correction overwrites rather than
-- appends, so a re-read of question 12 cannot count twice in its average.
CREATE UNIQUE INDEX IF NOT EXISTS answers_session_question_uq
  ON answers (session_id, question_n);

CREATE INDEX IF NOT EXISTS answers_session_idx ON answers (session_id);

-- The scored result. categories is the twelve-area object the report JSON
-- describes: { "<section_key>": { answered, average, interest } }.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS categories        JSONB;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS top_interests     JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS developing_areas  JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS clubs             JSONB NOT NULL DEFAULT '[]'::jsonb;
-- 'complete' | 'partial'. A report built on half the questions has to say so.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS data_completeness TEXT;

-- How far through the 70 a session is, for the "18 / 70" readout and for
-- resuming on another device. Kept on the session so the progress line does not
-- cost a count(*) over answers on every poll.
--   answered_count — questions with a 1-5 value, the number shown to the adult
--   seen_count     — questions addressed at all, including skips, so a sitting
--                    where the child skipped fourteen can still reach the end
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS answered_count SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS seen_count     SMALLINT NOT NULL DEFAULT 0;

-- Who ran the sitting. The thread asks for it on the pre-test form, and it is
-- the one field that tells a parent's sitting from a teacher's — which is what
-- the teacher pricing question needs an answer to before it can be settled.
ALTER TABLE children ADD COLUMN IF NOT EXISTS administered_by TEXT
  CHECK (administered_by IS NULL OR administered_by IN ('parent', 'teacher'));
