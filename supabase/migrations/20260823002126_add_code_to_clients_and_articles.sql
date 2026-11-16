/*
# Add code column to clients and articles

## Overview
Adds a human-readable code to each client (e.g. C-0001) and each article (e.g. A-0001).
A counter table is used to generate sequential codes for new rows.

## Modified Tables

### `clients`
- `code` (text, unique) — client code like C-0001

### `articles`
- `code` (text, unique) — article code like A-0001

## New Tables

### `code_counter`
- Single-row table with two counters: client_counter and article_counter

## Security
- No policy changes. Existing CRUD policies cover the new column.
*/

-- Add code to clients
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clients' AND column_name = 'code'
  ) THEN
    ALTER TABLE clients ADD COLUMN code text;
  END IF;
END $$;

-- Add code to articles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'articles' AND column_name = 'code'
  ) THEN
    ALTER TABLE articles ADD COLUMN code text;
  END IF;
END $$;

-- Create counter table
CREATE TABLE IF NOT EXISTS code_counter (
  id integer PRIMARY KEY DEFAULT 1,
  client_counter integer NOT NULL DEFAULT 0,
  article_counter integer NOT NULL DEFAULT 0
);

INSERT INTO code_counter (id, client_counter, article_counter) VALUES (1, 0, 0)
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE code_counter ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_code_counter" ON code_counter;
CREATE POLICY "anon_select_code_counter" ON code_counter FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_update_code_counter" ON code_counter;
CREATE POLICY "anon_update_code_counter" ON code_counter FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

-- Backfill existing clients with codes
DO $$
DECLARE
  rec RECORD;
  next_num integer;
BEGIN
  SELECT client_counter INTO next_num FROM code_counter WHERE id = 1;
  FOR rec IN SELECT id FROM clients WHERE code IS NULL ORDER BY created_at LOOP
    next_num := next_num + 1;
    UPDATE clients SET code = 'C-' || lpad(next_num::text, 4, '0') WHERE id = rec.id;
  END LOOP;
  UPDATE code_counter SET client_counter = next_num WHERE id = 1;
END $$;

-- Backfill existing articles with codes
DO $$
DECLARE
  rec RECORD;
  next_num integer;
BEGIN
  SELECT article_counter INTO next_num FROM code_counter WHERE id = 1;
  FOR rec IN SELECT id FROM articles WHERE code IS NULL ORDER BY created_at LOOP
    next_num := next_num + 1;
    UPDATE articles SET code = 'A-' || lpad(next_num::text, 4, '0') WHERE id = rec.id;
  END LOOP;
  UPDATE code_counter SET article_counter = next_num WHERE id = 1;
END $$;

-- Now enforce uniqueness
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clients_code_key'
  ) THEN
    ALTER TABLE clients ADD CONSTRAINT clients_code_key UNIQUE (code);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'articles_code_key'
  ) THEN
    ALTER TABLE articles ADD CONSTRAINT articles_code_key UNIQUE (code);
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_clients_code ON clients(code);
CREATE INDEX IF NOT EXISTS idx_articles_code ON articles(code);
