/*
# Backfill stuck signup users (entreprise + membership + trial licence)

## Problem
Between 2026-08-28 and 2026-08-29, the `handle_new_entreprise_signup()` trigger
was failing silently because `gen_random_bytes()` could not be resolved due to a
missing `extensions` schema in the search_path. This was fixed by migration
`20260829185612_fix_gen_random_bytes_search_path.sql`, but 9 users who signed up
during that window never got their `entreprise` row, `entreprise_members` row,
or trial licence. They see "En attente d'activation" every time they log in.

## Fix
For each auth.user who:
  - Has `entreprise_nom` in their raw_user_meta_data
  - Does NOT already have an entreprise row
  - Does NOT already have an entreprise_members row
  - Does NOT have a pending join_request (those users should wait for approval)

This migration:
  1. Creates the `entreprise` row (user_id = their auth id, nom = entreprise_nom)
  2. Creates the `entreprise_members` row (admin role)
  3. Creates a 30-day trial licence (best-effort, same as the trigger does)

## Safety
- Idempotent: uses ON CONFLICT for all inserts
- No data is deleted or modified — only inserts for missing rows
- Only affects users who are currently stuck (no entreprise AND no membership)
*/

DO $$
DECLARE
  rec RECORD;
  v_entreprise_id integer;
  v_cle text;
BEGIN
  FOR rec IN
    SELECT au.id, au.email, au.raw_user_meta_data->>'entreprise_nom' AS ent_nom,
           au.raw_user_meta_data->>'full_name' AS fname,
           au.raw_user_meta_data->>'contact' AS phone
    FROM auth.users au
    WHERE au.raw_user_meta_data->>'entreprise_nom' IS NOT NULL
      AND au.raw_user_meta_data->>'entreprise_nom' <> ''
      AND NOT EXISTS (SELECT 1 FROM public.entreprise e WHERE e.user_id = au.id)
      AND NOT EXISTS (SELECT 1 FROM public.entreprise_members em WHERE em.user_id = au.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.join_requests jr
        WHERE jr.user_id = au.id AND jr.status = 'pending'
      )
  LOOP
    -- 1. Create entreprise
    INSERT INTO public.entreprise (user_id, nom)
    VALUES (rec.id, rec.ent_nom)
    ON CONFLICT (user_id) DO UPDATE SET nom = EXCLUDED.nom
    RETURNING id INTO v_entreprise_id;

    -- 2. Create admin membership
    INSERT INTO public.entreprise_members (tenant_id, user_id, role, full_name, contact)
    VALUES (rec.id, rec.id, 'admin', rec.fname, NULLIF(rec.phone, ''))
    ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'admin';

    -- 3. Create trial licence (best-effort)
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM public.licences WHERE entreprise_id = v_entreprise_id) THEN
        v_cle := 'PRS-' || EXTRACT(YEAR FROM CURRENT_DATE)::text || '-' ||
          upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
        INSERT INTO public.licences (entreprise_id, cle_licence, date_debut, date_fin, statut, type_licence, created_by)
        VALUES (v_entreprise_id, v_cle, CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 'active', 'demo', rec.id);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    RAISE NOTICE 'Backfilled user % with entreprise %', rec.email, rec.ent_nom;
  END LOOP;
END $$;
