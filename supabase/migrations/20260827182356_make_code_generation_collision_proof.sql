/*
# Make code generation collision-proof

The per-tenant unique index fixes the root cause, but existing counters
may still produce codes that collide with manually-created entries within
the same tenant. Rewrite the functions to retry on collision by checking
existing codes and skipping ahead.
*/

CREATE OR REPLACE FUNCTION public.generate_article_code()
RETURNS text AS $$
DECLARE
  uid uuid := auth.uid();
  tid uuid;
  next_num integer;
  code_str text;
BEGIN
  SELECT tenant_id INTO tid FROM code_counter WHERE id = 1 AND user_id = uid;
  IF tid IS NULL THEN
    tid := uid;
  END IF;

  INSERT INTO code_counter (id, user_id, tenant_id, client_counter, article_counter, traitement_counter)
  VALUES (1, uid, tid, 0, 0, 0)
  ON CONFLICT (id, user_id) DO NOTHING;

  LOOP
    UPDATE code_counter SET article_counter = article_counter + 1
    WHERE id = 1 AND user_id = uid
    RETURNING article_counter INTO next_num;

    code_str := 'A-' || lpad(next_num::text, 4, '0');

    IF NOT EXISTS (SELECT 1 FROM articles WHERE code = code_str AND tenant_id = tid) THEN
      EXIT;
    END IF;
  END LOOP;

  RETURN code_str;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.generate_client_code()
RETURNS text AS $$
DECLARE
  uid uuid := auth.uid();
  tid uuid;
  next_num integer;
  code_str text;
BEGIN
  SELECT tenant_id INTO tid FROM code_counter WHERE id = 1 AND user_id = uid;
  IF tid IS NULL THEN
    tid := uid;
  END IF;

  INSERT INTO code_counter (id, user_id, tenant_id, client_counter, article_counter, traitement_counter)
  VALUES (1, uid, tid, 0, 0, 0)
  ON CONFLICT (id, user_id) DO NOTHING;

  LOOP
    UPDATE code_counter SET client_counter = client_counter + 1
    WHERE id = 1 AND user_id = uid
    RETURNING client_counter INTO next_num;

    code_str := 'C-' || lpad(next_num::text, 4, '0');

    IF NOT EXISTS (SELECT 1 FROM clients WHERE code = code_str AND tenant_id = tid) THEN
      EXIT;
    END IF;
  END LOOP;

  RETURN code_str;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.generate_article_code() TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_client_code() TO authenticated;
