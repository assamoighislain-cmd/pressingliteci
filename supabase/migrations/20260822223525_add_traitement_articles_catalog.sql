/*
# Add treatment types table, article catalog, and auto retrait date

## Overview
This migration adds:
1. A `types_traitement` table to define treatment types with their coefficient AND number of processing days.
2. An `articles` catalog table so the pressing can manage a list of standard articles (designation + default price).
3. A `date_retrait_prevue` column on `depots` — the automatically calculated pickup date based on the treatment type with the longest processing time among the deposit's articles.
4. New columns on `depot_articles`: `prix_traitement` (unit price after coefficient) and `nb_pieces` (number of pieces).

## New Tables

### `types_traitement`
- `id` (uuid, primary key)
- `code` (text, unique, not null) — NORMAL, EXPRESS, EXPRESS_LENDemain
- `libelle` (text, not null) — display label
- `coefficient` (numeric(4,2), not null) — price multiplier
- `nb_jours` (integer, not null, default 1) — number of processing days
- `created_at` (timestamptz, default now())

### `articles`
- `id` (uuid, primary key)
- `designation` (text, not null) — article name (e.g. Chemise, Pantalon)
- `prix_unitaire` (numeric(12,2), not null) — default unit price
- `created_at` (timestamptz, default now())

## Modified Tables

### `depots`
- Added `date_retrait_prevue` (timestamptz) — automatically calculated pickup date

### `depot_articles`
- Added `prix_traitement` (numeric(12,2)) — unit price after coefficient (prix_unitaire × coefficient)
- Added `nb_pieces` (integer, default 1) — number of pieces for this article line

## Security
- RLS enabled on `types_traitement` and `articles`.
- Single-tenant app: anon + authenticated full CRUD on both new tables.

## Important Notes
1. Seed data is inserted for `types_traitement` (NORMAL ×1.0 / 1 jour, EXPRESS_LENDemain ×1.25 / 2 jours, EXPRESS ×1.5 / 0 jour = same day).
2. The `date_retrait_prevue` on `depots` is calculated by the application as: `date_depot + max(nb_jours across all articles' treatment types)`.
3. Existing `depot_articles` rows get `nb_pieces` defaulting to their existing `quantite` value, and `prix_traitement` computed from existing data.
*/

-- Create types_traitement table
CREATE TABLE IF NOT EXISTS types_traitement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  libelle text NOT NULL,
  coefficient numeric(4,2) NOT NULL,
  nb_jours integer NOT NULL DEFAULT 1,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE types_traitement ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_types_traitement" ON types_traitement;
CREATE POLICY "anon_select_types_traitement" ON types_traitement FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_types_traitement" ON types_traitement;
CREATE POLICY "anon_insert_types_traitement" ON types_traitement FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_types_traitement" ON types_traitement;
CREATE POLICY "anon_update_types_traitement" ON types_traitement FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_types_traitement" ON types_traitement;
CREATE POLICY "anon_delete_types_traitement" ON types_traitement FOR DELETE
  TO anon, authenticated USING (true);

-- Seed treatment types
INSERT INTO types_traitement (code, libelle, coefficient, nb_jours) VALUES
  ('NORMAL', 'Normal', 1.0, 2),
  ('EXPRESS_LENDemain', 'Express du lendemain', 1.25, 1),
  ('EXPRESS', 'Express', 1.5, 0)
ON CONFLICT (code) DO NOTHING;

-- Create articles catalog table
CREATE TABLE IF NOT EXISTS articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  designation text NOT NULL,
  prix_unitaire numeric(12,2) NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE articles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_articles" ON articles;
CREATE POLICY "anon_select_articles" ON articles FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_articles" ON articles;
CREATE POLICY "anon_insert_articles" ON articles FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_articles" ON articles;
CREATE POLICY "anon_update_articles" ON articles FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_articles" ON articles;
CREATE POLICY "anon_delete_articles" ON articles FOR DELETE
  TO anon, authenticated USING (true);

-- Add date_retrait_prevue to depots
ALTER TABLE depots ADD COLUMN IF NOT EXISTS date_retrait_prevue timestamptz;

-- Add prix_traitement and nb_pieces to depot_articles
ALTER TABLE depot_articles ADD COLUMN IF NOT EXISTS prix_traitement numeric(12,2);
ALTER TABLE depot_articles ADD COLUMN IF NOT EXISTS nb_pieces integer DEFAULT 1;

-- Backfill nb_pieces from quantite for existing rows
UPDATE depot_articles SET nb_pieces = quantite WHERE nb_pieces IS NULL;
ALTER TABLE depot_articles ALTER COLUMN nb_pieces SET NOT NULL;

-- Backfill prix_traitement from existing data (prix_unitaire * coefficient)
UPDATE depot_articles SET prix_traitement = prix_unitaire * coefficient WHERE prix_traitement IS NULL;
ALTER TABLE depot_articles ALTER COLUMN prix_traitement SET NOT NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_types_traitement_code ON types_traitement(code);
CREATE INDEX IF NOT EXISTS idx_articles_designation ON articles(designation);
