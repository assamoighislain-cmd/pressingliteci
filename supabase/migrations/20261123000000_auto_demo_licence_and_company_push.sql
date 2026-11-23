-- Migration: Automatic 30-day Demo licence on every new company + Web Push notification to the company
-- Safe & idempotent: guarantees that ANY newly created company receives a 30-day Demo licence
-- and receives a Web Push notification announcing its automatic 30-day Demo licence.

-- 1. Ensure licences table supports 'demo' type_licence
ALTER TABLE public.licences
  ADD COLUMN IF NOT EXISTS type_licence text NOT NULL DEFAULT 'annuelle';

ALTER TABLE public.licences
  DROP CONSTRAINT IF EXISTS licences_type_licence_check;

ALTER TABLE public.licences
  ADD CONSTRAINT licences_type_licence_check
  CHECK (type_licence IN ('demo', 'annuelle'));

-- 2. Universal safety trigger on public.entreprise INSERT:
--    Guarantees every newly created company automatically gets a 30-day Demo licence (0 FCFA)
CREATE OR REPLACE FUNCTION public.auto_create_demo_30d_licence_for_entreprise()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_key text;
BEGIN
  v_key := 'DEMO-' || to_char(CURRENT_DATE, 'YYYY') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text || NEW.id::text), 1, 8));

  INSERT INTO public.licences (
    entreprise_id,
    cle_licence,
    date_debut,
    date_fin,
    statut,
    type_licence,
    prix,
    created_by
  )
  VALUES (
    NEW.id,
    v_key,
    CURRENT_DATE,
    CURRENT_DATE + INTERVAL '30 days',
    'active',
    'demo',
    0,
    NEW.user_id
  )
  ON CONFLICT (entreprise_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_entreprise_auto_demo_30d_licence ON public.entreprise;
CREATE TRIGGER trg_entreprise_auto_demo_30d_licence
  AFTER INSERT ON public.entreprise
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_demo_30d_licence_for_entreprise();

-- 3. Server-side Web Push notification sent directly to the newly created company
--    when its 30-day Demo licence is activated (on licence creation OR company approval)
CREATE OR REPLACE FUNCTION public.notify_company_demo_licence_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_supabase_url text;
  v_anon_key text;
  v_ent_nom text;
  v_tenant_user_id uuid;
  v_date_fin date;
  v_payload jsonb;
BEGIN
  IF TG_TABLE_NAME = 'licences' THEN
    IF NEW.type_licence <> 'demo' THEN
      RETURN NEW;
    END IF;
    SELECT nom, user_id INTO v_ent_nom, v_tenant_user_id
    FROM public.entreprise
    WHERE id = NEW.entreprise_id
    LIMIT 1;
    v_date_fin := NEW.date_fin;
  ELSIF TG_TABLE_NAME = 'entreprise' THEN
    -- Fire when Super Admin validates a newly created pending company
    IF NOT (OLD.statut = 'pending' AND NEW.statut IN ('active', 'demo')) THEN
      RETURN NEW;
    END IF;
    v_ent_nom := NEW.nom;
    v_tenant_user_id := NEW.user_id;
    SELECT date_fin INTO v_date_fin
    FROM public.licences
    WHERE entreprise_id = NEW.id AND type_licence = 'demo'
    ORDER BY date_fin DESC
    LIMIT 1;
    IF v_date_fin IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  IF v_tenant_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT value INTO v_supabase_url FROM public.app_settings WHERE key = 'supabase_url';
  SELECT value INTO v_anon_key FROM public.app_settings WHERE key = 'supabase_anon_key';

  IF v_supabase_url IS NOT NULL AND v_anon_key IS NOT NULL THEN
    v_payload := jsonb_build_object(
      'tenant_id', v_tenant_user_id::text,
      'payload', jsonb_build_object(
        'title', 'Licence Démo 30 jours activée !',
        'body', 'Bienvenue ' || COALESCE(NULLIF(trim(v_ent_nom), ''), 'PressingLite') ||
                ' ! Votre nouvelle entreprise bénéficie automatiquement d''une licence Démo gratuite de 30 jours (valable jusqu''au ' ||
                to_char(v_date_fin, 'DD/MM/YYYY') || ').',
        'icon', '/pwa-192x192.png',
        'badge', '/pwa-192x192.png',
        'tag', 'demo-licence-30d-' || v_tenant_user_id::text,
        'renotify', true,
        'requireInteraction', true,
        'silent', false,
        'vibrate', jsonb_build_array(250, 120, 250, 120, 350),
        'data', jsonb_build_object(
          'url', '/',
          'type', 'demo_licence_activated',
          'entreprise_nom', COALESCE(v_ent_nom, 'PressingLite'),
          'date_fin', v_date_fin
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_company_demo_licence_on_insert ON public.licences;
CREATE TRIGGER trg_notify_company_demo_licence_on_insert
  AFTER INSERT ON public.licences
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_company_demo_licence_push();

DROP TRIGGER IF EXISTS trg_notify_company_demo_licence_on_approve ON public.entreprise;
CREATE TRIGGER trg_notify_company_demo_licence_on_approve
  AFTER UPDATE OF statut ON public.entreprise
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_company_demo_licence_push();
