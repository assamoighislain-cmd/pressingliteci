/*
# Allow super-admin to add members to any entreprise

Adds a function add_member_to_entreprise() that lets the super-admin
add a user (by email) to any entreprise with any role (admin/gerant/commercial).
*/

CREATE OR REPLACE FUNCTION public.add_member_to_entreprise(member_email text, target_tenant_id uuid, member_role text)
RETURNS uuid AS $$
DECLARE
  uid uuid := auth.uid();
  member_uid uuid;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Seul le super-administrateur peut ajouter des membres';
  END IF;

  IF member_role NOT IN ('admin', 'gerant', 'commercial') THEN
    RAISE EXCEPTION 'Rôle invalide';
  END IF;

  SELECT id INTO member_uid FROM auth.users WHERE email = member_email;
  IF member_uid IS NULL THEN
    RAISE EXCEPTION 'Utilisateur introuvable. La personne doit d''abord créer un compte avec cet email.';
  END IF;

  INSERT INTO entreprise_members (tenant_id, user_id, role)
  VALUES (target_tenant_id, member_uid, member_role)
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role
  RETURNING user_id INTO member_uid;

  RETURN member_uid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.add_member_to_entreprise(text, uuid, text) TO authenticated;
