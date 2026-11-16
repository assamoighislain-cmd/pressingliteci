/*
# Add nb_pieces to articles catalog

## Overview
Adds a `nb_pieces` (nombre de pièces) column to the `articles` table so each catalog
article can carry a default number of pieces. When an article is selected from the
catalog in the depot form, this value pre-fills the number of pieces for that line.

## Modified Tables

### `articles`
- Added `nb_pieces` (integer, not null, default 1) — default number of pieces for this article.

## Important Notes
1. Existing rows get `nb_pieces = 1` via the column default.
2. The column is NOT NULL with a default of 1 so inserts that omit it still work.
*/

ALTER TABLE articles ADD COLUMN IF NOT EXISTS nb_pieces integer NOT NULL DEFAULT 1;
