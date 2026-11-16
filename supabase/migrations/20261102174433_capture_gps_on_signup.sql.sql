/*
# Capture GPS coordinates during entreprise signup

1. Changes
- Update handle_new_entreprise_signup() trigger function to read gps_latitude and gps_longitude
  from the user's raw_user_meta_data and store them in the entreprise row.
- Preserves the pending statut, trial licence creation, and full_name/contact passthrough
  from the previous version.

2. Notes
- The frontend sets options.data.gps_latitude and gps_longitude during signUp().
- If the user denies geolocation, the values are null and the columns remain null.
- The trigger is idempotent and handles ON CONFLICT for re-runs.
*/

CREATE OR REPLACE FUNCTION public.handle_new_entreprise_signup()
RETURNS trigger AS $$
DECLARE
  ent_nom text;
  fname text;
  phone text;
  v_lat double precision;
  v_lng double precision;
  v_entreprise_id integer;
  v_cle text;
BEGIN
  ent_nom := NEW.raw_user_meta_data->>'entreprise_nom';
  fname := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'nom_prenoms');
  phone := NEW.raw_user_meta_data->>'contact';
  v_lat := NULLIF(NEW.raw_user_meta_data->>'gps_latitude', '')::double precision;
  v_lng := NULLIF(NEW.raw_user_meta_data->>'gps_longitude', '')::double precision;

  IF ent_nom IS NOT NULL AND ent_nom <> '' THEN
    -- Create entreprise with pending statut and GPS coords
    INSERT INTO public.entreprise (user_id, nom, statut, latitude, longitude)
    VALUES (NEW.id, ent_nom, 'pending', v_lat, v_lng)
    ON CONFLICT (user_id) DO UPDATE SET nom = EXCLUDED.nom, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude
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
      NULL;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
