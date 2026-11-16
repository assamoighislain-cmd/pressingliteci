/*
# Fix generate_client_code to use MAX(code) instead of counter table

## Problem
The code_counter table has a primary key on (id, user_id), so each team member
gets their own row. The generate_client_code function updates by tenant_id,
which matches multiple rows, corrupts counters, and produces codes that
collide with existing clients — causing "duplicate key value violates
unique constraint clients_code_tenant_idx".

## Fix
Rewrite generate_client_code to compute the next code from the actual MAX(code)
among existing clients for the tenant. This is race-safe because the unique
index on (code, tenant_id) will reject any collision, and the client-side
code retries on failure. The counter table is no longer used for clients.
*/

CREATE OR REPLACE FUNCTION public.generate_client_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  tid uuid;
  max_num integer := 0;
  next_num integer;
  code_str text;
BEGIN
  tid := public.get_tenant_id();

  -- Find the highest existing client code number for this tenant
  SELECT COALESCE(MAX(
    CASE
      WHEN code ~ '^C-[0-9]+$'
        THEN CAST(SUBSTRING(code FROM 3) AS integer)
      ELSE 0
    END
  ), 0)
  INTO max_num
  FROM clients
  WHERE tenant_id = tid;

  next_num := max_num + 1;
  code_str := 'C-' || lpad(next_num::text, 4, '0');

  -- Sync the counter table for display purposes (best-effort, ignore failures)
  UPDATE code_counter SET client_counter = next_num
    WHERE id = 1 AND tenant_id = tid;

  RETURN code_str;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.generate_client_code() TO authenticated;
