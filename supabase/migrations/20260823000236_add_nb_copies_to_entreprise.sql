/*
# Add nb_copies column to entreprise table

## Overview
Adds a "nombre de copies" (number of copies) setting to the entreprise table.
This controls how many copies of a receipt are printed when the user clicks
"Imprimer" — e.g. one copy for the shop, one for the customer.

## Modified Tables

### `entreprise`
- `nb_copies` (integer, not null, default 1) — number of receipt copies to print

## Security
- No policy changes. Existing anon + authenticated CRUD policies already cover the new column.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entreprise' AND column_name = 'nb_copies'
  ) THEN
    ALTER TABLE entreprise ADD COLUMN nb_copies integer NOT NULL DEFAULT 1;
  END IF;
END $$;
