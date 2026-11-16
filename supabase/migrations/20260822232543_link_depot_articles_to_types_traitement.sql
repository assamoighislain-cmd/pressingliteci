/*
# Link depot_articles.traitement to types_traitement.code

## Overview
Adds a foreign key constraint on `depot_articles.traitement` referencing
`types_traitement(code)`, so each article line's treatment type is validated
against the treatment types catalog.

## Modified Tables
### `depot_articles`
- Added FK: `traitement` → `types_traitement(code)` (ON UPDATE CASCADE, ON DELETE RESTRICT)

## Important Notes
1. `types_traitement.code` is already UNIQUE NOT NULL, so it can serve as a FK target.
2. ON UPDATE CASCADE keeps depot_articles in sync if a treatment code is ever renamed.
3. ON DELETE RESTRICT prevents deleting a treatment type that's still referenced.
4. Existing data is validated before adding the constraint — any orphan rows would
   need to be fixed first, but since the app only ever writes codes from the catalog,
   there should be none.
*/

-- Add foreign key from depot_articles.traitement → types_traitement.code
ALTER TABLE depot_articles
  DROP CONSTRAINT IF EXISTS depot_articles_traitement_fkey;

ALTER TABLE depot_articles
  ADD CONSTRAINT depot_articles_traitement_fkey
  FOREIGN KEY (traitement)
  REFERENCES types_traitement(code)
  ON UPDATE CASCADE
  ON DELETE RESTRICT;

-- Index for faster joins on the FK column
CREATE INDEX IF NOT EXISTS idx_depot_articles_traitement ON depot_articles(traitement);
