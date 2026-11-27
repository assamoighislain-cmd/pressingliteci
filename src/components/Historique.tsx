import { useState, useEffect, useMemo, useCallback } from 'react';
import { useI18n } from '@/lib/i18n';
import { db, rpc } from '@/lib/db';
import { useAuth } from '@/lib/auth';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { DepotWithArticles, DepotAvance, TypeTraitement, Entreprise, formatPrice, formatDate, formatDateShort, getTraitementLabelById, applyPhonePrefix } from '@/types';
import { CalendarDays, ChevronDown, ChevronRight, Clock, Check, Filter, TrendingUp, Package, Layers, Wallet, Trash2, AlertTriangle, Truck, CalendarClock, Tags, Printer, Pencil } from 'lucide-react';
import ImportExcel from '@/components/ImportExcel';
import PrintableLabels from '@/components/PrintableLabels';
import EditDepotTraitementModal from '@/components/EditDepotTraitementModal';
import { printDepotLabels } from '@/lib/print';
import { PrintableReport, printReport, type ReportData } from '@/components/PrintableReport';

type PeriodFilter = 'today' | 'week' | 'month' | 'all' | 'custom';

interface PeriodGroup {
  label: string;
  depots: DepotWithArticles[];
  total: number;
  encaisse: number;
  enCours: number;
  retires: number;
  nbPieces: number;
}

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

function getWeekStart(d: Date): Date {
  const r = startOfDay(d);
  const day = r.getDay();
  const diff = day === 0 ? 6 : day - 1;
  r.setDate(r.getDate() - diff);
  return r;
}

function getMonthStart(d: Date): Date {
  const r = startOfDay(d);
  r.setDate(1);
  return r;
}

export default function Historique() {
  const { t, lang } = useI18n();
  const { role } = useAuth();
  const [depots, setDepots] = useState<DepotWithArticles[]>([]);
  const [avances, setAvances] = useState<DepotAvance[]>([]);
  const [typesTraitement, setTypesTraitement] = useState<TypeTraitement[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodFilter>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [depotToDelete, setDepotToDelete] = useState<DepotWithArticles | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [entreprise, setEntreprise] = useState<Entreprise | null>(null);
  const [labelDepot, setLabelDepot] = useState<DepotWithArticles | null>(null);
  const [deliveryFilter, setDeliveryFilter] = useState<'all' | 'delivery' | 'no-delivery'>('all');
  const [depotToEditTraitement, setDepotToEditTraitement] = useState<DepotWithArticles | null>(null);

  const canEditTraitement = role === 'commercial' || role === 'gerant' || role === 'admin';

  // Map of depot_id -> total extra avances
  const avancesMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const av of avances) {
      m.set(av.depot_id, (m.get(av.depot_id) ?? 0) + Number(av.montant));
    }
    return m;
  }, [avances]);

  function getEncaisse(depot: DepotWithArticles): number {
    const extraAvances = avancesMap.get(depot.id) ?? 0;
    return (Number(depot.avance_amount) ?? 0) + extraAvances;
  }

  const { startDate, endDate, periodLabel } = useMemo(() => {
    const now = new Date();
    if (period === 'today') {
      return { startDate: startOfDay(now), endDate: endOfDay(now), periodLabel: t('hist.today') };
    }
    if (period === 'week') {
      const ws = getWeekStart(now);
      return { startDate: ws, endDate: endOfDay(now), periodLabel: t('hist.thisWeek') };
    }
    if (period === 'month') {
      const ms = getMonthStart(now);
      return { startDate: ms, endDate: endOfDay(now), periodLabel: t('hist.thisMonth') };
    }
    if (period === 'custom' && customStart && customEnd) {
      return {
        startDate: startOfDay(new Date(customStart)),
        endDate: endOfDay(new Date(customEnd)),
        periodLabel: t('hist.customPeriod'),
      };
    }
    return { startDate: null, endDate: null, periodLabel: t('hist.allPeriods') };
  }, [period, customStart, customEnd]);

  const filtered = useMemo(() => {
    let result = depots;
    if (startDate && endDate) {
      result = result.filter((d) => {
        const depotDate = new Date(d.date_depot);
        return depotDate >= startDate && depotDate <= endDate;
      });
    }
    if (deliveryFilter === 'delivery') {
      result = result.filter((d) => d.delivery_requested === true || d.pickup_requested === true);
    } else if (deliveryFilter === 'no-delivery') {
      result = result.filter((d) => d.delivery_requested !== true && d.pickup_requested !== true);
    }
    return result;
  }, [depots, startDate, endDate, deliveryFilter]);

  // Group by day
  const groups: PeriodGroup[] = useMemo(() => {
    const groupMap = new Map<string, DepotWithArticles[]>();
    for (const depot of filtered) {
      const dateKey = formatDateShort(depot.date_depot);
      if (!groupMap.has(dateKey)) groupMap.set(dateKey, []);
      groupMap.get(dateKey)!.push(depot);
    }
    const sortedKeys = Array.from(groupMap.keys()).sort((a, b) => b.localeCompare(a));
    return sortedKeys.map((key) => {
      const dayDepots = groupMap.get(key)!;
      const total = dayDepots.reduce((sum, d) => sum + Number(d.total), 0);
      const encaisse = dayDepots.reduce((sum, d) => sum + getEncaisse(d), 0);
      const enCours = dayDepots.filter((d) => d.statut === 'EN_COURS').length;
      const retires = dayDepots.filter((d) => d.statut === 'RETIRE').length;
      const nbPieces = dayDepots.reduce(
        (sum, d) => sum + (d.articles?.reduce((s, a) => s + Number(a.nb_pieces ?? 0) * Number(a.quantite ?? 1), 0) ?? 0),
        0,
      );
      return { label: key, depots: dayDepots, total, encaisse, enCours, retires, nbPieces };
    });
  }, [filtered]);

  // Auto-expand first group
  useEffect(() => {
    if (groups.length > 0 && expandedGroups.size === 0) {
      setExpandedGroups(new Set([groups[0].label]));
    }
  }, [groups, expandedGroups.size]);

  function toggleGroup(label: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  async function handleDeleteDepot() {
    if (!depotToDelete) return;
    setDeleting(true);
    setDeleteError(null);
    const error = await db.deleteDepot(depotToDelete.id);
    if (error) {
      setDeleteError(t('hist.deleteError'));
      setDeleting(false);
      return;
    }
    setDepots((prev) => prev.filter((d) => d.id !== depotToDelete.id));
    setDepotToDelete(null);
    setDeleting(false);
  }

  const load = useCallback(async () => {
    const [depotsData, typesData, avancesData, entData] = await Promise.all([
      db.getAllDepotsWithClient(),
      db.getTypesTraitement(),
      db.getAllAvances(),
      db.getEntreprise(),
    ]);
    setDepots(depotsData);
    setTypesTraitement(typesData);
    setAvances(avancesData);
    setEntreprise(entData);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useRealtimeSync(['depots', 'depot_articles', 'depot_avances', 'clients', 'types_traitement'], load);

  async function handleImportDepots(rows: Record<string, string | number | null>[], onProgress?: (current: number, total: number) => void): Promise<{ success: number; errors: string[] }> {
    let success = 0;
    const errors: string[] = [];

    const allClients = await db.getAllClients();
    const allTypes = await db.getTypesTraitement();
    const entreprise = await db.getEntreprise();

    // Group rows by reference (depot number). Rows without a reference get their own depot.
    const groups = new Map<string, Record<string, string | number | null>[]>();
    for (const row of rows) {
      const ref = String(row.reference ?? '').trim() || `__auto_${success}_${Math.random().toString(36).slice(2, 8)}`;
      if (!groups.has(ref)) groups.set(ref, []);
      groups.get(ref)!.push(row);
    }

    const groupEntries = Array.from(groups.entries());
    for (let i = 0; i < groupEntries.length; i++) {
      const [ref, groupRows] = groupEntries[i];
      const firstRow = groupRows[0];
      const clientNom = String(firstRow.client_nom ?? '').trim();
      const clientTel = firstRow.client_tel ? String(firstRow.client_tel).trim() : null;
      if (!clientNom) { errors.push(`${ref}: ${lang === 'fr' ? 'nom client manquant' : 'client name missing'}`); continue; }

      // Find or create client
      let client = allClients.find((c) => c.nom.toLowerCase() === clientNom.toLowerCase());
      if (!client && clientTel) {
        client = allClients.find((c) => c.telephone === clientTel);
      }
      if (!client) {
        const { data: codeData } = await rpc<string>('generate_client_code');
        const code = codeData ?? `C-${Date.now().toString(36).toUpperCase()}`;
        const result = await db.insertClient({
          code,
          nom: clientNom,
          telephone: clientTel ? applyPhonePrefix(clientTel, entreprise?.phone_prefix) : null,
          taux_remise: 0,
          condition_remise: null,
        });
        if (result.data) {
          client = result.data;
          allClients.push(result.data);
        } else {
          errors.push(`${ref}: ${result.error ?? (lang === 'fr' ? 'erreur création client' : 'client creation error')}`);
          continue;
        }
      }

      // Resolve treatment type
      const traitementLibelle = String(firstRow.traitement ?? '').trim();
      let typeTraitement = allTypes.find((t) => t.libelle.toLowerCase() === traitementLibelle.toLowerCase());
      if (!typeTraitement && allTypes.length > 0) typeTraitement = allTypes[0];
      const coef = typeTraitement?.coefficient ?? 1;

      // Parse dates
      const dateDepotStr = String(firstRow.date_depot ?? '').trim();
      let dateDepot: Date;
      if (dateDepotStr) {
        const parsed = new Date(dateDepotStr);
        dateDepot = isNaN(parsed.getTime()) ? new Date() : parsed;
      } else {
        dateDepot = new Date();
      }

      const dateRetraitStr = String(firstRow.date_retrait_prevue ?? '').trim();
      let dateRetraitPrevue: Date | null = null;
      if (dateRetraitStr) {
        const parsed = new Date(dateRetraitStr);
        dateRetraitPrevue = isNaN(parsed.getTime()) ? null : parsed;
      }
      if (!dateRetraitPrevue && typeTraitement) {
        const nbJours = typeTraitement.nb_jours || 1;
        dateRetraitPrevue = new Date(dateDepot);
        dateRetraitPrevue.setDate(dateRetraitPrevue.getDate() + nbJours);
        dateRetraitPrevue.setHours(18, 0, 0, 0);
      }

      // Compute total from articles
      const totalAvantRemise = groupRows.reduce((sum, r) => {
        const pu = Number(r.prix_unitaire ?? 0);
        const qte = Number(r.quantite ?? 1);
        return sum + pu * qte;
      }, 0);

      const tauxRemise = Number(firstRow.taux_remise ?? 0);
      const montantRemise = Math.round(totalAvantRemise * tauxRemise / 100);
      const total = totalAvantRemise - montantRemise;

      const avance = Number(firstRow.avance ?? 0);
      const modeReglement = firstRow.mode_reglement ? String(firstRow.mode_reglement).trim() : null;
      const statut = String(firstRow.statut ?? 'EN_COURS').trim().toUpperCase();
      const validStatuts = ['EN_COURS', 'RETIRE', 'COMMANDE', 'COLLECTE'];
      const depotStatut = validStatuts.includes(statut) ? statut : 'EN_COURS';

      // Generate depot number
      const numeroResult = await db.nextDepotNumero(dateDepot);
      if (numeroResult.error || !numeroResult.numero) {
        errors.push(`${ref}: ${lang === 'fr' ? 'erreur compteur' : 'counter error'}`);
        continue;
      }
      const numero = numeroResult.numero;

      const depotData = await db.insertDepot({
        numero,
        client_id: client.id,
        statut: depotStatut,
        mode_reglement: modeReglement,
        avance_amount: avance,
        total,
        traitement: typeTraitement?.libelle ?? '',
        taux_remise: tauxRemise,
        montant_remise: montantRemise,
        coefficient: coef,
        type_traitement_id: typeTraitement?.id ?? null,
        date_depot: dateDepot.toISOString(),
        date_retrait_prevue: dateRetraitPrevue?.toISOString() ?? null,
        notes: null,
      });

      if (!depotData.data) {
        errors.push(`${ref}: ${depotData.error ?? (lang === 'fr' ? 'erreur création dépôt' : 'depot creation error')}`);
        continue;
      }

      // Insert articles
      const articlesToInsert = groupRows.map((r) => {
        const pu = Number(r.prix_unitaire ?? 0);
        const qte = Number(r.quantite ?? 1);
        const nbPieces = Number(r.nb_pieces ?? qte);
        return {
          depot_id: depotData.data!.id,
          designation: String(r.designation ?? '').trim(),
          prix_unitaire: pu,
          prix_traitement: pu * coef,
          quantite: qte,
          nb_pieces: nbPieces,
          prix_total: pu * qte,
          couleur: r.couleur ? String(r.couleur).trim() : null,
          signe_particulier: r.signe_particulier ? String(r.signe_particulier).trim() : null,
          griffe: r.griffe ? String(r.griffe).trim() : null,
        };
      }).filter((a) => a.designation);

      if (articlesToInsert.length > 0) {
        const articlesError = await db.insertDepotArticles(articlesToInsert);
        if (articlesError) {
          errors.push(`${ref}: ${lang === 'fr' ? 'articles: ' : 'articles: '}${articlesError}`);
        }
      }

      // Insert depot_avances (règlement records) if an avance was specified
      if (avance > 0 && depotData.data) {
        const datePaiementStr = String(firstRow.date_paiement ?? '').trim();
        let datePaiement: Date;
        if (datePaiementStr) {
          const parsed = new Date(datePaiementStr);
          datePaiement = isNaN(parsed.getTime()) ? new Date() : parsed;
        } else {
          datePaiement = dateDepot;
        }
        const { error: avanceError } = await db.insertAvance(
          depotData.data.id,
          avance,
          modeReglement ?? undefined,
        );
        if (avanceError) {
          errors.push(`${ref}: ${lang === 'fr' ? 'règlement: ' : 'payment: '}${avanceError}`);
        } else {
          // Update the avance's date_paiement if a custom date was provided
          if (datePaiementStr) {
            const { supabase } = await import('@/lib/supabase');
            await supabase
              .from('depot_avances')
              .update({ date_paiement: datePaiement.toISOString() })
              .eq('depot_id', depotData.data.id)
              .order('created_at', { ascending: false })
              .limit(1);
          }
        }
      }

      success++;
      onProgress?.(i + 1, groupEntries.length);
    }

    if (success > 0) await load();
    return { success, errors };
  }

  const grandTotal = filtered.reduce((sum, d) => sum + Number(d.total), 0);
  const totalEncaisse = filtered.reduce((sum, d) => sum + getEncaisse(d), 0);
  const totalEnCours = filtered.filter((d) => d.statut === 'EN_COURS').length;
  const totalRetires = filtered.filter((d) => d.statut === 'RETIRE').length;
  const totalPieces = filtered.reduce(
    (sum, d) => sum + (d.articles?.reduce((s, a) => s + Number(a.nb_pieces ?? 0) * Number(a.quantite ?? 1), 0) ?? 0),
    0,
  );

  const allFilters: { id: PeriodFilter; label: string }[] = [
    { id: 'today', label: t('hist.today') },
    { id: 'week', label: t('hist.thisWeek') },
    { id: 'month', label: t('hist.thisMonth') },
    { id: 'all', label: t('hist.all') },
    { id: 'custom', label: t('hist.custom') },
  ];

  const filterButtons = role === 'admin' || role === 'comptable' || role === 'associe'
    ? allFilters
    : (() => {
        const allowed = role === 'commercial'
          ? (entreprise?.hist_filters_commercial ?? ['today'])
          : role === 'gerant'
            ? (entreprise?.hist_filters_gerant ?? ['today'])
            : ['today'];
        return allFilters.filter((f) => allowed.includes(f.id));
      })();

  const reportData: ReportData = {
    title: lang === 'fr' ? 'Historique des dépôts' : 'Deposit history',
    subtitle: lang === 'fr' ? 'Rapport détaillé' : 'Detailed report',
    periodLabel,
    entreprise,
    columns: [
      { key: 'date', label: lang === 'fr' ? 'Date' : 'Date', align: 'left', render: (r) => formatDateShort(r.date as string) },
      { key: 'numero', label: 'N°', align: 'left', render: (r) => String(r.numero ?? '—') },
      { key: 'client', label: lang === 'fr' ? 'Client' : 'Client', align: 'left', render: (r) => String(r.client ?? '') },
      { key: 'traitement', label: lang === 'fr' ? 'Traitement' : 'Treatment', align: 'left', render: (r) => String(r.traitement ?? '') },
      { key: 'statut', label: lang === 'fr' ? 'Statut' : 'Status', align: 'center', render: (r) => String(r.statut ?? '') },
      { key: 'total', label: lang === 'fr' ? 'Total' : 'Total', align: 'right', render: (r) => formatPrice(Number(r.total ?? 0)) },
    ],
    rows: filtered.map((d) => ({
      date: d.date_depot,
      numero: d.numero,
      client: d.clients?.nom ?? '',
      traitement: getTraitementLabelById(d.type_traitement_id, typesTraitement, d.traitement),
      statut: d.statut,
      total: d.total,
    })),
    summaryRows: [
      { label: lang === 'fr' ? 'Nombre de dépôts' : 'Deposit count', value: String(filtered.length) },
      { label: lang === 'fr' ? 'Encaissé' : 'Collected', value: formatPrice(totalEncaisse) },
      { label: lang === 'fr' ? 'CA total' : 'Total revenue', value: formatPrice(grandTotal), highlight: true },
    ],
  };

  return (
    <>
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="text-center">
        <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mx-auto mb-3">
          <CalendarDays className="w-7 h-7 text-indigo-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">{t('hist.title')}</h2>
        <p className="text-sm text-slate-500 mt-1">
          {t('hist.subtitle')}
        </p>
        {role === 'admin' && (
          <div className="flex justify-center mt-3">
            <ImportExcel
              config={{
                entityType: 'depots',
                columns: [
                  { key: 'reference', label: 'Référence', required: false, type: 'string', aliases: ['Ref', 'N°', 'Numero'] },
                  { key: 'client_nom', label: 'Client', required: true, type: 'string', aliases: ['Nom client', 'Customer'] },
                  { key: 'client_tel', label: 'Téléphone', required: false, type: 'string', aliases: ['Tel', 'Phone'] },
                  { key: 'date_depot', label: 'Date dépôt', required: false, type: 'string', aliases: ['Date', 'Date depot'] },
                  { key: 'date_retrait_prevue', label: 'Date retrait', required: false, type: 'string', aliases: ['Date retrait prevue', 'Retrait'] },
                  { key: 'traitement', label: 'Traitement', required: false, type: 'string', aliases: ['Type traitement'] },
                  { key: 'designation', label: 'Désignation', required: true, type: 'string', aliases: ['Article', 'Designation'] },
                  { key: 'prix_unitaire', label: 'Prix unitaire', required: false, type: 'number', aliases: ['PU', 'Prix'] },
                  { key: 'quantite', label: 'Quantité', required: false, type: 'number', aliases: ['Qte', 'Qty'] },
                  { key: 'nb_pieces', label: 'Nb pièces', required: false, type: 'number', aliases: ['Pieces'] },
                  { key: 'couleur', label: 'Couleur', required: false, type: 'string' },
                  { key: 'signe_particulier', label: 'Signe', required: false, type: 'string' },
                  { key: 'griffe', label: 'Griffe', required: false, type: 'string' },
                  { key: 'avance', label: 'Avance', required: false, type: 'number' },
                  { key: 'mode_reglement', label: 'Mode règlement', required: false, type: 'string' },
                  { key: 'date_paiement', label: 'Date paiement', required: false, type: 'string', aliases: ['Date reglement', 'Date avance'] },
                  { key: 'taux_remise', label: 'Taux remise %', required: false, type: 'number' },
                  { key: 'statut', label: 'Statut', required: false, type: 'string' },
                ],
                onImport: handleImportDepots,
              }}
            />
          </div>
        )}
      </div>

      {/* Period filters */}
      <div className="flex flex-wrap gap-2 justify-center">
        {filterButtons.map((btn) => (
          <button
            key={btn.id}
            onClick={() => setPeriod(btn.id)}
            className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
              period === btn.id
                ? 'bg-indigo-500 text-white shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'
            }`}
          >
            {btn.label}
          </button>
        ))}
      </div>

      {/* Delivery filter */}
      <div className="flex flex-wrap gap-2 justify-center">
        {([
          { id: 'all' as const, label: lang === 'fr' ? 'Tous les dépôts' : 'All deposits' },
          { id: 'delivery' as const, label: lang === 'fr' ? 'Avec livraison/collecte' : 'With delivery/pickup' },
          { id: 'no-delivery' as const, label: lang === 'fr' ? 'Sans livraison' : 'No delivery' },
        ]).map((btn) => (
          <button
            key={btn.id}
            onClick={() => setDeliveryFilter(btn.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
              deliveryFilter === btn.id
                ? btn.id === 'delivery'
                  ? 'bg-sky-500 text-white shadow-sm'
                  : btn.id === 'no-delivery'
                    ? 'bg-slate-600 text-white shadow-sm'
                    : 'bg-indigo-500 text-white shadow-sm'
                : 'bg-white border border-slate-200 text-slate-500 hover:border-slate-300'
            }`}
          >
            {btn.id === 'delivery' && <Truck className="w-3.5 h-3.5" />}
            {btn.id === 'no-delivery' && <Package className="w-3.5 h-3.5" />}
            {btn.label}
          </button>
        ))}
      </div>

      {/* Custom date range */}
      {period === 'custom' && (
        <div className="flex flex-wrap gap-3 items-center justify-center bg-white rounded-xl border border-slate-100 p-4">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 font-medium">{t('hist.from')}</label>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 font-medium">{t('hist.to')}</label>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
        </div>
      )}

      {/* Summary cards */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 text-center">
            <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center mx-auto mb-2">
              <Package className="w-5 h-5 text-slate-600" />
            </div>
            <p className="text-2xl font-bold text-slate-900">{filtered.length}</p>
            <p className="text-xs text-slate-400 mt-0.5">{t('hist.deposits')}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 text-center">
            <div className="w-10 h-10 rounded-lg bg-sky-50 flex items-center justify-center mx-auto mb-2">
              <Layers className="w-5 h-5 text-sky-600" />
            </div>
            <p className="text-2xl font-bold text-sky-600">{totalPieces}</p>
            <p className="text-xs text-slate-400 mt-0.5">{t('hist.piecesCollected')}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 text-center">
            <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center mx-auto mb-2">
              <Wallet className="w-5 h-5 text-emerald-600" />
            </div>
            <p className="text-lg font-bold text-emerald-600">{formatPrice(totalEncaisse)}</p>
            <p className="text-xs text-slate-400 mt-0.5">{t('hist.collected')}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 text-center">
            <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center mx-auto mb-2">
              <Clock className="w-5 h-5 text-amber-500" />
            </div>
            <p className="text-2xl font-bold text-amber-600">{totalEnCours}</p>
            <p className="text-xs text-slate-400 mt-0.5">{t('hist.inProgress')}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 text-center">
            <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center mx-auto mb-2">
              <TrendingUp className="w-5 h-5 text-emerald-600" />
            </div>
            <p className="text-lg font-bold text-emerald-600">{formatPrice(grandTotal)}</p>
            <p className="text-xs text-slate-400 mt-0.5">{t('hist.revenue')}</p>
          </div>
        </div>
      )}

      {/* Print button */}
      {!loading && filtered.length > 0 && (
        <button
          onClick={() => printReport()}
          className="w-full py-2.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 transition-colors flex items-center justify-center gap-2"
        >
          <Printer className="w-4 h-4" /> {lang === 'fr' ? 'Imprimer l\'historique' : 'Print history'}
        </button>
      )}

      {loading ? (
        <p className="text-sm text-slate-400 text-center py-8">{t('hist.loading')}</p>
      ) : groups.length === 0 ? (
        <div className="text-center py-12">
          <Filter className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-400">{t('hist.noData', { period: periodLabel.toLowerCase() })}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => {
            const isExpanded = expandedGroups.has(group.label);
            return (
              <div
                key={group.label}
                className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden"
              >
                {/* Day header */}
                <button
                  onClick={() => toggleGroup(group.label)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center flex-shrink-0">
                      <CalendarDays className="w-5 h-5" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-semibold text-slate-900">{group.label}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {t('hist.depositCount', { count: group.depots.length })}
                        {group.nbPieces > 0 && ` · ${t('hist.piecesCount', { count: group.nbPieces })}`}
                        {group.enCours > 0 && ` · ${t('hist.inProgressCount', { count: group.enCours })}`}
                        {group.retires > 0 && ` · ${t('hist.withdrawnCount', { count: group.retires })}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-sm font-semibold text-emerald-600 whitespace-nowrap">{formatPrice(group.encaisse)}</p>
                      <p className="text-xs text-slate-400">{t('hist.encaisse')}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-slate-700 whitespace-nowrap">{formatPrice(group.total)}</p>
                      <p className="text-xs text-slate-400">{t('hist.total')}</p>
                    </div>
                    {isExpanded ? (
                      <ChevronDown className="w-5 h-5 text-slate-400" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-slate-400" />
                    )}
                  </div>
                </button>

                {/* Depot list */}
                {isExpanded && (
                  <div className="divide-y divide-slate-50">
                    {group.depots.map((depot) => {
                      const isEnCours = depot.statut === 'EN_COURS';
                      return (
                        <div
                          key={depot.id}
                          className="px-5 py-3.5 flex items-center justify-between hover:bg-slate-50/50 transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div
                              className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                                isEnCours ? 'bg-amber-400' : 'bg-emerald-400'
                              }`}
                            />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-900 truncate">
                                {depot.numero} — {depot.clients?.nom ?? t('hist.unknownClient')}
                                {depot.pickup_requested && (
                                  <span className="inline-flex items-center gap-1 ml-1.5 text-xs text-amber-600 font-medium" title={lang === 'fr' ? 'Collecte à domicile' : 'Home pickup'}>
                                    <Truck className="w-3 h-3" />
                                    {depot.pickup_day && (
                                      <span className="capitalize">{depot.pickup_day}</span>
                                    )}
                                  </span>
                                )}
                                {depot.delivery_requested && (
                                  <span className="inline-flex items-center gap-1 ml-1.5 text-xs text-sky-600 font-medium" title={lang === 'fr' ? 'Livraison à domicile' : 'Home delivery'}>
                                    <Package className="w-3 h-3" />
                                    {lang === 'fr' ? 'Livraison' : 'Delivery'}
                                  </span>
                                )}
                              </p>
                              <p className="text-xs text-slate-400 mt-0.5">
                                {formatDate(depot.date_depot)}
                                {' · '}
                                {getTraitementLabelById(depot.type_traitement_id, typesTraitement, depot.traitement)} (×{Number(depot.coefficient)})
                                {depot.articles && depot.articles.length > 0 && (() => {
                                  const pieces = depot.articles.reduce((s, a) => s + Number(a.nb_pieces ?? 0) * Number(a.quantite ?? 1), 0);
                                  return pieces > 0 ? ` · ${t('hist.piecesCount', { count: pieces })}` : '';
                                })()}
                              </p>
                              {depot.clients?.telephone && (
                                <p className="text-xs text-slate-400 mt-0.5">
                                  {t('hist.tel')}: {depot.clients.telephone}
                                </p>
                              )}
                              {depot.pickup_requested && depot.pickup_address && (
                                <p className="text-xs text-amber-600 mt-0.5 flex items-center gap-1">
                                  <Truck className="w-3 h-3" /> {depot.pickup_address}
                                </p>
                              )}
                              {depot.delivery_requested && depot.delivery_address && (
                                <p className="text-xs text-sky-600 mt-0.5 flex items-center gap-1">
                                  <Package className="w-3 h-3" /> {depot.delivery_address}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                            <div className="text-right">
                              <p className="text-sm font-semibold text-slate-700 whitespace-nowrap">
                                {formatPrice(Number(depot.total))}
                              </p>
                              {(() => {
                                const enc = getEncaisse(depot);
                                const reste = Number(depot.total) - enc;
                                return (
                                  <p className={`text-xs whitespace-nowrap ${reste > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                                    {reste > 0 ? t('hist.remaining', { amount: formatPrice(reste) }) : t('hist.settled')}
                                  </p>
                                );
                              })()}
                            </div>
                            <span
                              className={`text-xs font-medium px-2.5 py-1 rounded-full flex items-center gap-1 ${
                                isEnCours
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-emerald-100 text-emerald-700'
                              }`}
                            >
                              {isEnCours ? (
                                <>
                                  <Clock className="w-3 h-3" /> {t('hist.inProgress')}
                                </>
                              ) : (
                                <>
                                  <Check className="w-3 h-3" /> {lang === 'fr' ? 'Retiré' : 'Picked up'}
                                </>
                              )}
                            </span>
                            {canEditTraitement && isEnCours && typesTraitement.length > 0 && (
                              <button
                                onClick={() => setDepotToEditTraitement(depot)}
                                title={lang === 'fr' ? 'Modifier le type de traitement' : 'Edit treatment type'}
                                className="w-8 h-8 flex items-center justify-center rounded-lg text-sky-500 hover:bg-sky-50 hover:text-sky-700 transition-colors"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                            )}
                            {role === 'admin' && (
                              <button
                                onClick={() => setDepotToDelete(depot)}
                                title={t('hist.deleteDepot')}
                                className="w-8 h-8 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={async () => {
                                setLabelDepot(depot);
                                const { error: lblErr } = await printDepotLabels(depot, entreprise);
                                if (lblErr) alert(lblErr);
                                setLabelDepot(null);
                              }}
                              title={lang === 'fr' ? 'Imprimer étiquettes' : 'Print labels'}
                              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-sky-50 hover:text-sky-600 transition-colors"
                            >
                              <Tags className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Delete confirmation modal */}
      {depotToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6 text-red-600" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 text-center">
              {t('hist.deleteDepot')}
            </h3>
            <p className="text-sm text-slate-500 mt-2 text-center">
              {t('hist.deleteConfirm', { numero: depotToDelete.numero ?? '—' })}
            </p>
            {deleteError && (
              <p className="text-sm text-red-600 mt-3 text-center">{deleteError}</p>
            )}
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => { setDepotToDelete(null); setDeleteError(null); }}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 text-slate-700 font-medium text-sm hover:bg-slate-50 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleDeleteDepot}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 rounded-lg bg-red-500 text-white font-medium text-sm hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {deleting ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {lang === 'fr' ? 'Suppression…' : 'Deleting…'}
                  </span>
                ) : t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
      {depotToEditTraitement && (
        <EditDepotTraitementModal
          depot={depotToEditTraitement}
          typesTraitement={typesTraitement}
          totalPaye={getEncaisse(depotToEditTraitement)}
          onClose={() => setDepotToEditTraitement(null)}
          onSaved={load}
        />
      )}
    </div>

      {labelDepot && <PrintableLabels depot={labelDepot} entreprise={entreprise} />}
      <PrintableReport data={reportData} />
    </>
  );
}
