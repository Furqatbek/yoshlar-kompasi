-- The report goes from seven sections to thirteen.
--
-- §20 of the consolidated instructions adds the child's own details, subject
-- recommendations, reading, three parent steps, a teacher activity and tutor
-- help. Seven sections already existed and keep their keys; `clubs` becomes
-- `sports_clubs` because it now carries sport as well (§14).
--
-- Two things have to happen here rather than in the seeder, which inserts with
-- ON CONFLICT (key) DO NOTHING and so cannot move or rename anything:
--
--   1. The retained rows need their new positions. Without this a deployment
--      that already seeded seven sections would order the thirteen by the old
--      numbers and the report would come out shuffled.
--   2. `clubs` needs renaming, or the seeder inserts `sports_clubs` beside it
--      and the model is asked for both — the same recommendations twice, under
--      two headings, one of which no longer mentions sport.
--
-- Headings and instructions are otherwise left alone. They are admin-editable
-- (report_sections is "Hisobot matnlarini tahrirlash"), so overwriting them
-- would throw away somebody's wording to impose ours. The one exception is the
-- renamed section's heading, and only while it still reads exactly as shipped:
-- a heading about to‘garaklar alone is now wrong about its own contents.

-- 1. Reposition the seven that stay. Named one by one rather than driven from a
--    list, so this file says plainly what the order becomes.
UPDATE report_sections SET position =  2, updated_at = now() WHERE key = 'summary';
UPDATE report_sections SET position =  3, updated_at = now() WHERE key = 'areas';
UPDATE report_sections SET position =  4, updated_at = now() WHERE key = 'map';
UPDATE report_sections SET position =  5, updated_at = now() WHERE key = 'developing';
UPDATE report_sections SET position = 12, updated_at = now() WHERE key = 'encouragement';
UPDATE report_sections SET position = 13, updated_at = now() WHERE key = 'adults';

-- 2. clubs -> sports_clubs. Guarded so re-running, or running against a
--    database that never had the old key, does nothing.
UPDATE report_sections
   SET key = 'sports_clubs', position = 7, updated_at = now()
 WHERE key = 'clubs'
   AND NOT EXISTS (SELECT 1 FROM report_sections s WHERE s.key = 'sports_clubs');

UPDATE report_sections
   SET heading = 'Sport va to‘garaklar', updated_at = now()
 WHERE key = 'sports_clubs'
   AND heading = 'To‘garak va mashg‘ulot tavsiyalari';

-- The six new sections (child, subjects, reading, parent_steps, teacher,
-- support) are inserted by db/seed-questions.js from data/reportTemplate.js on
-- the next boot, which runs straight after migrate in the container's command.

-- ---------------------------------------------------------------------------
-- Where the v2.0 JSON block goes.
--
-- §24 adds twelve top-level keys to the model's structured output
-- (parent_recommendations, academic_development, reading_program and the rest)
-- and three fields to every category. One JSONB column rather than twelve:
-- these blocks are read whole when a report is rendered and never queried by
-- field, so columns would buy nothing and cost a migration every time §24
-- gains a key.
--
-- The scored columns stay exactly as they are. categories, top_interests and
-- developing_areas are written by services/scoring.js from the answers table,
-- not by the model, and that is deliberate: a language model averaging seventy
-- items across twelve buckets is not something a paid report should rest on.
-- This column holds what the model is actually for — the prose.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS payload JSONB;

COMMENT ON COLUMN reports.payload IS
  'The model''s v2.0 JSON block: recommendations, modules and limitations. '
  'Scores are NOT read from here — services/scoring.js computes them from the '
  'answers table and scoring.compare() checks the model against it.';
