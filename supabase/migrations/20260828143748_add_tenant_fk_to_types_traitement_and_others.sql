/*
# Add foreign keys linking tenant tables to entreprise

Previously, the tenant_id column on types_traitement, clients, articles,
modes_reglement, depenses, and depense_categories had no formal FK constraint
to entreprise.user_id. The link was purely logical (enforced only by RLS
policies via is_tenant_member). This migration adds real referential integrity.
*/

ALTER TABLE public.types_traitement
  ADD CONSTRAINT types_traitement_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.entreprise(user_id) ON DELETE CASCADE;

ALTER TABLE public.clients
  ADD CONSTRAINT clients_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.entreprise(user_id) ON DELETE CASCADE;

ALTER TABLE public.articles
  ADD CONSTRAINT articles_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.entreprise(user_id) ON DELETE CASCADE;

ALTER TABLE public.modes_reglement
  ADD CONSTRAINT modes_reglement_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.entreprise(user_id) ON DELETE CASCADE;

ALTER TABLE public.depenses
  ADD CONSTRAINT depenses_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.entreprise(user_id) ON DELETE CASCADE;

ALTER TABLE public.depense_categories
  ADD CONSTRAINT depense_categories_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.entreprise(user_id) ON DELETE CASCADE;
