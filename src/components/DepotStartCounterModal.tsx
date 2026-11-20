import { useState, useEffect } from 'react';
import { db } from '@/lib/db';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { formatDepotNumero, getBillingPointCode } from '@/lib/dbOfflineHelpers';
import { Hash, Check, X, Sparkles } from 'lucide-react';

function setupDoneKey(tenantId: string, year: number): string {
  return `pressinglite_counter_setup_done_${tenantId}_${year}`;
}

export default function DepotStartCounterModal() {
  const { user, role, tenantId, isSuperAdmin } = useAuth();
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [startInput, setStartInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentYear = new Date().getFullYear();

  useEffect(() => {
    if (!user || !tenantId || isSuperAdmin || role !== 'admin') return;

    const doneKey = setupDoneKey(tenantId, currentYear);
    try {
      if (localStorage.getItem(doneKey) === '1') return;
    } catch {
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const [ent, existingDepots] = await Promise.all([
          db.getEntreprise(),
          db.getAllDepotsWithClient(),
        ]);
        if (cancelled) return;

        // Already configured at signup or in settings -> mark done silently
        const hasConfiguredStart =
          (ent?.depot_start_number != null &&
            ent.depot_start_number >= 1 &&
            (!ent.depot_start_year || ent.depot_start_year === currentYear)) ||
          db.getDepotStartNumber() !== null;

        if (hasConfiguredStart) {
          try {
            localStorage.setItem(doneKey, '1');
          } catch {
            // Ignore
          }
          return;
        }

        // Only prompt on a fresh installation with zero deposits in the current year
        const hasCurrentYearDepots = existingDepots.some((d) => {
          const dt = new Date(d.date_depot);
          return !Number.isNaN(dt.getTime()) && dt.getFullYear() === currentYear;
        });

        if (hasCurrentYearDepots) {
          try {
            localStorage.setItem(doneKey, '1');
          } catch {
            // Ignore
          }
          return;
        }

        setOpen(true);
      } catch {
        // Non-blocking
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, tenantId, isSuperAdmin, role, currentYear]);

  if (!open || !tenantId) return null;

  const parsedNum = parseInt(startInput.trim(), 10);
  const validNum = Number.isFinite(parsedNum) && parsedNum >= 1 ? parsedNum : null;
  const previewNumber = formatDepotNumero(validNum ?? 1, currentYear, getBillingPointCode());

  function markDone() {
    try {
      localStorage.setItem(setupDoneKey(tenantId!, currentYear), '1');
    } catch {
      // Ignore
    }
    setOpen(false);
  }

  async function handleEnforce() {
    if (validNum === null) {
      setError(
        lang === 'fr'
          ? 'Veuillez saisir un nombre entier supérieur ou égal à 1.'
          : 'Please enter an integer greater than or equal to 1.',
      );
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const { error: saveErr } = await db.saveEnforcedDepotStartNumber(validNum);
      if (saveErr) {
        setError(saveErr);
        return;
      }
      markDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-slate-900/45 backdrop-blur-sm" onClick={markDone} />
      <div className="relative bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-md p-6 space-y-5">
        <button
          type="button"
          onClick={markDone}
          className="absolute top-4 right-4 w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          aria-label={lang === 'fr' ? 'Fermer' : 'Close'}
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-start gap-3.5 pr-6">
          <div className="w-11 h-11 rounded-xl bg-sky-50 border border-sky-100 flex items-center justify-center flex-shrink-0">
            <Hash className="w-5 h-5 text-sky-600" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">
              {lang === 'fr'
                ? 'Compteur de départ des dépôts'
                : 'Starting deposit counter'}
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              {lang === 'fr'
                ? "Lors de l'installation du logiciel, vous pouvez imposer le premier numéro de dépôt (utile pour poursuivre un carnet papier ou un ancien logiciel). Ce compteur sera appliqué sur tous vos postes."
                : 'When installing the software, you can enforce the starting deposit number (useful when continuing a paper receipt book or previous software). This counter will apply across all devices.'}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              {lang === 'fr'
                ? `Numéro de départ souhaité (${currentYear})`
                : `Desired starting number (${currentYear})`}
            </label>
            <input
              type="number"
              min={1}
              step={1}
              value={startInput}
              onChange={(e) => {
                setStartInput(e.target.value);
                setError(null);
              }}
              placeholder={lang === 'fr' ? 'Ex: 1, 150, 450…' : 'e.g. 1, 150, 450…'}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
              autoFocus
            />
          </div>

          <div className="rounded-xl bg-sky-50/70 border border-sky-100 px-4 py-3 flex items-center justify-between gap-3">
            <span className="text-xs text-sky-700 font-medium flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              {lang === 'fr' ? 'Premier dépôt généré :' : 'First deposit generated:'}
            </span>
            <span className="text-sm font-bold font-mono text-sky-800">{previewNumber}</span>
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
          <button
            type="button"
            onClick={markDone}
            disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition-colors"
          >
            {lang === 'fr' ? 'Démarrer à 001 (auto)' : 'Start at 001 (auto)'}
          </button>
          <button
            type="button"
            onClick={handleEnforce}
            disabled={saving || validNum === null}
            className="flex-1 px-4 py-2.5 rounded-xl bg-sky-500 text-white text-xs font-semibold hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          >
            <Check className="w-4 h-4" />
            {saving
              ? (lang === 'fr' ? 'Enregistrement…' : 'Saving…')
              : (lang === 'fr' ? 'Imposer ce compteur' : 'Enforce counter')}
          </button>
        </div>

        <p className="text-[11px] text-slate-400 text-center">
          {lang === 'fr'
            ? 'Vous pourrez modifier ou réinitialiser ce compteur à tout moment dans Entreprise.'
            : 'You can change or reset this counter anytime in Company settings.'}
        </p>
      </div>
    </div>
  );
}
