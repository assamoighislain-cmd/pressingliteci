/*
# Store Supabase URL in app_settings for push notification trigger

1. Modified Tables
- `app_settings` — adds the Supabase project URL so the DB trigger can call the edge function.

2. Notes
- The edge function has verify_jwt=false, so the anon key is sufficient.
- The anon key is stored as a setting for the trigger to use.
*/

INSERT INTO app_settings (key, value) VALUES
  ('supabase_url', 'https://jijjtwmobfzkwzkozjyb.supabase.co'),
  ('supabase_anon_key', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imppamp0d21vYmZ6a3d6a296anliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MzI5MzUsImV4cCI6MjEwMzAwODkzNX0.uPb8rJXJVtEohNggAcwINsiB3VKLO8OKNNM4rX2UO7s')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
