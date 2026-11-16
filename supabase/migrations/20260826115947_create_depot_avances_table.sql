/*
# Create depot_avances table for multiple partial payments

1. New Tables
- `depot_avances`
  - `id` (uuid, primary key)
  - `depot_id` (uuid, foreign key to depots.id, ON DELETE CASCADE)
  - `montant` (numeric, not null — amount of this avance)
  - `date_paiement` (timestamptz, default now() — when the avance was made)
  - `created_at` (timestamptz, default now())

2. Purpose
- Allows a client to make multiple partial payments (avances) on a single depot
  over time, rather than being limited to a single avance_amount field.

3. Security
- Enable RLS on `depot_avances`.
- Allow anon + authenticated CRUD (single-tenant app, no sign-in).

4. Notes
- The existing `avance_amount` column on `depots` is preserved for backward
  compatibility but the total paid will now be computed as the sum of all
  rows in `depot_avances` for a given depot (plus the original avance_amount
  for existing depots that have no depot_avances rows).
*/

CREATE TABLE IF NOT EXISTS depot_avances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  depot_id uuid NOT NULL REFERENCES depots(id) ON DELETE CASCADE,
  montant numeric NOT NULL DEFAULT 0,
  date_paiement timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_depot_avances_depot_id ON depot_avances(depot_id);

ALTER TABLE depot_avances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_depot_avances" ON depot_avances;
CREATE POLICY "anon_select_depot_avances" ON depot_avances FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_depot_avances" ON depot_avances;
CREATE POLICY "anon_insert_depot_avances" ON depot_avances FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_depot_avances" ON depot_avances;
CREATE POLICY "anon_update_depot_avances" ON depot_avances FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_depot_avances" ON depot_avances;
CREATE POLICY "anon_delete_depot_avances" ON depot_avances FOR DELETE
  TO anon, authenticated USING (true);
