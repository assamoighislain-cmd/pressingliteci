-- Add traitement_counter to code_counter for generating unique traitement codes
ALTER TABLE code_counter ADD COLUMN IF NOT EXISTS traitement_counter integer NOT NULL DEFAULT 0;

-- Atomic code generation function for types_traitement
CREATE OR REPLACE FUNCTION public.generate_traitement_code()
RETURNS text AS $$
DECLARE
  next_num integer;
BEGIN
  UPDATE code_counter SET traitement_counter = traitement_counter + 1 WHERE id = 1
    RETURNING traitement_counter INTO next_num;
  RETURN 'T-' || lpad(next_num::text, 4, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.generate_traitement_code() TO anon, authenticated;