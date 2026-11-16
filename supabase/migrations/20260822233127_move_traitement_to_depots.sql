/*
# Move traitement from depot_articles to depots

## Overview
The treatment type (NORMAL / EXPRESS / EXPRESS_LENDemain) applies to the whole
deposit, not to individual article lines. This migration:
1. Adds `traitement` + `coefficient` columns to `depots`.
2. Backfills them from the first article of each deposit.
3. Adds a FK from `depots.traitement` → `types_traitement(code)`.
4. Removes the `traitement` and `coefficient` columns from `depot_articles`
   (and drops the old FK that was on depot_articles.traitement).

## Modified Tables
### `depots`
- Added `traitement` (text, NOT NULL) — treatment code
- Added `coefficient` (numeric(4,2), NOT NULL) — coefficient snapshot at deposit time
- Added FK: `traitement` → `types_traitement(code)` ON UPDATE CASCADE ON DELETE RESTRICT

### `depot_articles`
- Removed `traitement` column
- Removed `coefficient` column
- Dropped constraint `depot_articles_traitement_fkey`

## Important Notes
1. Backfill uses the first article's traitement/coefficient per deposit.
2. The FK on depots.traitement ensures data integrity going forward.
*/

-- Step 1: Add columns to depots
ALTER TABLE depots ADD COLUMN IF NOT EXISTS traitement text;
ALTER TABLE depots ADD COLUMN IF NOT EXISTS coefficient numeric(4,2);

-- Step 2: Backfill from first article of each deposit
UPDATE depots d
SET
  traitement = sub.traitement,
  coefficient = sub.coefficient
FROM (
  SELECT
    da.depot_id,
    da.traitement,
    da.coefficient,
    ROW_NUMBER() OVER (PARTITION BY da.depot_id ORDER BY da.created_at) AS rn
  FROM depot_articles da
) sub
WHERE d.id = sub.depot_id AND sub.rn = 1;

-- Step 3: Set NOT NULL (after backfill)
ALTER TABLE depots ALTER COLUMN traitement SET NOT NULL;
ALTER TABLE depots ALTER COLUMN coefficient SET NOT NULL;

-- Step 4: Add FK on depots.traitement → types_traitement(code)
ALTER TABLE depots
  DROP CONSTRAINT IF EXISTS depots_traitement_fkey;

ALTER TABLE depots
  ADD CONSTRAINT depots_traitement_fkey
  FOREIGN KEY (traitement)
  REFERENCES types_traitement(code)
  ON UPDATE CASCADE
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_depots_traitement ON depots(traitement);

-- Step 5: Drop old FK and columns from depot_articles
ALTER TABLE depot_articles DROP CONSTRAINT IF EXISTS depot_articles_traitement_fkey;
ALTER TABLE depot_articles DROP COLUMN IF EXISTS traitement;
ALTER TABLE depot_articles DROP COLUMN IF EXISTS coefficient;
