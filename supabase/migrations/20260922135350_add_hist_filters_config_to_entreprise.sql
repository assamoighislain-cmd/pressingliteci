/*
# Add history filter visibility config to entreprise

1. Modified Tables
   - `entreprise`
     - `hist_filters_commercial` (text[], default '{today}') — period filters visible to commercial role in Historique
     - `hist_filters_gerant` (text[], default '{today}') — period filters visible to gérant role in Historique

2. Notes
   - Valid values: 'today', 'week', 'month', 'all', 'custom'
   - Defaults to only 'today' for both roles (admin always sees all filters)
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'entreprise' AND column_name = 'hist_filters_commercial'
  ) THEN
    ALTER TABLE public.entreprise ADD COLUMN hist_filters_commercial text[] NOT NULL DEFAULT '{today}';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'entreprise' AND column_name = 'hist_filters_gerant'
  ) THEN
    ALTER TABLE public.entreprise ADD COLUMN hist_filters_gerant text[] NOT NULL DEFAULT '{today}';
  END IF;
END $$;