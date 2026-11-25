import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import { useI18n } from '@/lib/i18n';
import { db } from '@/lib/db';
import { useAuth } from '@/lib/auth';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import {
  DepotWithArticles,
  DepotAvance,
  TypeTraitement,
  ModeReglementRow,
  Entreprise,
  Commercial,
  formatPrice,
  formatDate,
  formatDateShort,
  getTraitementLabelById,
  getModeReglementLabel,
} from '@/types';
import {
  ClipboardList,
  Search,
  Printer,
  Filter,
  Package,
  TrendingUp,
  Wallet,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Phone,
  Calendar,
  FileText,
  Layers,
} from 'lucide-react';
import { PrintableReport, printReport, type ReportData } from '@/components/PrintableReport';

type PeriodFilter = 'today' | 'week' | 'month' | 'all' | 'custom';
type StatutFilter = 'all' | 'EN_COURS' | 'RETIRE' | 'COMMANDE';
type PaymentFilter = 'all' | 'paid' | 'unpaid';

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

interface EnrichedDepot {
  depot: DepotWithArticles;
  clientNom: string;
  clientTel: string | null;
  pieces: number;
  traitementLabel: string;
  modeLabel: string;
  total: number;
  paid: number;
  reste: number;
}

export default function JournalDepots() {
  const { t, lang } = useI18n();
  const { role } = useAuth();
  const [depots, setDepots] = useState<DepotWithArticles[]>([]);
  const [avances, setAvances] = useState<DepotAvance[]>([]);
  const [types, setTypes] = useState<TypeTraitement[]>([]);
  const [modes, setModes] = useState<ModeReglementRow[]>([]);
  const [commerciauxMap, setCommerciauxMap] = useState<Map<string, Commercial>>(new Map());
  const [entreprise, setEntreprise] = useState<Entreprise | null>(null);
  const [loading, setLoading] = useState(true);

  const [period, setPeriod] = useState<PeriodFilter>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [search, setSearch] = useState('');
  const [statutFilter, setStatutFilter] = useState<StatutFilter>('all');
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const loadJournal = useCallback(async () => {
    const [depotsData, avancesData, typesData, modesData, entData, comRes] = await Promise.all([
      db.getAllDepotsWithClient(),
      db.getAllAvances(),
      db.getTypesTraitement(),
      db.getModesReglement(),
      db.getEntreprise(),
      db.getCommerciaux(),
    ]);
    setDepots(depotsData);
    setAvances(avancesData);
    setTypes(typesData);
    setModes(modesData);
    setEntreprise(entData);
    const cMap = new Map<string, Commercial>();
    for (const c of comRes.data) cMap.set(c.id, c);
    setCommerciauxMap(cMap);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadJournal();
  }, [loadJournal]);

  useRealtimeSync(
    ['depots', 'depot_articles', 'depot_avances', 'clients', 'types_traitement', 'modes_reglement', 'entreprise', 'commerciaux'],
    loadJournal,
  );

  const allowedPeriods = useMemo<PeriodFilter[]>(() => {
    const allPeriods: PeriodFilter[] = ['today', 'week', 'month', 'all', 'custom'];
    if (role === 'commercial') {
      const configured = entreprise?.hist_filters_commercial;
      if (configured && configured.length > 0) {
        const filtered = allPeriods.filter((p) => configured.includes(p));
        return filtered.length > 0 ? filtered : ['today'];
      }
      return ['today'];
    }
    if (role === 'gerant') {
      const configured = entreprise?.hist_filters_gerant;
      if (configured && configured.length > 0) {
        const filtered = allPeriods.filter((p) => configured.includes(p));
        return filtered.length > 0 ? filtered : allPeriods;
      }
    }
    return allPeriods;
  }, [role, entreprise]);

  useEffect(() => {
    if (!allowedPeriods.includes(period)) {
      setPeriod(allowedPeriods[0]);
    }
  }, [allowedPeriods, period]);

  const avancesByDepot = useMemo(() => {
    const map = new Map<string, { total: number; modes: string[] }>();
    for (const av of avances) {
      const entry = map.get(av.depot_id) ?? { total: 0, modes: [] };
      entry.total += Number(av.montant);
      if (av.mode_reglement) entry.modes.push(av.mode_reglement);
      map.set(av.depot_id, entry);
    }
    return map;
  }, [avances]);

  const { startDate, endDate, periodLabel } = useMemo(() => {
    const now = new Date();
    if (period === 'today') {
      return { startDate: startOfDay(now), endDate: endOfDay(now), periodLabel: t('journal.today') };
    }
    if (period === 'week') {
      return { startDate: getWeekStart(now), endDate: endOfDay(now), periodLabel: t('journal.thisWeek') };
    }
    if (period === 'month') {
      return { startDate: getMonthStart(now), endDate: endOfDay(now), periodLabel: t('journal.thisMonth') };
    }
    if (period === 'custom' && customStart && customEnd) {
      return {
        startDate: startOfDay(new Date(customStart)),
        endDate: endOfDay(new Date(customEnd)),
        periodLabel: `${formatDateShort(customStart)} – ${formatDateShort(customEnd)}`,
      };
    }
    return { startDate: null, endDate: null, periodLabel: t('journal.allPeriods') };
  }, [period, customStart, customEnd, t]);

  const enrichedDepots = useMemo<EnrichedDepot[]>(() => {
    return depots
      .map((d) => {
        const total = Number(d.total ?? 0);
        const initialAvance = d.avance_amount ? Number(d.avance_amount) : 0;
        const avInfo = avancesByDepot.get(d.id);
        const extraAvances = avInfo?.total ?? 0;
        const paid = Math.min(total, initialAvance + extraAvances);
        const reste = Math.max(0, total - (initialAvance + extraAvances));
        const pieces = (d.articles ?? []).reduce(
          (sum, art) => sum + (Number(art.nb_pieces) || 1) * (Number(art.quantite) || 1),
          0,
        );
        const clientNom = d.client?.nom ?? d.clients?.nom ?? (lang === 'fr' ? 'Client inconnu' : 'Unknown client');
        const clientTel = d.client?.telephone ?? d.clients?.telephone ?? null;
        const traitementLabel = getTraitementLabelById(d.type_traitement_id, types, d.traitement);
        const rawModes: string[] = [];
        if (d.mode_reglement && (initialAvance > 0 || extraAvances === 0)) {
          rawModes.push(d.mode_reglement);
        }
        if (avInfo?.modes.length) {
          rawModes.push(...avInfo.modes);
        }
        const uniqueModeLabels = Array.from(
          new Set(
            rawModes
              .map((m) => getModeReglementLabel(m, modes))
              .filter((lbl) => lbl && lbl !== '—'),
          ),
        );
        const modeLabel = uniqueModeLabels.length > 0
          ? uniqueModeLabels.join(' + ')
          : (lang === 'fr' ? 'Non réglé' : 'Unpaid');

        return {
          depot: d,
          clientNom,
          clientTel,
          pieces,
          traitementLabel,
          modeLabel,
          total,
          paid,
          reste,
        };
      })
      .sort((a, b) => new Date(b.depot.date_depot).getTime() - new Date(a.depot.date_depot).getTime());
  }, [depots, avancesByDepot, types, modes, lang]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enrichedDepots.filter((item) => {
      if (startDate && endDate) {
        const dt = new Date(item.depot.date_depot);
        if (dt < startDate || dt > endDate) return false;
      }
      if (statutFilter !== 'all' && item.depot.statut !== statutFilter) return false;
      if (paymentFilter === 'paid' && item.reste > 0) return false;
      if (paymentFilter === 'unpaid' && item.reste <= 0) return false;
      if (q) {
        const haystack = [
          item.depot.numero ?? '',
          item.clientNom,
          item.clientTel ?? '',
          item.traitementLabel,
          item.modeLabel,
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [enrichedDepots, startDate, endDate, statutFilter, paymentFilter, search]);

  const stats = useMemo(() => {
    return filtered.reduce(
      (acc, item) => {
        acc.count += 1;
        acc.pieces += item.pieces;
        acc.totalFacture += item.total;
        acc.totalEncaisse += item.paid;
        acc.totalReste += item.reste;
        return acc;
      },
      { count: 0, pieces: 0, totalFacture: 0, totalEncaisse: 0, totalReste: 0 },
    );
  }, [filtered]);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function getStatutBadge(statut: string) {
    if (statut === 'RETIRE') {
      return {
        label: lang === 'fr' ? 'Retiré' : 'Picked up',
        cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      };
    }
    if (statut === 'COMMANDE') {
      return {
        label: lang === 'fr' ? 'Commande' : 'Order',
        cls: 'bg-violet-50 text-violet-700 border-violet-200',
      };
    }
    if (statut === 'COLLECTE') {
      return {
        label: lang === 'fr' ? 'Collecté' : 'Collected',
        cls: 'bg-amber-50 text-amber-700 border-amber-200',
      };
    }
    return {
      label: lang === 'fr' ? 'En cours' : 'In progress',
      cls: 'bg-sky-50 text-sky-700 border-sky-200',
    };
  }

  const periodLabels: Record<PeriodFilter, string> = {
    today: t('journal.today'),
    week: t('journal.thisWeek'),
    month: t('journal.thisMonth'),
    all: t('journal.all'),
    custom: t('journal.custom'),
  };

  const reportData: ReportData = {
    title: lang === 'fr' ? 'Journal des dépôts' : 'Deposits journal',
    subtitle: lang === 'fr' ? 'État récapitulatif des dépôts' : 'Deposits summary ledger',
    periodLabel,
    entreprise,
    columns: [
      { key: 'date', label: lang === 'fr' ? 'Date' : 'Date', align: 'left', render: (r) => formatDateShort(r.date as string) },
      { key: 'numero', label: 'N°', align: 'left', render: (r) => String(r.numero ?? '—') },
      { key: 'client', label: lang === 'fr' ? 'Client' : 'Client', align: 'left', render: (r) => String(r.client ?? '') },
      { key: 'pieces', label: lang === 'fr' ? 'Pcs' : 'Pcs', align: 'center', render: (r) => String(r.pieces ?? 0) },
      { key: 'traitement', label: lang === 'fr' ? 'Traitement' : 'Treatment', align: 'left', render: (r) => String(r.traitement ?? '—') },
      { key: 'total', label: lang === 'fr' ? 'Total' : 'Total', align: 'right', render: (r) => formatPrice(Number(r.total ?? 0)) },
      { key: 'paid', label: lang === 'fr' ? 'Encaissé' : 'Paid', align: 'right', render: (r) => formatPrice(Number(r.paid ?? 0)) },
      { key: 'reste', label: lang === 'fr' ? 'Reste' : 'Balance', align: 'right', render: (r) => formatPrice(Number(r.reste ?? 0)) },
      { key: 'statut', label: lang === 'fr' ? 'Statut' : 'Status', align: 'center', render: (r) => String(r.statut ?? '') },
    ],
    rows: filtered.map((item) => ({
      date: item.depot.date_depot,
      numero: item.depot.numero ?? '—',
      client: item.clientNom,
      pieces: item.pieces,
      traitement: item.traitementLabel,
      total: item.total,
      paid: item.paid,
      reste: item.reste,
      statut: getStatutBadge(item.depot.statut).label,
    })),
    summaryRows: [
      { label: lang === 'fr' ? 'Nombre de dépôts' : 'Deposits count', value: String(stats.count) },
      { label: lang === 'fr' ? 'Total pièces' : 'Total pieces', value: String(stats.pieces) },
      { label: lang === 'fr' ? 'Montant total facturé' : 'Total billed', value: formatPrice(stats.totalFacture), highlight: true },
      { label: lang === 'fr' ? 'Total encaissé' : 'Total collected', value: formatPrice(stats.totalEncaisse) },
      { label: lang === 'fr' ? 'Reste à encaisser' : 'Remaining balance', value: formatPrice(stats.totalReste) },
    ],
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="text-center">
        <div className="w-14 h-14 rounded-2xl bg-sky-50 flex items-center justify-center mx-auto mb-3">
          <ClipboardList className="w-7 h-7 text-sky-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">
          {lang === 'fr' ? 'Journal des dépôts' : 'Deposits journal'}
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          {lang === 'fr'
            ? 'Suivi chronologique des dépôts, pièces déposées, montants facturés et soldes'
            : 'Chronological ledger of deposits, items, billed amounts and balances'}
        </p>
      </div>

      {/* Period filters */}
      <div className="flex flex-wrap gap-2 justify-center">
        {allowedPeriods.map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
              period === p
                ? 'bg-sky-500 text-white shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'
            }`}
          >
            {periodLabels[p]}
          </button>
        ))}
      </div>

      {/* Custom date range */}
      {period === 'custom' && (
        <div className="flex flex-wrap gap-3 items-center justify-center bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 font-medium">{t('journal.from')}</label>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 font-medium">{t('journal.to')}</label>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
            />
          </div>
        </div>
      )}

      {/* Search & secondary filters */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-3.5 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              lang === 'fr'
                ? 'Rechercher par N° dépôt, client, téléphone...'
                : 'Search by deposit #, client, phone...'
            }
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={statutFilter}
            onChange={(e) => setStatutFilter(e.target.value as StatutFilter)}
            className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="all">{lang === 'fr' ? 'Tous statuts' : 'All statuses'}</option>
            <option value="EN_COURS">{lang === 'fr' ? 'En cours' : 'In progress'}</option>
            <option value="RETIRE">{lang === 'fr' ? 'Retiré' : 'Picked up'}</option>
            <option value="COMMANDE">{lang === 'fr' ? 'Commande' : 'Order'}</option>
          </select>
          <select
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value as PaymentFilter)}
            className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="all">{lang === 'fr' ? 'Tous paiements' : 'All payments'}</option>
            <option value="paid">{lang === 'fr' ? 'Soldés' : 'Fully paid'}</option>
            <option value="unpaid">{lang === 'fr' ? 'Reste à payer' : 'Balance due'}</option>
          </select>
        </div>
      </div>

      {/* Summary KPI cards */}
      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-3.5 text-center">
            <div className="w-9 h-9 rounded-lg bg-sky-50 flex items-center justify-center mx-auto mb-1.5">
              <Package className="w-4 h-4 text-sky-600" />
            </div>
            <p className="text-xl font-bold text-slate-900">{stats.count}</p>
            <p className="text-xs text-slate-400 mt-0.5">{lang === 'fr' ? 'Dépôts' : 'Deposits'}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-3.5 text-center">
            <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center mx-auto mb-1.5">
              <Layers className="w-4 h-4 text-indigo-600" />
            </div>
            <p className="text-xl font-bold text-slate-900">{stats.pieces}</p>
            <p className="text-xs text-slate-400 mt-0.5">{lang === 'fr' ? 'Pièces' : 'Pieces'}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-3.5 text-center">
            <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center mx-auto mb-1.5">
              <TrendingUp className="w-4 h-4 text-slate-700" />
            </div>
            <p className="text-base font-bold text-slate-900">{formatPrice(stats.totalFacture)}</p>
            <p className="text-xs text-slate-400 mt-0.5">{lang === 'fr' ? 'Total facturé' : 'Total billed'}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-3.5 text-center">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center mx-auto mb-1.5">
              <Wallet className="w-4 h-4 text-emerald-600" />
            </div>
            <p className="text-base font-bold text-emerald-600">{formatPrice(stats.totalEncaisse)}</p>
            <p className="text-xs text-slate-400 mt-0.5">{lang === 'fr' ? 'Encaissé' : 'Collected'}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-3.5 text-center col-span-2 sm:col-span-1">
            <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center mx-auto mb-1.5">
              <AlertCircle className="w-4 h-4 text-amber-600" />
            </div>
            <p className="text-base font-bold text-amber-600">{formatPrice(stats.totalReste)}</p>
            <p className="text-xs text-slate-400 mt-0.5">{lang === 'fr' ? 'Reste à payer' : 'Balance due'}</p>
          </div>
        </div>
      )}

      {/* Print button */}
      {!loading && filtered.length > 0 && (
        <button
          onClick={() => printReport()}
          className="w-full py-2.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 transition-colors flex items-center justify-center gap-2"
        >
          <Printer className="w-4 h-4" />
          {lang === 'fr' ? 'Imprimer le journal des dépôts' : 'Print deposits journal'}
        </button>
      )}

      {/* Main ledger list */}
      {loading ? (
        <p className="text-sm text-slate-400 text-center py-8">{t('journal.loading')}</p>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm text-center py-12 px-4">
          <Filter className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">
            {lang === 'fr'
              ? `Aucun dépôt trouvé pour ${periodLabel.toLowerCase()}.`
              : `No deposits found for ${periodLabel.toLowerCase()}.`}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    <th className="w-8 px-3 py-3"></th>
                    <th className="px-3 py-3 text-left">{lang === 'fr' ? 'Date' : 'Date'}</th>
                    <th className="px-3 py-3 text-left">{lang === 'fr' ? 'N° Dépôt' : 'Deposit #'}</th>
                    <th className="px-3 py-3 text-left">{lang === 'fr' ? 'Client' : 'Client'}</th>
                    <th className="px-3 py-3 text-center">{lang === 'fr' ? 'Pièces' : 'Pcs'}</th>
                    <th className="px-3 py-3 text-left">{lang === 'fr' ? 'Traitement' : 'Treatment'}</th>
                    <th className="px-3 py-3 text-right">{lang === 'fr' ? 'Total' : 'Total'}</th>
                    <th className="px-3 py-3 text-right">{lang === 'fr' ? 'Encaissé' : 'Paid'}</th>
                    <th className="px-3 py-3 text-right">{lang === 'fr' ? 'Reste' : 'Balance'}</th>
                    <th className="px-3 py-3 text-center">{lang === 'fr' ? 'Statut' : 'Status'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((item) => {
                    const expanded = expandedIds.has(item.depot.id);
                    const badge = getStatutBadge(item.depot.statut);
                    return (
                      <Fragment key={item.depot.id}>
                        <tr
                          onClick={() => toggleExpand(item.depot.id)}
                          className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                        >
                          <td className="px-3 py-3 text-slate-400">
                            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-slate-600 text-xs">
                            {formatDate(item.depot.date_depot)}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap font-semibold text-slate-900">
                            {item.depot.numero ?? '—'}
                          </td>
                          <td className="px-3 py-3">
                            <p className="font-medium text-slate-900 truncate max-w-[180px]">{item.clientNom}</p>
                            {item.clientTel && (
                              <p className="text-xs text-slate-400">{item.clientTel}</p>
                            )}
                          </td>
                          <td className="px-3 py-3 text-center font-medium text-slate-700">
                            {item.pieces}
                          </td>
                          <td className="px-3 py-3 text-slate-600 whitespace-nowrap">
                            {item.traitementLabel}
                          </td>
                          <td className="px-3 py-3 text-right font-semibold text-slate-900 whitespace-nowrap">
                            {formatPrice(item.total)}
                          </td>
                          <td className="px-3 py-3 text-right font-medium text-emerald-600 whitespace-nowrap">
                            {formatPrice(item.paid)}
                          </td>
                          <td className="px-3 py-3 text-right font-semibold whitespace-nowrap">
                            <span className={item.reste > 0 ? 'text-amber-600' : 'text-slate-400'}>
                              {formatPrice(item.reste)}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-center whitespace-nowrap">
                            <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium border ${badge.cls}`}>
                              {badge.label}
                            </span>
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="bg-slate-50/70">
                            <td colSpan={10} className="px-6 py-4">
                              <div className="space-y-3">
                                <div className="flex flex-wrap gap-4 text-xs text-slate-500">
                                  <span className="inline-flex items-center gap-1.5">
                                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                    {lang === 'fr' ? 'Retrait prévu :' : 'Expected pickup:'}{' '}
                                    <strong className="text-slate-700">
                                      {item.depot.date_retrait_prevue ? formatDateShort(item.depot.date_retrait_prevue) : '—'}
                                    </strong>
                                  </span>
                                  {item.depot.date_retrait && (
                                    <span className="inline-flex items-center gap-1.5">
                                      <Calendar className="w-3.5 h-3.5 text-emerald-500" />
                                      {lang === 'fr' ? 'Retiré le :' : 'Picked up:'}{' '}
                                      <strong className="text-emerald-700">{formatDate(item.depot.date_retrait)}</strong>
                                    </span>
                                  )}
                                  <span>
                                    {lang === 'fr' ? 'Mode :' : 'Method:'}{' '}
                                    <strong className="text-slate-700">{item.modeLabel}</strong>
                                  </span>
                                  {item.depot.montant_remise && Number(item.depot.montant_remise) > 0 ? (
                                    <span>
                                      {lang === 'fr' ? 'Remise :' : 'Discount:'}{' '}
                                      <strong className="text-emerald-700">
                                        -{formatPrice(Number(item.depot.montant_remise))}
                                      </strong>
                                    </span>
                                  ) : null}
                                  {item.depot.commercial_id && (() => {
                                    const com = commerciauxMap.get(item.depot.commercial_id);
                                    const taux = item.depot.commission_taux ?? com?.taux_commission ?? 0;
                                    const comm = item.depot.commission_montant ?? Math.round((item.total * taux) / 100);
                                    return (
                                      <span>
                                        {lang === 'fr' ? 'Commercial :' : 'Sales agent:'}{' '}
                                        <strong className="text-amber-700">
                                          {com?.nom ?? '—'} ({taux} % · {formatPrice(comm)})
                                        </strong>
                                      </span>
                                    );
                                  })()}
                                </div>

                                {(item.depot.articles ?? []).length > 0 && (
                                  <div className="bg-white rounded-lg border border-slate-200/80 divide-y divide-slate-100">
                                    {item.depot.articles.map((art) => {
                                      const details = [art.couleur, art.signe_particulier, art.griffe]
                                        .filter((d) => d && d !== 'AUCUN');
                                      return (
                                        <div key={art.id} className="px-3 py-2 flex items-center justify-between gap-3 text-xs">
                                          <div className="min-w-0">
                                            <span className="font-medium text-slate-800">{art.designation}</span>
                                            <span className="text-slate-400 ml-2">
                                              ×{art.quantite} ({(art.nb_pieces || 1) * (art.quantite || 1)} pcs)
                                            </span>
                                            {details.length > 0 && (
                                              <span className="text-slate-400 ml-2">· {details.join(' · ')}</span>
                                            )}
                                          </div>
                                          <span className="font-semibold text-slate-700 whitespace-nowrap">
                                            {formatPrice(Number(art.prix_total))}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}

                                {item.depot.notes && (
                                  <p className="text-xs text-slate-500 flex items-start gap-1.5">
                                    <FileText className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
                                    <span>{item.depot.notes}</span>
                                  </p>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2.5">
            {filtered.map((item) => {
              const expanded = expandedIds.has(item.depot.id);
              const badge = getStatutBadge(item.depot.statut);
              return (
                <div
                  key={item.depot.id}
                  className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden"
                >
                  <button
                    onClick={() => toggleExpand(item.depot.id)}
                    className="w-full text-left p-4 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 text-sm">
                            {item.depot.numero ?? '—'}
                          </span>
                          <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium border ${badge.cls}`}>
                            {badge.label}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-slate-800 mt-0.5 truncate">
                          {item.clientNom}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {formatDate(item.depot.date_depot)} · {item.pieces} pcs · {item.traitementLabel}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold text-slate-900">{formatPrice(item.total)}</p>
                        {item.reste > 0 ? (
                          <p className="text-xs font-semibold text-amber-600">
                            {lang === 'fr' ? 'Reste' : 'Due'}: {formatPrice(item.reste)}
                          </p>
                        ) : (
                          <p className="text-xs font-medium text-emerald-600">
                            {lang === 'fr' ? 'Soldé' : 'Paid'}
                          </p>
                        )}
                      </div>
                    </div>
                  </button>

                  {expanded && (
                    <div className="px-4 pb-4 pt-2 border-t border-slate-100 bg-slate-50/60 space-y-2.5">
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                        {item.clientTel && (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="w-3 h-3" /> {item.clientTel}
                          </span>
                        )}
                        <span>
                          {lang === 'fr' ? 'Encaissé :' : 'Paid:'}{' '}
                          <strong className="text-emerald-700">{formatPrice(item.paid)}</strong>
                        </span>
                        <span>
                          {lang === 'fr' ? 'Mode :' : 'Method:'}{' '}
                          <strong className="text-slate-700">{item.modeLabel}</strong>
                        </span>
                        {item.depot.date_retrait_prevue && (
                          <span>
                            {lang === 'fr' ? 'Retrait prévu :' : 'Pickup:'}{' '}
                            <strong className="text-slate-700">{formatDateShort(item.depot.date_retrait_prevue)}</strong>
                          </span>
                        )}
                      </div>

                      {(item.depot.articles ?? []).length > 0 && (
                        <div className="bg-white rounded-lg border border-slate-200/70 divide-y divide-slate-100">
                          {item.depot.articles.map((art) => (
                            <div key={art.id} className="px-3 py-2 flex items-center justify-between gap-2 text-xs">
                              <span className="text-slate-700 truncate">
                                {art.designation} ×{art.quantite}
                              </span>
                              <span className="font-semibold text-slate-800 whitespace-nowrap">
                                {formatPrice(Number(art.prix_total))}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {item.depot.notes && (
                        <p className="text-xs text-slate-500">{item.depot.notes}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      <PrintableReport data={reportData} />
    </div>
  );
}
