-- SYSCOHADA Révisé Accounting Support Migration
-- Adds optional SYSCOHADA account codes to expenses/categories, fiscal regime settings on entreprise,
-- and a dedicated balanced double-entry journal table (ecritures_comptables) with strict multi-tenant
-- and role-based RLS (read-only for 'associe', writable by 'admin', 'gerant', 'comptable').

-- 1. Optional SYSCOHADA account mapping on depenses & depense_categories
ALTER TABLE public.depenses
  ADD COLUMN IF NOT EXISTS compte_syscohada text;

ALTER TABLE public.depense_categories
  ADD COLUMN IF NOT EXISTS compte_syscohada text;

-- 2. Optional fiscal regime & VAT rate on entreprise (default SMT 0%)
ALTER TABLE public.entreprise
  ADD COLUMN IF NOT EXISTS regime_fiscal text DEFAULT 'SMT';

ALTER TABLE public.entreprise
  ADD COLUMN IF NOT EXISTS taux_tva numeric(5, 2) DEFAULT 0;

-- 3. Manual / OD double-entry journal table (ecritures_comptables)
CREATE TABLE IF NOT EXISTS public.ecritures_comptables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  boutique_id uuid,
  date_ecriture timestamptz NOT NULL DEFAULT now(),
  journal text NOT NULL DEFAULT 'OD' CHECK (journal IN ('VE', 'CA', 'BQ', 'AC', 'OD')),
  numero_piece text NOT NULL,
  libelle text NOT NULL,
  lignes jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_debit numeric(14, 2) NOT NULL CHECK (total_debit > 0),
  total_credit numeric(14, 2) NOT NULL CHECK (total_credit > 0),
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ecritures_comptables_equilibre_chk CHECK (round(total_debit, 2) = round(total_credit, 2))
);

CREATE INDEX IF NOT EXISTS idx_ecritures_comptables_tenant_boutique_date
  ON public.ecritures_comptables (tenant_id, boutique_id, date_ecriture DESC, id);

-- 4. Enable Row Level Security
ALTER TABLE public.ecritures_comptables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_tenant_ecritures_comptables" ON public.ecritures_comptables;
CREATE POLICY "select_tenant_ecritures_comptables" ON public.ecritures_comptables
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.entreprise_members em
      WHERE em.user_id = auth.uid()
        AND em.tenant_id = ecritures_comptables.tenant_id
    )
    OR ecritures_comptables.tenant_id = auth.uid()
  );

DROP POLICY IF EXISTS "insert_tenant_ecritures_comptables" ON public.ecritures_comptables;
CREATE POLICY "insert_tenant_ecritures_comptables" ON public.ecritures_comptables
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.entreprise_members em
      WHERE em.user_id = auth.uid()
        AND em.tenant_id = ecritures_comptables.tenant_id
        AND em.role IN ('admin', 'gerant', 'comptable')
    )
    OR ecritures_comptables.tenant_id = auth.uid()
  );

DROP POLICY IF EXISTS "update_tenant_ecritures_comptables" ON public.ecritures_comptables;
CREATE POLICY "update_tenant_ecritures_comptables" ON public.ecritures_comptables
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.entreprise_members em
      WHERE em.user_id = auth.uid()
        AND em.tenant_id = ecritures_comptables.tenant_id
        AND em.role IN ('admin', 'gerant', 'comptable')
    )
    OR ecritures_comptables.tenant_id = auth.uid()
  )
  WITH CHECK (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.entreprise_members em
      WHERE em.user_id = auth.uid()
        AND em.tenant_id = ecritures_comptables.tenant_id
        AND em.role IN ('admin', 'gerant', 'comptable')
    )
    OR ecritures_comptables.tenant_id = auth.uid()
  );

DROP POLICY IF EXISTS "delete_tenant_ecritures_comptables" ON public.ecritures_comptables;
CREATE POLICY "delete_tenant_ecritures_comptables" ON public.ecritures_comptables
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.entreprise_members em
      WHERE em.user_id = auth.uid()
        AND em.tenant_id = ecritures_comptables.tenant_id
        AND em.role IN ('admin', 'gerant', 'comptable')
    )
    OR ecritures_comptables.tenant_id = auth.uid()
  );

-- Restrictive policies ensuring 'associe' remains strictly read-only
DROP POLICY IF EXISTS "restrict_associe_insert" ON public.ecritures_comptables;
CREATE POLICY "restrict_associe_insert" ON public.ecritures_comptables
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.current_user_can_write_financial());

DROP POLICY IF EXISTS "restrict_associe_update" ON public.ecritures_comptables;
CREATE POLICY "restrict_associe_update" ON public.ecritures_comptables
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.current_user_can_write_financial())
  WITH CHECK (public.current_user_can_write_financial());

DROP POLICY IF EXISTS "restrict_associe_delete" ON public.ecritures_comptables;
CREATE POLICY "restrict_associe_delete" ON public.ecritures_comptables
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.current_user_can_write_financial());

ANALYZE public.depenses;
ANALYZE public.depense_categories;
ANALYZE public.ecritures_comptables;
