/*
# Add boutiques (multi-shop) support

## Purpose
Allows an enterprise (pressing company) to have multiple boutiques (shops/locations).
When a new enterprise is created via signup, a default boutique is created automatically.
All business data (depots, clients, articles, etc.) is scoped to a specific boutique.

## New Tables
- `boutiques`
  - `id` (uuid, primary key)
  - `tenant_id` (uuid, FK to entreprise.user_id) — the enterprise this boutique belongs to
  - `nom` (text, not null) — boutique name
  - `adresse` (text, nullable) — boutique address
  - `ville` (text, nullable) — city
  - `telephone` (text, nullable) — phone number
  - `is_default` (boolean, default false) — marks the default boutique
  - `slug` (text, nullable) — URL-friendly identifier for future portal
  - `created_at` (timestamptz, default now())
  - `updated_at` (timestamptz, default now())

## Modified Tables
- `depots` — added `boutique_id` (uuid, nullable, FK to boutiques.id)
- `depot_articles` — added `boutique_id` (uuid, nullable, FK to boutiques.id)
- `depot_avances` — added `boutique_id` (uuid, nullable, FK to boutiques.id)
- `clients` — added `boutique_id` (uuid, nullable, FK to boutiques.id)
- `articles` — added `boutique_id` (uuid, nullable, FK to boutiques.id)
- `article_variants` — added `boutique_id` (uuid, nullable, FK to boutiques.id)
- `types_traitement` — added `boutique_id` (uuid, nullable, FK to boutiques.id)
- `modes_reglement` — added `boutique_id` (uuid, nullable, FK to boutiques.id)
- `depenses` — added `boutique_id` (uuid, nullable, FK to boutiques.id)
- `depense_categories` — added `boutique_id` (uuid, nullable, FK to boutiques.id)

Note: `boutique_id` is nullable so existing data is not lost. New records will set it.
The depot_counter and code_counter tables are NOT modified — they remain per-tenant.

## Security
- RLS enabled on `boutiques` with `is_tenant_member(tenant_id)` policies (4 CRUD policies).

## Important Notes
1. A trigger `trigger_create_default_boutique` fires AFTER INSERT on `entreprise` to create
   a default boutique named "Boutique principale" with `is_default = true`.
2. A backfill script sets `boutique_id` on existing rows: creates a default boutique for each
   existing enterprise and links all existing data to it.
3. An RPC function `get_default_boutique()` returns the default boutique id for the current tenant.
*/

-- ─── Create boutiques table ──────────────────────────────
CREATE TABLE IF NOT EXISTS boutiques (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES entreprise(user_id) ON DELETE CASCADE,
  nom text NOT NULL,
  adresse text,
  ville text,
  telephone text,
  is_default boolean NOT NULL DEFAULT false,
  slug text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_boutiques_tenant ON boutiques(tenant_id);

ALTER TABLE boutiques ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_tenant_boutiques" ON boutiques;
CREATE POLICY "select_tenant_boutiques" ON boutiques FOR SELECT
  TO authenticated USING (is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "insert_tenant_boutiques" ON boutiques;
CREATE POLICY "insert_tenant_boutiques" ON boutiques FOR INSERT
  TO authenticated WITH CHECK (is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "update_tenant_boutiques" ON boutiques;
CREATE POLICY "update_tenant_boutiques" ON boutiques FOR UPDATE
  TO authenticated USING (is_tenant_member(tenant_id))
  WITH CHECK (is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "delete_tenant_boutiques" ON boutiques;
CREATE POLICY "delete_tenant_boutiques" ON boutiques FOR DELETE
  TO authenticated USING (is_tenant_member(tenant_id));

-- ─── Add boutique_id to business tables ──────────────────
DO $$ BEGIN
  ALTER TABLE depots ADD COLUMN boutique_id uuid REFERENCES boutiques(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE depot_articles ADD COLUMN boutique_id uuid REFERENCES boutiques(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE depot_avances ADD COLUMN boutique_id uuid REFERENCES boutiques(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE clients ADD COLUMN boutique_id uuid REFERENCES boutiques(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE articles ADD COLUMN boutique_id uuid REFERENCES boutiques(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE article_variants ADD COLUMN boutique_id uuid REFERENCES boutiques(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE types_traitement ADD COLUMN boutique_id uuid REFERENCES boutiques(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE modes_reglement ADD COLUMN boutique_id uuid REFERENCES boutiques(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE depenses ADD COLUMN boutique_id uuid REFERENCES boutiques(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE depense_categories ADD COLUMN boutique_id uuid REFERENCES boutiques(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_depots_boutique ON depots(boutique_id);
CREATE INDEX IF NOT EXISTS idx_clients_boutique ON clients(boutique_id);
CREATE INDEX IF NOT EXISTS idx_articles_boutique ON articles(boutique_id);

-- ─── Backfill: create default boutiques for existing enterprises ──
DO $$
DECLARE
  ent RECORD;
  b_id uuid;
BEGIN
  FOR ent IN SELECT user_id, nom FROM entreprise LOOP
    IF NOT EXISTS (SELECT 1 FROM boutiques WHERE tenant_id = ent.user_id) THEN
      INSERT INTO boutiques (tenant_id, nom, is_default)
      VALUES (ent.user_id, 'Boutique principale', true)
      RETURNING id INTO b_id;

      UPDATE depots SET boutique_id = b_id WHERE tenant_id = ent.user_id AND depots.boutique_id IS NULL;
      UPDATE depot_articles SET boutique_id = b_id WHERE tenant_id = ent.user_id AND depot_articles.boutique_id IS NULL;
      UPDATE depot_avances SET boutique_id = b_id WHERE tenant_id = ent.user_id AND depot_avances.boutique_id IS NULL;
      UPDATE clients SET boutique_id = b_id WHERE tenant_id = ent.user_id AND clients.boutique_id IS NULL;
      UPDATE articles SET boutique_id = b_id WHERE tenant_id = ent.user_id AND articles.boutique_id IS NULL;
      UPDATE article_variants SET boutique_id = b_id WHERE tenant_id = ent.user_id AND article_variants.boutique_id IS NULL;
      UPDATE types_traitement SET boutique_id = b_id WHERE tenant_id = ent.user_id AND types_traitement.boutique_id IS NULL;
      UPDATE modes_reglement SET boutique_id = b_id WHERE tenant_id = ent.user_id AND modes_reglement.boutique_id IS NULL;
      UPDATE depenses SET boutique_id = b_id WHERE tenant_id = ent.user_id AND depenses.boutique_id IS NULL;
      UPDATE depense_categories SET boutique_id = b_id WHERE tenant_id = ent.user_id AND depense_categories.boutique_id IS NULL;
    END IF;
  END LOOP;
END $$;

-- ─── Trigger: create default boutique on new enterprise signup ──
CREATE OR REPLACE FUNCTION create_default_boutique()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO boutiques (tenant_id, nom, is_default)
  VALUES (NEW.user_id, 'Boutique principale', true)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_create_default_boutique ON entreprise;
CREATE TRIGGER trigger_create_default_boutique
  AFTER INSERT ON entreprise
  FOR EACH ROW
  EXECUTE FUNCTION create_default_boutique();

-- ─── RPC: get default boutique for current tenant ──────────
CREATE OR REPLACE FUNCTION get_default_boutique()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM boutiques
  WHERE tenant_id = get_tenant_id()
  ORDER BY is_default DESC, created_at ASC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_default_boutique() TO authenticated;
