/*
# Super Admin: Join Request Management

## Purpose
The Super Admin page needs to show pending join requests and allow the super admin
to approve or reject them. Currently, join requests are only visible to the
tenant admin via `approve_join_request` / `reject_join_request` RPC functions
which check `is_tenant_admin()`. The super admin cannot see or manage these
requests, making users who signed up with an existing company name invisible.

## Changes
1. New RPC function `super_admin_approve_join_request(p_request_id uuid)`:
   - Verifies caller is a super admin via `is_super_admin()`.
   - Adds the user to `entreprise_members` with their requested role.
   - Marks the join request as approved with reviewed_at/reviewed_by.

2. New RPC function `super_admin_reject_join_request(p_request_id uuid)`:
   - Verifies caller is a super admin via `is_super_admin()`.
   - Marks the join request as rejected with reviewed_at/reviewed_by.

3. RLS policy on `join_requests`:
   - Super admins can SELECT all join requests.
   - (Existing tenant-scoped policies remain unchanged.)

## Security
- Both new functions are SECURITY DEFINER with search_path = public, extensions.
- Both check `is_super_admin()` before acting.
- New SELECT policy scoped to super admin only.
*/;

-- Super admin: approve a join request
CREATE OR REPLACE FUNCTION public.super_admin_approve_join_request(p_request_id uuid)
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
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Seul le super-administrateur peut effectuer cette action';
  END IF;

  SELECT tenant_id, user_id, requested_role, full_name, contact
  INTO v_tenant_id, v_user_id, v_role, v_full_name, v_contact
  FROM public.join_requests
  WHERE id = p_request_id AND status = 'pending';

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Demande introuvable ou déjà traitée';
  END IF;

  INSERT INTO public.entreprise_members (tenant_id, user_id, role, full_name, contact)
  VALUES (v_tenant_id, v_user_id, v_role, v_full_name, v_contact)
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role, full_name = EXCLUDED.full_name, contact = EXCLUDED.contact;

  UPDATE public.join_requests
  SET status = 'approved', reviewed_at = now(), reviewed_by = auth.uid()
  WHERE id = p_request_id;
END;
$$;

-- Super admin: reject a join request
CREATE OR REPLACE FUNCTION public.super_admin_reject_join_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Seul le super-administrateur peut effectuer cette action';
  END IF;

  UPDATE public.join_requests
  SET status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid()
  WHERE id = p_request_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demande introuvable ou déjà traitée';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.super_admin_approve_join_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_reject_join_request(uuid) TO authenticated;

-- RLS: super admin can read all join requests
DROP POLICY IF EXISTS "super_admin_select_join_requests" ON join_requests;
CREATE POLICY "super_admin_select_join_requests"
ON join_requests FOR SELECT
TO authenticated
USING (public.is_super_admin());
