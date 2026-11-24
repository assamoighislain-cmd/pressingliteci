import { useState, useEffect, useCallback } from 'react';
import { db } from '@/lib/db';
import { useI18n } from '@/lib/i18n';
import { ModeReglementRow } from '@/types';
import { CreditCard, Plus, Pencil, Trash2, Check, X } from 'lucide-react';

export default function ModesReglement() {
  const { t, lang } = useI18n();
  const [modes, setModes] = useState<ModeReglementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingMode, setEditingMode] = useState<ModeReglementRow | null>(null);
  const [newModeLabel, setNewModeLabel] = useState('');
  const [newModeTaux, setNewModeTaux] = useState('0');
  const [showAddMode, setShowAddMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setModes(await db.getModesReglement());
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur de chargement' : 'Loading error'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd() {
    if (!newModeLabel.trim()) return;
    setError(null);
    setSaving(true);
    try {
      const taux = parseFloat(newModeTaux) || 0;
      const err = await db.insertModeReglement({ designation: newModeLabel.trim(), taux_remise: taux });
      if (err) {
        setError(err);
        return;
      }
      setNewModeLabel('');
      setNewModeTaux('0');
      setShowAddMode(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de l\'ajout' : 'Error during addition'));
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(id: number, designation: string, tauxRemise: number) {
    setError(null);
    setSaving(true);
    try {
      const err = await db.updateModeReglement(id, { designation, taux_remise: tauxRemise });
      if (err) {
        setError(err);
        return;
      }
      setEditingMode(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de la modification' : 'Error during modification'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    setError(null);
    setSaving(true);
    try {
      const err = await db.deleteModeReglement(id);
      if (err) {
        setError(err);
        return;
      }
      setConfirmDeleteId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de la suppression' : 'Error during deletion'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-900">{t('nav.modesReglement')}</h2>
        <p className="text-sm text-slate-500 mt-1">
          {lang === 'fr' ? 'Gérez les modes de paiement disponibles lors des dépôts et règlements.' : 'Manage the payment methods available during deposits and payments.'}
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        {error && (
          <div className="p-3 bg-red-50 border-b border-red-100 flex items-start gap-2">
            <X className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">{t('common.loading')}</div>
        ) : modes.length === 0 && !showAddMode ? (
          <div className="p-8 text-center">
            <p className="text-slate-400 text-sm">{lang === 'fr' ? 'Aucun mode de règlement configuré.' : 'No payment method configured.'}</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {modes.map((mode) => (
              <div key={mode.id} className="px-5 py-3.5 flex items-center justify-between">
                {editingMode?.id === mode.id ? (
                  <div className="flex-1 flex items-center gap-2">
                    <input
                      type="text"
                      value={editingMode.designation}
                      onChange={(e) => setEditingMode({ ...editingMode, designation: e.target.value })}
                      className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      value={String(editingMode.taux_remise ?? 0)}
                      onChange={(e) => setEditingMode({ ...editingMode, taux_remise: parseFloat(e.target.value) || 0 })}
                      placeholder="%"
                      className="w-16 px-2 py-2 rounded-lg border border-slate-200 text-sm text-center focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                    <span className="text-sm text-slate-400">%</span>
                    <button
                      onClick={() => handleUpdate(editingMode.id, editingMode.designation, editingMode.taux_remise ?? 0)}
                      className="p-2 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setEditingMode(null)}
                      className="p-2 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                        <CreditCard className="w-4 h-4 text-amber-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{mode.designation}</p>
                        {mode.taux_remise > 0 && (
                          <p className="text-xs text-emerald-600 font-medium">{lang === 'fr' ? 'Remise' : 'Discount'}: {mode.taux_remise}%</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-3">
                      {confirmDeleteId === mode.id ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleDelete(mode.id)}
                            disabled={saving}
                            className="px-2.5 py-1.5 rounded-lg bg-red-500 text-white text-xs font-medium hover:bg-red-600 transition-colors disabled:opacity-50"
                          >
                            {lang === 'fr' ? 'Confirmer' : 'Confirm'}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            disabled={saving}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs font-medium hover:bg-slate-200 transition-colors"
                          >
                            {t('common.cancel')}
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => { setConfirmDeleteId(null); setEditingMode(mode); }}
                            className="p-2 rounded-lg text-slate-400 hover:text-sky-500 hover:bg-sky-50 transition-all"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(mode.id)}
                            className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {showAddMode ? (
          <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/50 space-y-3">
            <input
              type="text"
              value={newModeLabel}
              onChange={(e) => setNewModeLabel(e.target.value)}
              placeholder={lang === 'fr' ? 'Désignation (ex: Espèces, Mobile Money, Chèque…)' : 'Designation (ex: Cash, Mobile Money, Check…)'}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-500 whitespace-nowrap">{lang === 'fr' ? 'Taux de remise' : 'Discount rate'}</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={newModeTaux}
                onChange={(e) => setNewModeTaux(e.target.value)}
                className="w-20 px-2 py-2 rounded-lg border border-slate-200 text-sm text-center focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
              />
              <span className="text-sm text-slate-400">%</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleAdd}
                disabled={saving || !newModeLabel.trim()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Check className="w-4 h-4" /> {lang === 'fr' ? 'Ajouter' : 'Add'}
              </button>
              <button
                onClick={() => { setShowAddMode(false); setNewModeLabel(''); }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm font-medium hover:bg-slate-200 transition-colors"
              >
                <X className="w-4 h-4" /> {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowAddMode(true)}
            className="w-full flex items-center justify-center gap-2 py-3.5 text-sm font-medium text-slate-500 hover:text-sky-600 hover:bg-sky-50/50 transition-all border-t border-slate-100"
          >
            <Plus className="w-4 h-4" /> {lang === 'fr' ? 'Ajouter un mode de règlement' : 'Add a payment method'}
          </button>
        )}
      </div>
    </div>
  );
}
