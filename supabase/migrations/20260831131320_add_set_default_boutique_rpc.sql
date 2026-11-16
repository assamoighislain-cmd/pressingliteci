/*
# Add set_default_boutique RPC function

## Purpose
Sets one boutique as the default for the current tenant, unsetting any previous default.
This ensures only one boutique is the default at a time.

## Functions
- `set_default_boutique(boutique_id uuid)` — SECURITY DEFINER, granted to authenticated.
  Verifies the boutique belongs to the caller's tenant, then sets is_default=true on the
  given boutique and is_default=false on all others for the same tenant.
*/

CREATE OR REPLACE FUNCTION set_default_boutique(boutique_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO b_tenant_id FROM boutiques WHERE id = boutique_id;
  IF b_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Boutique not found';
  END IF;
  IF b_tenant_id != get_tenant_id() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE boutiques SET is_default = false WHERE tenant_id = b_tenant_id AND id != boutique_id;
  UPDATE boutiques SET is_default = true WHERE id = boutique_id;
END;
$$;

GRANT EXECUTE ON FUNCTION set_default_boutique(uuid) TO authenticated;
