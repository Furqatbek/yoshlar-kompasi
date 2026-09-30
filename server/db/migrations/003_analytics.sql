-- 003_analytics.sql
-- Funnel analytics: where do visitors leave before they enrol?
--
-- The tables so far only know about people who got far enough to create a
-- session. Everyone who opened the site, read the landing page and closed the
-- tab — or started the Telegram login and never finished it — was invisible.
-- That is exactly the part of the funnel with the biggest losses, so it needs
-- its own record.
--
-- Deliberately anonymous. A visitor_id is a random UUID the browser makes up
-- for itself and keeps in localStorage: it is not derived from an IP, a
-- fingerprint or anything the person typed, it never leaves this origin, and
-- it identifies a browser rather than a human. No IP address, user agent or
-- child data is stored here. Once an adult logs in, parent_id links their
-- earlier anonymous steps to the lead — which is the whole point, since
-- "leaving without enrolling" can only be measured by connecting the two.

CREATE TABLE IF NOT EXISTS analytics_events (
  id         BIGSERIAL PRIMARY KEY,
  -- Random, browser-generated. Counting DISTINCT visitor_id per stage makes
  -- the funnel immune to reloads, so no client-side de-duplication has to be
  -- correct for the numbers to be right.
  visitor_id UUID NOT NULL,
  -- One of the funnel stages in services/funnel.js. Kept as TEXT rather than
  -- an enum so adding a stage is a code change, not a migration.
  stage      TEXT NOT NULL,
  -- Known from the login onwards. ON DELETE CASCADE keeps the right-to-erasure
  -- promise literally true: deleting a lead removes their analytics trail too.
  parent_id  UUID REFERENCES parents (id) ON DELETE CASCADE,
  -- ON DELETE SET NULL, not CASCADE: when the retention job removes an old
  -- session the funnel history it produced should survive as a count.
  session_id UUID REFERENCES sessions (id) ON DELETE SET NULL,
  -- utm_source, else the referring host, else 'direct'. Recorded so the centre
  -- can later ask which channel the drop-offs come from.
  source     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The funnel query groups by stage over a date window and counts distinct
-- visitors; this index serves it directly.
CREATE INDEX IF NOT EXISTS idx_analytics_stage_created ON analytics_events (stage, created_at);
-- Retention pruning and "events for this visitor" lookups.
CREATE INDEX IF NOT EXISTS idx_analytics_created_at ON analytics_events (created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_visitor_id ON analytics_events (visitor_id);
-- Conversion join (events -> parents.lead_status). Partial: most rows are
-- anonymous and would only bloat the index.
CREATE INDEX IF NOT EXISTS idx_analytics_parent_id ON analytics_events (parent_id)
  WHERE parent_id IS NOT NULL;
