/*
# Add observation column to depot_articles

## Overview
Adds an `observation` text column to `depot_articles` so each article line in a deposit
can carry an optional observation/note.

## Modified Tables

### `depot_articles`
- Added `observation` (text, nullable) — optional per-article observation.

## Important Notes
1. The column is nullable so existing rows and inserts that omit it are unaffected.
*/

ALTER TABLE depot_articles ADD COLUMN IF NOT EXISTS observation text;
