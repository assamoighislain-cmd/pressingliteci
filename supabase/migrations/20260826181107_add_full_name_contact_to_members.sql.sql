/*
# Add full_name and contact to entreprise_members
*/

ALTER TABLE public.entreprise_members
  ADD COLUMN IF NOT EXISTS full_name text,
  ADD COLUMN IF NOT EXISTS contact text;

-- Update the signup trigger to also store full_name and contact
CREATE OR REPLACE FUNCTION public.handle_new_entreprise_signup()
RETURNS trigger AS $$
DECLARE
  ent_nom text;
  fname text;
  phone text;
BEGIN
  ent_nom := NEW.raw_user_meta_data->>'entreprise_nom';
  fname := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'nom_prenoms');
  phone := NEW.raw_user_meta_data->>'contact';
  
  IF ent_nom IS NOT NULL AND ent_nom <> '' THEN
    INSERT INTO public.entreprise (user_id, nom)
    VALUES (NEW.id, ent_nom)
    ON CONFLICT (user_id) DO UPDATE SET nom = EXCLUDED.nom;
    
    INSERT INTO public.entreprise_members (tenant_id, user_id, role, full_name, contact)
    VALUES (NEW.id, NEW.id, 'admin', fname, phone)
    ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'admin', full_name = EXCLUDED.full_name, contact = EXCLUDED.contact;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate get_member_emails with additional columns
DROP FUNCTION IF EXISTS public.get_member_emails(uuid[]);
CREATE FUNCTION public.get_member_emails(user_ids uuid[])
RETURNS TABLE(user_id uuid, email text, full_name text, contact text) AS $$
BEGIN
  RETURN QUERY
    SELECT u.id, u.email, em.full_name, em.contact
    FROM auth.users u
    LEFT JOIN public.entreprise_members em ON em.user_id = u.id
    WHERE u.id = ANY(user_ids);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
