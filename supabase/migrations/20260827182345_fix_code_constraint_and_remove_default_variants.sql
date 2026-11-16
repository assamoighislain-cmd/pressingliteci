/*
# Fix duplicate article/client code constraint + remove auto-created variants

## Problem 1: Global unique constraint on articles.code and clients.code
The `articles_code_key` and `clients_code_key` constraints enforce uniqueness
across ALL tenants. But each tenant has its own counter starting from 0, so
tenant 2 generates A-0001 which collides with tenant 1's A-0001.

## Fix: Replace global unique with per-tenant unique (code, tenant_id)

## Problem 2: Auto-created "Standard" variants
The variants migration backfilled every article with a "Standard" variant,
but articles can have zero variants. Remove the backfilled "Standard" variants
so articles start with no variants.
*/

-- Fix articles code constraint: drop global, add per-tenant
ALTER TABLE articles DROP CONSTRAINT IF EXISTS articles_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS articles_code_tenant_idx
  ON articles (code, tenant_id);

-- Fix clients code constraint: drop global, add per-tenant
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS clients_code_tenant_idx
  ON clients (code, tenant_id);

-- Remove the auto-created "Standard" variants — articles should start with zero variants
DELETE FROM article_variants WHERE designation = 'Standard';
