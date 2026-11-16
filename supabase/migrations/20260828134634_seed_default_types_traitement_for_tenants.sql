-- Seed default treatment types for tenants that have none.
-- Without these, the treatment dropdown on the depot form is empty
-- and users cannot create deposits.

INSERT INTO public.types_traitement (code, libelle, coefficient, nb_jours, tenant_id, user_id)
SELECT
  'NORMAL' || '-' || substr(e.user_id::text, 1, 8),
  'NORMAL',
  1.0,
  1,
  e.user_id,
  e.user_id
FROM public.entreprise e
WHERE NOT EXISTS (SELECT 1 FROM public.types_traitement tt WHERE tt.tenant_id = e.user_id);

-- Add EXPRESS (coefficient 1.5, 1 day) for tenants with none
INSERT INTO public.types_traitement (code, libelle, coefficient, nb_jours, tenant_id, user_id)
SELECT
  'EXPRESS' || '-' || substr(e.user_id::text, 1, 8),
  'EXPRESS',
  1.5,
  1,
  e.user_id,
  e.user_id
FROM public.entreprise e
WHERE NOT EXISTS (
  SELECT 1 FROM public.types_traitement tt
  WHERE tt.tenant_id = e.user_id AND tt.libelle = 'EXPRESS'
);