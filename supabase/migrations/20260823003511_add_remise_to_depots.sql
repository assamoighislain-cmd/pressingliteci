/*
# Add remise fields to depots

## Modified Tables

### `depots`
- `taux_remise` (numeric(5,2), default 0) — discount rate applied
- `montant_remise` (numeric(12,2), default 0) — discount amount in FCFA
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'depots' AND column_name = 'taux_remise'
  ) THEN
    ALTER TABLE depots ADD COLUMN taux_remise numeric(5,2) DEFAULT 0;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'depots' AND column_name = 'montant_remise'
  ) THEN
    ALTER TABLE depots ADD COLUMN montant_remise numeric(12,2) DEFAULT 0;
  END IF;
END $$;
