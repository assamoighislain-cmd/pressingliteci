/*
# Make enterprise + membership creation robust in the signup trigger

The trigger was failing for some users because the licence insert inside the
trigger function could throw (e.g. unique constraint collision on cle_licence,
or other transient errors), which rolled back the entire trigger — leaving the
user without an entreprise row or membership. Without those, is_tenant_member()
returns false and every INSERT into business tables fails with
"new row violates row-level security policy".

Fix: separate the licence creation into its own sub-block with exception
handling so a licence failure never prevents entreprise + membership creation.
*/

CREATE OR REPLACE FUNCTION public.handle_new_entreprise_signup()
RETURNS trigger AS $$
DECLARE
  ent_nom text;
  fname text;
  phone text;
  v_entreprise_id integer;
  v_cle text;
BEGIN
  ent_nom := NEW.raw_user_meta_data->>'entreprise_nom';
  fname := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'nom_prenoms');
  phone := NEW.raw_user_meta_data->>'contact';

  IF ent_nom IS NOT NULL AND ent_nom <> '' THEN
    -- Create entreprise if it doesn't exist
    INSERT INTO public.entreprise (user_id, nom)
    VALUES (NEW.id, ent_nom)
    ON CONFLICT (user_id) DO UPDATE SET nom = EXCLUDED.nom
    RETURNING id INTO v_entreprise_id;

    -- Add user as admin member
    INSERT INTO public.entreprise_members (tenant_id, user_id, role, full_name, contact)
    VALUES (NEW.id, NEW.id, 'admin', fname, phone)
    ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'admin', full_name = EXCLUDED.full_name, contact = EXCLUDED.contact;

    -- Create a trial licence in a separate sub-block so a failure here
    -- never rolls back the entreprise + membership inserts above.
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM public.licences WHERE entreprise_id = v_entreprise_id) THEN
        v_cle := 'PRS-' || EXTRACT(YEAR FROM CURRENT_DATE)::text || '-' ||
          upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
        INSERT INTO public.licences (entreprise_id, cle_licence, date_debut, date_fin, statut, created_by)
        VALUES (v_entreprise_id, v_cle, CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 'active', NEW.id);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Licence creation is best-effort; don't fail the signup
      NULL;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
