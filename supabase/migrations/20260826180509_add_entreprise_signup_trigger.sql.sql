/*
# Auto-create entreprise + admin membership on signup via trigger

The client-side RPC approach fails because data.user can be null after signUp,
or the session isn't established yet. A database trigger on auth.users
fires reliably on insert regardless of client state.
*/

-- Function that runs when a new auth user is created
CREATE OR REPLACE FUNCTION public.handle_new_entreprise_signup()
RETURNS trigger AS $$
DECLARE
  ent_nom text;
BEGIN
  ent_nom := NEW.raw_user_meta_data->>'entreprise_nom';
  
  IF ent_nom IS NOT NULL AND ent_nom <> '' THEN
    -- Create entreprise if it doesn't exist
    INSERT INTO public.entreprise (user_id, nom)
    VALUES (NEW.id, ent_nom)
    ON CONFLICT (user_id) DO UPDATE SET nom = EXCLUDED.nom;
    
    -- Add user as admin member
    INSERT INTO public.entreprise_members (tenant_id, user_id, role)
    VALUES (NEW.id, NEW.id, 'admin')
    ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'admin';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: fires after a new user is inserted into auth.users
DROP TRIGGER IF EXISTS on_auth_user_created_entreprise ON auth.users;
CREATE TRIGGER on_auth_user_created_entreprise
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_entreprise_signup();
