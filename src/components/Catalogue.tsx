import { useEffect, useState, useCallback } from 'react';
import { db, rpc } from '@/lib/db';
import { useI18n } from '@/lib/i18n';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';

import { TypeTraitement, ArticleCatalog, ArticleVariant, formatPrice } from '@/types';
import {
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Shirt,
  Clock,
  Save,
  ChevronDown,
  Tags,
  Printer,
} from 'lucide-react';
import ImportExcel from '@/components/ImportExcel';
import { PrintableReport, printReport, type ReportData } from '@/components/PrintableReport';
import type { Entreprise } from '@/types';

type Tab = 'articles' | 'traitements';

export default function Catalogue() {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<Tab>('articles');

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-900">{t('nav.catalogue')}</h2>
        <p className="text-sm text-slate-500 mt-1">
          {lang === 'fr' ? 'Gérez la liste des articles, leurs variantes et les types de traitement.' : 'Manage the list of items, their variants and treatment types.'}
        </p>
      </div>

      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl">
        <button
          onClick={() => setTab('articles')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
            tab === 'articles' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <Shirt className="w-4 h-4" /> {lang === 'fr' ? 'Articles' : 'Items'}
        </button>
        <button
          onClick={() => setTab('traitements')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
            tab === 'traitements' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <Clock className="w-4 h-4" /> {lang === 'fr' ? 'Types de traitement' : 'Treatment types'}
        </button>
      </div>

      {tab === 'articles' ? <ArticlesTab /> : <TraitementsTab />}
    </div>
  );
}

// ─── Articles Tab ─────────────────────────────────────────────

function ArticlesTab() {
  const { t, lang } = useI18n();
  const [articles, setArticles] = useState<ArticleCatalog[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDesignation, setEditDesignation] = useState('');
  const [editPrix, setEditPrix] = useState('');
  const [editPieces, setEditPieces] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newDesignation, setNewDesignation] = useState('');
  const [newPrix, setNewPrix] = useState('');
  const [newPieces, setNewPieces] = useState('1');
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [entreprise, setEntreprise] = useState<Entreprise | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setArticles(await db.getArticles());
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useRealtimeSync(['articles', 'article_variants'], () => load(true));

  async function handleAdd() {
    if (!newDesignation.trim() || !newPrix) return;
    setError(null);

    const prix = parseFloat(newPrix);
    if (isNaN(prix) || prix < 0) { setError(lang === 'fr' ? 'Veuillez saisir un prix valide.' : 'Please enter a valid price.'); return; }

    setSaving(true);
    try {
      let articleCode: string;
      const { data: rpcData, error: rpcError } = await rpc<string>('generate_article_code');
      if (rpcError || !rpcData) {
        articleCode = `A-${Date.now().toString(36).toUpperCase()}`;
      } else {
        articleCode = rpcData;
      }

      const insertError = await db.insertArticle({
        code: articleCode,
        designation: newDesignation.trim(),
        prix_unitaire: prix,
        nb_pieces: parseInt(newPieces) || 1,
      });
      if (insertError) {
        setError(insertError);
        return;
      }
      setNewDesignation('');
      setNewPrix('');
      setNewPieces('1');
      setShowAdd(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de l\'ajout' : 'Error during addition'));
    } finally {
      setSaving(false);
    }
  }

  async function handleSave(id: string) {
    setError(null);
    const prix = parseFloat(editPrix);
    if (isNaN(prix) || prix < 0) { setError(lang === 'fr' ? 'Veuillez saisir un prix valide.' : 'Please enter a valid price.'); return; }
    setSaving(true);
    try {
      const updateError = await db.updateArticle(id, {
        designation: editDesignation.trim(),
        prix_unitaire: prix,
        nb_pieces: parseInt(editPieces) || 1,
      });
      if (updateError) {
        setError(updateError);
        return;
      }
      setEditingId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de la modification' : 'Error during modification'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(lang === 'fr' ? 'Supprimer cet article du catalogue ?' : 'Delete this item from the catalog?')) return;
    setError(null);
    try {
      const deleteError = await db.deleteArticle(id);
      if (deleteError) {
        setError(deleteError);
        return;
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de la suppression' : 'Error during deletion'));
    }
  }

  function startEdit(article: ArticleCatalog) {
    setEditingId(article.id);
    setEditDesignation(article.designation);
    setEditPrix(String(article.prix_unitaire));
    setEditPieces(String(article.nb_pieces));
  }

  async function handleImportArticles(rows: Record<string, string | number | null>[], onProgress?: (current: number, total: number) => void): Promise<{ success: number; errors: string[] }> {
    let success = 0;
    const errors: string[] = [];
    const existing = await db.getArticles();
    const existingMap = new Map(existing.map((a) => [a.designation.trim().toLowerCase(), a]));
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const designation = String(row.designation ?? '').trim();
      if (!designation) { errors.push('Ligne: désignation manquante'); onProgress?.(i + 1, rows.length); continue; }
      const prix = Number(row.prix_unitaire ?? 0);
      const nbPieces = Number(row.nb_pieces ?? 1) || 1;
      try {
        const existingArticle = existingMap.get(designation.toLowerCase());
        if (existingArticle) {
          const updateError = await db.updateArticle(existingArticle.id, { designation, prix_unitaire: prix, nb_pieces: nbPieces });
          if (updateError) { errors.push(`${designation}: ${updateError}`); }
          else { success++; }
        } else {
          const { data: rpcData } = await rpc<string>('generate_article_code');
          const code = rpcData ?? `A-${Date.now().toString(36).toUpperCase()}`;
          const insertError = await db.insertArticle({ code, designation, prix_unitaire: prix, nb_pieces: nbPieces });
          if (insertError) { errors.push(`${designation}: ${insertError}`); }
          else { success++; }
        }
      } catch (err) {
        errors.push(`${designation}: ${err instanceof Error ? err.message : 'erreur'}`);
      }
      onProgress?.(i + 1, rows.length);
    }
    if (success > 0) load();
    return { success, errors };
  }

  const reportData: ReportData = {
    title: lang === 'fr' ? 'Catalogue des articles' : 'Item catalog',
    subtitle: lang === 'fr' ? 'Liste complète' : 'Complete list',
    entreprise,
    columns: [
      { key: 'code', label: 'Code', align: 'left', width: '20%', render: (r) => String(r.code ?? '—') },
      { key: 'designation', label: lang === 'fr' ? 'Désignation' : 'Designation', align: 'left', render: (r) => String(r.designation ?? '') },
      { key: 'prix', label: lang === 'fr' ? 'Prix unitaire' : 'Unit price', align: 'right', render: (r) => formatPrice(Number(r.prix ?? 0)) },
      { key: 'pieces', label: lang === 'fr' ? 'Nb pièces' : 'Items', align: 'center', render: (r) => String(r.pieces ?? 1) },
    ],
    rows: articles.map((a) => ({
      code: a.code,
      designation: a.designation,
      prix: a.prix_unitaire,
      pieces: a.nb_pieces,
    })),
    summaryRows: [
      { label: lang === 'fr' ? 'Nombre d\'articles' : 'Item count', value: String(articles.length), highlight: true },
    ],
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <button
          onClick={() => articles.length > 0 && printReport()}
          disabled={articles.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Printer className="w-3.5 h-3.5" /> {lang === 'fr' ? 'Imprimer le catalogue' : 'Print catalog'}
        </button>
        <ImportExcel
          config={{
            entityType: 'articles',
            columns: [
              { key: 'designation', label: 'Désignation', required: true, type: 'string', aliases: ['Designation', 'Désignation article', 'Article'] },
              { key: 'prix_unitaire', label: 'Prix unitaire', required: true, type: 'number', aliases: ['Prix', 'Prix F CFA', 'Prix (F CFA)', 'Prix de vente', 'Montant'] },
              { key: 'nb_pieces', label: 'Nb pièces', required: false, type: 'number', aliases: ['Nombre de pièce', 'Nombre de pieces', 'Nombre de pièces', 'Pièces'] },
            ],
            onImport: handleImportArticles,
          }}
        />
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
      ) : articles.length === 0 && !showAdd ? (
        <div className="p-8 text-center">
          <p className="text-slate-400 text-sm">{lang === 'fr' ? 'Aucun article dans le catalogue.' : 'No items in the catalog.'}</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-50">
          {articles.map((article) => (
            <div key={article.id}>
              <div className="px-5 py-3.5 flex items-center justify-between">
                {editingId === article.id ? (
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center gap-2">
                      {article.code && (
                        <span className="text-xs font-medium text-sky-600 bg-sky-50 px-2 py-1 rounded">
                          {article.code}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">{t('depot.designation')}</label>
                        <input
                          type="text"
                          value={editDesignation}
                          onChange={(e) => setEditDesignation(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">{lang === 'fr' ? 'Prix unitaire (FCFA)' : 'Unit price (FCFA)'}</label>
                        <input
                          type="number"
                          value={editPrix}
                          onChange={(e) => setEditPrix(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">{t('depot.nbPieces')}</label>
                        <input
                          type="number"
                          min="1"
                          value={editPieces}
                          onChange={(e) => setEditPieces(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleSave(article.id)}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 transition-colors"
                      >
                        <Check className="w-4 h-4" /> {t('common.save')}
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm font-medium hover:bg-slate-200 transition-colors"
                      >
                        <X className="w-4 h-4" /> {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setExpandedId(expandedId === article.id ? null : article.id)}
                          className="p-0.5 rounded hover:bg-slate-100 transition-colors"
                        >
                          <ChevronDown
                            className={`w-4 h-4 text-slate-400 transition-transform ${expandedId === article.id ? 'rotate-180' : ''}`}
                          />
                        </button>
                        <p className="text-sm font-medium text-slate-900">{article.designation}</p>
                        {article.code && (
                          <span className="text-xs font-medium text-sky-600 bg-sky-50 px-1.5 py-0.5 rounded">
                            {article.code}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5 ml-6">
                        {lang === 'fr' ? 'Prix' : 'Price'}: {formatPrice(Number(article.prix_unitaire))} · {article.nb_pieces} {lang === 'fr' ? `pièce${article.nb_pieces > 1 ? 's' : ''}` : `item${article.nb_pieces > 1 ? 's' : ''}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 ml-3">
                      <button
                        onClick={() => setExpandedId(expandedId === article.id ? null : article.id)}
                        className="p-2 rounded-lg text-slate-400 hover:text-sky-500 hover:bg-sky-50 transition-all"
                        title={t('depot.variant')}
                      >
                        <Tags className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => startEdit(article)}
                        className="p-2 rounded-lg text-slate-400 hover:text-sky-500 hover:bg-sky-50 transition-all"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(article.id)}
                        className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </>
                )}
              </div>
              {expandedId === article.id && editingId !== article.id && (
                <VariantsPanel articleId={article.id} />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add new article */}
      {showAdd ? (
        <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/50 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{t('depot.designation')} *</label>
              <input
                type="text"
                value={newDesignation}
                onChange={(e) => setNewDesignation(e.target.value)}
                placeholder={lang === 'fr' ? 'Ex: Chemise' : 'Ex: Shirt'}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none:ring-2 focus:ring-sky-500 bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{lang === 'fr' ? 'Prix unitaire (FCFA)' : 'Unit price (FCFA)'} *</label>
              <input
                type="number"
                value={newPrix}
                onChange={(e) => setNewPrix(e.target.value)}
                placeholder="0"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{t('depot.nbPieces')}</label>
              <input
                type="number"
                min="1"
                value={newPieces}
                onChange={(e) => setNewPieces(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleAdd}
              disabled={!newDesignation.trim() || !newPrix}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="w-4 h-4" /> {t('common.save')}
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm font-medium hover:bg-slate-200 transition-colors"
            >
              <X className="w-4 h-4" /> {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          className="w-full flex items-center justify-center gap-2 py-3.5 text-sm font-medium text-slate-500 hover:text-sky-600 hover:bg-sky-50/50 transition-all border-t border-slate-100"
        >
          <Plus className="w-4 h-4" /> {lang === 'fr' ? 'Ajouter un article' : 'Add an item'}
        </button>
      )}
    </div>
    <PrintableReport data={reportData} />
    </div>
  );
}

// ─── Variants Panel (per article) ─────────────────────────────

function VariantsPanel({ articleId }: { articleId: string }) {
  const { t, lang } = useI18n();
  const [variants, setVariants] = useState<ArticleVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newDesignation, setNewDesignation] = useState('');
  const [newPrix, setNewPrix] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDesignation, setEditDesignation] = useState('');
  const [editPrix, setEditPrix] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setVariants(await db.getVariantsByArticle(articleId));
    setLoading(false);
  }, [articleId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd() {
    if (!newDesignation.trim() || !newPrix) return;
    setError(null);
    const prix = parseFloat(newPrix);
    if (isNaN(prix) || prix < 0) { setError(lang === 'fr' ? 'Prix invalide.' : 'Invalid price.'); return; }
    try {
      const insertError = await db.insertVariant({
        article_id: articleId,
        designation: newDesignation.trim(),
        prix_traitement: prix,
      });
      if (insertError) {
        setError(insertError);
        return;
      }
      setNewDesignation('');
      setNewPrix('');
      setShowAdd(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de l\'ajout' : 'Error during addition'));
    }
  }

  async function handleSave(id: string) {
    setError(null);
    const prix = parseFloat(editPrix);
    if (isNaN(prix) || prix < 0) { setError(lang === 'fr' ? 'Prix invalide.' : 'Invalid price.'); return; }
    try {
      const updateError = await db.updateVariant(id, {
        designation: editDesignation.trim(),
        prix_traitement: prix,
      });
      if (updateError) {
        setError(updateError);
        return;
      }
      setEditingId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de la modification' : 'Error during modification'));
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(lang === 'fr' ? 'Supprimer cette variante ?' : 'Delete this variant?')) return;
    setError(null);
    try {
      const deleteError = await db.deleteVariant(id);
      if (deleteError) {
        setError(deleteError);
        return;
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de la suppression' : 'Error during deletion'));
    }
  }

  return (
    <div className="px-5 pb-4 ml-6 border-l-2 border-sky-100 space-y-2">
      <div className="flex items-center gap-2 pt-2">
        <Tags className="w-3.5 h-3.5 text-sky-500" />
        <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{t('depot.variant')}s</p>
      </div>

      {error && (
        <div className="p-2 bg-red-50 rounded-lg flex items-start gap-2">
          <X className="w-3.5 h-3.5 text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-slate-400 py-2">{t('common.loading')}</p>
      ) : variants.length === 0 && !showAdd ? (
        <p className="text-xs text-slate-400 py-2">{lang === 'fr' ? 'Aucune variante. Le prix par défaut de l\'article sera utilisé.' : 'No variant. The default price of the item will be used.'}</p>
      ) : (
        <div className="space-y-1.5">
          {variants.map((v) => (
            <div
              key={v.id}
              className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2"
            >
              {editingId === v.id ? (
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="text"
                    value={editDesignation}
                    onChange={(e) => setEditDesignation(e.target.value)}
                    className="flex-1 px-2 py-1.5 rounded-md border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
                    placeholder={lang === 'fr' ? 'Nom de la variante' : 'Variant name'}
                  />
                  <input
                    type="number"
                    value={editPrix}
                    onChange={(e) => setEditPrix(e.target.value)}
                    className="w-24 px-2 py-1.5 rounded-md border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
                    placeholder={lang === 'fr' ? 'Prix' : 'Price'}
                  />
                  <button
                    onClick={() => handleSave(v.id)}
                    className="p-1.5 rounded-md bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="p-1.5 rounded-md bg-slate-200 text-slate-500 hover:bg-slate-300 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-700">{v.designation}</span>
                    <span className="text-xs font-medium text-sky-600 bg-sky-50 px-2 py-0.5 rounded">
                      {formatPrice(Number(v.prix_traitement))}
                    </span>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={() => {
                        setEditingId(v.id);
                        setEditDesignation(v.designation);
                        setEditPrix(String(v.prix_traitement));
                      }}
                      className="p-1.5 rounded-md text-slate-400 hover:text-sky-500 hover:bg-sky-50 transition-all"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(v.id)}
                      className="p-1.5 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
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

      {showAdd ? (
        <div className="flex items-center gap-2 rounded-lg bg-sky-50 px-3 py-2.5 border border-sky-100">
          <input
            type="text"
            value={newDesignation}
            onChange={(e) => setNewDesignation(e.target.value)}
            placeholder={lang === 'fr' ? 'Nom de la variante (ex: Lavage simple)' : 'Variant name (ex: Simple wash)'}
            className="flex-1 px-2 py-1.5 rounded-md border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
          />
          <input
            type="number"
            value={newPrix}
            onChange={(e) => setNewPrix(e.target.value)}
            placeholder={lang === 'fr' ? 'Prix' : 'Price'}
            className="w-24 px-2 py-1.5 rounded-md border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
          />
          <button
            onClick={handleAdd}
            disabled={!newDesignation.trim() || !newPrix}
            className="p-1.5 rounded-md bg-sky-500 text-white hover:bg-sky-600 transition-colors disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setShowAdd(false)}
            className="p-1.5 rounded-md bg-slate-200 text-slate-500 hover:bg-slate-300 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 text-xs font-medium text-sky-600 hover:text-sky-700 transition-colors pt-1"
        >
          <Plus className="w-3.5 h-3.5" /> {lang === 'fr' ? 'Ajouter une variante' : 'Add a variant'}
        </button>
      )}
    </div>
  );
}

// ─── Traitements Tab ──────────────────────────────────────────

function TraitementsTab() {
  const { t, lang } = useI18n();
  const [types, setTypes] = useState<TypeTraitement[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLibelle, setEditLibelle] = useState('');
  const [editCoef, setEditCoef] = useState('');
  const [editJours, setEditJours] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newLibelle, setNewLibelle] = useState('');
  const [newCoef, setNewCoef] = useState('1');
  const [newJours, setNewJours] = useState('1');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setTypes(await db.getTypesTraitement());
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useRealtimeSync(['types_traitement'], () => load(true));

  async function handleAdd() {
    if (!newLibelle.trim() || !newCoef || !newJours) return;
    setError(null);
    const coef = parseFloat(newCoef);
    const jours = parseInt(newJours);
    if (isNaN(coef) || coef <= 0) { setError(lang === 'fr' ? 'Coefficient invalide.' : 'Invalid coefficient.'); return; }
    if (isNaN(jours) || jours <= 0) { setError(lang === 'fr' ? 'Nombre de jours invalide.' : 'Invalid number of days.'); return; }
    try {
      let traitementCode: string;
      const { data: rpcData2, error: rpcError2 } = await rpc<string>('generate_traitement_code');
      if (rpcError2 || !rpcData2) {
        traitementCode = `T-${Date.now().toString(36).toUpperCase()}`;
      } else {
        traitementCode = rpcData2;
      }

      const insertError = await db.insertTypeTraitement({
        code: traitementCode,
        libelle: newLibelle.trim(),
        coefficient: coef,
        nb_jours: jours,
      });
      if (insertError) {
        setError(insertError);
        return;
      }
      setNewLibelle('');
      setNewCoef('1');
      setNewJours('1');
      setShowAdd(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de l\'ajout' : 'Error during addition'));
    }
  }

  async function handleSave(id: string) {
    setError(null);
    const coef = parseFloat(editCoef);
    const jours = parseInt(editJours);
    if (isNaN(coef) || coef <= 0) { setError(lang === 'fr' ? 'Coefficient invalide.' : 'Invalid coefficient.'); return; }
    if (isNaN(jours) || jours <= 0) { setError(lang === 'fr' ? 'Nombre de jours invalide.' : 'Invalid number of days.'); return; }
    try {
      const updateError = await db.updateTypeTraitement(id, {
        libelle: editLibelle.trim(),
        coefficient: coef,
        nb_jours: jours,
      });
      if (updateError) {
        setError(updateError);
        return;
      }
      setEditingId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de la modification' : 'Error during modification'));
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(lang === 'fr' ? 'Supprimer ce type de traitement ?' : 'Delete this treatment type?')) return;
    setError(null);
    try {
      const deleteError = await db.deleteTypeTraitement(id);
      if (deleteError) {
        setError(deleteError);
        return;
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de la suppression' : 'Error during deletion'));
    }
  }

  function startEdit(t: TypeTraitement) {
    setEditingId(t.id);
    setEditLibelle(t.libelle);
    setEditCoef(String(t.coefficient));
    setEditJours(String(t.nb_jours));
  }

  async function handleImportTraitements(rows: Record<string, string | number | null>[]): Promise<{ success: number; errors: string[] }> {
    let success = 0;
    const errors: string[] = [];
    for (const row of rows) {
      const libelle = String(row.libelle ?? '').trim();
      if (!libelle) { errors.push('Ligne: libellé manquant'); continue; }
      const coefficient = Number(row.coefficient ?? 1);
      const nb_jours = Number(row.nb_jours ?? 1) || 1;
      try {
        const { data: rpcData } = await rpc<string>('generate_traitement_code');
        const code = rpcData ?? `T-${Date.now().toString(36).toUpperCase()}`;
        const insertError = await db.insertTypeTraitement({ code, libelle, coefficient, nb_jours });
        if (insertError) { errors.push(`${libelle}: ${insertError}`); }
        else { success++; }
      } catch (err) {
        errors.push(`${libelle}: ${err instanceof Error ? err.message : 'erreur'}`);
      }
    }
    if (success > 0) load();
    return { success, errors };
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ImportExcel
          config={{
            entityType: 'traitements',
            columns: [
              { key: 'libelle', label: 'Libellé', required: true, type: 'string' },
              { key: 'coefficient', label: 'Coefficient', required: true, type: 'number' },
              { key: 'nb_jours', label: 'Nb jours', required: true, type: 'number' },
            ],
            onImport: handleImportTraitements,
          }}
        />
      </div>
      <div className="rounded-xl bg-sky-50 border border-sky-100 p-4">
        <p className="text-sm text-sky-700">
          {lang === 'fr' ? (
            <>Le <span className="font-semibold">nombre de jours</span> détermine automatiquement la date de retrait prévue d'un dépôt. Le <span className="font-semibold">coefficient</span> multiplie le prix unitaire de chaque article.</>
          ) : (
            <>The <span className="font-semibold">number of days</span> automatically determines the expected pickup date of a deposit. The <span className="font-semibold">coefficient</span> multiplies the unit price of each item.</>
          )}
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
        ) : (
          <div className="divide-y divide-slate-50">
            {types.map((t) => (
              <div key={t.id} className="px-5 py-4">
                {editingId === t.id ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="text"
                      value={editLibelle}
                      onChange={(e) => setEditLibelle(e.target.value)}
                      placeholder={lang === 'fr' ? 'Libellé' : 'Label'}
                      className="flex-1 min-w-[120px] px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-slate-400">{lang === 'fr' ? 'Coef' : 'Coef'}</span>
                      <input
                        type="number"
                        step="0.25"
                        value={editCoef}
                        onChange={(e) => setEditCoef(e.target.value)}
                        className="w-16 px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-slate-400">{lang === 'fr' ? 'Jours' : 'Days'}</span>
                      <input
                        type="number"
                        min="0"
                        value={editJours}
                        onChange={(e) => setEditJours(e.target.value)}
                        className="w-16 px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                      />
                    </div>
                    <button
                      onClick={() => handleSave(t.id)}
                      className="p-1.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="p-1.5 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
                        <Clock className="w-5 h-5 text-slate-500" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{t.libelle}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {lang === 'fr' ? `Coefficient ×${t.coefficient} · ${t.nb_jours} jour${t.nb_jours > 1 ? 's' : ''} de traitement` : `Coefficient ×${t.coefficient} · ${t.nb_jours} day${t.nb_jours > 1 ? 's' : ''} of treatment`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => startEdit(t)}
                        className="p-2 rounded-lg text-slate-400 hover:text-sky-500 hover:bg-sky-50 transition-all"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(t.id)}
                        className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {showAdd ? (
          <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/50 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">{lang === 'fr' ? 'Libellé' : 'Label'} *</label>
                <input
                  type="text"
                  value={newLibelle}
                  onChange={(e) => setNewLibelle(e.target.value)}
                  placeholder={lang === 'fr' ? 'Ex: Lavage simple' : 'Ex: Simple wash'}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">{lang === 'fr' ? 'Coefficient' : 'Coefficient'} *</label>
                <input
                  type="number"
                  step="0.25"
                  min="0"
                  value={newCoef}
                  onChange={(e) => setNewCoef(e.target.value)}
                  placeholder="1"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">{lang === 'fr' ? 'Nb jours' : 'Nb days'} *</label>
                <input
                  type="number"
                  min="0"
                  value={newJours}
                  onChange={(e) => setNewJours(e.target.value)}
                  placeholder="1"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleAdd}
                disabled={!newLibelle.trim() || !newCoef || !newJours}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save className="w-4 h-4" /> {t('common.save')}
              </button>
              <button
                onClick={() => setShowAdd(false)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm font-medium hover:bg-slate-200 transition-colors"
              >
                <X className="w-4 h-4" /> {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowAdd(true)}
            className="w-full flex items-center justify-center gap-2 py-3.5 text-sm font-medium text-slate-500 hover:text-sky-600 hover:bg-sky-50/50 transition-all border-t border-slate-100"
          >
            <Plus className="w-4 h-4" /> {lang === 'fr' ? 'Ajouter un type de traitement' : 'Add a treatment type'}
          </button>
        )}
      </div>
    </div>
  );
}
