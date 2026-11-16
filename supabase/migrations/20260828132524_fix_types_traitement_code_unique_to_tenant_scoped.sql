-- Drop the global unique constraint on types_traitement.code
-- and replace it with a tenant-scoped unique constraint so that
-- different tenants can have the same code (e.g. T-0001) without collision.

ALTER TABLE public.types_traitement
  DROP CONSTRAINT IF EXISTS types_traitement_code_key;

ALTER TABLE public.types_traitement
  ADD CONSTRAINT types_traitement_tenant_code_key
  UNIQUE (tenant_id, code);