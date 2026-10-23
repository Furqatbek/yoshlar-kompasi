-- The two catalogues: §17's hundred-book reading programme and §16's tutors.
--
-- Both exist under the same rule, and it is the reason these are tables rather
-- than prompt text:
--
--   §17  "Kitoblarning aniq ro‘yxati foydalanuvchi taqdim etgan yoki
--         tasdiqlangan manbadan olinishi kerak ... kitob nomlari va
--         mualliflarini uydirmang."
--   §16  "Platformada haqiqiy o‘qituvchilar katalogi mavjud bo‘lmasa, aniq
--         ism, narx, malaka, sharh yoki bo‘sh vaqtlarni to‘qib chiqarmang."
--
-- A model asked to recommend a book for an eight-year-old will produce a
-- plausible Uzbek title and a plausible author, and a parent will go looking
-- for a book that does not exist. The defence is that the model is only ever
-- shown rows from here, and these rows come from a source somebody named.
--
-- Both tables ship EMPTY. That is a correct, working state: §23 has the report
-- say the list has not been supplied yet, which is true and useful, rather than
-- filling the gap. Nothing in this migration seeds a title.

CREATE TABLE IF NOT EXISTS books (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- §17's fields. Nullable on purpose: "Agar manbada biror ma'lumot bo'lmasa,
  -- uni taxmin qilib kiritmang" — a missing field stays missing rather than
  -- being guessed at import time.
  title          TEXT NOT NULL,
  author         TEXT,
  age_min        SMALLINT CHECK (age_min BETWEEN 3 AND 18),
  age_max        SMALLINT CHECK (age_max BETWEEN 3 AND 18),
  genre          TEXT,
  reading_level  TEXT,
  language       TEXT,
  list_position  INTEGER,
  -- Where this row came from: a publisher's catalogue, a ministry list, the
  -- centre's own shelf. Free text because the answer is a sentence, not an
  -- enum, and because "who said so" is the whole point.
  source         TEXT NOT NULL,
  -- Only approved rows are ever shown to the model. An import lands unapproved
  -- so that a bulk paste cannot put an unchecked title in front of a parent.
  approved       BOOLEAN NOT NULL DEFAULT false,
  active         BOOLEAN NOT NULL DEFAULT true,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT books_age_range CHECK (age_min IS NULL OR age_max IS NULL OR age_min <= age_max),
  -- The same book twice under two spellings is how a hundred-book list becomes
  -- a hundred-and-six.
  CONSTRAINT books_title_author_unique UNIQUE (title, author)
);

CREATE INDEX IF NOT EXISTS books_shown_idx
  ON books (approved, active, list_position);

CREATE TABLE IF NOT EXISTS tutors (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- §16's six service lines: english, mathematics, reading_literacy,
  -- public_speaking, reading_discussion, it_programming. Text rather than an
  -- enum so the centre can add one without a migration.
  subject        TEXT NOT NULL,
  -- A real person or a service line. §16 allows recommending "qaysi turdagi
  -- mutaxassis" without naming anybody, which is the state the platform is in
  -- until a real catalogue exists — so the name is optional and the subject
  -- is not.
  name           TEXT,
  age_range      TEXT,
  method         TEXT,
  goal           TEXT,
  source         TEXT NOT NULL,
  approved       BOOLEAN NOT NULL DEFAULT false,
  active         BOOLEAN NOT NULL DEFAULT true,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tutors_shown_idx
  ON tutors (approved, active, subject);

-- Deliberately absent: price, availability and reviews.
--
-- §16 forbids inventing them, and the surest way to keep a fabricated price
-- out of a report is to have nowhere to put one. When the centre has real
-- pricing it gets a migration and a decision about how it reaches a parent;
-- until then a column standing empty is an invitation.
COMMENT ON TABLE tutors IS
  'Approved tutor/service lines for §16. No price, availability or review '
  'columns by design — the instructions forbid inventing them and an empty '
  'column is an invitation. Only approved AND active rows reach the model.';

COMMENT ON TABLE books IS
  'The §17 reading programme. Ships empty; an empty catalogue makes the report '
  'say the list has not been supplied, which is true. Only approved AND active '
  'rows reach the model, and `source` records who vouched for the row.';
