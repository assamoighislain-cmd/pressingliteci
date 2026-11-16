/*
# Add portal catalog function

1. New Functions
- `portal_get_catalog(e_id int)` — SECURITY DEFINER function that returns all articles
  for the entreprise matching the given id. Callable by anon so the client portal
  (which has no authenticated session) can display the catalog for ordering.

2. Security
- Only returns articles belonging to the specified entreprise (via tenant_id match).
- Callable by anon and authenticated.
*/

CREATE OR REPLACE FUNCTION public.portal_get_catalog(e_id int)
RETURNS TABLE (
  id uuid,
  designation text,
  prix_unitaire numeric,
  nb_pieces int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT user_id INTO v_tenant_id FROM entreprise WHERE id = e_id LIMIT 1;
  IF v_tenant_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT a.id, a.designation, a.prix_unitaire, a.nb_pieces
  FROM articles a
  WHERE a.tenant_id = v_tenant_id
  ORDER BY a.designation;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_get_catalog(int) TO anon, authenticated;
