-- Atomic code generation functions
CREATE OR REPLACE FUNCTION public.generate_article_code()
RETURNS text AS $$
DECLARE
  next_num integer;
BEGIN
  UPDATE code_counter SET article_counter = article_counter + 1 WHERE id = 1
    RETURNING article_counter INTO next_num;
  RETURN 'A-' || lpad(next_num::text, 4, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.generate_client_code()
RETURNS text AS $$
DECLARE
  next_num integer;
BEGIN
  UPDATE code_counter SET client_counter = client_counter + 1 WHERE id = 1
    RETURNING client_counter INTO next_num;
  RETURN 'C-' || lpad(next_num::text, 4, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.generate_article_code() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_client_code() TO anon, authenticated;