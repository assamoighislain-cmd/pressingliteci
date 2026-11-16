/*
# Create loyalty/fidelity points system

1. New Tables
   - `fidelite_points`
     - `id` (uuid, primary key)
     - `client_id` (uuid, FK to clients, unique per client)
     - `total_points` (integer, cumulated points balance)
     - `tenant_id` (uuid, multi-tenant scoping)
     - `boutique_id` (uuid, FK to boutiques)
     - `created_at`, `updated_at` (timestamps)
   - `fidelite_history`
     - `id` (uuid, primary key)
     - `client_id` (uuid, FK to clients)
     - `depot_id` (uuid, nullable FK to depots)
     - `points` (integer, positive = earned, negative = redeemed)
     - `motif` (text, reason for point change)
     - `tenant_id` (uuid, multi-tenant scoping)
     - `boutique_id` (uuid, FK to boutiques)
     - `created_at` (timestamp)

2. New Columns
   - `entreprise.fidelite_points_per_unit` (integer, default 1)
     How many points the client earns per 1000 XOF spent.
   - `entreprise.fidelite_redeem_threshold` (integer, default 100)
     Minimum points before client can redeem.
   - `entreprise.fidelite_redeem_value` (integer, default 1000)
     XOF value given when redeeming threshold points.

3. Security
   - RLS on both new tables, scoped to authenticated users via tenant membership.

4. Notes
   - Points are earned automatically per deposit based on the entreprise config.
   - Points can be redeemed as discount on future deposits.
*/

-- Fidelite points balance per client
CREATE TABLE IF NOT EXISTS fidelite_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  total_points integer NOT NULL DEFAULT 0,
  tenant_id uuid NOT NULL,
  boutique_id uuid REFERENCES boutiques(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(client_id)
);

ALTER TABLE fidelite_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_fidelite_points" ON fidelite_points;
CREATE POLICY "select_fidelite_points" ON fidelite_points FOR SELECT
  TO authenticated USING (
    tenant_id IN (SELECT tenant_id FROM entreprise_members WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_fidelite_points" ON fidelite_points;
CREATE POLICY "insert_fidelite_points" ON fidelite_points FOR INSERT
  TO authenticated WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM entreprise_members WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_fidelite_points" ON fidelite_points;
CREATE POLICY "update_fidelite_points" ON fidelite_points FOR UPDATE
  TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM entreprise_members WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM entreprise_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_fidelite_points" ON fidelite_points;
CREATE POLICY "delete_fidelite_points" ON fidelite_points FOR DELETE
  TO authenticated USING (
    tenant_id IN (SELECT tenant_id FROM entreprise_members WHERE user_id = auth.uid())
  );

-- Fidelite history log
CREATE TABLE IF NOT EXISTS fidelite_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  depot_id uuid REFERENCES depots(id) ON DELETE SET NULL,
  points integer NOT NULL,
  motif text NOT NULL,
  tenant_id uuid NOT NULL,
  boutique_id uuid REFERENCES boutiques(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE fidelite_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_fidelite_history" ON fidelite_history;
CREATE POLICY "select_fidelite_history" ON fidelite_history FOR SELECT
  TO authenticated USING (
    tenant_id IN (SELECT tenant_id FROM entreprise_members WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_fidelite_history" ON fidelite_history;
CREATE POLICY "insert_fidelite_history" ON fidelite_history FOR INSERT
  TO authenticated WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM entreprise_members WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_fidelite_history" ON fidelite_history;
CREATE POLICY "update_fidelite_history" ON fidelite_history FOR UPDATE
  TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM entreprise_members WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM entreprise_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_fidelite_history" ON fidelite_history;
CREATE POLICY "delete_fidelite_history" ON fidelite_history FOR DELETE
  TO authenticated USING (
    tenant_id IN (SELECT tenant_id FROM entreprise_members WHERE user_id = auth.uid())
  );

-- Add fidelite config columns to entreprise
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='entreprise' AND column_name='fidelite_points_per_unit') THEN
    ALTER TABLE entreprise ADD COLUMN fidelite_points_per_unit integer NOT NULL DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='entreprise' AND column_name='fidelite_redeem_threshold') THEN
    ALTER TABLE entreprise ADD COLUMN fidelite_redeem_threshold integer NOT NULL DEFAULT 100;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='entreprise' AND column_name='fidelite_redeem_value') THEN
    ALTER TABLE entreprise ADD COLUMN fidelite_redeem_value integer NOT NULL DEFAULT 1000;
  END IF;
END $$;
