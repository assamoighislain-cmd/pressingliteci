/*
# Add multi-user team support with roles (Administrateur, Gerant, Commercial)

## Overview
Transforms the app from "one user = one entreprise" to "one entreprise = multiple users with roles".
Introduces an `entreprise_members` table that maps users to an entreprise (by tenant_id = entreprise.user_id)
with a role. All business tables get a `tenant_id` column so all members share the same data.

## New Tables
- `entreprise_members`
  - `id` (uuid, PK)
  - `tenant_id` (uuid) — the entreprise owner's user_id (references entreprise.user_id)
  - `user_id` (uuid, FK to auth.users, ON DELETE CASCADE) — the member's auth account
  - `role` (text, NOT NULL, CHECK in ('admin', 'gerant', 'commercial'))
  - `created_at` (timestamptz, default now())
  - Unique constraint on (tenant_id, user_id)

## Modified Tables
- All business tables get a new `tenant_id` column (uuid). For existing rows, tenant_id = user_id.

## Security Changes
- New RLS policies on `entreprise_members`: members can read; only admins can modify.
- All business table policies rewritten to use is_tenant_member(tenant_id).
- Helper functions: get_tenant_id(), get_user_role(), is_tenant_member(), is_tenant_admin().

## Important Notes
1. The entreprise owner (user_id on entreprise table) is the "admin" / tenant_id.
2. Roles: 'admin' (full access + team management), 'gerant' (all operations except team management),
   'commercial' (all operations except team management and entreprise settings).
3. entreprise_members uses tenant_id (uuid = entreprise.user_id) instead of entreprise.id (integer).
*/

-- ═══════════════════════════════════════════════════════════
-- 1. Add tenant_id column to all business tables
-- ═══════════════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'clients' AND column_name = 'tenant_id') THEN
    ALTER TABLE clients ADD COLUMN tenant_id uuid;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'types_traitement' AND column_name = 'tenant_id') THEN
    ALTER TABLE types_traitement ADD COLUMN tenant_id uuid;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'articles' AND column_name = 'tenant_id') THEN
    ALTER TABLE articles ADD COLUMN tenant_id uuid;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'depots' AND column_name = 'tenant_id') THEN
    ALTER TABLE depots ADD COLUMN tenant_id uuid;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'depot_articles' AND column_name = 'tenant_id') THEN
    ALTER TABLE depot_articles ADD COLUMN tenant_id uuid;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'depot_avances' AND column_name = 'tenant_id') THEN
    ALTER TABLE depot_avances ADD COLUMN tenant_id uuid;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'modes_reglement' AND column_name = 'tenant_id') THEN
    ALTER TABLE modes_reglement ADD COLUMN tenant_id uuid;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'depot_counter' AND column_name = 'tenant_id') THEN
    ALTER TABLE depot_counter ADD COLUMN tenant_id uuid;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'code_counter' AND column_name = 'tenant_id') THEN
    ALTER TABLE code_counter ADD COLUMN tenant_id uuid;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════
-- 2. Backfill tenant_id = user_id for existing rows
-- ═══════════════════════════════════════════════════════════

UPDATE clients SET tenant_id = user_id WHERE tenant_id IS NULL;
UPDATE types_traitement SET tenant_id = user_id WHERE tenant_id IS NULL;
UPDATE articles SET tenant_id = user_id WHERE tenant_id IS NULL;
UPDATE depots SET tenant_id = user_id WHERE tenant_id IS NULL;
UPDATE depot_articles SET tenant_id = user_id WHERE tenant_id IS NULL;
UPDATE depot_avances SET tenant_id = user_id WHERE tenant_id IS NULL;
UPDATE modes_reglement SET tenant_id = user_id WHERE tenant_id IS NULL;
UPDATE depot_counter SET tenant_id = user_id WHERE tenant_id IS NULL;
UPDATE code_counter SET tenant_id = user_id WHERE tenant_id IS NULL;

-- ═══════════════════════════════════════════════════════════
-- 3. Set NOT NULL + DEFAULT on tenant_id
-- ═══════════════════════════════════════════════════════════

ALTER TABLE clients ALTER COLUMN tenant_id SET DEFAULT auth.uid();
ALTER TABLE types_traitement ALTER COLUMN tenant_id SET DEFAULT auth.uid();
ALTER TABLE articles ALTER COLUMN tenant_id SET DEFAULT auth.uid();
ALTER TABLE depots ALTER COLUMN tenant_id SET DEFAULT auth.uid();
ALTER TABLE depot_articles ALTER COLUMN tenant_id SET DEFAULT auth.uid();
ALTER TABLE depot_avances ALTER COLUMN tenant_id SET DEFAULT auth.uid();
ALTER TABLE modes_reglement ALTER COLUMN tenant_id SET DEFAULT auth.uid();
ALTER TABLE depot_counter ALTER COLUMN tenant_id SET DEFAULT auth.uid();
ALTER TABLE code_counter ALTER COLUMN tenant_id SET DEFAULT auth.uid();

ALTER TABLE clients ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE types_traitement ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE articles ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE depots ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE depot_articles ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE depot_avances ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE modes_reglement ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE depot_counter ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE code_counter ALTER COLUMN tenant_id SET NOT NULL;

-- ═══════════════════════════════════════════════════════════
-- 4. Indexes on tenant_id
-- ═══════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_clients_tenant_id ON clients(tenant_id);
CREATE INDEX IF NOT EXISTS idx_types_traitement_tenant_id ON types_traitement(tenant_id);
CREATE INDEX IF NOT EXISTS idx_articles_tenant_id ON articles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_depots_tenant_id ON depots(tenant_id);
CREATE INDEX IF NOT EXISTS idx_depot_articles_tenant_id ON depot_articles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_depot_avances_tenant_id ON depot_avances(tenant_id);
CREATE INDEX IF NOT EXISTS idx_modes_reglement_tenant_id ON modes_reglement(tenant_id);

-- ═══════════════════════════════════════════════════════════
-- 5. Create entreprise_members table
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS entreprise_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'commercial' CHECK (role IN ('admin', 'gerant', 'commercial')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

ALTER TABLE entreprise_members ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_entreprise_members_tenant_id ON entreprise_members(tenant_id);
CREATE INDEX IF NOT EXISTS idx_entreprise_members_user_id ON entreprise_members(user_id);

-- ═══════════════════════════════════════════════════════════
-- 6. Helper functions
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_tenant_id()
RETURNS uuid AS $$
DECLARE
  uid uuid := auth.uid();
  t_id uuid;
BEGIN
  SELECT user_id INTO t_id FROM entreprise WHERE user_id = uid LIMIT 1;
  IF t_id IS NOT NULL THEN
    RETURN t_id;
  END IF;
  SELECT tenant_id INTO t_id FROM entreprise_members WHERE user_id = uid LIMIT 1;
  RETURN t_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text AS $$
DECLARE
  uid uuid := auth.uid();
  r text;
BEGIN
  SELECT 'admin' INTO r FROM entreprise WHERE user_id = uid LIMIT 1;
  IF r IS NOT NULL THEN
    RETURN r;
  END IF;
  SELECT role INTO r FROM entreprise_members WHERE user_id = uid LIMIT 1;
  RETURN r;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_tenant_member(t_id uuid)
RETURNS boolean AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF EXISTS (SELECT 1 FROM entreprise WHERE user_id = uid AND user_id = t_id) THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM entreprise_members em WHERE em.user_id = uid AND em.tenant_id = t_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_tenant_admin(t_id uuid)
RETURNS boolean AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF EXISTS (SELECT 1 FROM entreprise WHERE user_id = uid AND user_id = t_id) THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM entreprise_members em WHERE em.user_id = uid AND em.tenant_id = t_id AND em.role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_tenant_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_tenant_admin(uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════
-- 7. Populate entreprise_members for existing entreprise owners
-- ═══════════════════════════════════════════════════════════

INSERT INTO entreprise_members (tenant_id, user_id, role)
SELECT e.user_id, e.user_id, 'admin'
FROM entreprise e
WHERE NOT EXISTS (
  SELECT 1 FROM entreprise_members em WHERE em.tenant_id = e.user_id AND em.user_id = e.user_id
);

-- ═══════════════════════════════════════════════════════════
-- 8. Rewrite RLS policies: use is_tenant_member(tenant_id)
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "select_own_clients" ON clients;
DROP POLICY IF EXISTS "insert_own_clients" ON clients;
DROP POLICY IF EXISTS "update_own_clients" ON clients;
DROP POLICY IF EXISTS "delete_own_clients" ON clients;

DROP POLICY IF EXISTS "select_own_types_traitement" ON types_traitement;
DROP POLICY IF EXISTS "insert_own_types_traitement" ON types_traitement;
DROP POLICY IF EXISTS "update_own_types_traitement" ON types_traitement;
DROP POLICY IF EXISTS "delete_own_types_traitement" ON types_traitement;

DROP POLICY IF EXISTS "select_own_articles" ON articles;
DROP POLICY IF EXISTS "insert_own_articles" ON articles;
DROP POLICY IF EXISTS "update_own_articles" ON articles;
DROP POLICY IF EXISTS "delete_own_articles" ON articles;

DROP POLICY IF EXISTS "select_own_depots" ON depots;
DROP POLICY IF EXISTS "insert_own_depots" ON depots;
DROP POLICY IF EXISTS "update_own_depots" ON depots;
DROP POLICY IF EXISTS "delete_own_depots" ON depots;

DROP POLICY IF EXISTS "select_own_depot_articles" ON depot_articles;
DROP POLICY IF EXISTS "insert_own_depot_articles" ON depot_articles;
DROP POLICY IF EXISTS "update_own_depot_articles" ON depot_articles;
DROP POLICY IF EXISTS "delete_own_depot_articles" ON depot_articles;

DROP POLICY IF EXISTS "select_own_depot_avances" ON depot_avances;
DROP POLICY IF EXISTS "insert_own_depot_avances" ON depot_avances;
DROP POLICY IF EXISTS "update_own_depot_avances" ON depot_avances;
DROP POLICY IF EXISTS "delete_own_depot_avances" ON depot_avances;

DROP POLICY IF EXISTS "select_own_modes_reglement" ON modes_reglement;
DROP POLICY IF EXISTS "insert_own_modes_reglement" ON modes_reglement;
DROP POLICY IF EXISTS "update_own_modes_reglement" ON modes_reglement;
DROP POLICY IF EXISTS "delete_own_modes_reglement" ON modes_reglement;

DROP POLICY IF EXISTS "select_own_entreprise" ON entreprise;
DROP POLICY IF EXISTS "insert_own_entreprise" ON entreprise;
DROP POLICY IF EXISTS "update_own_entreprise" ON entreprise;
DROP POLICY IF EXISTS "delete_own_entreprise" ON entreprise;

DROP POLICY IF EXISTS "select_own_depot_counter" ON depot_counter;
DROP POLICY IF EXISTS "insert_own_depot_counter" ON depot_counter;
DROP POLICY IF EXISTS "update_own_depot_counter" ON depot_counter;

DROP POLICY IF EXISTS "select_own_code_counter" ON code_counter;
DROP POLICY IF EXISTS "insert_own_code_counter" ON code_counter;
DROP POLICY IF EXISTS "update_own_code_counter" ON code_counter;

-- clients
CREATE POLICY "select_tenant_clients" ON clients FOR SELECT TO authenticated USING (is_tenant_member(tenant_id));
CREATE POLICY "insert_tenant_clients" ON clients FOR INSERT TO authenticated WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "update_tenant_clients" ON clients FOR UPDATE TO authenticated USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "delete_tenant_clients" ON clients FOR DELETE TO authenticated USING (is_tenant_member(tenant_id));

-- types_traitement
CREATE POLICY "select_tenant_types_traitement" ON types_traitement FOR SELECT TO authenticated USING (is_tenant_member(tenant_id));
CREATE POLICY "insert_tenant_types_traitement" ON types_traitement FOR INSERT TO authenticated WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "update_tenant_types_traitement" ON types_traitement FOR UPDATE TO authenticated USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "delete_tenant_types_traitement" ON types_traitement FOR DELETE TO authenticated USING (is_tenant_member(tenant_id));

-- articles
CREATE POLICY "select_tenant_articles" ON articles FOR SELECT TO authenticated USING (is_tenant_member(tenant_id));
CREATE POLICY "insert_tenant_articles" ON articles FOR INSERT TO authenticated WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "update_tenant_articles" ON articles FOR UPDATE TO authenticated USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "delete_tenant_articles" ON articles FOR DELETE TO authenticated USING (is_tenant_member(tenant_id));

-- depots
CREATE POLICY "select_tenant_depots" ON depots FOR SELECT TO authenticated USING (is_tenant_member(tenant_id));
CREATE POLICY "insert_tenant_depots" ON depots FOR INSERT TO authenticated WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "update_tenant_depots" ON depots FOR UPDATE TO authenticated USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "delete_tenant_depots" ON depots FOR DELETE TO authenticated USING (is_tenant_member(tenant_id));

-- depot_articles
CREATE POLICY "select_tenant_depot_articles" ON depot_articles FOR SELECT TO authenticated USING (is_tenant_member(tenant_id));
CREATE POLICY "insert_tenant_depot_articles" ON depot_articles FOR INSERT TO authenticated WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "update_tenant_depot_articles" ON depot_articles FOR UPDATE TO authenticated USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "delete_tenant_depot_articles" ON depot_articles FOR DELETE TO authenticated USING (is_tenant_member(tenant_id));

-- depot_avances
CREATE POLICY "select_tenant_depot_avances" ON depot_avances FOR SELECT TO authenticated USING (is_tenant_member(tenant_id));
CREATE POLICY "insert_tenant_depot_avances" ON depot_avances FOR INSERT TO authenticated WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "update_tenant_depot_avances" ON depot_avances FOR UPDATE TO authenticated USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "delete_tenant_depot_avances" ON depot_avances FOR DELETE TO authenticated USING (is_tenant_member(tenant_id));

-- modes_reglement
CREATE POLICY "select_tenant_modes_reglement" ON modes_reglement FOR SELECT TO authenticated USING (is_tenant_member(tenant_id));
CREATE POLICY "insert_tenant_modes_reglement" ON modes_reglement FOR INSERT TO authenticated WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "update_tenant_modes_reglement" ON modes_reglement FOR UPDATE TO authenticated USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "delete_tenant_modes_reglement" ON modes_reglement FOR DELETE TO authenticated USING (is_tenant_member(tenant_id));

-- entreprise: members can read, only admin can update/delete
CREATE POLICY "select_tenant_entreprise" ON entreprise FOR SELECT TO authenticated USING (is_tenant_member(user_id));
CREATE POLICY "insert_tenant_entreprise" ON entreprise FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "update_tenant_entreprise" ON entreprise FOR UPDATE TO authenticated USING (is_tenant_admin(user_id)) WITH CHECK (is_tenant_admin(user_id));
CREATE POLICY "delete_tenant_entreprise" ON entreprise FOR DELETE TO authenticated USING (is_tenant_admin(user_id));

-- depot_counter
CREATE POLICY "select_tenant_depot_counter" ON depot_counter FOR SELECT TO authenticated USING (is_tenant_member(tenant_id));
CREATE POLICY "insert_tenant_depot_counter" ON depot_counter FOR INSERT TO authenticated WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "update_tenant_depot_counter" ON depot_counter FOR UPDATE TO authenticated USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));

-- code_counter
CREATE POLICY "select_tenant_code_counter" ON code_counter FOR SELECT TO authenticated USING (is_tenant_member(tenant_id));
CREATE POLICY "insert_tenant_code_counter" ON code_counter FOR INSERT TO authenticated WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "update_tenant_code_counter" ON code_counter FOR UPDATE TO authenticated USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));

-- entreprise_members: members can read, only admin can modify
CREATE POLICY "select_own_membership" ON entreprise_members FOR SELECT TO authenticated
USING (is_tenant_member(tenant_id));
CREATE POLICY "insert_membership_admin" ON entreprise_members FOR INSERT TO authenticated
WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "update_membership_admin" ON entreprise_members FOR UPDATE TO authenticated
USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "delete_membership_admin" ON entreprise_members FOR DELETE TO authenticated
USING (is_tenant_admin(tenant_id));

-- ═══════════════════════════════════════════════════════════
-- 9. Update code generation functions to use tenant_id
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.generate_client_code()
RETURNS text AS $$
DECLARE
  next_num integer;
  uid uuid := auth.uid();
  t_id uuid;
BEGIN
  t_id := public.get_tenant_id();
  INSERT INTO code_counter (id, user_id, tenant_id, client_counter, article_counter, traitement_counter)
  VALUES (1, uid, t_id, 0, 0, 0)
  ON CONFLICT (id, user_id) DO NOTHING;

  UPDATE code_counter SET client_counter = client_counter + 1
  WHERE id = 1 AND user_id = uid
  RETURNING client_counter INTO next_num;

  RETURN 'C-' || lpad(next_num::text, 4, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.generate_article_code()
RETURNS text AS $$
DECLARE
  next_num integer;
  uid uuid := auth.uid();
  t_id uuid;
BEGIN
  t_id := public.get_tenant_id();
  INSERT INTO code_counter (id, user_id, tenant_id, client_counter, article_counter, traitement_counter)
  VALUES (1, uid, t_id, 0, 0, 0)
  ON CONFLICT (id, user_id) DO NOTHING;

  UPDATE code_counter SET article_counter = article_counter + 1
  WHERE id = 1 AND user_id = uid
  RETURNING article_counter INTO next_num;

  RETURN 'A-' || lpad(next_num::text, 4, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.generate_traitement_code()
RETURNS text AS $$
DECLARE
  next_num integer;
  uid uuid := auth.uid();
  t_id uuid;
BEGIN
  t_id := public.get_tenant_id();
  INSERT INTO code_counter (id, user_id, tenant_id, client_counter, article_counter, traitement_counter)
  VALUES (1, uid, t_id, 0, 0, 0)
  ON CONFLICT (id, user_id) DO NOTHING;

  UPDATE code_counter SET traitement_counter = traitement_counter + 1
  WHERE id = 1 AND user_id = uid
  RETURNING traitement_counter INTO next_num;

  RETURN 'T-' || lpad(next_num::text, 4, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══════════════════════════════════════════════════════════
-- 10. Function to add a team member
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.add_team_member(member_email text, member_role text)
RETURNS uuid AS $$
DECLARE
  uid uuid := auth.uid();
  t_id uuid;
  member_uid uuid;
BEGIN
  t_id := public.get_tenant_id();
  IF t_id IS NULL THEN
    RAISE EXCEPTION 'Aucune entreprise trouvée';
  END IF;

  IF NOT public.is_tenant_admin(t_id) THEN
    RAISE EXCEPTION 'Seul l''administrateur peut ajouter des membres';
  END IF;

  SELECT id INTO member_uid FROM auth.users WHERE email = member_email;
  IF member_uid IS NULL THEN
    RAISE EXCEPTION 'Utilisateur introuvable. L''utilisateur doit d''abord créer un compte.';
  END IF;

  IF member_uid = uid THEN
    RAISE EXCEPTION 'Vous êtes déjà membre de cette entreprise';
  END IF;

  INSERT INTO entreprise_members (tenant_id, user_id, role)
  VALUES (t_id, member_uid, member_role)
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role
  RETURNING user_id INTO member_uid;

  RETURN member_uid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.add_team_member(text, text) TO authenticated;
