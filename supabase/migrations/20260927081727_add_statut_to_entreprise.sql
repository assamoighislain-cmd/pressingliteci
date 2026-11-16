/*
# Add statut column to entreprise table

1. Changes
- Add `statut` column to `entreprise` table with type text, default 'active'.
- Allowed values: 'active', 'demo', 'suspended'.
- 'active' = normal paying company (default for all existing rows).
- 'demo' = demo/trial company.
- 'suspended' = company access suspended.
2. Backfill
- All existing rows get 'active' as default.
3. Security
- No policy changes needed; existing super-admin update policy already covers the entreprise table.
*/

ALTER TABLE entreprise ADD COLUMN IF NOT EXISTS statut text NOT NULL DEFAULT 'active';

-- Add check constraint for allowed values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'entreprise_statut_check'
  ) THEN
    ALTER TABLE entreprise ADD CONSTRAINT entreprise_statut_check
      CHECK (statut IN ('active', 'demo', 'suspended'));
  END IF;
END $$;
