/*
# Add Super Administrateur (platform-level admin)

## Overview
Introduces a super-admin role that sits above all entreprises. The super-admin can:
- Create the first Administrateur for each entreprise
- View all entreprises and their members
- Promote/remove entreprise admins

## New Tables
- `super_admins`
  - `user_id` (uuid, PK, FK to auth.users ON DELETE CASCADE)
  - `email` (text, NOT NULL)
  - `created_at` (timestamptz, default now())

## New Functions
- `is_super_admin()` — returns true if the current auth user is in super_admins
- `create_entreprise_admin(admin_email text, entreprise_nom text)` — creates an entreprise
  row + adds the user as admin member. Only callable by super-admin.

## Security Changes
- Super-admin bypasses tenant checks: can read all entreprises and entreprise_members.
- New RLS policies on entreprise and entreprise_members allow super-admin full access.
*/

-- ═══════════════════════════════════════════════════════════
-- 1. Create super_admins table
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS super_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE super_admins ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════
-- 2. is_super_admin() function
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  RETURN EXISTS (SELECT 1 FROM super_admins WHERE user_id = uid);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

-- ═══════════════════════════════════════════════════════════
-- 3. RLS on super_admins: only super-admins can read
-- ═══════════════════════════════════════════════════════════

CREATE POLICY "select_super_admins_self" ON super_admins FOR SELECT TO authenticated
USING (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════
-- 4. Update entreprise RLS: super-admin can read all + update
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "select_tenant_entreprise" ON entreprise;
CREATE POLICY "select_entreprise_all" ON entreprise FOR SELECT TO authenticated
USING (is_super_admin() OR is_tenant_member(user_id));

-- Super-admin can update any entreprise
DROP POLICY IF EXISTS "update_tenant_entreprise" ON entreprise;
CREATE POLICY "update_entreprise_admin" ON entreprise FOR UPDATE TO authenticated
USING (is_super_admin() OR is_tenant_admin(user_id))
WITH CHECK (is_super_admin() OR is_tenant_admin(user_id));

-- Super-admin can insert entreprise (for creating new entreprise + admin)
DROP POLICY IF EXISTS "insert_tenant_entreprise" ON entreprise;
CREATE POLICY "insert_entreprise_admin" ON entreprise FOR INSERT TO authenticated
WITH CHECK (is_super_admin() OR user_id = auth.uid());

-- Super-admin can delete entreprise
DROP POLICY IF EXISTS "delete_tenant_entreprise" ON entreprise;
CREATE POLICY "delete_entreprise_admin" ON entreprise FOR DELETE TO authenticated
USING (is_super_admin() OR is_tenant_admin(user_id));

-- ═══════════════════════════════════════════════════════════
-- 5. Update entreprise_members RLS: super-admin can read all + manage
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "select_own_membership" ON entreprise_members;
CREATE POLICY "select_membership_all" ON entreprise_members FOR SELECT TO authenticated
USING (is_super_admin() OR is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "insert_membership_admin" ON entreprise_members;
CREATE POLICY "insert_membership_admin" ON entreprise_members FOR INSERT TO authenticated
WITH CHECK (is_super_admin() OR is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "update_membership_admin" ON entreprise_members;
CREATE POLICY "update_membership_admin" ON entreprise_members FOR UPDATE TO authenticated
USING (is_super_admin() OR is_tenant_admin(tenant_id))
WITH CHECK (is_super_admin() OR is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "delete_membership_admin" ON entreprise_members;
CREATE POLICY "delete_membership_admin" ON entreprise_members FOR DELETE TO authenticated
USING (is_super_admin() OR is_tenant_admin(tenant_id));

-- ═══════════════════════════════════════════════════════════
-- 6. create_entreprise_admin() function
--    Super-admin creates a new entreprise and assigns a user as admin.
--    The user must already have an auth account.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_entreprise_admin(admin_email text, entreprise_nom text)
RETURNS uuid AS $$
DECLARE
  uid uuid := auth.uid();
  admin_uid uuid;
  ent_id integer;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Seul le super-administrateur peut créer des administrateurs d''entreprise';
  END IF;

  -- Find the user by email
  SELECT id INTO admin_uid FROM auth.users WHERE email = admin_email;
  IF admin_uid IS NULL THEN
    RAISE EXCEPTION 'Utilisateur introuvable. La personne doit d''abord créer un compte avec cet email.';
  END IF;

  -- Create the entreprise row
  INSERT INTO entreprise (user_id, nom)
  VALUES (admin_uid, entreprise_nom)
  RETURNING id INTO ent_id;

  -- Add the user as admin member
  INSERT INTO entreprise_members (tenant_id, user_id, role)
  VALUES (admin_uid, admin_uid, 'admin')
  ON CONFLICT (tenant_id, user_id) DO NOTHING;

  RETURN admin_uid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.create_entreprise_admin(text, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════
-- 7. add_admin_to_existing_entreprise() function
--    Super-admin assigns a user as admin to an existing entreprise.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.add_admin_to_entreprise(admin_email text, target_tenant_id uuid)
RETURNS uuid AS $$
DECLARE
  uid uuid := auth.uid();
  admin_uid uuid;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Seul le super-administrateur peut assigner des administrateurs';
  END IF;

  SELECT id INTO admin_uid FROM auth.users WHERE email = admin_email;
  IF admin_uid IS NULL THEN
    RAISE EXCEPTION 'Utilisateur introuvable. La personne doit d''abord créer un compte avec cet email.';
  END IF;

  INSERT INTO entreprise_members (tenant_id, user_id, role)
  VALUES (target_tenant_id, admin_uid, 'admin')
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'admin';

  RETURN admin_uid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.add_admin_to_entreprise(text, uuid) TO authenticated;
