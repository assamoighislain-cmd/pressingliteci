/*
# Add phone prefix to entreprise settings

1. New Columns
- `entreprise.phone_prefix` (text, nullable, default '+225') — default international phone prefix for client phone numbers, based on the country the business operates in.

2. Modified Tables
- `entreprise` — add `phone_prefix` column.

3. Security
- No new tables. Existing RLS policies on `entreprise` cover the new column automatically.

4. Notes
- The prefix is used by the frontend to automatically prepend the country code when a client phone number is entered without an international prefix.
- Example: if phone_prefix is '+225' and the user enters '77 123 45 67', the stored number becomes '+225 77 123 45 67'.
- Numbers already starting with '+' are left unchanged.
*/

ALTER TABLE entreprise ADD COLUMN IF NOT EXISTS phone_prefix text DEFAULT '+225';
