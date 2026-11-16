import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { db } from '@/lib/db';
import type { Boutique } from '@/types';
import { Store, Plus, Edit2, Trash2, Star, X, Loader2, MapPin, Phone, Building2 } from 'lucide-react';

export default function BoutiquesPage() {
  const { t, lang } = useI18n();
  const { boutiques, currentBoutique, setBoutique, reloadBoutiques, role } = useAuth();
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingBoutique, setEditingBoutique] = useState<Boutique | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ nom: '', adresse: '', ville: '', telephone: '' });

  useEffect(() => {
    setLoading(false);
  }, []);

  function openCreate() {
    setEditingBoutique(null);
    setForm({ nom: '', adresse: '', ville: '', telephone: '' });
    setError(null);
    setShowModal(true);
  }

  function openEdit(b: Boutique) {
    setEditingBoutique(b);
    setForm({
      nom: b.nom,
      adresse: b.adresse ?? '',
      ville: b.ville ?? '',
      telephone: b.telephone ?? '',
    });
    setError(null);
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.nom.trim()) {
      setError(lang === 'fr' ? 'Le nom est obligatoire' : 'Name is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editingBoutique) {
        const err = await db.updateBoutique(editingBoutique.id, {
          nom: form.nom.trim(),
          adresse: form.adresse.trim() || null,
          ville: form.ville.trim() || null,
          telephone: form.telephone.trim() || null,
        });
        if (err) {
          setError(err);
          return;
        }
      } else {
        const { error: insErr } = await db.insertBoutique({
          nom: form.nom.trim(),
          adresse: form.adresse.trim() || null,
          ville: form.ville.trim() || null,
          telephone: form.telephone.trim() || null,
        });
        if (insErr) {
          setError(insErr);
          return;
        }
      }
      await reloadBoutiques();
      setShowModal(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(b: Boutique) {
    if (b.is_default) return;
    if (boutiques.length <= 1) return;
    const confirmMsg = lang === 'fr'
      ? `Supprimer la boutique « ${b.nom} » ? Les données associées ne seront pas supprimées mais ne seront plus liées à cette boutique.`
      : `Delete boutique "${b.nom}"? Associated data will not be deleted but will no longer be linked to this boutique.`;
    if (!window.confirm(confirmMsg)) return;
    const err = await db.deleteBoutique(b.id);
    if (err) {
      setError(err);
      return;
    }
    if (currentBoutique?.id === b.id) {
      const remaining = boutiques.filter((x) => x.id !== b.id);
      if (remaining.length > 0) setBoutique(remaining[0]);
    }
    await reloadBoutiques();
  }

  async function handleSetDefault(b: Boutique) {
    if (b.is_default) return;
    const err = await db.setDefaultBoutique(b.id);
    if (err) {
      setError(err);
      return;
    }
    await reloadBoutiques();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-sky-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('boutiques.title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('boutiques.subtitle')}</p>
        </div>
        {role === 'admin' && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            {t('boutiques.add')}
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Boutique cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {boutiques.map((b) => (
          <div
            key={b.id}
            className={`relative bg-white rounded-xl border p-5 transition-all ${
              currentBoutique?.id === b.id
                ? 'border-sky-300 ring-2 ring-sky-100'
                : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            {b.is_default && (
              <span className="absolute top-3 right-3 flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-xs text-amber-700 font-medium">
                <Star className="w-3 h-3" />
                {t('boutiques.default')}
              </span>
            )}
            <div className="flex items-start gap-3 mb-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                currentBoutique?.id === b.id ? 'bg-sky-100 text-sky-600' : 'bg-slate-100 text-slate-400'
              }`}>
                <Store className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-slate-900 truncate">{b.nom}</h3>
                {b.ville && <p className="text-xs text-slate-500 mt-0.5">{b.ville}</p>}
              </div>
            </div>

            <div className="space-y-1.5 text-sm text-slate-600">
              {b.adresse && (
                <div className="flex items-start gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
                  <span className="truncate">{b.adresse}</span>
                </div>
              )}
              {b.telephone && (
                <div className="flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                  <span>{b.telephone}</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">
              {currentBoutique?.id !== b.id && (
                <button
                  onClick={() => setBoutique(b)}
                  className="flex-1 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 hover:bg-slate-100 transition-colors font-medium"
                >
                  {t('boutiques.select')}
                </button>
              )}
              {currentBoutique?.id === b.id && (
                <span className="flex-1 text-center px-3 py-1.5 rounded-lg bg-sky-50 border border-sky-100 text-xs text-sky-700 font-medium">
                  {t('boutiques.current')}
                </span>
              )}
              {role === 'admin' && (
                <>
                  {!b.is_default && (
                    <button
                      onClick={() => handleSetDefault(b)}
                      title={t('boutiques.set_default')}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-amber-50 hover:text-amber-600 transition-colors"
                    >
                      <Star className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => openEdit(b)}
                    title={t('common.edit')}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  {!b.is_default && boutiques.length > 1 && (
                    <button
                      onClick={() => handleDelete(b)}
                      title={t('common.delete')}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Create/Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                {editingBoutique ? t('boutiques.edit') : t('boutiques.add')}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  {t('boutiques.name')} *
                </label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={form.nom}
                    onChange={(e) => setForm({ ...form, nom: e.target.value })}
                    placeholder={t('boutiques.name_placeholder')}
                    className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  {t('boutiques.address')}
                </label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={form.adresse}
                    onChange={(e) => setForm({ ...form, adresse: e.target.value })}
                    placeholder={t('boutiques.address_placeholder')}
                    className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    {t('boutiques.city')}
                  </label>
                  <input
                    type="text"
                    value={form.ville}
                    onChange={(e) => setForm({ ...form, ville: e.target.value })}
                    placeholder={t('boutiques.city_placeholder')}
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    {t('boutiques.phone')}
                  </label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="tel"
                      value={form.telephone}
                      onChange={(e) => setForm({ ...form, telephone: e.target.value })}
                      placeholder={t('boutiques.phone_placeholder')}
                      className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                    />
                  </div>
                </div>
              </div>
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-600 hover:bg-slate-100 transition-colors font-medium"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
