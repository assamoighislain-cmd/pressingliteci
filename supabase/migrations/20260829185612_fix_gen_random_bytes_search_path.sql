-- Fix search_path on functions using gen_random_bytes to include the extensions schema
-- where pgcrypto's gen_random_bytes actually lives.

ALTER FUNCTION public.generate_licence(integer, date, date) SET search_path = public, extensions;
ALTER FUNCTION public.ensure_trial_licence() SET search_path = public, extensions;
ALTER FUNCTION public.handle_new_entreprise_signup() SET search_path = public, extensions;
ALTER FUNCTION public.create_entreprise_admin(text, text) SET search_path = public, extensions;
