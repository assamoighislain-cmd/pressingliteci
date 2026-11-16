/*
# Fix generate_traitement_code for non-admin users

## Problem
Same issue as generate_client_code and generate_article_code: the UPDATE
uses `WHERE id = 1 AND user_id = uid`, which fails for non-admin team members.

## Fix
Use tenant_id in the UPDATE, matching the pattern from increment_depot_counter.
*/

CREATE OR REPLACE FUNCTION public.generate_traitement_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  next_num integer;
  uid uuid := auth.uid();
  t_id uuid;
BEGIN
  t_id := public.get_tenant_id();

  INSERT INTO code_counter (id, user_id, tenant_id, client_counter, article_counter, traitement_counter)
  VALUES (1, uid, t_id, 0, 0, 0)
  ON CONFLICT (id, user_id) DO NOTHING;

  UPDATE code_counter SET traitement_counter = traitement_counter + 1
  WHERE id = 1 AND tenant_id = t_id
  RETURNING traitement_counter INTO next_num;

  IF next_num IS NULL THEN
    UPDATE code_counter SET traitement_counter = traitement_counter + 1
    WHERE id = 1 AND tenant_id = t_id AND user_id <> uid
    RETURNING traitement_counter INTO next_num;
  END IF;

  RETURN 'T-' || lpad(next_num::text, 4, '0');
END;
$function$;
