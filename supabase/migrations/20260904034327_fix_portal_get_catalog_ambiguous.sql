/*
# Fix ambiguous column reference in portal_get_catalog

The function parameter `e_id` was ambiguous with the `entreprise.id` column.
Qualify all column references with table aliases.
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
  SELECT ent.user_id INTO v_tenant_id FROM entreprise ent WHERE ent.id = e_id LIMIT 1;
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
