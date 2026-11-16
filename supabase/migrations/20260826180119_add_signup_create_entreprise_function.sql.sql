/*
# Allow self-signup to create entreprise + admin membership atomically

The insert_membership_admin policy requires is_tenant_admin(tenant_id),
which fails at signup time because the user isn't a member yet (chicken-and-egg).
This SECURITY DEFINER function bypasses RLS to create both the entreprise row
and the admin membership in one atomic call.
*/

CREATE OR REPLACE FUNCTION public.signup_create_entreprise(entreprise_nom text)
RETURNS void AS $$
DECLARE
  uid uuid := auth.uid();
  existing_entreprise record;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifié';
  END IF;

  -- Check if user already has an entreprise
  SELECT * INTO existing_entreprise FROM public.entreprise WHERE user_id = uid;

  IF FOUND THEN
    -- Update name if already exists
    UPDATE public.entreprise SET nom = entreprise_nom WHERE user_id = uid;
  ELSE
    -- Create entreprise
    INSERT INTO public.entreprise (user_id, nom)
    VALUES (uid, entreprise_nom);
  END IF;

  -- Add user as admin member (upsert to handle re-runs)
  INSERT INTO public.entreprise_members (tenant_id, user_id, role)
  VALUES (uid, uid, 'admin')
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'admin';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.signup_create_entreprise(text) TO authenticated;
