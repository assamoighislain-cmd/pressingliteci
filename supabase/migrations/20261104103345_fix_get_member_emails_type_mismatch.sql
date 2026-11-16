-- Fix: get_member_emails return type mismatch
-- auth.users.email is varchar(255), not text. Cast explicitly to match.
-- Also auth.users.id is uuid, so that's fine. The email column type
-- mismatch caused "structure of query does not match function result type".

CREATE OR REPLACE FUNCTION public.get_member_emails(user_ids uuid[])
RETURNS TABLE(user_id uuid, email text, full_name text, contact text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT u.id, u.email::text, em.full_name, em.contact
  FROM auth.users u
  LEFT JOIN public.entreprise_members em ON em.user_id = u.id
  WHERE u.id = ANY(user_ids);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_member_emails(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_member_emails(uuid[]) TO authenticated;
