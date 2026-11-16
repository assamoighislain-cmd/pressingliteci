-- Backfill missing entreprise + entreprise_members rows for users who
-- signed up with an entreprise_nom but whose trigger failed (before the
-- robust trigger fix in migration 20260827180957).
-- Without these rows, is_tenant_member() returns false and every INSERT
-- into tenant tables fails with "new row violates row-level security policy".

DO $$
DECLARE
  u RECORD;
  v_entreprise_id integer;
  v_cle text;
BEGIN
  FOR u IN
    SELECT id, raw_user_meta_data->>'entreprise_nom' AS ent_nom,
           COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'nom_prenoms') AS fname,
           raw_user_meta_data->>'contact' AS phone
    FROM auth.users
    WHERE raw_user_meta_data->>'entreprise_nom' IS NOT NULL
      AND raw_user_meta_data->>'entreprise_nom' <> ''
      AND NOT EXISTS (SELECT 1 FROM public.entreprise e WHERE e.user_id = auth.users.id)
  LOOP
    -- Create entreprise
    INSERT INTO public.entreprise (user_id, nom)
    VALUES (u.id, u.ent_nom)
    ON CONFLICT (user_id) DO UPDATE SET nom = EXCLUDED.nom
    RETURNING id INTO v_entreprise_id;

    -- Create admin membership
    INSERT INTO public.entreprise_members (tenant_id, user_id, role, full_name, contact)
    VALUES (u.id, u.id, 'admin', u.fname, u.phone)
    ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'admin';

    -- Create trial licence (best-effort)
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM public.licences WHERE entreprise_id = v_entreprise_id) THEN
        v_cle := 'PRS-' || EXTRACT(YEAR FROM CURRENT_DATE)::text || '-' ||
          upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
        INSERT INTO public.licences (entreprise_id, cle_licence, date_debut, date_fin, statut, created_by)
        VALUES (v_entreprise_id, v_cle, CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 'active', u.id);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END $$;