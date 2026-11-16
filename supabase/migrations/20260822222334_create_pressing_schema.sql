/*
# Create PressingLite schema (single-tenant, no auth)

## Overview
PressingLite is a laundry management system. The core workflow:
- DEPOT: Create a deposit (facture) for a client with one or more articles, each with a treatment type and quantity. The total is calculated using treatment coefficients. A payment mode is assigned.
- RETRAIT: Verify whether a deposit has been picked up and mark it as retrieved.

## Treatment Types
Three treatment types, each with a coefficient that multiplies the article's unit price:
- NORMAL (coefficient 1.0): standard processing
- EXPRESS (coefficient 1.5): same-day express processing
- EXPRESS_LENDemain (coefficient 1.25): express processing for the next day

## Payment Modes
Three payment modes:
- AVANCE: partial payment made at deposit time (advance amount recorded)
- SOLDE: fully paid at deposit time
- PAYER_DEPOT: payment made at deposit time

## New Tables

### `clients`
- `id` (uuid, primary key)
- `nom` (text, not null) — client name
- `telephone` (text) — phone number
- `created_at` (timestamptz, default now)

### `depots`
- `id` (uuid, primary key)
- `numero` (text, unique, not null) — human-readable deposit number (e.g. D-0001)
- `client_id` (uuid, foreign key to clients.id)
- `statut` (text, not null, default 'EN_COURS') — EN_COURS or RETIRE
- `mode_reglement` (text, not null) — AVANCE, SOLDE, or PAYER_DEPOT
- `avance_amount` (numeric, default 0) — advance payment amount (used when mode is AVANCE)
- `total` (numeric, not null, default 0) — calculated total of all articles
- `date_depot` (timestamptz, default now) — deposit date
- `date_retrait` (timestamptz) — pickup date (null until retrieved)
- `notes` (text) — optional notes
- `created_at` (timestamptz, default now)

### `depot_articles`
- `id` (uuid, primary key)
- `depot_id` (uuid, foreign key to depots.id, on delete cascade)
- `designation` (text, not null) — article description (e.g. "Chemise", "Pantalon")
- `prix_unitaire` (numeric, not null) — unit price before coefficient
- `quantite` (integer, not null, default 1)
- `traitement` (text, not null) — NORMAL, EXPRESS, or EXPRESS_LENDemain
- `coefficient` (numeric, not null) — coefficient at time of deposit (historical)
- `prix_total` (numeric, not null) — prix_unitaire * coefficient * quantite
- `created_at` (timestamptz, default now)

## Security
- Enable RLS on all tables.
- Single-tenant app with no sign-in: allow anon + authenticated full CRUD on all tables.
- USING (true) is acceptable here because the data is intentionally shared (no auth).

## Important Notes
1. A sequence-like counter table `depot_counter` is created to generate sequential deposit numbers (D-0001, D-0002, ...). This is updated atomically.
2. The `prix_total` on each article is stored at deposit time so historical pricing is preserved even if coefficients change later.
3. The `depots.total` is the sum of all article `prix_total` values, stored at deposit time.
*/

CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom text NOT NULL,
  telephone text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_clients" ON clients;
CREATE POLICY "anon_select_clients" ON clients FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_clients" ON clients;
CREATE POLICY "anon_insert_clients" ON clients FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_clients" ON clients;
CREATE POLICY "anon_update_clients" ON clients FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_clients" ON clients;
CREATE POLICY "anon_delete_clients" ON clients FOR DELETE
  TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS depots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero text UNIQUE NOT NULL,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  statut text NOT NULL DEFAULT 'EN_COURS',
  mode_reglement text NOT NULL,
  avance_amount numeric(12,2) DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,
  date_depot timestamptz DEFAULT now(),
  date_retrait timestamptz,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE depots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_depots" ON depots;
CREATE POLICY "anon_select_depots" ON depots FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_depots" ON depots;
CREATE POLICY "anon_insert_depots" ON depots FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_depots" ON depots;
CREATE POLICY "anon_update_depots" ON depots FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_depots" ON depots;
CREATE POLICY "anon_delete_depots" ON depots FOR DELETE
  TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS depot_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  depot_id uuid NOT NULL REFERENCES depots(id) ON DELETE CASCADE,
  designation text NOT NULL,
  prix_unitaire numeric(12,2) NOT NULL,
  quantite integer NOT NULL DEFAULT 1,
  traitement text NOT NULL,
  coefficient numeric(4,2) NOT NULL,
  prix_total numeric(12,2) NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE depot_articles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_depot_articles" ON depot_articles;
CREATE POLICY "anon_select_depot_articles" ON depot_articles FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_depot_articles" ON depot_articles;
CREATE POLICY "anon_insert_depot_articles" ON depot_articles FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_depot_articles" ON depot_articles;
CREATE POLICY "anon_update_depot_articles" ON depot_articles FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_depot_articles" ON depot_articles;
CREATE POLICY "anon_delete_depot_articles" ON depot_articles FOR DELETE
  TO anon, authenticated USING (true);

-- Counter table for sequential deposit numbers
CREATE TABLE IF NOT EXISTS depot_counter (
  id integer PRIMARY KEY DEFAULT 1,
  counter integer NOT NULL DEFAULT 0
);

INSERT INTO depot_counter (id, counter) VALUES (1, 0)
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE depot_counter ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_depot_counter" ON depot_counter;
CREATE POLICY "anon_select_depot_counter" ON depot_counter FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_update_depot_counter" ON depot_counter;
CREATE POLICY "anon_update_depot_counter" ON depot_counter FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_depots_client_id ON depots(client_id);
CREATE INDEX IF NOT EXISTS idx_depots_statut ON depots(statut);
CREATE INDEX IF NOT EXISTS idx_depot_articles_depot_id ON depot_articles(depot_id);
CREATE INDEX IF NOT EXISTS idx_clients_nom ON clients(nom);
