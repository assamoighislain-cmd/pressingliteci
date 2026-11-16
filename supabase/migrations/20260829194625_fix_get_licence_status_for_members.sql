/*
# Fix get_licence_status for team members

## Problem
The function `get_licence_status()` declared `v_entreprise_id` as `integer`,
but then tried to assign `em.tenant_id` (a `uuid`) into it. PostgreSQL cannot
cast uuid → integer, so the assignment silently left the variable NULL,
causing the function to return no rows for team members (non-admin users).
The app interpreted the empty result as "Licence expirée".

## Fix
- Use a separate `v_tenant_id uuid` variable for the tenant lookup.
- Flow: try entreprise by user_id → if NULL, get tenant_id from
  entreprise_members → look up entreprise.id by user_id = tenant_id.

## No new tables or columns.
*/

CREATE OR REPLACE FUNCTION public.get_licence_status()
RETURNS TABLE (
  id uuid,
  entreprise_id integer,
  cle_licence text,
  date_debut date,
  date_fin date,
  statut text,
  type_licence text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_entreprise_id integer;
  v_tenant_id uuid;
BEGIN
  -- Try: user is the entreprise owner
  SELECT e.id INTO v_entreprise_id
  FROM public.entreprise e
  WHERE e.user_id = auth.uid()
  LIMIT 1;

  IF v_entreprise_id IS NULL THEN
    -- Try: user is a team member
    SELECT em.tenant_id INTO v_tenant_id
    FROM public.entreprise_members em
    WHERE em.user_id = auth.uid()
    LIMIT 1;

    IF v_tenant_id IS NULL THEN
      RETURN;
    END IF;

    -- Resolve the integer entreprise id from the tenant uuid
    SELECT e.id INTO v_entreprise_id
    FROM public.entreprise e
    WHERE e.user_id = v_tenant_id
    LIMIT 1;

    IF v_entreprise_id IS NULL THEN
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
  SELECT l.id, l.entreprise_id, l.cle_licence, l.date_debut, l.date_fin, l.statut, l.type_licence, l.created_at
  FROM public.licences l
  WHERE l.entreprise_id = v_entreprise_id
    AND l.statut = 'active'
    AND l.date_fin >= CURRENT_DATE
  ORDER BY l.created_at DESC
  LIMIT 1;
END;
$$;
