/*
# Add licence type and auto-trial on admin-created entreprises

## Overview
1. Adds a `type_licence` column to `licences` to distinguish trial ('demo') from annual ('annuelle') licences.
2. Updates `create_entreprise_admin()` so that when the super-admin creates a new entreprise, a 30-day trial licence is automatically created.
3. Adds a `get_licence_status()` function that returns the active licence info for the caller's entreprise.
4. Backfills existing licences to 'annuelle' type.

## New Columns
- `licences.type_licence` (text, NOT NULL DEFAULT 'annuelle', CHECK in 'demo' | 'annuelle')

## Modified Functions
- `create_entreprise_admin()` — now auto-creates a 30-day trial licence for the new entreprise.
*/

-- 1. Add type_licence column
ALTER TABLE licences ADD COLUMN IF NOT EXISTS type_licence text NOT NULL DEFAULT 'annuelle' CHECK (type_licence IN ('demo', 'annuelle'));

-- Backfill existing licences
UPDATE licences SET type_licence = 'annuelle' WHERE type_licence IS NULL OR type_licence = 'annuelle';

-- 2. Update create_entreprise_admin to auto-create trial licence
CREATE OR REPLACE FUNCTION public.create_entreprise_admin(
  admin_email text,
  entreprise_nom text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  admin_uid uuid;
  ent_id integer;
  v_cle text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Seul le super-administrateur peut créer des administrateurs d''entreprise';
  END IF;

  SELECT id INTO admin_uid FROM auth.users WHERE email = admin_email;
  IF admin_uid IS NULL THEN
    RAISE EXCEPTION 'Utilisateur introuvable. La personne doit d''abord créer un compte avec cet email.';
  END IF;

  INSERT INTO entreprise (user_id, nom)
  VALUES (admin_uid, entreprise_nom)
  RETURNING id INTO ent_id;

  INSERT INTO entreprise_members (tenant_id, user_id, role)
  VALUES (admin_uid, admin_uid, 'admin')
  ON CONFLICT (tenant_id, user_id) DO NOTHING;

  -- Create 30-day trial licence if none exists
  IF NOT EXISTS (SELECT 1 FROM licences WHERE entreprise_id = ent_id) THEN
    v_cle := 'PRS-' || EXTRACT(YEAR FROM CURRENT_DATE)::text || '-' ||
      upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
    INSERT INTO licences (entreprise_id, cle_licence, date_debut, date_fin, statut, type_licence, created_by)
    VALUES (ent_id, v_cle, CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 'active', 'demo', uid);
  END IF;

  RETURN admin_uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_entreprise_admin(text, text) TO authenticated;

-- 3. Function to check current licence status for the caller's entreprise
CREATE OR REPLACE FUNCTION public.get_licence_status()
RETURNS TABLE (
  id uuid,
  entreprise_id integer,
  cle_licence text,
  date_debut date,
  date_fin date,
  statut text,
  type_licence text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entreprise_id integer;
BEGIN
  SELECT e.id INTO v_entreprise_id
  FROM entreprise e
  WHERE e.user_id = auth.uid()
  LIMIT 1;

  IF v_entreprise_id IS NULL THEN
    -- Check if member of an entreprise
    SELECT em.tenant_id INTO v_entreprise_id
    FROM entreprise_members em
    WHERE em.user_id = auth.uid()
    LIMIT 1;

    -- If still NULL, try matching entreprise by user_id = tenant_id pattern
    IF v_entreprise_id IS NULL THEN
      RETURN;
    END IF;

    SELECT e.id INTO v_entreprise_id
    FROM entreprise e
    WHERE e.user_id = v_entreprise_id
    LIMIT 1;

    IF v_entreprise_id IS NULL THEN
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
  SELECT l.id, l.entreprise_id, l.cle_licence, l.date_debut, l.date_fin, l.statut, l.type_licence, l.created_at
  FROM licences l
  WHERE l.entreprise_id = v_entreprise_id
    AND l.statut = 'active'
    AND l.date_fin >= CURRENT_DATE
  ORDER BY l.created_at DESC
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_licence_status() TO authenticated;

-- 4. Ensure entreprise admins can read their own licences
DROP POLICY IF EXISTS "select_own_licences" ON licences;
CREATE POLICY "select_own_licences" ON licences FOR SELECT
  TO authenticated USING (
    is_super_admin() OR entreprise_id IN (SELECT id FROM entreprise WHERE user_id = auth.uid())
  );

-- 5. Auto-expire licences past their end date
CREATE OR REPLACE FUNCTION public.expire_licences()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE licences SET statut = 'expired'
  WHERE statut = 'active' AND date_fin < CURRENT_DATE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.expire_licences() TO authenticated;