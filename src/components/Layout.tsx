import { useState, useEffect, useRef } from 'react';
import { db } from '@/lib/db';
import { supabase } from '@/lib/supabase';
import { useI18n, type Lang } from '@/lib/i18n';
import { Package, ArrowDownToLine, ArrowUpFromLine, LayoutDashboard, BookOpen, Receipt, Building2, CalendarDays, Menu, X, Phone, Users, Download, History, Wallet, LogOut, UserCog, ShieldCheck, Calculator, Receipt as ReceiptIcon, Presentation as PresentationIcon, CreditCard, KeyRound, Lock, Loader2, Globe, Store, ChevronDown, Check, Truck, BellRing, ShoppingBag, WifiOff, Wifi, Share, Smartphone, Monitor, CheckCircle2, Ticket, PackageOpen, PackageSearch, Plus, RefreshCw, AlertTriangle, Trash2, Database, Clock, ClipboardList, Briefcase } from 'lucide-react';
import { Entreprise } from '@/types';
import { usePwaInstall } from '@/hooks/usePwaInstall';
import { usePushNotifications, notifyCompanyDemoLicencePush, playApprovalSound } from '@/hooks/usePushNotifications';
import { useOfflineStatus } from '@/hooks/useOfflineStatus';
import { enableAutoSync } from '@/lib/offlineQueue';
import { getLastCacheRefreshAt } from '@/lib/readCache';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { useAuth } from '@/lib/auth';

function playPickupSound() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const now = ctx.currentTime;
    const notes = [880, 1108.73, 1318.51];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      const start = now + i * 0.15;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.3, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25);
      osc.start(start);
      osc.stop(start + 0.3);
    });
  } catch {
    // AudioContext not available
  }
}

function playOrderSound() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const now = ctx.currentTime;
    const notes = [659.25, 783.99, 987.77, 1318.51];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'triangle';
      const start = now + i * 0.12;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
      osc.start(start);
      osc.stop(start + 0.25);
    });
  } catch {
    // AudioContext not available
  }
}

export type View = 'dashboard' | 'depot' | 'retrait' | 'planning' | 'historique' | 'journal_depots' | 'journal' | 'comptabilite' | 'depenses' | 'commerciaux' | 'clients' | 'catalogue' | 'releve' | 'entreprise' | 'utilisateurs' | 'superadmin' | 'presentation' | 'modes_reglement' | 'boutiques' | 'commande' | 'collecte' | 'livraison' | 'bons_reduction' | 'consommables' | 'inventaire';

interface LayoutProps {
  currentView: View;
  onNavigate: (view: View) => void;
  children: React.ReactNode;
}

type NavGroup = 'ops' | 'finance' | 'clients' | 'admin';

interface NavItemConfig {
  id: View;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  group: NavGroup;
  tintBg: string;
  tintText: string;
}

const NAV_GROUPS: { id: NavGroup; fr: string; en: string }[] = [
  { id: 'ops', fr: 'Opérations', en: 'Operations' },
  { id: 'finance', fr: 'Suivi & Finances', en: 'Tracking & Finance' },
  { id: 'clients', fr: 'Clients & Stock', en: 'Clients & Catalog' },
  { id: 'admin', fr: 'Administration', en: 'Administration' },
];

const NAV_ITEMS: NavItemConfig[] = [
  { id: 'dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard, group: 'ops', tintBg: 'bg-sky-100/80', tintText: 'text-sky-600' },
  { id: 'depot', labelKey: 'nav.depot', icon: ArrowDownToLine, group: 'ops', tintBg: 'bg-orange-100/80', tintText: 'text-orange-600' },
  { id: 'retrait', labelKey: 'nav.retrait', icon: ArrowUpFromLine, group: 'ops', tintBg: 'bg-emerald-100/80', tintText: 'text-emerald-600' },
  { id: 'commande', labelKey: 'nav.commande', icon: ShoppingBag, group: 'ops', tintBg: 'bg-cyan-100/80', tintText: 'text-cyan-600' },
  { id: 'collecte', labelKey: 'nav.collecte', icon: Truck, group: 'ops', tintBg: 'bg-amber-100/80', tintText: 'text-amber-600' },
  { id: 'livraison', labelKey: 'nav.livraison', icon: Truck, group: 'ops', tintBg: 'bg-teal-100/80', tintText: 'text-teal-600' },
  { id: 'planning', labelKey: 'nav.planning', icon: CalendarDays, group: 'ops', tintBg: 'bg-blue-100/80', tintText: 'text-blue-600' },
  { id: 'historique', labelKey: 'nav.historique', icon: History, group: 'finance', tintBg: 'bg-sky-100/80', tintText: 'text-sky-600' },
  { id: 'journal_depots', labelKey: 'nav.journalDepots', icon: ClipboardList, group: 'finance', tintBg: 'bg-teal-100/80', tintText: 'text-teal-600' },
  { id: 'journal', labelKey: 'nav.journal', icon: Wallet, group: 'finance', tintBg: 'bg-emerald-100/80', tintText: 'text-emerald-600' },
  { id: 'comptabilite', labelKey: 'nav.comptabilite', icon: Calculator, group: 'finance', tintBg: 'bg-cyan-100/80', tintText: 'text-cyan-700' },
  { id: 'depenses', labelKey: 'nav.depenses', icon: ReceiptIcon, group: 'finance', tintBg: 'bg-rose-100/80', tintText: 'text-rose-600' },
  { id: 'commerciaux', labelKey: 'nav.commerciaux', icon: Briefcase, group: 'finance', tintBg: 'bg-amber-100/80', tintText: 'text-amber-700' },
  { id: 'releve', labelKey: 'nav.releve', icon: Receipt, group: 'finance', tintBg: 'bg-amber-100/80', tintText: 'text-amber-600' },
  { id: 'clients', labelKey: 'nav.clients', icon: Users, group: 'clients', tintBg: 'bg-orange-100/80', tintText: 'text-orange-600' },
  { id: 'catalogue', labelKey: 'nav.catalogue', icon: BookOpen, group: 'clients', tintBg: 'bg-sky-100/80', tintText: 'text-sky-600' },
  { id: 'modes_reglement', labelKey: 'nav.modesReglement', icon: CreditCard, group: 'clients', tintBg: 'bg-emerald-100/80', tintText: 'text-emerald-600' },
  { id: 'bons_reduction', labelKey: 'nav.bons', icon: Ticket, group: 'clients', tintBg: 'bg-pink-100/80', tintText: 'text-pink-600' },
  { id: 'inventaire', labelKey: 'nav.inventaire', icon: PackageSearch, group: 'clients', tintBg: 'bg-teal-100/80', tintText: 'text-teal-600' },
  { id: 'consommables', labelKey: 'nav.consommables', icon: PackageOpen, group: 'clients', tintBg: 'bg-amber-100/80', tintText: 'text-amber-600' },
  { id: 'boutiques', labelKey: 'nav.boutiques', icon: Store, group: 'admin', tintBg: 'bg-blue-100/80', tintText: 'text-blue-600' },
  { id: 'entreprise', labelKey: 'nav.entreprise', icon: Building2, group: 'admin', tintBg: 'bg-sky-100/80', tintText: 'text-sky-700' },
  { id: 'utilisateurs', labelKey: 'nav.team', icon: UserCog, group: 'admin', tintBg: 'bg-teal-100/80', tintText: 'text-teal-700' },
  { id: 'superadmin', labelKey: 'nav.superadmin', icon: ShieldCheck, group: 'admin', tintBg: 'bg-amber-100/80', tintText: 'text-amber-700' },
  { id: 'presentation', labelKey: 'nav.presentation', icon: PresentationIcon, group: 'admin', tintBg: 'bg-cyan-100/80', tintText: 'text-cyan-700' },
];

export default function Layout({ currentView, onNavigate, children }: LayoutProps) {
  const [entreprise, setEntreprise] = useState<Entreprise | null>(null);
  const [memberName, setMemberName] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [licenceInfo, setLicenceInfo] = useState<{ type_licence: string; date_fin: string; statut: string } | null>(null);
  const { canInstall, promptInstall, platform, hasInstallPrompt, installed } = usePwaInstall();
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [cacheWarming, setCacheWarming] = useState(false);
  const [cacheWarmedSuccess, setCacheWarmedSuccess] = useState(false);
  const [lastCacheAt, setLastCacheAt] = useState<string | null>(() => getLastCacheRefreshAt());
  const {
    isOnline,
    isSyncing,
    pendingCount,
    failedCount,
    totalQueueCount,
    syncedInBatch,
    totalInBatch,
    lastSyncAt,
    mutations,
    sync,
    removeMutation,
    retryMutation,
    retryAllFailed,
  } = useOfflineStatus();
  const pushStatus = usePushNotifications();
  useEffect(() => { enableAutoSync(); }, []);
  useEffect(() => {
    if (showSyncModal) {
      setLastCacheAt(getLastCacheRefreshAt());
    }
  }, [showSyncModal, lastSyncAt]);
  const { signOut, isSuperAdmin, role, tenantId, boutiques, currentBoutique, setBoutique } = useAuth();
  const { t, lang, setLang } = useI18n();
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [boutiqueOpen, setBoutiqueOpen] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pickupAlert, setPickupAlert] = useState<{ numero: string | null; address: string | null } | null>(null);
  const [orderAlert, setOrderAlert] = useState<{ numero: string | null; client: string | null } | null>(null);
  const [demoLicenceAlert, setDemoLicenceAlert] = useState<{
    entrepriseNom: string;
    dateFin: string;
    daysLeft: number;
  } | null>(null);
  const knownDepotIds = useRef<Set<string>>(new Set());
  const [iosBannerDismissed, setIosBannerDismissed] = useState(false);

  async function handleChangePassword() {
    setPwError(null);
    setPwSuccess(false);
    if (newPassword.length < 6) {
      setPwError(t('auth.passwordTooShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError(t('auth.passwordMismatch'));
      return;
    }
    setPwLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        setPwError(error.message);
      } else {
        setPwSuccess(true);
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch {
      setPwError(t('common.error'));
    } finally {
      setPwLoading(false);
    }
  }

  const refreshBrandingSilently = async () => {
    const ent = await db.getEntreprise();
    setEntreprise(ent);
    if (ent?.nom) document.title = ent.nom;
    setMemberName(await db.getCurrentMemberName());
  };

  useEffect(() => {
    void refreshBrandingSilently();
  }, []);

  useRealtimeSync(['entreprise', 'licences'], () => {
    void refreshBrandingSilently();
    if (tenantId && !isSuperAdmin && isOnline) {
      supabase.rpc('get_licence_status').then(({ data, error }) => {
        if (error) return;
        const rows = data as { type_licence: string; date_fin: string; statut: string }[] | null;
        setLicenceInfo(rows && rows.length > 0 ? rows[0] : null);
      });
    }
  });

  useEffect(() => {
    if (tenantId && !isSuperAdmin) {
      try {
        const cachedRaw = localStorage.getItem(`offline_licence_${tenantId}`);
        if (cachedRaw) setLicenceInfo(JSON.parse(cachedRaw));
      } catch {
        // Ignore
      }
      if (!isOnline) return;
      supabase.rpc('get_licence_status').then(({ data, error }) => {
        if (error) return;
        const rows = data as { type_licence: string; date_fin: string; statut: string }[] | null;
        const resolved = rows && rows.length > 0 ? rows[0] : null;
        setLicenceInfo(resolved);
      });
    }
  }, [tenantId, isSuperAdmin, isOnline]);

  // First-time Push notification for newly created companies with automatic 30-day Demo licence
  useEffect(() => {
    if (!tenantId || isSuperAdmin || !licenceInfo) return;
    const isDemo = licenceInfo.type_licence === 'demo' || licenceInfo.statut === 'demo';
    if (!isDemo) return;

    const shownKey = `demo_30d_push_shown_${tenantId}`;
    const pendingKey = `demo_30d_welcome_pending_${tenantId}`;
    try {
      if (localStorage.getItem(shownKey)) return;
      localStorage.setItem(shownKey, new Date().toISOString());
      localStorage.removeItem(pendingKey);
    } catch {
      // Proceed even if storage is restricted
    }

    const daysLeft = Math.max(
      1,
      Math.ceil((new Date(licenceInfo.date_fin).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
    );
    const nom = entreprise?.nom ?? 'PressingLite';
    setDemoLicenceAlert({
      entrepriseNom: nom,
      dateFin: licenceInfo.date_fin,
      daysLeft,
    });
    playApprovalSound();
    void notifyCompanyDemoLicencePush({
      tenantId,
      entrepriseNom: nom,
      dateFin: licenceInfo.date_fin,
      lang,
      requestPermissionIfDefault: false,
      showLocalNotification: true,
    });
  }, [tenantId, isSuperAdmin, licenceInfo, entreprise?.nom, lang]);

  // Realtime listener for pickup-requested depots (active only when online)
  useEffect(() => {
    if (!tenantId || isSuperAdmin || !isOnline) return;

    // Seed known depot IDs on mount to avoid alerting on existing depots
    (async () => {
      const existing = await db.getAllDepotsWithClient();
      existing.forEach((d) => knownDepotIds.current.add(d.id));
    })();

    const channel = supabase
      .channel('pickup-alerts')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'depots',
          filter: `tenant_id=eq.${tenantId}`,
        },
        async (payload) => {
          const newDepot = payload.new as {
            id: string;
            numero: string | null;
            statut: string;
            pickup_requested: boolean | null;
            pickup_address: string | null;
            client_id: string;
          };
          if (knownDepotIds.current.has(newDepot.id)) return;
          knownDepotIds.current.add(newDepot.id);

          if (newDepot.pickup_requested) {
            playPickupSound();
            setPickupAlert({ numero: newDepot.numero, address: newDepot.pickup_address });
            setTimeout(() => setPickupAlert(null), 15000);
          }

          if (newDepot.statut === 'COMMANDE') {
            playOrderSound();
            const { data: clientData } = await supabase
              .from('clients')
              .select('nom')
              .eq('id', newDepot.client_id)
              .maybeSingle();
            setOrderAlert({ numero: newDepot.numero, client: (clientData as { nom: string } | null)?.nom ?? null });
            setTimeout(() => setOrderAlert(null), 15000);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId, isSuperAdmin, isOnline]);

  async function handleWarmOfflineCache() {
    if (!isOnline || cacheWarming) return;
    setCacheWarming(true);
    setCacheWarmedSuccess(false);
    try {
      await db.prefetchOfflineData();
      setLastCacheAt(getLastCacheRefreshAt());
      setCacheWarmedSuccess(true);
      setTimeout(() => setCacheWarmedSuccess(false), 3500);
    } finally {
      setCacheWarming(false);
    }
  }

  function handleInstallClick() {
    if (hasInstallPrompt) {
      promptInstall();
    } else {
      setShowInstallModal(true);
    }
  }

  function handleNavigate(view: View) {
    onNavigate(view);
    setMobileOpen(false);
  }

  const visibleNavItems = NAV_ITEMS.filter((item) => {
    if (item.id === 'boutiques' && role !== 'admin') return false;
    if (item.id === 'utilisateurs' && role !== 'admin') return false;
    if (item.id === 'bons_reduction' && role !== 'admin') return false;
    if (item.id === 'commerciaux' && role && role !== 'admin' && role !== 'gerant') return false;
    if (item.id === 'entreprise' && role && role !== 'admin' && role !== 'gerant') return false;
    if (item.id === 'consommables' && role && role !== 'admin' && role !== 'gerant' && role !== 'commercial') return false;
    if (item.id === 'superadmin' && !isSuperAdmin) return false;
    if (item.id === 'commande' && role === 'collecteur') return false;
    if (item.id === 'collecte' && role && role !== 'collecteur' && role !== 'admin' && role !== 'gerant' && role !== 'commercial') return false;
    if (item.id === 'livraison' && role && role !== 'collecteur' && role !== 'admin' && role !== 'gerant' && role !== 'commercial') return false;
    if (item.id === 'dashboard' && role && role !== 'admin' && !entreprise?.dashboard_visible_roles?.includes(role)) return false;
    if (role === 'collecteur' && !['commande', 'collecte', 'livraison', 'dashboard'].includes(item.id) && item.id !== 'superadmin') return false;
    return true;
  });

  const activeNavItem = NAV_ITEMS.find((i) => i.id === currentView);
  const canQuickDepot = visibleNavItems.some((i) => i.id === 'depot') && currentView !== 'depot';

  const sidebarContent = (
    <>
      {/* Vibrant Brand Header */}
      <div className="relative overflow-hidden px-5 py-5 bg-gradient-to-br from-sky-500 via-cyan-500 to-teal-500 text-white flex-shrink-0">
        <div className="pointer-events-none absolute -top-8 -right-8 w-28 h-28 rounded-full bg-white/15" />
        <div className="pointer-events-none absolute -bottom-10 -left-6 w-24 h-24 rounded-full bg-amber-300/20" />
        <div className="relative flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur-sm border border-white/30 flex items-center justify-center shadow-sm flex-shrink-0">
            <Package className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0 pr-6 md:pr-0">
            <h1 className="text-base font-extrabold tracking-tight text-white leading-tight truncate">
              {entreprise?.nom ?? 'PressingLite'}
            </h1>
            <p className="text-xs text-sky-50/90 mt-0.5 truncate font-medium">
              {memberName ?? entreprise?.slogan ?? (lang === 'fr' ? 'Gestion de pressing' : 'Dry cleaning management')}
            </p>
            {isSuperAdmin ? (
              <span className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-md text-[0.65rem] font-bold bg-white/20 text-white border border-white/25">
                <ShieldCheck className="w-3 h-3" />
                {lang === 'fr' ? 'Super Admin' : 'Super Admin'}
              </span>
            ) : role && (
              <span className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-md text-[0.65rem] font-bold bg-white/20 text-white border border-white/25">
                {role === 'admin' ? <ShieldCheck className="w-3 h-3" /> : role === 'gerant' ? <UserCog className="w-3 h-3" /> : role === 'collecteur' ? <Truck className="w-3 h-3" /> : <Users className="w-3 h-3" />}
                {role === 'admin' ? (lang === 'fr' ? 'Administrateur' : 'Administrator') :
                 role === 'gerant' ? (lang === 'fr' ? 'Gérant' : 'Manager') :
                 role === 'collecteur' ? (lang === 'fr' ? 'Collecteur' : 'Collector') :
                 (lang === 'fr' ? 'Commercial' : 'Sales')}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Boutique selector */}
      {boutiques.length > 1 && (
        <div className="px-3 pt-3">
          <div className="relative">
            <button
              onClick={() => setBoutiqueOpen(!boutiqueOpen)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-gradient-to-r from-sky-50 to-cyan-50 border border-sky-200/80 text-sm text-sky-800 hover:from-sky-100 hover:to-cyan-100 transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Store className="w-4 h-4 text-sky-600 flex-shrink-0" />
                <span className="truncate font-semibold">{currentBoutique?.nom ?? '—'}</span>
              </div>
              <ChevronDown className={`w-4 h-4 text-sky-600 flex-shrink-0 transition-transform ${boutiqueOpen ? 'rotate-180' : ''}`} />
            </button>
            {boutiqueOpen && (
              <div className="absolute top-full left-0 right-0 mt-1.5 bg-white rounded-xl shadow-xl border border-sky-100 py-1.5 z-50 max-h-48 overflow-y-auto">
                {boutiques.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => { setBoutique(b); setBoutiqueOpen(false); }}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-sky-50 transition-colors ${currentBoutique?.id === b.id ? 'text-sky-700 font-semibold bg-sky-50/70' : 'text-slate-700'}`}
                  >
                    <span className="truncate">{b.nom}</span>
                    {currentBoutique?.id === b.id && <Check className="w-4 h-4 flex-shrink-0 text-sky-600" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Grouped colorful Nav items */}
      <nav className="flex-1 px-3 py-3 space-y-4 overflow-y-auto">
        {NAV_GROUPS.map((group) => {
          const items = visibleNavItems.filter((item) => item.group === group.id);
          if (items.length === 0) return null;
          return (
            <div key={group.id} className="space-y-1">
              <p className="px-2.5 pb-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-slate-400">
                {lang === 'fr' ? group.fr : group.en}
              </p>
              {items.map((item) => {
                const Icon = item.icon;
                const isActive = currentView === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleNavigate(item.id)}
                    className={`group w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm font-semibold transition-all duration-150 ${
                      isActive
                        ? 'bg-gradient-to-r from-sky-500 to-teal-500 text-white shadow-md shadow-sky-500/25'
                        : 'text-slate-700 hover:bg-sky-50/80 hover:text-slate-950'
                    }`}
                  >
                    <span className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${
                      isActive
                        ? 'bg-white/20 text-white'
                        : `${item.tintBg} ${item.tintText} group-hover:scale-105 transition-transform`
                    }`}>
                      <Icon className="w-4 h-4" />
                    </span>
                    <span className="truncate">{t(item.labelKey)}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Licence indicator — admin only */}
      {licenceInfo && !isSuperAdmin && role === 'admin' && (() => {
        const daysLeft = Math.max(
          0,
          Math.ceil((new Date(licenceInfo.date_fin).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
        );
        const isDemo = licenceInfo.type_licence === 'demo' || licenceInfo.statut === 'demo';
        return (
          <div className="px-3 pt-2.5">
            <div className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium ${isDemo ? 'bg-gradient-to-r from-sky-50 to-cyan-50 text-sky-800 border border-sky-200/70' : 'bg-gradient-to-r from-emerald-50 to-teal-50 text-emerald-800 border border-emerald-200/70'}`}>
              <KeyRound className={`w-4 h-4 flex-shrink-0 ${isDemo ? 'text-sky-600' : 'text-emerald-600'}`} />
              <div className="min-w-0">
                <div className="truncate font-bold">
                  {isDemo
                    ? (lang === 'fr' ? `Licence Démo · ${daysLeft}j restants` : `Demo License · ${daysLeft}d left`)
                    : (lang === 'fr' ? 'Licence annuelle' : 'Annual license')}
                </div>
                <div className="text-[11px] text-slate-500 truncate">
                  {lang === 'fr' ? 'Expire le ' : 'Expires '}
                  {new Date(licenceInfo.date_fin).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US')}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Install button */}
      {canInstall && (
        <div className="px-3 pt-2.5">
          <button
            onClick={handleInstallClick}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-teal-500 text-white text-sm font-semibold hover:from-sky-600 hover:to-teal-600 transition-all shadow-sm shadow-sky-500/20"
          >
            <Download className="w-4 h-4" />
            {t('nav.install')}
          </button>
        </div>
      )}
      {installed && (
        <div className="px-3 pt-2.5">
          <div className="flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200/70 text-emerald-700 text-xs font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {lang === 'fr' ? 'App installée' : 'App installed'}
          </div>
        </div>
      )}

      {/* Account actions */}
      <div className="px-3 pt-2.5 pb-1 grid grid-cols-2 gap-1.5">
        <button
          onClick={() => setShowPasswordModal(true)}
          className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl bg-slate-50 border border-slate-200/80 text-xs font-semibold text-slate-600 hover:bg-sky-50 hover:text-sky-700 hover:border-sky-200 transition-colors"
          title={t('nav.changePassword')}
        >
          <Lock className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">{lang === 'fr' ? 'Mot de passe' : 'Password'}</span>
        </button>
        <button
          onClick={() => signOut()}
          className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl bg-rose-50 border border-rose-200/70 text-xs font-semibold text-rose-600 hover:bg-rose-100 transition-colors"
          title={t('nav.logout')}
        >
          <LogOut className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">{t('nav.logout')}</span>
        </button>
      </div>

      {/* Footer */}
      <div className="px-4 py-3.5 mt-1 border-t border-sky-100/80 bg-gradient-to-b from-white to-sky-50/40 space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-extrabold tracking-tight text-sky-700">
            PressingLite
          </p>
          <div className="flex items-center gap-1">
            <Globe className="w-3 h-3 text-slate-400" />
            {(['fr', 'en'] as Lang[]).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`px-2 py-0.5 rounded-md text-[0.68rem] font-bold transition-all ${
                  lang === l ? 'bg-sky-500 text-white shadow-xs' : 'text-slate-400 hover:text-slate-700'
                }`}
              >
                {l === 'fr' ? 'FR' : 'EN'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between text-[0.68rem] text-slate-400">
          <span>© {new Date().getFullYear()} AGASOFT</span>
          <a
            href="tel:2250102202062"
            className="inline-flex items-center gap-1 text-slate-500 hover:text-sky-600 font-medium transition-colors"
          >
            <Phone className="w-3 h-3" />
            225 010 220 2062
          </a>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#eef6ff] via-[#f8fbff] to-[#ecfdf5] flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-64 bg-white/95 backdrop-blur-md border-r border-sky-100 shadow-sm sticky top-0 h-screen flex-shrink-0">
        {sidebarContent}
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-slate-900/45 backdrop-blur-xs"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative flex flex-col w-64 bg-white border-r border-sky-100 shadow-2xl h-full animate-[slideIn_0.2s_ease-out]">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-3.5 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-xl text-white/90 hover:bg-white/20 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* iOS install banner — shown once on iPhone/iPad until dismissed or installed */}
        {platform === 'ios' && !installed && !iosBannerDismissed && (
          <div className="bg-gradient-to-r from-sky-500 to-cyan-500 text-white px-4 py-2.5 flex items-center gap-3 shadow-sm">
            <Smartphone className="w-4 h-4 flex-shrink-0" />
            <p className="flex-1 text-xs font-medium min-w-0">
              {lang === 'fr'
                ? 'Installez l\'app : touchez Partager, puis « Sur l\'écran d\'accueil »'
                : 'Install the app: tap Share, then “Add to Home Screen”'}
            </p>
            <button
              onClick={() => setShowInstallModal(true)}
              className="px-3 py-1 rounded-lg bg-white/20 text-white text-xs font-semibold hover:bg-white/30 transition-colors flex-shrink-0"
            >
              {lang === 'fr' ? 'Comment ?' : 'How?'}
            </button>
            <button
              onClick={() => setIosBannerDismissed(true)}
              className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-white/20 transition-colors flex-shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Pickup alert banner */}
        {pickupAlert && (
          <div className="fixed top-0 left-0 right-0 z-[60] animate-[slideIn_0.3s_ease-out]">
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white px-4 py-3 shadow-lg flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                <BellRing className="w-5 h-5 animate-pulse" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold">
                  {lang === 'fr' ? 'Demande de collecte a domicile' : 'Home pickup request'}
                </p>
                <p className="text-xs text-white/90 truncate">
                  {lang === 'fr' ? 'Commande' : 'Order'} {pickupAlert.numero ?? ''}
                  {pickupAlert.address ? ` - ${pickupAlert.address}` : ''}
                </p>
              </div>
              <button
                onClick={() => setPickupAlert(null)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/20 transition-colors flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Demo 30-day Licence Welcome Push Banner */}
        {demoLicenceAlert && (
          <div className="fixed top-3 left-3 right-3 sm:left-auto sm:right-4 sm:max-w-md z-[65] animate-[slideIn_0.3s_ease-out]">
            <div className="bg-gradient-to-r from-sky-600 to-indigo-600 text-white rounded-2xl px-4 py-3.5 shadow-xl border border-white/15 flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <BellRing className="w-5 h-5 animate-pulse" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold leading-snug">
                  {lang === 'fr' ? 'Licence Démo 30 jours activée !' : '30-Day Demo License Activated!'}
                </p>
                <p className="text-xs text-white/95 mt-0.5 leading-relaxed">
                  {lang === 'fr'
                    ? `Bienvenue ${demoLicenceAlert.entrepriseNom} ! Votre entreprise bénéficie automatiquement d'une licence Démo gratuite de 30 jours (${demoLicenceAlert.daysLeft}j restants, jusqu'au ${new Date(demoLicenceAlert.dateFin).toLocaleDateString('fr-FR')}).`
                    : `Welcome ${demoLicenceAlert.entrepriseNom}! Your company automatically benefits from a free 30-day Demo license (${demoLicenceAlert.daysLeft}d left, until ${new Date(demoLicenceAlert.dateFin).toLocaleDateString('en-US')}).`}
                </p>
                {pushStatus.supported && pushStatus.permission !== 'granted' && (
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await pushStatus.enableNotifications();
                      if (ok && tenantId) {
                        void notifyCompanyDemoLicencePush({
                          tenantId,
                          entrepriseNom: demoLicenceAlert.entrepriseNom,
                          dateFin: demoLicenceAlert.dateFin,
                          lang,
                          requestPermissionIfDefault: false,
                          showLocalNotification: true,
                        });
                      }
                    }}
                    className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-sky-700 text-xs font-semibold hover:bg-sky-50 transition-colors"
                  >
                    <BellRing className="w-3.5 h-3.5" />
                    {lang === 'fr' ? 'Activer les notifications Push' : 'Enable Push notifications'}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setDemoLicenceAlert(null)}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/20 transition-colors flex-shrink-0"
                aria-label={lang === 'fr' ? 'Fermer' : 'Close'}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Order alert banner */}
        {orderAlert && (
          <div className="fixed top-0 left-0 right-0 z-[60] animate-[slideIn_0.3s_ease-out]">
            <div className="bg-gradient-to-r from-sky-500 to-cyan-500 text-white px-4 py-3 shadow-lg flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                <ShoppingBag className="w-5 h-5 animate-pulse" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold">
                  {lang === 'fr' ? 'Nouvelle commande' : 'New order'}
                </p>
                <p className="text-xs text-white/90 truncate">
                  {orderAlert.numero ?? (lang === 'fr' ? 'Commande en attente' : 'Pending order')}
                  {orderAlert.client ? ` - ${orderAlert.client}` : ''}
                </p>
              </div>
              <button
                onClick={() => setOrderAlert(null)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/20 transition-colors flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Desktop top bar */}
        <header className="hidden md:flex items-center justify-between px-6 h-16 bg-white/85 backdrop-blur-md border-b border-sky-100/90 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            {activeNavItem && (() => {
              const ActiveIcon = activeNavItem.icon;
              return (
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${activeNavItem.tintBg} ${activeNavItem.tintText}`}>
                    <ActiveIcon className="w-4 h-4" />
                  </span>
                  <span className="text-base font-extrabold tracking-tight text-slate-900 truncate">
                    {t(activeNavItem.labelKey)}
                  </span>
                </div>
              );
            })()}
            <span className="h-4 w-px bg-sky-200/80 flex-shrink-0" />
            <div className="flex items-center gap-1.5 min-w-0 text-sky-700">
              <Store className="w-4 h-4 text-sky-500 flex-shrink-0" />
              <span className="text-xs font-semibold truncate">
                {currentBoutique?.nom ?? (lang === 'fr' ? 'Toutes les boutiques' : 'All boutiques')}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            {canQuickDepot && (
              <button
                onClick={() => handleNavigate('depot')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white text-xs font-bold shadow-sm shadow-orange-500/25 transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                {t('dash.newDepot')}
              </button>
            )}
            <button
              onClick={() => setShowSyncModal(true)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                !isOnline
                  ? 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                  : failedCount > 0
                    ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                    : isSyncing || pendingCount > 0
                      ? 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100'
                      : 'bg-emerald-50/90 text-emerald-700 border-emerald-200/80 hover:bg-emerald-100/80'
              }`}
              title={lang === 'fr' ? 'Centre de synchronisation & mode hors-ligne' : 'Sync & Offline Center'}
            >
              {!isOnline ? (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-amber-600" />
                  <span>
                    {lang === 'fr' ? 'Hors ligne' : 'Offline'}
                    {totalQueueCount > 0 ? ` · ${totalQueueCount}` : ''}
                  </span>
                </>
              ) : isSyncing ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 text-sky-600 animate-spin" />
                  <span>
                    {lang === 'fr' ? 'Sync' : 'Syncing'}{' '}
                    {totalInBatch > 0 ? `${syncedInBatch}/${totalInBatch}` : '…'}
                  </span>
                </>
              ) : failedCount > 0 ? (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                  <span>
                    {failedCount} {lang === 'fr' ? 'erreur(s)' : 'failed'}
                  </span>
                </>
              ) : pendingCount > 0 ? (
                <>
                  <Clock className="w-3.5 h-3.5 text-sky-600" />
                  <span>
                    {pendingCount} {lang === 'fr' ? 'en attente' : 'pending'}
                  </span>
                </>
              ) : (
                <>
                  <Wifi className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{lang === 'fr' ? 'Synchronisé' : 'Synced'}</span>
                </>
              )}
            </button>
          </div>
        </header>

        {/* Mobile header */}
        <header className="md:hidden bg-white/90 backdrop-blur-md border-b border-sky-100/90 sticky top-0 z-30">
          <div className="flex items-center justify-between px-4 h-14">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 via-cyan-500 to-teal-500 flex items-center justify-center shadow-sm shadow-sky-500/25 flex-shrink-0">
                <Package className="w-4 h-4 text-white" />
              </div>
              <div className="min-w-0">
                <span className="text-sm font-extrabold tracking-tight text-slate-900 truncate block">
                  {entreprise?.nom ?? 'PressingLite'}
                </span>
                {currentBoutique && (
                  <span className="text-xs text-sky-600 font-semibold truncate flex items-center gap-1">
                    <Store className="w-3 h-3 flex-shrink-0" />
                    {currentBoutique.nom}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={() => setShowSyncModal(true)}
                className={`relative h-9 px-2.5 flex items-center justify-center gap-1 rounded-xl text-xs font-semibold border transition-colors ${
                  !isOnline
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : failedCount > 0
                      ? 'bg-red-50 text-red-700 border-red-200'
                      : isSyncing || pendingCount > 0
                        ? 'bg-sky-50 text-sky-700 border-sky-200'
                        : 'bg-emerald-50/80 text-emerald-600 border-emerald-200/70'
                }`}
                title={lang === 'fr' ? 'Synchronisation & Hors-ligne' : 'Sync & Offline'}
              >
                {!isOnline ? (
                  <WifiOff className="w-4 h-4" />
                ) : isSyncing ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : failedCount > 0 ? (
                  <AlertTriangle className="w-4 h-4" />
                ) : (
                  <Wifi className="w-4 h-4" />
                )}
                {totalQueueCount > 0 && <span>{totalQueueCount}</span>}
              </button>
              {canInstall && (
                <button
                  onClick={handleInstallClick}
                  className="w-9 h-9 flex items-center justify-center rounded-xl text-sky-600 hover:bg-sky-50 transition-colors"
                  title={t('nav.install')}
                >
                  <Download className="w-5 h-5" />
                </button>
              )}
              <button
                onClick={() => setMobileOpen(true)}
                className="w-9 h-9 flex items-center justify-center rounded-xl bg-sky-50 text-sky-700 hover:bg-sky-100 transition-colors"
              >
                <Menu className="w-5 h-5" />
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 w-full px-4 sm:px-6 py-6">
          <div className="max-w-6xl mx-auto">{children}</div>
        </main>
      </div>

      {/* Password change modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowPasswordModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">{t('pw.title')}</h3>
              <button onClick={() => setShowPasswordModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            {pwSuccess ? (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 flex items-start gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-emerald-700">{t('pw.success')}</p>
                  <p className="text-xs text-emerald-600 mt-1">{t('pw.successMsg')}</p>
                </div>
              </div>
            ) : (
              <form onSubmit={(e) => { e.preventDefault(); handleChangePassword(); }} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('pw.newPassword')}</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder={t('pw.placeholder')}
                      className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('pw.confirmPassword')}</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder={t('pw.confirmPlaceholder')}
                      className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                    />
                  </div>
                </div>
                {pwError && (
                  <div className="rounded-lg bg-red-50 border border-red-200 p-3">
                    <p className="text-sm text-red-600">{pwError}</p>
                  </div>
                )}
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowPasswordModal(false)}
                    className="px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
                  >
                    {t('pw.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={pwLoading}
                    className="flex-1 px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {pwLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                    {pwLoading ? t('pw.loading') : t('pw.submit')}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
      {/* Silent background sync: no intrusive bottom bar during normal online background sync; only show when offline or if an action failed */}
      {!isOnline ? (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-amber-500/95 backdrop-blur-sm text-white px-4 py-2 flex items-center justify-center gap-3 text-xs font-medium shadow-md">
          <WifiOff className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">
            {totalQueueCount > 0
              ? (lang === 'fr'
                  ? `Hors ligne — ${totalQueueCount} saisie(s) seront synchronisées automatiquement en arrière-plan`
                  : `Offline — ${totalQueueCount} change(s) will sync automatically in background`)
              : (lang === 'fr'
                  ? 'Mode hors ligne actif — synchronisation automatique dès le retour réseau'
                  : t('nav.offline'))}
          </span>
          <button
            onClick={() => setShowSyncModal(true)}
            className="px-2 py-0.5 rounded bg-white/20 hover:bg-white/30 text-xs font-semibold transition-colors flex-shrink-0"
          >
            {lang === 'fr' ? 'Détails' : 'Details'}
          </button>
        </div>
      ) : failedCount > 0 ? (
        <div className="fixed bottom-4 right-4 z-40 bg-rose-600 text-white px-3.5 py-2 rounded-xl flex items-center gap-2.5 text-xs font-medium shadow-lg">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>
            {lang === 'fr'
              ? `${failedCount} opération(s) à vérifier`
              : `${failedCount} operation(s) need review`}
          </span>
          <button
            onClick={() => setShowSyncModal(true)}
            className="px-2 py-0.5 rounded bg-white/20 hover:bg-white/30 text-xs font-semibold transition-colors"
          >
            {lang === 'fr' ? 'Voir' : 'View'}
          </button>
        </div>
      ) : null}

      {/* Sync & Offline Center Modal */}
      {showSyncModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={() => setShowSyncModal(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                    !isOnline
                      ? 'bg-amber-50 text-amber-600'
                      : failedCount > 0
                        ? 'bg-red-50 text-red-600'
                        : 'bg-sky-50 text-sky-600'
                  }`}
                >
                  {!isOnline ? <WifiOff className="w-5 h-5" /> : <RefreshCw className={`w-5 h-5 ${isSyncing ? 'animate-spin' : ''}`} />}
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    {lang === 'fr' ? 'Synchronisation & Mode Hors-ligne' : 'Sync & Offline Mode'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {!isOnline
                      ? (lang === 'fr' ? 'Hors ligne — vos saisies seront synchronisées dès le retour réseau' : 'Offline — changes will sync automatically when back online')
                      : (lang === 'fr' ? 'Connecté — synchronisation automatique en arrière-plan active' : 'Online — automatic background sync active')}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowSyncModal(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5 overflow-y-auto">
              {/* Status summary grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-50 border border-slate-100 p-3.5">
                  <p className="text-[0.7rem] font-medium text-slate-500 uppercase tracking-wide">
                    {lang === 'fr' ? 'Dernière synchro' : 'Last sync'}
                  </p>
                  <p className="text-sm font-semibold text-slate-900 mt-1">
                    {lastSyncAt
                      ? new Date(lastSyncAt).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : (lang === 'fr' ? 'Aucune modification en attente' : 'Up to date')}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 border border-slate-100 p-3.5">
                  <p className="text-[0.7rem] font-medium text-slate-500 uppercase tracking-wide">
                    {lang === 'fr' ? 'Données hors-ligne' : 'Offline cache'}
                  </p>
                  <p className="text-sm font-semibold text-slate-900 mt-1">
                    {lastCacheAt
                      ? new Date(lastCacheAt).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : (lang === 'fr' ? 'Prêtes localement' : 'Cached locally')}
                  </p>
                </div>
              </div>

              {/* Offline cache warmup card */}
              <div className="rounded-xl bg-sky-50/70 border border-sky-100 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <Database className="w-5 h-5 text-sky-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {lang === 'fr' ? 'Préparer les données hors-ligne' : 'Refresh offline data'}
                    </p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      {lang === 'fr'
                        ? 'Télécharge clients, articles, tarifs, dépôts en cours et paramètres sur cet appareil.'
                        : 'Preloads clients, catalog, active deposits, and settings onto this device.'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleWarmOfflineCache}
                  disabled={!isOnline || cacheWarming}
                  className="px-3.5 py-2 rounded-lg bg-sky-600 text-white text-xs font-semibold hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 flex-shrink-0 transition-colors"
                >
                  {cacheWarming ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : cacheWarmedSuccess ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  {cacheWarmedSuccess
                    ? (lang === 'fr' ? 'À jour !' : 'Updated!')
                    : (lang === 'fr' ? 'Actualiser' : 'Refresh')}
                </button>
              </div>

              {/* Queued mutations list */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                    {lang === 'fr'
                      ? `File d'attente (${mutations.length})`
                      : `Sync queue (${mutations.length})`}
                  </h4>
                  <div className="flex items-center gap-2">
                    {failedCount > 0 && (
                      <button
                        onClick={retryAllFailed}
                        disabled={!isOnline || isSyncing}
                        className="text-xs font-semibold text-rose-600 hover:text-rose-700 disabled:opacity-50"
                      >
                        {lang === 'fr' ? 'Tout réessayer' : 'Retry all'}
                      </button>
                    )}
                    {mutations.length > 0 && isOnline && (
                      <button
                        onClick={() => void sync()}
                        disabled={isSyncing}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-500 text-white text-xs font-semibold hover:bg-sky-600 disabled:opacity-50 transition-colors"
                      >
                        <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
                        {lang === 'fr' ? 'Synchroniser' : 'Sync now'}
                      </button>
                    )}
                  </div>
                </div>

                {mutations.length === 0 ? (
                  <div className="rounded-xl border border-slate-100 bg-slate-50/60 py-6 px-4 text-center">
                    <CheckCircle2 className="w-7 h-7 text-emerald-500 mx-auto mb-1.5" />
                    <p className="text-sm font-medium text-slate-700">
                      {lang === 'fr'
                        ? 'Toutes vos opérations sont synchronisées'
                        : 'All changes are synced'}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {lang === 'fr'
                        ? 'En cas de coupure internet, vos dépôts, clients et règlements s\'afficheront ici en attendant le réseau.'
                        : 'Any offline deposits, clients, or payments will appear here until synced.'}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 max-h-60 overflow-y-auto">
                    {mutations.map((m) => (
                      <div key={m.id} className="p-3 flex items-start justify-between gap-3 bg-white">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
                                m.status === 'failed'
                                  ? 'bg-rose-500'
                                  : m.status === 'syncing'
                                    ? 'bg-sky-500 animate-ping'
                                    : 'bg-amber-400'
                              }`}
                            />
                            <p className="text-xs font-semibold text-slate-800 truncate">
                              {m.label ?? `${m.operation} ${m.table}`}
                            </p>
                          </div>
                          <p className="text-[0.7rem] text-slate-400 mt-0.5">
                            {new Date(m.createdAt).toLocaleTimeString(lang === 'fr' ? 'fr-FR' : 'en-US', {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })}
                            {m.retries > 0 ? ` · ${m.retries} essai(s)` : ''}
                          </p>
                          {m.lastError && (
                            <p className="text-[0.7rem] text-rose-600 mt-1 break-words">
                              {m.lastError}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {m.status === 'failed' && (
                            <button
                              onClick={() => retryMutation(m.id)}
                              disabled={!isOnline}
                              className="p-1.5 rounded-lg text-sky-600 hover:bg-sky-50 disabled:opacity-40"
                              title={lang === 'fr' ? 'Réessayer' : 'Retry'}
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => removeMutation(m.id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                            title={lang === 'fr' ? 'Retirer de la file' : 'Remove'}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setShowSyncModal(false)}
                className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-colors"
              >
                {lang === 'fr' ? 'Fermer' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Install modal */}
      {showInstallModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowInstallModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">{t('install.title')}</h3>
              <button onClick={() => setShowInstallModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-slate-500">{t('install.subtitle')}</p>

            {platform === 'ios' && (
              <div className="space-y-3">
                <div className="flex items-start gap-3 rounded-xl bg-sky-50 border border-sky-100 p-4">
                  <Smartphone className="w-5 h-5 text-sky-600 flex-shrink-0 mt-0.5" />
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-sky-900">{t('install.ios')}</p>
                    <div className="space-y-2.5">
                      <div className="flex items-start gap-2.5">
                        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-sky-500 text-white text-[0.65rem] font-bold flex-shrink-0 mt-0.5">1</span>
                        <div className="flex items-center gap-1.5 text-xs text-sky-800">
                          <span>{lang === 'fr' ? 'Touchez l\'icône' : 'Tap the'}</span>
                          <Share className="w-4 h-4 text-sky-600 flex-shrink-0" />
                          <span className="font-medium">{lang === 'fr' ? 'Partager' : 'Share'}</span>
                          <span>{lang === 'fr' ? 'en bas de l\'écran' : 'at the bottom'}</span>
                        </div>
                      </div>
                      <div className="flex items-start gap-2.5">
                        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-sky-500 text-white text-[0.65rem] font-bold flex-shrink-0 mt-0.5">2</span>
                        <div className="flex items-center gap-1.5 text-xs text-sky-800">
                          <Plus className="w-4 h-4 text-sky-600 flex-shrink-0" />
                          <span className="font-medium">{lang === 'fr' ? 'Sur l\'écran d\'accueil' : 'Add to Home Screen'}</span>
                        </div>
                      </div>
                      <div className="flex items-start gap-2.5">
                        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-sky-500 text-white text-[0.65rem] font-bold flex-shrink-0 mt-0.5">3</span>
                        <div className="flex items-center gap-1.5 text-xs text-sky-800">
                          <span className="font-medium">{lang === 'fr' ? 'Ajouter' : 'Add'}</span>
                          <span>{lang === 'fr' ? '— l\'app apparaît sur votre écran d\'accueil' : '— the app appears on your home screen'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {platform === 'android' && (
              <div className="space-y-3">
                <div className="flex items-start gap-3 rounded-xl bg-emerald-50 border border-emerald-100 p-4">
                  <Smartphone className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-emerald-900">{t('install.android')}</p>
                    <p className="text-xs text-emerald-700">{t('install.androidSteps')}</p>
                  </div>
                </div>
                {hasInstallPrompt && (
                  <button
                    onClick={() => { promptInstall(); setShowInstallModal(false); }}
                    className="w-full px-4 py-3 rounded-xl bg-sky-500 text-white font-medium text-sm hover:bg-sky-600 transition-colors flex items-center justify-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    {t('install.installBtn')}
                  </button>
                )}
              </div>
            )}

            {platform === 'desktop' && (
              <div className="space-y-3">
                <div className="flex items-start gap-3 rounded-xl bg-slate-50 border border-slate-100 p-4">
                  <Monitor className="w-5 h-5 text-slate-600 flex-shrink-0 mt-0.5" />
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-slate-900">{t('install.desktop')}</p>
                    <p className="text-xs text-slate-600">{t('install.desktopSteps')}</p>
                  </div>
                </div>
                {hasInstallPrompt && (
                  <button
                    onClick={() => { promptInstall(); setShowInstallModal(false); }}
                    className="w-full px-4 py-3 rounded-xl bg-sky-500 text-white font-medium text-sm hover:bg-sky-600 transition-colors flex items-center justify-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    {t('install.installBtn')}
                  </button>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <p className="text-xs text-emerald-700">{t('install.offlineReady')}</p>
            </div>

            <button
              onClick={() => setShowInstallModal(false)}
              className="w-full px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              {t('install.close')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
