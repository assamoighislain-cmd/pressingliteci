/*
# Add label printer configuration columns to entreprise table

1. Modified Tables
- `entreprise`
  - Added `label_printer_type` column (text, nullable, defaults to 'browser')
    - Values: 'browser' (standard print dialog) or 'serial' (direct serial port printing)
  - Added `label_printer_config` column (jsonb, nullable, defaults to empty object)
    - Stores serial connection settings: { baudRate, charWidth }
2. Security
- No new tables or policies. Existing RLS on entreprise remains unchanged.
- Both columns are user-editable through the existing entreprise upsert flow.
*/

ALTER TABLE entreprise
  ADD COLUMN IF NOT EXISTS label_printer_type text DEFAULT 'browser',
  ADD COLUMN IF NOT EXISTS label_printer_config jsonb DEFAULT '{}'::jsonb;
