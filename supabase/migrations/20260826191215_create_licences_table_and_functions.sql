/*
# Create licences table and generate_licence function

## Overview
Allows the super-admin to generate and manage annual exploitation licences for
each entreprise. A licence has a validity period (start/end dates), a status
(active, expired, revoked), and a unique licence key.

## New Tables
### `licences`
- `id` (uuid, primary key, auto-generated)
- `entreprise_id` (integer, NOT NULL, references entreprise(id) ON DELETE CASCADE)
- `cle_licence` (text, UNIQUE, NOT NULL) — unique licence key (auto-generated)
- `date_debut` (date, NOT NULL) — licence start date
- `date_fin` (date, NOT NULL) — licence end date
- `statut` (text, NOT NULL DEFAULT 'active', CHECK in active/expired/revoked)
- `created_by` (uuid, NOT NULL, default auth.uid()) — super-admin who created it
- `created_at` (timestamptz, default now())

## New Functions
### `generate_licence(entreprise_id, date_debut, date_fin)`
- SECURITY DEFINER — callable only by the super-admin
- Generates a unique licence key (format: PRS-YYYY-XXXXXXXX)
- Inserts a new licence row
- Returns the licence row

## Security
- Enable RLS on `licences`.
- Only the super-admin can view, create, and manage licences.
- SELECT/INSERT/UPDATE/DELETE scoped to the super-admin via the `is_super_admin()`
  helper function (created in a previous migration).
*/

CREATE TABLE IF NOT EXISTS licences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entreprise_id integer NOT NULL REFERENCES entreprise(id) ON DELETE CASCADE,
  cle_licence text UNIQUE NOT NULL,
  date_debut date NOT NULL,
  date_fin date NOT NULL,
  statut text NOT NULL DEFAULT 'active' CHECK (statut IN ('active', 'expired', 'revoked')),
  created_by uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE licences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_licences_super_admin" ON licences;
CREATE POLICY "select_licences_super_admin" ON licences FOR SELECT
  TO authenticated USING (is_super_admin());

DROP POLICY IF EXISTS "insert_licences_super_admin" ON licences;
CREATE POLICY "insert_licences_super_admin" ON licences FOR INSERT
  TO authenticated WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "update_licences_super_admin" ON licences;
CREATE POLICY "update_licences_super_admin" ON licences FOR UPDATE
  TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "delete_licences_super_admin" ON licences;
CREATE POLICY "delete_licences_super_admin" ON licences FOR DELETE
  TO authenticated USING (is_super_admin());

CREATE INDEX IF NOT EXISTS idx_licences_entreprise_id ON licences(entreprise_id);
CREATE INDEX IF NOT EXISTS idx_licences_statut ON licences(statut);

-- Function to generate a licence for an entreprise
CREATE OR REPLACE FUNCTION generate_licence(
  p_entreprise_id integer,
  p_date_debut date,
  p_date_fin date
)
RETURNS licences
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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

  -- Generate unique licence key: PRS-YYYY-XXXXXXXX (8 random alphanumeric chars)
  v_cle := 'PRS-' || EXTRACT(YEAR FROM p_date_debut)::text || '-' ||
    upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));

  INSERT INTO licences (entreprise_id, cle_licence, date_debut, date_fin, statut, created_by)
  VALUES (p_entreprise_id, v_cle, p_date_debut, p_date_fin, 'active', auth.uid())
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- Function to revoke a licence
CREATE OR REPLACE FUNCTION revoke_licence(p_licence_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Seul le super-administrateur peut révoquer des licences.';
  END IF;

  UPDATE licences SET statut = 'revoked' WHERE id = p_licence_id;
END;
$$;
