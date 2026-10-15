-- The report's own text, editable.
--
-- "Hisobot matnlarini tahrirlash" in the thread's admin list. The report is
-- written by the model, so what is editable is not the prose but the brief: the
-- heading of each section and the one-line instruction that tells the model
-- what belongs in it. Changing those changes every future report, so the same
-- rule as the question bank applies — a write bumps the prompt version.
--
-- `free` mirrors the paywall so the two cannot drift: the summary and the
-- child's encouragement are free, everything a parent would act on is bought.

CREATE TABLE IF NOT EXISTS report_sections (
  key         TEXT PRIMARY KEY,
  heading     TEXT NOT NULL,
  instruction TEXT NOT NULL,
  position    SMALLINT NOT NULL,
  free        BOOLEAN NOT NULL DEFAULT false,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
