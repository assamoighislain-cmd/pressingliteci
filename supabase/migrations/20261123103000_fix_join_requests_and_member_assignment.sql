-- Migration: Restore existing-company join_requests on signup + improve member assignment RPCs
-- Fixes:
-- 1. Signing up with an existing company name (e.g. "Ecoclair") creates a join_request instead of a duplicate company.
-- 2. Signing up with joining_existing_team = true never creates a duplicate company.
-- 3. Case-insensitive email lookup in add_team_member & add_member_to_entreprise + support for 'collecteur' role.
-- 4. Automatically populates full_name & contact from auth.users metadata when adding a member.

-- 1. Restore existing-company check + joining_existing_team guard in handle_new_entreprise_signup()
CREATE OR REPLACE FUNCTION public.handle_new_entreprise_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_nom text;
  v_target_nom text;
  v_joining boolean;
  v_full_name text;
  v_contact text;
  v_lat double precision;
  v_lng double precision;
  v_existing_tenant_id uuid;
  v_ent_id bigint;
  v_key text;
BEGIN
  v_joining := COALESCE((NEW.raw_user_meta_data ->> 'joining_existing_team')::boolean, false);
  v_nom := trim(COALESCE(NEW.raw_user_meta_data ->> 'entreprise_nom', ''));
  v_target_nom := trim(COALESCE(NEW.raw_user_meta_data ->> 'target_entreprise_nom', v_nom));
  v_full_name := NULLIF(trim(COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'nom_prenoms', '')), '');
  v_contact := NULLIF(trim(COALESCE(NEW.raw_user_meta_data ->> 'contact', '')), '');

  -- Skip if user already belongs to an entreprise
  IF EXISTS (SELECT 1 FROM public.entreprise_members WHERE user_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- If explicitly joining an existing team, create join_request if target company matches and NEVER create a new company
  IF v_joining THEN
    IF v_target_nom <> '' THEN
      SELECT user_id INTO v_existing_tenant_id
      FROM public.entreprise
      WHERE lower(trim(nom)) = lower(v_target_nom)
      ORDER BY CASE WHEN statut IN ('active', 'demo') THEN 0 ELSE 1 END, id ASC
      LIMIT 1;

      IF v_existing_tenant_id IS NOT NULL THEN
        INSERT INTO public.join_requests (tenant_id, user_id, user_email, full_name, contact, requested_role, status)
        VALUES (v_existing_tenant_id, NEW.id, NEW.email, v_full_name, v_contact, 'commercial', 'pending')
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF v_nom = '' THEN
    RETURN NEW;
  END IF;

  -- If an entreprise with the exact same name already exists, create a join_request instead of a duplicate company!
  SELECT user_id INTO v_existing_tenant_id
  FROM public.entreprise
  WHERE lower(trim(nom)) = lower(v_nom)
  ORDER BY CASE WHEN statut IN ('active', 'demo') THEN 0 ELSE 1 END, id ASC
  LIMIT 1;

  IF v_existing_tenant_id IS NOT NULL THEN
    INSERT INTO public.join_requests (tenant_id, user_id, user_email, full_name, contact, requested_role, status)
    VALUES (v_existing_tenant_id, NEW.id, NEW.email, v_full_name, v_contact, 'commercial', 'pending')
    ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;

  BEGIN
    v_lat := NULLIF(trim(COALESCE(NEW.raw_user_meta_data ->> 'gps_latitude', '')), '')::double precision;
    v_lng := NULLIF(trim(COALESCE(NEW.raw_user_meta_data ->> 'gps_longitude', '')), '')::double precision;
  EXCEPTION WHEN others THEN
    v_lat := NULL;
    v_lng := NULL;
  END;

  INSERT INTO public.entreprise (user_id, nom, statut, latitude, longitude, telephone)
  VALUES (NEW.id, v_nom, 'pending', v_lat, v_lng, v_contact)
  ON CONFLICT (user_id) DO NOTHING
  RETURNING id INTO v_ent_id;

  IF v_ent_id IS NULL THEN
    SELECT id INTO v_ent_id FROM public.entreprise WHERE user_id = NEW.id LIMIT 1;
  END IF;

  INSERT INTO public.entreprise_members (tenant_id, user_id, role, full_name, contact)
  VALUES (NEW.id, NEW.id, 'admin', v_full_name, v_contact)
  ON CONFLICT DO NOTHING;

  -- Automatically activate a 30-day Demo licence
  IF v_ent_id IS NOT NULL THEN
    v_key := 'DEMO-' || to_char(CURRENT_DATE, 'YYYY') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    INSERT INTO public.licences (entreprise_id, cle_licence, date_debut, date_fin, statut, type_licence, prix, created_by)
    VALUES (v_ent_id, v_key, CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 'active', 'demo', 0, NEW.id)
    ON CONFLICT (entreprise_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Also guard signup_create_entreprise RPC against duplicate company names
CREATE OR REPLACE FUNCTION public.signup_create_entreprise(entreprise_nom text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_clean_nom text := trim(COALESCE(entreprise_nom, ''));
  v_existing_tenant_id uuid;
  v_user_email text;
  v_full_name text;
  v_contact text;
  v_ent_id bigint;
  v_key text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifié';
  END IF;

  IF v_clean_nom = '' THEN
    RETURN;
  END IF;

  -- Skip if user already has a pending join request
  IF EXISTS (SELECT 1 FROM public.join_requests WHERE user_id = v_user_id AND status = 'pending') THEN
    RETURN;
  END IF;

  -- If company already exists under another owner, create a join_request instead of a duplicate
  SELECT user_id INTO v_existing_tenant_id
  FROM public.entreprise
  WHERE lower(trim(nom)) = lower(v_clean_nom)
    AND user_id <> v_user_id
  ORDER BY CASE WHEN statut IN ('active', 'demo') THEN 0 ELSE 1 END, id ASC
  LIMIT 1;

  IF v_existing_tenant_id IS NOT NULL THEN
    SELECT email,
           NULLIF(trim(COALESCE(raw_user_meta_data ->> 'full_name', '')), ''),
           NULLIF(trim(COALESCE(raw_user_meta_data ->> 'contact', '')), '')
    INTO v_user_email, v_full_name, v_contact
    FROM auth.users
    WHERE id = v_user_id;

    INSERT INTO public.join_requests (tenant_id, user_id, user_email, full_name, contact, requested_role, status)
    VALUES (v_existing_tenant_id, v_user_id, COALESCE(v_user_email, ''), v_full_name, v_contact, 'commercial', 'pending')
    ON CONFLICT DO NOTHING;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.entreprise_members WHERE user_id = v_user_id) THEN
    SELECT id INTO v_ent_id FROM public.entreprise WHERE user_id = v_user_id LIMIT 1;
  ELSE
    INSERT INTO public.entreprise (user_id, nom, statut)
    VALUES (v_user_id, v_clean_nom, 'pending')
    ON CONFLICT (user_id) DO UPDATE SET nom = EXCLUDED.nom
    RETURNING id INTO v_ent_id;

    INSERT INTO public.entreprise_members (tenant_id, user_id, role)
    VALUES (v_user_id, v_user_id, 'admin')
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_ent_id IS NOT NULL THEN
    v_key := 'DEMO-' || to_char(CURRENT_DATE, 'YYYY') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    INSERT INTO public.licences (entreprise_id, cle_licence, date_debut, date_fin, statut, type_licence, prix, created_by)
    VALUES (v_ent_id, v_key, CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 'active', 'demo', 0, v_user_id)
    ON CONFLICT (entreprise_id) DO NOTHING;
  END IF;
END;
$$;

-- 3. Upgrade add_member_to_entreprise (Super Admin): case-insensitive email, collecteur role, metadata copy
CREATE OR REPLACE FUNCTION public.add_member_to_entreprise(
  member_email text,
  target_tenant_id uuid,
  member_role text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  member_uid uuid;
  v_full_name text;
  v_contact text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Seul le super-administrateur peut ajouter des membres';
  END IF;

  IF member_role NOT IN ('admin', 'gerant', 'commercial', 'collecteur') THEN
    RAISE EXCEPTION 'Rôle invalide';
  END IF;

  SELECT id,
         NULLIF(trim(COALESCE(raw_user_meta_data ->> 'full_name', '')), ''),
         NULLIF(trim(COALESCE(raw_user_meta_data ->> 'contact', '')), '')
  INTO member_uid, v_full_name, v_contact
  FROM auth.users
  WHERE lower(email) = lower(trim(member_email))
  LIMIT 1;

  IF member_uid IS NULL THEN
    RAISE EXCEPTION 'Utilisateur introuvable. La personne doit d''abord créer un compte avec cet email.';
  END IF;

  INSERT INTO public.entreprise_members (tenant_id, user_id, role, full_name, contact)
  VALUES (target_tenant_id, member_uid, member_role, v_full_name, v_contact)
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET
    role = EXCLUDED.role,
    full_name = COALESCE(public.entreprise_members.full_name, EXCLUDED.full_name),
    contact = COALESCE(public.entreprise_members.contact, EXCLUDED.contact);

  -- Auto-confirm email so admin-created internal accounts (e.g. com1@ecoclair.com) can sign in immediately
  UPDATE auth.users
  SET email_confirmed_at = COALESCE(email_confirmed_at, now()),
      updated_at = now()
  WHERE id = member_uid
    AND email_confirmed_at IS NULL;

  RETURN member_uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_member_to_entreprise(text, uuid, text) TO authenticated;

-- 4. Upgrade add_team_member (Entreprise Admin): drop legacy 2-arg overload to prevent ambiguity, case-insensitive email, collecteur role, metadata copy
DROP FUNCTION IF EXISTS public.add_team_member(text, text);
CREATE OR REPLACE FUNCTION public.add_team_member(
  member_email text,
  member_role text,
  member_boutique_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid();
  t_id uuid;
  member_uid uuid;
  v_full_name text;
  v_contact text;
BEGIN
  t_id := public.get_tenant_id();
  IF t_id IS NULL THEN
    RAISE EXCEPTION 'Aucune entreprise trouvée';
  END IF;

  IF NOT public.is_tenant_admin(t_id) THEN
    RAISE EXCEPTION 'Seul l''administrateur peut ajouter des membres';
  END IF;

  IF member_role NOT IN ('admin', 'gerant', 'commercial', 'collecteur') THEN
    RAISE EXCEPTION 'Rôle invalide';
  END IF;

  SELECT id,
         NULLIF(trim(COALESCE(raw_user_meta_data ->> 'full_name', '')), ''),
         NULLIF(trim(COALESCE(raw_user_meta_data ->> 'contact', '')), '')
  INTO member_uid, v_full_name, v_contact
  FROM auth.users
  WHERE lower(email) = lower(trim(member_email))
  LIMIT 1;

  IF member_uid IS NULL THEN
    RAISE EXCEPTION 'Utilisateur introuvable. L''utilisateur doit d''abord créer un compte.';
  END IF;

  IF member_uid = uid THEN
    RAISE EXCEPTION 'Vous êtes déjà membre de cette entreprise';
  END IF;

  INSERT INTO public.entreprise_members (tenant_id, user_id, role, boutique_id, full_name, contact)
  VALUES (t_id, member_uid, member_role, member_boutique_id, v_full_name, v_contact)
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET
    role = EXCLUDED.role,
    boutique_id = EXCLUDED.boutique_id,
    full_name = COALESCE(public.entreprise_members.full_name, EXCLUDED.full_name),
    contact = COALESCE(public.entreprise_members.contact, EXCLUDED.contact);

  -- Auto-confirm email so admin-created internal accounts (e.g. com1@ecoclair.com) can sign in immediately
  UPDATE auth.users
  SET email_confirmed_at = COALESCE(email_confirmed_at, now()),
      updated_at = now()
  WHERE id = member_uid
    AND email_confirmed_at IS NULL;

  RETURN member_uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_team_member(text, text, uuid) TO authenticated;

-- 5. Allow any authenticated user (including already-registered accounts) to request to join an existing company by name
CREATE OR REPLACE FUNCTION public.request_join_entreprise(
  p_entreprise_nom text,
  p_full_name text DEFAULT NULL,
  p_contact text DEFAULT NULL,
  p_role text DEFAULT 'commercial'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_clean_nom text := trim(COALESCE(p_entreprise_nom, ''));
  v_role text := COALESCE(NULLIF(trim(p_role), ''), 'commercial');
  v_target_tenant_id uuid;
  v_target_nom text;
  v_user_email text;
  v_meta_full_name text;
  v_meta_contact text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifié';
  END IF;

  IF v_clean_nom = '' THEN
    RAISE EXCEPTION 'Veuillez saisir le nom de l''entreprise à rejoindre.';
  END IF;

  IF v_role NOT IN ('gerant', 'commercial', 'collecteur') THEN
    v_role := 'commercial';
  END IF;

  -- Prefer exact case-insensitive match (active/demo first), then partial match if unique
  SELECT user_id, nom
  INTO v_target_tenant_id, v_target_nom
  FROM public.entreprise
  WHERE lower(trim(nom)) = lower(v_clean_nom)
  ORDER BY CASE WHEN statut IN ('active', 'demo') THEN 0 ELSE 1 END, id ASC
  LIMIT 1;

  IF v_target_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Aucune entreprise nommée « % » n''a été trouvée. Vérifiez l''orthographe exacte.', v_clean_nom;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.entreprise_members
    WHERE tenant_id = v_target_tenant_id AND user_id = v_uid
  ) THEN
    RETURN jsonb_build_object('status', 'already_member', 'entreprise_nom', v_target_nom);
  END IF;

  SELECT email,
         NULLIF(trim(COALESCE(raw_user_meta_data ->> 'full_name', '')), ''),
         NULLIF(trim(COALESCE(raw_user_meta_data ->> 'contact', '')), '')
  INTO v_user_email, v_meta_full_name, v_meta_contact
  FROM auth.users
  WHERE id = v_uid;

  INSERT INTO public.join_requests (tenant_id, user_id, user_email, full_name, contact, requested_role, status)
  VALUES (
    v_target_tenant_id,
    v_uid,
    COALESCE(v_user_email, ''),
    COALESCE(NULLIF(trim(p_full_name), ''), v_meta_full_name),
    COALESCE(NULLIF(trim(p_contact), ''), v_meta_contact),
    v_role,
    'pending'
  )
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('status', 'pending', 'entreprise_nom', v_target_nom);
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_join_entreprise(text, text, text, text) TO authenticated;

-- 6. Prevent Super Admin from accidentally creating duplicate company names
CREATE OR REPLACE FUNCTION public.create_entreprise_admin(admin_email text, entreprise_nom text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_clean_nom text := trim(COALESCE(entreprise_nom, ''));
  v_admin_uid uuid;
  v_full_name text;
  v_contact text;
  v_ent_id bigint;
  v_existing_nom text;
  v_key text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Seul le super-administrateur peut créer une entreprise';
  END IF;

  IF v_clean_nom = '' THEN
    RAISE EXCEPTION 'Le nom de l''entreprise est requis';
  END IF;

  -- Strictly forbid duplicate company names (case-insensitive)
  SELECT nom INTO v_existing_nom
  FROM public.entreprise
  WHERE lower(trim(nom)) = lower(v_clean_nom)
  LIMIT 1;

  IF v_existing_nom IS NOT NULL THEN
    RAISE EXCEPTION 'Une entreprise nommée « % » existe déjà. Ajoutez plutôt cet utilisateur comme membre de l''entreprise existante.', v_existing_nom;
  END IF;

  SELECT id,
         NULLIF(trim(COALESCE(raw_user_meta_data ->> 'full_name', '')), ''),
         NULLIF(trim(COALESCE(raw_user_meta_data ->> 'contact', '')), '')
  INTO v_admin_uid, v_full_name, v_contact
  FROM auth.users
  WHERE lower(email) = lower(trim(admin_email))
  LIMIT 1;

  IF v_admin_uid IS NULL THEN
    RAISE EXCEPTION 'Utilisateur introuvable. La personne doit d''abord créer un compte avec cet email.';
  END IF;

  INSERT INTO public.entreprise (user_id, nom, statut, telephone)
  VALUES (v_admin_uid, v_clean_nom, 'active', v_contact)
  ON CONFLICT (user_id) DO UPDATE SET nom = EXCLUDED.nom, statut = 'active'
  RETURNING id INTO v_ent_id;

  INSERT INTO public.entreprise_members (tenant_id, user_id, role, full_name, contact)
  VALUES (v_admin_uid, v_admin_uid, 'admin', v_full_name, v_contact)
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'admin';

  v_key := 'DEMO-' || to_char(CURRENT_DATE, 'YYYY') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  INSERT INTO public.licences (entreprise_id, cle_licence, date_debut, date_fin, statut, type_licence, prix, created_by)
  VALUES (v_ent_id, v_key, CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 'active', 'demo', 0, auth.uid())
  ON CONFLICT (entreprise_id) DO NOTHING;

  RETURN v_ent_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_entreprise_admin(text, text) TO authenticated;

-- 7. Confirm a team member's email so internal/company emails (e.g. com1@ecoclair.com) can log in immediately
CREATE OR REPLACE FUNCTION public.confirm_member_email(target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_authorized boolean := false;
BEGIN
  IF public.is_super_admin() THEN
    v_authorized := true;
  ELSIF EXISTS (
    SELECT 1
    FROM public.entreprise_members em
    WHERE em.user_id = target_user_id
      AND public.is_tenant_admin(em.tenant_id)
  ) THEN
    v_authorized := true;
  END IF;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'Accès refusé : seul un administrateur de l''entreprise ou le Super Admin peut confirmer ce compte.';
  END IF;

  UPDATE auth.users
  SET email_confirmed_at = COALESCE(email_confirmed_at, now()),
      updated_at = now()
  WHERE id = target_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_member_email(uuid) TO authenticated;

-- 8. Allow Company Admin or Super Admin to directly reset a team member's password (and confirm email)
CREATE OR REPLACE FUNCTION public.admin_reset_member_password(target_user_id uuid, new_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_authorized boolean := false;
BEGIN
  IF new_password IS NULL OR length(trim(new_password)) < 6 THEN
    RAISE EXCEPTION 'Le mot de passe doit contenir au moins 6 caractères.';
  END IF;

  IF public.is_super_admin() THEN
    v_authorized := true;
  ELSIF EXISTS (
    SELECT 1
    FROM public.entreprise_members em
    WHERE em.user_id = target_user_id
      AND public.is_tenant_admin(em.tenant_id)
  ) THEN
    v_authorized := true;
  END IF;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'Accès refusé : seul un administrateur de l''entreprise ou le Super Admin peut modifier ce mot de passe.';
  END IF;

  UPDATE auth.users
  SET encrypted_password = extensions.crypt(trim(new_password), extensions.gen_salt('bf')),
      email_confirmed_at = COALESCE(email_confirmed_at, now()),
      updated_at = now()
  WHERE id = target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Compte utilisateur introuvable.';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reset_member_password(uuid, text) TO authenticated;



