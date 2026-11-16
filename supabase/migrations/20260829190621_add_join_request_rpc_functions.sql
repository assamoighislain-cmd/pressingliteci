/*
# Add RPC functions for approving/rejecting join requests

## Purpose
Provide server-side functions that the entreprise admin calls from the UI to
approve or reject a pending join request.

## New Functions
- `approve_join_request(p_request_id uuid)`: 
  - Verifies caller is admin of the request's tenant.
  - Sets status to 'approved', adds the user to entreprise_members.
  - Sets reviewed_at and reviewed_by.
  
- `reject_join_request(p_request_id uuid)`:
  - Verifies caller is admin of the request's tenant.
  - Sets status to 'rejected'.
  - Sets reviewed_at and reviewed_by.

## Security
- Both functions are SECURITY DEFINER with search_path = public, extensions.
- Both check is_tenant_admin before acting.
*/

CREATE OR REPLACE FUNCTION public.approve_join_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tenant_id uuid;
  v_user_id uuid;
  v_role text;
  v_full_name text;
  v_contact text;
BEGIN
  SELECT tenant_id, user_id, requested_role, full_name, contact
  INTO v_tenant_id, v_user_id, v_role, v_full_name, v_contact
  FROM public.join_requests
  WHERE id = p_request_id AND status = 'pending';

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Demande introuvable ou déjà traitée';
  END IF;

  IF NOT public.is_tenant_admin(v_tenant_id) THEN
    RAISE EXCEPTION 'Seul l''administrateur peut approuver les demandes';
  END IF;

  -- Add user to entreprise_members
  INSERT INTO public.entreprise_members (tenant_id, user_id, role, full_name, contact)
  VALUES (v_tenant_id, v_user_id, v_role, v_full_name, v_contact)
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role, full_name = EXCLUDED.full_name, contact = EXCLUDED.contact;

  -- Mark request as approved
  UPDATE public.join_requests
  SET status = 'approved', reviewed_at = now(), reviewed_by = auth.uid()
  WHERE id = p_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_join_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM public.join_requests
  WHERE id = p_request_id AND status = 'pending';

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Demande introuvable ou déjà traitée';
  END IF;

  IF NOT public.is_tenant_admin(v_tenant_id) THEN
    RAISE EXCEPTION 'Seul l''administrateur peut rejeter les demandes';
  END IF;

  UPDATE public.join_requests
  SET status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid()
  WHERE id = p_request_id;
END;
$$;
