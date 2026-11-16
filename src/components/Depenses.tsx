import { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/db';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { Depense, DepenseCategory, ModeReglementRow, formatPrice, formatDateShort } from '@/types';
import {
  Receipt,
  Plus,
  Pencil,
  Trash2,
  X,
  Save,
  TrendingDown,
  CalendarDays,
  Filter,
  Tag,
  Settings2,
  Check,
  Printer,
} from 'lucide-react';
import { PrintableReport, printReport, type ReportData } from '@/components/PrintableReport';
import type { Entreprise } from '@/types';

type PeriodFilter = 'today' | 'week' | 'month' | 'all' | 'custom';

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}
function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}
function getWeekStart(d: Date): Date {
  const r = startOfDay(d);
  const day = r.getDay();
  const diff = day === 0 ? 6 : day - 1;
  r.setDate(r.getDate() - diff);
  return r;
}
function getMonthStart(d: Date): Date {
  const r = startOfDay(d);
  r.setDate(1);
  return r;
}

export default function Depenses() {
  const { t, lang } = useI18n();
  const { role } = useAuth();
  const [depenses, setDepenses] = useState<Depense[]>([]);
  const [categories, setCategories] = useState<DepenseCategory[]>([]);
  const [modes, setModes] = useState<ModeReglementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodFilter>(role === 'commercial' ? 'today' : 'month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showCatManager, setShowCatManager] = useState(false);
  const [editing, setEditing] = useState<Depense | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [fLibelle, setFLibelle] = useState('');
  const [fCategorie, setFCategorie] = useState('');
  const [fMontant, setFMontant] = useState('');
  const [fDate, setFDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [fMode, setFMode] = useState('');
  const [fNotes, setFNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [entreprise, setEntreprise] = useState<Entreprise | null>(null);

  // Category manager state
  const [newCatName, setNewCatName] = useState('');
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState('');
  const [catError, setCatError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [depensesData, catData, modesData, entData] = await Promise.all([
        db.getAllDepenses(),
        db.getAllDepenseCategories(),
        db.getModesReglement(),
        db.getEntreprise(),
      ]);
      setDepenses(depensesData);
      setCategories(catData);
      setModes(modesData);
      setEntreprise(entData);
      setLoading(false);
    })();
  }, []);

  const { startDate, endDate, periodLabel } = useMemo(() => {
    const now = new Date();
    if (period === 'today') return { startDate: startOfDay(now), endDate: endOfDay(now), periodLabel: t('compta.today') };
    if (period === 'week') return { startDate: getWeekStart(now), endDate: endOfDay(now), periodLabel: t('compta.thisWeek') };
    if (period === 'month') return { startDate: getMonthStart(now), endDate: endOfDay(now), periodLabel: lang === 'fr' ? 'Ce mois-ci' : 'This month' };
    if (period === 'custom' && customStart && customEnd)
      return { startDate: startOfDay(new Date(customStart)), endDate: endOfDay(new Date(customEnd)), periodLabel: t('compta.customPeriod') };
    return { startDate: null, endDate: null, periodLabel: t('compta.allPeriods') };
  }, [period, customStart, customEnd]);

  const filtered = useMemo(() => {
    if (!startDate || !endDate) return depenses;
    return depenses.filter((d) => {
      const dt = new Date(d.date_depense);
      return dt >= startDate && dt <= endDate;
    });
  }, [depenses, startDate, endDate]);

  const totalDepenses = filtered.reduce((sum, d) => sum + Number(d.montant), 0);

  // Group by category
  const parCategorie = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of filtered) {
      const key = d.categorie ?? (lang === 'fr' ? 'Non classé' : 'Uncategorized');
      map.set(key, (map.get(key) ?? 0) + Number(d.montant));
    }
    return Array.from(map.entries())
      .map(([label, montant]) => ({ label, montant }))
      .sort((a, b) => b.montant - a.montant);
  }, [filtered]);

  const maxCatMontant = parCategorie.length > 0 ? Math.max(...parCategorie.map((c) => c.montant)) : 0;

  // Group by day
  const groups = useMemo(() => {
    const groupMap = new Map<string, Depense[]>();
    for (const d of filtered) {
      const key = formatDateShort(d.date_depense);
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(d);
    }
    const sortedKeys = Array.from(groupMap.keys()).sort((a, b) => b.localeCompare(a));
    return sortedKeys.map((key) => {
      const items = groupMap.get(key)!;
      const total = items.reduce((sum, d) => sum + Number(d.montant), 0);
      return { label: key, items, total };
    });
  }, [filtered]);

  async function refreshCategories() {
    const refreshed = await db.getAllDepenseCategories();
    setCategories(refreshed);
  }

  async function refreshDepenses() {
    const refreshed = await db.getAllDepenses();
    setDepenses(refreshed);
  }

  function openAdd() {
    setEditing(null);
    setFLibelle('');
    setFCategorie('');
    setFMontant('');
    setFDate(new Date().toISOString().slice(0, 10));
    setFMode('');
    setFNotes('');
    setError(null);
    setShowForm(true);
  }

  function openEdit(d: Depense) {
    setEditing(d);
    setFLibelle(d.libelle);
    setFCategorie(d.categorie ?? '');
    setFMontant(String(d.montant));
    setFDate(d.date_depense.slice(0, 10));
    setFMode(d.mode_reglement ?? '');
    setFNotes(d.notes ?? '');
    setError(null);
    setShowForm(true);
  }

  async function handleSave() {
    setError(null);
    const libelle = fLibelle.trim();
    const montant = parseFloat(fMontant);
    if (!libelle) { setError(lang === 'fr' ? 'Veuillez saisir un libellé.' : 'Please enter a label.'); return; }
    if (isNaN(montant) || montant <= 0) { setError(lang === 'fr' ? 'Veuillez saisir un montant valide.' : 'Please enter a valid amount.'); return; }

    setSaving(true);
    try {
      const payload = {
        date_depense: new Date(fDate + 'T12:00:00').toISOString(),
        libelle,
        categorie: fCategorie || null,
        montant,
        mode_reglement: fMode.trim() || null,
        notes: fNotes.trim() || null,
      };

      let err: string | null;
      if (editing) {
        err = await db.updateDepense(editing.id, payload);
      } else {
        const result = await db.insertDepense(payload);
        err = result.error;
      }

      if (err) { setError(err); return; }

      setShowForm(false);
      await refreshDepenses();
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de l\'enregistrement' : 'Error during saving'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(lang === 'fr' ? 'Supprimer cette dépense ?' : 'Delete this expense?')) return;
    setError(null);
    try {
      const err = await db.deleteDepense(id);
      if (err) { setError(err); return; }
      await refreshDepenses();
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de la suppression' : 'Error during deletion'));
    }
  }

  // Category management handlers
  async function handleAddCategory() {
    setCatError(null);
    const name = newCatName.trim();
    if (!name) { setCatError(lang === 'fr' ? 'Veuillez saisir un nom.' : 'Please enter a name.'); return; }
    if (categories.some((c) => c.libelle.toLowerCase() === name.toLowerCase())) {
      setCatError(lang === 'fr' ? 'Cette catégorie existe déjà.' : 'This category already exists.');
      return;
    }
    try {
      const result = await db.insertDepenseCategory(name);
      if (!result.data) { setCatError(result.error ?? (lang === 'fr' ? 'Erreur lors de l\'ajout.' : 'Error during addition.')); return; }
      setNewCatName('');
      await refreshCategories();
    } catch (err) {
      setCatError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de l\'ajout' : 'Error during addition'));
    }
  }

  async function handleUpdateCategory(id: string) {
    setCatError(null);
    const name = editingCatName.trim();
    if (!name) { setCatError(lang === 'fr' ? 'Veuillez saisir un nom.' : 'Please enter a name.'); return; }
    if (categories.some((c) => c.libelle.toLowerCase() === name.toLowerCase() && c.id !== id)) {
      setCatError(lang === 'fr' ? 'Cette catégorie existe déjà.' : 'This category already exists.');
      return;
    }
    try {
      const err = await db.updateDepenseCategory(id, name);
      if (err) { setCatError(err); return; }
      setEditingCatId(null);
      setEditingCatName('');
      await refreshCategories();
    } catch (err) {
      setCatError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de la modification' : 'Error during modification'));
    }
  }

  async function handleDeleteCategory(id: string, libelle: string) {
    const usedCount = depenses.filter((d) => d.categorie === libelle).length;
    const msg = usedCount > 0
      ? (lang === 'fr' ? `Cette catégorie est utilisée par ${usedCount} dépense(s). Les supprimer ne modifiera pas les dépenses existantes mais elles apparaîtront comme "Non classé". Continuer ?` : `This category is used by ${usedCount} expense(s). Deleting it will not modify existing expenses but they will appear as "Uncategorized". Continue?`)
      : (lang === 'fr' ? 'Supprimer cette catégorie ?' : 'Delete this category?');
    if (!confirm(msg)) return;
    setCatError(null);
    try {
      const err = await db.deleteDepenseCategory(id);
      if (err) { setCatError(err); return; }
      await refreshCategories();
    } catch (err) {
      setCatError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de la suppression' : 'Error during deletion'));
    }
  }

  const filterButtons: { id: PeriodFilter; label: string }[] = role === 'commercial'
    ? [{ id: 'today', label: t('compta.today') }]
    : [
        { id: 'today', label: t('compta.today') },
        { id: 'week', label: t('compta.thisWeek') },
        { id: 'month', label: t('compta.thisMonth') },
        { id: 'all', label: t('compta.all') },
        { id: 'custom', label: t('compta.custom') },
      ];

  const reportData: ReportData = {
    title: lang === 'fr' ? 'Liste des dépenses' : 'Expenses list',
    subtitle: lang === 'fr' ? 'Rapport détaillé' : 'Detailed report',
    periodLabel: periodLabel,
    entreprise,
    columns: [
      { key: 'date', label: lang === 'fr' ? 'Date' : 'Date', align: 'left', render: (r) => formatDateShort(r.date as string) ?? '—' },
      { key: 'libelle', label: lang === 'fr' ? 'Libellé' : 'Label', align: 'left', render: (r) => String(r.libelle ?? '') },
      { key: 'categorie', label: lang === 'fr' ? 'Catégorie' : 'Category', align: 'left', render: (r) => String(r.categorie ?? (lang === 'fr' ? 'Non classé' : 'Uncategorized')) },
      { key: 'mode', label: lang === 'fr' ? 'Règlement' : 'Payment', align: 'left', render: (r) => String(r.mode ?? '—') },
      { key: 'montant', label: lang === 'fr' ? 'Montant' : 'Amount', align: 'right', render: (r) => formatPrice(Number(r.montant ?? 0)) },
    ],
    rows: filtered.map((d) => ({
      date: d.date_depense,
      libelle: d.libelle,
      categorie: d.categorie,
      mode: d.mode_reglement,
      montant: d.montant,
    })),
    summaryRows: [
      { label: lang === 'fr' ? 'Nombre de dépenses' : 'Expense count', value: String(filtered.length) },
      { label: lang === 'fr' ? 'Total des dépenses' : 'Total expenses', value: formatPrice(totalDepenses), highlight: true },
    ],
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="text-center">
        <div className="w-14 h-14 rounded-2xl bg-rose-50 flex items-center justify-center mx-auto mb-3">
          <Receipt className="w-7 h-7 text-rose-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">{t('nav.depenses')}</h2>
        <p className="text-sm text-slate-500 mt-1">
          {lang === 'fr' ? 'Enregistrez et suivez les dépenses liées à votre activité.' : 'Record and track expenses related to your activity.'}
        </p>
      </div>

      {/* Period filters */}
      <div className="flex flex-wrap gap-2 justify-center">
        {filterButtons.map((btn) => (
          <button
            key={btn.id}
            onClick={() => setPeriod(btn.id)}
            className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
              period === btn.id
                ? 'bg-rose-500 text-white shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'
            }`}
          >
            {btn.label}
          </button>
        ))}
      </div>

      {period === 'custom' && (
        <div className="flex flex-wrap gap-3 items-center justify-center bg-white rounded-xl border border-slate-100 p-4">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 font-medium">{t('compta.from')}</label>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 font-medium">{t('compta.to')}</label>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent"
            />
          </div>
        </div>
      )}

      {/* Summary card */}
      {!loading && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-9 h-9 rounded-lg bg-rose-50 flex items-center justify-center">
                <TrendingDown className="w-4.5 h-4.5 text-rose-600" />
              </div>
              <p className="text-xs text-slate-400 font-medium">{lang === 'fr' ? 'Total dépenses' : 'Total expenses'}</p>
            </div>
            <p className="text-lg font-bold text-rose-600">{formatPrice(totalDepenses)}</p>
            <p className="text-xs text-slate-400 mt-0.5">{filtered.length} {lang === 'fr' ? 'dépense(s)' : 'expense(s)'}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
                <Tag className="w-4.5 h-4.5 text-slate-600" />
              </div>
              <p className="text-xs text-slate-400 font-medium">{lang === 'fr' ? 'Catégories' : 'Categories'}</p>
            </div>
            <p className="text-lg font-bold text-slate-900">{categories.length}</p>
            <p className="text-xs text-slate-400 mt-0.5">{lang === 'fr' ? 'type(s) de dépense' : 'expense type(s)'}</p>
          </div>
        </div>
      )}

      {/* Category management */}
      {!loading && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-rose-50 flex items-center justify-center">
                <Tag className="w-4.5 h-4.5 text-rose-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">{lang === 'fr' ? 'Catégories de dépenses' : 'Expense categories'}</p>
                <p className="text-xs text-slate-400">
                  {categories.length} {lang === 'fr' ? 'catégorie(s) enregistrée(s)' : 'category(ies) registered'}
                </p>
              </div>
            </div>
            <button
              onClick={() => { setShowCatManager(!showCatManager); setCatError(null); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                showCatManager
                  ? 'bg-rose-500 text-white'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Settings2 className="w-3.5 h-3.5" />
              {lang === 'fr' ? 'Gérer' : 'Manage'}
            </button>
          </div>

          {/* Category manager panel */}
          {showCatManager && (
            <div className="mb-4 p-4 rounded-lg bg-slate-50 border border-slate-100 space-y-3">
              {/* Add new category */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddCategory(); }}
                  placeholder={lang === 'fr' ? 'Nouvelle catégorie…' : 'New category…'}
                  className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent bg-white"
                />
                <button
                  onClick={handleAddCategory}
                  className="px-3 py-2 rounded-lg bg-rose-500 text-white text-sm font-medium hover:bg-rose-600 transition-colors flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" /> {lang === 'fr' ? 'Ajouter' : 'Add'}
                </button>
              </div>

              {/* Existing categories list */}
              {categories.length > 0 && (
                <div className="space-y-1.5">
                  {categories.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between px-3 py-2 rounded-lg bg-white border border-slate-100"
                    >
                      {editingCatId === c.id ? (
                        <>
                          <input
                            type="text"
                            value={editingCatName}
                            onChange={(e) => setEditingCatName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleUpdateCategory(c.id); }}
                            className="flex-1 px-2 py-1 rounded border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent"
                            autoFocus
                          />
                          <div className="flex items-center gap-1 ml-2">
                            <button
                              onClick={() => handleUpdateCategory(c.id)}
                              className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => { setEditingCatId(null); setEditingCatName(''); }}
                              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <span className="text-sm font-medium text-slate-700">{c.libelle}</span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => { setEditingCatId(c.id); setEditingCatName(c.libelle); }}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteCategory(c.id, c.libelle)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {catError && (
                <p className="text-xs text-red-600 px-1">{catError}</p>
              )}

              {categories.length === 0 && !newCatName && (
                <p className="text-xs text-slate-400 text-center py-2">
                  {lang === 'fr' ? 'Aucune catégorie. Ajoutez-en une pour commencer.' : 'No category. Add one to get started.'}
                </p>
              )}
            </div>
          )}

          {/* Category breakdown bars */}
          {parCategorie.length > 0 && (
            <div className="space-y-3">
              {parCategorie.map((c) => (
                <div key={c.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-slate-700">{c.label}</span>
                    <span className="text-sm font-semibold text-rose-600">{formatPrice(c.montant)}</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-rose-400 transition-all duration-500"
                      style={{ width: `${maxCatMontant > 0 ? (c.montant / maxCatMontant) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Print button */}
      {!loading && filtered.length > 0 && !showForm && (
        <button
          onClick={() => printReport()}
          className="w-full py-2.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 transition-colors flex items-center justify-center gap-2"
        >
          <Printer className="w-4 h-4" /> {lang === 'fr' ? 'Imprimer les dépenses' : 'Print expenses'}
        </button>
      )}

      {/* Add button */}
      {!showForm && !loading && (
        <button
          onClick={openAdd}
          className="w-full py-2.5 rounded-lg border-2 border-dashed border-slate-200 text-sm font-medium text-slate-500 hover:border-rose-300 hover:text-rose-600 transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" /> {lang === 'fr' ? 'Enregistrer une dépense' : 'Record an expense'}
        </button>
      )}

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-rose-100 shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              {editing ? (lang === 'fr' ? 'Modifier la dépense' : 'Edit expense') : (lang === 'fr' ? 'Nouvelle dépense' : 'New expense')}
            </h3>
            <button
              onClick={() => setShowForm(false)}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{lang === 'fr' ? 'Libellé' : 'Label'} *</label>
              <input
                type="text"
                value={fLibelle}
                onChange={(e) => setFLibelle(e.target.value)}
                placeholder={lang === 'fr' ? 'Ex: Achat de détergent' : 'Ex: Detergent purchase'}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{lang === 'fr' ? 'Montant (FCFA)' : 'Amount (FCFA)'} *</label>
              <input
                type="number"
                min={0}
                step="100"
                value={fMontant}
                onChange={(e) => setFMontant(e.target.value)}
                placeholder={lang === 'fr' ? 'Ex: 5000' : 'Ex: 5000'}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{lang === 'fr' ? 'Date' : 'Date'}</label>
              <input
                type="date"
                value={fDate}
                onChange={(e) => setFDate(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{lang === 'fr' ? 'Catégorie' : 'Category'}</label>
              <select
                value={fCategorie}
                onChange={(e) => setFCategorie(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent bg-white"
              >
                <option value="">{lang === 'fr' ? '— Choisir —' : '— Choose —'}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.libelle}>{c.libelle}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('depot.paymentMode')}</label>
              <select
                value={fMode}
                onChange={(e) => setFMode(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent bg-white"
              >
                <option value="">{lang === 'fr' ? '— Choisir —' : '— Choose —'}</option>
                {modes.map((m) => (
                  <option key={m.id} value={m.designation}>{m.designation}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('retrait.notes')}</label>
              <input
                type="text"
                value={fNotes}
                onChange={(e) => setFNotes(e.target.value)}
                placeholder={lang === 'fr' ? 'Notes optionnelles' : 'Optional notes'}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent"
              />
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full px-4 py-2.5 rounded-lg bg-rose-500 text-white font-medium text-sm hover:bg-rose-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {lang === 'fr' ? 'Enregistrement…' : 'Saving…'}
              </>
            ) : (
              <>
                <Save className="w-4 h-4" /> {editing ? (lang === 'fr' ? 'Modifier' : 'Edit') : t('common.save')}
              </>
            )}
          </button>
        </div>
      )}

      {/* List */}
      {loading ? (
        <p className="text-sm text-slate-400 text-center py-8">{t('common.loading')}</p>
      ) : groups.length === 0 ? (
        <div className="text-center py-12">
          <Filter className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-400">{t('compta.noData', { period: periodLabel.toLowerCase() })}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <div
              key={group.label}
              className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 py-3.5 bg-slate-50/50 border-b border-slate-50">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-rose-100 text-rose-600 flex items-center justify-center">
                    <CalendarDays className="w-4.5 h-4.5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{group.label}</p>
                    <p className="text-xs text-slate-400">{group.items.length} {lang === 'fr' ? 'dépense(s)' : 'expense(s)'}</p>
                  </div>
                </div>
                <p className="text-sm font-semibold text-rose-600 whitespace-nowrap">
                  {formatPrice(group.total)}
                </p>
              </div>
              <div className="divide-y divide-slate-50">
                {group.items.map((d) => (
                  <div
                    key={d.id}
                    className="px-5 py-3.5 flex items-center justify-between hover:bg-slate-50/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-2.5 h-2.5 rounded-full bg-rose-400 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{d.libelle}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {d.categorie ?? (lang === 'fr' ? 'Non classé' : 'Uncategorized')}
                          {d.mode_reglement ? ` · ${d.mode_reglement}` : ''}
                          {d.notes ? ` · ${d.notes}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                      <span className="text-sm font-semibold text-rose-600 whitespace-nowrap">
                        {formatPrice(Number(d.montant))}
                      </span>
                      <button
                        onClick={() => openEdit(d)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      {role === 'admin' && (
                        <button
                          onClick={() => handleDelete(d.id)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <PrintableReport data={reportData} />
    </div>
  );
}
