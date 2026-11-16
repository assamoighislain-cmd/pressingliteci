/*
# Add discount fields to clients

## Modified Tables

### `clients`
- `taux_remise` (numeric(5,2), default 0) — discount rate percentage (e.g. 10.00 = 10%)
- `condition_remise` (text) — condition describing when the discount applies

## Security
- No policy changes. Existing CRUD policies cover the new columns.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clients' AND column_name = 'taux_remise'
  ) THEN
    ALTER TABLE clients ADD COLUMN taux_remise numeric(5,2) DEFAULT 0;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clients' AND column_name = 'condition_remise'
  ) THEN
    ALTER TABLE clients ADD COLUMN condition_remise text;
  END IF;
END $$;
