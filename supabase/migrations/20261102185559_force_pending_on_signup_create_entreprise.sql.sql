/*
# Force pending statut on signup_create_entreprise

## Purpose
When a new company self-registers via the sign-up flow, it must be created
with `statut = 'pending'` so the super admin can approve it before it becomes
active. The `handle_new_entreprise_signup` trigger already sets pending, but
the `signup_create_entreprise` RPC (called as a fallback after the trigger)
was relying on the column default (`'active'`), which could override the
trigger's pending statut on re-runs or conflict scenarios.

## Changes
1. Modified function: `signup_create_entreprise`
   - INSERT now explicitly sets `statut = 'pending'`
   - UPDATE (when entreprise already exists for this user) now sets
     `statut = 'pending'` so a re-run after a super-admin activation would
     correctly re-suspend — matching the intent that self-signup always
     starts pending.

## Security
No new grants or policy changes. Function remains SECURITY DEFINER, callable
by authenticated users.
*/

CREATE OR REPLACE FUNCTION public.signup_create_entreprise(entreprise_nom text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
uid uuid := auth.uid();
existing_entreprise record;
BEGIN
IF uid IS NULL THEN
RAISE EXCEPTION 'Utilisateur non authentifié';
END IF;

-- Check if user already has an entreprise
SELECT * INTO existing_entreprise FROM public.entreprise WHERE user_id = uid;

IF FOUND THEN
-- Update name and force pending statut
UPDATE public.entreprise
SET nom = entreprise_nom, statut = 'pending'
WHERE user_id = uid;
ELSE
-- Create entreprise with pending statut
INSERT INTO public.entreprise (user_id, nom, statut)
VALUES (uid, entreprise_nom, 'pending');
END IF;

-- Add user as admin member (upsert to handle re-runs)
INSERT INTO public.entreprise_members (tenant_id, user_id, role)
VALUES (uid, uid, 'admin')
ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'admin';
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.signup_create_entreprise(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.signup_create_entreprise(text) TO authenticated;
