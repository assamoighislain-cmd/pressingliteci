/*
# Add prix column to licences table

1. Modified Tables
   - `licences`
     - `prix` (numeric, nullable) — price of the licence in FCFA

2. Modified Functions
   - `generate_licence` — now accepts an optional `p_prix` parameter (defaults to 100000 for annual licences)

3. Notes
   - Existing licences will have NULL prix (can be updated manually)
   - Demo licences default to 0, annual licences default to 100000
*/

-- Add prix column
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'licences' AND column_name = 'prix'
  ) THEN
    ALTER TABLE licences ADD COLUMN prix numeric;
  END IF;
END $$;

-- Update generate_licence to accept prix
CREATE OR REPLACE FUNCTION public.generate_licence(
  p_entreprise_id integer,
  p_date_debut date,
  p_date_fin date,
  p_prix numeric DEFAULT 100000
)
RETURNS licences
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_cle text;
  v_result licences;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Seul le super-administrateur peut générer des licences.';
  END IF;

  IF p_date_fin <= p_date_debut THEN
    RAISE EXCEPTION 'La date de fin doit être postérieure à la date de début.';
  END IF;

  v_cle := 'PRS-' || EXTRACT(YEAR FROM p_date_debut)::text || '-' ||
    upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));

  INSERT INTO licences (entreprise_id, cle_licence, date_debut, date_fin, statut, created_by, prix)
  VALUES (p_entreprise_id, v_cle, p_date_debut, p_date_fin, 'active', auth.uid(), p_prix)
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$function$;
