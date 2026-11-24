-- Migration: Make delete_entreprise(integer) delete all tenant tables reliably
-- Fixes foreign-key failures when deleting a company that has team-member-created records
-- (where tenant_id = tenant_uid and user_id != tenant_uid) or newer feature tables.

CREATE OR REPLACE FUNCTION public.delete_entreprise(entreprise_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  tenant_uid uuid;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Seul le super-administrateur peut supprimer une entreprise';
  END IF;

  SELECT user_id INTO tenant_uid FROM public.entreprise WHERE id = entreprise_id;
  IF tenant_uid IS NULL THEN
    RAISE EXCEPTION 'Entreprise introuvable';
  END IF;

  -- 1. Child tables referencing depots / clients / articles / consommables
  IF to_regclass('public.depot_avances') IS NOT NULL THEN
    DELETE FROM public.depot_avances
    WHERE tenant_id = tenant_uid
       OR user_id = tenant_uid
       OR depot_id IN (SELECT id FROM public.depots WHERE tenant_id = tenant_uid OR user_id = tenant_uid);
  END IF;

  IF to_regclass('public.depot_articles') IS NOT NULL THEN
    DELETE FROM public.depot_articles
    WHERE tenant_id = tenant_uid
       OR user_id = tenant_uid
       OR depot_id IN (SELECT id FROM public.depots WHERE tenant_id = tenant_uid OR user_id = tenant_uid);
  END IF;

  IF to_regclass('public.fidelite_history') IS NOT NULL THEN
    DELETE FROM public.fidelite_history
    WHERE tenant_id = tenant_uid
       OR client_id IN (SELECT id FROM public.clients WHERE tenant_id = tenant_uid OR user_id = tenant_uid);
  END IF;

  IF to_regclass('public.fidelite_points') IS NOT NULL THEN
    DELETE FROM public.fidelite_points
    WHERE tenant_id = tenant_uid
       OR client_id IN (SELECT id FROM public.clients WHERE tenant_id = tenant_uid OR user_id = tenant_uid);
  END IF;

  IF to_regclass('public.relances') IS NOT NULL THEN
    DELETE FROM public.relances
    WHERE tenant_id = tenant_uid
       OR client_id IN (SELECT id FROM public.clients WHERE tenant_id = tenant_uid OR user_id = tenant_uid);
  END IF;

  IF to_regclass('public.depots') IS NOT NULL THEN
    DELETE FROM public.depots
    WHERE tenant_id = tenant_uid
       OR user_id = tenant_uid
       OR client_id IN (SELECT id FROM public.clients WHERE tenant_id = tenant_uid OR user_id = tenant_uid);
  END IF;

  IF to_regclass('public.consommable_mouvements') IS NOT NULL THEN
    DELETE FROM public.consommable_mouvements WHERE tenant_id = tenant_uid;
  END IF;

  IF to_regclass('public.consommables') IS NOT NULL THEN
    DELETE FROM public.consommables WHERE tenant_id = tenant_uid;
  END IF;

  IF to_regclass('public.bons_reduction') IS NOT NULL THEN
    DELETE FROM public.bons_reduction WHERE tenant_id = tenant_uid;
  END IF;

  IF to_regclass('public.article_variants') IS NOT NULL THEN
    DELETE FROM public.article_variants
    WHERE tenant_id = tenant_uid
       OR article_id IN (SELECT id FROM public.articles WHERE tenant_id = tenant_uid OR user_id = tenant_uid);
  END IF;

  IF to_regclass('public.articles') IS NOT NULL THEN
    DELETE FROM public.articles WHERE tenant_id = tenant_uid OR user_id = tenant_uid;
  END IF;

  IF to_regclass('public.types_traitement') IS NOT NULL THEN
    DELETE FROM public.types_traitement WHERE tenant_id = tenant_uid OR user_id = tenant_uid;
  END IF;

  IF to_regclass('public.modes_reglement') IS NOT NULL THEN
    DELETE FROM public.modes_reglement WHERE tenant_id = tenant_uid OR user_id = tenant_uid;
  END IF;

  IF to_regclass('public.depenses') IS NOT NULL THEN
    DELETE FROM public.depenses WHERE tenant_id = tenant_uid OR user_id = tenant_uid;
  END IF;

  IF to_regclass('public.depense_categories') IS NOT NULL THEN
    DELETE FROM public.depense_categories WHERE tenant_id = tenant_uid OR user_id = tenant_uid;
  END IF;

  IF to_regclass('public.clients') IS NOT NULL THEN
    DELETE FROM public.clients WHERE tenant_id = tenant_uid OR user_id = tenant_uid;
  END IF;

  IF to_regclass('public.depot_counter') IS NOT NULL THEN
    DELETE FROM public.depot_counter WHERE tenant_id = tenant_uid OR user_id = tenant_uid;
  END IF;

  IF to_regclass('public.code_counter') IS NOT NULL THEN
    DELETE FROM public.code_counter WHERE tenant_id = tenant_uid OR user_id = tenant_uid;
  END IF;

  -- 2. Membership, requests, licences, boutiques
  IF to_regclass('public.join_requests') IS NOT NULL THEN
    DELETE FROM public.join_requests WHERE tenant_id = tenant_uid;
  END IF;

  IF to_regclass('public.licences') IS NOT NULL THEN
    DELETE FROM public.licences WHERE entreprise_id = delete_entreprise.entreprise_id;
  END IF;

  IF to_regclass('public.entreprise_members') IS NOT NULL THEN
    DELETE FROM public.entreprise_members WHERE tenant_id = tenant_uid;
  END IF;

  IF to_regclass('public.boutiques') IS NOT NULL THEN
    DELETE FROM public.boutiques WHERE tenant_id = tenant_uid;
  END IF;

  -- 3. Finally delete the entreprise row
  DELETE FROM public.entreprise WHERE id = delete_entreprise.entreprise_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_entreprise(integer) TO authenticated;
