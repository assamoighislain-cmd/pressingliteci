/*
# Add atomic increment_depot_counter function

## Problem
The depot counter was updated via a client-side read-increment-upsert pattern.
The upsert sent `{ id: 1, counter: value }` without `user_id`, causing
"null value in column user_id violates not-null constraint" because the
composite primary key is (id, user_id) and the client couldn't resolve the
correct owner row.

## Fix
Create a SECURITY DEFINER function `increment_depot_counter()` that:
1. Resolves the caller's tenant_id via get_tenant_id().
2. Inserts a counter row (id=1, user_id=caller, tenant_id, counter=0) if none exists.
3. Atomically increments the counter and returns the new value.

This mirrors the existing generate_client_code / generate_article_code pattern.

## Security
- SECURITY DEFINER so it can write to depot_counter regardless of RLS.
- Granted to authenticated only (app requires sign-in).
*/

CREATE OR REPLACE FUNCTION public.increment_depot_counter()
RETURNS integer AS $$
DECLARE
  next_num integer;
  uid uuid := auth.uid();
  t_id uuid;
BEGIN
  t_id := public.get_tenant_id();
  IF t_id IS NULL THEN
    RAISE EXCEPTION 'Aucune entreprise trouvée';
  END IF;

  INSERT INTO depot_counter (id, counter, user_id, tenant_id)
  VALUES (1, 0, uid, t_id)
  ON CONFLICT (id, user_id) DO NOTHING;

  UPDATE depot_counter SET counter = counter + 1
  WHERE id = 1 AND user_id = uid
  RETURNING counter INTO next_num;

  RETURN next_num;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.increment_depot_counter() TO authenticated;
