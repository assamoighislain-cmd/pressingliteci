import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
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
  '#0ea5e9', '#10b981', '#f97316', '#14b8a6', '#f59e0b',
  '#ec4899', '#3b82f6', '#84cc16', '#06b6d4', '#f43f5e',
];

function MiniBarChart({ data, maxVal }: { data: RevenueDay[]; maxVal: number }) {
  if (data.length === 0) return null;
  const barWidth = Math.max(5, Math.min(20, Math.floor(320 / data.length) - 2));
  const height = 120;
  const totalWidth = data.length * (barWidth + 2);

  return (
    <svg viewBox={`0 0 ${totalWidth} ${height + 22}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="dashBarSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#0284c7" />
        </linearGradient>
        <linearGradient id="dashBarToday" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fb923c" />
          <stop offset="100%" stopColor="#f97316" />
        </linearGradient>
      </defs>
      <line x1={0} y1={height} x2={totalWidth} y2={height} stroke="#e0f2fe" strokeWidth="1" />
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
              height={Math.max(barH, 2)}
              rx={3}
              fill={isToday ? 'url(#dashBarToday)' : 'url(#dashBarSky)'}
              className="transition-opacity hover:opacity-85"
            />
            {(i === 0 || i === data.length - 1 || isToday) && (
              <text
                x={x + barWidth / 2}
                y={height + 15}
                textAnchor="middle"
                className={isToday ? 'fill-orange-600 font-bold' : 'fill-slate-400 font-medium'}
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

function DonutChart({ segments, size = 128 }: { segments: { value: number; color: string; label: string }[]; size?: number }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return null;
  const radius = (size - 8) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const innerRadius = radius * 0.56;

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

        return (
          <path
            key={i}
            d={d}
            fill={seg.color}
            stroke="#ffffff"
            strokeWidth={segments.length > 1 ? 2 : 0}
            className="transition-opacity hover:opacity-85"
          />
        );
      })}
    </svg>
  );
}

function HorizontalBar({ label, value, maxValue, color, formattedValue }: {
  label: string; value: number; maxValue: number; color: string; formattedValue: string;
}) {
  const pct = maxValue > 0 ? Math.max(3, (value / maxValue) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-700 font-semibold truncate mr-2">{label}</span>
        <span className="text-slate-900 font-bold tabular-nums whitespace-nowrap">{formattedValue}</span>
      </div>
      <div className="h-2.5 bg-sky-100/70 rounded-full overflow-hidden">
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
  if (previous === 0) return <span className="text-xs font-bold text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-md">{lang === 'fr' ? 'Nouveau' : 'New'}</span>;
  const pct = Math.round(((current - previous) / previous) * 100);
  const isUp = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-bold tabular-nums px-2 py-0.5 rounded-md ${isUp ? 'text-emerald-700 bg-emerald-100/80' : 'text-rose-700 bg-rose-100/80'}`}>
      {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {isUp ? '+' : ''}{pct}%
    </span>
  );
}

export default function Dashboard({ onNavigate }: DashboardProps) {
  const { t, lang } = useI18n();
  const { role } = useAuth();
  const canOperateCounter = !role || role === 'admin' || role === 'gerant' || role === 'commercial';
  const isReadOnlyRole = role === 'associe' || role === 'comptable';
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
      iconGrad: 'from-amber-400 to-orange-500 shadow-orange-500/25',
      surface: 'hover:border-orange-200',
    },
    {
      label: lang === 'fr' ? 'Retirés' : 'Picked up',
      value: stats.retires,
      icon: CheckCircle2,
      iconGrad: 'from-emerald-400 to-teal-500 shadow-emerald-500/25',
      surface: 'hover:border-emerald-200',
    },
    {
      label: lang === 'fr' ? 'Dépôts du jour' : "Today's deposits",
      value: stats.totalJour,
      icon: Package,
      iconGrad: 'from-sky-400 to-blue-600 shadow-sky-500/25',
      surface: 'hover:border-sky-200',
    },
    {
      label: lang === 'fr' ? 'CA du jour' : "Today's revenue",
      value: formatPrice(stats.caJour),
      icon: TrendingUp,
      iconGrad: 'from-cyan-400 to-teal-600 shadow-cyan-500/25',
      surface: 'hover:border-cyan-200',
    },
    {
      label: lang === 'fr' ? 'Recette prévue du jour' : "Today's expected revenue",
      value: formatPrice(stats.recettePrevuJour),
      icon: CalendarClock,
      iconGrad: 'from-rose-400 to-orange-500 shadow-rose-500/25',
      surface: 'hover:border-rose-200',
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-9 h-9 border-[3px] border-sky-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Quick actions */}
      {canOperateCounter && (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          onClick={() => onNavigate('depot')}
          className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-sky-500 via-blue-500 to-cyan-500 p-6 text-left shadow-md shadow-sky-500/20 transition-all duration-200 hover:shadow-xl hover:shadow-sky-500/30 hover:-translate-y-0.5"
        >
          <div className="pointer-events-none absolute -top-10 -right-10 w-36 h-36 rounded-full bg-white/15 transition-transform duration-300 group-hover:scale-110" />
          <div className="pointer-events-none absolute -bottom-12 left-1/3 w-28 h-28 rounded-full bg-cyan-300/20" />
          <div className="relative flex items-center justify-between gap-4">
            <div>
              <h3 className="text-xl font-extrabold tracking-tight text-white">{t('dash.newDepot')}</h3>
              <p className="text-sm text-sky-50/95 font-medium mt-1">{lang === 'fr' ? 'Enregistrer une facture client' : 'Record a client invoice'}</p>
            </div>
            <div className="w-13 h-13 rounded-2xl bg-white/20 backdrop-blur-xs border border-white/25 flex items-center justify-center flex-shrink-0 transition-transform duration-200 group-hover:scale-110">
              <ArrowDownToLine className="w-6 h-6 text-white" />
            </div>
          </div>
        </button>

        <button
          onClick={() => onNavigate('retrait')}
          className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-500 p-6 text-left shadow-md shadow-emerald-500/20 transition-all duration-200 hover:shadow-xl hover:shadow-emerald-500/30 hover:-translate-y-0.5"
        >
          <div className="pointer-events-none absolute -top-10 -right-10 w-36 h-36 rounded-full bg-white/15 transition-transform duration-300 group-hover:scale-110" />
          <div className="pointer-events-none absolute -bottom-12 left-1/3 w-28 h-28 rounded-full bg-amber-200/20" />
          <div className="relative flex items-center justify-between gap-4">
            <div>
              <h3 className="text-xl font-extrabold tracking-tight text-white">{t('dash.retrait')}</h3>
              <p className="text-sm text-emerald-50/95 font-medium mt-1">{lang === 'fr' ? 'Vérifier et retirer un dépôt' : 'Check and pick up a deposit'}</p>
            </div>
            <div className="w-13 h-13 rounded-2xl bg-white/20 backdrop-blur-xs border border-white/25 flex items-center justify-center flex-shrink-0 transition-transform duration-200 group-hover:scale-110">
              <ArrowUpFromLine className="w-6 h-6 text-white" />
            </div>
          </div>
        </button>
      </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className={`rounded-2xl bg-white p-5 border border-sky-100/80 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 ${card.surface}`}
            >
              <div className="flex items-center justify-between mb-3.5">
                <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${card.iconGrad} shadow-sm flex items-center justify-center`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
              </div>
              <p className="text-2xl font-extrabold tracking-tight text-slate-900 tabular-nums">{card.value}</p>
              <p className="text-xs font-semibold text-slate-500 mt-1">{card.label}</p>
            </div>
          );
        })}
      </div>

      {/* Unpaid alert */}
      {unpaid.count > 0 && (
        <div className="rounded-2xl bg-gradient-to-r from-amber-50 via-orange-50/80 to-amber-50 border border-amber-200/90 p-4 flex items-center gap-3.5 shadow-xs">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center flex-shrink-0 shadow-sm shadow-orange-500/20">
            <AlertTriangle className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-amber-900">
              {lang === 'fr'
                ? `${unpaid.count} dépôt${unpaid.count > 1 ? 's' : ''} avec solde impayé`
                : `${unpaid.count} deposit${unpaid.count > 1 ? 's' : ''} with unpaid balance`}
            </p>
            <p className="text-sm text-amber-800 mt-0.5">
              {lang === 'fr' ? 'Reste à encaisser :' : 'Remaining to collect:'} <span className="font-extrabold tabular-nums">{formatPrice(unpaid.total)}</span>
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
          <div className="rounded-2xl bg-white p-5 border border-sky-100/80 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-wide text-sky-600">{lang === 'fr' ? 'CA ce mois' : 'Revenue this month'}</p>
              <PercentBadge current={monthlyComp.currentMonth} previous={monthlyComp.previousMonth} lang={lang} />
            </div>
            <p className="text-2xl font-extrabold tracking-tight text-slate-900 tabular-nums">{formatPrice(monthlyComp.currentMonth)}</p>
            <p className="text-xs text-slate-400 mt-1.5 tabular-nums">
              {lang === 'fr' ? 'Mois précédent :' : 'Previous month:'} {formatPrice(monthlyComp.previousMonth)}
            </p>
          </div>
          <div className="rounded-2xl bg-white p-5 border border-sky-100/80 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-wide text-orange-600">{lang === 'fr' ? 'Dépenses ce mois' : 'Expenses this month'}</p>
              <PercentBadge current={monthlyComp.currentExpenses} previous={monthlyComp.previousExpenses} lang={lang} />
            </div>
            <p className="text-2xl font-extrabold tracking-tight text-slate-900 tabular-nums">{formatPrice(monthlyComp.currentExpenses)}</p>
            <p className="text-xs text-slate-400 mt-1.5 tabular-nums">
              {lang === 'fr' ? 'Mois précédent :' : 'Previous month:'} {formatPrice(monthlyComp.previousExpenses)}
            </p>
          </div>
          <div className="rounded-2xl bg-white p-5 border border-sky-100/80 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-wide text-emerald-600">{lang === 'fr' ? 'Bénéfice net' : 'Net profit'}</p>
              <PercentBadge current={netCurrent} previous={netPrevious} lang={lang} />
            </div>
            <p className={`text-2xl font-extrabold tracking-tight tabular-nums ${netCurrent >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {formatPrice(netCurrent)}
            </p>
            <p className="text-xs text-slate-400 mt-1.5 tabular-nums">
              {lang === 'fr' ? 'Mois précédent :' : 'Previous month:'} {formatPrice(netPrevious)}
            </p>
          </div>
        </div>
      )}

      {/* Revenue chart + Payment breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue chart */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-sky-100/80 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-sky-100/70 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-xl bg-sky-100/80 text-sky-600 flex items-center justify-center">
                <BarChart3 className="w-4 h-4" />
              </span>
              <h2 className="text-base font-bold text-slate-900">
                {lang === 'fr' ? 'Chiffre d\'affaires — 30 jours' : 'Revenue — 30 days'}
              </h2>
            </div>
            <div className="text-right">
              <p className="text-lg font-extrabold text-slate-900 tabular-nums">{formatPrice(totalRevenue30d)}</p>
              <p className="text-xs font-medium text-slate-400 tabular-nums">{totalDeposits30d} {lang === 'fr' ? 'dépôts' : 'deposits'}</p>
            </div>
          </div>
          <div className="px-5 py-4 h-48">
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
        <div className="bg-white rounded-2xl border border-sky-100/80 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-sky-100/70 flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-xl bg-teal-100/80 text-teal-600 flex items-center justify-center">
              <PieChart className="w-4 h-4" />
            </span>
            <h2 className="text-base font-bold text-slate-900">
              {lang === 'fr' ? 'Modes de paiement' : 'Payment methods'}
            </h2>
          </div>
          <div className="px-5 py-4 flex flex-col items-center gap-3.5">
            {paymentModes.length > 0 ? (
              <>
                <DonutChart segments={donutSegments} />
                <div className="space-y-1.5 w-full">
                  {paymentModes.slice(0, 5).map((pm, i) => (
                    <div key={pm.mode} className="flex items-center gap-2 text-xs">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                      <span className="text-slate-600 font-medium truncate flex-1">{pm.mode}</span>
                      <span className="text-slate-900 font-bold tabular-nums">{formatPrice(pm.total)}</span>
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
        <div className="bg-white rounded-2xl border border-sky-100/80 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-sky-100/70 flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-xl bg-orange-100/80 text-orange-600 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </span>
            <h2 className="text-base font-bold text-slate-900">
              {lang === 'fr' ? 'Meilleurs clients' : 'Top clients'}
            </h2>
          </div>
          <div className="px-5 py-4 space-y-3.5">
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
        <div className="bg-white rounded-2xl border border-sky-100/80 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-sky-100/70 flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-xl bg-emerald-100/80 text-emerald-600 flex items-center justify-center">
              <Wallet className="w-4 h-4" />
            </span>
            <h2 className="text-base font-bold text-slate-900">
              {lang === 'fr' ? 'Articles les plus demandés' : 'Most requested items'}
            </h2>
          </div>
          <div className="px-5 py-4 space-y-3.5">
            {articleStats.length > 0 ? articleStats.slice(0, 6).map((a, i) => (
              <HorizontalBar
                key={a.designation}
                label={`${a.designation} (${a.count} pc${a.count > 1 ? 's' : ''})`}
                value={a.revenue}
                maxValue={maxArticleRevenue}
                color={CHART_COLORS[(i + 2) % CHART_COLORS.length]}
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
        <div className="rounded-2xl bg-white border border-sky-100/80 shadow-sm p-5">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-400 to-cyan-500 flex items-center justify-center shadow-sm shadow-sky-500/20">
              <CalendarClock className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
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
                <div key={c.id} className="flex items-center justify-between bg-sky-50/50 rounded-xl px-3.5 py-2.5 border border-sky-100/60">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-semibold text-slate-800 truncate">{c.nom}</span>
                    <span className="text-xs text-slate-400 flex-shrink-0">{bdLabel}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-md flex-shrink-0 ${
                      c.daysUntil <= 2 ? 'bg-pink-100 text-pink-600' : 'bg-sky-100 text-sky-700'
                    }`}>
                      {lang === 'fr' ? `dans ${c.daysUntil} j` : `in ${c.daysUntil} d`}
                    </span>
                  </div>
                  {waUrl && (
                    <a
                      href={waUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-sky-500 to-teal-500 text-white text-xs font-bold hover:from-sky-600 hover:to-teal-600 transition-all shadow-xs flex-shrink-0"
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
        <div className="rounded-2xl bg-white border border-sky-100/80 shadow-sm p-5">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-sm shadow-orange-500/20">
                <Users className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-bold text-slate-900">
                  {lang === 'fr' ? 'Clients inactifs (60+ jours)' : 'Inactive clients (60+ days)'}
                </h3>
                <p className="text-xs text-slate-400">
                  {inactiveClients.length} {lang === 'fr' ? `client${inactiveClients.length > 1 ? 's' : ''} sans visite récente` : `client${inactiveClients.length > 1 ? 's' : ''} with no recent visit`}
                </p>
              </div>
              <button
                onClick={() => { setPrintTarget('inactive'); setTimeout(() => printReport(), 50); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-50 text-sky-700 border border-sky-200/70 text-xs font-semibold hover:bg-sky-100 transition-colors flex-shrink-0"
              >
                <Printer className="w-3.5 h-3.5" />
                {lang === 'fr' ? 'Imprimer' : 'Print'}
              </button>
            </div>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {inactiveClients.slice(0, 15).map((c) => {
              return (
                <div key={c.id} className="flex items-center justify-between bg-sky-50/40 border border-sky-100/50 rounded-xl px-3.5 py-2.5">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-sm font-semibold text-slate-800 truncate">{c.nom}</span>
                    <span className="text-xs text-slate-400 flex-shrink-0">
                      {c.dernier_depot
                        ? formatDateShort(c.dernier_depot)
                        : (lang === 'fr' ? 'Aucune visite' : 'No visits')}
                    </span>
                    {c.nb_depots > 0 && (
                      <span className="text-xs text-slate-400 flex-shrink-0 tabular-nums">
                        · {c.nb_depots} {lang === 'fr' ? 'dépôts' : 'deposits'}
                      </span>
                    )}
                    {c.total_depot > 0 && (
                      <span className="text-xs font-bold text-slate-700 flex-shrink-0 tabular-nums">
                        · {formatPrice(c.total_depot)}
                      </span>
                    )}
                  </div>
                  {c.telephone && !isReadOnlyRole && (
                    <button
                      onClick={() => handleRelance(c.id, c.telephone, 'whatsapp')}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-xs font-bold hover:from-emerald-600 hover:to-teal-600 transition-all shadow-xs flex-shrink-0"
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
        <div className="bg-white rounded-2xl border border-sky-100/80 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-sky-100/70 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-xl bg-cyan-100/80 text-cyan-700 flex items-center justify-center">
                <History className="w-4 h-4" />
              </span>
              <h2 className="text-base font-bold text-slate-900">
                {lang === 'fr' ? 'Journal des relances' : 'Outreach journal'}
              </h2>
              <span className="text-xs font-semibold text-slate-400 tabular-nums">({relances.length})</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setPrintTarget('relances'); setTimeout(() => printReport(), 50); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-50 text-sky-700 border border-sky-200/70 text-xs font-semibold hover:bg-sky-100 transition-colors"
              >
                <Printer className="w-3.5 h-3.5" />
                {lang === 'fr' ? 'Imprimer' : 'Print'}
              </button>
              <button
                onClick={() => setShowJournal((v) => !v)}
                className="text-xs font-bold text-sky-600 hover:text-sky-700"
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
                  {!isReadOnlyRole && (
                    <button
                      onClick={() => handleDeleteRelance(r.id)}
                      className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Recent deposits */}
      <div className="bg-white rounded-2xl border border-sky-100/80 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-sky-100/70 flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-xl bg-sky-100/80 text-sky-600 flex items-center justify-center">
            <Package className="w-4 h-4" />
          </span>
          <h2 className="text-base font-bold text-slate-900">{t('dash.recentDepots')}</h2>
        </div>
        {recent.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-slate-400 text-sm">{t('dash.noDepots')}</p>
            {canOperateCounter && (
              <button
                onClick={() => onNavigate('depot')}
                className="mt-3 px-4 py-2 rounded-xl bg-sky-500 text-white text-sm font-semibold hover:bg-sky-600 transition-colors"
              >
                {lang === 'fr' ? 'Créer le premier dépôt' : 'Create the first deposit'}
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-sky-50">
            {recent.map((depot) => (
              <div key={depot.id} className="px-5 py-4 flex items-center justify-between hover:bg-sky-50/40 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                      depot.statut === 'EN_COURS' ? 'bg-orange-400' : 'bg-emerald-500'
                    }`}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">
                      {depot.numero} — {depot.clients?.nom ?? (lang === 'fr' ? 'Client inconnu' : 'Unknown client')}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {formatDate(depot.date_depot)} · {getModeReglementLabel(depot.mode_reglement, modesReglement)}
                    </p>
                    {depot.date_retrait_prevue && (
                      <p className="text-xs text-sky-600 font-medium mt-0.5 flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {lang === 'fr' ? 'Retrait prévu' : 'Expected pickup'}: {formatDateShort(depot.date_retrait_prevue)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0 ml-4">
                  <p className="text-sm font-extrabold text-slate-900 tabular-nums">{formatPrice(Number(depot.total))}</p>
                  <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-md mt-1 ${
                    depot.statut === 'EN_COURS'
                      ? 'bg-orange-100/80 text-orange-700'
                      : 'bg-emerald-100/80 text-emerald-700'
                  }`}>
                    {depot.statut === 'EN_COURS' ? (lang === 'fr' ? 'En cours' : 'In progress') : (lang === 'fr' ? 'Retiré' : 'Picked up')}
                  </span>
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
