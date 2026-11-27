-- Add 'comptable' (Accountant) and 'associe' (Read-only Partner) roles
-- Enforces role allowlists on RPCs and server-side read-only RLS policies for 'associe' and operational write restrictions for 'comptable'.

-- 1. Update CHECK constraint on entreprise_members.role
ALTER TABLE public.entreprise_members
  DROP CONSTRAINT IF EXISTS entreprise_members_role_check;

ALTER TABLE public.entreprise_members
  ADD CONSTRAINT entreprise_members_role_check
  CHECK (role = ANY (ARRAY[
    'admin'::text,
    'gerant'::text,
    'commercial'::text,
    'collecteur'::text,
    'comptable'::text,
    'associe'::text
  ]));

-- 2. Upgrade add_member_to_entreprise (Super Admin)
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

  IF member_role NOT IN ('admin', 'gerant', 'commercial', 'collecteur', 'comptable', 'associe') THEN
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

  UPDATE auth.users
  SET email_confirmed_at = COALESCE(email_confirmed_at, now()),
      updated_at = now()
  WHERE id = member_uid
    AND email_confirmed_at IS NULL;

  RETURN member_uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_member_to_entreprise(text, uuid, text) TO authenticated;

-- 3. Upgrade add_team_member (Entreprise Admin)
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

  IF member_role NOT IN ('admin', 'gerant', 'commercial', 'collecteur', 'comptable', 'associe') THEN
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

  UPDATE auth.users
  SET email_confirmed_at = COALESCE(email_confirmed_at, now()),
      updated_at = now()
  WHERE id = member_uid
    AND email_confirmed_at IS NULL;

  RETURN member_uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_team_member(text, text, uuid) TO authenticated;

-- 4. Upgrade request_join_entreprise (never permits self-selecting 'admin')
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

  IF v_role NOT IN ('gerant', 'commercial', 'collecteur', 'comptable', 'associe') THEN
    v_role := 'commercial';
  END IF;

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
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET
    user_email = EXCLUDED.user_email,
    full_name = COALESCE(EXCLUDED.full_name, public.join_requests.full_name),
    contact = COALESCE(EXCLUDED.contact, public.join_requests.contact),
    requested_role = EXCLUDED.requested_role,
    status = 'pending',
    created_at = now();

  RETURN jsonb_build_object('status', 'pending', 'entreprise_nom', v_target_nom);
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_join_entreprise(text, text, text, text) TO authenticated;

-- 5. Allow 'comptable' to manage commission payouts alongside admin & gerant
DO $$
BEGIN
  IF to_regclass('public.commission_versements') IS NOT NULL THEN
    DROP POLICY IF EXISTS "commission_versements_insert" ON public.commission_versements;
    DROP POLICY IF EXISTS "insert_tenant_commission_versements" ON public.commission_versements;
    CREATE POLICY "insert_tenant_commission_versements" ON public.commission_versements
      FOR INSERT TO authenticated
      WITH CHECK (
        public.is_super_admin()
        OR EXISTS (
          SELECT 1 FROM public.entreprise_members em
          WHERE em.user_id = auth.uid()
            AND em.tenant_id = commission_versements.tenant_id
            AND em.role IN ('admin', 'gerant', 'comptable')
        )
      );

    DROP POLICY IF EXISTS "commission_versements_update" ON public.commission_versements;
    DROP POLICY IF EXISTS "update_tenant_commission_versements" ON public.commission_versements;
    CREATE POLICY "update_tenant_commission_versements" ON public.commission_versements
      FOR UPDATE TO authenticated
      USING (
        public.is_super_admin()
        OR EXISTS (
          SELECT 1 FROM public.entreprise_members em
          WHERE em.user_id = auth.uid()
            AND em.tenant_id = commission_versements.tenant_id
            AND em.role IN ('admin', 'gerant', 'comptable')
        )
      )
      WITH CHECK (
        public.is_super_admin()
        OR EXISTS (
          SELECT 1 FROM public.entreprise_members em
          WHERE em.user_id = auth.uid()
            AND em.tenant_id = commission_versements.tenant_id
            AND em.role IN ('admin', 'gerant', 'comptable')
        )
      );

    DROP POLICY IF EXISTS "commission_versements_delete" ON public.commission_versements;
    DROP POLICY IF EXISTS "delete_tenant_commission_versements" ON public.commission_versements;
    CREATE POLICY "delete_tenant_commission_versements" ON public.commission_versements
      FOR DELETE TO authenticated
      USING (
        public.is_super_admin()
        OR EXISTS (
          SELECT 1 FROM public.entreprise_members em
          WHERE em.user_id = auth.uid()
            AND em.tenant_id = commission_versements.tenant_id
            AND em.role IN ('admin', 'gerant', 'comptable')
        )
      );
  END IF;
END $$;

-- 6. Server-side RESTRICTIVE RLS policies enforcing read-only access for 'associe'
--    and blocking operational writes for 'comptable' (while allowing comptable writes on depenses, depense_categories, commission_versements).
CREATE OR REPLACE FUNCTION public.current_user_can_write_financial()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.is_super_admin()
    OR COALESCE(public.get_user_role(), 'admin') <> 'associe';
$$;

CREATE OR REPLACE FUNCTION public.current_user_can_write_operational()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.is_super_admin()
    OR COALESCE(public.get_user_role(), 'admin') NOT IN ('associe', 'comptable');
$$;

GRANT EXECUTE ON FUNCTION public.current_user_can_write_financial() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_can_write_operational() TO authenticated;

DO $$
DECLARE
  t text;
  op_tables text[] := ARRAY[
    'clients',
    'depots',
    'depot_articles',
    'depot_avances',
    'articles',
    'article_variants',
    'types_traitement',
    'modes_reglement',
    'consommables',
    'consommable_mouvements',
    'boutiques',
    'entreprise',
    'bons_reduction',
    'commerciaux',
    'commercial_clients',
    'relances',
    'fidelite_points'
  ];
  fin_tables text[] := ARRAY[
    'depenses',
    'depense_categories',
    'commission_versements'
  ];
BEGIN
  FOREACH t IN ARRAY op_tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS "restrict_readonly_insert" ON public.%I', t);
      EXECUTE format('CREATE POLICY "restrict_readonly_insert" ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.current_user_can_write_operational())', t);
      EXECUTE format('DROP POLICY IF EXISTS "restrict_readonly_update" ON public.%I', t);
      EXECUTE format('CREATE POLICY "restrict_readonly_update" ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.current_user_can_write_operational()) WITH CHECK (public.current_user_can_write_operational())', t);
      EXECUTE format('DROP POLICY IF EXISTS "restrict_readonly_delete" ON public.%I', t);
      EXECUTE format('CREATE POLICY "restrict_readonly_delete" ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (public.current_user_can_write_operational())', t);
    END IF;
  END LOOP;

  FOREACH t IN ARRAY fin_tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS "restrict_associe_insert" ON public.%I', t);
      EXECUTE format('CREATE POLICY "restrict_associe_insert" ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.current_user_can_write_financial())', t);
      EXECUTE format('DROP POLICY IF EXISTS "restrict_associe_update" ON public.%I', t);
      EXECUTE format('CREATE POLICY "restrict_associe_update" ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.current_user_can_write_financial()) WITH CHECK (public.current_user_can_write_financial())', t);
      EXECUTE format('DROP POLICY IF EXISTS "restrict_associe_delete" ON public.%I', t);
      EXECUTE format('CREATE POLICY "restrict_associe_delete" ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (public.current_user_can_write_financial())', t);
    END IF;
  END LOOP;
END $$;
