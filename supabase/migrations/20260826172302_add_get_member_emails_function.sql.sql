/*
# Add function to get member emails (auth.users is not directly accessible via RLS)
*/
CREATE OR REPLACE FUNCTION public.get_member_emails(user_ids uuid[])
RETURNS TABLE (user_id uuid, email text) AS $$
BEGIN
  RETURN QUERY SELECT u.id, u.email FROM auth.users u WHERE u.id = ANY(user_ids);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_member_emails(uuid[]) TO authenticated;
