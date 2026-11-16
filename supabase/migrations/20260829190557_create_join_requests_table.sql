/*
# Create join_requests table for membership approval workflow

## Purpose
When a new user signs up with an entreprise name that already exists, instead of
silently creating a duplicate entreprise or auto-adding them as a member, the system
creates a "join request" that the existing entreprise admin must approve or reject.

## New Tables
- `join_requests`
  - `id` (uuid, primary key)
  - `tenant_id` (uuid, references entreprise.user_id) — which entreprise the request targets
  - `user_id` (uuid, not null) — the user requesting to join
  - `user_email` (text, not null) — denormalized for display in admin UI
  - `full_name` (text, nullable) — name entered at signup
  - `contact` (text, nullable) — phone entered at signup
  - `requested_role` (text, default 'commercial') — role the user would like
  - `status` (text, default 'pending') — pending | approved | rejected
  - `created_at` (timestamptz, default now())
  - `reviewed_at` (timestamptz, nullable) — when admin acted
  - `reviewed_by` (uuid, nullable) — admin who acted

## Security
- RLS enabled on join_requests.
- SELECT: admins of the target tenant can see requests; users can see their own requests.
- INSERT: any authenticated user can create a request for themselves.
- UPDATE: only admins of the target tenant can update status (approve/reject).
- DELETE: only admins of the target tenant can delete.

## Unique constraint
- One pending request per (tenant_id, user_id) to prevent duplicates.
*/

CREATE TABLE IF NOT EXISTS public.join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  user_email text NOT NULL,
  full_name text,
  contact text,
  requested_role text NOT NULL DEFAULT 'commercial',
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid
);

-- Unique constraint: only one pending request per user per tenant
CREATE UNIQUE INDEX IF NOT EXISTS join_requests_pending_unique
  ON public.join_requests (tenant_id, user_id)
  WHERE status = 'pending';

ALTER TABLE public.join_requests ENABLE ROW LEVEL SECURITY;

-- SELECT: admins see all requests for their tenant; users see their own
DROP POLICY IF EXISTS "select_join_requests" ON public.join_requests;
CREATE POLICY "select_join_requests"
ON public.join_requests FOR SELECT
TO authenticated
USING (
  tenant_id = public.get_tenant_id()
  OR user_id = auth.uid()
);

-- INSERT: any authenticated user can create a request for themselves
DROP POLICY IF EXISTS "insert_join_requests" ON public.join_requests;
CREATE POLICY "insert_join_requests"
ON public.join_requests FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- UPDATE: only tenant admins can approve/reject
DROP POLICY IF EXISTS "update_join_requests" ON public.join_requests;
CREATE POLICY "update_join_requests"
ON public.join_requests FOR UPDATE
TO authenticated
USING (public.is_tenant_admin(tenant_id))
WITH CHECK (public.is_tenant_admin(tenant_id));

-- DELETE: only tenant admins can delete
DROP POLICY IF EXISTS "delete_join_requests" ON public.join_requests;
CREATE POLICY "delete_join_requests"
ON public.join_requests FOR DELETE
TO authenticated
USING (public.is_tenant_admin(tenant_id));
