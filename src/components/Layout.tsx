import { useState, useEffect, useRef } from 'react';
import { db } from '@/lib/db';
import { supabase } from '@/lib/supabase';
import { useI18n, type Lang } from '@/lib/i18n';
import { Package, ArrowDownToLine, ArrowUpFromLine, LayoutDashboard, BookOpen, Receipt, Building2, CalendarDays, Menu, X, Phone, Users, Download, History, Wallet, LogOut, UserCog, ShieldCheck, Calculator, Receipt as ReceiptIcon, Presentation as PresentationIcon, CreditCard, KeyRound, Lock, Loader2, Globe, Store, ChevronDown, Check, Truck, BellRing, ShoppingBag, WifiOff, Wifi, Share, Smartphone, Monitor, CheckCircle2, Ticket, PackageOpen, PackageSearch, Plus, RefreshCw, AlertTriangle, Trash2, Database, Clock } from 'lucide-react';
import { Entreprise } from '@/types';
import { usePwaInstall } from '@/hooks/usePwaInstall';
import { usePushNotifications } from '@/hooks/usePushNotifications';
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

export type View = 'dashboard' | 'depot' | 'retrait' | 'planning' | 'historique' | 'journal' | 'comptabilite' | 'depenses' | 'clients' | 'catalogue' | 'releve' | 'entreprise' | 'utilisateurs' | 'superadmin' | 'presentation' | 'modes_reglement' | 'boutiques' | 'commande' | 'collecte' | 'livraison' | 'bons_reduction' | 'consommables' | 'inventaire';

interface LayoutProps {
  currentView: View;
  onNavigate: (view: View) => void;
  children: React.ReactNode;
}

const NAV_ITEMS: { id: View; labelKey: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { id: 'depot', labelKey: 'nav.depot', icon: ArrowDownToLine },
  { id: 'retrait', labelKey: 'nav.retrait', icon: ArrowUpFromLine },
  { id: 'commande', labelKey: 'nav.commande', icon: ShoppingBag },
  { id: 'collecte', labelKey: 'nav.collecte', icon: Truck },
  { id: 'livraison', labelKey: 'nav.livraison', icon: Truck },
  { id: 'planning', labelKey: 'nav.planning', icon: CalendarDays },
  { id: 'historique', labelKey: 'nav.historique', icon: History },
  { id: 'journal', labelKey: 'nav.journal', icon: Wallet },
  { id: 'comptabilite', labelKey: 'nav.comptabilite', icon: Calculator },
  { id: 'depenses', labelKey: 'nav.depenses', icon: ReceiptIcon },
  { id: 'clients', labelKey: 'nav.clients', icon: Users },
  { id: 'catalogue', labelKey: 'nav.catalogue', icon: BookOpen },
  { id: 'modes_reglement', labelKey: 'nav.modesReglement', icon: CreditCard },
  { id: 'bons_reduction', labelKey: 'nav.bons', icon: Ticket },
  { id: 'releve', labelKey: 'nav.releve', icon: Receipt },
  { id: 'inventaire', labelKey: 'nav.inventaire', icon: PackageSearch },
  { id: 'consommables', labelKey: 'nav.consommables', icon: PackageOpen },
  { id: 'boutiques', labelKey: 'nav.boutiques', icon: Store },
  { id: 'entreprise', labelKey: 'nav.entreprise', icon: Building2 },
  { id: 'utilisateurs', labelKey: 'nav.team', icon: UserCog },
  { id: 'superadmin', labelKey: 'nav.superadmin', icon: ShieldCheck },
  { id: 'presentation', labelKey: 'nav.presentation', icon: PresentationIcon },
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
  usePushNotifications();
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

  const sidebarContent = (
    <>
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-100">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-cyan-600 flex items-center justify-center shadow-sm flex-shrink-0">
          <Package className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="text-base font-bold text-slate-900 leading-tight truncate">
            {entreprise?.nom ?? 'PressingLite'}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5 truncate">
            {memberName ?? entreprise?.slogan ?? (lang === 'fr' ? 'Gestion de pressing' : 'Dry cleaning management')}
          </p>
          {isSuperAdmin ? (
            <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded text-[0.65rem] font-semibold bg-violet-50 text-violet-700 border border-violet-100">
              <ShieldCheck className="w-3 h-3" />
              {lang === 'fr' ? 'Super Admin' : 'Super Admin'}
            </span>
          ) : role && (
            <span className={`inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded text-[0.65rem] font-semibold border ${
              role === 'admin' ? 'bg-sky-50 text-sky-700 border-sky-100' :
              role === 'gerant' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
              role === 'collecteur' ? 'bg-amber-50 text-amber-700 border-amber-100' :
              'bg-slate-50 text-slate-600 border-slate-100'
            }`}>
              {role === 'admin' ? <ShieldCheck className="w-3 h-3" /> : role === 'gerant' ? <UserCog className="w-3 h-3" /> : role === 'collecteur' ? <Truck className="w-3 h-3" /> : <Users className="w-3 h-3" />}
              {role === 'admin' ? (lang === 'fr' ? 'Administrateur' : 'Administrator') :
               role === 'gerant' ? (lang === 'fr' ? 'Gérant' : 'Manager') :
               role === 'collecteur' ? (lang === 'fr' ? 'Collecteur' : 'Collector') :
               (lang === 'fr' ? 'Commercial' : 'Sales')}
            </span>
          )}
        </div>
      </div>

      {/* Boutique selector */}
      {boutiques.length > 1 && (
        <div className="px-3 pt-3">
          <div className="relative">
            <button
              onClick={() => setBoutiqueOpen(!boutiqueOpen)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-sky-50 border border-sky-100 text-sm text-sky-700 hover:bg-sky-100 transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Store className="w-4 h-4 flex-shrink-0" />
                <span className="truncate font-medium">{currentBoutique?.nom ?? '—'}</span>
              </div>
              <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-transform ${boutiqueOpen ? 'rotate-180' : ''}`} />
            </button>
            {boutiqueOpen && (
              <div className="absolute bottom-full left-0 right-0 mb-1 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-50 max-h-48 overflow-y-auto">
                {boutiques.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => { setBoutique(b); setBoutiqueOpen(false); }}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-slate-50 transition-colors ${currentBoutique?.id === b.id ? 'text-sky-700 font-medium' : 'text-slate-700'}`}
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

      {/* Nav items */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.filter((item) => {
          if (item.id === 'boutiques' && role !== 'admin') return false;
          if (item.id === 'utilisateurs' && role !== 'admin') return false;
          if (item.id === 'bons_reduction' && role !== 'admin') return false;
          if (item.id === 'entreprise' && role && role !== 'admin' && role !== 'gerant') return false;
          if (item.id === 'consommables' && role && role !== 'admin' && role !== 'gerant' && role !== 'commercial') return false;
          if (item.id === 'superadmin' && !isSuperAdmin) return false;
          if (item.id === 'commande' && role === 'collecteur') return false;
          if (item.id === 'collecte' && role && role !== 'collecteur' && role !== 'admin' && role !== 'gerant' && role !== 'commercial') return false;
          if (item.id === 'livraison' && role && role !== 'collecteur' && role !== 'admin' && role !== 'gerant' && role !== 'commercial') return false;
          if (item.id === 'dashboard' && role && role !== 'admin' && !entreprise?.dashboard_visible_roles?.includes(role)) return false;
          if (role === 'collecteur' && !['commande', 'collecte', 'livraison', 'dashboard'].includes(item.id) && item.id !== 'superadmin') return false;
          return true;
        }).map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => handleNavigate(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'bg-sky-50 text-sky-700 ring-1 ring-sky-100'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-sky-600' : 'text-slate-400'}`} />
              {t(item.labelKey)}
            </button>
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
          <div className="px-3 pt-3">
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium ${isDemo ? 'bg-sky-50 text-sky-700 border border-sky-100' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'}`}>
              <KeyRound className="w-3.5 h-3.5 flex-shrink-0" />
              <div className="min-w-0">
                <div className="truncate font-semibold">
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
        <div className="px-3 pt-3">
          <button
            onClick={handleInstallClick}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors shadow-sm"
          >
            <Download className="w-4 h-4" />
            {t('nav.install')}
          </button>
        </div>
      )}
      {installed && (
        <div className="px-3 pt-3">
          <div className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-700 text-xs font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {lang === 'fr' ? 'App installée' : 'App installed'}
          </div>
        </div>
      )}

      {/* Change password button */}
      <div className="px-3 pt-2">
        <button
          onClick={() => setShowPasswordModal(true)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100 text-xs text-slate-600 hover:bg-slate-100 transition-colors"
        >
          <Lock className="w-3.5 h-3.5 flex-shrink-0" />
          {t('nav.changePassword')}
        </button>
      </div>

      {/* Logout button */}
      <div className="px-3 pt-2 pb-1">
        <button
          onClick={() => signOut()}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-100 text-xs text-red-600 hover:bg-red-100 transition-colors"
        >
          <LogOut className="w-3.5 h-3.5 flex-shrink-0" />
          {t('nav.logout')}
        </button>
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-slate-100 space-y-1.5">
        <p className="text-xs font-semibold text-slate-500 text-center">
          PressingLite
        </p>
        <p className="text-[0.7rem] text-slate-400 text-center">
          © {new Date().getFullYear()} AGASOFT. {lang === 'fr' ? 'Tous droits réservés.' : 'All rights reserved.'}
        </p>
        <div className="flex items-center justify-center gap-1 pt-1">
          <Globe className="w-3 h-3 text-slate-400" />
          {(['fr', 'en'] as Lang[]).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={`px-2 py-0.5 rounded text-[0.7rem] font-medium transition-all ${
                lang === l ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {l === 'fr' ? 'FR' : 'EN'}
            </button>
          ))}
        </div>
        <a
          href="tel:2250102202062"
          className="flex items-center justify-center gap-1.5 text-[0.7rem] text-slate-400 hover:text-sky-600 transition-colors"
        >
          <Phone className="w-3 h-3" />
          225 010 220 2062
        </a>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-64 bg-white border-r border-slate-200 sticky top-0 h-screen flex-shrink-0">
        {sidebarContent}
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative flex flex-col w-64 bg-white border-r border-slate-200 h-full animate-[slideIn_0.2s_ease-out]">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-3 w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
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
        <header className="hidden md:flex items-center justify-between px-6 h-14 bg-white border-b border-slate-200 sticky top-0 z-30">
          <div className="flex items-center gap-2">
            <Store className="w-4 h-4 text-sky-600 flex-shrink-0" />
            <span className="text-sm font-semibold text-slate-900 truncate">
              {currentBoutique?.nom ?? (lang === 'fr' ? 'Toutes les boutiques' : 'All boutiques')}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowSyncModal(true)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                !isOnline
                  ? 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                  : failedCount > 0
                    ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                    : isSyncing || pendingCount > 0
                      ? 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100'
                      : 'bg-emerald-50/70 text-emerald-700 border-emerald-200/80 hover:bg-emerald-100/70'
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
            <span className="text-xs text-slate-400">
              {entreprise?.nom ?? 'PressingLite'}
            </span>
          </div>
        </header>

        {/* Mobile header */}
        <header className="md:hidden bg-white border-b border-slate-200 sticky top-0 z-30">
          <div className="flex items-center justify-between px-4 h-14">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-sky-500 to-cyan-600 flex items-center justify-center shadow-sm flex-shrink-0">
                <Package className="w-4 h-4 text-white" />
              </div>
              <div className="min-w-0">
                <span className="text-sm font-bold text-slate-900 truncate block">
                  {entreprise?.nom ?? 'PressingLite'}
                </span>
                {currentBoutique && (
                  <span className="text-xs text-sky-600 font-medium truncate flex items-center gap-1">
                    <Store className="w-3 h-3 flex-shrink-0" />
                    {currentBoutique.nom}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={() => setShowSyncModal(true)}
                className={`relative h-9 px-2.5 flex items-center justify-center gap-1 rounded-lg text-xs font-semibold border transition-colors ${
                  !isOnline
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : failedCount > 0
                      ? 'bg-red-50 text-red-700 border-red-200'
                      : isSyncing || pendingCount > 0
                        ? 'bg-sky-50 text-sky-700 border-sky-200'
                        : 'bg-slate-50 text-emerald-600 border-slate-200'
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
                  className="w-9 h-9 flex items-center justify-center rounded-lg text-sky-600 hover:bg-sky-50 transition-colors"
                  title={t('nav.install')}
                >
                  <Download className="w-5 h-5" />
                </button>
              )}
              <button
                onClick={() => setMobileOpen(true)}
                className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
              >
                <Menu className="w-5 h-5" />
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 w-full px-4 sm:px-6 py-6">
          <div className="max-w-5xl mx-auto">{children}</div>
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
