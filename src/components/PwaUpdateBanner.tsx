import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { applyPendingPwaUpdateNow, type PwaUpdateStatus } from '@/lib/pwaAutoUpdate';

export default function PwaUpdateBanner() {
  const { lang } = useI18n();
  const [state, setState] = useState<PwaUpdateStatus>({ status: 'idle' });

  useEffect(() => {
    const onStatus = (e: Event) => {
      const detail = (e as CustomEvent<PwaUpdateStatus>).detail;
      if (detail) setState(detail);
    };
    window.addEventListener('pressinglite:pwa-update-status', onStatus);
    return () => window.removeEventListener('pressinglite:pwa-update-status', onStatus);
  }, []);

  if (state.status === 'idle') return null;

  return (
    <div className="fixed bottom-4 right-4 z-[70] max-w-sm">
      <div className="flex items-center gap-3 rounded-xl bg-slate-900 text-white px-4 py-3 shadow-xl border border-slate-700/80">
        <RefreshCw
          className={`w-4 h-4 text-sky-400 shrink-0 ${state.status === 'updating' ? 'animate-spin' : ''}`}
        />
        <div className="text-xs leading-snug">
          {state.status === 'updating' ? (
            <span className="font-medium">
              {lang === 'fr'
                ? "Mise à jour vers la dernière version en cours…"
                : 'Updating to the latest version…'}
            </span>
          ) : (
            <span className="font-medium">
              {lang === 'fr'
                ? 'Une nouvelle version est prête.'
                : 'A new version is ready.'}
            </span>
          )}
        </div>
        {state.status === 'pending' && (
          <button
            type="button"
            onClick={() => void applyPendingPwaUpdateNow(true)}
            className="ml-1 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold transition-colors whitespace-nowrap"
          >
            {lang === 'fr' ? 'Mettre à jour' : 'Update now'}
          </button>
        )}
      </div>
    </div>
  );
}
