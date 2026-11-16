/*
# Create depenses (expenses) table

## Overview
Allows the pressing shop owner to record business-related expenses (e.g. supplies,
rent, salaries, utilities) so they can be tracked alongside revenue in the
comptabilite (accounting) view.

## New Tables
### `depenses`
- `id` (uuid, primary key, auto-generated)
- `date_depense` (timestamptz, NOT NULL, default now) — date the expense was incurred
- `libelle` (text, NOT NULL) — short description / label of the expense
- `categorie` (text) — optional category (e.g. "Loyer", "Salaires", "Produits", "Transport")
- `montant` (numeric(12,2), NOT NULL) — amount spent
- `mode_reglement` (text) — optional payment method label
- `notes` (text) — optional additional notes
- `user_id` (uuid, NOT NULL, default auth.uid()) — owner of the expense
- `created_at` (timestamptz, default now)

## Security
- Enable RLS on `depenses`.
- Owner-scoped CRUD: each authenticated user can only access their own expenses.
- 4 separate policies (SELECT, INSERT, UPDATE, DELETE) scoped to `auth.uid() = user_id`.
*/

CREATE TABLE IF NOT EXISTS depenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date_depense timestamptz NOT NULL DEFAULT now(),
  libelle text NOT NULL,
  categorie text,
  montant numeric(12,2) NOT NULL,
  mode_reglement text,
  notes text,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE depenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_depenses" ON depenses;
CREATE POLICY "select_own_depenses" ON depenses FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_depenses" ON depenses;
CREATE POLICY "insert_own_depenses" ON depenses FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_depenses" ON depenses;
CREATE POLICY "update_own_depenses" ON depenses FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_depenses" ON depenses;
CREATE POLICY "delete_own_depenses" ON depenses FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_depenses_user_id ON depenses(user_id);
CREATE INDEX IF NOT EXISTS idx_depenses_date ON depenses(date_depense DESC);
