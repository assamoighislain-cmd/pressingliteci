/*
# Fix code generation functions for non-admin users (commercial, gerant, collecteur)

## Problem
The `generate_client_code` and `generate_article_code` functions look up the
code_counter row by `user_id = auth.uid()`. This only works for the admin who
originally created the counter. Non-admin team members (commercial, gerant,
collecteur) have a different `auth.uid()` and no matching row, so the UPDATE
returns NULL and the function fails silently.

## Fix
Rewrite both functions to use `get_tenant_id()` (which works for all team
members) and look up the counter row by `tenant_id` instead of `user_id`.
This mirrors how `generate_traitement_code` already works.

## Changes
1. `generate_client_code()` — use tenant_id to find/create the counter row
2. `generate_article_code()` — same fix

## Security
No RLS changes. Functions are SECURITY DEFINER and already bypass RLS.
*/

CREATE OR REPLACE FUNCTION public.generate_client_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  tid uuid;
  next_num integer;
  code_str text;
BEGIN
  tid := public.get_tenant_id();

  INSERT INTO code_counter (id, user_id, tenant_id, client_counter, article_counter, traitement_counter)
  VALUES (1, uid, tid, 0, 0, 0)
  ON CONFLICT (id, user_id) DO NOTHING;

  LOOP
    UPDATE code_counter SET client_counter = client_counter + 1
    WHERE id = 1 AND tenant_id = tid
    RETURNING client_counter INTO next_num;

    IF next_num IS NULL THEN
      -- Row exists with different user_id; update by tenant_id
      UPDATE code_counter SET client_counter = client_counter + 1
      WHERE id = 1 AND tenant_id = tid AND user_id <> uid
      RETURNING client_counter INTO next_num;
    END IF;

    code_str := 'C-' || lpad(next_num::text, 4, '0');

    IF NOT EXISTS (SELECT 1 FROM clients WHERE code = code_str AND tenant_id = tid) THEN
      EXIT;
    END IF;
  END LOOP;

  RETURN code_str;
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_article_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  tid uuid;
  next_num integer;
  code_str text;
BEGIN
  tid := public.get_tenant_id();

  INSERT INTO code_counter (id, user_id, tenant_id, client_counter, article_counter, traitement_counter)
  VALUES (1, uid, tid, 0, 0, 0)
  ON CONFLICT (id, user_id) DO NOTHING;

  LOOP
    UPDATE code_counter SET article_counter = article_counter + 1
    WHERE id = 1 AND tenant_id = tid
    RETURNING article_counter INTO next_num;

    IF next_num IS NULL THEN
      UPDATE code_counter SET article_counter = article_counter + 1
      WHERE id = 1 AND tenant_id = tid AND user_id <> uid
      RETURNING article_counter INTO next_num;
    END IF;

    code_str := 'A-' || lpad(next_num::text, 4, '0');

    IF NOT EXISTS (SELECT 1 FROM articles WHERE code = code_str AND tenant_id = tid) THEN
      EXIT;
    END IF;
  END LOOP;

  RETURN code_str;
END;
$function$;
