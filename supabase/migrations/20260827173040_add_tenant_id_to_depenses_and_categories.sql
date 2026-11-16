/*
# Add tenant_id to depenses and depense_categories, migrate RLS to tenant-based access

## Overview
The depenses and depense_categories tables were created with owner-only RLS
(`auth.uid() = user_id`), while all other business tables were migrated to
tenant-based access (`is_tenant_member(tenant_id)`) in the SaaS conversion.
This meant team members could not sync shared expenses — only the account
owner could see and manage them.

## Changes
1. Add `tenant_id` column to `depenses` and `depense_categories` (nullable,
   defaults to auth.uid() for new rows).
2. Backfill existing rows: set `tenant_id = user_id` so current data is
   visible to the owner under the new tenant-scoped policies.
3. Replace the old `auth.uid() = user_id` RLS policies with
   `is_tenant_member(tenant_id)` policies, matching all other tables.

## Security
- RLS stays enabled on both tables.
- 4 policies per table (SELECT, INSERT, UPDATE, DELETE), all scoped to
  `is_tenant_member(tenant_id)` — same pattern as clients, depots, etc.
*/

-- 1. Add tenant_id columns
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'depenses' AND column_name = 'tenant_id') THEN
    ALTER TABLE depenses ADD COLUMN tenant_id uuid DEFAULT auth.uid();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'depense_categories' AND column_name = 'tenant_id') THEN
    ALTER TABLE depense_categories ADD COLUMN tenant_id uuid DEFAULT auth.uid();
  END IF;
END $$;

-- 2. Backfill: set tenant_id = user_id for existing rows
UPDATE depenses SET tenant_id = user_id WHERE tenant_id IS NULL;
UPDATE depense_categories SET tenant_id = user_id WHERE tenant_id IS NULL;

-- 3. Index on tenant_id
CREATE INDEX IF NOT EXISTS idx_depenses_tenant_id ON depenses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_depense_categories_tenant_id ON depense_categories(tenant_id);

-- 4. Replace RLS policies for depenses
DROP POLICY IF EXISTS "select_own_depenses" ON depenses;
DROP POLICY IF EXISTS "insert_own_depenses" ON depenses;
DROP POLICY IF EXISTS "update_own_depenses" ON depenses;
DROP POLICY IF EXISTS "delete_own_depenses" ON depenses;

CREATE POLICY "select_tenant_depenses" ON depenses FOR SELECT
  TO authenticated USING (is_tenant_member(tenant_id));
CREATE POLICY "insert_tenant_depenses" ON depenses FOR INSERT
  TO authenticated WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "update_tenant_depenses" ON depenses FOR UPDATE
  TO authenticated USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "delete_tenant_depenses" ON depenses FOR DELETE
  TO authenticated USING (is_tenant_member(tenant_id));

-- 5. Replace RLS policies for depense_categories
DROP POLICY IF EXISTS "select_own_depense_categories" ON depense_categories;
DROP POLICY IF EXISTS "insert_own_depense_categories" ON depense_categories;
DROP POLICY IF EXISTS "update_own_depense_categories" ON depense_categories;
DROP POLICY IF EXISTS "delete_own_depense_categories" ON depense_categories;

CREATE POLICY "select_tenant_depense_categories" ON depense_categories FOR SELECT
  TO authenticated USING (is_tenant_member(tenant_id));
CREATE POLICY "insert_tenant_depense_categories" ON depense_categories FOR INSERT
  TO authenticated WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "update_tenant_depense_categories" ON depense_categories FOR UPDATE
  TO authenticated USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "delete_tenant_depense_categories" ON depense_categories FOR DELETE
  TO authenticated USING (is_tenant_member(tenant_id));