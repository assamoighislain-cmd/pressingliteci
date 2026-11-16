/*
# Allow super-admin to delete an entreprise and all its data

## Overview
Adds a SECURITY DEFINER function `delete_entreprise(entreprise_id integer)` that
the super-admin can call to permanently delete an entreprise and all business
data belonging to its tenant (clients, depots, articles, etc.).

## New Functions
- `delete_entreprise(entreprise_id integer)` — deletes the entreprise row and
  cascades deletion to all tenant-scoped business tables matching the
  entreprise's `user_id`. Only callable by super-admins.

## Security
- The function checks `is_super_admin()` and raises an exception otherwise.
- Runs as SECURITY DEFINER so it can delete rows across all tenant tables
  regardless of RLS policies.
*/

CREATE OR REPLACE FUNCTION public.delete_entreprise(entreprise_id integer)
RETURNS void AS $$
DECLARE
  uid uuid := auth.uid();
  tenant_uid uuid;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Seul le super-administrateur peut supprimer une entreprise';
  END IF;

  -- Get the tenant user_id for this entreprise
  SELECT user_id INTO tenant_uid FROM entreprise WHERE id = entreprise_id;
  IF tenant_uid IS NULL THEN
    RAISE EXCEPTION 'Entreprise introuvable';
  END IF;

  -- Delete all tenant-scoped business data
  DELETE FROM depot_avances WHERE user_id = tenant_uid;
  DELETE FROM depot_articles WHERE user_id = tenant_uid;
  DELETE FROM depots WHERE user_id = tenant_uid;
  DELETE FROM modes_reglement WHERE user_id = tenant_uid;
  DELETE FROM articles WHERE user_id = tenant_uid;
  DELETE FROM types_traitement WHERE user_id = tenant_uid;
  DELETE FROM clients WHERE user_id = tenant_uid;
  DELETE FROM depot_counter WHERE user_id = tenant_uid;
  DELETE FROM code_counter WHERE user_id = tenant_uid;

  -- Delete all team members for this tenant
  DELETE FROM entreprise_members WHERE tenant_id = tenant_uid;

  -- Finally delete the entreprise row itself
  DELETE FROM entreprise WHERE id = entreprise_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.delete_entreprise(integer) TO authenticated;
