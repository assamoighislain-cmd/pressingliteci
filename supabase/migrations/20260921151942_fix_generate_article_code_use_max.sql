/*
# Fix generate_article_code to use MAX(code) instead of counter table

Same root cause as generate_client_code: the counter table has a per-user
primary key, but the function updates by tenant_id across multiple rows.
Rewrite to compute the next code from MAX(code) among existing articles.
*/

CREATE OR REPLACE FUNCTION public.generate_article_code()
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

  SELECT COALESCE(MAX(
    CASE
      WHEN code ~ '^A-[0-9]+$'
        THEN CAST(SUBSTRING(code FROM 3) AS integer)
      ELSE 0
    END
  ), 0)
  INTO max_num
  FROM articles
  WHERE tenant_id = tid;

  next_num := max_num + 1;
  code_str := 'A-' || lpad(next_num::text, 4, '0');

  UPDATE code_counter SET article_counter = next_num
    WHERE id = 1 AND tenant_id = tid;

  RETURN code_str;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.generate_article_code() TO authenticated;
