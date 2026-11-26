import { useState, useMemo, useEffect } from 'react';
import { db } from '@/lib/db';
import { useI18n } from '@/lib/i18n';
import type { Client } from '@/types';
import {
  formatClientCode,
  normalizeBillingPointCode,
  parseClientCodeInfo,
  parseDepotNumeroInfo,
  setBillingPointCode,
} from '@/lib/dbOfflineHelpers';
import { X, Check, Hash, ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react';

interface NormalizeClientCodesModalProps {
  boutiqueId: string | null;
  boutiqueName: string;
  clients: Client[];
  currentBillingPointCode: string;
  onBillingPointChanged: (code: string) => void;
  onClose: () => void;
  onNormalized: () => Promise<void> | void;
}

export default function NormalizeClientCodesModal({
  boutiqueId,
  boutiqueName,
  clients,
  currentBillingPointCode,
  onBillingPointChanged,
  onClose,
  onNormalized,
}: NormalizeClientCodesModalProps) {
  const { lang } = useI18n();
  const [detectedDepotPrefix, setDetectedDepotPrefix] = useState<string | null>(null);
  const [targetPrefix, setTargetPrefix] = useState<string>(() =>
    normalizeBillingPointCode(currentBillingPointCode),
  );
  const [applyToTerminal, setApplyToTerminal] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    updated: number;
    alreadyCompliant: number;
    total: number;
  } | null>(null);

  // Detect if deposits in this boutique share a billing-point prefix (e.g. PEC-D-001-2026 -> PEC)
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const depots = await db.getAllDepotsWithClient();
        if (!active) return;
        const counts = new Map<string, number>();
        for (const d of depots) {
          if (boutiqueId && d.boutique_id && d.boutique_id !== boutiqueId) continue;
          const info = parseDepotNumeroInfo(d.numero);
          if (info && info.pointCode) {
            counts.set(info.pointCode, (counts.get(info.pointCode) ?? 0) + 1);
          }
        }
        let bestPrefix = '';
        let bestCount = 0;
        for (const [prefix, cnt] of counts.entries()) {
          if (cnt > bestCount) {
            bestPrefix = prefix;
            bestCount = cnt;
          }
        }
        setDetectedDepotPrefix(bestPrefix);
        if (bestPrefix && !currentBillingPointCode) {
          setTargetPrefix(bestPrefix);
        }
      } catch {
        // Ignore detection errors
      }
    })();
    return () => {
      active = false;
    };
  }, [boutiqueId, currentBillingPointCode]);

  const cleanTargetPrefix = normalizeBillingPointCode(targetPrefix);

  // Diagnose current prefixes present across this boutique's clients
  const diagnostic = useMemo(() => {
    const groups = new Map<string, number>();
    let nonStandard = 0;
    let alreadyCompliant = 0;
    const sampleRenames: Array<{ nom: string; oldCode: string; newCode: string }> = [];
    const usedPreview = new Set<string>();
    let maxSeq = 0;

    for (const c of clients) {
      const parsed = parseClientCodeInfo(c.code);
      if (!parsed) {
        nonStandard++;
      } else {
        const key = parsed.pointCode || '__MAIN__';
        groups.set(key, (groups.get(key) ?? 0) + 1);
        if (parsed.pointCode === cleanTargetPrefix) {
          if (parsed.seq > maxSeq) maxSeq = parsed.seq;
          if (formatClientCode(parsed.seq, cleanTargetPrefix) === c.code) {
            alreadyCompliant++;
            usedPreview.add(c.code);
          }
        }
      }
    }

    let nextSeq = maxSeq + 1;
    for (const c of clients) {
      if (sampleRenames.length >= 4) break;
      const parsed = parseClientCodeInfo(c.code);
      const conforms =
        parsed !== null &&
        parsed.pointCode === cleanTargetPrefix &&
        formatClientCode(parsed.seq, cleanTargetPrefix) === c.code;
      if (conforms) continue;

      const raw = (c.code ?? '').trim().toUpperCase();
      const trailing = raw.match(/(\d+)$/);
      const extracted = trailing ? parseInt(trailing[1], 10) : NaN;
      let candidate: string | null = null;
      if (Number.isFinite(extracted) && extracted > 0 && extracted < 10_000_000) {
        const tryCode = formatClientCode(extracted, cleanTargetPrefix);
        if (!usedPreview.has(tryCode)) candidate = tryCode;
      }
      if (!candidate) {
        while (usedPreview.has(formatClientCode(nextSeq, cleanTargetPrefix))) nextSeq++;
        candidate = formatClientCode(nextSeq, cleanTargetPrefix);
        nextSeq++;
      }
      usedPreview.add(candidate);
      sampleRenames.push({
        nom: c.nom,
        oldCode: c.code || '—',
        newCode: candidate,
      });
    }

    const sortedGroups = Array.from(groups.entries()).sort((a, b) => b[1] - a[1]);
    return {
      sortedGroups,
      nonStandard,
      alreadyCompliant,
      toUpdate: Math.max(0, clients.length - alreadyCompliant),
      sampleRenames,
    };
  }, [clients, cleanTargetPrefix]);

  const presetChips = useMemo(() => {
    const base: Array<{ value: string; label: string }> = [
      { value: '', label: lang === 'fr' ? 'Sans préfixe (C-0001)' : 'No prefix (C-0001)' },
    ];
    const seen = new Set<string>(['']);
    if (detectedDepotPrefix && !seen.has(detectedDepotPrefix)) {
      seen.add(detectedDepotPrefix);
      base.push({
        value: detectedDepotPrefix,
        label:
          lang === 'fr'
            ? `${detectedDepotPrefix} (dépôts)`
            : `${detectedDepotPrefix} (deposits)`,
      });
    }
    const cleanCurrent = normalizeBillingPointCode(currentBillingPointCode);
    if (cleanCurrent && !seen.has(cleanCurrent)) {
      seen.add(cleanCurrent);
      base.push({
        value: cleanCurrent,
        label: `${cleanCurrent} (${formatClientCode(1, cleanCurrent)})`,
      });
    }
    for (const p of ['C1', 'C2', 'P1', 'P2']) {
      if (!seen.has(p)) {
        seen.add(p);
        base.push({ value: p, label: p });
      }
    }
    return base;
  }, [detectedDepotPrefix, currentBillingPointCode, lang]);

  async function handleConfirm() {
    if (running) return;
    setRunning(true);
    setError(null);
    setProgress({ done: 0, total: diagnostic.toUpdate });

    try {
      const res = await db.normalizeBoutiqueClientCodes(
        cleanTargetPrefix,
        boutiqueId,
        (done, total) => setProgress({ done, total }),
      );
      if (res.error) {
        setError(res.error);
        return;
      }

      if (applyToTerminal) {
        const saved = setBillingPointCode(cleanTargetPrefix);
        onBillingPointChanged(saved);
      }

      setResult({
        updated: res.updated,
        alreadyCompliant: res.alreadyCompliant,
        total: res.total,
      });
      await onNormalized();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : lang === 'fr'
            ? 'Erreur lors de la mise en conformité'
            : 'Error normalizing client codes',
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/45 backdrop-blur-sm overflow-y-auto"
      onClick={() => {
        if (!running) onClose();
      }}
    >
      <div
        className="bg-white rounded-2xl shadow-xl max-w-lg w-full overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center flex-shrink-0">
              <Hash className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-900 truncate">
                {lang === 'fr'
                  ? 'Conformer le préfixe des codes clients'
                  : 'Normalize client code prefixes'}
              </h3>
              <p className="text-xs text-slate-500 truncate">
                {boutiqueName} · {clients.length.toLocaleString('fr-FR')}{' '}
                {lang === 'fr' ? 'client(s)' : 'client(s)'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {result ? (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 space-y-2 text-center">
              <CheckCircle2 className="w-9 h-9 text-emerald-600 mx-auto" />
              <p className="text-sm font-bold text-emerald-900">
                {lang === 'fr'
                  ? 'Mise en conformité terminée !'
                  : 'Normalization completed!'}
              </p>
              <p className="text-xs text-emerald-700">
                {lang === 'fr'
                  ? `${result.updated.toLocaleString('fr-FR')} code(s) client mis à jour · ${result.alreadyCompliant.toLocaleString('fr-FR')} déjà conforme(s) au format ${formatClientCode(1, cleanTargetPrefix)}.`
                  : `${result.updated.toLocaleString('en-US')} client code(s) updated · ${result.alreadyCompliant.toLocaleString('en-US')} already matching ${formatClientCode(1, cleanTargetPrefix)}.`}
              </p>
            </div>
          ) : (
            <>
              {/* Current diagnostic */}
              <div className="rounded-xl bg-slate-50 border border-slate-100 p-3.5 space-y-2">
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                  {lang === 'fr' ? 'État actuel des codes clients' : 'Current client codes breakdown'}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {diagnostic.sortedGroups.map(([key, count]) => (
                    <span
                      key={key}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs text-slate-700"
                    >
                      <span className="font-mono font-semibold text-slate-900">
                        {key === '__MAIN__' ? 'C-XXXX' : `${key}-C-XXXX`}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span>{count.toLocaleString('fr-FR')}</span>
                    </span>
                  ))}
                  {diagnostic.nonStandard > 0 && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                      <span className="font-semibold">
                        {lang === 'fr' ? 'Non conformes' : 'Non-standard'}
                      </span>
                      <span>·</span>
                      <span>{diagnostic.nonStandard.toLocaleString('fr-FR')}</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Target prefix picker */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-slate-700">
                    {lang === 'fr' ? 'Préfixe conforme cible' : 'Target conforming prefix'}
                  </label>
                  <span className="px-2 py-0.5 rounded bg-sky-50 border border-sky-200 text-sky-700 text-xs font-mono font-bold">
                    {formatClientCode(1, cleanTargetPrefix)}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {presetChips.map((chip) => {
                    const active = cleanTargetPrefix === chip.value;
                    return (
                      <button
                        key={chip.value || 'MAIN'}
                        type="button"
                        disabled={running}
                        onClick={() => setTargetPrefix(chip.value)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          active
                            ? 'bg-sky-500 text-white border-sky-500'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-sky-300'
                        }`}
                      >
                        {chip.label}
                      </button>
                    );
                  })}
                  <input
                    type="text"
                    value={targetPrefix}
                    disabled={running}
                    onChange={(e) => setTargetPrefix(normalizeBillingPointCode(e.target.value))}
                    maxLength={8}
                    placeholder={lang === 'fr' ? 'Autre (ex: PEC)' : 'Custom (e.g. PEC)'}
                    className="w-32 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-mono uppercase focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>

              {/* Impact preview */}
              <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">
                    {lang === 'fr' ? 'Déjà conformes' : 'Already compliant'}
                  </span>
                  <span className="font-semibold text-emerald-600">
                    {diagnostic.alreadyCompliant.toLocaleString('fr-FR')}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 font-medium">
                    {lang === 'fr' ? 'Codes à mettre en conformité' : 'Codes to update'}
                  </span>
                  <span
                    className={`font-bold ${
                      diagnostic.toUpdate > 0 ? 'text-sky-600' : 'text-emerald-600'
                    }`}
                  >
                    {diagnostic.toUpdate.toLocaleString('fr-FR')}
                  </span>
                </div>

                {diagnostic.sampleRenames.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 space-y-1.5">
                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                      {lang === 'fr' ? 'Aperçu des changements' : 'Sample updates'}
                    </p>
                    {diagnostic.sampleRenames.map((s, idx) => (
                      <div key={idx} className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-slate-600 truncate">{s.nom}</span>
                        <span className="inline-flex items-center gap-1.5 font-mono flex-shrink-0">
                          <span className="text-slate-400">{s.oldCode}</span>
                          <ArrowRight className="w-3 h-3 text-slate-300" />
                          <span className="font-semibold text-sky-700">{s.newCode}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Apply to terminal checkbox */}
              <label className="flex items-center gap-2.5 text-xs text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={applyToTerminal}
                  disabled={running}
                  onChange={(e) => setApplyToTerminal(e.target.checked)}
                  className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
                <span>
                  {lang === 'fr'
                    ? 'Appliquer aussi ce préfixe aux prochains clients créés sur ce poste'
                    : 'Also apply this prefix to future clients created on this device'}
                </span>
              </label>

              {/* Progress bar */}
              {running && progress && progress.total > 0 && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>
                      {lang === 'fr' ? 'Mise en conformité en cours…' : 'Updating codes…'}
                    </span>
                    <span className="font-mono font-semibold">
                      {progress.done.toLocaleString('fr-FR')} / {progress.total.toLocaleString('fr-FR')}
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full bg-sky-500 transition-all duration-200"
                      style={{
                        width: `${Math.min(100, Math.round((progress.done / Math.max(1, progress.total)) * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 flex items-start gap-2 text-xs text-red-700">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50/50 flex gap-2.5">
          {result ? (
            <button
              type="button"
              onClick={onClose}
              className="w-full px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors"
            >
              {lang === 'fr' ? 'Fermer' : 'Close'}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={running}
                className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                {lang === 'fr' ? 'Annuler' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={running || (diagnostic.toUpdate === 0 && !applyToTerminal)}
                className="flex-1 px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {running ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    {diagnostic.toUpdate > 0
                      ? lang === 'fr'
                        ? `Conformer (${diagnostic.toUpdate.toLocaleString('fr-FR')})`
                        : `Normalize (${diagnostic.toUpdate.toLocaleString('en-US')})`
                      : lang === 'fr'
                        ? 'Appliquer le préfixe'
                        : 'Apply prefix'}
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
