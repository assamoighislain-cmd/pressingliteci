/*
# Fix mutable search_path on SECURITY DEFINER functions

The database linter flagged all SECURITY DEFINER functions as having a mutable
search_path. This can cause is_tenant_member() to fail to resolve the
`entreprise` or `entreprise_members` tables, returning false even for the
legitimate owner — which makes INSERT policies reject rows with
"new row violates row-level security policy".

Fix: add `SET search_path = public` to every SECURITY DEFINER function.
*/

ALTER FUNCTION public.get_tenant_id() SET search_path = public;
ALTER FUNCTION public.get_user_role() SET search_path = public;
ALTER FUNCTION public.is_tenant_member(uuid) SET search_path = public;
ALTER FUNCTION public.is_tenant_admin(uuid) SET search_path = public;
ALTER FUNCTION public.generate_client_code() SET search_path = public;
ALTER FUNCTION public.generate_article_code() SET search_path = public;
ALTER FUNCTION public.generate_traitement_code() SET search_path = public;
ALTER FUNCTION public.add_team_member(text, text) SET search_path = public;
ALTER FUNCTION public.signup_create_entreprise(text) SET search_path = public;
ALTER FUNCTION public.handle_new_entreprise_signup() SET search_path = public;
