import { useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import {
  applyPendingPwaUpdateNow,
  getPwaUpdateStatus,
  type PwaUpdateStatus,
} from '@/lib/pwaAutoUpdate';

export default function PwaUpdateBanner() {
  const { lang } = useI18n();
  const [state, setState] = useState<PwaUpdateStatus>(() => getPwaUpdateStatus());
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onStatus = (e: Event) => {
      const detail = (e as CustomEvent<PwaUpdateStatus>).detail;
      if (!detail) return;
      setState((prev) => {
        // Re-show the banner if transitioning to updating or from deferred -> ready-to-apply
        if (
          detail.status === 'updating' ||
          (detail.status === 'pending' &&
            prev.status === 'pending' &&
            prev.deferredByDeposit &&
            !detail.deferredByDeposit)
        ) {
          setDismissed(false);
        }
        return detail;
      });
    };
    window.addEventListener('pressinglite:pwa-update-status', onStatus);
    return () => window.removeEventListener('pressinglite:pwa-update-status', onStatus);
  }, []);

  if (state.status === 'idle') return null;
  if (dismissed && state.status !== 'updating') return null;

  const isDeferredByDeposit = state.status === 'pending' && Boolean(state.deferredByDeposit);

  return (
    <div className="fixed bottom-4 right-4 z-[70] max-w-sm no-print">
      <div className="flex items-center gap-3 rounded-xl bg-slate-900 text-white px-4 py-3 shadow-xl border border-slate-700/80">
        {isDeferredByDeposit ? (
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
        ) : (
          <RefreshCw
            className={`w-4 h-4 text-sky-400 shrink-0 ${state.status === 'updating' ? 'animate-spin' : ''}`}
          />
        )}

        <div className="text-xs leading-snug">
          {state.status === 'updating' ? (
            <span className="font-medium">
              {lang === 'fr'
                ? 'Mise à jour vers la dernière version en cours…'
                : 'Updating to the latest version…'}
            </span>
          ) : isDeferredByDeposit ? (
            <span className="font-medium text-slate-100">
              {lang === 'fr'
                ? "Mise à jour en attente — elle s'appliquera automatiquement dès la fin du dépôt en cours."
                : 'Update queued — it will apply automatically once the current deposit finishes.'}
            </span>
          ) : (
            <span className="font-medium">
              {lang === 'fr'
                ? 'Une nouvelle version est prête.'
                : 'A new version is ready.'}
            </span>
          )}
        </div>

        {state.status === 'pending' && !isDeferredByDeposit && (
          <button
            type="button"
            onClick={() => void applyPendingPwaUpdateNow(true)}
            className="ml-1 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold transition-colors whitespace-nowrap"
          >
            {lang === 'fr' ? 'Mettre à jour' : 'Update now'}
          </button>
        )}

        {isDeferredByDeposit && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="text-slate-400 hover:text-white transition-colors shrink-0"
            aria-label={lang === 'fr' ? 'Masquer' : 'Dismiss'}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
