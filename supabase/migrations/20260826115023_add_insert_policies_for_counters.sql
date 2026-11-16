-- Add missing INSERT policies for depot_counter and code_counter
-- These tables had SELECT + UPDATE policies but no INSERT policy,
-- causing upsert operations to fail with RLS violations.

CREATE POLICY "anon_insert_depot_counter"
  ON depot_counter FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "anon_insert_code_counter"
  ON code_counter FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
