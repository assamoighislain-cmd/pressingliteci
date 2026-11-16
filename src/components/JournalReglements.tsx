import { useState, useEffect, useMemo, useCallback } from 'react';
import { useI18n } from '@/lib/i18n';
import { db } from '@/lib/db';
import { useAuth } from '@/lib/auth';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import {
  DepotWithArticles,
  DepotAvance,
  ModeReglementRow,
  formatPrice,
  formatDate,
  formatDateShort,
  getModeReglementLabel,
} from '@/types';
import { Wallet, CalendarDays, Filter, TrendingUp, CreditCard, ChevronDown, ChevronRight, Receipt, CalendarClock, AlertCircle, Printer } from 'lucide-react';
import { PrintableReport, printReport, type ReportData } from '@/components/PrintableReport';
import type { Entreprise } from '@/types';

type PeriodFilter = 'today' | 'week' | 'month' | 'all' | 'custom';

interface ReglementEntry {
  id: string;
  date: string;
  numero: string;
  clientNom: string;
  modeLabel: string;
  montant: number;
  type: 'depot' | 'avance';
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

export default function JournalReglements() {
  const { t, lang } = useI18n();
  const { role } = useAuth();
  const [depots, setDepots] = useState<DepotWithArticles[]>([]);
  const [avances, setAvances] = useState<DepotAvance[]>([]);
  const [modes, setModes] = useState<ModeReglementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodFilter>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [entreprise, setEntreprise] = useState<Entreprise | null>(null);

  const loadJournal = useCallback(async () => {
    const [depotsData, avancesData, modesData, entData] = await Promise.all([
      db.getAllDepotsWithClient(),
      db.getAllAvances(),
      db.getModesReglement(),
      db.getEntreprise(),
    ]);
    setDepots(depotsData);
    setAvances(avancesData);
    setModes(modesData);
    setEntreprise(entData);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadJournal();
  }, [loadJournal]);

  useRealtimeSync(['depots', 'depot_avances', 'clients', 'modes_reglement', 'entreprise'], loadJournal);

  const depotMap = useMemo(() => {
    const m = new Map<string, DepotWithArticles>();
    for (const d of depots) m.set(d.id, d);
    return m;
  }, [depots]);

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
        periodLabel: t('journal.customPeriod'),
      };
    }
    return { startDate: null, endDate: null, periodLabel: t('journal.allPeriods') };
  }, [period, customStart, customEnd]);

  const allEntries: ReglementEntry[] = useMemo(() => {
    const entries: ReglementEntry[] = [];

    for (const depot of depots) {
      if (depot.avance_amount && Number(depot.avance_amount) > 0) {
        entries.push({
          id: `depot-${depot.id}`,
          date: depot.date_depot,
          numero: depot.numero ?? '—',
          clientNom: depot.client?.nom ?? t('journal.unknownClient'),
          modeLabel: depot.mode_reglement ? getModeReglementLabel(depot.mode_reglement, modes) : t('journal.initialAdvance'),
          montant: Number(depot.avance_amount),
          type: 'depot',
        });
      }
    }

    for (const av of avances) {
      const depot = depotMap.get(av.depot_id);
      entries.push({
        id: `avance-${av.id}`,
        date: av.date_paiement,
        numero: depot?.numero ?? '—',
        clientNom: depot?.client?.nom ?? t('journal.unknownClient'),
        modeLabel: av.mode_reglement ? getModeReglementLabel(av.mode_reglement, modes) : t('journal.extraAdvance'),
        montant: Number(av.montant),
        type: 'avance',
      });
    }

    return entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [depots, avances, depotMap, modes]);

  const filtered = useMemo(() => {
    if (!startDate || !endDate) return allEntries;
    return allEntries.filter((e) => {
      const d = new Date(e.date);
      return d >= startDate && d <= endDate;
    });
  }, [allEntries, startDate, endDate]);

  const groups = useMemo(() => {
    const groupMap = new Map<string, ReglementEntry[]>();
    for (const entry of filtered) {
      const key = formatDateShort(entry.date);
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(entry);
    }
    const sortedKeys = Array.from(groupMap.keys()).sort((a, b) => b.localeCompare(a));
    return sortedKeys.map((key) => {
      const items = groupMap.get(key)!;
      const total = items.reduce((sum, e) => sum + e.montant, 0);
      return { label: key, items, total };
    });
  }, [filtered]);

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

  const grandTotal = filtered.reduce((sum, e) => sum + e.montant, 0);
  const nbReglements = filtered.length;
  const nbAvances = filtered.filter((e) => e.type === 'avance').length;

  // ── Forecast: pending collections from uncollected deposits ──
  const forecasts = useMemo(() => {
    // Sum extra avances per depot
    const avancesByDepot = new Map<string, number>();
    for (const av of avances) {
      const prev = avancesByDepot.get(av.depot_id) ?? 0;
      avancesByDepot.set(av.depot_id, prev + Number(av.montant));
    }

    const pending = depots.filter((d) => d.statut === 'EN_COURS' || d.statut === 'COMMANDE');
    const rows = pending.map((d) => {
      const total = Number(d.total);
      const initialAvance = d.avance_amount ? Number(d.avance_amount) : 0;
      const extraAvances = avancesByDepot.get(d.id) ?? 0;
      const totalPaid = initialAvance + extraAvances;
      const balance = Math.max(0, total - totalPaid);
      return {
        id: d.id,
        numero: d.numero ?? '—',
        clientNom: d.client?.nom ?? t('journal.unknownClient'),
        dateRetrait: d.date_retrait_prevue,
        total,
        totalPaid,
        balance,
      };
    }).filter((r) => r.balance > 0);

    rows.sort((a, b) => {
      const da = a.dateRetrait ? new Date(a.dateRetrait).getTime() : Infinity;
      const db = b.dateRetrait ? new Date(b.dateRetrait).getTime() : Infinity;
      return da - db;
    });

    return rows;
  }, [depots, avances]);

  const forecastTotal = forecasts.reduce((sum, f) => sum + f.balance, 0);
  const forecastOverdue = forecasts.filter((f) => f.dateRetrait && new Date(f.dateRetrait) < new Date()).length;

  // Group forecasts by pickup date
  const forecastGroups = useMemo(() => {
    const groupMap = new Map<string, typeof forecasts>();
    for (const f of forecasts) {
      const key = f.dateRetrait ? formatDateShort(f.dateRetrait) : t('journal.forecastNoDate');
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(f);
    }
    const now = new Date();
    return Array.from(groupMap.entries()).map(([label, items]) => {
      const total = items.reduce((sum, f) => sum + f.balance, 0);
      const firstDate = items[0].dateRetrait ? new Date(items[0].dateRetrait) : null;
      const isOverdue = firstDate ? firstDate < now : false;
      return { label, items, total, isOverdue };
    }).sort((a, b) => {
      if (a.label === t('journal.forecastNoDate')) return 1;
      if (b.label === t('journal.forecastNoDate')) return -1;
      return a.label.localeCompare(b.label);
    });
  }, [forecasts]);

  const [expandedForecast, setExpandedForecast] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (forecastGroups.length > 0 && expandedForecast.size === 0) {
      setExpandedForecast(new Set([forecastGroups[0].label]));
    }
  }, [forecastGroups, expandedForecast.size]);

  function toggleForecast(label: string) {
    setExpandedForecast((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  const filterButtons: { id: PeriodFilter; label: string }[] = role === 'commercial'
    ? [{ id: 'today', label: t('journal.today') }]
    : [
        { id: 'today', label: t('journal.today') },
        { id: 'week', label: t('journal.thisWeek') },
        { id: 'month', label: t('journal.thisMonth') },
        { id: 'all', label: t('journal.all') },
        { id: 'custom', label: t('journal.custom') },
      ];

  const reportData: ReportData = {
    title: lang === 'fr' ? 'Journal des règlements' : 'Payment journal',
    subtitle: lang === 'fr' ? 'Rapport détaillé' : 'Detailed report',
    periodLabel,
    entreprise,
    columns: [
      { key: 'date', label: lang === 'fr' ? 'Date' : 'Date', align: 'left', render: (r) => formatDateShort(r.date as string) },
      { key: 'numero', label: 'N°', align: 'left', render: (r) => String(r.numero ?? '—') },
      { key: 'client', label: lang === 'fr' ? 'Client' : 'Client', align: 'left', render: (r) => String(r.client ?? '') },
      { key: 'mode', label: lang === 'fr' ? 'Mode' : 'Mode', align: 'left', render: (r) => String(r.mode ?? '') },
      { key: 'type', label: lang === 'fr' ? 'Type' : 'Type', align: 'center', render: (r) => String(r.type === 'avance' ? (lang === 'fr' ? 'Avance' : 'Advance') : (lang === 'fr' ? 'Dépôt' : 'Deposit')) },
      { key: 'montant', label: lang === 'fr' ? 'Montant' : 'Amount', align: 'right', render: (r) => formatPrice(Number(r.montant ?? 0)) },
    ],
    rows: filtered.map((e) => ({
      date: e.date,
      numero: e.numero,
      client: e.clientNom,
      mode: e.modeLabel,
      type: e.type,
      montant: e.montant,
    })),
    summaryRows: [
      { label: lang === 'fr' ? 'Nombre de règlements' : 'Payment count', value: String(nbReglements) },
      { label: lang === 'fr' ? 'Total encaissé' : 'Total collected', value: formatPrice(grandTotal), highlight: true },
    ],
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="text-center">
        <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-3">
          <Wallet className="w-7 h-7 text-emerald-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">{t('journal.title')}</h2>
        <p className="text-sm text-slate-500 mt-1">
          {t('journal.subtitle')}
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
                ? 'bg-emerald-500 text-white shadow-sm'
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
            <label className="text-xs text-slate-500 font-medium">{t('journal.from')}</label>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 font-medium">{t('journal.to')}</label>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
          </div>
        </div>
      )}

      {/* Summary cards */}
      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {filtered.length > 0 && (
            <>
              <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 text-center">
                <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center mx-auto mb-2">
                  <CreditCard className="w-5 h-5 text-emerald-600" />
                </div>
                <p className="text-2xl font-bold text-slate-900">{nbReglements}</p>
                <p className="text-xs text-slate-400 mt-0.5">{t('journal.reglements')}</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 text-center">
                <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center mx-auto mb-2">
                  <Receipt className="w-5 h-5 text-amber-600" />
                </div>
                <p className="text-2xl font-bold text-slate-900">{nbAvances}</p>
                <p className="text-xs text-slate-400 mt-0.5">{t('journal.avances')}</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 text-center">
                <div className="w-10 h-10 rounded-lg bg-sky-50 flex items-center justify-center mx-auto mb-2">
                  <TrendingUp className="w-5 h-5 text-sky-600" />
                </div>
                <p className="text-lg font-bold text-emerald-600">{formatPrice(grandTotal)}</p>
                <p className="text-xs text-slate-400 mt-0.5">{t('journal.totalCollected')}</p>
              </div>
            </>
          )}
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 text-center col-span-2 sm:col-span-1">
            <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center mx-auto mb-2">
              <CalendarClock className="w-5 h-5 text-amber-600" />
            </div>
            <p className="text-lg font-bold text-amber-600">{formatPrice(forecastTotal)}</p>
            <p className="text-xs text-slate-400 mt-0.5">{t('journal.forecastTotal')}</p>
          </div>
        </div>
      )}

      {/* Print button */}
      {!loading && filtered.length > 0 && (
        <button
          onClick={() => printReport()}
          className="w-full py-2.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 transition-colors flex items-center justify-center gap-2"
        >
          <Printer className="w-4 h-4" /> {lang === 'fr' ? 'Imprimer le journal' : 'Print journal'}
        </button>
      )}

      {loading ? (
        <p className="text-sm text-slate-400 text-center py-8">{t('journal.loading')}</p>
      ) : groups.length === 0 ? (
        <div className="text-center py-12">
          <Filter className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-400">{t('journal.noData', { period: periodLabel.toLowerCase() })}</p>
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
                <button
                  onClick={() => toggleGroup(group.label)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center flex-shrink-0">
                      <CalendarDays className="w-5 h-5" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-semibold text-slate-900">{group.label}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {t('journal.reglementCount', { count: group.items.length })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-sm font-semibold text-emerald-600 whitespace-nowrap">
                        {formatPrice(group.total)}
                      </p>
                      <p className="text-xs text-slate-400">{t('journal.encaisse')}</p>
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
                    {group.items.map((entry) => (
                      <div
                        key={entry.id}
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
                              {formatDate(entry.date)}
                              {' · '}
                              <span className={entry.type === 'avance' ? 'text-amber-600 font-medium' : ''}>
                                {entry.modeLabel}
                              </span>
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                          <span className="text-sm font-semibold text-emerald-600 whitespace-nowrap">
                            {formatPrice(entry.montant)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Forecast section ── */}
      {!loading && (
        <div className="space-y-4">
          <div className="text-center pt-2">
            <div className="inline-flex items-center gap-2">
              <CalendarClock className="w-5 h-5 text-amber-500" />
              <h3 className="text-lg font-bold text-slate-900">{t('journal.forecastTitle')}</h3>
            </div>
            <p className="text-sm text-slate-500 mt-1">{t('journal.forecastSubtitle')}</p>
          </div>

          {forecasts.length === 0 ? (
            <div className="text-center py-8 bg-white rounded-xl border border-slate-100">
              <CalendarClock className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-sm text-slate-400">{t('journal.forecastEmpty')}</p>
            </div>
          ) : (
            <>
              {forecastOverdue > 0 && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-100">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                  <p className="text-sm text-red-600">
                    {forecastOverdue} {lang === 'fr' ? 'dépôt(s) en retard de retrait' : 'deposit(s) overdue for pickup'}
                  </p>
                </div>
              )}

              {/* Forecast groups by pickup date */}
              <div className="space-y-3">
                {forecastGroups.map((group) => {
                  const isExpanded = expandedForecast.has(group.label);
                  return (
                    <div key={group.label} className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                      <button
                        onClick={() => toggleForecast(group.label)}
                        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                            group.isOverdue ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'
                          }`}>
                            <CalendarClock className="w-5 h-5" />
                          </div>
                          <div className="text-left">
                            <p className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                              {group.label}
                              {group.isOverdue && (
                                <span className="text-xs font-medium text-red-500 px-1.5 py-0.5 rounded bg-red-50">
                                  {t('journal.forecastOverdue')}
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-slate-400 mt-0.5">
                              {group.items.length} {t('journal.forecastPending')}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <p className="text-sm font-semibold text-amber-600 whitespace-nowrap">
                              {formatPrice(group.total)}
                            </p>
                            <p className="text-xs text-slate-400">{t('journal.forecastRemaining')}</p>
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
                          {group.items.map((f) => (
                            <div key={f.id} className="px-5 py-3.5 flex items-center justify-between hover:bg-slate-50/50 transition-colors">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-slate-900 truncate">
                                  {f.numero} — {f.clientNom}
                                </p>
                                <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
                                  <span>{t('journal.forecastTotalDeposit')}: {formatPrice(f.total)}</span>
                                  <span className="text-slate-300">·</span>
                                  <span>{t('journal.forecastAlreadyPaid')}: {formatPrice(f.totalPaid)}</span>
                                </p>
                              </div>
                              <div className="flex-shrink-0 ml-3">
                                <span className="text-sm font-semibold text-amber-600 whitespace-nowrap">
                                  {formatPrice(f.balance)}
                                </span>
                                <p className="text-xs text-slate-400 text-right">{t('journal.forecastBalance')}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
      <PrintableReport data={reportData} />
    </div>
  );
}
