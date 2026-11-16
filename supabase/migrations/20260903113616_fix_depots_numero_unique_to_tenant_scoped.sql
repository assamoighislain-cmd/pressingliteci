-- The depots.numero column had a GLOBAL unique constraint,
-- but the depot counter generates numbers per-user (D-0001, D-0002, ...).
-- This causes a unique violation when a second tenant creates their first depot.
-- Fix: scope the uniqueness to (tenant_id, numero) so each tenant can have its own D-0001.

ALTER TABLE depots DROP CONSTRAINT IF EXISTS depots_numero_key;

ALTER TABLE depots ADD CONSTRAINT depots_numero_tenant_key UNIQUE (tenant_id, numero);
