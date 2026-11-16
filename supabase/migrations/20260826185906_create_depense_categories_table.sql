/*
# Create depense_categories table

## Overview
Allows the pressing shop owner to create and manage custom expense categories
(e.g. "Loyer", "Salaires", "Produits & Fournitures") instead of using a hard-coded list.
Categories are per-user (owner-scoped) and can be renamed or deleted.

## New Tables
### `depense_categories`
- `id` (uuid, primary key, auto-generated)
- `libelle` (text, NOT NULL) — category name
- `user_id` (uuid, NOT NULL, default auth.uid()) — owner
- `created_at` (timestamptz, default now())

## Security
- Enable RLS on `depense_categories`.
- Owner-scoped CRUD: each authenticated user can only access their own categories.
- 4 separate policies (SELECT, INSERT, UPDATE, DELETE) scoped to `auth.uid() = user_id`.
*/

CREATE TABLE IF NOT EXISTS depense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  libelle text NOT NULL,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE depense_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_depense_categories" ON depense_categories;
CREATE POLICY "select_own_depense_categories" ON depense_categories FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_depense_categories" ON depense_categories;
CREATE POLICY "insert_own_depense_categories" ON depense_categories FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_depense_categories" ON depense_categories;
CREATE POLICY "update_own_depense_categories" ON depense_categories FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_depense_categories" ON depense_categories;
CREATE POLICY "delete_own_depense_categories" ON depense_categories FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_depense_categories_user_id ON depense_categories(user_id);
