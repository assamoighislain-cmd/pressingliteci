-- Multi-Tenant & Multi-Boutique Long-Term Scalability & Performance Audit Migration
-- Idempotent composite indexes to keep RLS checks, boutique dashboards, history,
-- accounting, commissions, and offline pagination fast across hundreds of companies
-- and tens of thousands of deposits per boutique.

-- 1. Covering index on entreprise_members (queried on EVERY RLS evaluation)
CREATE INDEX IF NOT EXISTS idx_entreprise_members_user_tenant_role_boutique
  ON public.entreprise_members (user_id, tenant_id, role, boutique_id);

-- 2. Depots: composite multi-tenant + multi-boutique indexes for history, retrait, planning, stats, and commissions
CREATE INDEX IF NOT EXISTS idx_depots_tenant_boutique_date_depot
  ON public.depots (tenant_id, boutique_id, date_depot DESC, id);

CREATE INDEX IF NOT EXISTS idx_depots_tenant_boutique_statut_created
  ON public.depots (tenant_id, boutique_id, statut, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_depots_tenant_boutique_retrait_prevue
  ON public.depots (tenant_id, boutique_id, date_retrait_prevue, id);

CREATE INDEX IF NOT EXISTS idx_depots_tenant_client_date_depot
  ON public.depots (tenant_id, client_id, date_depot DESC);

CREATE INDEX IF NOT EXISTS idx_depots_boutique_numero
  ON public.depots (boutique_id, numero);

-- 3. Depot articles & avances: composite indexes for accounting, stats, and deposit details
CREATE INDEX IF NOT EXISTS idx_depot_articles_tenant_boutique_depot
  ON public.depot_articles (tenant_id, boutique_id, depot_id);

CREATE INDEX IF NOT EXISTS idx_depot_avances_tenant_boutique_date
  ON public.depot_avances (tenant_id, boutique_id, date_paiement DESC, id);

-- 4. Depenses & categories: composite multi-boutique indexes for accounting & monthly comparison
CREATE INDEX IF NOT EXISTS idx_depenses_tenant_boutique_date
  ON public.depenses (tenant_id, boutique_id, date_depense DESC, id);

CREATE INDEX IF NOT EXISTS idx_depense_categories_tenant_boutique
  ON public.depense_categories (tenant_id, boutique_id, libelle);

-- 5. Catalog, clients, loyalty, consumables, and relances
CREATE INDEX IF NOT EXISTS idx_clients_tenant_boutique_nom_id
  ON public.clients (tenant_id, boutique_id, nom, id);

CREATE INDEX IF NOT EXISTS idx_articles_tenant_boutique_designation
  ON public.articles (tenant_id, boutique_id, designation);

CREATE INDEX IF NOT EXISTS idx_article_variants_tenant_boutique_article
  ON public.article_variants (tenant_id, boutique_id, article_id);

CREATE INDEX IF NOT EXISTS idx_types_traitement_tenant_boutique
  ON public.types_traitement (tenant_id, boutique_id, coefficient);

CREATE INDEX IF NOT EXISTS idx_modes_reglement_tenant_boutique
  ON public.modes_reglement (tenant_id, boutique_id, designation);

-- 6. Guarded indexes for optional/newer tables (safe if table exists)
DO $$
BEGIN
  IF to_regclass('public.fidelite_points') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fidelite_points_tenant_boutique_client ON public.fidelite_points (tenant_id, boutique_id, client_id)';
  END IF;
  IF to_regclass('public.fidelite_history') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fidelite_history_tenant_client_created ON public.fidelite_history (tenant_id, client_id, created_at DESC)';
  END IF;
  IF to_regclass('public.consommables') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_consommables_tenant_boutique_nom ON public.consommables (tenant_id, boutique_id, nom)';
  END IF;
  IF to_regclass('public.relances') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_relances_tenant_boutique_date ON public.relances (tenant_id, boutique_id, date_relance DESC)';
  END IF;
  IF to_regclass('public.bons_reduction') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_bons_reduction_tenant_code ON public.bons_reduction (tenant_id, code)';
  END IF;
  IF to_regclass('public.commerciaux') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_commerciaux_tenant_actif_nom ON public.commerciaux (tenant_id, actif, nom)';
  END IF;
  IF to_regclass('public.commission_versements') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_commission_versements_tenant_commercial_date ON public.commission_versements (tenant_id, commercial_id, date_versement DESC)';
  END IF;
END $$;

-- 7. Analyze key tables so PostgreSQL query planner immediately uses the new composite indexes
ANALYZE public.entreprise_members;
ANALYZE public.boutiques;
ANALYZE public.clients;
ANALYZE public.depots;
ANALYZE public.depot_articles;
ANALYZE public.depot_avances;
ANALYZE public.depenses;
