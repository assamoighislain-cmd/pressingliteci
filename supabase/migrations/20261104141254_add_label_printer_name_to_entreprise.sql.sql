/*
# Add label_printer_name column to entreprise

1. Changes
- Add `label_printer_name` text column to `entreprise` table, nullable.
- Allows storing a default printer name for label printing (browser print dialog).
2. Security
- No RLS changes. Existing policies on `entreprise` remain unchanged.
*/

ALTER TABLE entreprise ADD COLUMN IF NOT EXISTS label_printer_name text;
