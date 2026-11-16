/*
# Add 'pending' statut for new entreprises + push notification trigger on signup

1. Changes
- Add 'pending' to the entreprise statut CHECK constraint (new self-registered entreprises start as 'pending')
- Update the signup trigger to set statut='pending' on new entreprises created via self-registration
- Add a database trigger that calls the send-push-notification edge function when a new entreprise is inserted,
  targeting tenant_id='super_admin' so the super admin receives a push notification even when the app is closed.

2. Security
- The trigger function is SECURITY DEFINER with search_path=public.
- Uses pg_net for async HTTP call to the edge function.
- No new tables or policies.

3. Notes
- The super admin's push subscriptions are stored with tenant_id='super_admin'.
- The constraint is dropped and recreated to include 'pending'.
- Existing entreprises keep their current statut (no data migration needed).
*/

-- 1. Update the CHECK constraint to allow 'pending'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'entreprise_statut_check'
  ) THEN
    ALTER TABLE entreprise DROP CONSTRAINT entreprise_statut_check;
  END IF;
END $$;

ALTER TABLE entreprise ADD CONSTRAINT entreprise_statut_check
  CHECK (statut IN ('active', 'demo', 'suspended', 'pending'));

-- 2. Update the signup trigger function to set statut='pending' for self-registered entreprises
CREATE OR REPLACE FUNCTION public.handle_new_entreprise_signup()
RETURNS trigger AS $$
DECLARE
  ent_nom text;
BEGIN
  ent_nom := NEW.raw_user_meta_data->>'entreprise_nom';
  
  IF ent_nom IS NOT NULL AND ent_nom <> '' THEN
    INSERT INTO public.entreprise (user_id, nom, statut)
    VALUES (NEW.id, ent_nom, 'pending')
    ON CONFLICT (user_id) DO UPDATE SET nom = EXCLUDED.nom;
    
    INSERT INTO public.entreprise_members (tenant_id, user_id, role)
    VALUES (NEW.id, NEW.id, 'admin')
    ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'admin';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 3. Trigger function to notify super admin of new entreprise
CREATE OR REPLACE FUNCTION public.notify_new_entreprise()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supabase_url text;
  v_service_key text;
BEGIN
  -- Get the Supabase URL from app_settings
  SELECT value INTO v_supabase_url FROM app_settings WHERE key = 'supabase_url';
  IF v_supabase_url IS NULL THEN
    v_supabase_url := current_setting('app.supabase_url', true);
  END IF;

  v_service_key := current_setting('app.supabase_service_role_key', true);

  IF v_supabase_url IS NOT NULL AND v_service_key IS NOT NULL THEN
    PERFORM net.http_post(
      url := v_supabase_url || '/functions/v1/send-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body := jsonb_build_object(
        'tenant_id', 'super_admin',
        'payload', jsonb_build_object(
          'title', 'Nouvelle entreprise',
          'body', NEW.nom || ' vient de s''inscrire — à valider',
          'icon', '/pwa-192x192.png',
          'badge', '/pwa-192x192.png',
          'tag', 'new-entreprise-' || NEW.id::text,
          'data', jsonb_build_object(
            'url', '/#/super-admin'
          )
        )
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_entreprise_insert_notify_push ON entreprise;
CREATE TRIGGER on_entreprise_insert_notify_push
  AFTER INSERT ON entreprise
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_new_entreprise();
