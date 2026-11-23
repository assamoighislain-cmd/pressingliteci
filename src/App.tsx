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
import { Loader2, Clock, LogOut, ShieldAlert, ShieldCheck, BellRing, KeyRound, CheckCircle2 } from 'lucide-react';

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
  const { user, loading, membershipLoading, tenantId, isSuperAdmin, signOut, currentBoutique } = useAuth();
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
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <div className="w-16 h-16 rounded-2xl bg-sky-50 flex items-center justify-center mx-auto mb-4">
            <Clock className="w-8 h-8 text-sky-500" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900">{lang === 'fr' ? "En attente d'activation" : 'Awaiting activation'}</h2>
          <p className="text-sm text-slate-500 mt-2">
            {lang === 'fr'
              ? "Votre compte a été créé. Un administrateur de l'entreprise doit vous ajouter à son équipe pour que vous puissiez accéder aux données."
              : 'Your account has been created. A company administrator must add you to their team before you can access the data.'}
          </p>
          {isOnline && (
            <button
              onClick={() => window.location.reload()}
              className="mt-6 px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors"
            >
              {lang === 'fr' ? 'Actualiser' : 'Refresh'}
            </button>
          )}
          <button
            onClick={() => signOut()}
            className="mt-3 mx-auto px-4 py-2.5 rounded-lg bg-red-50 border border-red-100 text-red-600 text-sm font-medium hover:bg-red-100 transition-colors flex items-center justify-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            {t('nav.logout')}
          </button>
        </div>
      </div>
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

  return (
    <>
      {quotaBanner}
      <WorkspaceApp />
      <PwaUpdateBanner />
    </>
  );
}
