-- Migration: Attach com2@ecoclair.com and com4@ecoclair.com to company ECOCLAIR
-- Idempotent & safe:
-- 1. Finds the primary ECOCLAIR tenant (preferring active/demo status).
-- 2. Cleans up any empty duplicate entreprise row owned by com2/com4 so get_tenant_id() always resolves to ECOCLAIR.
-- 3. Removes stray memberships in other tenants and upserts both users into ECOCLAIR as 'commercial' (preserving existing ECOCLAIR role/boutique if already attached).
-- 4. Marks any pending join_requests as approved and confirms email_confirmed_at in auth.users.

DO $$
DECLARE
  v_ecoclair_tenant_id uuid;
  v_default_boutique_id uuid;
  v_email text;
  v_member_uid uuid;
  v_full_name text;
  v_contact text;
  v_dup_ent_id bigint;
  v_has_data boolean;
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

  IF v_ecoclair_tenant_id IS NULL THEN
    RAISE NOTICE 'Entreprise ECOCLAIR introuvable dans public.entreprise — aucun rattachement effectué.';
    RETURN;
  END IF;

  -- Optional default boutique of ECOCLAIR
  SELECT id
  INTO v_default_boutique_id
  FROM public.boutiques
  WHERE tenant_id = v_ecoclair_tenant_id
  ORDER BY is_default DESC, created_at ASC
  LIMIT 1;

  -- 2. Attach each target account
  FOREACH v_email IN ARRAY ARRAY['com2@ecoclair.com', 'com4@ecoclair.com']
  LOOP
    SELECT id,
           NULLIF(trim(COALESCE(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'nom_prenoms', '')), ''),
           NULLIF(trim(COALESCE(raw_user_meta_data ->> 'contact', '')), '')
    INTO v_member_uid, v_full_name, v_contact
    FROM auth.users
    WHERE lower(trim(email)) = lower(v_email)
    LIMIT 1;

    IF v_member_uid IS NULL THEN
      RAISE NOTICE 'Compte % introuvable dans auth.users — ignoré.', v_email;
      CONTINUE;
    END IF;

    -- Skip destructive cleanup if somehow this user IS the ECOCLAIR owner
    IF v_member_uid <> v_ecoclair_tenant_id THEN
      -- Clean up an accidental empty duplicate company owned by this user
      SELECT id INTO v_dup_ent_id
      FROM public.entreprise
      WHERE user_id = v_member_uid
      LIMIT 1;

      IF v_dup_ent_id IS NOT NULL THEN
        SELECT (
          EXISTS (SELECT 1 FROM public.depots WHERE user_id = v_member_uid) OR
          EXISTS (SELECT 1 FROM public.clients WHERE user_id = v_member_uid)
        ) INTO v_has_data;

        IF NOT v_has_data THEN
          DELETE FROM public.join_requests WHERE tenant_id = v_member_uid;
          DELETE FROM public.licences WHERE entreprise_id = v_dup_ent_id;
          DELETE FROM public.boutiques WHERE tenant_id = v_member_uid;
          DELETE FROM public.entreprise_members WHERE tenant_id = v_member_uid;
          DELETE FROM public.types_traitement WHERE user_id = v_member_uid;
          DELETE FROM public.modes_reglement WHERE user_id = v_member_uid;
          DELETE FROM public.articles WHERE user_id = v_member_uid;
          DELETE FROM public.depot_counter WHERE user_id = v_member_uid;
          DELETE FROM public.code_counter WHERE user_id = v_member_uid;
          DELETE FROM public.entreprise WHERE id = v_dup_ent_id;
        END IF;
      END IF;

      -- Remove memberships in other tenants so get_tenant_id() unambiguously returns ECOCLAIR
      DELETE FROM public.entreprise_members
      WHERE user_id = v_member_uid
        AND tenant_id <> v_ecoclair_tenant_id;
    END IF;

    -- Attach to ECOCLAIR (keep existing role/boutique if already attached)
    INSERT INTO public.entreprise_members (tenant_id, user_id, role, boutique_id, full_name, contact)
    VALUES (v_ecoclair_tenant_id, v_member_uid, 'commercial', v_default_boutique_id, v_full_name, v_contact)
    ON CONFLICT (tenant_id, user_id) DO UPDATE SET
      boutique_id = COALESCE(public.entreprise_members.boutique_id, EXCLUDED.boutique_id),
      full_name = COALESCE(public.entreprise_members.full_name, EXCLUDED.full_name),
      contact = COALESCE(public.entreprise_members.contact, EXCLUDED.contact);

    -- Approve any pending join requests for this user
    UPDATE public.join_requests
    SET status = 'approved'
    WHERE user_id = v_member_uid
      AND status = 'pending';

    -- Ensure email is confirmed so login works immediately
    UPDATE auth.users
    SET email_confirmed_at = COALESCE(email_confirmed_at, now()),
        updated_at = now()
    WHERE id = v_member_uid
      AND email_confirmed_at IS NULL;

    RAISE NOTICE 'Compte % rattaché à ECOCLAIR (tenant_id=%).', v_email, v_ecoclair_tenant_id;
  END LOOP;
END $$;
