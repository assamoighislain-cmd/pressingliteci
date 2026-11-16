/*
# Create entreprise table (single-tenant, no auth)

## Overview
Stores the pressing shop's business information (name, address, phone, etc.)
used on printed receipts and in the app header. Single-row table — only one
entreprise record is needed.

## New Tables

### `entreprise`
- `id` (integer, primary key, always 1) — single-row table
- `nom` (text, not null) — business name (e.g. "PressingLite")
- `adresse` (text) — street address
- `ville` (text) — city
- `telephone` (text) — phone number
- `email` (text) — email address
- `logo_url` (text) — optional logo image URL
- `slogan` (text) — optional tagline / slogan
- `created_at` (timestamptz, default now)
- `updated_at` (timestamptz, default now)

## Security
- Enable RLS on `entreprise`.
- Single-tenant app with no sign-in: allow anon + authenticated full CRUD.
- USING (true) is acceptable because the data is intentionally shared (no auth).
*/

CREATE TABLE IF NOT EXISTS entreprise (
  id integer PRIMARY KEY DEFAULT 1,
  nom text NOT NULL,
  adresse text,
  ville text,
  telephone text,
  email text,
  logo_url text,
  slogan text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Insert a default row
INSERT INTO entreprise (id, nom) VALUES (1, 'PressingLite')
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE entreprise ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_entreprise" ON entreprise;
CREATE POLICY "anon_select_entreprise" ON entreprise FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_entreprise" ON entreprise;
CREATE POLICY "anon_insert_entreprise" ON entreprise FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_entreprise" ON entreprise;
CREATE POLICY "anon_update_entreprise" ON entreprise FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_entreprise" ON entreprise;
CREATE POLICY "anon_delete_entreprise" ON entreprise FOR DELETE
  TO anon, authenticated USING (true);
