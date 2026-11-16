/*
# Add database trigger to send push notifications on new orders

1. New Functions
- `notify_new_order()` — a trigger function that calls the `send-push-notification` edge function
  via `pg_net.http_post` when a new depot with statut='COMMANDE' is inserted.

2. New Triggers
- `on_depot_insert_notify_push` — fires AFTER INSERT on `depots` when statut = 'COMMANDE'

3. Notes
- Uses `pg_net` extension (already available in Supabase) for async HTTP calls.
- The edge function URL is constructed from the Supabase project URL.
- The service role key is passed for authentication.
- The trigger is idempotent and only fires for COMMANDE status.
*/

-- Ensure pg_net extension is available
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.notify_new_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supabase_url text;
  v_service_key text;
  v_client_name text;
BEGIN
  -- Only notify for new orders (COMMANDE status)
  IF NEW.statut <> 'COMMANDE' THEN
    RETURN NEW;
  END IF;

  -- Get the client name if possible
  SELECT nom INTO v_client_name FROM clients WHERE id = NEW.client_id;

  -- Get the Supabase URL and service role key from app_settings
  SELECT value INTO v_supabase_url FROM app_settings WHERE key = 'supabase_url';
  IF v_supabase_url IS NULL THEN
    v_supabase_url := current_setting('app.supabase_url', true);
  END IF;

  v_service_key := current_setting('app.supabase_service_role_key', true);

  -- Call the edge function asynchronously via pg_net
  IF v_supabase_url IS NOT NULL AND v_service_key IS NOT NULL THEN
    PERFORM net.http_post(
      url := v_supabase_url || '/functions/v1/send-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
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

DROP TRIGGER IF EXISTS on_depot_insert_notify_push ON depots;
CREATE TRIGGER on_depot_insert_notify_push
  AFTER INSERT ON depots
  FOR EACH ROW
  WHEN (NEW.statut = 'COMMANDE')
  EXECUTE FUNCTION public.notify_new_order();
