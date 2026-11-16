import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { db } from '@/lib/db';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import {
  DepotWithClient,
  ModeReglementRow,
  RelanceWithClient,
  RelanceCanal,
  formatPrice,
  formatDate,
  formatDateShort,
  getModeReglementLabel,
} from '@/types';
import type { Entreprise } from '@/types';
import { PrintableReport, printReport, type ReportData } from '@/components/PrintableReport';
import {
  Clock, CheckCircle2, TrendingUp, TrendingDown, Package,
  ArrowUpFromLine, ArrowDownToLine, Calendar, Users,
  BarChart3, PieChart, AlertTriangle, Wallet, CalendarClock, Cake, MessageCircle, Printer, Trash2, History,
} from 'lucide-react';

interface DashboardProps {
  onNavigate: (view: 'depot' | 'retrait') => void;
}

interface Stats {
  enCours: number;
  retires: number;
  totalJour: number;
  caJour: number;
  recettePrevuJour: number;
}

interface RevenueDay {
  date: string;
  revenue: number;
  count: number;
}

interface TopClient {
  nom: string;
  totalCA: number;
  nbDepots: number;
}

interface PaymentMode {
  mode: string;
  total: number;
  count: number;
}

interface ArticleStat {
  designation: string;
  count: number;
  revenue: number;
}

interface MonthlyComp {
  currentMonth: number;
  previousMonth: number;
  currentExpenses: number;
  previousExpenses: number;
}

const CHART_COLORS = [
  '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
];

function MiniBarChart({ data, maxVal }: { data: RevenueDay[]; maxVal: number }) {
  if (data.length === 0) return null;
  const barWidth = Math.max(4, Math.min(20, Math.floor(320 / data.length) - 2));
  const height = 120;
  const totalWidth = data.length * (barWidth + 2);

  return (
    <svg viewBox={`0 0 ${totalWidth} ${height + 20}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      {data.map((d, i) => {
        const barH = maxVal > 0 ? (d.revenue / maxVal) * height : 0;
        const x = i * (barWidth + 2);
        const isToday = d.date === new Date().toISOString().slice(0, 10);
        return (
          <g key={d.date}>
            <rect
              x={x}
              y={height - barH}
              width={barWidth}
              height={Math.max(barH, 1)}
              rx={2}
              className={isToday ? 'fill-sky-500' : 'fill-sky-300'}
            />
            {(i === 0 || i === data.length - 1 || isToday) && (
              <text
                x={x + barWidth / 2}
                y={height + 14}
                textAnchor="middle"
                className="fill-slate-400"
                style={{ fontSize: '8px' }}
              >
                {d.date.slice(5).replace('-', '/')}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function DonutChart({ segments, size = 120 }: { segments: { value: number; color: string; label: string }[]; size?: number }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return null;
  const radius = (size - 8) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const innerRadius = radius * 0.55;

  let cumulativeAngle = -Math.PI / 2;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {segments.map((seg, i) => {
        const angle = (seg.value / total) * 2 * Math.PI;
        const startAngle = cumulativeAngle;
        const endAngle = cumulativeAngle + angle;
        cumulativeAngle = endAngle;

        const largeArc = angle > Math.PI ? 1 : 0;
        const x1 = cx + radius * Math.cos(startAngle);
        const y1 = cy + radius * Math.sin(startAngle);
        const x2 = cx + radius * Math.cos(endAngle);
        const y2 = cy + radius * Math.sin(endAngle);
        const ix1 = cx + innerRadius * Math.cos(startAngle);
        const iy1 = cy + innerRadius * Math.sin(startAngle);
        const ix2 = cx + innerRadius * Math.cos(endAngle);
        const iy2 = cy + innerRadius * Math.sin(endAngle);

        const d = [
          `M ${x1} ${y1}`,
          `A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`,
          `L ${ix2} ${iy2}`,
          `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${ix1} ${iy1}`,
          'Z',
        ].join(' ');

        return <path key={i} d={d} fill={seg.color} className="transition-opacity hover:opacity-80" />;
      })}
    </svg>
  );
}

function HorizontalBar({ label, value, maxValue, color, formattedValue }: {
  label: string; value: number; maxValue: number; color: string; formattedValue: string;
}) {
  const pct = maxValue > 0 ? Math.max(2, (value / maxValue) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-700 font-medium truncate mr-2">{label}</span>
        <span className="text-slate-900 font-semibold whitespace-nowrap">{formattedValue}</span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function PercentBadge({ current, previous, lang }: { current: number; previous: number; lang: string }) {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">{lang === 'fr' ? 'Nouveau' : 'New'}</span>;
  const pct = Math.round(((current - previous) / previous) * 100);
  const isUp = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded ${isUp ? 'text-emerald-700 bg-emerald-50' : 'text-red-700 bg-red-50'}`}>
      {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {isUp ? '+' : ''}{pct}%
    </span>
  );
}

export default function Dashboard({ onNavigate }: DashboardProps) {
  const { t, lang } = useI18n();
  const [stats, setStats] = useState<Stats>({ enCours: 0, retires: 0, totalJour: 0, caJour: 0, recettePrevuJour: 0 });
  const [recent, setRecent] = useState<DepotWithClient[]>([]);
  const [modesReglement, setModesReglement] = useState<ModeReglementRow[]>([]);
  const [revenueData, setRevenueData] = useState<RevenueDay[]>([]);
  const [topClients, setTopClients] = useState<TopClient[]>([]);
  const [paymentModes, setPaymentModes] = useState<PaymentMode[]>([]);
  const [articleStats, setArticleStats] = useState<ArticleStat[]>([]);
  const [monthlyComp, setMonthlyComp] = useState<MonthlyComp | null>(null);
  const [unpaid, setUnpaid] = useState<{ count: number; total: number }>({ count: 0, total: 0 });
  const [birthdays, setBirthdays] = useState<{ id: string; nom: string; telephone: string | null; date_naissance: string | null }[]>([]);
  const [upcomingBirthdays, setUpcomingBirthdays] = useState<{ id: string; nom: string; telephone: string | null; date_naissance: string | null; daysUntil: number }[]>([]);
  const [inactiveClients, setInactiveClients] = useState<{ id: string; nom: string; telephone: string | null; dernier_depot: string | null; total_depot: number; nb_depots: number }[]>([]);
  const [relances, setRelances] = useState<RelanceWithClient[]>([]);
  const [showJournal, setShowJournal] = useState(false);
  const [printTarget, setPrintTarget] = useState<'relances' | 'inactive' | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadDashboard(false);
  }, []);

  useRealtimeSync(
    ['depots', 'depot_articles', 'depot_avances', 'clients', 'depenses', 'modes_reglement', 'relances'],
    () => loadDashboard(true),
  );

  async function loadDashboard(silent = false) {
    if (!silent) setLoading(true);
    const [statsData, recentData, modesData, revenue, clients, payments, articles, monthly, unpaidData, birthdayClients] = await Promise.all([
      db.getDashboardStats(),
      db.getDepotsWithClient(),
      db.getModesReglement(),
      db.getRevenueByDay(30),
      db.getTopClients(5),
      db.getPaymentBreakdown(),
      db.getArticleStats(),
      db.getMonthlyComparison(),
      db.getUnpaidTotal(),
      db.getAllClients(),
    ]);

    setStats(statsData);
    setRecent(recentData);
    setModesReglement(modesData);
    setRevenueData(revenue);
    setTopClients(clients);
    setPaymentModes(payments);
    setArticleStats(articles);
    setMonthlyComp(monthly);
    setUnpaid(unpaidData);
    const today = new Date();
    const todayMonthDay = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    setBirthdays(birthdayClients
      .filter((c) => c.date_naissance && c.date_naissance.slice(5) === todayMonthDay)
      .map((c) => ({ id: c.id, nom: c.nom, telephone: c.telephone, date_naissance: c.date_naissance })));

    // Upcoming birthdays in next 7 days (excluding today)
    const upcoming: { id: string; nom: string; telephone: string | null; date_naissance: string | null; daysUntil: number }[] = [];
    for (const c of birthdayClients) {
      if (!c.date_naissance) continue;
      const md = c.date_naissance.slice(5);
      if (md === todayMonthDay) continue;
      const thisYear = new Date(today.getFullYear(), Number(md.slice(0, 2)) - 1, Number(md.slice(3, 5)));
      let nextBirthday = new Date(today.getFullYear(), Number(md.slice(0, 2)) - 1, Number(md.slice(3, 5)));
      if (nextBirthday < today) {
        nextBirthday = new Date(today.getFullYear() + 1, Number(md.slice(0, 2)) - 1, Number(md.slice(3, 5)));
      }
      const diffMs = nextBirthday.getTime() - today.getTime();
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays > 0 && diffDays <= 7) {
        upcoming.push({ id: c.id, nom: c.nom, telephone: c.telephone, date_naissance: c.date_naissance, daysUntil: diffDays });
      }
      void thisYear;
    }
    upcoming.sort((a, b) => a.daysUntil - b.daysUntil);
    setUpcomingBirthdays(upcoming);

    // Inactive clients: no deposit in last 60 days
    const sixtyDaysAgo = new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000);
    const clientIds = birthdayClients.map((c) => c.id);
    const lastDepotMap = await db.getLastDepotDates(clientIds);
    const inactive: { id: string; nom: string; telephone: string | null; dernier_depot: string | null; total_depot: number; nb_depots: number }[] = [];
    for (const c of birthdayClients) {
      const info = lastDepotMap[c.id] ?? null;
      const lastDate = info?.date ?? null;
      if (!lastDate || new Date(lastDate) < sixtyDaysAgo) {
        inactive.push({ id: c.id, nom: c.nom, telephone: c.telephone, dernier_depot: lastDate, total_depot: info?.total ?? 0, nb_depots: info?.count ?? 0 });
      }
    }
    inactive.sort((a, b) => {
      if (!a.dernier_depot && !b.dernier_depot) return a.nom.localeCompare(b.nom);
      if (!a.dernier_depot) return -1;
      if (!b.dernier_depot) return 1;
      return new Date(a.dernier_depot).getTime() - new Date(b.dernier_depot).getTime();
    });
    setInactiveClients(inactive);
    const relancesData = await db.getRelances();
    setRelances(relancesData);
    setLoading(false);
  }

  async function handleRelance(clientId: string, telephone: string | null, canal: RelanceCanal) {
    const err = await db.insertRelance({ client_id: clientId, canal });
    if (err) return;
    const updated = await db.getRelances();
    setRelances(updated);
    if (telephone) {
      const msg = lang === 'fr'
        ? `Bonjour,\n\nNous vous avons manqué ? Votre pressing vous accueille à nouveau avec plaisir !`
        : `Hello,\n\nHave we missed you? Your dry cleaner welcomes you back with pleasure!`;
      const waUrl = `https://wa.me/${telephone.replace(/[^\d]/g, '')}?text=${encodeURIComponent(msg)}`;
      window.open(waUrl, '_blank');
    }
  }

  async function handleDeleteRelance(id: string) {
    const err = await db.deleteRelance(id);
    if (err) return;
    setRelances((prev) => prev.filter((r) => r.id !== id));
  }

  const maxRevenue = revenueData.length > 0 ? Math.max(...revenueData.map(d => d.revenue)) : 0;
  const totalRevenue30d = revenueData.reduce((s, d) => s + d.revenue, 0);
  const totalDeposits30d = revenueData.reduce((s, d) => s + d.count, 0);
  const maxArticleRevenue = articleStats.length > 0 ? articleStats[0]?.revenue ?? 0 : 0;
  const maxClientCA = topClients.length > 0 ? topClients[0]?.totalCA ?? 0 : 0;

  const donutSegments = paymentModes.map((pm, i) => ({
    value: pm.total,
    color: CHART_COLORS[i % CHART_COLORS.length],
    label: pm.mode,
  }));

  const netCurrent = (monthlyComp?.currentMonth ?? 0) - (monthlyComp?.currentExpenses ?? 0);
  const netPrevious = (monthlyComp?.previousMonth ?? 0) - (monthlyComp?.previousExpenses ?? 0);

  const relanceReportData: ReportData = {
    title: lang === 'fr' ? 'Journal des relances' : 'Outreach journal',
    subtitle: lang === 'fr' ? 'Historique des actions de relance clients' : 'Client outreach history',
    entreprise: null,
    columns: [
      { key: 'date', label: lang === 'fr' ? 'Date' : 'Date', align: 'left', width: '18%', render: (r) => formatDateShort(r.date as string) },
      { key: 'client', label: lang === 'fr' ? 'Client' : 'Client', align: 'left', render: (r) => String(r.client ?? '') },
      { key: 'canal', label: lang === 'fr' ? 'Canal' : 'Channel', align: 'left', width: '15%', render: (r) => String(r.canal ?? '') },
      { key: 'note', label: lang === 'fr' ? 'Note' : 'Note', align: 'left', render: (r) => String(r.note ?? '—') },
    ],
    rows: relances.map((r) => ({
      date: r.date_relance,
      client: r.client_nom,
      canal: r.canal,
      note: r.note,
    })),
    summaryRows: [
      { label: lang === 'fr' ? 'Total relances' : 'Total outreach', value: String(relances.length), highlight: true },
    ],
  };

  const inactiveReportData: ReportData = {
    title: lang === 'fr' ? 'Clients inactifs (60+ jours)' : 'Inactive clients (60+ days)',
    subtitle: lang === 'fr' ? 'Clients sans visite récente — à relancer' : 'Clients with no recent visit — to reach out',
    entreprise: null,
    columns: [
      { key: 'nom', label: lang === 'fr' ? 'Client' : 'Client', align: 'left', render: (r) => String(r.nom ?? '') },
      { key: 'tel', label: lang === 'fr' ? 'Téléphone' : 'Phone', align: 'left', width: '15%', render: (r) => String(r.tel ?? '—') },
      { key: 'nb', label: lang === 'fr' ? 'Nb dépôts' : 'Deposits', align: 'center', width: '10%', render: (r) => String(r.nb ?? 0) },
      { key: 'montant', label: lang === 'fr' ? 'Montant total' : 'Total amount', align: 'right', width: '15%', render: (r) => formatPrice(Number(r.montant ?? 0)) },
      { key: 'dernier', label: lang === 'fr' ? 'Dernier dépôt' : 'Last deposit', align: 'center', width: '15%', render: (r) => formatDateShort(r.dernier as string | null) },
    ],
    rows: inactiveClients.map((c) => ({
      nom: c.nom,
      tel: c.telephone ?? '—',
      nb: c.nb_depots,
      montant: c.total_depot,
      dernier: c.dernier_depot,
    })),
    summaryRows: [
      { label: lang === 'fr' ? 'Total clients inactifs' : 'Total inactive clients', value: String(inactiveClients.length) },
      { label: lang === 'fr' ? 'Montant total cumulé' : 'Total cumulative amount', value: formatPrice(inactiveClients.reduce((s, c) => s + c.total_depot, 0)), highlight: true },
    ],
  };

  const cards = [
    {
      label: lang === 'fr' ? 'En cours' : 'In progress',
      value: stats.enCours,
      icon: Clock,
      bg: 'bg-amber-50',
      text: 'text-amber-600',
      ring: 'ring-amber-100',
    },
    {
      label: lang === 'fr' ? 'Retirés' : 'Picked up',
      value: stats.retires,
      icon: CheckCircle2,
      bg: 'bg-emerald-50',
      text: 'text-emerald-600',
      ring: 'ring-emerald-100',
    },
    {
      label: lang === 'fr' ? 'Dépôts du jour' : "Today's deposits",
      value: stats.totalJour,
      icon: Package,
      bg: 'bg-sky-50',
      text: 'text-sky-600',
      ring: 'ring-sky-100',
    },
    {
      label: lang === 'fr' ? 'CA du jour' : "Today's revenue",
      value: formatPrice(stats.caJour),
      icon: TrendingUp,
      bg: 'bg-teal-50',
      text: 'text-teal-600',
      ring: 'ring-teal-100',
    },
    {
      label: lang === 'fr' ? 'Recette prévue du jour' : "Today's expected revenue",
      value: formatPrice(stats.recettePrevuJour),
      icon: CalendarClock,
      bg: 'bg-violet-50',
      text: 'text-violet-600',
      ring: 'ring-violet-100',
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          onClick={() => onNavigate('depot')}
          className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-sky-500 to-cyan-600 p-6 text-left shadow-sm transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5"
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-white">{t('dash.newDepot')}</h3>
              <p className="text-sm text-sky-50 mt-1">{lang === 'fr' ? 'Enregistrer une facture client' : 'Record a client invoice'}</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center transition-transform duration-300 group-hover:scale-110">
              <ArrowDownToLine className="w-6 h-6 text-white" />
            </div>
          </div>
        </button>

        <button
          onClick={() => onNavigate('retrait')}
          className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-6 text-left shadow-sm transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5"
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-white">{t('dash.retrait')}</h3>
              <p className="text-sm text-emerald-50 mt-1">{lang === 'fr' ? 'Vérifier et retirer un dépôt' : 'Check and pick up a deposit'}</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center transition-transform duration-300 group-hover:scale-110">
              <ArrowUpFromLine className="w-6 h-6 text-white" />
            </div>
          </div>
        </button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className={`rounded-xl bg-white p-5 border border-slate-100 shadow-sm ring-1 ${card.ring}`}>
              <div className="flex items-center justify-between mb-3">
                <div className={`w-10 h-10 rounded-lg ${card.bg} flex items-center justify-center`}>
                  <Icon className={`w-5 h-5 ${card.text}`} />
                </div>
              </div>
              <p className="text-2xl font-bold text-slate-900">{card.value}</p>
              <p className="text-sm text-slate-500 mt-1">{card.label}</p>
            </div>
          );
        })}
      </div>

      {/* Unpaid alert */}
      {unpaid.count > 0 && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-amber-800">
              {lang === 'fr'
                ? `${unpaid.count} dépôt${unpaid.count > 1 ? 's' : ''} avec solde impayé`
                : `${unpaid.count} deposit${unpaid.count > 1 ? 's' : ''} with unpaid balance`}
            </p>
            <p className="text-sm text-amber-700 mt-0.5">
              {lang === 'fr' ? 'Reste à encaisser :' : 'Remaining to collect:'} <span className="font-bold">{formatPrice(unpaid.total)}</span>
            </p>
          </div>
        </div>
      )}

      {/* Today's birthdays */}
      {birthdays.length > 0 && (
        <div className="rounded-xl bg-gradient-to-br from-pink-50 to-rose-50 border border-pink-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-9 h-9 rounded-lg bg-pink-100 flex items-center justify-center">
              <Cake className="w-5 h-5 text-pink-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-pink-900">
                {lang === 'fr' ? 'Anniversaires du jour' : "Today's birthdays"}
              </h3>
              <p className="text-xs text-pink-500">
                {birthdays.length} {lang === 'fr' ? `client${birthdays.length > 1 ? 's' : ''} fête${birthdays.length > 1 ? 'nt' : ''} son anniversaire` : `client${birthdays.length > 1 ? 's' : ''} celebrating`}
              </p>
            </div>
          </div>
          <div className="space-y-2">
            {birthdays.map((c) => {
              const age = c.date_naissance ? new Date().getFullYear() - new Date(c.date_naissance).getFullYear() : null;
              const waUrl = c.telephone
                ? `https://wa.me/${c.telephone.replace(/[^\d]/g, '')}?text=${encodeURIComponent(
                    lang === 'fr'
                      ? `Joyeux anniversaire ${c.nom} ! 🎂\n\nToute l'équipe vous souhaite un excellent anniversaire.`
                      : `Happy birthday ${c.nom}! 🎂\n\nThe whole team wishes you a wonderful birthday.`,
                  )}`
                : null;
              return (
                <div key={c.id} className="flex items-center justify-between bg-white/70 rounded-lg px-3 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-slate-800 truncate">{c.nom}</span>
                    {age != null && (
                      <span className="text-xs text-pink-500 flex-shrink-0">{age} {lang === 'fr' ? 'ans' : 'yrs'}</span>
                    )}
                  </div>
                  {waUrl && (
                    <a
                      href={waUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-medium hover:bg-emerald-600 transition-colors flex-shrink-0"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      {lang === 'fr' ? 'Souhaiter' : 'Wish'}
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Monthly comparison */}
      {monthlyComp && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-xl bg-white p-5 border border-slate-100 shadow-sm">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm text-slate-500">{lang === 'fr' ? 'CA ce mois' : 'Revenue this month'}</p>
              <PercentBadge current={monthlyComp.currentMonth} previous={monthlyComp.previousMonth} lang={lang} />
            </div>
            <p className="text-xl font-bold text-slate-900">{formatPrice(monthlyComp.currentMonth)}</p>
            <p className="text-xs text-slate-400 mt-1">
              {lang === 'fr' ? 'Mois précédent :' : 'Previous month:'} {formatPrice(monthlyComp.previousMonth)}
            </p>
          </div>
          <div className="rounded-xl bg-white p-5 border border-slate-100 shadow-sm">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm text-slate-500">{lang === 'fr' ? 'Dépenses ce mois' : 'Expenses this month'}</p>
              <PercentBadge current={monthlyComp.currentExpenses} previous={monthlyComp.previousExpenses} lang={lang} />
            </div>
            <p className="text-xl font-bold text-slate-900">{formatPrice(monthlyComp.currentExpenses)}</p>
            <p className="text-xs text-slate-400 mt-1">
              {lang === 'fr' ? 'Mois précédent :' : 'Previous month:'} {formatPrice(monthlyComp.previousExpenses)}
            </p>
          </div>
          <div className="rounded-xl bg-white p-5 border border-slate-100 shadow-sm">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm text-slate-500">{lang === 'fr' ? 'Bénéfice net' : 'Net profit'}</p>
              <PercentBadge current={netCurrent} previous={netPrevious} lang={lang} />
            </div>
            <p className={`text-xl font-bold ${netCurrent >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {formatPrice(netCurrent)}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {lang === 'fr' ? 'Mois précédent :' : 'Previous month:'} {formatPrice(netPrevious)}
            </p>
          </div>
        </div>
      )}

      {/* Revenue chart + Payment breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue chart */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-sky-500" />
              <h2 className="text-base font-semibold text-slate-900">
                {lang === 'fr' ? 'Chiffre d\'affaires — 30 jours' : 'Revenue — 30 days'}
              </h2>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold text-slate-900">{formatPrice(totalRevenue30d)}</p>
              <p className="text-xs text-slate-400">{totalDeposits30d} {lang === 'fr' ? 'dépôts' : 'deposits'}</p>
            </div>
          </div>
          <div className="px-5 py-4 h-44">
            {revenueData.length > 0 ? (
              <MiniBarChart data={revenueData} maxVal={maxRevenue} />
            ) : (
              <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                {lang === 'fr' ? 'Aucune donnée' : 'No data'}
              </div>
            )}
          </div>
        </div>

        {/* Payment breakdown donut */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
            <PieChart className="w-4 h-4 text-teal-500" />
            <h2 className="text-base font-semibold text-slate-900">
              {lang === 'fr' ? 'Modes de paiement' : 'Payment methods'}
            </h2>
          </div>
          <div className="px-5 py-4 flex flex-col items-center gap-3">
            {paymentModes.length > 0 ? (
              <>
                <DonutChart segments={donutSegments} />
                <div className="space-y-1.5 w-full">
                  {paymentModes.slice(0, 5).map((pm, i) => (
                    <div key={pm.mode} className="flex items-center gap-2 text-xs">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                      <span className="text-slate-600 truncate flex-1">{pm.mode}</span>
                      <span className="text-slate-900 font-semibold">{formatPrice(pm.total)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="py-8 text-slate-400 text-sm">{lang === 'fr' ? 'Aucune donnée' : 'No data'}</div>
            )}
          </div>
        </div>
      </div>

      {/* Top clients + Top articles */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top clients */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
            <Users className="w-4 h-4 text-sky-500" />
            <h2 className="text-base font-semibold text-slate-900">
              {lang === 'fr' ? 'Meilleurs clients' : 'Top clients'}
            </h2>
          </div>
          <div className="px-5 py-4 space-y-3">
            {topClients.length > 0 ? topClients.map((c, i) => (
              <HorizontalBar
                key={c.nom}
                label={`${c.nom} (${c.nbDepots})`}
                value={c.totalCA}
                maxValue={maxClientCA}
                color={CHART_COLORS[i % CHART_COLORS.length]}
                formattedValue={formatPrice(c.totalCA)}
              />
            )) : (
              <div className="py-6 text-center text-slate-400 text-sm">{lang === 'fr' ? 'Aucune donnée' : 'No data'}</div>
            )}
          </div>
        </div>

        {/* Top articles */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
            <Wallet className="w-4 h-4 text-emerald-500" />
            <h2 className="text-base font-semibold text-slate-900">
              {lang === 'fr' ? 'Articles les plus demandés' : 'Most requested items'}
            </h2>
          </div>
          <div className="px-5 py-4 space-y-3">
            {articleStats.length > 0 ? articleStats.slice(0, 6).map((a, i) => (
              <HorizontalBar
                key={a.designation}
                label={`${a.designation} (${a.count} pc${a.count > 1 ? 's' : ''})`}
                value={a.revenue}
                maxValue={maxArticleRevenue}
                color={CHART_COLORS[(i + 3) % CHART_COLORS.length]}
                formattedValue={formatPrice(a.revenue)}
              />
            )) : (
              <div className="py-6 text-center text-slate-400 text-sm">{lang === 'fr' ? 'Aucune donnée' : 'No data'}</div>
            )}
          </div>
        </div>
      </div>

      {/* Upcoming birthdays (next 7 days) */}
      {upcomingBirthdays.length > 0 && (
        <div className="rounded-xl bg-white border border-slate-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-9 h-9 rounded-lg bg-sky-50 flex items-center justify-center">
              <CalendarClock className="w-5 h-5 text-sky-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                {lang === 'fr' ? 'Anniversaires à venir (7 jours)' : 'Upcoming birthdays (7 days)'}
              </h3>
              <p className="text-xs text-slate-400">
                {lang === 'fr' ? 'Préparez votre action commerciale' : 'Prepare your marketing action'}
              </p>
            </div>
          </div>
          <div className="space-y-2">
            {upcomingBirthdays.map((c) => {
              const bd = c.date_naissance ? new Date(c.date_naissance) : null;
              const bdLabel = bd ? bd.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long' }) : '';
              const waUrl = c.telephone
                ? `https://wa.me/${c.telephone.replace(/[^\d]/g, '')}?text=${encodeURIComponent(
                    lang === 'fr'
                      ? `Bonjour ${c.nom},\n\nVotre anniversaire approche ! Toute l'équipe de votre pressing se réjouit de vous le souhaiter.`
                      : `Hello ${c.nom},\n\nYour birthday is coming up! The whole team at your dry cleaner looks forward to wishing you well.`,
                  )}`
                : null;
              return (
                <div key={c.id} className="flex items-center justify-between bg-slate-50/70 rounded-lg px-3 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-slate-800 truncate">{c.nom}</span>
                    <span className="text-xs text-slate-400 flex-shrink-0">{bdLabel}</span>
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${
                      c.daysUntil <= 2 ? 'bg-pink-100 text-pink-600' : 'bg-sky-100 text-sky-600'
                    }`}>
                      {lang === 'fr' ? `dans ${c.daysUntil} j` : `in ${c.daysUntil} d`}
                    </span>
                  </div>
                  {waUrl && (
                    <a
                      href={waUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 text-white text-xs font-medium hover:bg-sky-600 transition-colors flex-shrink-0"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      {lang === 'fr' ? 'Contacter' : 'Contact'}
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Inactive clients */}
      {inactiveClients.length > 0 && (
        <div className="rounded-xl bg-white border border-slate-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center">
                <Users className="w-5 h-5 text-amber-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-slate-900">
                  {lang === 'fr' ? 'Clients inactifs (60+ jours)' : 'Inactive clients (60+ days)'}
                </h3>
                <p className="text-xs text-slate-400">
                  {inactiveClients.length} {lang === 'fr' ? `client${inactiveClients.length > 1 ? 's' : ''} sans visite récente` : `client${inactiveClients.length > 1 ? 's' : ''} with no recent visit`}
                </p>
              </div>
              <button
                onClick={() => { setPrintTarget('inactive'); setTimeout(() => printReport(), 50); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs font-medium hover:bg-slate-200 transition-colors flex-shrink-0"
              >
                <Printer className="w-3.5 h-3.5" />
                {lang === 'fr' ? 'Imprimer' : 'Print'}
              </button>
            </div>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {inactiveClients.slice(0, 15).map((c) => {
              return (
                <div key={c.id} className="flex items-center justify-between bg-slate-50/70 rounded-lg px-3 py-2.5">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-sm font-medium text-slate-800 truncate">{c.nom}</span>
                    <span className="text-xs text-slate-400 flex-shrink-0">
                      {c.dernier_depot
                        ? formatDateShort(c.dernier_depot)
                        : (lang === 'fr' ? 'Aucune visite' : 'No visits')}
                    </span>
                    {c.nb_depots > 0 && (
                      <span className="text-xs text-slate-400 flex-shrink-0">
                        · {c.nb_depots} {lang === 'fr' ? 'dépôts' : 'deposits'}
                      </span>
                    )}
                    {c.total_depot > 0 && (
                      <span className="text-xs font-medium text-slate-600 flex-shrink-0">
                        · {formatPrice(c.total_depot)}
                      </span>
                    )}
                  </div>
                  {c.telephone && (
                    <button
                      onClick={() => handleRelance(c.id, c.telephone, 'whatsapp')}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-medium hover:bg-emerald-600 transition-colors flex-shrink-0"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      {lang === 'fr' ? 'Relancer' : 'Reach out'}
                    </button>
                  )}
                </div>
              );
            })}
            {inactiveClients.length > 15 && (
              <p className="text-xs text-slate-400 text-center pt-1">
                {lang === 'fr' ? `+${inactiveClients.length - 15} autre${inactiveClients.length - 15 > 1 ? 's' : ''}` : `+${inactiveClients.length - 15} more`}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Relance journal */}
      {relances.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-slate-500" />
              <h2 className="text-base font-semibold text-slate-900">
                {lang === 'fr' ? 'Journal des relances' : 'Outreach journal'}
              </h2>
              <span className="text-xs text-slate-400">({relances.length})</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setPrintTarget('relances'); setTimeout(() => printReport(), 50); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs font-medium hover:bg-slate-200 transition-colors"
              >
                <Printer className="w-3.5 h-3.5" />
                {lang === 'fr' ? 'Imprimer' : 'Print'}
              </button>
              <button
                onClick={() => setShowJournal((v) => !v)}
                className="text-xs font-medium text-sky-600 hover:text-sky-700"
              >
                {showJournal ? (lang === 'fr' ? 'Réduire' : 'Collapse') : (lang === 'fr' ? 'Voir tout' : 'Expand')}
              </button>
            </div>
          </div>
          {showJournal && (
            <div className="divide-y divide-slate-50 max-h-80 overflow-y-auto">
              {relances.map((r) => (
                <div key={r.id} className="px-5 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {r.client_nom}
                      <span className="ml-2 text-xs font-normal text-slate-400">{formatDateShort(r.date_relance)}</span>
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        r.canal === 'whatsapp' ? 'bg-emerald-50 text-emerald-600' :
                        r.canal === 'telephone' ? 'bg-sky-50 text-sky-600' :
                        r.canal === 'sms' ? 'bg-amber-50 text-amber-600' :
                        'bg-slate-100 text-slate-500'
                      }`}>
                        {r.canal}
                      </span>
                      {r.note && <span className="text-xs text-slate-400 truncate">{r.note}</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteRelance(r.id)}
                    className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Recent deposits */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">{t('dash.recentDepots')}</h2>
        </div>
        {recent.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-slate-400 text-sm">{t('dash.noDepots')}</p>
            <button
              onClick={() => onNavigate('depot')}
              className="mt-3 text-sm font-medium text-sky-600 hover:text-sky-700"
            >
              {lang === 'fr' ? 'Créer le premier dépôt' : 'Create the first deposit'}
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {recent.map((depot) => (
              <div key={depot.id} className="px-5 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                      depot.statut === 'EN_COURS' ? 'bg-amber-400' : 'bg-emerald-400'
                    }`}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {depot.numero} — {depot.clients?.nom ?? (lang === 'fr' ? 'Client inconnu' : 'Unknown client')}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {formatDate(depot.date_depot)} · {getModeReglementLabel(depot.mode_reglement, modesReglement)}
                    </p>
                    {depot.date_retrait_prevue && (
                      <p className="text-xs text-sky-500 mt-0.5 flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {lang === 'fr' ? 'Retrait prévu' : 'Expected pickup'}: {formatDateShort(depot.date_retrait_prevue)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0 ml-4">
                  <p className="text-sm font-semibold text-slate-900">{formatPrice(Number(depot.total))}</p>
                  <p className={`text-xs mt-0.5 ${depot.statut === 'EN_COURS' ? 'text-amber-500' : 'text-emerald-500'}`}>
                    {depot.statut === 'EN_COURS' ? (lang === 'fr' ? 'En cours' : 'In progress') : (lang === 'fr' ? 'Retiré' : 'Picked up')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {relances.length > 0 && printTarget === 'relances' && (
        <PrintableReport data={relanceReportData} />
      )}

      {inactiveClients.length > 0 && printTarget === 'inactive' && (
        <PrintableReport data={inactiveReportData} />
      )}
    </div>
  );
}
