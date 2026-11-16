/*
# Fix entreprise.id to use proper sequence instead of default value 1

The entreprise table had id defaulting to constant 1, causing duplicate key
violations on every insert after the first. Switch to a proper sequence.
*/

-- Create a sequence for entreprise.id
CREATE SEQUENCE IF NOT EXISTS public.entreprise_id_seq
  AS integer
  START WITH 2
  OWNED BY public.entreprise.id;

-- Set the default to nextval
ALTER TABLE public.entreprise ALTER COLUMN id SET DEFAULT nextval('public.entreprise_id_seq');

-- Set the sequence to max(id) + 1 so it doesn't conflict
SELECT setval('public.entreprise_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM public.entreprise), 1));
