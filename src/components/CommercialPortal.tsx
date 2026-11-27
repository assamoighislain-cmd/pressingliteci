import { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/db';
import { useI18n } from '@/lib/i18n';
import {
  CommercialPortalBranding,
  CommercialPortalData,
  formatPrice,
  formatDateShort,
} from '@/types';
import {
  Briefcase,
  KeyRound,
  LogOut,
  RefreshCw,
  Search,
  Users,
  FileText,
  Wallet,
  ArrowLeft,
  AlertCircle,
  Calendar,
  Phone,
  Mail,
  Loader2,
  Building2,
} from 'lucide-react';

interface CommercialPortalProps {
  entrepriseId?: number | null;
}

type PortalTab = 'overview' | 'clients' | 'factures' | 'versements';

function isSafeImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  return (
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('/')
  );
}

export default function CommercialPortal({ entrepriseId = null }: CommercialPortalProps) {
  const { lang } = useI18n();

  // Branding when accessed via /#/commercial/:entrepriseId
  const [branding, setBranding] = useState<CommercialPortalBranding | null>(null);

  // Code authentication state (kept strictly in memory — never persisted to localStorage)
  const [codeInput, setCodeInput] = useState('');
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const [portalData, setPortalData] = useState<CommercialPortalData | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dashboard UI state
  const [tab, setTab] = useState<PortalTab>('overview');
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState<'all' | 'active' | 'expired'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    if (!entrepriseId) {
      setBranding(null);
      return;
    }
    let cancelled = false;
    void db.getCommercialPortalBranding(entrepriseId).then((b) => {
      if (!cancelled) setBranding(b);
    });
    return () => {
      cancelled = true;
    };
  }, [entrepriseId]);

  async function fetchPortal(rawCode: string, isRefresh = false) {
    const clean = rawCode.trim().toUpperCase();
    if (clean.length < 4) {
      setError(
        lang === 'fr'
          ? "Veuillez saisir votre code apporteur d'affaire (ex: COM-A1B2C3D4)."
          : 'Please enter your referral partner code (e.g. COM-A1B2C3D4).',
      );
      return;
    }

    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const res = await db.getCommercialPortalData(clean, entrepriseId);
      if (res.error || !res.data) {
        setError(res.error ?? (lang === 'fr' ? 'Code invalide ou compte inactif.' : 'Invalid code or inactive account.'));
        if (!isRefresh) {
          setPortalData(null);
          setActiveCode(null);
        }
        return;
      }
      setPortalData(res.data);
      setActiveCode(clean);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  function handleSubmitCode(e: React.FormEvent) {
    e.preventDefault();
    void fetchPortal(codeInput, false);
  }

  function handleSignOut() {
    setPortalData(null);
    setActiveCode(null);
    setCodeInput('');
    setError(null);
    setTab('overview');
    setSearch('');
    setDateFrom('');
    setDateTo('');
  }

  function handleReturnToApp() {
    window.location.hash = '';
  }

  const filteredClients = useMemo(() => {
    if (!portalData) return [];
    const q = search.trim().toLowerCase();
    return portalData.clients.filter((c) => {
      if (clientFilter === 'active' && !c.est_actif_periode) return false;
      if (clientFilter === 'expired' && c.est_actif_periode) return false;
      if (!q) return true;
      return (
        c.client_nom.toLowerCase().includes(q) ||
        (c.client_code ?? '').toLowerCase().includes(q) ||
        (c.client_telephone ?? '').toLowerCase().includes(q)
      );
    });
  }, [portalData, search, clientFilter]);

  const filteredFactures = useMemo(() => {
    if (!portalData) return [];
    const q = search.trim().toLowerCase();
    return portalData.factures.filter((f) => {
      const d = (f.date_depot ?? '').slice(0, 10);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      if (!q) return true;
      return (
        (f.numero ?? '').toLowerCase().includes(q) ||
        f.client_nom.toLowerCase().includes(q)
      );
    });
  }, [portalData, search, dateFrom, dateTo]);

  const filteredVersements = useMemo(() => {
    if (!portalData) return [];
    const q = search.trim().toLowerCase();
    return portalData.versements.filter((v) => {
      const d = (v.date_versement ?? '').slice(0, 10);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      if (!q) return true;
      return (
        (v.reference ?? '').toLowerCase().includes(q) ||
        (v.mode_reglement ?? '').toLowerCase().includes(q) ||
        (v.notes ?? '').toLowerCase().includes(q)
      );
    });
  }, [portalData, search, dateFrom, dateTo]);

  // ─── 1. CODE SIGN-IN SCREEN ────────────────────────────────────────────────
  if (!portalData) {
    const headerBrand = branding;
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <header className="border-b border-slate-200 bg-white">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              {headerBrand && isSafeImageUrl(headerBrand.logo_url) ? (
                <img
                  src={headerBrand.logo_url!}
                  alt={headerBrand.nom}
                  className="w-8 h-8 rounded-lg object-cover border border-slate-200 flex-shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center flex-shrink-0">
                  <Briefcase className="w-4 h-4" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">
                  {headerBrand?.nom || 'PressingLite'}
                </p>
                <p className="text-xs text-slate-500 truncate">
                  {lang === 'fr' ? "Portail Apporteur d'affaire" : 'Partner Portal'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleReturnToApp}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              {lang === 'fr' ? 'Espace Pressing' : 'Staff Login'}
            </button>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center px-4 py-12">
          <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 p-6 sm:p-8 space-y-6">
            <div className="space-y-2">
              <div className="w-11 h-11 rounded-lg bg-sky-50 border border-sky-200/70 text-sky-700 flex items-center justify-center">
                <KeyRound className="w-5 h-5" />
              </div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">
                {lang === 'fr' ? "Accès Portail Apporteur d'affaire" : 'Partner Portal Access'}
              </h1>
              <p className="text-sm text-slate-500 leading-relaxed">
                {lang === 'fr'
                  ? 'Saisissez votre code personnel pour suivre vos clients rattachés, vos factures commissionnées et vos versements.'
                  : 'Enter your personal access code to track linked clients, commissionable invoices, and payouts.'}
              </p>
            </div>

            {headerBrand && (
              <div className="rounded-lg bg-slate-50 border border-slate-200/80 px-3.5 py-2.5 flex items-center gap-2.5">
                <Building2 className="w-4 h-4 text-slate-400 flex-shrink-0" />
                <div className="min-w-0 text-xs">
                  <p className="font-semibold text-slate-800 truncate">{headerBrand.nom}</p>
                  {(headerBrand.ville || headerBrand.telephone) && (
                    <p className="text-slate-500 truncate">
                      {[headerBrand.ville, headerBrand.telephone].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
              </div>
            )}

            <form onSubmit={handleSubmitCode} className="space-y-4">
              <div>
                <label htmlFor="commercial-portal-code" className="block text-sm font-medium text-slate-700 mb-1.5">
                  {lang === 'fr' ? "Code apporteur d'affaire" : 'Access code'}
                </label>
                <input
                  id="commercial-portal-code"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                  placeholder="COM-XXXXXXXX"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 font-mono text-base tracking-wider uppercase placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                />
              </div>

              {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3.5 py-2.5 flex items-start gap-2 text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || codeInput.trim().length < 4}
                className="w-full px-4 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {lang === 'fr' ? 'Consulter mon compte' : 'Open my account'}
              </button>
            </form>

            <p className="text-xs text-slate-400 leading-relaxed pt-2 border-t border-slate-100">
              {lang === 'fr'
                ? "Code oublié ? Demandez votre code personnel ou votre lien d'accès au gérant de votre entreprise."
                : 'Forgot your code? Ask your company manager for your personal portal code or link.'}
            </p>
          </div>
        </main>
      </div>
    );
  }

  // ─── 2. AUTHENTICATED COMMERCIAL DASHBOARD ─────────────────────────────────
  const { commercial, entreprise, summary, clients, factures, versements } = portalData;
  const companyInfo = entreprise ?? branding;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {companyInfo && isSafeImageUrl(companyInfo.logo_url) ? (
              <img
                src={companyInfo.logo_url!}
                alt={companyInfo.nom}
                className="w-9 h-9 rounded-lg object-cover border border-slate-200 flex-shrink-0"
              />
            ) : (
              <div className="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center flex-shrink-0">
                <Briefcase className="w-4 h-4" />
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="truncate font-medium text-slate-600">{companyInfo?.nom || 'PressingLite'}</span>
                <span>/</span>
                <span className="whitespace-nowrap">{lang === 'fr' ? "Portail Apporteur d'affaire" : 'Partner Portal'}</span>
              </div>
              <p className="text-sm sm:text-base font-bold text-slate-900 truncate">
                {commercial.nom}
                <span className="font-mono text-xs font-medium text-slate-500 ml-2 tabular-nums">
                  {commercial.taux_commission} % · {commercial.portal_code}
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => activeCode && void fetchPortal(activeCode, true)}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{lang === 'fr' ? 'Actualiser' : 'Refresh'}</span>
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:text-red-600 hover:border-red-200 hover:bg-red-50/60 transition-colors whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{lang === 'fr' ? 'Déconnexion' : 'Sign out'}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 flex items-center gap-2.5 text-sm text-red-700">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* 4-Column KPI Strip — flat hairline borders, tabular numerals */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-medium text-slate-500">
              {lang === 'fr' ? 'Commissions générées' : 'Earned commissions'}
            </p>
            <p className="mt-2 text-2xl font-bold text-sky-700 tabular-nums">
              {formatPrice(summary.commissions_dues)}
            </p>
            <p className="mt-1 text-xs text-slate-500 tabular-nums">
              {summary.nb_factures} {lang === 'fr' ? 'factures' : 'invoices'} · CA {formatPrice(summary.chiffre_affaires)}
            </p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-medium text-slate-500">
              {lang === 'fr' ? 'Commissions déjà versées' : 'Paid out'}
            </p>
            <p className="mt-2 text-2xl font-bold text-emerald-700 tabular-nums">
              {formatPrice(summary.commissions_versees)}
            </p>
            <p className="mt-1 text-xs text-slate-500 tabular-nums">
              {versements.length} {lang === 'fr' ? 'versement(s) reçu(s)' : 'payout(s) received'}
            </p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-medium text-slate-500">
              {lang === 'fr' ? 'Solde à percevoir' : 'Balance remaining'}
            </p>
            <p className={`mt-2 text-2xl font-bold tabular-nums ${summary.solde_a_payer > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
              {formatPrice(summary.solde_a_payer)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {summary.solde_a_payer > 0
                ? (lang === 'fr' ? 'En attente de règlement' : 'Pending settlement')
                : (lang === 'fr' ? 'Compte soldé' : 'Fully settled')}
            </p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-medium text-slate-500">
              {lang === 'fr' ? 'Clients rattachés' : 'Linked clients'}
            </p>
            <p className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">
              {summary.clients_actifs}
              <span className="text-sm font-normal text-slate-400 ml-1.5">/ {summary.total_clients}</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {lang === 'fr' ? 'Actifs sur leur période en cours' : 'Active within current period'}
            </p>
          </div>
        </section>

        {/* Navigation Tabs + Filters */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg self-start overflow-x-auto max-w-full">
            <button
              type="button"
              onClick={() => setTab('overview')}
              className={`px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                tab === 'overview' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {lang === 'fr' ? "Vue d'ensemble" : 'Overview'}
            </button>
            <button
              type="button"
              onClick={() => setTab('clients')}
              className={`px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                tab === 'clients' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {lang === 'fr' ? `Mes clients (${clients.length})` : `My clients (${clients.length})`}
            </button>
            <button
              type="button"
              onClick={() => setTab('factures')}
              className={`px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                tab === 'factures' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {lang === 'fr' ? `Factures (${factures.length})` : `Invoices (${factures.length})`}
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
          </div>

          {tab !== 'overview' && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 sm:flex-initial sm:w-56">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={lang === 'fr' ? 'Rechercher…' : 'Search…'}
                  className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              {tab === 'clients' && (
                <select
                  value={clientFilter}
                  onChange={(e) => setClientFilter(e.target.value as 'all' | 'active' | 'expired')}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="all">{lang === 'fr' ? 'Toutes les périodes' : 'All periods'}</option>
                  <option value="active">{lang === 'fr' ? 'Périodes actives' : 'Active periods'}</option>
                  <option value="expired">{lang === 'fr' ? 'Périodes expirées' : 'Expired periods'}</option>
                </select>
              )}

              {(tab === 'factures' || tab === 'versements') && (
                <>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </>
              )}
            </div>
          )}
        </div>

        {/* ─── TAB: OVERVIEW ─── */}
        {tab === 'overview' && (
          <div className="space-y-6">
            {/* Profile strip */}
            <div className="bg-white rounded-xl border border-slate-200 px-5 py-4 flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-500">
                  {lang === 'fr' ? "Profil apporteur d'affaire" : 'Partner profile'}
                </p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-700">
                  <span className="font-semibold text-slate-900">{commercial.nom}</span>
                  {commercial.telephone && (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                      <Phone className="w-3.5 h-3.5" />
                      {commercial.telephone}
                    </span>
                  )}
                  {commercial.email && (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                      <Mail className="w-3.5 h-3.5" />
                      {commercial.email}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-500">{lang === 'fr' ? 'Taux par défaut' : 'Default rate'}</p>
                <p className="text-lg font-bold font-mono text-slate-900 tabular-nums">{commercial.taux_commission} %</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Recent Invoices */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-slate-400" />
                    {lang === 'fr' ? 'Dernières factures commissionnées' : 'Recent commissionable invoices'}
                  </h2>
                  {factures.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setTab('factures')}
                      className="text-xs font-medium text-sky-700 hover:underline"
                    >
                      {lang === 'fr' ? 'Tout voir' : 'View all'}
                    </button>
                  )}
                </div>
                {factures.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-500">
                    {lang === 'fr' ? 'Aucune facture commissionnée pour le moment.' : 'No commissionable invoices yet.'}
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {factures.slice(0, 6).map((f) => (
                      <div key={f.id} className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-slate-50/70">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">{f.client_nom}</p>
                          <p className="text-xs text-slate-500 tabular-nums">
                            {f.numero ?? '—'} · {formatDateShort(f.date_depot)} · {formatPrice(f.total)}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-semibold text-sky-700 tabular-nums">
                            +{formatPrice(f.commission_montant)}
                          </p>
                          <p className="text-xs font-mono text-slate-400 tabular-nums">{f.commission_taux} %</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recent Payouts */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-slate-400" />
                    {lang === 'fr' ? 'Derniers versements reçus' : 'Recent payouts'}
                  </h2>
                  {versements.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setTab('versements')}
                      className="text-xs font-medium text-sky-700 hover:underline"
                    >
                      {lang === 'fr' ? 'Tout voir' : 'View all'}
                    </button>
                  )}
                </div>
                {versements.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-500">
                    {lang === 'fr' ? 'Aucun versement enregistré pour le moment.' : 'No payouts recorded yet.'}
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {versements.slice(0, 6).map((v) => (
                      <div key={v.id} className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-slate-50/70">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 tabular-nums">
                            {formatDateShort(v.date_versement)}
                          </p>
                          <p className="text-xs text-slate-500 truncate">
                            {[v.mode_reglement, v.reference ? `Réf: ${v.reference}` : null, v.notes].filter(Boolean).join(' · ') || '—'}
                          </p>
                        </div>
                        <p className="text-sm font-bold text-emerald-700 tabular-nums flex-shrink-0">
                          {formatPrice(v.montant)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Active Linked Clients Preview */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Users className="w-4 h-4 text-slate-400" />
                  {lang === 'fr' ? 'Clients rattachés & périodes actives' : 'Linked clients & active periods'}
                </h2>
                {clients.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setTab('clients')}
                    className="text-xs font-medium text-sky-700 hover:underline"
                  >
                    {lang === 'fr' ? `Gérer la vue (${clients.length})` : `View all (${clients.length})`}
                  </button>
                )}
              </div>
              {clients.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  {lang === 'fr'
                    ? "Aucun client n'est encore rattaché à votre compte pour une période prédéfinie."
                    : 'No clients are currently linked to your account.'}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-left text-xs font-semibold text-slate-500">
                        <th className="py-2.5 px-4">{lang === 'fr' ? 'Client' : 'Client'}</th>
                        <th className="py-2.5 px-4">{lang === 'fr' ? 'Période couverte' : 'Coverage period'}</th>
                        <th className="py-2.5 px-4">{lang === 'fr' ? 'Statut' : 'Status'}</th>
                        <th className="py-2.5 px-4 text-right">{lang === 'fr' ? 'Factures' : 'Invoices'}</th>
                        <th className="py-2.5 px-4 text-right">{lang === 'fr' ? 'Commission' : 'Commission'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {clients.slice(0, 6).map((c) => (
                        <tr key={c.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-4">
                            <p className="font-medium text-slate-900">{c.client_nom}</p>
                            <p className="text-xs text-slate-500">
                              {[c.client_code, c.client_telephone].filter(Boolean).join(' · ') || '—'}
                            </p>
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                            {formatDateShort(c.date_debut)} → {formatDateShort(c.date_fin)} · {c.duree_jours} j
                          </td>
                          <td className="py-3 px-4 text-xs font-medium whitespace-nowrap">
                            {c.est_actif_periode ? (
                              <span className="text-emerald-700 tabular-nums">
                                {lang === 'fr'
                                  ? `Actif · ${c.jours_restants === 0 ? 'dernier jour' : `${c.jours_restants} j restant${c.jours_restants > 1 ? 's' : ''}`}`
                                  : `Active · ${c.jours_restants}d left`}
                              </span>
                            ) : (
                              <span className="text-slate-400">
                                {lang === 'fr' ? 'Période terminée' : 'Ended'}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums text-slate-700">{c.nb_factures}</td>
                          <td className="py-3 px-4 text-right font-semibold text-sky-700 tabular-nums whitespace-nowrap">
                            {formatPrice(c.commissions_generees)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── TAB: MES CLIENTS ─── */}
        {tab === 'clients' && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            {filteredClients.length === 0 ? (
              <div className="py-14 px-6 text-center space-y-2">
                <Users className="w-9 h-9 text-slate-300 mx-auto" />
                <p className="text-sm font-medium text-slate-700">
                  {lang === 'fr' ? 'Aucun client correspondant.' : 'No matching clients.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-left text-xs font-semibold text-slate-500">
                      <th className="py-3 px-4">{lang === 'fr' ? 'Client' : 'Client'}</th>
                      <th className="py-3 px-4">{lang === 'fr' ? 'Période' : 'Period'}</th>
                      <th className="py-3 px-4">{lang === 'fr' ? 'Statut' : 'Status'}</th>
                      <th className="py-3 px-4 text-right">{lang === 'fr' ? 'Taux' : 'Rate'}</th>
                      <th className="py-3 px-4 text-right">{lang === 'fr' ? 'Factures' : 'Invoices'}</th>
                      <th className="py-3 px-4 text-right">{lang === 'fr' ? 'CA généré' : 'Revenue'}</th>
                      <th className="py-3 px-4 text-right">{lang === 'fr' ? 'Commissions' : 'Commissions'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredClients.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4">
                          <p className="font-semibold text-slate-900">{c.client_nom}</p>
                          <p className="text-xs text-slate-500">
                            {[c.client_code, c.client_telephone].filter(Boolean).join(' · ') || '—'}
                          </p>
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5 text-slate-400" />
                            {formatDateShort(c.date_debut)} → {formatDateShort(c.date_fin)}
                          </span>
                          <span className="text-slate-400 ml-1.5">({c.duree_jours} j)</span>
                        </td>
                        <td className="py-3 px-4 text-xs font-medium whitespace-nowrap">
                          {c.est_actif_periode ? (
                            <span className={c.jours_restants <= 5 ? 'text-amber-700 tabular-nums' : 'text-emerald-700 tabular-nums'}>
                              {lang === 'fr'
                                ? `Actif · ${c.jours_restants === 0 ? 'dernier jour' : `${c.jours_restants} j restant${c.jours_restants > 1 ? 's' : ''}`}`
                                : `Active · ${c.jours_restants}d left`}
                            </span>
                          ) : (
                            <span className="text-slate-400">
                              {lang === 'fr' ? 'Expiré' : 'Expired'}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                          {c.taux_commission} %
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums text-slate-700">{c.nb_factures}</td>
                        <td className="py-3 px-4 text-right tabular-nums text-slate-700 whitespace-nowrap">
                          {formatPrice(c.chiffre_affaires)}
                        </td>
                        <td className="py-3 px-4 text-right font-semibold text-sky-700 tabular-nums whitespace-nowrap">
                          {formatPrice(c.commissions_generees)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ─── TAB: FACTURES ─── */}
        {tab === 'factures' && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            {filteredFactures.length === 0 ? (
              <div className="py-14 px-6 text-center space-y-2">
                <FileText className="w-9 h-9 text-slate-300 mx-auto" />
                <p className="text-sm font-medium text-slate-700">
                  {lang === 'fr' ? 'Aucune facture trouvée pour ces critères.' : 'No invoices found for these filters.'}
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
                      <th className="py-3 px-4 text-right">{lang === 'fr' ? 'Montant facture' : 'Invoice total'}</th>
                      <th className="py-3 px-4 text-right">{lang === 'fr' ? 'Taux' : 'Rate'}</th>
                      <th className="py-3 px-4 text-right">{lang === 'fr' ? 'Commission' : 'Commission'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredFactures.map((f) => (
                      <tr key={f.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4 tabular-nums text-slate-600 whitespace-nowrap">
                          {formatDateShort(f.date_depot)}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-800 whitespace-nowrap">
                          {f.numero ?? '—'}
                        </td>
                        <td className="py-3 px-4 text-slate-800">{f.client_nom}</td>
                        <td className="py-3 px-4 text-right tabular-nums text-slate-700 whitespace-nowrap">
                          {formatPrice(f.total)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-slate-600 whitespace-nowrap">
                          {f.commission_taux} %
                        </td>
                        <td className="py-3 px-4 text-right font-semibold tabular-nums text-sky-700 whitespace-nowrap">
                          {formatPrice(f.commission_montant)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-200 bg-slate-50/70 font-semibold text-slate-900">
                      <td colSpan={3} className="py-3 px-4 text-right text-xs text-slate-500">
                        {lang === 'fr' ? 'Total affiché' : 'Displayed total'} ({filteredFactures.length})
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                        {formatPrice(filteredFactures.reduce((s, f) => s + Number(f.total ?? 0), 0))}
                      </td>
                      <td />
                      <td className="py-3 px-4 text-right tabular-nums text-sky-700 whitespace-nowrap">
                        {formatPrice(filteredFactures.reduce((s, f) => s + Number(f.commission_montant ?? 0), 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ─── TAB: VERSEMENTS ─── */}
        {tab === 'versements' && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            {filteredVersements.length === 0 ? (
              <div className="py-14 px-6 text-center space-y-2">
                <Wallet className="w-9 h-9 text-slate-300 mx-auto" />
                <p className="text-sm font-medium text-slate-700">
                  {lang === 'fr' ? 'Aucun versement trouvé.' : 'No payouts found.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-left text-xs font-semibold text-slate-500">
                      <th className="py-3 px-4">{lang === 'fr' ? 'Date' : 'Date'}</th>
                      <th className="py-3 px-4">{lang === 'fr' ? 'Période couverte' : 'Covered period'}</th>
                      <th className="py-3 px-4">{lang === 'fr' ? 'Mode & Référence' : 'Method & Ref'}</th>
                      <th className="py-3 px-4 text-right">{lang === 'fr' ? 'Montant versé' : 'Amount paid'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredVersements.map((v) => {
                      const periodStr =
                        v.periode_debut || v.periode_fin
                          ? `${v.periode_debut ? formatDateShort(v.periode_debut) : '…'} → ${v.periode_fin ? formatDateShort(v.periode_fin) : '…'}`
                          : '—';
                      const details = [v.mode_reglement, v.reference ? `Réf: ${v.reference}` : null, v.notes].filter(Boolean);
                      return (
                        <tr key={v.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-4 tabular-nums text-slate-700 whitespace-nowrap">
                            {formatDateShort(v.date_versement)}
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-500 tabular-nums whitespace-nowrap">
                            {periodStr}
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-600">
                            {details.length > 0 ? details.join(' · ') : '—'}
                          </td>
                          <td className="py-3 px-4 text-right font-bold text-emerald-700 tabular-nums whitespace-nowrap">
                            {formatPrice(v.montant)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-200 bg-slate-50/70 font-semibold text-slate-900">
                      <td colSpan={3} className="py-3 px-4 text-right text-xs text-slate-500">
                        {lang === 'fr' ? 'Total versé affiché' : 'Displayed total paid'} ({filteredVersements.length})
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums text-emerald-700 whitespace-nowrap">
                        {formatPrice(filteredVersements.reduce((s, v) => s + Number(v.montant ?? 0), 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
