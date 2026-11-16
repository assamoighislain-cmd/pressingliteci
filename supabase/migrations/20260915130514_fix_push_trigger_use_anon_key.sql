/*
# Fix push notification trigger to use anon key from app_settings

1. Modified Functions
- `notify_new_order()` — now reads both the Supabase URL and anon key from app_settings
  instead of relying on session settings.

2. Notes
- The edge function has verify_jwt=false, so the anon key is sufficient for the HTTP call.
*/

CREATE OR REPLACE FUNCTION public.notify_new_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supabase_url text;
  v_anon_key text;
  v_client_name text;
BEGIN
  IF NEW.statut <> 'COMMANDE' THEN
    RETURN NEW;
  END IF;

  SELECT nom INTO v_client_name FROM clients WHERE id = NEW.client_id;

  SELECT value INTO v_supabase_url FROM app_settings WHERE key = 'supabase_url';
  SELECT value INTO v_anon_key FROM app_settings WHERE key = 'supabase_anon_key';

  IF v_supabase_url IS NOT NULL AND v_anon_key IS NOT NULL THEN
    PERFORM net.http_post(
      url := v_supabase_url || '/functions/v1/send-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_anon_key
      ),
      body := jsonb_build_object(
        'tenant_id', NEW.tenant_id,
        'payload', jsonb_build_object(
          'title', 'Nouvelle commande',
          'body', COALESCE(v_client_name, 'Client') || ' - ' || COALESCE(NEW.numero, 'Commande en attente'),
          'icon', '/pwa-192x192.png',
          'badge', '/pwa-192x192.png',
          'tag', 'new-order',
          'data', jsonb_build_object(
            'url', '/#/dashboard'
          )
        )
      )
    );
  END IF;

  RETURN NEW;
END;
$$;
