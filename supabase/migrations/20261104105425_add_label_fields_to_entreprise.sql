/*
# Add label_fields configuration column to entreprise table

1. Modified Tables
- `entreprise`
  - Added `label_fields` column (text[], nullable, defaults to all fields enabled)
  - Stores which fields appear on printed per-piece labels
  - Possible values: 'date_depot', 'numero', 'client_nom', 'date_retrait', 'piece_number', 'designation'
2. Security
- No new tables or policies. Existing RLS on entreprise remains unchanged.
- The column is user-editable through the existing entreprise upsert flow.
*/

ALTER TABLE entreprise
  ADD COLUMN IF NOT EXISTS label_fields text[] DEFAULT ARRAY['date_depot', 'numero', 'client_nom', 'date_retrait', 'piece_number', 'designation'];
