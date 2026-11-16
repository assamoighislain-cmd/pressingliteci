import { useState, useEffect, useCallback } from 'react';
import { db } from '@/lib/db';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import type { Consommable, ConsommableMouvement } from '@/types';
import { formatPrice } from '@/types';
import { Package, Plus, Minus, AlertTriangle, Trash2, History, X, Save, PackageOpen } from 'lucide-react';

export default function ConsommablesPage() {
  const { t, lang } = useI18n();
  const { role } = useAuth();
  const canEdit = role === 'admin' || role === 'gerant';

  const [consommables, setConsommables] = useState<Consommable[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mouvementModal, setMouvementModal] = useState<Consommable | null>(null);
  const [historyModal, setHistoryModal] = useState<Consommable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [nom, setNom] = useState('');
  const [unite, setUnite] = useState('pièce');
  const [quantite, setQuantite] = useState('0');
  const [seuilAlerte, setSeuilAlerte] = useState('0');
  const [prixUnitaire, setPrixUnitaire] = useState('0');
  const [fournisseur, setFournisseur] = useState('');
  const [saving, setSaving] = useState(false);

  // Mouvement form
  const [mvtType, setMvtType] = useState<'entree' | 'sortie'>('entree');
  const [mvtQuantite, setMvtQuantite] = useState('1');
  const [mvtMotif, setMvtMotif] = useState('');
  const [mvtSaving, setMvtSaving] = useState(false);

  // History
  const [mouvements, setMouvements] = useState<ConsommableMouvement[]>([]);
  const [histLoading, setHistLoading] = useState(false);

  const loadConsommables = useCallback(async () => {
    setLoading(true);
    setError(null);
    const data = await db.getAllConsommables();
    setConsommables(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadConsommables();
  }, [loadConsommables]);

  function resetForm() {
    setNom('');
    setUnite('pièce');
    setQuantite('0');
    setSeuilAlerte('0');
    setPrixUnitaire('0');
    setFournisseur('');
    setEditingId(null);
  }

  function openCreate() {
    resetForm();
    setShowForm(true);
  }

  function openEdit(c: Consommable) {
    setEditingId(c.id);
    setNom(c.nom);
    setUnite(c.unite);
    setQuantite(String(c.quantite));
    setSeuilAlerte(String(c.seuil_alerte));
    setPrixUnitaire(String(c.prix_unitaire));
    setFournisseur(c.fournisseur ?? '');
    setShowForm(true);
  }

  async function handleSave() {
    if (!nom.trim()) {
      setError(lang === 'fr' ? 'Le nom est obligatoire' : 'Name is required');
      return;
    }
    setSaving(true);
    setError(null);
    const values = {
      nom: nom.trim(),
      unite: unite.trim() || 'pièce',
      quantite: Number(quantite) || 0,
      seuil_alerte: Number(seuilAlerte) || 0,
      prix_unitaire: Number(prixUnitaire) || 0,
      fournisseur: fournisseur.trim() || null,
    };

    if (editingId) {
      const err = await db.updateConsommable(editingId, values);
      if (err) {
        setError(err);
        setSaving(false);
        return;
      }
      setSuccess(lang === 'fr' ? 'Consommable modifié' : 'Consumable updated');
    } else {
      const { error: insErr } = await db.insertConsommable(values);
      if (insErr) {
        setError(insErr);
        setSaving(false);
        return;
      }
      setSuccess(lang === 'fr' ? 'Consommable ajouté' : 'Consumable added');
    }

    setSaving(false);
    setShowForm(false);
    resetForm();
    await loadConsommables();
    setTimeout(() => setSuccess(null), 3000);
  }

  async function handleDelete(c: Consommable) {
    if (!confirm(lang === 'fr' ? `Supprimer « ${c.nom} » ?` : `Delete "${c.nom}"?`)) return;
    const err = await db.deleteConsommable(c.id);
    if (err) {
      setError(err);
      return;
    }
    await loadConsommables();
    setSuccess(lang === 'fr' ? 'Consommable supprimé' : 'Consumable deleted');
    setTimeout(() => setSuccess(null), 3000);
  }

  async function handleMouvement() {
    if (!mouvementModal) return;
    const qte = Number(mvtQuantite);
    if (!qte || qte <= 0) {
      setError(lang === 'fr' ? 'Quantité invalide' : 'Invalid quantity');
      return;
    }
    setMvtSaving(true);
    setError(null);
    const err = await db.addMouvement(mouvementModal.id, mvtType, qte, mvtMotif.trim() || null);
    if (err) {
      setError(err);
      setMvtSaving(false);
      return;
    }
    setMvtSaving(false);
    setMouvementModal(null);
    setMvtQuantite('1');
    setMvtMotif('');
    setMvtType('entree');
    await loadConsommables();
    setSuccess(lang === 'fr' ? 'Stock mis à jour' : 'Stock updated');
    setTimeout(() => setSuccess(null), 3000);
  }

  async function openHistory(c: Consommable) {
    setHistoryModal(c);
    setHistLoading(true);
    const mvts = await db.getMouvements(c.id);
    setMouvements(mvts);
    setHistLoading(false);
  }

  const lowStockItems = consommables.filter((c) => c.quantite <= c.seuil_alerte);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center shadow-sm">
            <Package className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              {lang === 'fr' ? 'Stock des consommables' : 'Consumables stock'}
            </h1>
            <p className="text-sm text-slate-500">
              {lang === 'fr'
                ? 'Gérez vos produits et fournitures de pressing.'
                : 'Manage your dry cleaning products and supplies.'}
            </p>
          </div>
        </div>
        {canEdit && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-teal-500 text-white text-sm font-medium hover:bg-teal-600 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            {lang === 'fr' ? 'Ajouter un consommable' : 'Add consumable'}
          </button>
        )}
      </div>

      {/* Alerts & messages */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-100 text-red-700 text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto"><X className="w-4 h-4" /></button>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm">
          <Save className="w-4 h-4 flex-shrink-0" />
          {success}
          <button onClick={() => setSuccess(null)} className="ml-auto"><X className="w-4 h-4" /></button>
        </div>
      )}
      {lowStockItems.length > 0 && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-amber-50 border border-amber-100 text-amber-800 text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-medium">
              {lang === 'fr' ? 'Alerte stock bas : ' : 'Low stock alert: '}
            </span>
            {lowStockItems.map((c) => c.nom).join(', ')}
          </div>
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <div className="animate-pulse text-sm">{lang === 'fr' ? 'Chargement…' : 'Loading…'}</div>
        </div>
      ) : consommables.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <PackageOpen className="w-12 h-12 mb-3 opacity-50" />
          <p className="text-sm">
            {lang === 'fr' ? 'Aucun consommable pour le moment.' : 'No consumables yet.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {consommables.map((c) => {
            const isLow = c.quantite <= c.seuil_alerte;
            return (
              <div
                key={c.id}
                className={`bg-white rounded-xl border shadow-sm p-5 transition-all hover:shadow-md ${
                  isLow ? 'border-amber-200' : 'border-slate-100'
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                      isLow ? 'bg-amber-50' : 'bg-teal-50'
                    }`}>
                      <Package className={`w-5 h-5 ${isLow ? 'text-amber-600' : 'text-teal-600'}`} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900 text-sm leading-tight">{c.nom}</h3>
                      {c.fournisseur && (
                        <p className="text-xs text-slate-400 mt-0.5">{c.fournisseur}</p>
                      )}
                    </div>
                  </div>
                  {isLow && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[0.65rem] font-semibold bg-amber-50 text-amber-700 border border-amber-100">
                      <AlertTriangle className="w-3 h-3" />
                      {lang === 'fr' ? 'Bas' : 'Low'}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <p className="text-[0.7rem] text-slate-400 uppercase tracking-wide">
                      {lang === 'fr' ? 'Stock actuel' : 'Current stock'}
                    </p>
                    <p className={`text-lg font-bold ${isLow ? 'text-amber-600' : 'text-slate-900'}`}>
                      {Number(c.quantite)} <span className="text-sm font-normal text-slate-400">{c.unite}</span>
                    </p>
                  </div>
                  <div>
                    <p className="text-[0.7rem] text-slate-400 uppercase tracking-wide">
                      {lang === 'fr' ? 'Seuil d\'alerte' : 'Alert threshold'}
                    </p>
                    <p className="text-lg font-bold text-slate-700">
                      {Number(c.seuil_alerte)} <span className="text-sm font-normal text-slate-400">{c.unite}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-500 mb-4">
                  <span>
                    {lang === 'fr' ? 'Prix unit.' : 'Unit price'}: <span className="font-medium text-slate-700">{formatPrice(c.prix_unitaire)}</span>
                  </span>
                  <span className="text-slate-300">{c.unite}</span>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {canEdit && (
                    <>
                      <button
                        onClick={() => { setMouvementModal(c); setMvtType('entree'); setMvtQuantite('1'); setMvtMotif(''); }}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-medium hover:bg-emerald-100 transition-colors border border-emerald-100"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        {lang === 'fr' ? 'Entrée' : 'In'}
                      </button>
                      <button
                        onClick={() => { setMouvementModal(c); setMvtType('sortie'); setMvtQuantite('1'); setMvtMotif(''); }}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-50 text-rose-700 text-xs font-medium hover:bg-rose-100 transition-colors border border-rose-100"
                      >
                        <Minus className="w-3.5 h-3.5" />
                        {lang === 'fr' ? 'Sortie' : 'Out'}
                      </button>
                      <button
                        onClick={() => openEdit(c)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-50 text-slate-600 text-xs font-medium hover:bg-slate-100 transition-colors border border-slate-100"
                      >
                        {lang === 'fr' ? 'Modifier' : 'Edit'}
                      </button>
                      <button
                        onClick={() => handleDelete(c)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-50 text-red-600 text-xs font-medium hover:bg-red-100 transition-colors border border-red-100"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => openHistory(c)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-sky-50 text-sky-700 text-xs font-medium hover:bg-sky-100 transition-colors border border-sky-100 ml-auto"
                  >
                    <History className="w-3.5 h-3.5" />
                    {lang === 'fr' ? 'Historique' : 'History'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-slate-900">
                {editingId ? (lang === 'fr' ? 'Modifier le consommable' : 'Edit consumable') : (lang === 'fr' ? 'Nouveau consommable' : 'New consumable')}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{lang === 'fr' ? 'Nom *' : 'Name *'}</label>
                <input
                  value={nom}
                  onChange={(e) => setNom(e.target.value)}
                  placeholder={lang === 'fr' ? 'Ex: Détergent' : 'e.g. Detergent'}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-400"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{lang === 'fr' ? 'Unité' : 'Unit'}</label>
                  <input
                    value={unite}
                    onChange={(e) => setUnite(e.target.value)}
                    placeholder="pièce, L, kg…"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{lang === 'fr' ? 'Stock initial' : 'Initial stock'}</label>
                  <input
                    type="number"
                    value={quantite}
                    onChange={(e) => setQuantite(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-400"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{lang === 'fr' ? 'Seuil d\'alerte' : 'Alert threshold'}</label>
                  <input
                    type="number"
                    value={seuilAlerte}
                    onChange={(e) => setSeuilAlerte(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{lang === 'fr' ? 'Prix unitaire' : 'Unit price'}</label>
                  <input
                    type="number"
                    value={prixUnitaire}
                    onChange={(e) => setPrixUnitaire(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-400"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{lang === 'fr' ? 'Fournisseur' : 'Supplier'}</label>
                <input
                  value={fournisseur}
                  onChange={(e) => setFournisseur(e.target.value)}
                  placeholder={lang === 'fr' ? 'Nom du fournisseur' : 'Supplier name'}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-400"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                {lang === 'fr' ? 'Annuler' : 'Cancel'}
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 px-4 py-2.5 rounded-lg bg-teal-500 text-white text-sm font-medium hover:bg-teal-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving ? '…' : (lang === 'fr' ? 'Enregistrer' : 'Save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mouvement modal */}
      {mouvementModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setMouvementModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-slate-900">
                {mvtType === 'entree' ? (lang === 'fr' ? 'Entrée de stock' : 'Stock in') : (lang === 'fr' ? 'Sortie de stock' : 'Stock out')}
              </h2>
              <button onClick={() => setMouvementModal(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-slate-500 mb-4">{mouvementModal.nom}</p>
            <div className="space-y-4">
              <div className="flex gap-2">
                <button
                  onClick={() => setMvtType('entree')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    mvtType === 'entree' ? 'bg-emerald-500 text-white' : 'bg-slate-50 text-slate-600 border border-slate-200'
                  }`}
                >
                  <Plus className="w-4 h-4" />
                  {lang === 'fr' ? 'Entrée' : 'In'}
                </button>
                <button
                  onClick={() => setMvtType('sortie')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    mvtType === 'sortie' ? 'bg-rose-500 text-white' : 'bg-slate-50 text-slate-600 border border-slate-200'
                  }`}
                >
                  <Minus className="w-4 h-4" />
                  {lang === 'fr' ? 'Sortie' : 'Out'}
                </button>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {lang === 'fr' ? 'Quantité' : 'Quantity'} ({mouvementModal.unite})
                </label>
                <input
                  type="number"
                  value={mvtQuantite}
                  onChange={(e) => setMvtQuantite(e.target.value)}
                  autoFocus
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {lang === 'fr' ? 'Motif (optionnel)' : 'Reason (optional)'}
                </label>
                <input
                  value={mvtMotif}
                  onChange={(e) => setMvtMotif(e.target.value)}
                  placeholder={lang === 'fr' ? 'Ex: Achat, utilisation…' : 'e.g. Purchase, usage…'}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-400"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setMouvementModal(null)}
                className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                {lang === 'fr' ? 'Annuler' : 'Cancel'}
              </button>
              <button
                onClick={handleMouvement}
                disabled={mvtSaving}
                className={`flex-1 px-4 py-2.5 rounded-lg text-white text-sm font-medium transition-colors disabled:opacity-50 ${
                  mvtType === 'entree' ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-rose-500 hover:bg-rose-600'
                }`}
              >
                {mvtSaving ? '…' : (lang === 'fr' ? 'Valider' : 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History modal */}
      {historyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setHistoryModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-sky-600" />
                <h2 className="text-lg font-bold text-slate-900">
                  {lang === 'fr' ? 'Historique — ' : 'History — '}{historyModal.nom}
                </h2>
              </div>
              <button onClick={() => setHistoryModal(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            {histLoading ? (
              <div className="flex items-center justify-center py-10 text-slate-400 text-sm">{lang === 'fr' ? 'Chargement…' : 'Loading…'}</div>
            ) : mouvements.length === 0 ? (
              <div className="flex items-center justify-center py-10 text-slate-400 text-sm">
                {lang === 'fr' ? 'Aucun mouvement enregistré.' : 'No movements recorded.'}
              </div>
            ) : (
              <div className="space-y-2 overflow-y-auto flex-1">
                {mouvements.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-100">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      m.type_mouvement === 'entree' ? 'bg-emerald-50' : 'bg-rose-50'
                    }`}>
                      {m.type_mouvement === 'entree'
                        ? <Plus className="w-4 h-4 text-emerald-600" />
                        : <Minus className="w-4 h-4 text-rose-600" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900">
                        {m.type_mouvement === 'entree' ? '+' : '−'}{Number(m.quantite)} {historyModal.unite}
                      </p>
                      {m.motif && <p className="text-xs text-slate-400 truncate">{m.motif}</p>}
                    </div>
                    <span className="text-xs text-slate-400 flex-shrink-0">
                      {new Date(m.date_mouvement).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
