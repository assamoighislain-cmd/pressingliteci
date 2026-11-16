-- Auto-create a 30-day trial licence when a new entreprise is created at signup.
-- Also add a function to backfill trial licences for existing entreprises without one.

-- ─── 1. Update the signup trigger to create a trial licence ────────────────

CREATE OR REPLACE FUNCTION public.handle_new_entreprise_signup()
RETURNS trigger AS $$
DECLARE
  ent_nom text;
  fname text;
  phone text;
  v_entreprise_id integer;
  v_cle text;
BEGIN
  ent_nom := NEW.raw_user_meta_data->>'entreprise_nom';
  fname := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'nom_prenoms');
  phone := NEW.raw_user_meta_data->>'contact';

  IF ent_nom IS NOT NULL AND ent_nom <> '' THEN
    -- Create entreprise if it doesn't exist
    INSERT INTO public.entreprise (user_id, nom)
    VALUES (NEW.id, ent_nom)
    ON CONFLICT (user_id) DO UPDATE SET nom = EXCLUDED.nom
    RETURNING id INTO v_entreprise_id;

    -- Add user as admin member
    INSERT INTO public.entreprise_members (tenant_id, user_id, role, full_name, contact)
    VALUES (NEW.id, NEW.id, 'admin', fname, phone)
    ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'admin', full_name = EXCLUDED.full_name, contact = EXCLUDED.contact;

    -- Create a 30-day trial licence if the entreprise doesn't already have one
    IF NOT EXISTS (SELECT 1 FROM public.licences WHERE entreprise_id = v_entreprise_id) THEN
      v_cle := 'PRS-' || EXTRACT(YEAR FROM CURRENT_DATE)::text || '-' ||
        upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
      INSERT INTO public.licences (entreprise_id, cle_licence, date_debut, date_fin, statut, created_by)
      VALUES (v_entreprise_id, v_cle, CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 'active', NEW.id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 2. Function to backfill trial licences for existing entreprises ────────
-- Callable by any authenticated user; creates a trial licence for their own
-- entreprise if none exists. Safe to call repeatedly (no-op if a licence exists).

CREATE OR REPLACE FUNCTION public.ensure_trial_licence()
RETURNS licences
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_entreprise_id integer;
  v_cle text;
  v_result licences;
BEGIN
  -- Find the caller's entreprise
  SELECT e.id INTO v_entreprise_id
  FROM public.entreprise e
  WHERE e.user_id = auth.uid()
  LIMIT 1;

  IF v_entreprise_id IS NULL THEN
    RAISE EXCEPTION 'Aucune entreprise trouvée pour cet utilisateur.';
  END IF;

  -- If they already have a licence, return it
  SELECT * INTO v_result FROM public.licences WHERE entreprise_id = v_entreprise_id ORDER BY created_at DESC LIMIT 1;
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;

  -- Create a 30-day trial licence
  v_cle := 'PRS-' || EXTRACT(YEAR FROM CURRENT_DATE)::text || '-' ||
    upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
  INSERT INTO public.licences (entreprise_id, cle_licence, date_debut, date_fin, statut, created_by)
  VALUES (v_entreprise_id, v_cle, CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 'active', auth.uid())
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_trial_licence() TO authenticated;

-- ─── 3. Allow entreprise admins to view their own licences ─────────────────

DROP POLICY IF EXISTS "select_own_licences" ON licences;
CREATE POLICY "select_own_licences" ON licences FOR SELECT
  TO authenticated USING (
    entreprise_id IN (SELECT id FROM entreprise WHERE user_id = auth.uid())
  );
