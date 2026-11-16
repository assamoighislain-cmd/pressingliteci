/*
# Fix depots unique constraint to be boutique-scoped

The next_depot_numero function generates sequential numbers per (tenant, boutique),
but the unique constraint was only (tenant_id, numero). This caused duplicate key
errors when a tenant has multiple boutiques — each boutique would generate "D-0001"
and the second insert would fail.

1. Drop the old unique constraint (tenant_id, numero)
2. Add new unique constraint (tenant_id, boutique_id, numero)
*/

ALTER TABLE depots DROP CONSTRAINT IF EXISTS depots_numero_tenant_key;

ALTER TABLE depots ADD CONSTRAINT depots_numero_tenant_boutique_key
  UNIQUE (tenant_id, boutique_id, numero);
