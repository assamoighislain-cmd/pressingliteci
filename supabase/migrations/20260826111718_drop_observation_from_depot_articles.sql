/*
# Remove observation column from depot_articles

1. Modified Tables
- `depot_articles`: drop the `observation` text column.
  The column is no longer used; couleur, signe_particulier, and griffe replace it.
2. Security
- No RLS policy changes.
*/

ALTER TABLE depot_articles DROP COLUMN IF EXISTS observation;
