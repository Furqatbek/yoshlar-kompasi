-- §19, the reading diary. One row per book per child, kept over months.
--
-- Two sentences in §19 decide this schema:
--
--   "Bola o‘qimagan kitobni tugatilgan deb belgilamang."
--   "Ma'lumotlar berilmagan bo‘lsa, ularni o‘zingiz to‘ldirmang."
--
-- Both are rules about not asserting things nobody said, which is the same
-- rule the catalogues are built on, applied to the child's own record. They
-- are enforced here rather than in a handler because a handler is one early
-- return away from being skipped, and because what this table claims about a
-- child gets read back to them: a diary that says they finished a book they
-- put down is the product telling a child something untrue about themselves.
--
-- So: every reflective field is nullable and has no default. "Finished" is a
-- state that requires a date somebody entered, and it cannot be reached by
-- omission — the default is 'reading', which is what starting a book means.

CREATE TABLE IF NOT EXISTS reading_diary (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The child, not the sitting. A diary outlives the assessment that
  -- introduced it; deleting the child deletes it, which is what the retention
  -- and right-to-erasure paths already expect.
  child_id      UUID NOT NULL REFERENCES children (id) ON DELETE CASCADE,
  -- Optionally one of the approved catalogue books. Optional on purpose: a
  -- child reads what they find, and §17's "do not invent" governs what we
  -- RECOMMEND, not what we record them having read.
  book_id       UUID REFERENCES books (id) ON DELETE SET NULL,

  -- §19's fields, in its order.
  title               TEXT NOT NULL,
  author              TEXT,
  started_on          DATE,
  finished_on         DATE,
  status              TEXT NOT NULL DEFAULT 'reading'
                        CHECK (status IN ('reading', 'finished')),
  favourite_moment    TEXT,   -- eng qiziq voqea
  favourite_character TEXT,   -- sevimli qahramon
  unclear_part        TEXT,   -- tushunmagan yoki savol tug‘dirgan joy
  opinion             TEXT,   -- bolaning shaxsiy fikri
  discussed           TEXT,   -- kattalar bilan muhokama qilingan savollar
  next_choice         TEXT,   -- keyingi kitob uchun bolaning tanlovi

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- "Do not mark a book finished that was not read", as far as a database can
  -- check it: finished means somebody entered the day it was finished, and a
  -- finish date without the finished state is a half-made edit rather than a
  -- fact. Neither can happen by leaving a field out.
  CONSTRAINT diary_finished_needs_a_date CHECK (
    (status = 'finished' AND finished_on IS NOT NULL)
    OR (status = 'reading' AND finished_on IS NULL)
  ),
  -- A book finished before it was started is a typo, and it would be read back
  -- to a parent as fact.
  CONSTRAINT diary_dates_in_order CHECK (
    started_on IS NULL OR finished_on IS NULL OR finished_on >= started_on
  )
);

CREATE INDEX IF NOT EXISTS reading_diary_child_idx
  ON reading_diary (child_id, created_at DESC);

-- The same book twice for one child is a duplicate, not a re-read worth two
-- rows; re-reading updates the row it already has.
CREATE UNIQUE INDEX IF NOT EXISTS reading_diary_child_title_idx
  ON reading_diary (child_id, lower(title));

COMMENT ON TABLE reading_diary IS
  '§19 reading diary, one row per book per child. Every reflective column is '
  'nullable with no default: a blank is "the child did not say", and filling '
  'it in would be the product inventing an opinion for a child.';
