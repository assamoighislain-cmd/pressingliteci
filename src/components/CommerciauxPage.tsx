import { useState, useEffect, useMemo, useCallback } from 'react';
import { db } from '@/lib/db';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import {
  Client,
  Commercial,
  CommercialClientWithDetails,
  CommissionVersement,
  DepotWithClient,
  ModeReglementRow,
  Entreprise,
  formatPrice,
  formatDateShort,
  getDaysRemainingUntil,
  isCommercialClientLinkActiveOnDate,
} from '@/types';
import {
  Briefcase,
  Plus,
  Pencil,
  Trash2,
  Search,
  Wallet,
  Printer,
  X,
  Check,
  Copy,
  RefreshCw,
  AlertTriangle,
  Link2,
  Loader2,
  UserCheck,
  UserX,
  Receipt,
  Users,
  KeyRound,
  Calendar,
} from 'lucide-react';
import { PrintableReport, printReport, type ReportData } from '@/components/PrintableReport';
import CommercialClientLinkModal from '@/components/CommercialClientLinkModal';
import CommercialPortalShareModal from '@/components/CommercialPortalShareModal';

type TabId = 'overview' | 'clients' | 'versements' | 'depots';

const COMMERCIAL_CLIENTS_PORTAL_SQL = `-- Extension : Liaison clients ↔ commerciaux sur durée (jours) + Portail Commercial par code
ALTER TABLE public.commerciaux ADD COLUMN IF NOT EXISTS portal_code text;

CREATE OR REPLACE FUNCTION public.generate_commercial_portal_code()
RETURNS text LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE v_code text; v_attempts integer := 0;
BEGIN
  LOOP
    v_attempts := v_attempts + 1;
    v_code := 'COM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.commerciaux c WHERE upper(trim(c.portal_code)) = v_code) OR v_attempts >= 20;
  END LOOP;
  RETURN v_code;
END; $$;

UPDATE public.commerciaux SET portal_code = public.generate_commercial_portal_code()
WHERE portal_code IS NULL OR trim(portal_code) = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_commerciaux_portal_code_upper
  ON public.commerciaux (upper(trim(portal_code))) WHERE portal_code IS NOT NULL;

CREATE OR REPLACE FUNCTION public.ensure_commercial_portal_code()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.portal_code IS NULL OR trim(NEW.portal_code) = '' THEN
    NEW.portal_code := public.generate_commercial_portal_code();
  ELSE NEW.portal_code := upper(trim(NEW.portal_code)); END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_commerciaux_ensure_portal_code ON public.commerciaux;
CREATE TRIGGER trg_commerciaux_ensure_portal_code
  BEFORE INSERT OR UPDATE OF portal_code ON public.commerciaux
  FOR EACH ROW EXECUTE FUNCTION public.ensure_commercial_portal_code();

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

CREATE INDEX IF NOT EXISTS idx_commercial_clients_tenant_commercial ON public.commercial_clients(tenant_id, commercial_id);
CREATE INDEX IF NOT EXISTS idx_commercial_clients_tenant_client_period ON public.commercial_clients(tenant_id, client_id, date_debut, date_fin);
ALTER TABLE public.commercial_clients ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commercial_clients TO authenticated;

DROP POLICY IF EXISTS "Tenant members can view commercial_clients" ON public.commercial_clients;
CREATE POLICY "Tenant members can view commercial_clients" ON public.commercial_clients FOR SELECT TO authenticated
  USING (public.is_super_admin() OR EXISTS (SELECT 1 FROM public.entreprise_members em WHERE em.user_id = auth.uid() AND em.tenant_id = commercial_clients.tenant_id));
DROP POLICY IF EXISTS "Admins and gerants can insert commercial_clients" ON public.commercial_clients;
CREATE POLICY "Admins and gerants can insert commercial_clients" ON public.commercial_clients FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() OR EXISTS (SELECT 1 FROM public.entreprise_members em WHERE em.user_id = auth.uid() AND em.tenant_id = commercial_clients.tenant_id AND em.role IN ('admin', 'gerant')));
DROP POLICY IF EXISTS "Admins and gerants can update commercial_clients" ON public.commercial_clients;
CREATE POLICY "Admins and gerants can update commercial_clients" ON public.commercial_clients FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR EXISTS (SELECT 1 FROM public.entreprise_members em WHERE em.user_id = auth.uid() AND em.tenant_id = commercial_clients.tenant_id AND em.role IN ('admin', 'gerant')))
  WITH CHECK (public.is_super_admin() OR EXISTS (SELECT 1 FROM public.entreprise_members em WHERE em.user_id = auth.uid() AND em.tenant_id = commercial_clients.tenant_id AND em.role IN ('admin', 'gerant')));
DROP POLICY IF EXISTS "Admins and gerants can delete commercial_clients" ON public.commercial_clients;
CREATE POLICY "Admins and gerants can delete commercial_clients" ON public.commercial_clients FOR DELETE TO authenticated
  USING (public.is_super_admin() OR EXISTS (SELECT 1 FROM public.entreprise_members em WHERE em.user_id = auth.uid() AND em.tenant_id = commercial_clients.tenant_id AND em.role IN ('admin', 'gerant')));

CREATE OR REPLACE FUNCTION public.auto_assign_depot_commercial_from_client()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE v_commercial_id uuid; v_taux numeric(5,2); v_depot_date date;
BEGIN
  IF NEW.commercial_id IS NULL AND NEW.client_id IS NOT NULL THEN
    v_depot_date := COALESCE(NEW.date_depot, now())::date;
    SELECT cc.commercial_id, COALESCE(cc.taux_commission, c.taux_commission)
    INTO v_commercial_id, v_taux
    FROM public.commercial_clients cc
    JOIN public.commerciaux c ON c.id = cc.commercial_id
    WHERE cc.tenant_id = NEW.tenant_id AND cc.client_id = NEW.client_id
      AND cc.actif = true AND c.actif = true
      AND v_depot_date BETWEEN cc.date_debut AND cc.date_fin
    ORDER BY cc.created_at DESC LIMIT 1;
    IF v_commercial_id IS NOT NULL THEN
      NEW.commercial_id := v_commercial_id;
      NEW.commission_taux := v_taux;
      NEW.commission_montant := ROUND((COALESCE(NEW.total, 0) * COALESCE(v_taux, 0)) / 100.0);
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_depots_auto_assign_commercial ON public.depots;
CREATE TRIGGER trg_depots_auto_assign_commercial
  BEFORE INSERT ON public.depots FOR EACH ROW EXECUTE FUNCTION public.auto_assign_depot_commercial_from_client();

CREATE OR REPLACE FUNCTION public.get_commercial_portal_branding(p_entreprise_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_ent record;
BEGIN
  IF p_entreprise_id IS NULL OR p_entreprise_id <= 0 THEN RETURN NULL; END IF;
  SELECT id, nom, telephone, adresse, ville, logo_url INTO v_ent FROM public.entreprise WHERE id = p_entreprise_id LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('id', v_ent.id, 'nom', v_ent.nom, 'telephone', v_ent.telephone, 'adresse', v_ent.adresse, 'ville', v_ent.ville, 'logo_url', v_ent.logo_url);
END; $$;

CREATE OR REPLACE FUNCTION public.get_commercial_portal_data(p_portal_code text, p_entreprise_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_code text; v_com record; v_ent record;
  v_clients jsonb; v_factures jsonb; v_versements jsonb;
  v_total_ca numeric := 0; v_total_dues numeric := 0; v_total_versees numeric := 0;
  v_nb_factures integer := 0; v_total_clients integer := 0; v_clients_actifs integer := 0;
BEGIN
  v_code := upper(trim(COALESCE(p_portal_code, '')));
  IF length(v_code) < 4 OR length(v_code) > 40 THEN RETURN jsonb_build_object('error', 'Code d''accès invalide.'); END IF;
  IF p_entreprise_id IS NOT NULL THEN
    SELECT c.* INTO v_com FROM public.commerciaux c JOIN public.entreprise e ON e.user_id = c.tenant_id
    WHERE upper(trim(COALESCE(c.portal_code, ''))) = v_code AND e.id = p_entreprise_id LIMIT 1;
  ELSE
    SELECT c.* INTO v_com FROM public.commerciaux c WHERE upper(trim(COALESCE(c.portal_code, ''))) = v_code LIMIT 1;
  END IF;
  IF NOT FOUND OR NOT COALESCE(v_com.actif, false) THEN
    RETURN jsonb_build_object('error', 'Code invalide ou compte commercial inactif.');
  END IF;
  SELECT id, nom, telephone, adresse, ville, logo_url INTO v_ent FROM public.entreprise WHERE user_id = v_com.tenant_id ORDER BY id ASC LIMIT 1;
  WITH active_links AS (
    SELECT cc.id, cc.client_id, cc.date_debut, cc.date_fin, cc.duree_jours,
           COALESCE(cc.taux_commission, v_com.taux_commission) AS eff_taux, cc.actif, cc.created_at
    FROM public.commercial_clients cc WHERE cc.tenant_id = v_com.tenant_id AND cc.commercial_id = v_com.id
  ),
  qualifying_depots AS (
    SELECT d.id, d.numero, d.date_depot, d.client_id, cl.nom AS client_nom, d.statut, COALESCE(d.total, 0)::numeric AS total,
      CASE WHEN d.commercial_id = v_com.id THEN COALESCE(d.commission_taux, v_com.taux_commission)::numeric ELSE ml.eff_taux::numeric END AS eff_taux,
      CASE WHEN d.commercial_id = v_com.id AND d.commission_montant IS NOT NULL THEN d.commission_montant::numeric
           WHEN d.commercial_id = v_com.id THEN ROUND((COALESCE(d.total, 0) * COALESCE(d.commission_taux, v_com.taux_commission)) / 100.0)
           ELSE ROUND((COALESCE(d.total, 0) * ml.eff_taux) / 100.0) END AS eff_commission,
      CASE WHEN d.commercial_id = v_com.id THEN 'direct' ELSE 'client_period' END AS source
    FROM public.depots d
    LEFT JOIN public.clients cl ON cl.id = d.client_id
    LEFT JOIN LATERAL (
      SELECT al.id, al.eff_taux FROM active_links al
      WHERE al.client_id = d.client_id AND al.actif = true AND (d.date_depot::date) BETWEEN al.date_debut AND al.date_fin
      ORDER BY al.created_at DESC LIMIT 1
    ) ml ON true
    WHERE d.tenant_id = v_com.tenant_id AND COALESCE(d.statut, '') <> 'ANNULE'
      AND (d.commercial_id = v_com.id OR (d.commercial_id IS NULL AND ml.id IS NOT NULL))
  )
  SELECT COALESCE(COUNT(*), 0), COALESCE(SUM(total), 0), COALESCE(SUM(eff_commission), 0),
    COALESCE(jsonb_agg(jsonb_build_object('id', id, 'numero', numero, 'date_depot', date_depot, 'client_id', client_id,
      'client_nom', COALESCE(client_nom, '—'), 'statut', statut, 'total', total, 'commission_taux', eff_taux,
      'commission_montant', eff_commission, 'source', source) ORDER BY date_depot DESC), '[]'::jsonb)
  INTO v_nb_factures, v_total_ca, v_total_dues, v_factures FROM qualifying_depots;

  WITH link_rows AS (
    SELECT cc.id, cc.client_id, COALESCE(cl.nom, '—') AS client_nom, cl.code AS client_code, cl.telephone AS client_telephone,
      cc.date_debut, cc.date_fin, cc.duree_jours, COALESCE(cc.taux_commission, v_com.taux_commission)::numeric AS eff_taux,
      cc.actif, (cc.date_fin - CURRENT_DATE) AS jours_restants,
      (cc.actif = true AND CURRENT_DATE BETWEEN cc.date_debut AND cc.date_fin) AS est_actif_periode, cc.created_at,
      COALESCE((SELECT COUNT(*) FROM public.depots d WHERE d.tenant_id = v_com.tenant_id AND d.client_id = cc.client_id
        AND COALESCE(d.statut, '') <> 'ANNULE' AND (d.date_depot::date) BETWEEN cc.date_debut AND cc.date_fin
        AND (d.commercial_id IS NULL OR d.commercial_id = v_com.id)), 0) AS nb_factures,
      COALESCE((SELECT SUM(COALESCE(d.total, 0)) FROM public.depots d WHERE d.tenant_id = v_com.tenant_id AND d.client_id = cc.client_id
        AND COALESCE(d.statut, '') <> 'ANNULE' AND (d.date_depot::date) BETWEEN cc.date_debut AND cc.date_fin
        AND (d.commercial_id IS NULL OR d.commercial_id = v_com.id)), 0) AS ca_periode,
      COALESCE((SELECT SUM(CASE WHEN d.commercial_id = v_com.id AND d.commission_montant IS NOT NULL THEN d.commission_montant::numeric
        ELSE ROUND((COALESCE(d.total, 0) * COALESCE(d.commission_taux, cc.taux_commission, v_com.taux_commission)) / 100.0) END)
        FROM public.depots d WHERE d.tenant_id = v_com.tenant_id AND d.client_id = cc.client_id
        AND COALESCE(d.statut, '') <> 'ANNULE' AND (d.date_depot::date) BETWEEN cc.date_debut AND cc.date_fin
        AND (d.commercial_id IS NULL OR d.commercial_id = v_com.id)), 0) AS commissions_periode
    FROM public.commercial_clients cc LEFT JOIN public.clients cl ON cl.id = cc.client_id
    WHERE cc.tenant_id = v_com.tenant_id AND cc.commercial_id = v_com.id
  )
  SELECT COALESCE(COUNT(*), 0), COALESCE(COUNT(*) FILTER (WHERE est_actif_periode), 0),
    COALESCE(jsonb_agg(jsonb_build_object('id', id, 'client_id', client_id, 'client_nom', client_nom, 'client_code', client_code,
      'client_telephone', client_telephone, 'date_debut', date_debut, 'date_fin', date_fin, 'duree_jours', duree_jours,
      'taux_commission', eff_taux, 'actif', actif, 'jours_restants', jours_restants, 'est_actif_periode', est_actif_periode,
      'nb_factures', nb_factures, 'chiffre_affaires', ca_periode, 'commissions_generees', commissions_periode)
      ORDER BY est_actif_periode DESC, date_fin DESC, created_at DESC), '[]'::jsonb)
  INTO v_total_clients, v_clients_actifs, v_clients FROM link_rows;

  SELECT COALESCE(SUM(COALESCE(montant, 0)), 0),
    COALESCE(jsonb_agg(jsonb_build_object('id', id, 'date_versement', date_versement, 'montant', COALESCE(montant, 0),
      'mode_reglement', mode_reglement, 'periode_debut', periode_debut, 'periode_fin', periode_fin,
      'reference', reference, 'notes', notes) ORDER BY date_versement DESC, created_at DESC), '[]'::jsonb)
  INTO v_total_versees, v_versements FROM public.commission_versements WHERE tenant_id = v_com.tenant_id AND commercial_id = v_com.id;

  RETURN jsonb_build_object(
    'commercial', jsonb_build_object('id', v_com.id, 'nom', v_com.nom, 'telephone', v_com.telephone, 'email', v_com.email,
      'taux_commission', COALESCE(v_com.taux_commission, 0), 'portal_code', v_com.portal_code, 'actif', v_com.actif),
    'entreprise', CASE WHEN v_ent.id IS NOT NULL THEN jsonb_build_object('id', v_ent.id, 'nom', v_ent.nom, 'telephone', v_ent.telephone,
      'adresse', v_ent.adresse, 'ville', v_ent.ville, 'logo_url', v_ent.logo_url) ELSE NULL END,
    'summary', jsonb_build_object('total_clients', v_total_clients, 'clients_actifs', v_clients_actifs, 'nb_factures', v_nb_factures,
      'chiffre_affaires', v_total_ca, 'commissions_dues', v_total_dues, 'commissions_versees', v_total_versees,
      'solde_a_payer', GREATEST(0, v_total_dues - v_total_versees)),
    'clients', v_clients, 'factures', v_factures, 'versements', v_versements
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.get_commercial_portal_branding(bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_commercial_portal_data(text, bigint) TO anon, authenticated;`;

const COMMISSIONS_MIGRATION_SQL = `CREATE TABLE IF NOT EXISTS public.commerciaux (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  boutique_id uuid NULL,
  nom text NOT NULL,
  telephone text NULL,
  email text NULL,
  taux_commission numeric(5,2) NOT NULL DEFAULT 0 CHECK (taux_commission >= 0 AND taux_commission <= 100),
  portal_code text NULL,
  actif boolean NOT NULL DEFAULT true,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.depots
  ADD COLUMN IF NOT EXISTS commercial_id uuid NULL REFERENCES public.commerciaux(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS commission_taux numeric(5,2) NULL CHECK (commission_taux IS NULL OR (commission_taux >= 0 AND commission_taux <= 100)),
  ADD COLUMN IF NOT EXISTS commission_montant numeric(12,2) NULL CHECK (commission_montant IS NULL OR commission_montant >= 0);

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

ALTER TABLE public.commerciaux ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_versements ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commerciaux TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commission_versements TO authenticated;

DROP POLICY IF EXISTS "select_tenant_commerciaux" ON public.commerciaux;
CREATE POLICY "select_tenant_commerciaux" ON public.commerciaux FOR SELECT TO authenticated
  USING (public.is_super_admin() OR EXISTS (SELECT 1 FROM public.entreprise_members em WHERE em.user_id = auth.uid() AND em.tenant_id = commerciaux.tenant_id));
DROP POLICY IF EXISTS "insert_tenant_commerciaux" ON public.commerciaux;
CREATE POLICY "insert_tenant_commerciaux" ON public.commerciaux FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() OR EXISTS (SELECT 1 FROM public.entreprise_members em WHERE em.user_id = auth.uid() AND em.tenant_id = commerciaux.tenant_id AND em.role IN ('admin', 'gerant')));
DROP POLICY IF EXISTS "update_tenant_commerciaux" ON public.commerciaux;
CREATE POLICY "update_tenant_commerciaux" ON public.commerciaux FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR EXISTS (SELECT 1 FROM public.entreprise_members em WHERE em.user_id = auth.uid() AND em.tenant_id = commerciaux.tenant_id AND em.role IN ('admin', 'gerant')))
  WITH CHECK (public.is_super_admin() OR EXISTS (SELECT 1 FROM public.entreprise_members em WHERE em.user_id = auth.uid() AND em.tenant_id = commerciaux.tenant_id AND em.role IN ('admin', 'gerant')));
DROP POLICY IF EXISTS "delete_tenant_commerciaux" ON public.commerciaux;
CREATE POLICY "delete_tenant_commerciaux" ON public.commerciaux FOR DELETE TO authenticated
  USING (public.is_super_admin() OR EXISTS (SELECT 1 FROM public.entreprise_members em WHERE em.user_id = auth.uid() AND em.tenant_id = commerciaux.tenant_id AND em.role IN ('admin', 'gerant')));

DROP POLICY IF EXISTS "select_tenant_commission_versements" ON public.commission_versements;
CREATE POLICY "select_tenant_commission_versements" ON public.commission_versements FOR SELECT TO authenticated
  USING (public.is_super_admin() OR EXISTS (SELECT 1 FROM public.entreprise_members em WHERE em.user_id = auth.uid() AND em.tenant_id = commission_versements.tenant_id));
DROP POLICY IF EXISTS "insert_tenant_commission_versements" ON public.commission_versements;
CREATE POLICY "insert_tenant_commission_versements" ON public.commission_versements FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() OR EXISTS (SELECT 1 FROM public.entreprise_members em WHERE em.user_id = auth.uid() AND em.tenant_id = commission_versements.tenant_id AND em.role IN ('admin', 'gerant')));
DROP POLICY IF EXISTS "update_tenant_commission_versements" ON public.commission_versements;
CREATE POLICY "update_tenant_commission_versements" ON public.commission_versements FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR EXISTS (SELECT 1 FROM public.entreprise_members em WHERE em.user_id = auth.uid() AND em.tenant_id = commission_versements.tenant_id AND em.role IN ('admin', 'gerant')))
  WITH CHECK (public.is_super_admin() OR EXISTS (SELECT 1 FROM public.entreprise_members em WHERE em.user_id = auth.uid() AND em.tenant_id = commission_versements.tenant_id AND em.role IN ('admin', 'gerant')));
DROP POLICY IF EXISTS "delete_tenant_commission_versements" ON public.commission_versements;
CREATE POLICY "delete_tenant_commission_versements" ON public.commission_versements FOR DELETE TO authenticated
  USING (public.is_super_admin() OR EXISTS (SELECT 1 FROM public.entreprise_members em WHERE em.user_id = auth.uid() AND em.tenant_id = commission_versements.tenant_id AND em.role IN ('admin', 'gerant')));

${COMMERCIAL_CLIENTS_PORTAL_SQL}`;

interface CommercialStats {
  commercial: Commercial;
  nbClientsLies: number;
  nbClientsActifs: number;
  nbDepots: number;
  chiffreAffaires: number;
  commissionsDues: number;
  commissionsVersees: number;
  soldeAPayer: number;
}

interface ResolvedDepotAttribution {
  commercialId: string;
  taux: number;
  montant: number;
  source: 'direct' | 'client_period';
}

function computeDepotCommission(depot: DepotWithClient, commercial?: Commercial): { taux: number; montant: number } {
  const taux =
    depot.commission_taux != null && Number.isFinite(depot.commission_taux)
      ? depot.commission_taux
      : (commercial?.taux_commission ?? 0);
  const montant =
    depot.commission_montant != null && Number.isFinite(depot.commission_montant)
      ? depot.commission_montant
      : Math.round((Number(depot.total ?? 0) * taux) / 100);
  return { taux, montant };
}

function resolveDepotAttribution(
  depot: DepotWithClient,
  commerciauxMap: Map<string, Commercial>,
  linksByClient: Map<string, CommercialClientWithDetails[]>,
): ResolvedDepotAttribution | null {
  if (String(depot.statut ?? '') === 'ANNULE') return null;

  if (depot.commercial_id) {
    const com = commerciauxMap.get(depot.commercial_id);
    const { taux, montant } = computeDepotCommission(depot, com);
    return {
      commercialId: depot.commercial_id,
      taux,
      montant,
      source: 'direct',
    };
  }

  if (!depot.client_id) return null;
  const clientLinks = linksByClient.get(depot.client_id);
  if (!clientLinks || clientLinks.length === 0) return null;

  const dDate = (depot.date_depot ?? '').slice(0, 10);
  if (!dDate) return null;

  for (const link of clientLinks) {
    if (!isCommercialClientLinkActiveOnDate(link, dDate)) continue;
    const com = commerciauxMap.get(link.commercial_id);
    if (!com) continue;
    const taux = link.taux_commission != null ? link.taux_commission : com.taux_commission;
    const montant = Math.round((Number(depot.total ?? 0) * taux) / 100);
    return {
      commercialId: link.commercial_id,
      taux,
      montant,
      source: 'client_period',
    };
  }

  return null;
}

export default function CommerciauxPage() {
  const { role } = useAuth();
  const { lang } = useI18n();
  const canManage = !role || role === 'admin' || role === 'gerant';

  const [tab, setTab] = useState<TabId>('overview');
  const [loading, setLoading] = useState(true);
  const [missingTable, setMissingTable] = useState(false);
  const [missingClientsTable, setMissingClientsTable] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [copiedUpgradeSql, setCopiedUpgradeSql] = useState(false);
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [commerciaux, setCommerciaux] = useState<Commercial[]>([]);
  const [commercialClients, setCommercialClients] = useState<CommercialClientWithDetails[]>([]);
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [versements, setVersements] = useState<CommissionVersement[]>([]);
  const [depots, setDepots] = useState<DepotWithClient[]>([]);
  const [modes, setModes] = useState<ModeReglementRow[]>([]);
  const [entreprise, setEntreprise] = useState<Entreprise | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [clientLinkStatusFilter, setClientLinkStatusFilter] = useState<'all' | 'active' | 'expired'>('all');
  const [selectedCommercialFilter, setSelectedCommercialFilter] = useState<string>('all');
  const [depotLinkFilter, setDepotLinkFilter] = useState<'linked' | 'all'>('linked');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Commercial create/edit modal
  const [showCommercialModal, setShowCommercialModal] = useState(false);
  const [editingCommercial, setEditingCommercial] = useState<Commercial | null>(null);
  const [formNom, setFormNom] = useState('');
  const [formTelephone, setFormTelephone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formTaux, setFormTaux] = useState('10');
  const [formActif, setFormActif] = useState(true);
  const [formNotes, setFormNotes] = useState('');
  const [savingCommercial, setSavingCommercial] = useState(false);

  // Client assignment modal (create bulk or edit period)
  const [showClientLinkModal, setShowClientLinkModal] = useState(false);
  const [clientLinkInitialComId, setClientLinkInitialComId] = useState<string | undefined>(undefined);
  const [editingClientLink, setEditingClientLink] = useState<CommercialClientWithDetails | null>(null);

  // Portal code share modal
  const [portalShareCommercial, setPortalShareCommercial] = useState<Commercial | null>(null);

  // Payout modal
  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [payoutCommercialId, setPayoutCommercialId] = useState('');
  const [payoutMontant, setPayoutMontant] = useState('');
  const [payoutDate, setPayoutDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payoutMode, setPayoutMode] = useState('');
  const [payoutPeriodeDebut, setPayoutPeriodeDebut] = useState('');
  const [payoutPeriodeFin, setPayoutPeriodeFin] = useState('');
  const [payoutRef, setPayoutRef] = useState('');
  const [payoutNotes, setPayoutNotes] = useState('');
  const [payoutLogDepense, setPayoutLogDepense] = useState(false);
  const [savingPayout, setSavingPayout] = useState(false);

  // Link/reassign commercial on deposit modal
  const [linkingDepot, setLinkingDepot] = useState<DepotWithClient | null>(null);
  const [linkCommercialId, setLinkCommercialId] = useState('');
  const [linkCustomTaux, setLinkCustomTaux] = useState('');
  const [savingLink, setSavingLink] = useState(false);

  // Confirm delete modal
  const [confirmDelete, setConfirmDelete] = useState<{
    kind: 'commercial' | 'versement' | 'client_link';
    id: string;
    label: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Printable report state
  const [reportData, setReportData] = useState<ReportData | null>(null);

  const loadAll = useCallback(async () => {
    setError(null);
    const [comRes, ccRes, versRes, depotsData, clientsData, modesData, entData] = await Promise.all([
      db.getCommerciaux(),
      db.getCommercialClients(),
      db.getCommissionVersements(),
      db.getDepotsForCommissions(),
      db.getAllClients(),
      db.getModesReglement(),
      db.getEntreprise(),
    ]);

    if (comRes.missingTable || versRes.missingTable) {
      setMissingTable(true);
      setMissingClientsTable(false);
      setCommerciaux([]);
      setCommercialClients([]);
      setVersements([]);
    } else {
      setMissingTable(false);
      setCommerciaux(comRes.data);
      setVersements(versRes.data);
      if (ccRes.missingTable) {
        setMissingClientsTable(true);
        setCommercialClients([]);
      } else {
        setMissingClientsTable(false);
        setCommercialClients(ccRes.data);
      }
      if (comRes.error) setError(comRes.error);
      else if (versRes.error) setError(versRes.error);
      else if (ccRes.error) setError(ccRes.error);
    }

    setDepots(depotsData);
    setAllClients(clientsData);
    setModes(modesData);
    setEntreprise(entData);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useRealtimeSync(['commerciaux', 'commercial_clients', 'commission_versements', 'depots'], () => {
    void loadAll();
  });

  const commerciauxMap = useMemo(() => {
    const map = new Map<string, Commercial>();
    for (const c of commerciaux) map.set(c.id, c);
    return map;
  }, [commerciaux]);

  // Group links by client (most recent first) for O(1) lookup during invoice attribution
  const linksByClient = useMemo(() => {
    const map = new Map<string, CommercialClientWithDetails[]>();
    const sorted = [...commercialClients].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    for (const link of sorted) {
      const arr = map.get(link.client_id) ?? [];
      arr.push(link);
      map.set(link.client_id, arr);
    }
    return map;
  }, [commercialClients]);

  // Resolve effective attribution (direct OR active client-period) for every deposit
  const depotAttributionMap = useMemo(() => {
    const map = new Map<string, ResolvedDepotAttribution>();
    for (const d of depots) {
      const attr = resolveDepotAttribution(d, commerciauxMap, linksByClient);
      if (attr) map.set(d.id, attr);
    }
    return map;
  }, [depots, commerciauxMap, linksByClient]);

  // Compute per-link invoice metrics (all non-cancelled invoices of that client during [date_debut, date_fin])
  const clientLinkMetricsMap = useMemo(() => {
    const map = new Map<string, { nbFactures: number; ca: number; commissions: number }>();
    for (const link of commercialClients) {
      const com = commerciauxMap.get(link.commercial_id);
      let nbFactures = 0;
      let ca = 0;
      let commissions = 0;
      for (const d of depots) {
        if (String(d.statut ?? '') === 'ANNULE' || d.client_id !== link.client_id) continue;
        const dDate = (d.date_depot ?? '').slice(0, 10);
        if (!dDate || dDate < link.date_debut || dDate > link.date_fin) continue;
        if (d.commercial_id && d.commercial_id !== link.commercial_id) continue;
        nbFactures += 1;
        ca += Number(d.total ?? 0);
        if (d.commercial_id === link.commercial_id && d.commission_montant != null) {
          commissions += Number(d.commission_montant);
        } else {
          const taux = d.commission_taux ?? link.taux_commission ?? com?.taux_commission ?? 0;
          commissions += Math.round((Number(d.total ?? 0) * taux) / 100);
        }
      }
      map.set(link.id, { nbFactures, ca, commissions });
    }
    return map;
  }, [commercialClients, commerciauxMap, depots]);

  // Compute full statistics per commercial
  const statsByCommercial = useMemo<CommercialStats[]>(() => {
    const depAgg = new Map<string, { count: number; ca: number; comm: number }>();
    for (const d of depots) {
      const attr = depotAttributionMap.get(d.id);
      if (!attr) continue;
      const prev = depAgg.get(attr.commercialId) ?? { count: 0, ca: 0, comm: 0 };
      prev.count += 1;
      prev.ca += Number(d.total ?? 0);
      prev.comm += attr.montant;
      depAgg.set(attr.commercialId, prev);
    }

    const versAgg = new Map<string, number>();
    for (const v of versements) {
      versAgg.set(v.commercial_id, (versAgg.get(v.commercial_id) ?? 0) + Number(v.montant ?? 0));
    }

    const todayYmd = new Date().toISOString().slice(0, 10);
    const clientCounts = new Map<string, { total: number; actifs: number }>();
    for (const link of commercialClients) {
      const prev = clientCounts.get(link.commercial_id) ?? { total: 0, actifs: 0 };
      prev.total += 1;
      if (isCommercialClientLinkActiveOnDate(link, todayYmd)) prev.actifs += 1;
      clientCounts.set(link.commercial_id, prev);
    }

    return commerciaux.map((commercial) => {
      const dep = depAgg.get(commercial.id) ?? { count: 0, ca: 0, comm: 0 };
      const verse = versAgg.get(commercial.id) ?? 0;
      const cl = clientCounts.get(commercial.id) ?? { total: 0, actifs: 0 };
      return {
        commercial,
        nbClientsLies: cl.total,
        nbClientsActifs: cl.actifs,
        nbDepots: dep.count,
        chiffreAffaires: dep.ca,
        commissionsDues: dep.comm,
        commissionsVersees: verse,
        soldeAPayer: Math.max(0, dep.comm - verse),
      };
    });
  }, [commerciaux, commercialClients, depots, depotAttributionMap, versements]);

  const statsMap = useMemo(() => {
    const m = new Map<string, CommercialStats>();
    for (const s of statsByCommercial) m.set(s.commercial.id, s);
    return m;
  }, [statsByCommercial]);

  // Global KPI totals
  const kpis = useMemo(() => {
    const actifs = commerciaux.filter((c) => c.actif).length;
    let totalCA = 0;
    let totalDues = 0;
    let totalVersees = 0;
    let totalDepotsLies = 0;
    let totalClientsActifs = 0;
    for (const s of statsByCommercial) {
      totalCA += s.chiffreAffaires;
      totalDues += s.commissionsDues;
      totalVersees += s.commissionsVersees;
      totalDepotsLies += s.nbDepots;
      totalClientsActifs += s.nbClientsActifs;
    }
    const totalReste = Math.max(0, totalDues - totalVersees);
    return {
      actifs,
      total: commerciaux.length,
      totalCA,
      totalDues,
      totalVersees,
      totalReste,
      totalDepotsLies,
      totalClientsActifs,
    };
  }, [commerciaux, statsByCommercial]);

  // Detect if portal_code column is missing on existing commerciaux
  const needsUpgradeSql =
    !missingTable &&
    (missingClientsTable || (commerciaux.length > 0 && commerciaux.every((c) => !c.portal_code)));

  // Filtered lists per tab
  const filteredStats = useMemo(() => {
    const q = search.trim().toLowerCase();
    return statsByCommercial.filter((s) => {
      if (statusFilter === 'active' && !s.commercial.actif) return false;
      if (statusFilter === 'inactive' && s.commercial.actif) return false;
      if (!q) return true;
      return (
        s.commercial.nom.toLowerCase().includes(q) ||
        (s.commercial.telephone ?? '').toLowerCase().includes(q) ||
        (s.commercial.email ?? '').toLowerCase().includes(q) ||
        (s.commercial.portal_code ?? '').toLowerCase().includes(q)
      );
    });
  }, [statsByCommercial, statusFilter, search]);

  const filteredClientLinks = useMemo(() => {
    const q = search.trim().toLowerCase();
    const todayYmd = new Date().toISOString().slice(0, 10);
    return commercialClients.filter((link) => {
      if (selectedCommercialFilter !== 'all' && link.commercial_id !== selectedCommercialFilter) return false;
      const activeNow = isCommercialClientLinkActiveOnDate(link, todayYmd);
      if (clientLinkStatusFilter === 'active' && !activeNow) return false;
      if (clientLinkStatusFilter === 'expired' && activeNow) return false;
      if (!q) return true;
      const comNom = commerciauxMap.get(link.commercial_id)?.nom ?? '';
      return (
        link.client_nom.toLowerCase().includes(q) ||
        (link.client_code ?? '').toLowerCase().includes(q) ||
        (link.client_telephone ?? '').toLowerCase().includes(q) ||
        comNom.toLowerCase().includes(q)
      );
    });
  }, [commercialClients, selectedCommercialFilter, clientLinkStatusFilter, search, commerciauxMap]);

  const filteredVersements = useMemo(() => {
    const q = search.trim().toLowerCase();
    return versements.filter((v) => {
      if (selectedCommercialFilter !== 'all' && v.commercial_id !== selectedCommercialFilter) return false;
      const vDate = (v.date_versement ?? '').slice(0, 10);
      if (dateFrom && vDate < dateFrom) return false;
      if (dateTo && vDate > dateTo) return false;
      if (!q) return true;
      const comNom = commerciauxMap.get(v.commercial_id)?.nom ?? '';
      return (
        comNom.toLowerCase().includes(q) ||
        (v.reference ?? '').toLowerCase().includes(q) ||
        (v.mode_reglement ?? '').toLowerCase().includes(q) ||
        (v.notes ?? '').toLowerCase().includes(q)
      );
    });
  }, [versements, selectedCommercialFilter, dateFrom, dateTo, search, commerciauxMap]);

  const filteredDepots = useMemo(() => {
    const q = search.trim().toLowerCase();
    return depots.filter((d) => {
      const attr = depotAttributionMap.get(d.id);
      if (depotLinkFilter === 'linked' && !attr) return false;
      if (selectedCommercialFilter !== 'all' && attr?.commercialId !== selectedCommercialFilter) return false;
      const dDate = (d.date_depot ?? '').slice(0, 10);
      if (dateFrom && dDate < dateFrom) return false;
      if (dateTo && dDate > dateTo) return false;
      if (!q) return true;
      const comNom = attr ? (commerciauxMap.get(attr.commercialId)?.nom ?? '') : '';
      return (
        (d.numero ?? '').toLowerCase().includes(q) ||
        (d.clients?.nom ?? '').toLowerCase().includes(q) ||
        comNom.toLowerCase().includes(q)
      );
    });
  }, [depots, depotAttributionMap, depotLinkFilter, selectedCommercialFilter, dateFrom, dateTo, search, commerciauxMap]);

  // ─── Commercial CRUD handlers ─────────────────────────────
  function openCreateCommercial() {
    setEditingCommercial(null);
    setFormNom('');
    setFormTelephone('');
    setFormEmail('');
    setFormTaux('10');
    setFormActif(true);
    setFormNotes('');
    setShowCommercialModal(true);
  }

  function openEditCommercial(c: Commercial) {
    setEditingCommercial(c);
    setFormNom(c.nom);
    setFormTelephone(c.telephone ?? '');
    setFormEmail(c.email ?? '');
    setFormTaux(String(c.taux_commission));
    setFormActif(c.actif);
    setFormNotes(c.notes ?? '');
    setShowCommercialModal(true);
  }

  async function handleSaveCommercial(e: React.FormEvent) {
    e.preventDefault();
    const nom = formNom.trim();
    const taux = parseFloat(formTaux);
    if (!nom) {
      setError(lang === 'fr' ? "Veuillez saisir le nom de l'apporteur d'affaire." : 'Please enter the referral partner name.');
      return;
    }
    if (!Number.isFinite(taux) || taux < 0 || taux > 100) {
      setError(lang === 'fr' ? 'Le taux de commission doit être compris entre 0 et 100 %.' : 'Commission rate must be between 0 and 100%.');
      return;
    }

    setSavingCommercial(true);
    setError(null);
    setSuccess(null);
    try {
      if (editingCommercial) {
        const err = await db.updateCommercial(editingCommercial.id, {
          nom,
          telephone: formTelephone,
          email: formEmail,
          taux_commission: taux,
          actif: formActif,
          notes: formNotes,
        });
        if (err) {
          setError(err);
        } else {
          setSuccess(lang === 'fr' ? `Apporteur d'affaire « ${nom} » mis à jour.` : `Referral partner "${nom}" updated.`);
          setShowCommercialModal(false);
          await loadAll();
        }
      } else {
        const res = await db.insertCommercial({
          nom,
          telephone: formTelephone,
          email: formEmail,
          taux_commission: taux,
          actif: formActif,
          notes: formNotes,
        });
        if (res.error) {
          setError(res.error);
        } else {
          setSuccess(lang === 'fr' ? `Apporteur d'affaire « ${nom} » ajouté avec un taux de ${taux} %.` : `Referral partner "${nom}" added (${taux}% rate).`);
          setShowCommercialModal(false);
          await loadAll();
        }
      }
    } finally {
      setSavingCommercial(false);
    }
  }

  async function handleToggleActive(c: Commercial) {
    setError(null);
    const err = await db.updateCommercial(c.id, { actif: !c.actif });
    if (err) setError(err);
    else await loadAll();
  }

  // ─── Payout handlers ──────────────────────────────────────
  function openPayoutModal(commercialId?: string) {
    const targetId = commercialId || commerciaux.find((c) => c.actif)?.id || commerciaux[0]?.id || '';
    const st = targetId ? statsMap.get(targetId) : undefined;
    setPayoutCommercialId(targetId);
    setPayoutMontant(st && st.soldeAPayer > 0 ? String(Math.round(st.soldeAPayer)) : '');
    setPayoutDate(new Date().toISOString().slice(0, 10));
    setPayoutMode(modes[0]?.designation ?? 'Espèces');
    setPayoutPeriodeDebut('');
    setPayoutPeriodeFin('');
    setPayoutRef('');
    setPayoutNotes('');
    setPayoutLogDepense(false);
    setShowPayoutModal(true);
  }

  async function handleSavePayout(e: React.FormEvent) {
    e.preventDefault();
    const montant = parseFloat(payoutMontant);
    if (!payoutCommercialId) {
      setError(lang === 'fr' ? "Veuillez choisir un apporteur d'affaire." : 'Please select a referral partner.');
      return;
    }
    if (!Number.isFinite(montant) || montant <= 0) {
      setError(lang === 'fr' ? 'Le montant versé doit être supérieur à 0.' : 'Payout amount must be greater than 0.');
      return;
    }

    setSavingPayout(true);
    setError(null);
    setSuccess(null);
    try {
      const isoDate = payoutDate ? new Date(`${payoutDate}T12:00:00`).toISOString() : new Date().toISOString();
      const res = await db.insertCommissionVersement({
        commercial_id: payoutCommercialId,
        montant,
        mode_reglement: payoutMode || null,
        date_versement: isoDate,
        periode_debut: payoutPeriodeDebut || null,
        periode_fin: payoutPeriodeFin || null,
        reference: payoutRef || null,
        notes: payoutNotes || null,
      });

      if (res.error) {
        setError(res.error);
        return;
      }

      const comNom = commerciauxMap.get(payoutCommercialId)?.nom ?? '';

      if (payoutLogDepense) {
        await db.insertDepense({
          date_depense: payoutDate || new Date().toISOString().slice(0, 10),
          libelle: `Commission apporteur d'affaire — ${comNom}`,
          categorie: 'Commissions',
          montant,
          mode_reglement: payoutMode || null,
          notes: [payoutRef ? `Réf: ${payoutRef}` : null, payoutNotes.trim() || null].filter(Boolean).join(' · ') || null,
        });
      }

      setSuccess(
        lang === 'fr'
          ? `Versement de ${formatPrice(montant)} enregistré pour ${comNom}.`
          : `Payout of ${formatPrice(montant)} recorded for ${comNom}.`,
      );
      setShowPayoutModal(false);
      await loadAll();
    } finally {
      setSavingPayout(false);
    }
  }

  // ─── Link commercial to existing deposit ──────────────────
  function openLinkDepotModal(depot: DepotWithClient) {
    setLinkingDepot(depot);
    const cid = depot.commercial_id ?? '';
    setLinkCommercialId(cid);
    if (depot.commission_taux != null) {
      setLinkCustomTaux(String(depot.commission_taux));
    } else if (cid && commerciauxMap.has(cid)) {
      setLinkCustomTaux(String(commerciauxMap.get(cid)!.taux_commission));
    } else {
      setLinkCustomTaux('');
    }
  }

  async function handleSaveDepotLink(e: React.FormEvent) {
    e.preventDefault();
    if (!linkingDepot) return;
    setSavingLink(true);
    setError(null);
    setSuccess(null);
    try {
      if (!linkCommercialId) {
        const err = await db.updateDepot(linkingDepot.id, {
          commercial_id: null,
          commission_taux: null,
          commission_montant: null,
        });
        if (err) setError(err);
        else {
          setSuccess(lang === 'fr' ? "Lien apporteur d'affaire retiré du dépôt." : 'Referral partner unlinked from deposit.');
          setLinkingDepot(null);
          await loadAll();
        }
        return;
      }

      const com = commerciauxMap.get(linkCommercialId);
      const taux = linkCustomTaux !== '' ? parseFloat(linkCustomTaux) : (com?.taux_commission ?? 0);
      if (!Number.isFinite(taux) || taux < 0 || taux > 100) {
        setError(lang === 'fr' ? 'Taux invalide (0 à 100 %).' : 'Invalid rate (0–100%).');
        return;
      }
      const montant = Math.round((Number(linkingDepot.total ?? 0) * taux) / 100);
      const err = await db.updateDepot(linkingDepot.id, {
        commercial_id: linkCommercialId,
        commission_taux: taux,
        commission_montant: montant,
      });
      if (err) setError(err);
      else {
        setSuccess(
          lang === 'fr'
            ? `Dépôt ${linkingDepot.numero ?? ''} associé à ${com?.nom ?? ''} (${formatPrice(montant)}).`
            : `Deposit ${linkingDepot.numero ?? ''} linked to ${com?.nom ?? ''} (${formatPrice(montant)}).`,
        );
        setLinkingDepot(null);
        await loadAll();
      }
    } finally {
      setSavingLink(false);
    }
  }

  // ─── Confirm delete handler ───────────────────────────────
  async function handleExecuteDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    setError(null);
    setSuccess(null);
    try {
      const err =
        confirmDelete.kind === 'commercial'
          ? await db.deleteCommercial(confirmDelete.id)
          : confirmDelete.kind === 'client_link'
            ? await db.deleteCommercialClient(confirmDelete.id)
            : await db.deleteCommissionVersement(confirmDelete.id);
      if (err) {
        setError(err);
      } else {
        setSuccess(
          confirmDelete.kind === 'commercial'
            ? (lang === 'fr' ? `Apporteur d'affaire « ${confirmDelete.label} » supprimé.` : `Referral partner "${confirmDelete.label}" deleted.`)
            : confirmDelete.kind === 'client_link'
              ? (lang === 'fr' ? `Lien client « ${confirmDelete.label} » retiré.` : `Client link "${confirmDelete.label}" removed.`)
              : (lang === 'fr' ? 'Versement supprimé.' : 'Payout deleted.'),
        );
        setConfirmDelete(null);
        await loadAll();
      }
    } finally {
      setDeleting(false);
    }
  }

  function openLinkClientsModal(commercialId?: string) {
    setEditingClientLink(null);
    setClientLinkInitialComId(commercialId);
    setShowClientLinkModal(true);
  }

  function openEditClientLinkModal(link: CommercialClientWithDetails) {
    setEditingClientLink(link);
    setClientLinkInitialComId(link.commercial_id);
    setShowClientLinkModal(true);
  }

  function copyPortalCodeInline(id: string, code: string) {
    navigator.clipboard.writeText(code);
    setCopiedCodeId(id);
    setTimeout(() => setCopiedCodeId(null), 1800);
  }

  // ─── Print report ─────────────────────────────────────────
  function handlePrintReport() {
    if (tab === 'versements') {
      const totalPaid = filteredVersements.reduce((s, v) => s + Number(v.montant ?? 0), 0);
      const data: ReportData = {
        title: lang === 'fr' ? 'Suivi des commissions versées' : 'Commission payouts ledger',
        subtitle:
          selectedCommercialFilter !== 'all'
            ? commerciauxMap.get(selectedCommercialFilter)?.nom
            : (lang === 'fr' ? "Tous les apporteurs d'affaire" : 'All referral partners'),
        entreprise,
        periodLabel:
          dateFrom || dateTo
            ? `${dateFrom ? formatDateShort(dateFrom) : '…'} → ${dateTo ? formatDateShort(dateTo) : '…'}`
            : undefined,
        columns: [
          { key: 'date', label: 'Date', render: (r) => formatDateShort(String(r.date_versement ?? '')) },
          { key: 'commercial', label: "Apporteur d'affaire", render: (r) => String(r.commercial_nom ?? '—') },
          { key: 'periode', label: 'Période', render: (r) => String(r.periode_label ?? '—') },
          { key: 'mode', label: 'Mode', render: (r) => String(r.mode_reglement ?? '—') },
          { key: 'ref', label: 'Référence', render: (r) => String(r.reference ?? '—') },
          { key: 'montant', label: 'Montant versé', align: 'right', render: (r) => formatPrice(Number(r.montant ?? 0)) },
        ],
        rows: filteredVersements.map((v) => ({
          ...v,
          commercial_nom: commerciauxMap.get(v.commercial_id)?.nom ?? '—',
          periode_label:
            v.periode_debut || v.periode_fin
              ? `${v.periode_debut ? formatDateShort(v.periode_debut) : '…'} - ${v.periode_fin ? formatDateShort(v.periode_fin) : '…'}`
              : '—',
        })),
        summaryRows: [
          { label: lang === 'fr' ? 'Nombre de versements' : 'Total payouts', value: String(filteredVersements.length) },
          { label: lang === 'fr' ? 'Total versé' : 'Total paid', value: formatPrice(totalPaid), highlight: true },
        ],
      };
      setReportData(data);
      setTimeout(() => printReport(), 80);
      return;
    }

    const data: ReportData = {
      title: lang === 'fr' ? "État des commissions par apporteur d'affaire" : 'Commission summary by referral partner',
      entreprise,
      columns: [
        { key: 'nom', label: "Apporteur d'affaire", render: (r) => String(r.nom ?? '') },
        { key: 'taux', label: 'Taux', align: 'right', render: (r) => `${Number(r.taux ?? 0)} %` },
        { key: 'depots', label: 'Dépôts', align: 'right', render: (r) => String(r.nbDepots ?? 0) },
        { key: 'ca', label: 'CA apporté', align: 'right', render: (r) => formatPrice(Number(r.ca ?? 0)) },
        { key: 'dues', label: 'Commissions dues', align: 'right', render: (r) => formatPrice(Number(r.dues ?? 0)) },
        { key: 'versees', label: 'Versées', align: 'right', render: (r) => formatPrice(Number(r.versees ?? 0)) },
        { key: 'solde', label: 'Reste à payer', align: 'right', render: (r) => formatPrice(Number(r.solde ?? 0)) },
      ],
      rows: filteredStats.map((s) => ({
        nom: s.commercial.nom,
        taux: s.commercial.taux_commission,
        nbDepots: s.nbDepots,
        ca: s.chiffreAffaires,
        dues: s.commissionsDues,
        versees: s.commissionsVersees,
        solde: s.soldeAPayer,
      })),
      summaryRows: [
        { label: lang === 'fr' ? 'Total commissions dues' : 'Total earned', value: formatPrice(kpis.totalDues) },
        { label: lang === 'fr' ? 'Total déjà versé' : 'Total paid', value: formatPrice(kpis.totalVersees) },
        { label: lang === 'fr' ? 'Solde global à verser' : 'Remaining balance', value: formatPrice(kpis.totalReste), highlight: true },
      ],
    };
    setReportData(data);
    setTimeout(() => printReport(), 80);
  }

  const selectedPayoutStats = payoutCommercialId ? statsMap.get(payoutCommercialId) : undefined;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {lang === 'fr' ? "Apporteurs d'affaire & Commissions" : 'Referral Partners & Commissions'}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {lang === 'fr'
              ? "Définissez le taux de commission de chaque apporteur d'affaire, liez les clients ou dépôts et suivez les versements."
              : 'Configure commission rates, link clients or deposits to referral partners, and track payouts.'}
          </p>
        </div>
        {!missingTable && (
          <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={handlePrintReport}
              disabled={commerciaux.length === 0}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-40 whitespace-nowrap"
            >
              <Printer className="w-4 h-4" />
              {lang === 'fr' ? 'Imprimer' : 'Print'}
            </button>
            {canManage && commerciaux.length > 0 && !missingClientsTable && (
              <button
                type="button"
                onClick={() => openLinkClientsModal(selectedCommercialFilter !== 'all' ? selectedCommercialFilter : undefined)}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-sky-200 bg-sky-50 text-sky-800 text-sm font-semibold hover:bg-sky-100 transition-colors whitespace-nowrap"
              >
                <Users className="w-4 h-4" />
                {lang === 'fr' ? 'Lier des clients' : 'Link clients'}
              </button>
            )}
            {canManage && commerciaux.length > 0 && (
              <button
                type="button"
                onClick={() => openPayoutModal()}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm font-semibold hover:bg-emerald-100 transition-colors whitespace-nowrap"
              >
                <Wallet className="w-4 h-4" />
                {lang === 'fr' ? 'Verser' : 'Pay'}
              </button>
            )}
            {canManage && (
              <button
                type="button"
                onClick={openCreateCommercial}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 transition-colors whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                {lang === 'fr' ? "Nouvel apporteur d'affaire" : 'New partner'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Feedback banners */}
      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 flex items-start justify-between gap-3 text-sm text-red-700">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
          <button type="button" onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {success && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 flex items-center justify-between gap-3 text-sm text-emerald-800">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>{success}</span>
          </div>
          <button type="button" onClick={() => setSuccess(null)} className="text-emerald-500 hover:text-emerald-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Missing migration setup panel */}
      {missingTable ? (
        <div className="bg-white rounded-xl border border-amber-200 p-6 space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-slate-900">
                {lang === 'fr' ? 'Activation de la base de données requise' : 'Database setup required'}
              </h2>
              <p className="text-sm text-slate-600">
                {lang === 'fr'
                  ? "Les tables des apporteurs d'affaire et des versements de commissions ne sont pas encore créées sur votre projet Supabase. Copiez le script SQL ci-dessous et exécutez-le dans Supabase → SQL Editor, puis cliquez sur « Vérifier »."
                  : 'The sales agents and commission payout tables have not been created on your Supabase project yet. Copy the SQL below and run it in Supabase → SQL Editor, then click "Verify".'}
              </p>
            </div>
          </div>

          <pre className="text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg p-3.5 max-h-64 overflow-auto text-slate-800 whitespace-pre-wrap">
            {COMMISSIONS_MIGRATION_SQL}
          </pre>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(COMMISSIONS_MIGRATION_SQL);
                setCopiedSql(true);
                setTimeout(() => setCopiedSql(false), 2500);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 transition-colors"
            >
              {copiedSql ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copiedSql ? (lang === 'fr' ? 'SQL copié !' : 'SQL copied!') : (lang === 'fr' ? 'Copier le script SQL' : 'Copy SQL script')}
            </button>
            <button
              type="button"
              onClick={() => { setLoading(true); void loadAll(); }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              {lang === 'fr' ? 'Vérifier maintenant' : 'Verify now'}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Incremental SQL upgrade banner if commercial_clients or portal_code isn't applied yet */}
          {needsUpgradeSql && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-start gap-2.5 text-sm text-amber-900">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">
                    {lang === 'fr'
                      ? "Mise à jour SQL requise pour les clients liés et le Portail Apporteur d'affaire"
                      : 'SQL update required for linked clients & Partner Portal'}
                  </p>
                  <p className="text-xs text-amber-800 mt-0.5">
                    {lang === 'fr'
                      ? 'Exécutez le script SQL de mise à jour dans Supabase → SQL Editor pour activer les périodes clients et les codes portail.'
                      : 'Run the SQL update script in Supabase → SQL Editor to enable client periods and portal access codes.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(COMMERCIAL_CLIENTS_PORTAL_SQL);
                    setCopiedUpgradeSql(true);
                    setTimeout(() => setCopiedUpgradeSql(false), 2500);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 transition-colors whitespace-nowrap"
                >
                  {copiedUpgradeSql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedUpgradeSql ? (lang === 'fr' ? 'SQL copié !' : 'Copied!') : (lang === 'fr' ? 'Copier le SQL' : 'Copy SQL')}
                </button>
                <button
                  type="button"
                  onClick={() => { setLoading(true); void loadAll(); }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-300 bg-white text-amber-900 text-xs font-medium hover:bg-amber-100/50 transition-colors whitespace-nowrap"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {lang === 'fr' ? 'Vérifier' : 'Verify'}
                </button>
              </div>
            </div>
          )}

          {/* KPI Summary Bar — flat hairline grid, tabular figures */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-slate-200/80 p-4">
              <p className="text-xs font-medium text-slate-500">
                {lang === 'fr' ? "Apporteurs d'affaire actifs" : 'Active referral partners'}
              </p>
              <p className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">
                {kpis.actifs}
                <span className="text-sm font-normal text-slate-400 ml-1.5">/ {kpis.total}</span>
              </p>
              <p className="mt-1 text-xs text-slate-500 tabular-nums">
                {kpis.totalClientsActifs}{' '}
                {lang === 'fr' ? 'client(s) en période active' : 'active linked client(s)'}
              </p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200/80 p-4">
              <p className="text-xs font-medium text-slate-500">
                {lang === 'fr' ? "Chiffre d'affaires apporté" : 'Attributed revenue'}
              </p>
              <p className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">
                {formatPrice(kpis.totalCA)}
              </p>
              <p className="mt-1 text-xs text-slate-500 tabular-nums">
                {kpis.totalDepotsLies}{' '}
                {lang === 'fr' ? 'facture(s) commissionnée(s)' : 'commissionable invoice(s)'}
              </p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200/80 p-4">
              <p className="text-xs font-medium text-slate-500">
                {lang === 'fr' ? 'Commissions générées' : 'Earned commissions'}
              </p>
              <p className="mt-2 text-2xl font-bold text-sky-700 tabular-nums">
                {formatPrice(kpis.totalDues)}
              </p>
              <p className="mt-1 text-xs text-emerald-700 tabular-nums">
                {lang === 'fr' ? 'Déjà versé : ' : 'Paid: '}
                {formatPrice(kpis.totalVersees)}
              </p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200/80 p-4">
              <p className="text-xs font-medium text-slate-500">
                {lang === 'fr' ? 'Solde restant à verser' : 'Balance to pay'}
              </p>
              <p className={`mt-2 text-2xl font-bold tabular-nums ${kpis.totalReste > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                {formatPrice(kpis.totalReste)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {kpis.totalReste > 0
                  ? (lang === 'fr' ? 'En attente de règlement' : 'Pending payout')
                  : (lang === 'fr' ? 'Toutes les commissions sont soldées' : 'All commissions settled')}
              </p>
            </div>
          </div>

          {/* Segmented Tabs + Toolbar */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start overflow-x-auto max-w-full">
              <button
                type="button"
                onClick={() => setTab('overview')}
                className={`px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                  tab === 'overview' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {lang === 'fr' ? "Apporteurs d'affaire & Soldes" : 'Partners & Balances'}
              </button>
              <button
                type="button"
                onClick={() => setTab('clients')}
                className={`px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                  tab === 'clients' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {lang === 'fr' ? `Clients liés (${commercialClients.length})` : `Linked clients (${commercialClients.length})`}
              </button>
              <button
                type="button"
                onClick={() => setTab('versements')}
                className={`px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                  tab === 'versements' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {lang === 'fr' ? `Versements (${versements.length})` : `Payouts (${versements.length})`}
              </button>
              <button
                type="button"
                onClick={() => setTab('depots')}
                className={`px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                  tab === 'depots' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {lang === 'fr' ? 'Factures & Dépôts' : 'Invoices & Deposits'}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 sm:flex-initial sm:w-56">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={lang === 'fr' ? 'Rechercher…' : 'Search…'}
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              {tab === 'overview' && (
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
                  className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="all">{lang === 'fr' ? 'Tous les statuts' : 'All statuses'}</option>
                  <option value="active">{lang === 'fr' ? 'Actifs uniquement' : 'Active only'}</option>
                  <option value="inactive">{lang === 'fr' ? 'Inactifs uniquement' : 'Inactive only'}</option>
                </select>
              )}

              {tab === 'clients' && (
                <>
                  <select
                    value={selectedCommercialFilter}
                    onChange={(e) => setSelectedCommercialFilter(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <option value="all">{lang === 'fr' ? "Tous les apporteurs d'affaire" : 'All referral partners'}</option>
                    {commerciaux.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nom} ({c.taux_commission}%)
                      </option>
                    ))}
                  </select>
                  <select
                    value={clientLinkStatusFilter}
                    onChange={(e) => setClientLinkStatusFilter(e.target.value as 'all' | 'active' | 'expired')}
                    className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <option value="all">{lang === 'fr' ? 'Toutes les périodes' : 'All periods'}</option>
                    <option value="active">{lang === 'fr' ? 'Périodes actives' : 'Active periods'}</option>
                    <option value="expired">{lang === 'fr' ? 'Périodes expirées' : 'Expired periods'}</option>
                  </select>
                </>
              )}

              {(tab === 'versements' || tab === 'depots') && (
                <>
                  <select
                    value={selectedCommercialFilter}
                    onChange={(e) => setSelectedCommercialFilter(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <option value="all">{lang === 'fr' ? "Tous les apporteurs d'affaire" : 'All referral partners'}</option>
                    {commerciaux.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nom} ({c.taux_commission}%)
                      </option>
                    ))}
                  </select>
                  {tab === 'depots' && (
                    <select
                      value={depotLinkFilter}
                      onChange={(e) => setDepotLinkFilter(e.target.value as 'linked' | 'all')}
                      className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    >
                      <option value="linked">{lang === 'fr' ? 'Factures commissionnées' : 'Commissioned invoices'}</option>
                      <option value="all">{lang === 'fr' ? 'Toutes les factures (pour associer)' : 'All invoices (to link)'}</option>
                    </select>
                  )}
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="px-2.5 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    title={lang === 'fr' ? 'Date début' : 'Start date'}
                  />
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="px-2.5 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    title={lang === 'fr' ? 'Date fin' : 'End date'}
                  />
                </>
              )}
            </div>
          </div>

          {/* Loading state */}
          {loading ? (
            <div className="bg-white rounded-xl border border-slate-200/80 p-6 space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-11 rounded-lg bg-slate-100 animate-pulse" />
              ))}
            </div>
          ) : tab === 'overview' ? (
            /* ─── TAB 1: Commerciaux & Soldes ─── */
            <div className="bg-white rounded-xl border border-slate-200/80 overflow-hidden">
              {filteredStats.length === 0 ? (
                <div className="py-14 px-6 text-center space-y-3">
                  <Briefcase className="w-10 h-10 text-slate-300 mx-auto" />
                  <p className="text-sm font-medium text-slate-700">
                    {commerciaux.length === 0
                      ? (lang === 'fr' ? "Aucun apporteur d'affaire enregistré pour le moment." : 'No referral partners recorded yet.')
                      : (lang === 'fr' ? "Aucun apporteur d'affaire ne correspond à votre filtre." : 'No referral partner matches your filter.')}
                  </p>
                  {commerciaux.length === 0 && canManage && (
                    <button
                      type="button"
                      onClick={openCreateCommercial}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      {lang === 'fr' ? "Ajouter votre premier apporteur d'affaire" : 'Add your first referral partner'}
                    </button>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-left text-xs font-semibold text-slate-500">
                        <th className="py-3 px-4">{lang === 'fr' ? "Apporteur d'affaire & Code portail" : 'Partner & Portal code'}</th>
                        <th className="py-3 px-4 text-right">{lang === 'fr' ? 'Taux' : 'Rate'}</th>
                        <th className="py-3 px-4 text-right">{lang === 'fr' ? 'Clients' : 'Clients'}</th>
                        <th className="py-3 px-4 text-right">{lang === 'fr' ? 'Factures' : 'Invoices'}</th>
                        <th className="py-3 px-4 text-right">{lang === 'fr' ? 'CA apporté' : 'Revenue'}</th>
                        <th className="py-3 px-4 text-right">{lang === 'fr' ? 'Commissions' : 'Earned'}</th>
                        <th className="py-3 px-4 text-right">{lang === 'fr' ? 'Versé' : 'Paid'}</th>
                        <th className="py-3 px-4 text-right">{lang === 'fr' ? 'Reste à payer' : 'Balance'}</th>
                        <th className="py-3 px-4 text-right">{lang === 'fr' ? 'Actions' : 'Actions'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredStats.map((row) => {
                        const c = row.commercial;
                        const metaParts = [
                          c.telephone || null,
                          c.email || null,
                          c.actif ? (lang === 'fr' ? 'Actif' : 'Active') : (lang === 'fr' ? 'Inactif' : 'Inactive'),
                        ].filter(Boolean);
                        return (
                          <tr key={c.id} className="hover:bg-slate-50/70 transition-colors">
                            <td className="py-3.5 px-4">
                              <p className={`font-semibold ${c.actif ? 'text-slate-900' : 'text-slate-400'}`}>
                                {c.nom}
                              </p>
                              <p className="text-xs text-slate-500 mt-0.5">{metaParts.join(' · ')}</p>
                              {c.portal_code && (
                                <button
                                  type="button"
                                  onClick={() => copyPortalCodeInline(c.id, c.portal_code!)}
                                  className="mt-1 inline-flex items-center gap-1 font-mono text-[11px] font-medium text-sky-700 hover:text-sky-900"
                                  title={lang === 'fr' ? 'Copier le code portail' : 'Copy portal code'}
                                >
                                  <KeyRound className="w-3 h-3" />
                                  <span>{c.portal_code}</span>
                                  {copiedCodeId === c.id ? (
                                    <Check className="w-3 h-3 text-emerald-600" />
                                  ) : (
                                    <Copy className="w-3 h-3 text-slate-400" />
                                  )}
                                </button>
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-right font-mono font-semibold text-slate-800 tabular-nums whitespace-nowrap">
                              {c.taux_commission} %
                            </td>
                            <td className="py-3.5 px-4 text-right tabular-nums text-slate-700 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedCommercialFilter(c.id);
                                  setTab('clients');
                                }}
                                className="hover:text-sky-600 underline decoration-slate-300 underline-offset-2 font-medium"
                                title={lang === 'fr' ? "Voir les clients liés à cet apporteur d'affaire" : 'View linked clients'}
                              >
                                {row.nbClientsActifs}
                                {row.nbClientsLies !== row.nbClientsActifs && (
                                  <span className="text-slate-400 font-normal">/{row.nbClientsLies}</span>
                                )}
                              </button>
                            </td>
                            <td className="py-3.5 px-4 text-right tabular-nums text-slate-700">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedCommercialFilter(c.id);
                                  setDepotLinkFilter('linked');
                                  setTab('depots');
                                }}
                                className="hover:text-sky-600 underline decoration-slate-300 underline-offset-2 font-medium"
                                title={lang === 'fr' ? "Voir les factures de cet apporteur d'affaire" : 'View invoices'}
                              >
                                {row.nbDepots}
                              </button>
                            </td>
                            <td className="py-3.5 px-4 text-right tabular-nums text-slate-700 whitespace-nowrap">
                              {formatPrice(row.chiffreAffaires)}
                            </td>
                            <td className="py-3.5 px-4 text-right tabular-nums font-medium text-sky-700 whitespace-nowrap">
                              {formatPrice(row.commissionsDues)}
                            </td>
                            <td className="py-3.5 px-4 text-right tabular-nums font-medium text-emerald-700 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedCommercialFilter(c.id);
                                  setTab('versements');
                                }}
                                className="hover:underline underline-offset-2"
                                title={lang === 'fr' ? 'Voir les versements' : 'View payouts'}
                              >
                                {formatPrice(row.commissionsVersees)}
                              </button>
                            </td>
                            <td className={`py-3.5 px-4 text-right tabular-nums font-bold whitespace-nowrap ${row.soldeAPayer > 0 ? 'text-amber-700' : 'text-slate-400'}`}>
                              {formatPrice(row.soldeAPayer)}
                            </td>
                            <td className="py-3.5 px-4">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => setPortalShareCommercial(c)}
                                  className="p-1.5 rounded-lg text-slate-500 hover:text-sky-700 hover:bg-sky-50 transition-colors"
                                  title={lang === 'fr' ? "Code & Lien Portail Apporteur d'affaire" : 'Partner Portal Code & Link'}
                                >
                                  <KeyRound className="w-4 h-4" />
                                </button>
                                {canManage && !missingClientsTable && (
                                  <button
                                    type="button"
                                    onClick={() => openLinkClientsModal(c.id)}
                                    className="p-1.5 rounded-lg text-slate-500 hover:text-sky-700 hover:bg-sky-50 transition-colors"
                                    title={lang === 'fr' ? 'Lier des clients' : 'Link clients'}
                                  >
                                    <Users className="w-4 h-4" />
                                  </button>
                                )}
                                {canManage && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => openPayoutModal(c.id)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-semibold hover:bg-emerald-100 transition-colors whitespace-nowrap"
                                    >
                                      <Wallet className="w-3.5 h-3.5" />
                                      {lang === 'fr' ? 'Verser' : 'Pay'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => openEditCommercial(c)}
                                      className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors"
                                      title={lang === 'fr' ? 'Modifier' : 'Edit'}
                                    >
                                      <Pencil className="w-4 h-4" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleToggleActive(c)}
                                      className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                                      title={c.actif ? (lang === 'fr' ? 'Désactiver' : 'Deactivate') : (lang === 'fr' ? 'Réactiver' : 'Reactivate')}
                                    >
                                      {c.actif ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDelete({ kind: 'commercial', id: c.id, label: c.nom })}
                                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                      title={lang === 'fr' ? 'Supprimer' : 'Delete'}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : tab === 'clients' ? (
            /* ─── TAB 2: Clients liés sur période prédéfinie ─── */
            <div className="bg-white rounded-xl border border-slate-200/80 overflow-hidden">
              {filteredClientLinks.length === 0 ? (
                <div className="py-14 px-6 text-center space-y-3">
                  <Users className="w-10 h-10 text-slate-300 mx-auto" />
                  <p className="text-sm font-medium text-slate-700">
                    {commercialClients.length === 0
                      ? (lang === 'fr' ? "Aucun client lié à un apporteur d'affaire pour le moment." : 'No clients linked to referral partners yet.')
                      : (lang === 'fr' ? 'Aucun rattachement ne correspond à votre filtre.' : 'No linked client matches your filter.')}
                  </p>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    {lang === 'fr'
                      ? "Rattachez un ou plusieurs clients à un apporteur d'affaire pour un nombre de jours donné : toutes leurs factures sur la période seront commissionnées automatiquement."
                      : 'Assign one or more clients to a referral partner for a set number of days: all their invoices during that period earn commission automatically.'}
                  </p>
                  {canManage && commerciaux.length > 0 && !missingClientsTable && (
                    <button
                      type="button"
                      onClick={() => openLinkClientsModal(selectedCommercialFilter !== 'all' ? selectedCommercialFilter : undefined)}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 transition-colors"
                    >
                      <Users className="w-4 h-4" />
                      {lang === 'fr' ? 'Lier des clients maintenant' : 'Link clients now'}
                    </button>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-left text-xs font-semibold text-slate-500">
                        <th className="py-3 px-4">{lang === 'fr' ? 'Client' : 'Client'}</th>
                        <th className="py-3 px-4">{lang === 'fr' ? "Apporteur d'affaire" : 'Referral partner'}</th>
                        <th className="py-3 px-4">{lang === 'fr' ? 'Période (jours)' : 'Period (days)'}</th>
                        <th className="py-3 px-4">{lang === 'fr' ? 'Statut' : 'Status'}</th>
                        <th className="py-3 px-4 text-right">{lang === 'fr' ? 'Factures' : 'Invoices'}</th>
                        <th className="py-3 px-4 text-right">{lang === 'fr' ? 'Commission' : 'Commission'}</th>
                        {canManage && <th className="py-3 px-4 text-right">{lang === 'fr' ? 'Actions' : 'Actions'}</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredClientLinks.map((link) => {
                        const com = commerciauxMap.get(link.commercial_id);
                        const metrics = clientLinkMetricsMap.get(link.id) ?? { nbFactures: 0, ca: 0, commissions: 0 };
                        const todayYmd = new Date().toISOString().slice(0, 10);
                        const isActiveNow = isCommercialClientLinkActiveOnDate(link, todayYmd);
                        const daysLeft = getDaysRemainingUntil(link.date_fin, todayYmd);
                        const effRate = link.taux_commission ?? com?.taux_commission ?? 0;

                        return (
                          <tr key={link.id} className="hover:bg-slate-50/70 transition-colors">
                            <td className="py-3 px-4">
                              <p className="font-semibold text-slate-900">{link.client_nom}</p>
                              <p className="text-xs text-slate-500">
                                {[link.client_code, link.client_telephone].filter(Boolean).join(' · ') || '—'}
                              </p>
                            </td>
                            <td className="py-3 px-4">
                              <p className="font-medium text-slate-900">{com?.nom ?? '—'}</p>
                              <p className="text-xs font-mono text-slate-500 tabular-nums">{effRate} %</p>
                            </td>
                            <td className="py-3 px-4 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                              <span className="inline-flex items-center gap-1">
                                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                {formatDateShort(link.date_debut)} → {formatDateShort(link.date_fin)}
                              </span>
                              <span className="text-slate-400 ml-1.5">· {link.duree_jours} j</span>
                            </td>
                            <td className="py-3 px-4 text-xs font-medium whitespace-nowrap">
                              {!link.actif ? (
                                <span className="text-slate-400">{lang === 'fr' ? 'Suspendu' : 'Paused'}</span>
                              ) : isActiveNow ? (
                                <span className={daysLeft <= 5 ? 'text-amber-700 tabular-nums' : 'text-emerald-700 tabular-nums'}>
                                  {lang === 'fr'
                                    ? `Actif · ${daysLeft === 0 ? 'dernier jour' : `${daysLeft} j restant${daysLeft > 1 ? 's' : ''}`}`
                                    : `Active · ${daysLeft}d left`}
                                </span>
                              ) : daysLeft > 0 ? (
                                <span className="text-sky-700">{lang === 'fr' ? 'Planifié' : 'Scheduled'}</span>
                              ) : (
                                <span className="text-slate-400">{lang === 'fr' ? 'Expiré' : 'Expired'}</span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right tabular-nums text-slate-700 whitespace-nowrap">
                              <span className="font-medium">{metrics.nbFactures}</span>
                              {metrics.ca > 0 && (
                                <span className="block text-xs text-slate-400">{formatPrice(metrics.ca)}</span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right font-semibold tabular-nums text-sky-700 whitespace-nowrap">
                              {formatPrice(metrics.commissions)}
                            </td>
                            {canManage && (
                              <td className="py-3 px-4 text-right">
                                <div className="inline-flex items-center justify-end gap-1">
                                  <button
                                    type="button"
                                    onClick={() => openEditClientLinkModal(link)}
                                    className="px-2.5 py-1 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors whitespace-nowrap"
                                  >
                                    {lang === 'fr' ? 'Modifier / Prolonger' : 'Edit / Extend'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setConfirmDelete({
                                        kind: 'client_link',
                                        id: link.id,
                                        label: `${link.client_nom} ↔ ${com?.nom ?? ''}`,
                                      })
                                    }
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                    title={lang === 'fr' ? 'Retirer ce lien' : 'Remove link'}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : tab === 'versements' ? (
            /* ─── TAB 3: Historique des versements ─── */
            <div className="bg-white rounded-xl border border-slate-200/80 overflow-hidden">
              {filteredVersements.length === 0 ? (
                <div className="py-14 px-6 text-center space-y-3">
                  <Receipt className="w-10 h-10 text-slate-300 mx-auto" />
                  <p className="text-sm font-medium text-slate-700">
                    {lang === 'fr' ? 'Aucun versement de commission enregistré.' : 'No commission payouts recorded yet.'}
                  </p>
                  {canManage && commerciaux.length > 0 && (
                    <button
                      type="button"
                      onClick={() => openPayoutModal(selectedCommercialFilter !== 'all' ? selectedCommercialFilter : undefined)}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors"
                    >
                      <Wallet className="w-4 h-4" />
                      {lang === 'fr' ? 'Enregistrer un premier versement' : 'Record first payout'}
                    </button>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-left text-xs font-semibold text-slate-500">
                        <th className="py-3 px-4">{lang === 'fr' ? 'Date' : 'Date'}</th>
                        <th className="py-3 px-4">{lang === 'fr' ? "Apporteur d'affaire" : 'Referral partner'}</th>
                        <th className="py-3 px-4">{lang === 'fr' ? 'Période couverte' : 'Period'}</th>
                        <th className="py-3 px-4">{lang === 'fr' ? 'Mode & Référence' : 'Method & Ref'}</th>
                        <th className="py-3 px-4 text-right">{lang === 'fr' ? 'Montant versé' : 'Amount paid'}</th>
                        {canManage && <th className="py-3 px-4 text-right">{lang === 'fr' ? 'Action' : 'Action'}</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredVersements.map((v) => {
                        const com = commerciauxMap.get(v.commercial_id);
                        const periodeStr =
                          v.periode_debut || v.periode_fin
                            ? `${v.periode_debut ? formatDateShort(v.periode_debut) : '…'} → ${v.periode_fin ? formatDateShort(v.periode_fin) : '…'}`
                            : '—';
                        const details = [v.mode_reglement, v.reference ? `Réf: ${v.reference}` : null, v.notes].filter(Boolean);
                        return (
                          <tr key={v.id} className="hover:bg-slate-50/70 transition-colors">
                            <td className="py-3 px-4 tabular-nums text-slate-600 whitespace-nowrap">
                              {formatDateShort(v.date_versement)}
                            </td>
                            <td className="py-3 px-4 font-semibold text-slate-900">
                              {com?.nom ?? '—'}
                            </td>
                            <td className="py-3 px-4 text-xs text-slate-500 tabular-nums whitespace-nowrap">
                              {periodeStr}
                            </td>
                            <td className="py-3 px-4 text-xs text-slate-600">
                              {details.length > 0 ? details.join(' · ') : '—'}
                            </td>
                            <td className="py-3 px-4 text-right font-bold text-emerald-700 tabular-nums whitespace-nowrap">
                              {formatPrice(v.montant)}
                            </td>
                            {canManage && (
                              <td className="py-3 px-4 text-right">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setConfirmDelete({
                                      kind: 'versement',
                                      id: v.id,
                                      label: `${com?.nom ?? ''} — ${formatPrice(v.montant)}`,
                                    })
                                  }
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                  title={lang === 'fr' ? 'Supprimer ce versement' : 'Delete payout'}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-slate-200 bg-slate-50/70 font-semibold text-slate-900">
                        <td colSpan={4} className="py-3 px-4 text-right text-xs text-slate-500">
                          {lang === 'fr' ? 'Total affiché' : 'Displayed total'} ({filteredVersements.length})
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums text-emerald-700 whitespace-nowrap">
                          {formatPrice(filteredVersements.reduce((sum, v) => sum + Number(v.montant ?? 0), 0))}
                        </td>
                        {canManage && <td />}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          ) : (
            /* ─── TAB 4: Factures & Dépôts commissionnés ─── */
            <div className="bg-white rounded-xl border border-slate-200/80 overflow-hidden">
              {filteredDepots.length === 0 ? (
                <div className="py-14 px-6 text-center space-y-2">
                  <Link2 className="w-10 h-10 text-slate-300 mx-auto" />
                  <p className="text-sm font-medium text-slate-700">
                    {lang === 'fr' ? 'Aucune facture commissionnée trouvée.' : 'No commissioned invoices found.'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {lang === 'fr'
                      ? "Liez un client à un apporteur d'affaire sur une période ou associez un apporteur d'affaire lors du dépôt."
                      : 'Link a client to a referral partner over a period or select one on deposit creation.'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-left text-xs font-semibold text-slate-500">
                        <th className="py-3 px-4">{lang === 'fr' ? 'Date' : 'Date'}</th>
                        <th className="py-3 px-4">{lang === 'fr' ? 'N° Facture' : 'Invoice #'}</th>
                        <th className="py-3 px-4">{lang === 'fr' ? 'Client' : 'Client'}</th>
                        <th className="py-3 px-4">{lang === 'fr' ? "Apporteur d'affaire" : 'Referral partner'}</th>
                        <th className="py-3 px-4 text-right">{lang === 'fr' ? 'Montant facture' : 'Invoice total'}</th>
                        <th className="py-3 px-4 text-right">{lang === 'fr' ? 'Taux' : 'Rate'}</th>
                        <th className="py-3 px-4 text-right">{lang === 'fr' ? 'Commission' : 'Commission'}</th>
                        {canManage && <th className="py-3 px-4 text-right">{lang === 'fr' ? 'Lien' : 'Link'}</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredDepots.slice(0, 200).map((d) => {
                        const attr = depotAttributionMap.get(d.id);
                        const com = attr ? commerciauxMap.get(attr.commercialId) : undefined;
                        return (
                          <tr key={d.id} className="hover:bg-slate-50/70 transition-colors">
                            <td className="py-3 px-4 tabular-nums text-slate-600 whitespace-nowrap">
                              {formatDateShort(d.date_depot)}
                            </td>
                            <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-800 whitespace-nowrap">
                              {d.numero ?? '—'}
                            </td>
                            <td className="py-3 px-4 text-slate-800">
                              {d.clients?.nom ?? '—'}
                            </td>
                            <td className="py-3 px-4">
                              {com && attr ? (
                                <div>
                                  <span className="font-medium text-slate-900">{com.nom}</span>
                                  <span className="block text-[11px] text-slate-400">
                                    {attr.source === 'client_period'
                                      ? (lang === 'fr' ? 'Automatique · période client' : 'Auto · client period')
                                      : (lang === 'fr' ? 'Lien direct' : 'Direct link')}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-xs text-slate-400">{lang === 'fr' ? 'Non associé' : 'Unlinked'}</span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right tabular-nums text-slate-700 whitespace-nowrap">
                              {formatPrice(d.total)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-slate-600 whitespace-nowrap">
                              {attr ? `${attr.taux} %` : '—'}
                            </td>
                            <td className="py-3 px-4 text-right font-semibold tabular-nums text-sky-700 whitespace-nowrap">
                              {attr ? formatPrice(attr.montant) : '—'}
                            </td>
                            {canManage && (
                              <td className="py-3 px-4 text-right">
                                <button
                                  type="button"
                                  onClick={() => openLinkDepotModal(d)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors whitespace-nowrap"
                                >
                                  <Link2 className="w-3.5 h-3.5" />
                                  {attr
                                    ? (lang === 'fr' ? 'Modifier' : 'Change')
                                    : (lang === 'fr' ? 'Associer' : 'Link')}
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-slate-200 bg-slate-50/70 font-semibold text-slate-900">
                        <td colSpan={4} className="py-3 px-4 text-right text-xs text-slate-500">
                          {lang === 'fr' ? 'Total affiché' : 'Displayed total'} ({filteredDepots.length})
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                          {formatPrice(filteredDepots.reduce((s, d) => s + Number(d.total ?? 0), 0))}
                        </td>
                        <td />
                        <td className="py-3 px-4 text-right tabular-nums text-sky-700 whitespace-nowrap">
                          {formatPrice(
                            filteredDepots.reduce((s, d) => s + (depotAttributionMap.get(d.id)?.montant ?? 0), 0),
                          )}
                        </td>
                        {canManage && <td />}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Modal: Create / Edit Commercial */}
      {showCommercialModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs" onClick={() => !savingCommercial && setShowCommercialModal(false)} />
          <form
            onSubmit={handleSaveCommercial}
            className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                {editingCommercial
                  ? (lang === 'fr' ? "Modifier l'apporteur d'affaire" : 'Edit referral partner')
                  : (lang === 'fr' ? "Nouvel apporteur d'affaire" : 'New referral partner')}
              </h3>
              <button
                type="button"
                onClick={() => !savingCommercial && setShowCommercialModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3.5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {lang === 'fr' ? 'Nom complet' : 'Full name'} *
                </label>
                <input
                  type="text"
                  required
                  value={formNom}
                  onChange={(e) => setFormNom(e.target.value)}
                  placeholder="Ex: Kouassi Jean-Marc"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {lang === 'fr' ? 'Taux de commission (%)' : 'Commission rate (%)'} *
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    max="100"
                    step="0.5"
                    value={formTaux}
                    onChange={(e) => setFormTaux(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {lang === 'fr' ? 'Téléphone' : 'Phone'}
                  </label>
                  <input
                    type="tel"
                    value={formTelephone}
                    onChange={(e) => setFormTelephone(e.target.value)}
                    placeholder="+225 07…"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {lang === 'fr' ? 'Email (optionnel)' : 'Email (optional)'}
                </label>
                <input
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="apporteur@exemple.com"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {lang === 'fr' ? 'Notes (optionnel)' : 'Notes (optional)'}
                </label>
                <textarea
                  rows={2}
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder={lang === 'fr' ? 'Zone géographique, conditions particulières…' : 'Territory, special terms…'}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none"
                />
              </div>

              <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={formActif}
                  onChange={(e) => setFormActif(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
                <span>{lang === 'fr' ? "Apporteur d'affaire actif (disponible lors des nouveaux dépôts)" : 'Active (available on new deposits)'}</span>
              </label>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowCommercialModal(false)}
                disabled={savingCommercial}
                className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50"
              >
                {lang === 'fr' ? 'Annuler' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={savingCommercial}
                className="flex-1 px-4 py-2 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {savingCommercial && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingCommercial ? (lang === 'fr' ? 'Enregistrer' : 'Save') : (lang === 'fr' ? "Créer l'apporteur d'affaire" : 'Create')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Record Commission Payout */}
      {showPayoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs" onClick={() => !savingPayout && setShowPayoutModal(false)} />
          <form
            onSubmit={handleSavePayout}
            className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                {lang === 'fr' ? 'Enregistrer un versement de commission' : 'Record commission payout'}
              </h3>
              <button
                type="button"
                onClick={() => !savingPayout && setShowPayoutModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3.5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {lang === 'fr' ? "Apporteur d'affaire" : 'Referral partner'} *
                </label>
                <select
                  required
                  value={payoutCommercialId}
                  onChange={(e) => {
                    const cid = e.target.value;
                    setPayoutCommercialId(cid);
                    const st = statsMap.get(cid);
                    if (st && st.soldeAPayer > 0) setPayoutMontant(String(Math.round(st.soldeAPayer)));
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="">{lang === 'fr' ? "— Choisir un apporteur d'affaire —" : '— Select a partner —'}</option>
                  {commerciaux.map((c) => {
                    const st = statsMap.get(c.id);
                    return (
                      <option key={c.id} value={c.id}>
                        {c.nom} — {lang === 'fr' ? 'Reste' : 'Due'}: {formatPrice(st?.soldeAPayer ?? 0)}
                      </option>
                    );
                  })}
                </select>
              </div>

              {selectedPayoutStats && (
                <div className="rounded-lg bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-500">{lang === 'fr' ? 'Commissions générées' : 'Earned'}</span>
                    <span className="font-medium text-slate-800 tabular-nums">{formatPrice(selectedPayoutStats.commissionsDues)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">{lang === 'fr' ? 'Déjà versé' : 'Already paid'}</span>
                    <span className="font-medium text-emerald-700 tabular-nums">{formatPrice(selectedPayoutStats.commissionsVersees)}</span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-slate-200 font-semibold">
                    <span className="text-slate-700">{lang === 'fr' ? 'Reste à verser' : 'Remaining balance'}</span>
                    <span className="text-amber-700 tabular-nums">{formatPrice(selectedPayoutStats.soldeAPayer)}</span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-sm font-medium text-slate-700">
                      {lang === 'fr' ? 'Montant versé' : 'Amount'} *
                    </label>
                    {selectedPayoutStats && selectedPayoutStats.soldeAPayer > 0 && (
                      <button
                        type="button"
                        onClick={() => setPayoutMontant(String(Math.round(selectedPayoutStats.soldeAPayer)))}
                        className="text-xs font-medium text-sky-600 hover:text-sky-700"
                      >
                        {lang === 'fr' ? 'Solder' : 'Full'}
                      </button>
                    )}
                  </div>
                  <input
                    type="number"
                    required
                    min="1"
                    step="1"
                    value={payoutMontant}
                    onChange={(e) => setPayoutMontant(e.target.value)}
                    placeholder="Ex: 25000"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {lang === 'fr' ? 'Date de versement' : 'Payout date'} *
                  </label>
                  <input
                    type="date"
                    required
                    value={payoutDate}
                    onChange={(e) => setPayoutDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {lang === 'fr' ? 'Mode de règlement' : 'Payment method'}
                  </label>
                  <select
                    value={payoutMode}
                    onChange={(e) => setPayoutMode(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <option value="">{lang === 'fr' ? '— Choisir —' : '— Select —'}</option>
                    {modes.map((m) => (
                      <option key={m.id} value={m.designation}>
                        {m.designation}
                      </option>
                    ))}
                    {!modes.some((m) => m.designation.toLowerCase().includes('esp')) && (
                      <option value="Espèces">Espèces</option>
                    )}
                    {!modes.some((m) => m.designation.toLowerCase().includes('virement')) && (
                      <option value="Virement">Virement</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {lang === 'fr' ? 'Référence (optionnel)' : 'Reference (optional)'}
                  </label>
                  <input
                    type="text"
                    value={payoutRef}
                    onChange={(e) => setPayoutRef(e.target.value)}
                    placeholder="Ex: WAVE-042"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    {lang === 'fr' ? 'Période du (optionnel)' : 'Period from'}
                  </label>
                  <input
                    type="date"
                    value={payoutPeriodeDebut}
                    onChange={(e) => setPayoutPeriodeDebut(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    {lang === 'fr' ? 'Au (optionnel)' : 'Period to'}
                  </label>
                  <input
                    type="date"
                    value={payoutPeriodeFin}
                    onChange={(e) => setPayoutPeriodeFin(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {lang === 'fr' ? 'Notes (optionnel)' : 'Notes (optional)'}
                </label>
                <input
                  type="text"
                  value={payoutNotes}
                  onChange={(e) => setPayoutNotes(e.target.value)}
                  placeholder={lang === 'fr' ? 'Ex: Solde commissions novembre' : 'Ex: November commission settlement'}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <label className="flex items-center gap-2.5 text-xs text-slate-600 cursor-pointer select-none pt-1">
                <input
                  type="checkbox"
                  checked={payoutLogDepense}
                  onChange={(e) => setPayoutLogDepense(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span>
                  {lang === 'fr'
                    ? 'Enregistrer aussi ce versement dans les Dépenses (catégorie Commissions)'
                    : 'Also record this payout in Expenses (Commissions category)'}
                </span>
              </label>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowPayoutModal(false)}
                disabled={savingPayout}
                className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50"
              >
                {lang === 'fr' ? 'Annuler' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={savingPayout}
                className="flex-1 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {savingPayout && <Loader2 className="w-4 h-4 animate-spin" />}
                {lang === 'fr' ? 'Valider le versement' : 'Save payout'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Link / Reassign Commercial on an Existing Deposit */}
      {linkingDepot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs" onClick={() => !savingLink && setLinkingDepot(null)} />
          <form
            onSubmit={handleSaveDepotLink}
            className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                {lang === 'fr' ? `Associer le dépôt ${linkingDepot.numero ?? ''}` : `Link deposit ${linkingDepot.numero ?? ''}`}
              </h3>
              <button
                type="button"
                onClick={() => !savingLink && setLinkingDepot(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              {linkingDepot.clients?.nom ?? '—'} · {formatDateShort(linkingDepot.date_depot)} ·{' '}
              <span className="font-semibold text-slate-800 tabular-nums">{formatPrice(linkingDepot.total)}</span>
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {lang === 'fr' ? "Apporteur d'affaire" : 'Referral partner'}
                </label>
                <select
                  value={linkCommercialId}
                  onChange={(e) => {
                    const cid = e.target.value;
                    setLinkCommercialId(cid);
                    const c = commerciauxMap.get(cid);
                    setLinkCustomTaux(c ? String(c.taux_commission) : '');
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="">{lang === 'fr' ? "— Aucun apporteur d'affaire —" : '— None —'}</option>
                  {commerciaux.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nom} ({c.taux_commission} %){!c.actif ? ' — inactif' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {linkCommercialId && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {lang === 'fr' ? 'Taux appliqué sur ce dépôt (%)' : 'Applied rate (%)'}
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={linkCustomTaux}
                    onChange={(e) => setLinkCustomTaux(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  <p className="text-xs text-sky-700 font-medium mt-1.5 tabular-nums">
                    {lang === 'fr' ? 'Commission calculée : ' : 'Calculated commission: '}
                    {formatPrice(Math.round((Number(linkingDepot.total ?? 0) * (parseFloat(linkCustomTaux) || 0)) / 100))}
                  </p>
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setLinkingDepot(null)}
                disabled={savingLink}
                className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50"
              >
                {lang === 'fr' ? 'Annuler' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={savingLink}
                className="flex-1 px-4 py-2 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {savingLink && <Loader2 className="w-4 h-4 animate-spin" />}
                {lang === 'fr' ? 'Enregistrer' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Confirm Deletion */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs" onClick={() => !deleting && setConfirmDelete(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900">
              {confirmDelete.kind === 'commercial'
                ? (lang === 'fr' ? "Supprimer cet apporteur d'affaire ?" : 'Delete this referral partner?')
                : confirmDelete.kind === 'client_link'
                  ? (lang === 'fr' ? 'Retirer ce rattachement ?' : 'Remove this client link?')
                  : (lang === 'fr' ? 'Supprimer ce versement ?' : 'Delete this payout?')}
            </h3>
            <p className="text-sm text-slate-600">
              {confirmDelete.kind === 'commercial'
                ? (lang === 'fr'
                    ? `Voulez-vous supprimer « ${confirmDelete.label} » et son historique de versements ? Les dépôts de l'entreprise restent intacts.`
                    : `Delete "${confirmDelete.label}" and their payout history? Company deposits remain intact.`)
                : confirmDelete.kind === 'client_link'
                  ? (lang === 'fr'
                      ? `Voulez-vous retirer le rattachement « ${confirmDelete.label} » ? Les factures déjà enregistrées dans l'entreprise restent intactes.`
                      : `Remove link "${confirmDelete.label}"? Existing company invoices remain untouched.`)
                  : (lang === 'fr'
                      ? `Supprimer le versement « ${confirmDelete.label} » ? Le solde de l'apporteur d'affaire sera recalculé.`
                      : `Delete payout "${confirmDelete.label}"? The partner's balance will be recalculated.`)}
            </p>
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
                className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50"
              >
                {lang === 'fr' ? 'Annuler' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={() => void handleExecuteDelete()}
                disabled={deleting}
                className="flex-1 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
                {lang === 'fr' ? 'Supprimer' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Link / Edit Commercial ↔ Clients (time-bounded period) */}
      {showClientLinkModal && (
        <CommercialClientLinkModal
          commerciaux={commerciaux}
          clients={allClients}
          initialCommercialId={clientLinkInitialComId}
          editingLink={editingClientLink}
          onClose={() => {
            setShowClientLinkModal(false);
            setEditingClientLink(null);
          }}
          onSaved={async (msg) => {
            setSuccess(msg);
            await loadAll();
          }}
        />
      )}

      {/* Modal: Share Commercial Portal Code & Link */}
      {portalShareCommercial && (
        <CommercialPortalShareModal
          commercial={portalShareCommercial}
          entreprise={entreprise}
          canManage={canManage}
          onClose={() => setPortalShareCommercial(null)}
          onCodeUpdated={async (newCode) => {
            setPortalShareCommercial((prev) => (prev ? { ...prev, portal_code: newCode } : null));
            setSuccess(
              lang === 'fr'
                ? `Nouveau code portail généré : ${newCode}`
                : `New portal code generated: ${newCode}`,
            );
            await loadAll();
          }}
        />
      )}

      {/* Printable Report (hidden on screen, shown in print) */}
      {reportData && <PrintableReport data={reportData} />}
    </div>
  );
}
