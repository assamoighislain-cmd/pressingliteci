-- Migration: Demo licence type (30 days auto-activated on company creation)
-- + Fixed Super Admin Web Push trigger using app_settings supabase_anon_key (works even when app is closed)

-- 1. Ensure type_licence column allows 'demo' and 'annuelle'
ALTER TABLE public.licences
  ADD COLUMN IF NOT EXISTS type_licence text NOT NULL DEFAULT 'annuelle';

ALTER TABLE public.licences
  DROP CONSTRAINT IF EXISTS licences_type_licence_check;

ALTER TABLE public.licences
  ADD CONSTRAINT licences_type_licence_check
  CHECK (type_licence IN ('demo', 'annuelle'));

-- 2. Auto-activate a 30-day Demo licence on every company creation via auth.users signup trigger
CREATE OR REPLACE FUNCTION public.handle_new_entreprise_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_nom text;
  v_full_name text;
  v_contact text;
  v_lat double precision;
  v_lng double precision;
  v_ent_id bigint;
  v_key text;
BEGIN
  v_nom := trim(COALESCE(NEW.raw_user_meta_data ->> 'entreprise_nom', ''));
  v_full_name := NULLIF(trim(COALESCE(NEW.raw_user_meta_data ->> 'full_name', '')), '');
  v_contact := NULLIF(trim(COALESCE(NEW.raw_user_meta_data ->> 'contact', '')), '');

  BEGIN
    v_lat := NULLIF(trim(COALESCE(NEW.raw_user_meta_data ->> 'gps_latitude', '')), '')::double precision;
    v_lng := NULLIF(trim(COALESCE(NEW.raw_user_meta_data ->> 'gps_longitude', '')), '')::double precision;
  EXCEPTION WHEN others THEN
    v_lat := NULL;
    v_lng := NULL;
  END;

  IF v_nom = '' THEN
    RETURN NEW;
  END IF;

  -- Skip if user already belongs to an entreprise
  IF EXISTS (SELECT 1 FROM public.entreprise_members WHERE user_id = NEW.id) THEN
    RETURN NEW;
  END IF;

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

-- 3. Also ensure signup_create_entreprise RPC activates the 30-day Demo licence
CREATE OR REPLACE FUNCTION public.signup_create_entreprise(entreprise_nom text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_ent_id bigint;
  v_key text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifié';
  END IF;

  IF EXISTS (SELECT 1 FROM public.entreprise_members WHERE user_id = v_user_id) THEN
    SELECT id INTO v_ent_id FROM public.entreprise WHERE user_id = v_user_id LIMIT 1;
  ELSE
    INSERT INTO public.entreprise (user_id, nom, statut)
    VALUES (v_user_id, trim(entreprise_nom), 'pending')
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

-- 4. Update ensure_trial_licence to explicitly create a 30-day Demo licence (type_licence = 'demo', prix = 0)
DROP FUNCTION IF EXISTS public.ensure_trial_licence();
CREATE OR REPLACE FUNCTION public.ensure_trial_licence()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant_id uuid;
  v_ent_id bigint;
  v_key text;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM public.entreprise_members
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    v_tenant_id := auth.uid();
  END IF;

  SELECT id INTO v_ent_id
  FROM public.entreprise
  WHERE user_id = v_tenant_id
  LIMIT 1;

  IF v_ent_id IS NULL THEN
    RETURN;
  END IF;

  v_key := 'DEMO-' || to_char(CURRENT_DATE, 'YYYY') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  INSERT INTO public.licences (entreprise_id, cle_licence, date_debut, date_fin, statut, type_licence, prix, created_by)
  VALUES (v_ent_id, v_key, CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 'active', 'demo', 0, auth.uid())
  ON CONFLICT (entreprise_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_trial_licence() TO authenticated;

-- 5. Update create_entreprise_admin to explicitly activate a 30-day Demo licence
DROP FUNCTION IF EXISTS public.create_entreprise_admin(text, text);
CREATE OR REPLACE FUNCTION public.create_entreprise_admin(admin_email text, entreprise_nom text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  target_user_id uuid;
  new_ent_id bigint;
  v_key text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Accès refusé';
  END IF;

  SELECT id INTO target_user_id FROM auth.users WHERE lower(email) = lower(trim(admin_email));
  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'Aucun compte trouvé avec cet email';
  END IF;

  INSERT INTO public.entreprise (user_id, nom, statut)
  VALUES (target_user_id, trim(entreprise_nom), 'active')
  ON CONFLICT (user_id) DO UPDATE SET nom = EXCLUDED.nom
  RETURNING id INTO new_ent_id;

  INSERT INTO public.entreprise_members (tenant_id, user_id, role)
  VALUES (target_user_id, target_user_id, 'admin')
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'admin';

  v_key := 'DEMO-' || to_char(CURRENT_DATE, 'YYYY') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  INSERT INTO public.licences (entreprise_id, cle_licence, date_debut, date_fin, statut, type_licence, prix, created_by)
  VALUES (new_ent_id, v_key, CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 'active', 'demo', 0, auth.uid())
  ON CONFLICT (entreprise_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_entreprise_admin(text, text) TO authenticated;

-- 6. Update generate_licence RPC to support p_type_licence ('demo' | 'annuelle') and upsert safely
CREATE OR REPLACE FUNCTION public.generate_licence(
  p_entreprise_id bigint,
  p_date_debut date,
  p_date_fin date,
  p_prix numeric DEFAULT 100000,
  p_type_licence text DEFAULT 'annuelle'
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_type text := CASE WHEN p_type_licence = 'demo' THEN 'demo' ELSE 'annuelle' END;
  v_prefix text := CASE WHEN p_type_licence = 'demo' THEN 'DEMO' ELSE 'PRS' END;
  v_key text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Accès refusé';
  END IF;

  v_key := v_prefix || '-' || to_char(COALESCE(p_date_debut, CURRENT_DATE), 'YYYY') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  INSERT INTO public.licences (entreprise_id, cle_licence, date_debut, date_fin, statut, type_licence, prix, created_by)
  VALUES (p_entreprise_id, v_key, p_date_debut, p_date_fin, 'active', v_type, COALESCE(p_prix, 0), auth.uid())
  ON CONFLICT (entreprise_id) DO UPDATE SET
    cle_licence = EXCLUDED.cle_licence,
    date_debut = EXCLUDED.date_debut,
    date_fin = EXCLUDED.date_fin,
    statut = 'active',
    type_licence = EXCLUDED.type_licence,
    prix = EXCLUDED.prix,
    created_by = EXCLUDED.created_by;

  RETURN v_key;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_licence(bigint, date, date, numeric, text) TO authenticated;

-- 7. Update get_licence_status to recognize both 'active' and 'demo' statuses
DROP FUNCTION IF EXISTS public.get_licence_status();
CREATE OR REPLACE FUNCTION public.get_licence_status()
RETURNS TABLE(statut text, date_fin date, type_licence text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM public.entreprise_members
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    v_tenant_id := auth.uid();
  END IF;

  RETURN QUERY
  SELECT l.statut, l.date_fin, l.type_licence
  FROM public.licences l
  JOIN public.entreprise e ON e.id = l.entreprise_id
  WHERE e.user_id = v_tenant_id
    AND l.statut IN ('active', 'demo')
    AND l.date_fin >= CURRENT_DATE
  ORDER BY l.date_fin DESC
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_licence_status() TO authenticated;

-- 8. Fix notify_new_entreprise trigger so Super Admin receives audible Web Push even when the app is closed
-- Uses supabase_anon_key from app_settings (since send-push-notification has verify_jwt = false)
CREATE OR REPLACE FUNCTION public.notify_new_entreprise()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_supabase_url text;
  v_anon_key text;
  v_payload jsonb;
BEGIN
  IF NEW.statut = 'pending' THEN
    SELECT value INTO v_supabase_url FROM public.app_settings WHERE key = 'supabase_url';
    SELECT value INTO v_anon_key FROM public.app_settings WHERE key = 'supabase_anon_key';

    IF v_supabase_url IS NOT NULL AND v_anon_key IS NOT NULL THEN
      v_payload := jsonb_build_object(
        'tenant_id', 'super_admin',
        'payload', jsonb_build_object(
          'title', 'Nouvelle entreprise à approuver',
          'body', COALESCE(NEW.nom, 'Nouvelle entreprise') || ' vient de s''inscrire (Licence Démo 30 jours) — en attente d''approbation',
          'icon', '/pwa-192x192.png',
          'badge', '/pwa-192x192.png',
          'tag', 'new-entreprise-' || NEW.user_id::text,
          'renotify', true,
          'requireInteraction', true,
          'silent', false,
          'vibrate', jsonb_build_array(300, 150, 300, 150, 400),
          'actions', jsonb_build_array(jsonb_build_object('action', 'open', 'title', 'Approuver')),
          'data', jsonb_build_object(
            'url', '/#/super-admin',
            'type', 'new_entreprise_approval',
            'entreprise_id', NEW.id,
            'entreprise_nom', NEW.nom
          )
        )
      );

      PERFORM net.http_post(
        url := v_supabase_url || '/functions/v1/send-push-notification',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_anon_key
        ),
        body := v_payload
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_new_entreprise_notify ON public.entreprise;
CREATE TRIGGER on_new_entreprise_notify
  AFTER INSERT ON public.entreprise
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_new_entreprise();
