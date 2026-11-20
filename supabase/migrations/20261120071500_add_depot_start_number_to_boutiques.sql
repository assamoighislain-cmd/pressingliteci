-- Add per-boutique starting deposit counter columns so each branch/boutique can enforce its own starting deposit number
ALTER TABLE public.boutiques
  ADD COLUMN IF NOT EXISTS depot_start_number integer CHECK (depot_start_number IS NULL OR depot_start_number >= 1),
  ADD COLUMN IF NOT EXISTS depot_start_year integer;

NOTIFY pgrst, 'reload schema';
