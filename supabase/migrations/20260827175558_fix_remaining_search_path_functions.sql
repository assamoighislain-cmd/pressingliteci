-- Fix remaining SECURITY DEFINER functions with mutable search_path

ALTER FUNCTION public.add_admin_to_entreprise(text, uuid) SET search_path = public;
ALTER FUNCTION public.add_member_to_entreprise(text, uuid, text) SET search_path = public;
ALTER FUNCTION public.create_entreprise_admin(text, text) SET search_path = public;
ALTER FUNCTION public.delete_entreprise(integer) SET search_path = public;
ALTER FUNCTION public.ensure_trial_licence() SET search_path = public;
ALTER FUNCTION public.generate_licence(integer, date, date) SET search_path = public;
ALTER FUNCTION public.get_member_emails(uuid[]) SET search_path = public;
ALTER FUNCTION public.increment_depot_counter() SET search_path = public;
ALTER FUNCTION public.is_super_admin() SET search_path = public;
ALTER FUNCTION public.revoke_licence(uuid) SET search_path = public;
