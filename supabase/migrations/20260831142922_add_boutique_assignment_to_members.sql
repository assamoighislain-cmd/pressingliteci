/*
# Assign gérants and commerciaux to a single boutique

## Purpose
Gérants and commerciaux must be locked to one boutique. Admins retain access to all boutiques.
This migration adds a `boutique_id` column to `entreprise_members` and updates the relevant
RPC functions to accept and store the boutique assignment.

## Changes

### 1. New column
- `entreprise_members.boutique_id` (uuid, nullable, references boutiques.id ON DELETE SET NULL)
  - NULL means "all boutiques" (used for admin role). For gerant/commercial, the app enforces a non-null value.

### 2. Updated functions
- `add_team_member(member_email, member_role, member_boutique_id)` — accepts optional boutique_id
- `approve_join_request(p_request_id)` — now reads `requested_boutique_id` from the join request and assigns it

### 3. Updated join_requests
- `join_requests.requested_boutique_id` (uuid, nullable, references boutiques.id ON DELETE SET NULL)
  — stores which boutique the user requested to join

### 4. New helper function
- `get_member_boutique_id()` — returns the boutique_id for the current user's entreprise_members row, or NULL for admins

## Security
- RLS already enabled on entreprise_members and join_requests; no policy changes needed since
  the new column is just data on existing rows.
*/

-- 1. Add boutique_id to entreprise_members
ALTER TABLE entreprise_members
  ADD COLUMN IF NOT EXISTS boutique_id uuid REFERENCES boutiques(id) ON DELETE SET NULL;

-- 2. Add requested_boutique_id to join_requests
ALTER TABLE join_requests
  ADD COLUMN IF NOT EXISTS requested_boutique_id uuid REFERENCES boutiques(id) ON DELETE SET NULL;

-- 3. Helper: get the current member's boutique assignment (NULL for admins = all boutiques)
CREATE OR REPLACE FUNCTION public.get_member_boutique_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_role text;
  v_boutique_id uuid;
BEGIN
  -- Admin: no boutique restriction
  SELECT 'admin' INTO v_role FROM entreprise WHERE user_id = uid LIMIT 1;
  IF v_role IS NOT NULL THEN
    RETURN NULL;
  END IF;
  -- Member: return their assigned boutique
  SELECT boutique_id INTO v_boutique_id FROM entreprise_members WHERE user_id = uid LIMIT 1;
  RETURN v_boutique_id;
END;
$function$;

-- 4. Update add_team_member to accept boutique_id
CREATE OR REPLACE FUNCTION public.add_team_member(member_email text, member_role text, member_boutique_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  t_id uuid;
  member_uid uuid;
BEGIN
  t_id := public.get_tenant_id();
  IF t_id IS NULL THEN
    RAISE EXCEPTION 'Aucune entreprise trouvée';
  END IF;

  IF NOT public.is_tenant_admin(t_id) THEN
    RAISE EXCEPTION 'Seul l''administrateur peut ajouter des membres';
  END IF;

  SELECT id INTO member_uid FROM auth.users WHERE email = member_email;
  IF member_uid IS NULL THEN
    RAISE EXCEPTION 'Utilisateur introuvable. L''utilisateur doit d''abord créer un compte.';
  END IF;

  IF member_uid = uid THEN
    RAISE EXCEPTION 'Vous êtes déjà membre de cette entreprise';
  END IF;

  INSERT INTO entreprise_members (tenant_id, user_id, role, boutique_id)
  VALUES (t_id, member_uid, member_role, member_boutique_id)
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role, boutique_id = EXCLUDED.boutique_id
  RETURNING user_id INTO member_uid;

  RETURN member_uid;
END;
$function$;

-- 5. Update approve_join_request to pass boutique_id
CREATE OR REPLACE FUNCTION public.approve_join_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_user_id uuid;
  v_role text;
  v_full_name text;
  v_contact text;
  v_boutique_id uuid;
BEGIN
  SELECT tenant_id, user_id, requested_role, full_name, contact, requested_boutique_id
  INTO v_tenant_id, v_user_id, v_role, v_full_name, v_contact, v_boutique_id
  FROM public.join_requests
  WHERE id = p_request_id AND status = 'pending';

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Demande introuvable ou déjà traitée';
  END IF;

  IF NOT public.is_tenant_admin(v_tenant_id) THEN
    RAISE EXCEPTION 'Seul l''administrateur peut approuver les demandes';
  END IF;

  INSERT INTO public.entreprise_members (tenant_id, user_id, role, full_name, contact, boutique_id)
  VALUES (v_tenant_id, v_user_id, v_role, v_full_name, v_contact, v_boutique_id)
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET
    role = EXCLUDED.role,
    full_name = EXCLUDED.full_name,
    contact = EXCLUDED.contact,
    boutique_id = EXCLUDED.boutique_id;

  UPDATE public.join_requests
  SET status = 'approved', reviewed_at = now(), reviewed_by = auth.uid()
  WHERE id = p_request_id;
END;
$function$;