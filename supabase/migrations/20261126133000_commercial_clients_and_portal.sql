-- Migration: Commercial ↔ Clients time-bounded assignments, auto-attribution, and Code-Authenticated Commercial Portal
-- 1. Add unique high-entropy portal_code to public.commerciaux
-- 2. Create public.commercial_clients (many clients per commercial, bounded by duree_jours / date_debut / date_fin)
-- 3. Auto-assign active commercial on new depots for linked clients within their active period
-- 4. Expose SECURITY DEFINER RPCs for the standalone Commercial Portal (strictly scoped by portal_code)

-- ─── 1. Portal access code on commerciaux ────────────────────────────────────
ALTER TABLE public.commerciaux
  ADD COLUMN IF NOT EXISTS portal_code text;

CREATE OR REPLACE FUNCTION public.generate_commercial_portal_code()
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_code text;
  v_attempts integer := 0;
BEGIN
  LOOP
    v_attempts := v_attempts + 1;
    v_code := 'COM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.commerciaux c WHERE upper(trim(c.portal_code)) = v_code
    ) OR v_attempts >= 20;
  END LOOP;
  RETURN v_code;
END;
$$;

-- Backfill existing commerciaux without a portal_code
UPDATE public.commerciaux
SET portal_code = public.generate_commercial_portal_code()
WHERE portal_code IS NULL OR trim(portal_code) = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_commerciaux_portal_code_upper
  ON public.commerciaux (upper(trim(portal_code)))
  WHERE portal_code IS NOT NULL;

CREATE OR REPLACE FUNCTION public.ensure_commercial_portal_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.portal_code IS NULL OR trim(NEW.portal_code) = '' THEN
    NEW.portal_code := public.generate_commercial_portal_code();
  ELSE
    NEW.portal_code := upper(trim(NEW.portal_code));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_commerciaux_ensure_portal_code ON public.commerciaux;
CREATE TRIGGER trg_commerciaux_ensure_portal_code
  BEFORE INSERT OR UPDATE OF portal_code ON public.commerciaux
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_commercial_portal_code();

-- ─── 2. Commercial ↔ Clients table (time-bounded period in days) ─────────────
CREATE TABLE IF NOT EXISTS public.commercial_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  boutique_id uuid NULL,
  commercial_id uuid NOT NULL REFERENCES public.commerciaux(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  duree_jours integer NOT NULL CHECK (duree_jours >= 1 AND duree_jours <= 3650),
  date_debut date NOT NULL DEFAULT CURRENT_DATE,
  date_fin date NOT NULL,
  taux_commission numeric(5,2) NULL CHECK (taux_commission IS NULL OR (taux_commission >= 0 AND taux_commission <= 100)),
  actif boolean NOT NULL DEFAULT true,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commercial_clients_date_order CHECK (date_fin >= date_debut)
);

CREATE INDEX IF NOT EXISTS idx_commercial_clients_tenant_commercial
  ON public.commercial_clients(tenant_id, commercial_id);

CREATE INDEX IF NOT EXISTS idx_commercial_clients_tenant_client_period
  ON public.commercial_clients(tenant_id, client_id, date_debut, date_fin);

ALTER TABLE public.commercial_clients ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commercial_clients TO authenticated;

DROP POLICY IF EXISTS "Tenant members can view commercial_clients" ON public.commercial_clients;
CREATE POLICY "Tenant members can view commercial_clients"
  ON public.commercial_clients FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.entreprise_members em
      WHERE em.user_id = auth.uid()
        AND em.tenant_id = commercial_clients.tenant_id
    )
  );

DROP POLICY IF EXISTS "Admins and gerants can insert commercial_clients" ON public.commercial_clients;
CREATE POLICY "Admins and gerants can insert commercial_clients"
  ON public.commercial_clients FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.entreprise_members em
      WHERE em.user_id = auth.uid()
        AND em.tenant_id = commercial_clients.tenant_id
        AND em.role IN ('admin', 'gerant')
    )
  );

DROP POLICY IF EXISTS "Admins and gerants can update commercial_clients" ON public.commercial_clients;
CREATE POLICY "Admins and gerants can update commercial_clients"
  ON public.commercial_clients FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.entreprise_members em
      WHERE em.user_id = auth.uid()
        AND em.tenant_id = commercial_clients.tenant_id
        AND em.role IN ('admin', 'gerant')
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.entreprise_members em
      WHERE em.user_id = auth.uid()
        AND em.tenant_id = commercial_clients.tenant_id
        AND em.role IN ('admin', 'gerant')
    )
  );

DROP POLICY IF EXISTS "Admins and gerants can delete commercial_clients" ON public.commercial_clients;
CREATE POLICY "Admins and gerants can delete commercial_clients"
  ON public.commercial_clients FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.entreprise_members em
      WHERE em.user_id = auth.uid()
        AND em.tenant_id = commercial_clients.tenant_id
        AND em.role IN ('admin', 'gerant')
    )
  );

-- Enable realtime broadcasts for commercial_clients
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.commercial_clients;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- ─── 3. Auto-assign commercial on new depots for linked clients ──────────────
CREATE OR REPLACE FUNCTION public.auto_assign_depot_commercial_from_client()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_commercial_id uuid;
  v_taux numeric(5,2);
  v_depot_date date;
BEGIN
  IF NEW.commercial_id IS NULL AND NEW.client_id IS NOT NULL THEN
    v_depot_date := COALESCE(NEW.date_depot, now())::date;

    SELECT cc.commercial_id, COALESCE(cc.taux_commission, c.taux_commission)
    INTO v_commercial_id, v_taux
    FROM public.commercial_clients cc
    JOIN public.commerciaux c ON c.id = cc.commercial_id
    WHERE cc.tenant_id = NEW.tenant_id
      AND cc.client_id = NEW.client_id
      AND cc.actif = true
      AND c.actif = true
      AND v_depot_date BETWEEN cc.date_debut AND cc.date_fin
    ORDER BY cc.created_at DESC
    LIMIT 1;

    IF v_commercial_id IS NOT NULL THEN
      NEW.commercial_id := v_commercial_id;
      NEW.commission_taux := v_taux;
      NEW.commission_montant := ROUND((COALESCE(NEW.total, 0) * COALESCE(v_taux, 0)) / 100.0);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_depots_auto_assign_commercial ON public.depots;
CREATE TRIGGER trg_depots_auto_assign_commercial
  BEFORE INSERT ON public.depots
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_assign_depot_commercial_from_client();

-- ─── 4. Commercial Portal public branding RPC (optional company header) ──────
CREATE OR REPLACE FUNCTION public.get_commercial_portal_branding(p_entreprise_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ent record;
BEGIN
  IF p_entreprise_id IS NULL OR p_entreprise_id <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT id, nom, telephone, adresse, ville, logo_url
  INTO v_ent
  FROM public.entreprise
  WHERE id = p_entreprise_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'id', v_ent.id,
    'nom', v_ent.nom,
    'telephone', v_ent.telephone,
    'adresse', v_ent.adresse,
    'ville', v_ent.ville,
    'logo_url', v_ent.logo_url
  );
END;
$$;

-- ─── 5. Commercial Portal authenticated data RPC (code-based, tenant-scoped) ─
CREATE OR REPLACE FUNCTION public.get_commercial_portal_data(
  p_portal_code text,
  p_entreprise_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_code text;
  v_com record;
  v_ent record;
  v_clients jsonb;
  v_factures jsonb;
  v_versements jsonb;
  v_total_ca numeric := 0;
  v_total_dues numeric := 0;
  v_total_versees numeric := 0;
  v_nb_factures integer := 0;
  v_total_clients integer := 0;
  v_clients_actifs integer := 0;
BEGIN
  v_code := upper(trim(COALESCE(p_portal_code, '')));
  IF length(v_code) < 4 OR length(v_code) > 40 THEN
    RETURN jsonb_build_object('error', 'Code d''accès invalide.');
  END IF;

  IF p_entreprise_id IS NOT NULL THEN
    SELECT c.*
    INTO v_com
    FROM public.commerciaux c
    JOIN public.entreprise e ON e.user_id = c.tenant_id
    WHERE upper(trim(COALESCE(c.portal_code, ''))) = v_code
      AND e.id = p_entreprise_id
    LIMIT 1;
  ELSE
    SELECT c.*
    INTO v_com
    FROM public.commerciaux c
    WHERE upper(trim(COALESCE(c.portal_code, ''))) = v_code
    LIMIT 1;
  END IF;

  IF NOT FOUND OR NOT COALESCE(v_com.actif, false) THEN
    RETURN jsonb_build_object('error', 'Code invalide ou compte commercial inactif.');
  END IF;

  SELECT id, nom, telephone, adresse, ville, logo_url
  INTO v_ent
  FROM public.entreprise
  WHERE user_id = v_com.tenant_id
  ORDER BY id ASC
  LIMIT 1;

  -- Compute qualifying invoices (direct assignment OR linked client during active period, zero double counting)
  WITH active_links AS (
    SELECT
      cc.id,
      cc.client_id,
      cc.date_debut,
      cc.date_fin,
      cc.duree_jours,
      COALESCE(cc.taux_commission, v_com.taux_commission) AS eff_taux,
      cc.actif,
      cc.notes,
      cc.created_at
    FROM public.commercial_clients cc
    WHERE cc.tenant_id = v_com.tenant_id
      AND cc.commercial_id = v_com.id
  ),
  qualifying_depots AS (
    SELECT
      d.id,
      d.numero,
      d.date_depot,
      d.client_id,
      cl.nom AS client_nom,
      d.statut,
      COALESCE(d.total, 0)::numeric AS total,
      CASE
        WHEN d.commercial_id = v_com.id THEN COALESCE(d.commission_taux, v_com.taux_commission)::numeric
        ELSE matched_link.eff_taux::numeric
      END AS eff_taux,
      CASE
        WHEN d.commercial_id = v_com.id AND d.commission_montant IS NOT NULL THEN d.commission_montant::numeric
        WHEN d.commercial_id = v_com.id THEN ROUND((COALESCE(d.total, 0) * COALESCE(d.commission_taux, v_com.taux_commission)) / 100.0)
        ELSE ROUND((COALESCE(d.total, 0) * matched_link.eff_taux) / 100.0)
      END AS eff_commission,
      CASE
        WHEN d.commercial_id = v_com.id THEN 'direct'
        ELSE 'client_period'
      END AS source,
      matched_link.id AS matched_link_id
    FROM public.depots d
    LEFT JOIN public.clients cl ON cl.id = d.client_id
    LEFT JOIN LATERAL (
      SELECT al.id, al.eff_taux
      FROM active_links al
      WHERE al.client_id = d.client_id
        AND al.actif = true
        AND (d.date_depot::date) BETWEEN al.date_debut AND al.date_fin
      ORDER BY al.created_at DESC
      LIMIT 1
    ) matched_link ON true
    WHERE d.tenant_id = v_com.tenant_id
      AND COALESCE(d.statut, '') <> 'ANNULE'
      AND (
        d.commercial_id = v_com.id
        OR (d.commercial_id IS NULL AND matched_link.id IS NOT NULL)
      )
  )
  SELECT
    COALESCE(COUNT(*), 0),
    COALESCE(SUM(total), 0),
    COALESCE(SUM(eff_commission), 0),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', id,
          'numero', numero,
          'date_depot', date_depot,
          'client_id', client_id,
          'client_nom', COALESCE(client_nom, '—'),
          'statut', statut,
          'total', total,
          'commission_taux', eff_taux,
          'commission_montant', eff_commission,
          'source', source
        )
        ORDER BY date_depot DESC
      ),
      '[]'::jsonb
    )
  INTO v_nb_factures, v_total_ca, v_total_dues, v_factures
  FROM qualifying_depots;

  -- Linked clients with per-period performance
  WITH link_rows AS (
    SELECT
      cc.id,
      cc.client_id,
      COALESCE(cl.nom, '—') AS client_nom,
      cl.code AS client_code,
      cl.telephone AS client_telephone,
      cc.date_debut,
      cc.date_fin,
      cc.duree_jours,
      COALESCE(cc.taux_commission, v_com.taux_commission)::numeric AS eff_taux,
      cc.actif,
      (cc.date_fin - CURRENT_DATE) AS jours_restants,
      (cc.actif = true AND CURRENT_DATE BETWEEN cc.date_debut AND cc.date_fin) AS est_actif_periode,
      cc.created_at,
      COALESCE((
        SELECT COUNT(*)
        FROM public.depots d
        WHERE d.tenant_id = v_com.tenant_id
          AND d.client_id = cc.client_id
          AND COALESCE(d.statut, '') <> 'ANNULE'
          AND (d.date_depot::date) BETWEEN cc.date_debut AND cc.date_fin
          AND (d.commercial_id IS NULL OR d.commercial_id = v_com.id)
      ), 0) AS nb_factures,
      COALESCE((
        SELECT SUM(COALESCE(d.total, 0))
        FROM public.depots d
        WHERE d.tenant_id = v_com.tenant_id
          AND d.client_id = cc.client_id
          AND COALESCE(d.statut, '') <> 'ANNULE'
          AND (d.date_depot::date) BETWEEN cc.date_debut AND cc.date_fin
          AND (d.commercial_id IS NULL OR d.commercial_id = v_com.id)
      ), 0) AS ca_periode,
      COALESCE((
        SELECT SUM(
          CASE
            WHEN d.commercial_id = v_com.id AND d.commission_montant IS NOT NULL THEN d.commission_montant::numeric
            ELSE ROUND((COALESCE(d.total, 0) * COALESCE(d.commission_taux, cc.taux_commission, v_com.taux_commission)) / 100.0)
          END
        )
        FROM public.depots d
        WHERE d.tenant_id = v_com.tenant_id
          AND d.client_id = cc.client_id
          AND COALESCE(d.statut, '') <> 'ANNULE'
          AND (d.date_depot::date) BETWEEN cc.date_debut AND cc.date_fin
          AND (d.commercial_id IS NULL OR d.commercial_id = v_com.id)
      ), 0) AS commissions_periode
    FROM public.commercial_clients cc
    LEFT JOIN public.clients cl ON cl.id = cc.client_id
    WHERE cc.tenant_id = v_com.tenant_id
      AND cc.commercial_id = v_com.id
  )
  SELECT
    COALESCE(COUNT(*), 0),
    COALESCE(COUNT(*) FILTER (WHERE est_actif_periode), 0),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', id,
          'client_id', client_id,
          'client_nom', client_nom,
          'client_code', client_code,
          'client_telephone', client_telephone,
          'date_debut', date_debut,
          'date_fin', date_fin,
          'duree_jours', duree_jours,
          'taux_commission', eff_taux,
          'actif', actif,
          'jours_restants', jours_restants,
          'est_actif_periode', est_actif_periode,
          'nb_factures', nb_factures,
          'chiffre_affaires', ca_periode,
          'commissions_generees', commissions_periode
        )
        ORDER BY est_actif_periode DESC, date_fin DESC, created_at DESC
      ),
      '[]'::jsonb
    )
  INTO v_total_clients, v_clients_actifs, v_clients
  FROM link_rows;

  -- Payouts history
  SELECT
    COALESCE(SUM(COALESCE(montant, 0)), 0),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', id,
          'date_versement', date_versement,
          'montant', COALESCE(montant, 0),
          'mode_reglement', mode_reglement,
          'periode_debut', periode_debut,
          'periode_fin', periode_fin,
          'reference', reference,
          'notes', notes
        )
        ORDER BY date_versement DESC, created_at DESC
      ),
      '[]'::jsonb
    )
  INTO v_total_versees, v_versements
  FROM public.commission_versements
  WHERE tenant_id = v_com.tenant_id
    AND commercial_id = v_com.id;

  RETURN jsonb_build_object(
    'commercial', jsonb_build_object(
      'id', v_com.id,
      'nom', v_com.nom,
      'telephone', v_com.telephone,
      'email', v_com.email,
      'taux_commission', COALESCE(v_com.taux_commission, 0),
      'portal_code', v_com.portal_code,
      'actif', v_com.actif
    ),
    'entreprise', CASE WHEN v_ent.id IS NOT NULL THEN jsonb_build_object(
      'id', v_ent.id,
      'nom', v_ent.nom,
      'telephone', v_ent.telephone,
      'adresse', v_ent.adresse,
      'ville', v_ent.ville,
      'logo_url', v_ent.logo_url
    ) ELSE NULL END,
    'summary', jsonb_build_object(
      'total_clients', v_total_clients,
      'clients_actifs', v_clients_actifs,
      'nb_factures', v_nb_factures,
      'chiffre_affaires', v_total_ca,
      'commissions_dues', v_total_dues,
      'commissions_versees', v_total_versees,
      'solde_a_payer', GREATEST(0, v_total_dues - v_total_versees)
    ),
    'clients', v_clients,
    'factures', v_factures,
    'versements', v_versements
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_commercial_portal_branding(bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_commercial_portal_data(text, bigint) TO anon, authenticated;
