/*
# Add message_pied column to entreprise table

1. Changes
- Add `message_pied` (text, nullable) to the `entreprise` table.
- This column stores a custom footer message printed at the bottom of receipts.
- If null or empty, the default hardcoded message is used.

2. Security
- No RLS changes needed — existing policies on `entreprise` already cover CRUD.
*/

ALTER TABLE entreprise
ADD COLUMN IF NOT EXISTS message_pied text;
