import { useState, useEffect, useMemo } from 'react';
import { useI18n } from '@/lib/i18n';
import { db } from '@/lib/db';
import { useAuth } from '@/lib/auth';
import {
  DepotWithArticles,
  DepotAvance,
  ModeReglementRow,
  Depense,
  formatPrice,
  formatDateShort,
  getModeReglementLabel,
} from '@/types';
import {
  Calculator,
  TrendingUp,
  TrendingDown,
  Wallet,
  Clock,
  CheckCircle2,
  CreditCard,
  CalendarDays,
  Filter,
  ChevronDown,
  ChevronRight,
  PieChart,
  ArrowDownCircle,
  ArrowUpCircle,
  Scale,
  Printer,
} from 'lucide-react';
import { PrintableReport, printReport, type ReportData } from '@/components/PrintableReport';
import type { Entreprise } from '@/types';

type PeriodFilter = 'today' | 'week' | 'month' | 'all' | 'custom';

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

export default function Comptabilite() {
  const { t, lang } = useI18n();
  const { role } = useAuth();
  const [depots, setDepots] = useState<DepotWithArticles[]>([]);
  const [avances, setAvances] = useState<DepotAvance[]>([]);
  const [depenses, setDepenses] = useState<Depense[]>([]);
  const [modes, setModes] = useState<ModeReglementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodFilter>(role === 'commercial' ? 'today' : 'month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [entreprise, setEntreprise] = useState<Entreprise | null>(null);

  useEffect(() => {
    (async () => {
      const [depotsData, avancesData, depensesData, modesData, entData] = await Promise.all([
        db.getAllDepotsWithClient(),
        db.getAllAvances(),
        db.getAllDepenses(),
        db.getModesReglement(),
        db.getEntreprise(),
      ]);
      setDepots(depotsData);
      setAvances(avancesData);
      setDepenses(depensesData);
      setModes(modesData);
      setEntreprise(entData);
      setLoading(false);
    })();
  }, []);

  const depotMap = useMemo(() => {
    const m = new Map<string, DepotWithArticles>();
    for (const d of depots) m.set(d.id, d);
    return m;
  }, [depots]);

  const { startDate, endDate, periodLabel } = useMemo(() => {
    const now = new Date();
    if (period === 'today') {
      return { startDate: startOfDay(now), endDate: endOfDay(now), periodLabel: t('compta.today') };
    }
    if (period === 'week') {
      return { startDate: getWeekStart(now), endDate: endOfDay(now), periodLabel: t('compta.thisWeek') };
    }
    if (period === 'month') {
      return { startDate: getMonthStart(now), endDate: endOfDay(now), periodLabel: t('compta.thisMonth') };
    }
    if (period === 'custom' && customStart && customEnd) {
      return {
        startDate: startOfDay(new Date(customStart)),
        endDate: endOfDay(new Date(customEnd)),
        periodLabel: t('compta.customPeriod'),
      };
    }
    return { startDate: null, endDate: null, periodLabel: t('compta.allPeriods') };
  }, [period, customStart, customEnd]);

  const filteredDepots = useMemo(() => {
    if (!startDate || !endDate) return depots;
    return depots.filter((d) => {
      const dt = new Date(d.date_depot);
      return dt >= startDate && dt <= endDate;
    });
  }, [depots, startDate, endDate]);

  const filteredAvances = useMemo(() => {
    if (!startDate || !endDate) return avances;
    return avances.filter((a) => {
      const dt = new Date(a.date_paiement);
      return dt >= startDate && dt <= endDate;
    });
  }, [avances, startDate, endDate]);

  const filteredDepenses = useMemo(() => {
    if (!startDate || !endDate) return depenses;
    return depenses.filter((d) => {
      const dt = new Date(d.date_depense);
      return dt >= startDate && dt <= endDate;
    });
  }, [depenses, startDate, endDate]);

  const totalDepenses = useMemo(
    () => filteredDepenses.reduce((sum, d) => sum + Number(d.montant), 0),
    [filteredDepenses],
  );

  // CA théorique = somme des totaux des dépôts sur la période
  const caTheorique = useMemo(
    () => filteredDepots.reduce((sum, d) => sum + Number(d.total), 0),
    [filteredDepots],
  );

  // Encaissé = avances initiales (sur dépôts) + avances supplémentaires
  const encaisseInitial = useMemo(
    () =>
      filteredDepots
        .filter((d) => d.avance_amount && Number(d.avance_amount) > 0)
        .reduce((sum, d) => sum + Number(d.avance_amount), 0),
    [filteredDepots],
  );
  const encaisseAvances = useMemo(
    () => filteredAvances.reduce((sum, a) => sum + Number(a.montant), 0),
    [filteredAvances],
  );
  const totalEncaisse = encaisseInitial + encaisseAvances;

  // Résultat net = encaissé - dépenses
  const resultatNet = totalEncaisse - totalDepenses;

  // Reste à encaisser
  const resteEncaisser = Math.max(0, caTheorique - totalEncaisse);

  // Dépôts réglés (total encaissé >= total)
  const depotsRegles = useMemo(
    () =>
      filteredDepots.filter((d) => {
        const av = filteredAvances
          .filter((a) => a.depot_id === d.id)
          .reduce((s, a) => s + Number(a.montant), 0);
        const totalPaye = Number(d.avance_amount ?? 0) + av;
        return totalPaye >= Number(d.total);
      }),
    [filteredDepots, filteredAvances],
  );
  const depotsEnCours = filteredDepots.length - depotsRegles.length;

  // Répartition par mode de règlement
  const parMode = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of filteredDepots) {
      if (d.avance_amount && Number(d.avance_amount) > 0) {
        const key = d.mode_reglement ?? t('compta.notSpecified');
        map.set(key, (map.get(key) ?? 0) + Number(d.avance_amount));
      }
    }
    for (const a of filteredAvances) {
      const key = a.mode_reglement ?? t('compta.notSpecified');
      map.set(key, (map.get(key) ?? 0) + Number(a.montant));
    }
    return Array.from(map.entries())
      .map(([key, montant]) => ({
        label: getModeReglementLabel(key === t('compta.notSpecified') ? null : key, modes),
        montant,
        pct: totalEncaisse > 0 ? (montant / totalEncaisse) * 100 : 0,
      }))
      .sort((a, b) => b.montant - a.montant);
  }, [filteredDepots, filteredAvances, modes, totalEncaisse]);

  // Groupement par jour (encaissements)
  const groups = useMemo(() => {
    interface DayEntry {
      date: string;
      numero: string;
      clientNom: string;
      modeLabel: string;
      montant: number;
      type: 'depot' | 'avance';
    }
    const entries: DayEntry[] = [];

    for (const d of filteredDepots) {
      if (d.avance_amount && Number(d.avance_amount) > 0) {
        entries.push({
          date: d.date_depot,
          numero: d.numero ?? '—',
          clientNom: d.client?.nom ?? t('compta.unknownClient'),
          modeLabel: d.mode_reglement ? getModeReglementLabel(d.mode_reglement, modes) : t('compta.initialAdvance'),
          montant: Number(d.avance_amount),
          type: 'depot',
        });
      }
    }
    for (const a of filteredAvances) {
      const depot = depotMap.get(a.depot_id);
      entries.push({
        date: a.date_paiement,
        numero: depot?.numero ?? '—',
        clientNom: depot?.client?.nom ?? t('compta.unknownClient'),
        modeLabel: a.mode_reglement ? getModeReglementLabel(a.mode_reglement, modes) : t('compta.extraAdvance'),
        montant: Number(a.montant),
        type: 'avance',
      });
    }

    entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const groupMap = new Map<string, DayEntry[]>();
    for (const e of entries) {
      const key = formatDateShort(e.date);
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(e);
    }
    const sortedKeys = Array.from(groupMap.keys()).sort((a, b) => b.localeCompare(a));
    return sortedKeys.map((key) => {
      const items = groupMap.get(key)!;
      const total = items.reduce((sum, e) => sum + e.montant, 0);
      return { label: key, items, total };
    });
  }, [filteredDepots, filteredAvances, depotMap, modes]);

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

  const filterButtons: { id: PeriodFilter; label: string }[] = role === 'commercial'
    ? [{ id: 'today', label: t('compta.today') }]
    : [
        { id: 'today', label: t('compta.today') },
        { id: 'week', label: t('compta.thisWeek') },
        { id: 'month', label: t('compta.thisMonth') },
        { id: 'all', label: t('compta.all') },
        { id: 'custom', label: t('compta.custom') },
      ];

  const maxModeMontant = parMode.length > 0 ? Math.max(...parMode.map((m) => m.montant)) : 0;

  const reportData: ReportData = {
    title: lang === 'fr' ? 'Comptabilité' : 'Accounting',
    subtitle: lang === 'fr' ? 'Rapport des encaissements' : 'Revenue report',
    periodLabel,
    entreprise,
    columns: [
      { key: 'date', label: lang === 'fr' ? 'Date' : 'Date', align: 'left', render: (r) => formatDateShort(r.date as string) ?? '—' },
      { key: 'numero', label: lang === 'fr' ? 'N° Dépôt' : 'Deposit No.', align: 'left', render: (r) => String(r.numero ?? '—') },
      { key: 'client', label: lang === 'fr' ? 'Client' : 'Client', align: 'left', render: (r) => String(r.client ?? '') },
      { key: 'mode', label: lang === 'fr' ? 'Mode' : 'Mode', align: 'left', render: (r) => String(r.mode ?? '') },
      { key: 'type', label: lang === 'fr' ? 'Type' : 'Type', align: 'center', render: (r) => String(r.type === 'depot' ? (lang === 'fr' ? 'Dépôt' : 'Deposit') : (lang === 'fr' ? 'Avance' : 'Advance')) },
      { key: 'montant', label: lang === 'fr' ? 'Montant' : 'Amount', align: 'right', render: (r) => formatPrice(Number(r.montant ?? 0)) },
    ],
    rows: groups.flatMap((g) =>
      g.items.map((e) => ({
        date: e.date,
        numero: e.numero,
        client: e.clientNom,
        mode: e.modeLabel,
        type: e.type,
        montant: e.montant,
      })),
    ),
    summaryRows: [
      { label: lang === 'fr' ? 'CA théorique' : 'Theoretical revenue', value: formatPrice(caTheorique) },
      { label: lang === 'fr' ? 'Encaissé' : 'Collected', value: formatPrice(totalEncaisse) },
      { label: lang === 'fr' ? 'Reste à encaisser' : 'Remaining to collect', value: formatPrice(resteEncaisser) },
      { label: lang === 'fr' ? 'Dépenses' : 'Expenses', value: formatPrice(totalDepenses) },
      { label: lang === 'fr' ? 'Résultat net' : 'Net result', value: formatPrice(resultatNet), highlight: true },
    ],
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="text-center">
        <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mx-auto mb-3">
          <Calculator className="w-7 h-7 text-indigo-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">{t('compta.title')}</h2>
        <p className="text-sm text-slate-500 mt-1">
          {t('compta.subtitle')}
        </p>
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

      {/* Custom date range */}
      {period === 'custom' && (
        <div className="flex flex-wrap gap-3 items-center justify-center bg-white rounded-xl border border-slate-100 p-4">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 font-medium">{t('compta.from')}</label>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 font-medium">{t('compta.to')}</label>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400 text-center py-8">{t('compta.loading')}</p>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-9 h-9 rounded-lg bg-sky-50 flex items-center justify-center">
                  <TrendingUp className="w-4.5 h-4.5 text-sky-600" />
                </div>
                <p className="text-xs text-slate-400 font-medium">{t('compta.theoreticalRevenue')}</p>
              </div>
              <p className="text-lg font-bold text-slate-900">{formatPrice(caTheorique)}</p>
              <p className="text-xs text-slate-400 mt-0.5">{t('compta.depositCount', { count: filteredDepots.length })}</p>
            </div>

            <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center">
                  <ArrowDownCircle className="w-4.5 h-4.5 text-emerald-600" />
                </div>
                <p className="text-xs text-slate-400 font-medium">{t('compta.collected')}</p>
              </div>
              <p className="text-lg font-bold text-emerald-600">{formatPrice(totalEncaisse)}</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {encaisseInitial > 0 || encaisseAvances > 0
                  ? `${encaisseInitial > 0 ? formatPrice(encaisseInitial) : ''}${encaisseInitial > 0 && encaisseAvances > 0 ? ' + ' : ''}${encaisseAvances > 0 ? formatPrice(encaisseAvances) : ''}`
                  : '—'}
              </p>
            </div>

            <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center">
                  <ArrowUpCircle className="w-4.5 h-4.5 text-amber-600" />
                </div>
                <p className="text-xs text-slate-400 font-medium">{t('compta.remainingToCollect')}</p>
              </div>
              <p className="text-lg font-bold text-amber-600">{formatPrice(resteEncaisser)}</p>
              <p className="text-xs text-slate-400 mt-0.5">{t('compta.notSettled', { count: depotsEnCours })}</p>
            </div>

            <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-9 h-9 rounded-lg bg-violet-50 flex items-center justify-center">
                  <CheckCircle2 className="w-4.5 h-4.5 text-violet-600" />
                </div>
                <p className="text-xs text-slate-400 font-medium">{t('compta.settled')}</p>
              </div>
              <p className="text-lg font-bold text-slate-900">{depotsRegles.length}</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {t('compta.onTotal', { count: filteredDepots.length })}
              </p>
            </div>
          </div>

          {/* Dépenses & Résultat net */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-9 h-9 rounded-lg bg-rose-50 flex items-center justify-center">
                  <TrendingDown className="w-4.5 h-4.5 text-rose-600" />
                </div>
                <p className="text-xs text-slate-400 font-medium">{t('compta.expenses')}</p>
              </div>
              <p className="text-lg font-bold text-rose-600">{formatPrice(totalDepenses)}</p>
              <p className="text-xs text-slate-400 mt-0.5">{t('compta.expenseCount', { count: filteredDepenses.length })}</p>
            </div>

            <div className={`bg-white rounded-xl border shadow-sm p-4 ${resultatNet >= 0 ? 'border-emerald-100' : 'border-red-100'}`}>
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${resultatNet >= 0 ? 'bg-emerald-50' : 'bg-red-50'}`}>
                  <Scale className={`w-4.5 h-4.5 ${resultatNet >= 0 ? 'text-emerald-600' : 'text-red-600'}`} />
                </div>
                <p className="text-xs text-slate-400 font-medium">{t('compta.netResult')}</p>
              </div>
              <p className={`text-lg font-bold ${resultatNet >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {formatPrice(resultatNet)}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                {resultatNet >= 0 ? t('compta.profit') : t('compta.loss')} {t('compta.ofPeriod')}
              </p>
            </div>
          </div>

          {/* Taux de recouvrement */}
          {caTheorique > 0 && (
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-slate-700">{t('compta.recoveryRate')}</p>
                <p className="text-sm font-bold text-indigo-600">
                  {Math.round((totalEncaisse / caTheorique) * 100)}%
                </p>
              </div>
              <div className="w-full h-2.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500 transition-all duration-500"
                  style={{ width: `${Math.min(100, (totalEncaisse / caTheorique) * 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-2 text-xs text-slate-400">
                <span>{formatPrice(totalEncaisse)} {t('compta.encaisse')}</span>
                <span>{formatPrice(caTheorique)} {t('compta.total')}</span>
              </div>
            </div>
          )}

          {/* Répartition par mode de règlement */}
          {parMode.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center">
                  <PieChart className="w-4.5 h-4.5 text-indigo-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{t('compta.byPaymentMode')}</p>
                  <p className="text-xs text-slate-400">{t('compta.distribution')}</p>
                </div>
              </div>
              <div className="space-y-3">
                {parMode.map((m) => (
                  <div key={m.label}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <CreditCard className="w-3.5 h-3.5 text-slate-400" />
                        <span className="text-sm font-medium text-slate-700">{m.label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">{formatPrice(m.montant)}</span>
                        <span className="text-xs text-slate-400">{Math.round(m.pct)}%</span>
                      </div>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-indigo-400 transition-all duration-500"
                        style={{ width: `${maxModeMontant > 0 ? (m.montant / maxModeMontant) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Détail des encaissements par jour */}
          {groups.length === 0 ? (
            <div className="text-center py-12">
              <Filter className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-sm text-slate-400">{t('compta.noData', { period: periodLabel.toLowerCase() })}</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-slate-400" />
                  <h3 className="text-sm font-semibold text-slate-700">{t('compta.encaissementsDetail')}</h3>
                </div>
                <button
                  onClick={() => printReport()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200 transition-colors"
                >
                  <Printer className="w-3.5 h-3.5" /> {lang === 'fr' ? 'Imprimer' : 'Print'}
                </button>
              </div>
              {groups.map((group) => {
                const isExpanded = expandedGroups.has(group.label);
                return (
                  <div
                    key={group.label}
                    className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden"
                  >
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
                            {t('compta.encaissementCount', { count: group.items.length })}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="text-sm font-semibold text-emerald-600 whitespace-nowrap">
                            {formatPrice(group.total)}
                          </p>
                          <p className="text-xs text-slate-400">{t('compta.encaisse')}</p>
                        </div>
                        {isExpanded ? (
                          <ChevronDown className="w-5 h-5 text-slate-400" />
                        ) : (
                          <ChevronRight className="w-5 h-5 text-slate-400" />
                        )}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="divide-y divide-slate-50">
                        {group.items.map((entry, idx) => (
                          <div
                            key={`${entry.numero}-${idx}`}
                            className="px-5 py-3.5 flex items-center justify-between hover:bg-slate-50/50 transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div
                                className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                                  entry.type === 'avance' ? 'bg-amber-400' : 'bg-emerald-400'
                                }`}
                              />
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-slate-900 truncate">
                                  {entry.numero} — {entry.clientNom}
                                </p>
                                <p className="text-xs text-slate-400 mt-0.5">
                                  <span className={entry.type === 'avance' ? 'text-amber-600 font-medium' : ''}>
                                    {entry.modeLabel}
                                  </span>
                                </p>
                              </div>
                            </div>
                            <span className="text-sm font-semibold text-emerald-600 whitespace-nowrap ml-3">
                              {formatPrice(entry.montant)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
      <PrintableReport data={reportData} />
    </div>
  );
}
