/*
# Convert PressingLite to multi-tenant SaaS

## Overview
Transforms the app from a single-tenant (shared data, anon access) model to a
multi-tenant SaaS where each authenticated user owns their own set of data.
Every business table gets a `user_id` column (defaulting to auth.uid()) and all
RLS policies are rewritten to scope access to the owning user only.

## Modified Tables — new `user_id` column added to each:
- clients, types_traitement, articles, depots, depot_articles, depot_avances,
  modes_reglement, entreprise, depot_counter, code_counter

## Security Changes
- ALL old `anon_*` policies are DROPPED.
- New policies scope every CRUD operation to `TO authenticated` with `auth.uid() = user_id`.
- Code generation functions rewritten to be per-user.

## Important Notes
1. Existing sandbox data has no real owner, so counter rows are deleted before
   restructuring (no production data to preserve).
2. entreprise table changes from single-row (id=1) to per-user rows.
3. Counter tables use composite PK (id, user_id) for per-tenant independence.
*/

-- ═══════════════════════════════════════════════════════════
-- 1. Add user_id columns to all business tables
-- ═══════════════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'clients' AND column_name = 'user_id') THEN
    ALTER TABLE clients ADD COLUMN user_id uuid;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'types_traitement' AND column_name = 'user_id') THEN
    ALTER TABLE types_traitement ADD COLUMN user_id uuid;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'articles' AND column_name = 'user_id') THEN
    ALTER TABLE articles ADD COLUMN user_id uuid;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'depots' AND column_name = 'user_id') THEN
    ALTER TABLE depots ADD COLUMN user_id uuid;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'depot_articles' AND column_name = 'user_id') THEN
    ALTER TABLE depot_articles ADD COLUMN user_id uuid;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'depot_avances' AND column_name = 'user_id') THEN
    ALTER TABLE depot_avances ADD COLUMN user_id uuid;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'modes_reglement' AND column_name = 'user_id') THEN
    ALTER TABLE modes_reglement ADD COLUMN user_id uuid;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'entreprise' AND column_name = 'user_id') THEN
    ALTER TABLE entreprise ADD COLUMN user_id uuid;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'depot_counter' AND column_name = 'user_id') THEN
    ALTER TABLE depot_counter ADD COLUMN user_id uuid;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'code_counter' AND column_name = 'user_id') THEN
    ALTER TABLE code_counter ADD COLUMN user_id uuid;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════
-- 2. Clear existing sandbox data that has no owner
-- ═══════════════════════════════════════════════════════════

DELETE FROM depot_avances WHERE user_id IS NULL;
DELETE FROM depot_articles WHERE user_id IS NULL;
DELETE FROM depots WHERE user_id IS NULL;
DELETE FROM modes_reglement WHERE user_id IS NULL;
DELETE FROM articles WHERE user_id IS NULL;
DELETE FROM types_traitement WHERE user_id IS NULL;
DELETE FROM clients WHERE user_id IS NULL;
DELETE FROM entreprise WHERE user_id IS NULL;
DELETE FROM depot_counter WHERE user_id IS NULL;
DELETE FROM code_counter WHERE user_id IS NULL;

-- ═══════════════════════════════════════════════════════════
-- 3. Set NOT NULL + DEFAULT auth.uid() on user_id columns
-- ═══════════════════════════════════════════════════════════

ALTER TABLE clients ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE types_traitement ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE articles ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE depots ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE depot_articles ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE depot_avances ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE modes_reglement ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE entreprise ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE depot_counter ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE code_counter ALTER COLUMN user_id SET DEFAULT auth.uid();

ALTER TABLE clients ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE types_traitement ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE articles ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE depots ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE depot_articles ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE depot_avances ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE modes_reglement ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE entreprise ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE depot_counter ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE code_counter ALTER COLUMN user_id SET NOT NULL;

-- ═══════════════════════════════════════════════════════════
-- 4. Add foreign keys from user_id to auth.users
-- ═══════════════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_user_id_fkey') THEN
    ALTER TABLE clients ADD CONSTRAINT clients_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'types_traitement_user_id_fkey') THEN
    ALTER TABLE types_traitement ADD CONSTRAINT types_traitement_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'articles_user_id_fkey') THEN
    ALTER TABLE articles ADD CONSTRAINT articles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'depots_user_id_fkey') THEN
    ALTER TABLE depots ADD CONSTRAINT depots_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'depot_articles_user_id_fkey') THEN
    ALTER TABLE depot_articles ADD CONSTRAINT depot_articles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'depot_avances_user_id_fkey') THEN
    ALTER TABLE depot_avances ADD CONSTRAINT depot_avances_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'modes_reglement_user_id_fkey') THEN
    ALTER TABLE modes_reglement ADD CONSTRAINT modes_reglement_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entreprise_user_id_fkey') THEN
    ALTER TABLE entreprise ADD CONSTRAINT entreprise_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'depot_counter_user_id_fkey') THEN
    ALTER TABLE depot_counter ADD CONSTRAINT depot_counter_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'code_counter_user_id_fkey') THEN
    ALTER TABLE code_counter ADD CONSTRAINT code_counter_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════
-- 5. Unique constraint on entreprise.user_id (one row per user)
-- ═══════════════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entreprise_user_id_key') THEN
    ALTER TABLE entreprise ADD CONSTRAINT entreprise_user_id_key UNIQUE (user_id);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════
-- 6. Restructure counter tables for per-user counters
-- ═══════════════════════════════════════════════════════════

-- depot_counter: composite PK
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'depot_counter' AND constraint_type = 'PRIMARY KEY' AND constraint_name = 'depot_counter_pkey') THEN
    ALTER TABLE depot_counter DROP CONSTRAINT depot_counter_pkey;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'depot_counter' AND constraint_type = 'PRIMARY KEY' AND constraint_name = 'depot_counter_pkey') THEN
    ALTER TABLE depot_counter ADD CONSTRAINT depot_counter_pkey PRIMARY KEY (id, user_id);
  END IF;
END $$;

-- code_counter: composite PK
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'code_counter' AND constraint_type = 'PRIMARY KEY' AND constraint_name = 'code_counter_pkey') THEN
    ALTER TABLE code_counter DROP CONSTRAINT code_counter_pkey;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'code_counter' AND constraint_type = 'PRIMARY KEY' AND constraint_name = 'code_counter_pkey') THEN
    ALTER TABLE code_counter ADD CONSTRAINT code_counter_pkey PRIMARY KEY (id, user_id);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════
-- 7. DROP all old anon policies
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "anon_select_clients" ON clients;
DROP POLICY IF EXISTS "anon_insert_clients" ON clients;
DROP POLICY IF EXISTS "anon_update_clients" ON clients;
DROP POLICY IF EXISTS "anon_delete_clients" ON clients;

DROP POLICY IF EXISTS "anon_select_types_traitement" ON types_traitement;
DROP POLICY IF EXISTS "anon_insert_types_traitement" ON types_traitement;
DROP POLICY IF EXISTS "anon_update_types_traitement" ON types_traitement;
DROP POLICY IF EXISTS "anon_delete_types_traitement" ON types_traitement;

DROP POLICY IF EXISTS "anon_select_articles" ON articles;
DROP POLICY IF EXISTS "anon_insert_articles" ON articles;
DROP POLICY IF EXISTS "anon_update_articles" ON articles;
DROP POLICY IF EXISTS "anon_delete_articles" ON articles;

DROP POLICY IF EXISTS "anon_select_depots" ON depots;
DROP POLICY IF EXISTS "anon_insert_depots" ON depots;
DROP POLICY IF EXISTS "anon_update_depots" ON depots;
DROP POLICY IF EXISTS "anon_delete_depots" ON depots;

DROP POLICY IF EXISTS "anon_select_depot_articles" ON depot_articles;
DROP POLICY IF EXISTS "anon_insert_depot_articles" ON depot_articles;
DROP POLICY IF EXISTS "anon_update_depot_articles" ON depot_articles;
DROP POLICY IF EXISTS "anon_delete_depot_articles" ON depot_articles;

DROP POLICY IF EXISTS "anon_select_depot_avances" ON depot_avances;
DROP POLICY IF EXISTS "anon_insert_depot_avances" ON depot_avances;
DROP POLICY IF EXISTS "anon_update_depot_avances" ON depot_avances;
DROP POLICY IF EXISTS "anon_delete_depot_avances" ON depot_avances;

DROP POLICY IF EXISTS "anon_select_modes_reglement" ON modes_reglement;
DROP POLICY IF EXISTS "anon_insert_modes_reglement" ON modes_reglement;
DROP POLICY IF EXISTS "anon_update_modes_reglement" ON modes_reglement;
DROP POLICY IF EXISTS "anon_delete_modes_reglement" ON modes_reglement;

DROP POLICY IF EXISTS "anon_select_entreprise" ON entreprise;
DROP POLICY IF EXISTS "anon_insert_entreprise" ON entreprise;
DROP POLICY IF EXISTS "anon_update_entreprise" ON entreprise;
DROP POLICY IF EXISTS "anon_delete_entreprise" ON entreprise;

DROP POLICY IF EXISTS "anon_select_depot_counter" ON depot_counter;
DROP POLICY IF EXISTS "anon_update_depot_counter" ON depot_counter;

DROP POLICY IF EXISTS "anon_select_code_counter" ON code_counter;
DROP POLICY IF EXISTS "anon_update_code_counter" ON code_counter;

DROP POLICY IF EXISTS "insert_depot_counter_authenticated" ON depot_counter;
DROP POLICY IF EXISTS "insert_code_counter_authenticated" ON code_counter;

-- ═══════════════════════════════════════════════════════════
-- 8. CREATE new authenticated-only, owner-scoped policies
-- ═══════════════════════════════════════════════════════════

-- clients
CREATE POLICY "select_own_clients" ON clients FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_clients" ON clients FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own_clients" ON clients FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_clients" ON clients FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- types_traitement
CREATE POLICY "select_own_types_traitement" ON types_traitement FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_types_traitement" ON types_traitement FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own_types_traitement" ON types_traitement FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_types_traitement" ON types_traitement FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- articles
CREATE POLICY "select_own_articles" ON articles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_articles" ON articles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own_articles" ON articles FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_articles" ON articles FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- depots
CREATE POLICY "select_own_depots" ON depots FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_depots" ON depots FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own_depots" ON depots FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_depots" ON depots FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- depot_articles
CREATE POLICY "select_own_depot_articles" ON depot_articles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_depot_articles" ON depot_articles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own_depot_articles" ON depot_articles FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_depot_articles" ON depot_articles FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- depot_avances
CREATE POLICY "select_own_depot_avances" ON depot_avances FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_depot_avances" ON depot_avances FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own_depot_avances" ON depot_avances FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_depot_avances" ON depot_avances FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- modes_reglement
CREATE POLICY "select_own_modes_reglement" ON modes_reglement FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_modes_reglement" ON modes_reglement FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own_modes_reglement" ON modes_reglement FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_modes_reglement" ON modes_reglement FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- entreprise
CREATE POLICY "select_own_entreprise" ON entreprise FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_entreprise" ON entreprise FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own_entreprise" ON entreprise FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_entreprise" ON entreprise FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- depot_counter
CREATE POLICY "select_own_depot_counter" ON depot_counter FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_depot_counter" ON depot_counter FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own_depot_counter" ON depot_counter FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- code_counter
CREATE POLICY "select_own_code_counter" ON code_counter FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_code_counter" ON code_counter FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own_code_counter" ON code_counter FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════
-- 9. Rewrite code generation functions to be per-user
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.generate_client_code()
RETURNS text AS $$
DECLARE
  next_num integer;
  uid uuid := auth.uid();
BEGIN
  INSERT INTO code_counter (id, user_id, client_counter, article_counter, traitement_counter)
  VALUES (1, uid, 0, 0, 0)
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
BEGIN
  INSERT INTO code_counter (id, user_id, client_counter, article_counter, traitement_counter)
  VALUES (1, uid, 0, 0, 0)
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
BEGIN
  INSERT INTO code_counter (id, user_id, client_counter, article_counter, traitement_counter)
  VALUES (1, uid, 0, 0, 0)
  ON CONFLICT (id, user_id) DO NOTHING;

  UPDATE code_counter SET traitement_counter = traitement_counter + 1
  WHERE id = 1 AND user_id = uid
  RETURNING traitement_counter INTO next_num;

  RETURN 'T-' || lpad(next_num::text, 4, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.generate_client_code() TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_article_code() TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_traitement_code() TO authenticated;

-- ═══════════════════════════════════════════════════════════
-- 10. Indexes on user_id
-- ═══════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_clients_user_id ON clients(user_id);
CREATE INDEX IF NOT EXISTS idx_types_traitement_user_id ON types_traitement(user_id);
CREATE INDEX IF NOT EXISTS idx_articles_user_id ON articles(user_id);
CREATE INDEX IF NOT EXISTS idx_depots_user_id ON depots(user_id);
CREATE INDEX IF NOT EXISTS idx_depot_articles_user_id ON depot_articles(user_id);
CREATE INDEX IF NOT EXISTS idx_depot_avances_user_id ON depot_avances(user_id);
CREATE INDEX IF NOT EXISTS idx_modes_reglement_user_id ON modes_reglement(user_id);
CREATE INDEX IF NOT EXISTS idx_entreprise_user_id ON entreprise(user_id);
