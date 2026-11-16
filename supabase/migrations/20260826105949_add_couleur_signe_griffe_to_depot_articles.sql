/*
# Replace observation with couleur, signe_particulier, griffe on depot_articles

1. Modified Tables
- `depot_articles`: add three new nullable text columns
  - `couleur` — color of the article
  - `signe_particulier` — distinguishing mark
  - `griffe` — signature/brand mark
- The existing `observation` column is kept for backward compatibility (no data loss).
2. Security
- No RLS policy changes. The table already has RLS enabled with anon+authenticated CRUD policies.
*/

ALTER TABLE depot_articles
  ADD COLUMN IF NOT EXISTS couleur text,
  ADD COLUMN IF NOT EXISTS signe_particulier text,
  ADD COLUMN IF NOT EXISTS griffe text;
