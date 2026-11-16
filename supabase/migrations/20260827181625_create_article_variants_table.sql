/*
# Add article_variants table

## Overview
An article can now have one or more variants, each with its own processing
price (prix_traitement). This lets a pressing define e.g. "Chemise" with
variants "Lavage simple" at 500 FCFA and "Lavage + repassage" at 800 FCFA.

## Changes
1. New table `article_variants`:
   - id (uuid, primary key)
   - article_id (uuid, FK to articles, ON DELETE CASCADE)
   - designation (text, not null) — variant name, e.g. "Lavage simple"
   - prix_traitement (numeric, not null) — processing price for this variant
   - created_at (timestamptz, default now())
   - tenant_id (uuid, not null, default auth.uid()) — for tenant isolation
   - user_id (uuid, not null, default auth.uid()) — owner

2. Backfill: for each existing article, create a default variant named
   "Standard" with prix_traitement = the article's prix_unitaire, so existing
   data still works and no article is left without variants.

3. Security: RLS enabled with tenant-scoped policies (is_tenant_member),
   matching all other business tables.
*/

CREATE TABLE IF NOT EXISTS article_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  designation text NOT NULL,
  prix_traitement numeric NOT NULL DEFAULT 0,
  tenant_id uuid NOT NULL DEFAULT auth.uid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_article_variants_article_id ON article_variants(article_id);
CREATE INDEX IF NOT EXISTS idx_article_variants_tenant_id ON article_variants(tenant_id);

ALTER TABLE article_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_tenant_article_variants" ON article_variants;
CREATE POLICY "select_tenant_article_variants" ON article_variants FOR SELECT
  TO authenticated USING (is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "insert_tenant_article_variants" ON article_variants;
CREATE POLICY "insert_tenant_article_variants" ON article_variants FOR INSERT
  TO authenticated WITH CHECK (is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "update_tenant_article_variants" ON article_variants;
CREATE POLICY "update_tenant_article_variants" ON article_variants FOR UPDATE
  TO authenticated USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "delete_tenant_article_variants" ON article_variants;
CREATE POLICY "delete_tenant_article_variants" ON article_variants FOR DELETE
  TO authenticated USING (is_tenant_member(tenant_id));

-- Backfill: create a "Standard" variant for every existing article
INSERT INTO article_variants (article_id, designation, prix_traitement, tenant_id, user_id)
SELECT id, 'Standard', prix_unitaire, tenant_id, user_id FROM articles
WHERE NOT EXISTS (SELECT 1 FROM article_variants av WHERE av.article_id = articles.id);
