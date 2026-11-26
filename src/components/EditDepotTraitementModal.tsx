import { useState, useMemo, useEffect } from 'react';
import { db } from '@/lib/db';
import { useI18n } from '@/lib/i18n';
import {
  DepotWithArticles,
  TypeTraitement,
  formatPrice,
  formatDateShort,
  getTraitementLabelById,
  computeDateRetraitPrevueById,
} from '@/types';
import { X, Check, Sparkles, Calendar, AlertTriangle, ArrowRight } from 'lucide-react';

interface EditDepotTraitementModalProps {
  depot: DepotWithArticles;
  typesTraitement: TypeTraitement[];
  totalPaye: number;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

function toLocalDateInputValue(isoOrDate: string | Date | null | undefined): string {
  if (!isoOrDate) return '';
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function EditDepotTraitementModal({
  depot,
  typesTraitement,
  totalPaye,
  onClose,
  onSaved,
}: EditDepotTraitementModalProps) {
  const { lang } = useI18n();

  const initialTypeId = useMemo(() => {
    if (depot.type_traitement_id && typesTraitement.some((t) => t.id === depot.type_traitement_id)) {
      return depot.type_traitement_id;
    }
    if (depot.traitement) {
      const normalized = depot.traitement.trim().toLowerCase();
      const matched = typesTraitement.find((t) => t.libelle.trim().toLowerCase() === normalized);
      if (matched) return matched.id;
    }
    return typesTraitement[0]?.id ?? '';
  }, [depot.type_traitement_id, depot.traitement, typesTraitement]);

  const [selectedTypeId, setSelectedTypeId] = useState<string>(initialTypeId);
  const [dateRetraitInput, setDateRetraitInput] = useState<string>(() =>
    toLocalDateInputValue(depot.date_retrait_prevue),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saving, onClose]);

  const selectedType = useMemo(
    () => typesTraitement.find((t) => t.id === selectedTypeId) ?? null,
    [typesTraitement, selectedTypeId],
  );

  function handleSelectType(typeId: string) {
    setSelectedTypeId(typeId);
    setError(null);
    const baseDate = depot.date_depot ? new Date(depot.date_depot) : new Date();
    const validBase = isNaN(baseDate.getTime()) ? new Date() : baseDate;
    const computedDate = computeDateRetraitPrevueById(validBase, typeId, typesTraitement);
    setDateRetraitInput(toLocalDateInputValue(computedDate));
  }

  const preview = useMemo(() => {
    const oldCoef = Number(depot.coefficient) > 0 ? Number(depot.coefficient) : 1;
    const newCoef = selectedType ? (Number(selectedType.coefficient) || 1) : oldCoef;

    const articles = depot.articles ?? [];
    const updatedArticles = articles.map((art) => {
      const qte = Number(art.quantite) || 1;
      let basePu = Number(art.prix_unitaire) || 0;
      if (basePu <= 0) {
        if (Number(art.prix_traitement) > 0) {
          basePu = Number(art.prix_traitement) / oldCoef;
        } else if (Number(art.prix_total) > 0) {
          basePu = Number(art.prix_total) / (qte * oldCoef);
        }
      }
      const newPrixTraitement = Math.round(basePu * newCoef);
      const newPrixTotal = Math.round(newPrixTraitement * qte);
      return {
        id: art.id,
        prix_traitement: newPrixTraitement,
        prix_total: newPrixTotal,
      };
    });

    const newArticlesSubtotal = updatedArticles.reduce((sum, a) => sum + a.prix_total, 0);
    const existingTauxRemise = Number(depot.taux_remise ?? 0);
    const existingMontantRemise = Number(depot.montant_remise ?? 0);

    let newTauxRemise = 0;
    let newMontantRemise = 0;
    let clientDiscountRemoved = false;

    if (existingTauxRemise > 0) {
      if (newCoef <= 1) {
        newTauxRemise = existingTauxRemise;
        newMontantRemise = Math.round((newArticlesSubtotal * newTauxRemise) / 100);
      } else {
        newTauxRemise = 0;
        newMontantRemise = 0;
        clientDiscountRemoved = true;
      }
    } else if (existingMontantRemise > 0) {
      newMontantRemise = Math.min(existingMontantRemise, newArticlesSubtotal);
    }

    const pickupFee = depot.pickup_requested ? (Number(depot.frais_collecte) || 0) : 0;
    const deliveryFee = depot.delivery_requested ? (Number(depot.frais_livraison) || 0) : 0;
    const newTotal = Math.max(0, newArticlesSubtotal - newMontantRemise) + pickupFee + deliveryFee;

    const oldTotal = Number(depot.total) || 0;
    const delta = newTotal - oldTotal;
    const newReste = Math.max(0, newTotal - totalPaye);
    const tropPercu = Math.max(0, totalPaye - newTotal);

    return {
      newCoef,
      updatedArticles,
      newArticlesSubtotal,
      newTauxRemise,
      newMontantRemise,
      clientDiscountRemoved,
      newTotal,
      oldTotal,
      delta,
      newReste,
      tropPercu,
    };
  }, [depot, selectedType, totalPaye]);

  const currentTypeLabel = getTraitementLabelById(
    depot.type_traitement_id,
    typesTraitement,
    depot.traitement,
  );
  const initialDateStr = toLocalDateInputValue(depot.date_retrait_prevue);
  const hasChanged =
    Boolean(selectedType) &&
    (selectedTypeId !== initialTypeId ||
      (selectedType?.libelle ?? '') !== (depot.traitement ?? '') ||
      dateRetraitInput !== initialDateStr);

  async function handleSave() {
    if (!selectedType || saving) return;
    setSaving(true);
    setError(null);

    try {
      for (const art of preview.updatedArticles) {
        if (!art.id) continue;
        const artErr = await db.updateDepotArticle(art.id, {
          prix_traitement: art.prix_traitement,
          prix_total: art.prix_total,
        });
        if (artErr) {
          throw new Error(artErr);
        }
      }

      const dateRetraitIso = dateRetraitInput
        ? new Date(`${dateRetraitInput}T18:00:00`).toISOString()
        : depot.date_retrait_prevue;

      const depotUpdate: Record<string, unknown> = {
        type_traitement_id: selectedType.id,
        traitement: selectedType.libelle,
        coefficient: preview.newCoef,
        total: preview.newTotal,
        taux_remise: preview.newTauxRemise,
        montant_remise: preview.newMontantRemise,
        date_retrait_prevue: dateRetraitIso,
      };

      if (depot.commercial_id && depot.commission_taux != null) {
        depotUpdate.commission_montant = Math.round(
          (preview.newTotal * Number(depot.commission_taux)) / 100,
        );
      }

      const depotErr = await db.updateDepot(depot.id, depotUpdate);
      if (depotErr) {
        throw new Error(depotErr);
      }

      await onSaved();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : lang === 'fr'
            ? 'Erreur lors de la modification du traitement'
            : 'Error updating treatment type',
      );
    } finally {
      setSaving(false);
    }
  }

  const clientNom = depot.client?.nom ?? depot.clients?.nom ?? '—';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6 overflow-y-auto"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-900 truncate">
                {lang === 'fr' ? 'Modifier le type de traitement' : 'Edit treatment type'}
              </h3>
              <p className="text-xs text-slate-500 truncate">
                {depot.numero ?? '—'} · {clientNom}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
            aria-label={lang === 'fr' ? 'Fermer' : 'Close'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Current treatment info */}
          <div className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
            <span className="text-slate-500">
              {lang === 'fr' ? 'Traitement actuel' : 'Current treatment'}
            </span>
            <span className="font-semibold text-slate-800">
              {currentTypeLabel} (×{Number(depot.coefficient) || 1})
            </span>
          </div>

          {/* Treatment selection */}
          <div>
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
              {lang === 'fr' ? 'Nouveau type de traitement' : 'New treatment type'}
            </p>
            <div className="grid grid-cols-1 gap-2">
              {typesTraitement.map((tt) => {
                const isSelected = tt.id === selectedTypeId;
                const isCurrent = tt.id === initialTypeId;
                return (
                  <button
                    key={tt.id}
                    type="button"
                    onClick={() => handleSelectType(tt.id)}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-left transition-all ${
                      isSelected
                        ? 'border-sky-500 bg-sky-50/70 ring-1 ring-sky-500'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-semibold ${isSelected ? 'text-sky-900' : 'text-slate-800'}`}>
                          {tt.libelle}
                        </span>
                        {isCurrent && (
                          <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-slate-200/80 text-slate-600">
                            {lang === 'fr' ? 'Actuel' : 'Current'}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {lang === 'fr'
                          ? `Coefficient ×${Number(tt.coefficient)} · Délai ${tt.nb_jours} j`
                          : `Multiplier ×${Number(tt.coefficient)} · ${tt.nb_jours} day(s)`}
                      </p>
                    </div>
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                        isSelected ? 'bg-sky-500 text-white' : 'border border-slate-300'
                      }`}
                    >
                      {isSelected && <Check className="w-3 h-3" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Expected pickup date */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                {lang === 'fr' ? 'Date de retrait prévue' : 'Expected pickup date'}
              </span>
            </label>
            <input
              type="date"
              value={dateRetraitInput}
              onChange={(e) => setDateRetraitInput(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
            />
            {depot.date_retrait_prevue && (
              <p className="text-[11px] text-slate-400 mt-1">
                {lang === 'fr' ? 'Précédemment :' : 'Previously:'}{' '}
                {formatDateShort(depot.date_retrait_prevue)}
              </p>
            )}
          </div>

          {/* Financial impact summary */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">
                {lang === 'fr' ? 'Montant total' : 'Total amount'}
              </span>
              <div className="flex items-center gap-1.5 font-semibold">
                <span className="text-slate-500">{formatPrice(preview.oldTotal)}</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-slate-900">{formatPrice(preview.newTotal)}</span>
              </div>
            </div>

            {preview.delta !== 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">
                  {lang === 'fr' ? 'Différence' : 'Difference'}
                </span>
                <span
                  className={`font-semibold ${
                    preview.delta > 0 ? 'text-amber-600' : 'text-emerald-600'
                  }`}
                >
                  {preview.delta > 0 ? '+' : ''}
                  {formatPrice(preview.delta)}
                </span>
              </div>
            )}

            {preview.newMontantRemise > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-emerald-600">
                  {lang === 'fr'
                    ? preview.newTauxRemise > 0
                      ? `Remise (${preview.newTauxRemise}%)`
                      : 'Remise'
                    : preview.newTauxRemise > 0
                      ? `Discount (${preview.newTauxRemise}%)`
                      : 'Discount'}
                </span>
                <span className="font-semibold text-emerald-600">
                  −{formatPrice(preview.newMontantRemise)}
                </span>
              </div>
            )}

            {preview.clientDiscountRemoved && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                {lang === 'fr'
                  ? 'La remise client ne s’applique pas aux traitements avec coefficient supérieur à 1.'
                  : 'Client discount does not apply to treatments with multiplier greater than 1.'}
              </p>
            )}

            <div className="pt-2 border-t border-slate-200/80 space-y-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">
                  {lang === 'fr' ? 'Déjà encaissé' : 'Already paid'}
                </span>
                <span className="font-medium text-emerald-700">{formatPrice(totalPaye)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600 font-medium">
                  {lang === 'fr' ? 'Nouveau reste à payer' : 'New balance due'}
                </span>
                <span
                  className={`font-bold ${
                    preview.newReste > 0 ? 'text-red-600' : 'text-emerald-600'
                  }`}
                >
                  {formatPrice(preview.newReste)}
                </span>
              </div>
            </div>

            {preview.tropPercu > 0 && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-2 text-xs text-amber-800">
                <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                <span>
                  {lang === 'fr'
                    ? `Trop-perçu de ${formatPrice(preview.tropPercu)} par rapport au nouveau montant total.`
                    : `Overpayment of ${formatPrice(preview.tropPercu)} compared to the new total amount.`}
                </span>
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50/50 flex gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            {lang === 'fr' ? 'Annuler' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !selectedType || !hasChanged}
            className="flex-1 px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {saving ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <Check className="w-4 h-4" />
                {lang === 'fr' ? 'Enregistrer' : 'Save'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
