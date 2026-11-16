/*
# Modify signup trigger to create join requests for existing entreprises

## Purpose
When a new user signs up with an entreprise name that already exists in the database,
instead of creating a duplicate entreprise, the trigger now:
1. Checks if an entreprise with that name already exists.
2. If it exists, creates a join_request (status=pending) targeting that entreprise's admin.
3. If it doesn't exist, proceeds as before (creates the entreprise + admin membership + trial licence).

## Modified Functions
- `handle_new_entreprise_signup()`: now checks for existing entreprise by name before creating.

## Security
- No new tables. Uses the join_requests table created in the previous migration.
- The function is SECURITY DEFINER with search_path = public, extensions.
*/

CREATE OR REPLACE FUNCTION public.handle_new_entreprise_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  ent_nom text;
  fname text;
  phone text;
  v_entreprise_id integer;
  v_cle text;
  existing_tenant_id uuid;
BEGIN
  ent_nom := NEW.raw_user_meta_data->>'entreprise_nom';
  fname := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'nom_prenoms');
  phone := NEW.raw_user_meta_data->>'contact';

  IF ent_nom IS NOT NULL AND ent_nom <> '' THEN
    -- Check if an entreprise with this name already exists
    SELECT user_id INTO existing_tenant_id FROM public.entreprise WHERE LOWER(TRIM(nom)) = LOWER(TRIM(ent_nom)) LIMIT 1;

    IF existing_tenant_id IS NOT NULL THEN
      -- Entreprise exists: create a join request instead of a new entreprise
      INSERT INTO public.join_requests (tenant_id, user_id, user_email, full_name, contact, requested_role, status)
      VALUES (existing_tenant_id, NEW.id, NEW.email, fname, phone, 'commercial', 'pending')
      ON CONFLICT (tenant_id, user_id) WHERE status = 'pending' DO NOTHING;
      RETURN NEW;
    END IF;

    -- Entreprise doesn't exist: create it
    INSERT INTO public.entreprise (user_id, nom)
    VALUES (NEW.id, ent_nom)
    ON CONFLICT (user_id) DO UPDATE SET nom = EXCLUDED.nom
    RETURNING id INTO v_entreprise_id;

    -- Add user as admin member
    INSERT INTO public.entreprise_members (tenant_id, user_id, role, full_name, contact)
    VALUES (NEW.id, NEW.id, 'admin', fname, phone)
    ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'admin', full_name = EXCLUDED.full_name, contact = EXCLUDED.contact;

    -- Create a trial licence (best-effort)
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM public.licences WHERE entreprise_id = v_entreprise_id) THEN
        v_cle := 'PRS-' || EXTRACT(YEAR FROM CURRENT_DATE)::text || '-' ||
        upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
        INSERT INTO public.licences (entreprise_id, cle_licence, date_debut, date_fin, statut, created_by)
        VALUES (v_entreprise_id, v_cle, CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 'active', NEW.id);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN NEW;
END;
$$;
