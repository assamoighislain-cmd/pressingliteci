-- The portal_create_depot function accumulated 4 overloads from successive migrations.
-- When the client calls it via Supabase RPC with all named parameters, PostgreSQL cannot
-- unambiguously resolve which overload to invoke, causing the order submission to fail.
-- Drop the 3 obsolete overloads, keeping only the full 16-parameter version (with delivery).

DROP FUNCTION IF EXISTS public.portal_create_depot(text, int, json, text, text);
DROP FUNCTION IF EXISTS public.portal_create_depot(text, int, json, text, text, uuid);
DROP FUNCTION IF EXISTS public.portal_create_depot(text, int, json, text, text, uuid, boolean, text, double precision, double precision);
