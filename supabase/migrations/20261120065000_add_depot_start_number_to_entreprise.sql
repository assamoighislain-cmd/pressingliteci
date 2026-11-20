-- Add company-wide enforced starting deposit counter columns to entreprise
-- Allows setting/imposing a starting deposit number at software installation or in company settings,
-- shared across all devices and billing points for the configured year (resets automatically on Jan 1st).

ALTER TABLE public.entreprise
  ADD COLUMN IF NOT EXISTS depot_start_number integer,
  ADD COLUMN IF NOT EXISTS depot_start_year integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'entreprise_depot_start_number_check'
  ) THEN
    ALTER TABLE public.entreprise
      ADD CONSTRAINT entreprise_depot_start_number_check
      CHECK (depot_start_number IS NULL OR depot_start_number >= 1);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
