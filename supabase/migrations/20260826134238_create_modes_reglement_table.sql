/*
# Create modes_reglement table

1. New Tables
  - `modes_reglement`
    - `id` (serial, primary key)
    - `code` (text, unique, not null) - internal identifier
    - `label` (text, not null) - display name
    - `description` (text) - optional description
    - `actif` (boolean, default true) - whether the mode is active
    - `ordre` (integer, default 0) - display order
    - `created_at` (timestamptz)

2. Security
  - Enable RLS on `modes_reglement`.
  - Allow anon + authenticated full CRUD (single-tenant app, no auth).

3. Seed data
  - Insert the 4 default modes that were previously hardcoded.
*/

CREATE TABLE IF NOT EXISTS modes_reglement (
  id serial PRIMARY KEY,
  code text UNIQUE NOT NULL,
  label text NOT NULL,
  description text,
  actif boolean NOT NULL DEFAULT true,
  ordre integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE modes_reglement ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_modes_reglement" ON modes_reglement;
CREATE POLICY "anon_select_modes_reglement" ON modes_reglement FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_modes_reglement" ON modes_reglement;
CREATE POLICY "anon_insert_modes_reglement" ON modes_reglement FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_modes_reglement" ON modes_reglement;
CREATE POLICY "anon_update_modes_reglement" ON modes_reglement FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_modes_reglement" ON modes_reglement;
CREATE POLICY "anon_delete_modes_reglement" ON modes_reglement FOR DELETE
  TO anon, authenticated USING (true);

-- Seed default modes
INSERT INTO modes_reglement (code, label, description, ordre) VALUES
  ('PAYER_DEPOT', 'Payer au dépôt', 'Paiement complet au moment du dépôt', 1),
  ('AVANCE', 'Avance', 'Acompte versé au dépôt, solde au retrait', 2),
  ('SOLDE', 'Soldé', 'Soldé (paiement différé)', 3),
  ('NON_REGLÉ', 'Non réglé', 'Le client ne paie pas maintenant', 4)
ON CONFLICT (code) DO NOTHING;
