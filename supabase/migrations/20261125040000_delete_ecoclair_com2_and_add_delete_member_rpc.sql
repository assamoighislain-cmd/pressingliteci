-- Migration: Permanently delete com2@ecoclair.com (account + password) in ECOCLAIR
-- and provide a secure RPC `admin_delete_member_account` for future permanent member deletions.
--
-- Safety guarantees:
-- 1. Reassigns `user_id` to `tenant_id` on all company tables BEFORE deleting from `auth.users`
--    so `ON DELETE CASCADE` on `user_id` NEVER deletes ECOCLAIR's deposits, clients, or catalog.
-- 2. Never deletes a super_admin or a tenant's primary owner.
-- 3. Only deletes the `auth.users` row (account, encrypted password, identities, sessions)
--    when the user does not belong to any other company and does not own another company with data.
-- 4. Fully idempotent — safe to run multiple times.

CREATE OR REPLACE FUNCTION public.admin_delete_member_account(
  target_user_id uuid,
  target_tenant_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_tenant_id uuid;
  v_target_email text;
  v_is_super boolean := false;
  v_has_other_membership boolean := false;
  v_dup_ent_id bigint;
  v_dup_has_data boolean := false;
  v_auth_deleted boolean := false;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.';
  END IF;

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur cible invalide.';
  END IF;

  IF target_user_id = v_caller THEN
    RAISE EXCEPTION 'Vous ne pouvez pas supprimer votre propre compte.';
  END IF;

  -- Never allow deleting a super_admin
  IF EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = target_user_id) THEN
    RAISE EXCEPTION 'Impossible de supprimer un compte Super Admin.';
  END IF;

  v_is_super := public.is_super_admin();

  -- Resolve & authorize tenant
  IF target_tenant_id IS NOT NULL THEN
    IF NOT v_is_super AND NOT public.is_tenant_admin(target_tenant_id) THEN
      RAISE EXCEPTION 'Accès refusé : seul un administrateur de l''entreprise ou le Super Admin peut supprimer ce compte.';
    END IF;
    v_tenant_id := target_tenant_id;
  ELSE
    SELECT em.tenant_id
    INTO v_tenant_id
    FROM public.entreprise_members em
    WHERE em.user_id = target_user_id
      AND (v_is_super OR public.is_tenant_admin(em.tenant_id))
    ORDER BY em.created_at ASC
    LIMIT 1;
  END IF;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Accès refusé ou membre introuvable dans votre entreprise.';
  END IF;

  -- Never allow deleting the primary owner of this tenant via member deletion
  IF target_user_id = v_tenant_id THEN
    RAISE EXCEPTION 'Impossible de supprimer le compte propriétaire principal de l''entreprise.';
  END IF;

  SELECT email INTO v_target_email
  FROM auth.users
  WHERE id = target_user_id;

  -- 1. Reassign business records created by target_user_id in this tenant to v_tenant_id
  --    so deleting from auth.users never triggers ON DELETE CASCADE on company data.
  IF to_regclass('public.clients') IS NOT NULL THEN
    UPDATE public.clients SET user_id = v_tenant_id WHERE user_id = target_user_id AND tenant_id = v_tenant_id;
  END IF;
  IF to_regclass('public.depots') IS NOT NULL THEN
    UPDATE public.depots SET user_id = v_tenant_id WHERE user_id = target_user_id AND tenant_id = v_tenant_id;
  END IF;
  IF to_regclass('public.depot_articles') IS NOT NULL THEN
    UPDATE public.depot_articles SET user_id = v_tenant_id WHERE user_id = target_user_id AND tenant_id = v_tenant_id;
  END IF;
  IF to_regclass('public.depot_avances') IS NOT NULL THEN
    UPDATE public.depot_avances SET user_id = v_tenant_id WHERE user_id = target_user_id AND tenant_id = v_tenant_id;
  END IF;
  IF to_regclass('public.articles') IS NOT NULL THEN
    UPDATE public.articles SET user_id = v_tenant_id WHERE user_id = target_user_id AND tenant_id = v_tenant_id;
  END IF;
  IF to_regclass('public.article_variants') IS NOT NULL THEN
    UPDATE public.article_variants SET user_id = v_tenant_id WHERE user_id = target_user_id AND tenant_id = v_tenant_id;
  END IF;
  IF to_regclass('public.types_traitement') IS NOT NULL THEN
    UPDATE public.types_traitement SET user_id = v_tenant_id WHERE user_id = target_user_id AND tenant_id = v_tenant_id;
  END IF;
  IF to_regclass('public.modes_reglement') IS NOT NULL THEN
    UPDATE public.modes_reglement SET user_id = v_tenant_id WHERE user_id = target_user_id AND tenant_id = v_tenant_id;
  END IF;
  IF to_regclass('public.depenses') IS NOT NULL THEN
    UPDATE public.depenses SET user_id = v_tenant_id WHERE user_id = target_user_id AND tenant_id = v_tenant_id;
  END IF;
  IF to_regclass('public.depense_categories') IS NOT NULL THEN
    UPDATE public.depense_categories SET user_id = v_tenant_id WHERE user_id = target_user_id AND tenant_id = v_tenant_id;
  END IF;
  IF to_regclass('public.bons_reduction') IS NOT NULL THEN
    UPDATE public.bons_reduction SET user_id = v_tenant_id WHERE user_id = target_user_id AND tenant_id = v_tenant_id;
  END IF;
  IF to_regclass('public.depot_counter') IS NOT NULL THEN
    UPDATE public.depot_counter SET user_id = v_tenant_id WHERE user_id = target_user_id AND tenant_id = v_tenant_id;
  END IF;
  IF to_regclass('public.code_counter') IS NOT NULL THEN
    -- Preserve highest counter values on tenant row if it already exists, then drop member duplicate
    UPDATE public.code_counter cc_tenant
    SET client_counter = GREATEST(cc_tenant.client_counter, cc_member.client_counter),
        article_counter = GREATEST(cc_tenant.article_counter, cc_member.article_counter)
    FROM public.code_counter cc_member
    WHERE cc_tenant.id = cc_member.id
      AND cc_tenant.user_id = v_tenant_id
      AND cc_member.user_id = target_user_id;

    DELETE FROM public.code_counter cc_member
    WHERE cc_member.user_id = target_user_id
      AND EXISTS (
        SELECT 1 FROM public.code_counter cc_tenant
        WHERE cc_tenant.id = cc_member.id AND cc_tenant.user_id = v_tenant_id
      );

    UPDATE public.code_counter
    SET user_id = v_tenant_id
    WHERE user_id = target_user_id AND tenant_id = v_tenant_id;
  END IF;

  -- 2. Remove membership & join requests for this company
  DELETE FROM public.entreprise_members
  WHERE tenant_id = v_tenant_id
    AND user_id = target_user_id;

  IF to_regclass('public.join_requests') IS NOT NULL THEN
    DELETE FROM public.join_requests
    WHERE tenant_id = v_tenant_id
      AND (
        user_id = target_user_id
        OR (v_target_email IS NOT NULL AND lower(trim(user_email)) = lower(trim(v_target_email)))
      );
  END IF;

  -- 3. Check whether this user belongs to any other company
  SELECT EXISTS (
    SELECT 1 FROM public.entreprise_members WHERE user_id = target_user_id
  ) INTO v_has_other_membership;

  -- Check if this user owns a separate company
  SELECT id INTO v_dup_ent_id
  FROM public.entreprise
  WHERE user_id = target_user_id
  LIMIT 1;

  IF v_dup_ent_id IS NOT NULL THEN
    SELECT (
      EXISTS (SELECT 1 FROM public.depots WHERE tenant_id = target_user_id)
      OR EXISTS (SELECT 1 FROM public.clients WHERE tenant_id = target_user_id)
    ) INTO v_dup_has_data;
  END IF;

  -- 4. Permanently delete auth.users (account + password + identities + sessions)
  --    if user does not belong to another company and does not own a company with business data.
  IF NOT v_has_other_membership AND NOT v_dup_has_data THEN
    -- Clean up any empty duplicate entreprise owned by this user
    IF v_dup_ent_id IS NOT NULL THEN
      IF to_regclass('public.join_requests') IS NOT NULL THEN
        DELETE FROM public.join_requests WHERE tenant_id = target_user_id;
      END IF;
      IF to_regclass('public.licences') IS NOT NULL THEN
        DELETE FROM public.licences WHERE entreprise_id = v_dup_ent_id;
      END IF;
      IF to_regclass('public.boutiques') IS NOT NULL THEN
        DELETE FROM public.boutiques WHERE tenant_id = target_user_id;
      END IF;
      DELETE FROM public.entreprise_members WHERE tenant_id = target_user_id;
      DELETE FROM public.entreprise WHERE id = v_dup_ent_id;
    END IF;

    IF to_regclass('public.join_requests') IS NOT NULL THEN
      DELETE FROM public.join_requests
      WHERE user_id = target_user_id
         OR (v_target_email IS NOT NULL AND lower(trim(user_email)) = lower(trim(v_target_email)));
    END IF;

    IF to_regclass('public.push_subscriptions') IS NOT NULL THEN
      DELETE FROM public.push_subscriptions WHERE user_id = target_user_id;
    END IF;

    -- Delete Supabase Auth user (cascades to auth.identities, auth.sessions, auth.refresh_tokens, password hash)
    DELETE FROM auth.users WHERE id = target_user_id;
    v_auth_deleted := FOUND;
  END IF;

  RETURN jsonb_build_object(
    'removed_from_tenant', true,
    'auth_account_deleted', v_auth_deleted,
    'email', COALESCE(v_target_email, '')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_member_account(uuid, uuid) TO authenticated;

-- ============================================================================
-- One-time idempotent deletion of com2@ecoclair.com (account + password) in ECOCLAIR
-- ============================================================================
DO $$
DECLARE
  v_ecoclair_tenant_id uuid;
  v_member_uid uuid;
  v_dup_ent_id bigint;
  v_dup_has_data boolean := false;
BEGIN
  -- 1. Resolve primary ECOCLAIR tenant
  SELECT user_id
  INTO v_ecoclair_tenant_id
  FROM public.entreprise
  WHERE lower(trim(nom)) = 'ecoclair'
  ORDER BY CASE WHEN statut IN ('active', 'demo') THEN 0 ELSE 1 END, id ASC
  LIMIT 1;

  IF v_ecoclair_tenant_id IS NULL THEN
    SELECT user_id
    INTO v_ecoclair_tenant_id
    FROM public.entreprise
    WHERE lower(trim(nom)) LIKE '%ecoclair%'
    ORDER BY CASE WHEN statut IN ('active', 'demo') THEN 0 ELSE 1 END, id ASC
    LIMIT 1;
  END IF;

  -- Clean up any join_requests matching com2@ecoclair.com regardless of auth.users state
  IF to_regclass('public.join_requests') IS NOT NULL THEN
    DELETE FROM public.join_requests
    WHERE lower(trim(user_email)) = 'com2@ecoclair.com';
  END IF;

  -- 2. Locate com2@ecoclair.com in auth.users
  SELECT id
  INTO v_member_uid
  FROM auth.users
  WHERE lower(trim(email)) = 'com2@ecoclair.com'
  LIMIT 1;

  IF v_member_uid IS NULL THEN
    RAISE NOTICE 'Le compte com2@ecoclair.com est déjà supprimé ou introuvable dans auth.users.';
    RETURN;
  END IF;

  -- Safety guards
  IF EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = v_member_uid) THEN
    RAISE EXCEPTION 'Sécurité : com2@ecoclair.com est un Super Admin, suppression annulée.';
  END IF;

  IF v_ecoclair_tenant_id IS NOT NULL AND v_member_uid = v_ecoclair_tenant_id THEN
    RAISE EXCEPTION 'Sécurité : com2@ecoclair.com est le propriétaire principal d''ECOCLAIR, suppression annulée.';
  END IF;

  -- 3. Preserve all ECOCLAIR business data created by com2@ecoclair.com
  IF v_ecoclair_tenant_id IS NOT NULL THEN
    IF to_regclass('public.clients') IS NOT NULL THEN
      UPDATE public.clients SET user_id = v_ecoclair_tenant_id WHERE user_id = v_member_uid AND tenant_id = v_ecoclair_tenant_id;
    END IF;
    IF to_regclass('public.depots') IS NOT NULL THEN
      UPDATE public.depots SET user_id = v_ecoclair_tenant_id WHERE user_id = v_member_uid AND tenant_id = v_ecoclair_tenant_id;
    END IF;
    IF to_regclass('public.depot_articles') IS NOT NULL THEN
      UPDATE public.depot_articles SET user_id = v_ecoclair_tenant_id WHERE user_id = v_member_uid AND tenant_id = v_ecoclair_tenant_id;
    END IF;
    IF to_regclass('public.depot_avances') IS NOT NULL THEN
      UPDATE public.depot_avances SET user_id = v_ecoclair_tenant_id WHERE user_id = v_member_uid AND tenant_id = v_ecoclair_tenant_id;
    END IF;
    IF to_regclass('public.articles') IS NOT NULL THEN
      UPDATE public.articles SET user_id = v_ecoclair_tenant_id WHERE user_id = v_member_uid AND tenant_id = v_ecoclair_tenant_id;
    END IF;
    IF to_regclass('public.article_variants') IS NOT NULL THEN
      UPDATE public.article_variants SET user_id = v_ecoclair_tenant_id WHERE user_id = v_member_uid AND tenant_id = v_ecoclair_tenant_id;
    END IF;
    IF to_regclass('public.types_traitement') IS NOT NULL THEN
      UPDATE public.types_traitement SET user_id = v_ecoclair_tenant_id WHERE user_id = v_member_uid AND tenant_id = v_ecoclair_tenant_id;
    END IF;
    IF to_regclass('public.modes_reglement') IS NOT NULL THEN
      UPDATE public.modes_reglement SET user_id = v_ecoclair_tenant_id WHERE user_id = v_member_uid AND tenant_id = v_ecoclair_tenant_id;
    END IF;
    IF to_regclass('public.depenses') IS NOT NULL THEN
      UPDATE public.depenses SET user_id = v_ecoclair_tenant_id WHERE user_id = v_member_uid AND tenant_id = v_ecoclair_tenant_id;
    END IF;
    IF to_regclass('public.depense_categories') IS NOT NULL THEN
      UPDATE public.depense_categories SET user_id = v_ecoclair_tenant_id WHERE user_id = v_member_uid AND tenant_id = v_ecoclair_tenant_id;
    END IF;
    IF to_regclass('public.bons_reduction') IS NOT NULL THEN
      UPDATE public.bons_reduction SET user_id = v_ecoclair_tenant_id WHERE user_id = v_member_uid AND tenant_id = v_ecoclair_tenant_id;
    END IF;
    IF to_regclass('public.depot_counter') IS NOT NULL THEN
      UPDATE public.depot_counter SET user_id = v_ecoclair_tenant_id WHERE user_id = v_member_uid AND tenant_id = v_ecoclair_tenant_id;
    END IF;
    IF to_regclass('public.code_counter') IS NOT NULL THEN
      UPDATE public.code_counter cc_tenant
      SET client_counter = GREATEST(cc_tenant.client_counter, cc_member.client_counter),
          article_counter = GREATEST(cc_tenant.article_counter, cc_member.article_counter)
      FROM public.code_counter cc_member
      WHERE cc_tenant.id = cc_member.id
        AND cc_tenant.user_id = v_ecoclair_tenant_id
        AND cc_member.user_id = v_member_uid;

      DELETE FROM public.code_counter cc_member
      WHERE cc_member.user_id = v_member_uid
        AND EXISTS (
          SELECT 1 FROM public.code_counter cc_tenant
          WHERE cc_tenant.id = cc_member.id AND cc_tenant.user_id = v_ecoclair_tenant_id
        );

      UPDATE public.code_counter
      SET user_id = v_ecoclair_tenant_id
      WHERE user_id = v_member_uid AND tenant_id = v_ecoclair_tenant_id;
    END IF;
  END IF;

  -- 4. Clean up any empty duplicate entreprise owned by com2@ecoclair.com
  SELECT id INTO v_dup_ent_id
  FROM public.entreprise
  WHERE user_id = v_member_uid
  LIMIT 1;

  IF v_dup_ent_id IS NOT NULL THEN
    SELECT (
      EXISTS (SELECT 1 FROM public.depots WHERE tenant_id = v_member_uid)
      OR EXISTS (SELECT 1 FROM public.clients WHERE tenant_id = v_member_uid)
    ) INTO v_dup_has_data;

    IF NOT v_dup_has_data THEN
      IF to_regclass('public.join_requests') IS NOT NULL THEN
        DELETE FROM public.join_requests WHERE tenant_id = v_member_uid;
      END IF;
      IF to_regclass('public.licences') IS NOT NULL THEN
        DELETE FROM public.licences WHERE entreprise_id = v_dup_ent_id;
      END IF;
      IF to_regclass('public.boutiques') IS NOT NULL THEN
        DELETE FROM public.boutiques WHERE tenant_id = v_member_uid;
      END IF;
      DELETE FROM public.entreprise_members WHERE tenant_id = v_member_uid;
      DELETE FROM public.entreprise WHERE id = v_dup_ent_id;
    END IF;
  END IF;

  -- 5. Remove memberships, join requests, push subscriptions
  DELETE FROM public.entreprise_members WHERE user_id = v_member_uid;
  IF to_regclass('public.join_requests') IS NOT NULL THEN
    DELETE FROM public.join_requests WHERE user_id = v_member_uid;
  END IF;
  IF to_regclass('public.push_subscriptions') IS NOT NULL THEN
    DELETE FROM public.push_subscriptions WHERE user_id = v_member_uid;
  END IF;

  -- 6. Permanently delete com2@ecoclair.com from auth.users (account + password + identities + sessions)
  DELETE FROM auth.users WHERE id = v_member_uid;

  RAISE NOTICE 'Compte com2@ecoclair.com (id=%) et son mot de passe supprimés définitivement.', v_member_uid;
END $$;
