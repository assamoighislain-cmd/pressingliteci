-- Migration: Commerciaux & Commissions tracking
-- Adds:
-- 1. public.commerciaux (sales agents per company with individual commission rate)
-- 2. public.depots columns (commercial_id, commission_taux, commission_montant)
-- 3. public.commission_versements (history of commission payouts per commercial)
-- 4. Strict tenant-scoped Row Level Security (RLS) policies + Realtime publication

-- 1. Table: commerciaux
CREATE TABLE IF NOT EXISTS public.commerciaux (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  boutique_id uuid NULL,
  nom text NOT NULL,
  telephone text NULL,
  email text NULL,
  taux_commission numeric(5,2) NOT NULL DEFAULT 0 CHECK (taux_commission >= 0 AND taux_commission <= 100),
  actif boolean NOT NULL DEFAULT true,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commerciaux_tenant_id ON public.commerciaux(tenant_id);
CREATE INDEX IF NOT EXISTS idx_commerciaux_actif ON public.commerciaux(tenant_id, actif);

-- 2. Columns on depots to link a deposit to a commercial and freeze commission snapshot
ALTER TABLE public.depots
  ADD COLUMN IF NOT EXISTS commercial_id uuid NULL REFERENCES public.commerciaux(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS commission_taux numeric(5,2) NULL CHECK (commission_taux IS NULL OR (commission_taux >= 0 AND commission_taux <= 100)),
  ADD COLUMN IF NOT EXISTS commission_montant numeric(12,2) NULL CHECK (commission_montant IS NULL OR commission_montant >= 0);

CREATE INDEX IF NOT EXISTS idx_depots_commercial_id ON public.depots(commercial_id) WHERE commercial_id IS NOT NULL;

-- 3. Table: commission_versements (payouts paid to each commercial)
CREATE TABLE IF NOT EXISTS public.commission_versements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  boutique_id uuid NULL,
  commercial_id uuid NOT NULL REFERENCES public.commerciaux(id) ON DELETE CASCADE,
  montant numeric(12,2) NOT NULL CHECK (montant > 0),
  mode_reglement text NULL,
  date_versement timestamptz NOT NULL DEFAULT now(),
  periode_debut date NULL,
  periode_fin date NULL,
  reference text NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commission_versements_tenant ON public.commission_versements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_commission_versements_commercial ON public.commission_versements(commercial_id);
CREATE INDEX IF NOT EXISTS idx_commission_versements_date ON public.commission_versements(date_versement DESC);

-- 4. Row Level Security (strictly tenant-isolated)
ALTER TABLE public.commerciaux ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_versements ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.commerciaux TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commission_versements TO authenticated;

-- commerciaux policies
DROP POLICY IF EXISTS "select_tenant_commerciaux" ON public.commerciaux;
CREATE POLICY "select_tenant_commerciaux" ON public.commerciaux
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.entreprise_members em
      WHERE em.user_id = auth.uid() AND em.tenant_id = commerciaux.tenant_id
    )
  );

DROP POLICY IF EXISTS "insert_tenant_commerciaux" ON public.commerciaux;
CREATE POLICY "insert_tenant_commerciaux" ON public.commerciaux
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.entreprise_members em
      WHERE em.user_id = auth.uid()
        AND em.tenant_id = commerciaux.tenant_id
        AND em.role IN ('admin', 'gerant')
    )
  );

DROP POLICY IF EXISTS "update_tenant_commerciaux" ON public.commerciaux;
CREATE POLICY "update_tenant_commerciaux" ON public.commerciaux
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.entreprise_members em
      WHERE em.user_id = auth.uid()
        AND em.tenant_id = commerciaux.tenant_id
        AND em.role IN ('admin', 'gerant')
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.entreprise_members em
      WHERE em.user_id = auth.uid()
        AND em.tenant_id = commerciaux.tenant_id
        AND em.role IN ('admin', 'gerant')
    )
  );

DROP POLICY IF EXISTS "delete_tenant_commerciaux" ON public.commerciaux;
CREATE POLICY "delete_tenant_commerciaux" ON public.commerciaux
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.entreprise_members em
      WHERE em.user_id = auth.uid()
        AND em.tenant_id = commerciaux.tenant_id
        AND em.role IN ('admin', 'gerant')
    )
  );

-- commission_versements policies
DROP POLICY IF EXISTS "select_tenant_commission_versements" ON public.commission_versements;
CREATE POLICY "select_tenant_commission_versements" ON public.commission_versements
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.entreprise_members em
      WHERE em.user_id = auth.uid() AND em.tenant_id = commission_versements.tenant_id
    )
  );

DROP POLICY IF EXISTS "insert_tenant_commission_versements" ON public.commission_versements;
CREATE POLICY "insert_tenant_commission_versements" ON public.commission_versements
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.entreprise_members em
      WHERE em.user_id = auth.uid()
        AND em.tenant_id = commission_versements.tenant_id
        AND em.role IN ('admin', 'gerant')
    )
  );

DROP POLICY IF EXISTS "update_tenant_commission_versements" ON public.commission_versements;
CREATE POLICY "update_tenant_commission_versements" ON public.commission_versements
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.entreprise_members em
      WHERE em.user_id = auth.uid()
        AND em.tenant_id = commission_versements.tenant_id
        AND em.role IN ('admin', 'gerant')
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.entreprise_members em
      WHERE em.user_id = auth.uid()
        AND em.tenant_id = commission_versements.tenant_id
        AND em.role IN ('admin', 'gerant')
    )
  );

DROP POLICY IF EXISTS "delete_tenant_commission_versements" ON public.commission_versements;
CREATE POLICY "delete_tenant_commission_versements" ON public.commission_versements
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.entreprise_members em
      WHERE em.user_id = auth.uid()
        AND em.tenant_id = commission_versements.tenant_id
        AND em.role IN ('admin', 'gerant')
    )
  );

-- 5. Enable Realtime replication (safe / idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'commerciaux'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.commerciaux;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'commission_versements'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.commission_versements;
    END IF;
  END IF;
END $$;
