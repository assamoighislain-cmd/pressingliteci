import { useState, useEffect } from 'react';
import Layout, { View } from '@/components/Layout';
import Dashboard from '@/components/Dashboard';
import DepotForm from '@/components/DepotForm';
import RetraitView from '@/components/RetraitView';
import CommandeView from '@/components/CommandeView';
import CollecteView from '@/components/CollecteView';
import LivraisonView from '@/components/LivraisonView';
import Catalogue from '@/components/Catalogue';
import ReleveClient from '@/components/ReleveClient';
import EntreprisePage from '@/components/EntreprisePage';
import Planning from '@/components/Planning';
import Historique from '@/components/Historique';
import JournalDepots from '@/components/JournalDepots';
import JournalReglements from '@/components/JournalReglements';
import Comptabilite from '@/components/Comptabilite';
import Depenses from '@/components/Depenses';
import CommerciauxPage from '@/components/CommerciauxPage';
import Clients from '@/components/Clients';
import TeamManagement from '@/components/TeamManagement';
import SuperAdminPage from '@/components/SuperAdminPage';
import AuthForm from '@/components/AuthForm';
import Presentation from '@/components/Presentation';
import ModesReglement from '@/components/ModesReglement';
import BonsReduction from '@/components/BonsReduction';
import ConsommablesPage from '@/components/ConsommablesPage';
import Inventaire from '@/components/Inventaire';
import BoutiquesPage from '@/components/BoutiquesPage';
import ClientPortal from '@/components/ClientPortal';
import CommercialPortal from '@/components/CommercialPortal';
import ErrorBoundary from '@/components/ErrorBoundary';
import DepotStartCounterModal from '@/components/DepotStartCounterModal';
import PwaUpdateBanner from '@/components/PwaUpdateBanner';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { setCurrentBoutiqueId, db } from '@/lib/db';
import { connectRealtimeSync } from '@/lib/realtimeSync';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { useOfflineStatus } from '@/hooks/useOfflineStatus';
import { usePushNotifications, notifyCompanyDemoLicencePush } from '@/hooks/usePushNotifications';
import { Loader2, Clock, LogOut, ShieldAlert, ShieldCheck, BellRing, KeyRound, CheckCircle2, Building2, Copy, Check, Send, RefreshCw } from 'lucide-react';

type LicenceInfo = { statut: string; date_fin: string; type_licence: string };

function readCachedLicence(tenantId: string): LicenceInfo | null | undefined {
  try {
    const raw = localStorage.getItem(`offline_licence_${tenantId}`);
    if (!raw) return undefined;
    return JSON.parse(raw) as LicenceInfo | null;
  } catch {
    return undefined;
  }
}

function writeCachedLicence(tenantId: string, info: LicenceInfo | null): void {
  try {
    localStorage.setItem(`offline_licence_${tenantId}`, JSON.stringify(info));
  } catch {
    // Ignore
  }
}

function getInitialViewFromShortcut(): View {
  try {
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    if (action === 'new-depot') return 'depot';
    if (action === 'clients') return 'clients';
    if (action === 'dashboard') return 'dashboard';
  } catch {
    // Ignore
  }
  return 'dashboard';
}

function updateMetaTags(entreprise: { nom?: string; logo_url?: string | null } | null) {
  const ogImage = document.querySelector('meta[property="og:image"]');
  const ogTitle = document.querySelector('meta[property="og:title"]');
  const twitterImage = document.querySelector('meta[name="twitter:image"]');
  const twitterTitle = document.querySelector('meta[name="twitter:title"]');

  if (ogImage && twitterImage) {
    const img = entreprise?.logo_url || '/pwa-512x512.png';
    ogImage.setAttribute('content', img);
    twitterImage.setAttribute('content', img);
  }
  if (ogTitle && twitterTitle) {
    const title = entreprise?.nom || 'PressingLite';
    ogTitle.setAttribute('content', title);
    twitterTitle.setAttribute('content', title);
  }
}

function WorkspaceApp() {
  const { user, loading, membershipLoading, tenantId, isSuperAdmin, signOut, currentBoutique, refreshMembership, requestJoinEntreprise } = useAuth();
  const { isOnline } = useOfflineStatus();
  const { t, lang } = useI18n();
  const [view, setViewRaw] = useState<View>(() => getInitialViewFromShortcut());
  const setView = (v: View) => {
    setViewRaw(v);
    window.scrollTo({ top: 0 });
  };

  const [licenceStatus, setLicenceStatus] = useState<null | LicenceInfo | undefined>(() =>
    tenantId ? readCachedLicence(tenantId) : undefined,
  );
  const [entrepriseStatut, setEntrepriseStatut] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (isSuperAdmin && (view === 'dashboard' || window.location.hash === '#/super-admin')) {
      setView('superadmin');
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    const onHashChange = () => {
      if (isSuperAdmin && window.location.hash === '#/super-admin') {
        setView('superadmin');
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [isSuperAdmin]);

  const refreshEntrepriseAndLicenceSilently = () => {
    if (!user || !tenantId || isSuperAdmin) return;
    db.getEntreprise()
      .then((ent) => {
        updateMetaTags(ent);
        if (ent?.statut) setEntrepriseStatut(ent.statut);
      })
      .catch(() => {});

    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    Promise.resolve(supabase.rpc('get_licence_status'))
      .then(({ data, error }) => {
        // Never lock out on RPC/network/JWT errors — only update when server returns a valid response
        if (error) return;
        const rows = data as LicenceInfo[] | null;
        const resolved = rows && rows.length > 0 ? rows[0] : null;
        writeCachedLicence(tenantId, resolved);
        setLicenceStatus(resolved);
      })
      .catch(() => {});
  };

  useEffect(() => {
    return connectRealtimeSync({
      tenantId: tenantId ?? null,
      isSuperAdmin: Boolean(isSuperAdmin),
      userId: user?.id ?? null,
    });
  }, [user?.id, tenantId, isSuperAdmin]);

  useRealtimeSync(['entreprise', 'licences'], refreshEntrepriseAndLicenceSilently);

  useEffect(() => {
    if (user && tenantId && !isSuperAdmin) {
      db.getEntreprise()
        .then((ent) => {
          updateMetaTags(ent);
          setEntrepriseStatut(ent?.statut ?? null);
        })
        .catch(() => {});
    } else {
      updateMetaTags(null);
      setEntrepriseStatut(undefined);
    }
  }, [user, tenantId, isSuperAdmin]);

  useEffect(() => {
    if (user && tenantId && !isSuperAdmin) {
      const cachedLic = readCachedLicence(tenantId);
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        // Offline: trust cached licence (or allow offline work if not yet cached)
        setLicenceStatus(cachedLic !== undefined ? cachedLic : undefined);
        return;
      }

      Promise.resolve(supabase.rpc('get_licence_status'))
        .then(({ data, error }) => {
          if (error) {
            // Never set licenceStatus=null on error (e.g. offline, captive portal, expired JWT before refresh)
            setLicenceStatus(cachedLic !== undefined ? cachedLic : undefined);
            return;
          }
          const rows = data as LicenceInfo[] | null;
          const resolved = rows && rows.length > 0 ? rows[0] : null;
          writeCachedLicence(tenantId, resolved);
          setLicenceStatus(resolved);
        })
        .catch(() => {
          setLicenceStatus(cachedLic !== undefined ? cachedLic : undefined);
        });
    }
  }, [user, tenantId, isSuperAdmin]);

  // Warm up essential offline caches automatically in the background when online
  useEffect(() => {
    if (!user || !tenantId || isSuperAdmin) return;
    const runWarmup = () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      void db.prefetchOfflineData();
    };
    const timer = setTimeout(runWarmup, 300);
    window.addEventListener('online', runWarmup);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('online', runWarmup);
    };
  }, [user, tenantId, isSuperAdmin, currentBoutique?.id]);

  setCurrentBoutiqueId(currentBoutique?.id ?? null);

  if (loading || (user && membershipLoading)) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-sky-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <AuthForm />;
  }

  if (!tenantId && !isSuperAdmin) {
    return (
      <AwaitingTeamScreen
        userEmail={user.email ?? ''}
        userId={user.id}
        defaultFullName={(user.user_metadata?.full_name as string) ?? ''}
        defaultContact={(user.user_metadata?.contact as string) ?? ''}
        defaultTargetCompany={(user.user_metadata?.target_entreprise_nom as string) ?? ''}
        lang={lang}
        isOnline={isOnline}
        onRefreshMembership={refreshMembership}
        onRequestJoin={requestJoinEntreprise}
        onSignOut={() => signOut()}
        logoutLabel={t('nav.logout')}
      />
    );
  }

  // Pending entreprise check: block access until super admin validates,
  // while subscribing the company to Push and confirming its 30-day Demo licence
  if (!isSuperAdmin && entrepriseStatut === 'pending') {
    return (
      <PendingEntrepriseScreen
        tenantId={tenantId}
        lang={lang}
        isOnline={isOnline}
        licenceDateFin={licenceStatus?.date_fin ?? null}
        onRefresh={refreshEntrepriseAndLicenceSilently}
        onSignOut={() => signOut()}
        logoutLabel={t('nav.logout')}
      />
    );
  }

  // Licence check: block access ONLY when online and confirmed expired/revoked (never block offline work!)
  if (!isSuperAdmin && isOnline && licenceStatus === null) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-4">
            <ShieldAlert className="w-8 h-8 text-amber-500" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900">{t('licence.expired')}</h2>
          <p className="text-sm text-slate-500 mt-2">
            {lang === 'fr'
              ? "Votre licence d'utilisation a expiré ou a été révoquée. Contactez l'administrateur de la plateforme pour la renouveler."
              : 'Your license has expired or was revoked. Contact the platform administrator to renew it.'}
          </p>
          <button
            onClick={() => signOut()}
            className="mt-6 mx-auto px-4 py-2.5 rounded-lg bg-red-50 border border-red-100 text-red-600 text-sm font-medium hover:bg-red-100 transition-colors flex items-center justify-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            {t('nav.logout')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <Layout currentView={view} onNavigate={setView}>
      <ErrorBoundary key={`${currentBoutique?.id ?? 'no-boutique'}:${view}`}>
        {isSuperAdmin && view === 'superadmin' ? <SuperAdminPage /> : (
          <div key={currentBoutique?.id ?? 'no-boutique'}>
            {view === 'dashboard' && <Dashboard onNavigate={setView} />}
            {view === 'depot' && <DepotForm onDone={() => setView('dashboard')} />}
            {view === 'retrait' && <RetraitView />}
            {view === 'commande' && <CommandeView />}
            {view === 'collecte' && <CollecteView />}
            {view === 'livraison' && <LivraisonView />}
            {view === 'planning' && <Planning />}
            {view === 'historique' && <Historique />}
            {view === 'journal_depots' && <JournalDepots />}
            {view === 'journal' && <JournalReglements />}
            {view === 'comptabilite' && <Comptabilite />}
            {view === 'depenses' && <Depenses />}
            {view === 'commerciaux' && <CommerciauxPage />}
            {view === 'clients' && <Clients />}
            {view === 'catalogue' && <Catalogue />}
            {view === 'modes_reglement' && <ModesReglement />}
            {view === 'bons_reduction' && <BonsReduction />}
            {view === 'boutiques' && <BoutiquesPage />}
            {view === 'releve' && <ReleveClient />}
            {view === 'entreprise' && <EntreprisePage />}
            {view === 'utilisateurs' && <TeamManagement />}
            {view === 'consommables' && <ConsommablesPage />}
            {view === 'inventaire' && <Inventaire />}
            {view === 'presentation' && <Presentation />}
          </div>
        )}
      </ErrorBoundary>
      <DepotStartCounterModal />
    </Layout>
  );
}

function AwaitingTeamScreen({
  userEmail,
  userId,
  defaultFullName,
  defaultContact,
  defaultTargetCompany,
  lang,
  isOnline,
  onRefreshMembership,
  onRequestJoin,
  onSignOut,
  logoutLabel,
}: {
  userEmail: string;
  userId: string;
  defaultFullName: string;
  defaultContact: string;
  defaultTargetCompany: string;
  lang: string;
  isOnline: boolean;
  onRefreshMembership: () => Promise<void>;
  onRequestJoin: (
    entrepriseNom: string,
    fullName?: string,
    contact?: string,
    requestedRole?: string,
  ) => Promise<{ error: string | null; status?: 'pending' | 'already_member'; entrepriseNom?: string; needsAdminInvite?: boolean }>;
  onSignOut: () => void;
  logoutLabel: string;
}) {
  const [companyName, setCompanyName] = useState(defaultTargetCompany);
  const [fullName, setFullName] = useState(defaultFullName);
  const [contact, setContact] = useState(defaultContact);
  const [requestedRole, setRequestedRole] = useState<'commercial' | 'collecteur' | 'gerant'>('commercial');
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'info' | 'error'; text: string } | null>(null);
  const [myRequests, setMyRequests] = useState<Array<{ id: string; status: string; created_at: string; requested_role: string }>>([]);

  async function loadMyRequests() {
    if (!isOnline) return;
    try {
      const { data } = await supabase
        .from('join_requests')
        .select('id, status, created_at, requested_role')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(5);
      setMyRequests((data as Array<{ id: string; status: string; created_at: string; requested_role: string }>) ?? []);
    } catch {
      // Ignore
    }
  }

  useEffect(() => {
    void loadMyRequests();
  }, [userId, isOnline]);

  useRealtimeSync(['entreprise_members', 'join_requests'], () => {
    void loadMyRequests();
    void onRefreshMembership();
  });

  async function handleSendJoinRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!companyName.trim() || !isOnline) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await onRequestJoin(companyName.trim(), fullName.trim(), contact.trim(), requestedRole);
      if (res.error) {
        setFeedback({ type: 'error', text: res.error });
      } else if (res.status === 'already_member') {
        setFeedback({
          type: 'success',
          text: lang === 'fr'
            ? `Vous êtes déjà membre de « ${res.entrepriseNom ?? companyName.trim()} ». Actualisation de votre accès…`
            : `You are already a member of "${res.entrepriseNom ?? companyName.trim()}". Refreshing access…`,
        });
        await onRefreshMembership();
      } else if (res.needsAdminInvite) {
        setFeedback({
          type: 'info',
          text: lang === 'fr'
            ? `Votre compte (${userEmail}) est déjà actif. Communiquez cet email à l'administrateur de « ${companyName.trim()} » (ou au Super Admin) pour qu'il vous ajoute immédiatement dans « Utilisateurs ».`
            : `Your account (${userEmail}) is already active. Share this email with the administrator of "${companyName.trim()}" (or Super Admin) so they can add you immediately under "Users".`,
        });
      } else {
        setFeedback({
          type: 'success',
          text: lang === 'fr'
            ? `Votre demande pour rejoindre « ${res.entrepriseNom ?? companyName.trim()} » a bien été envoyée ! Dès qu'elle sera approuvée, votre espace s'ouvrira automatiquement.`
            : `Your request to join "${res.entrepriseNom ?? companyName.trim()}" has been sent! Once approved, your workspace will open automatically.`,
        });
        await loadMyRequests();
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCheckAccess() {
    setChecking(true);
    try {
      await loadMyRequests();
      await onRefreshMembership();
    } finally {
      setChecking(false);
    }
  }

  function handleCopyEmail() {
    if (!userEmail) return;
    navigator.clipboard.writeText(userEmail);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const hasPendingRequest = myRequests.some((r) => r.status === 'pending');

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-8">
      <div className="max-w-md w-full space-y-4">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-5">
          <div className="text-center">
            <div className="w-14 h-14 rounded-2xl bg-sky-50 flex items-center justify-center mx-auto mb-3">
              <Clock className="w-7 h-7 text-sky-500" />
            </div>
            <h2 className="text-lg font-semibold text-slate-900">
              {lang === 'fr' ? "Compte connecté — En attente d'équipe" : 'Signed in — Awaiting team'}
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-1.5">
              {lang === 'fr'
                ? "Votre compte existe déjà mais n'est encore rattaché à aucune entreprise."
                : 'Your account is active but is not yet attached to any company.'}
            </p>
          </div>

          {/* Copyable user email card */}
          {userEmail && (
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  {lang === 'fr' ? 'Votre email à communiquer à votre admin' : 'Your email to share with your admin'}
                </p>
                <p className="text-sm font-semibold text-slate-800 truncate">{userEmail}</p>
              </div>
              <button
                type="button"
                onClick={handleCopyEmail}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors flex-shrink-0"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? (lang === 'fr' ? 'Copié' : 'Copied') : (lang === 'fr' ? 'Copier' : 'Copy')}
              </button>
            </div>
          )}

          {hasPendingRequest && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 flex items-start gap-2.5">
              <Clock className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-900">
                {lang === 'fr'
                  ? "Une demande d'adhésion est en attente de validation par l'administrateur de l'entreprise (ou le Super Admin)."
                  : 'A join request is awaiting approval by the company administrator (or Super Admin).'}
              </p>
            </div>
          )}

          {/* Request to join an existing company form */}
          <form onSubmit={handleSendJoinRequest} className="space-y-3 pt-1 border-t border-slate-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 pt-2">
              {lang === 'fr' ? 'Demander à rejoindre une entreprise' : 'Request to join a company'}
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {lang === 'fr' ? "Nom exact de l'entreprise" : 'Exact company name'}
              </label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Ex: Ecoclair"
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  {lang === 'fr' ? 'Nom complet' : 'Full name'}
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={lang === 'fr' ? 'Votre nom' : 'Your name'}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  {lang === 'fr' ? 'Téléphone' : 'Phone'}
                </label>
                <input
                  type="tel"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="+225..."
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {lang === 'fr' ? 'Rôle souhaité' : 'Requested role'}
              </label>
              <select
                value={requestedRole}
                onChange={(e) => setRequestedRole(e.target.value as 'commercial' | 'collecteur' | 'gerant')}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
              >
                <option value="commercial">{lang === 'fr' ? 'Commercial / Caissier' : 'Sales / Cashier'}</option>
                <option value="collecteur">{lang === 'fr' ? 'Collecteur / Livreur' : 'Collector / Delivery'}</option>
                <option value="gerant">{lang === 'fr' ? 'Gérant' : 'Manager'}</option>
              </select>
            </div>

            {feedback && (
              <div
                className={`rounded-lg p-3 text-xs border ${
                  feedback.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : feedback.type === 'info'
                      ? 'bg-sky-50 border-sky-200 text-sky-800'
                      : 'bg-red-50 border-red-200 text-red-700'
                }`}
              >
                {feedback.text}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !companyName.trim() || !isOnline}
              className="w-full px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {lang === 'fr' ? "Envoyer la demande d'adhésion" : 'Send join request'}
            </button>
          </form>

          <div className="flex items-center gap-2 pt-1">
            {isOnline && (
              <button
                type="button"
                onClick={() => void handleCheckAccess()}
                disabled={checking}
                className="flex-1 px-4 py-2.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />
                {lang === 'fr' ? 'Vérifier mon accès' : 'Check access'}
              </button>
            )}
            <button
              type="button"
              onClick={onSignOut}
              className="px-4 py-2.5 rounded-lg bg-red-50 border border-red-100 text-red-600 text-sm font-medium hover:bg-red-100 transition-colors flex items-center justify-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              {logoutLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PendingEntrepriseScreen({
  tenantId,
  lang,
  isOnline,
  licenceDateFin,
  onRefresh,
  onSignOut,
  logoutLabel,
}: {
  tenantId: string | null;
  lang: string;
  isOnline: boolean;
  licenceDateFin: string | null;
  onRefresh: () => void;
  onSignOut: () => void;
  logoutLabel: string;
}) {
  const pushStatus = usePushNotifications();
  const [pushConfirmSent, setPushConfirmSent] = useState(false);

  const fallbackDateFin =
    licenceDateFin ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const formattedEnd = new Date(fallbackDateFin).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  async function handleEnablePush() {
    const ok = await pushStatus.enableNotifications();
    if (ok && tenantId) {
      let entNom = 'PressingLite';
      try {
        const raw = localStorage.getItem(`demo_30d_welcome_pending_${tenantId}`);
        if (raw) {
          const parsed = JSON.parse(raw) as { entrepriseNom?: string };
          if (parsed.entrepriseNom) entNom = parsed.entrepriseNom;
        }
      } catch {
        // Ignore
      }
      await notifyCompanyDemoLicencePush({
        tenantId,
        entrepriseNom: entNom,
        dateFin: fallbackDateFin,
        lang,
        requestPermissionIfDefault: false,
        showLocalNotification: true,
      });
      setPushConfirmSent(true);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-8">
      <div className="max-w-md w-full space-y-4">
        {/* Push-style 30-day Demo licence notification card */}
        <div className="rounded-2xl bg-gradient-to-r from-sky-600 to-indigo-600 text-white p-4 shadow-lg flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
            <KeyRound className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-sm font-bold">
              {lang === 'fr' ? 'Licence Démo 30 jours activée !' : '30-Day Demo License Activated!'}
            </p>
            <p className="text-xs text-white/95 mt-1 leading-relaxed">
              {lang === 'fr'
                ? `Votre nouvelle entreprise bénéficie automatiquement d'une licence Démo gratuite de 30 jours (valable jusqu'au ${formattedEnd}).`
                : `Your new company automatically receives a free 30-day Demo license (valid until ${formattedEnd}).`}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-4">
            <ShieldCheck className="w-8 h-8 text-amber-500" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900">
            {lang === 'fr' ? 'En attente de validation' : 'Pending validation'}
          </h2>
          <p className="text-sm text-slate-500 mt-2">
            {lang === 'fr'
              ? 'Le Super Administrateur a été notifié pour approuver votre compte. Activez les notifications Push ci-dessous pour recevoir la confirmation instantanément.'
              : 'The Super Administrator has been notified to approve your account. Enable Push notifications below to receive confirmation instantly.'}
          </p>

          {pushStatus.supported && (
            <div className="mt-4">
              {pushStatus.subscribed || pushConfirmSent ? (
                <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium">
                  <CheckCircle2 className="w-4 h-4" />
                  {lang === 'fr'
                    ? 'Notifications Push activées sur cet appareil'
                    : 'Push notifications enabled on this device'}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleEnablePush()}
                  disabled={pushStatus.subscribing}
                  className="w-full px-4 py-2.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-sm font-medium hover:bg-indigo-100 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <BellRing className="w-4 h-4" />
                  {lang === 'fr'
                    ? 'Activer les messages Push (Licence & Validation)'
                    : 'Enable Push alerts (License & Approval)'}
                </button>
              )}
            </div>
          )}

          {isOnline && (
            <button
              onClick={onRefresh}
              className="mt-4 w-full px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors"
            >
              {lang === 'fr' ? 'Vérifier le statut' : 'Check status'}
            </button>
          )}
          <button
            onClick={onSignOut}
            className="mt-3 mx-auto px-4 py-2.5 rounded-lg bg-red-50 border border-red-100 text-red-600 text-sm font-medium hover:bg-red-100 transition-colors flex items-center justify-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            {logoutLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [hash, setHash] = useState(() => window.location.hash);
  const [gmpQuotaExceeded, setGmpQuotaExceeded] = useState(false);

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const handleQuotaExceeded = () => setGmpQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handleQuotaExceeded);
    return () => window.removeEventListener('gmp-quota-exceeded', handleQuotaExceeded);
  }, []);

  const quotaBanner = gmpQuotaExceeded ? (
    <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
      <span>
        Google Maps Platform quota reached. If you are the app owner, visit{' '}
        <a
          href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
          target="_blank"
          rel="noopener noreferrer"
          className="underline font-semibold text-amber-950 hover:text-amber-800"
        >
          maps developer site
        </a>{' '}
        for instructions to update your account.
      </span>
    </div>
  ) : null;

  const portalMatch = hash.match(/^#\/portal\/(\d+)$/);
  const portalEntrepriseId = portalMatch ? parseInt(portalMatch[1], 10) : null;

  if (portalEntrepriseId !== null) {
    return (
      <>
        {quotaBanner}
        <ClientPortal entrepriseId={portalEntrepriseId} />
        <PwaUpdateBanner />
      </>
    );
  }

  const commercialPortalMatch = hash.match(/^#\/commercial(?:\/(\d+))?$/);
  if (commercialPortalMatch) {
    const comEntrepriseId = commercialPortalMatch[1] ? parseInt(commercialPortalMatch[1], 10) : null;
    return (
      <>
        {quotaBanner}
        <CommercialPortal entrepriseId={comEntrepriseId} />
        <PwaUpdateBanner />
      </>
    );
  }

  return (
    <>
      {quotaBanner}
      <WorkspaceApp />
      <PwaUpdateBanner />
    </>
  );
}
