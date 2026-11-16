/*
# Add source column to clients table

1. New Columns
- `clients.source` (text, nullable) — indicates how the client was created.
  Values: 'pressing' (created by staff in the shop) or 'portal' (self-registered from the client portal).
  Defaults to 'pressing' for all existing clients.

2. Modified Functions
- `portal_signup()` — now sets `source = 'portal'` on the newly created client row.

3. Security
- No new policies needed. The column is set automatically by the application/portal functions.
*/

ALTER TABLE clients ADD COLUMN IF NOT EXISTS source text DEFAULT 'pressing';

-- Backfill existing clients
UPDATE clients SET source = 'pressing' WHERE source IS NULL;

-- Update portal_signup to set source = 'portal'
CREATE OR REPLACE FUNCTION public.portal_signup(p_nom text, p_telephone text, e_id int)
RETURNS TABLE (portal_code text, client_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ent RECORD;
  v_boutique_id uuid;
  v_client_id uuid;
  v_code text;
BEGIN
  SELECT e.user_id, e.id INTO v_ent
  FROM entreprise e
  WHERE e.id = e_id;

  IF v_ent.user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_entreprise';
  END IF;

  IF TRIM(p_nom) = '' THEN
    RAISE EXCEPTION 'name_required';
  END IF;

  SELECT b.id INTO v_boutique_id
  FROM boutiques b
  WHERE b.tenant_id = v_ent.user_id AND b.is_default = true
  LIMIT 1;

  IF v_boutique_id IS NULL THEN
    SELECT b.id INTO v_boutique_id
    FROM boutiques b
    WHERE b.tenant_id = v_ent.user_id
    ORDER BY b.created_at ASC
    LIMIT 1;
  END IF;

  INSERT INTO clients (nom, telephone, tenant_id, user_id, boutique_id, taux_remise, source)
  VALUES (TRIM(p_nom), NULLIF(TRIM(p_telephone), ''), v_ent.user_id, v_ent.user_id, v_boutique_id, 0, 'portal')
  RETURNING id, portal_code INTO v_client_id, v_code;

  RETURN QUERY SELECT v_code, v_client_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.portal_signup(text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_signup(text, text, int) TO anon, authenticated;
