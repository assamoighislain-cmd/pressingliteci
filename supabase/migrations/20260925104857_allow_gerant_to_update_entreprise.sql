-- Allow gérants to update the entreprise record, not just admins
CREATE OR REPLACE FUNCTION public.is_tenant_admin_or_gerant(t_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM entreprise WHERE user_id = auth.uid() AND user_id = t_id
  )
  OR EXISTS (
    SELECT 1 FROM entreprise_members em
    WHERE em.user_id = auth.uid()
      AND em.tenant_id = t_id
      AND em.role IN ('admin', 'gerant')
  );
$$;

-- Update the entreprise UPDATE policy to allow gérants
DROP POLICY IF EXISTS update_entreprise_admin ON public.entreprise;
CREATE POLICY update_entreprise_admin_or_gerant ON public.entreprise
  FOR UPDATE TO authenticated
  USING (is_super_admin() OR is_tenant_admin_or_gerant(user_id))
  WITH CHECK (is_super_admin() OR is_tenant_admin_or_gerant(user_id));
