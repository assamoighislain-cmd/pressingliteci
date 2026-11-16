/*
# Add per-article retrait tracking

## Overview
Currently, retrait is all-or-nothing at the depot level. This migration adds
a `date_retrait` column to `depot_articles` so individual articles can be
marked as withdrawn independently — partially or totally.

## Modified Tables
### `depot_articles`
- Added `date_retrait` (timestamptz, nullable) — when this article line was
  withdrawn. NULL means not yet withdrawn.

## Important Notes
1. The column is nullable so existing rows are unaffected.
2. The depot-level `statut` (EN_COURS / RETIRE) remains, but the app will now
   set it to RETIRE only when ALL articles have been withdrawn.
*/
ALTER TABLE depot_articles ADD COLUMN IF NOT EXISTS date_retrait timestamptz;
