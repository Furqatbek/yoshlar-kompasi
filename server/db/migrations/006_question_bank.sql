-- The question bank, editable.
--
-- The thread asks for an admin panel that can edit question text, disable a
-- question, add one and reorder them, with the approved 70 as the immutable
-- starting set. That means the bank has to live somewhere editable, so it moves
-- from a file into a table. server/data/questions.js stays as the seed and as
-- the thing unit/questions.test.js pins, so the shipped default is still fixed
-- in code and a drifting edit cannot be mistaken for the approved wording.

CREATE TABLE IF NOT EXISTS question_sections (
  key        TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  position   SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS questions (
  n           SMALLINT PRIMARY KEY,
  section_key TEXT NOT NULL REFERENCES question_sections(key),
  text        TEXT NOT NULL,
  position    SMALLINT NOT NULL,
  -- Disabling keeps the row and its history; the question simply stops being
  -- asked. Deleting would orphan every answer already given to it.
  active      BOOLEAN NOT NULL DEFAULT true,
  -- True for the original approved set. The panel warns before editing one,
  -- because changing a question changes what every past score means.
  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS questions_section_idx ON questions (section_key, position);

-- The interpretation bands, also editable ("natija chegaralarini sozlash").
CREATE TABLE IF NOT EXISTS score_bands (
  key        TEXT PRIMARY KEY,
  max_value  NUMERIC(3,2) NOT NULL,
  label      TEXT NOT NULL,
  position   SMALLINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
