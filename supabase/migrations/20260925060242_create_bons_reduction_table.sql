/*
# Create bons_reduction (discount coupons) table

1. New Tables
   - `bons_reduction`
     - `id` (uuid, primary key)
     - `code` (text, unique per tenant) - the coupon code to enter
     - `type_remise` (text) - 'pourcentage' or 'montant_fixe'
     - `valeur` (numeric) - discount value (% or fixed amount)
     - `date_debut` (timestamptz) - start validity
     - `date_fin` (timestamptz, nullable) - end validity (null = no expiry)
     - `usage_max` (int, nullable) - max redemptions (null = unlimited)
     - `usage_count` (int, default 0) - times redeemed
     - `actif` (boolean, default true)
     - `description` (text, nullable)
     - `tenant_id`, `user_id`, `boutique_id` - multi-tenant scoping

2. Security
   - RLS enabled, tenant-scoped CRUD using is_tenant_member()
*/

CREATE TABLE IF NOT EXISTS bons_reduction (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  type_remise text NOT NULL DEFAULT 'pourcentage' CHECK (type_remise IN ('pourcentage', 'montant_fixe')),
  valeur numeric NOT NULL CHECK (valeur > 0),
  date_debut timestamptz NOT NULL DEFAULT now(),
  date_fin timestamptz,
  usage_max int,
  usage_count int NOT NULL DEFAULT 0,
  actif boolean NOT NULL DEFAULT true,
  description text,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  boutique_id uuid,
  created_at timestamptz DEFAULT now(),
  UNIQUE (tenant_id, code)
);

ALTER TABLE bons_reduction ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_bons_reduction" ON bons_reduction;
CREATE POLICY "select_bons_reduction" ON bons_reduction FOR SELECT
  TO authenticated USING (is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "insert_bons_reduction" ON bons_reduction;
CREATE POLICY "insert_bons_reduction" ON bons_reduction FOR INSERT
  TO authenticated WITH CHECK (is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "update_bons_reduction" ON bons_reduction;
CREATE POLICY "update_bons_reduction" ON bons_reduction FOR UPDATE
  TO authenticated USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "delete_bons_reduction" ON bons_reduction;
CREATE POLICY "delete_bons_reduction" ON bons_reduction FOR DELETE
  TO authenticated USING (is_tenant_member(tenant_id));
