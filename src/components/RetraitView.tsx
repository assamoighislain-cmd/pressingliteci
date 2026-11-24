import { useState, useEffect, useCallback } from 'react';
import { useI18n } from '@/lib/i18n';
import { db } from '@/lib/db';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import {
  DepotWithArticles,
  TypeTraitement,
  ModeReglementRow,
  formatPrice,
  formatDate,
  formatDateShort,
  getModeReglementLabel,
  getTraitementLabelById,
  ModeReglement,
  buildWhatsAppMessage,
  buildWhatsAppUrl,
} from '@/types';
import {
  Search,
  Check,
  Clock,
  ArrowUpFromLine,
  X,
  Printer,
  ChevronRight,
  Calendar,
  Wallet,
  CreditCard,
  CheckCircle2,
  Circle,
  Plus,
  MessageCircle,
  Truck,
  MapPin,
  Navigation,
  CalendarClock,
  Receipt,
  Trash2,
  Tags,
  Package,
} from 'lucide-react';
import PrintableReceipt, { ReceiptData, PrintFormat } from '@/components/PrintableReceipt';
import PrintableLabels from '@/components/PrintableLabels';
import { printWithFormat, printDepotLabels } from '@/lib/print';
import { useAuth } from '@/lib/auth';
import { Entreprise, DepotAvance, resolveReceiptHeader } from '@/types';

export default function RetraitView() {
  const { t, lang } = useI18n();
  const { role, boutiques, currentBoutique } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<DepotWithArticles[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<DepotWithArticles | null>(null);
  const [avances, setAvances] = useState<DepotAvance[]>([]);
  const [avanceInput, setAvanceInput] = useState('');
  const [avanceMode, setAvanceMode] = useState<string>('');
  const [avanceLoading, setAvanceLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reglementLoading, setReglementLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<ReceiptData | null>(null);
  const [retraitSuccessData, setRetraitSuccessData] = useState<ReceiptData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printFormat, setPrintFormat] = useState<PrintFormat>('a5');
  const [typesTraitement, setTypesTraitement] = useState<TypeTraitement[]>([]);
  const [modesReglement, setModesReglement] = useState<ModeReglementRow[]>([]);
  const [entreprise, setEntreprise] = useState<Entreprise | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [markingReady, setMarkingReady] = useState(false);

  const selectedBoutique =
    (selected?.boutique_id ? boutiques.find((b) => b.id === selected.boutique_id) : null) ??
    currentBoutique;
  const receiptHeader = resolveReceiptHeader(entreprise, selectedBoutique);

  useEffect(() => {
    (async () => {
      const [types, modes, ent] = await Promise.all([
        db.getTypesTraitement(),
        db.getModesReglement(),
        db.getEntreprise(),
      ]);
      setTypesTraitement(types);
      setModesReglement(modes);
      setEntreprise(ent);
    })();
  }, []);

  const search = useCallback(async (term: string, silent = false) => {
    const trimmed = term.trim();
    if (trimmed.length < 1) {
      setResults([]);
      setError(null);
      return;
    }
    if (!silent) setLoading(true);
    try {
      const mapped = await db.getDepotsForRetrait();
      const lower = trimmed.toLowerCase();
      const filtered = mapped.filter(
        (d) =>
          (d.numero ?? '').toLowerCase().includes(lower) ||
          (d.client?.nom ?? '').toLowerCase().includes(lower),
      );
      setResults(filtered.slice(0, 20));
      setError(null);
    } catch (err) {
      setResults([]);
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur de recherche' : 'Search error'));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [lang]);

  useEffect(() => {
    const timer = setTimeout(() => search(searchTerm, false), 250);
    return () => clearTimeout(timer);
  }, [searchTerm, search]);

  useRealtimeSync(['depots', 'depot_articles', 'depot_avances', 'clients'], () => {
    if (searchTerm.trim().length >= 1) {
      void search(searchTerm, true);
    }
    if (selected?.id) {
      void refreshSelected(selected.id);
    }
  });

  const detailReceiptData = selected ? buildReceiptData(selected, avances) : null;

  useEffect(() => {
    if (selected) {
      setSuccessData(null);
      setRetraitSuccessData(null);
    } else if (!success) {
      setSuccessData(null);
      setRetraitSuccessData(null);
    }
  }, [selected, success]);

  async function refreshSelected(id: string) {
    const fresh = await db.getDepotById(id);
    if (fresh) setSelected(fresh);
    const avs = await db.getAvancesForDepot(id);
    setAvances(avs);
  }

  async function handleReglement() {
    if (!selected) return;
    setReglementLoading(true);
    setError(null);

    try {
      if (!avanceMode) {
        setError(t('retrait.errorNoMode'));
        setReglementLoading(false);
        return;
      }
      const newMode = avanceMode;
      const totalAvances = avances.reduce((s, a) => s + Number(a.montant), 0);
      const originalAvance = Number(selected.avance_amount) ?? 0;
      const reste = Number(selected.total) - originalAvance - totalAvances;

      if (reste > 0) {
        const avRes = await db.insertAvance(selected.id, reste, avanceMode);
        if (avRes.error || !avRes.data) {
          setError(avRes.error ?? t('retrait.errorReglement'));
          return;
        }
        const createdAvance = avRes.data;
        setAvances((prev) => [...prev, createdAvance]);
      }

      if (!selected.mode_reglement) {
        const updateError = await db.updateDepot(selected.id, { mode_reglement: newMode });
        if (updateError) {
          setError(updateError);
          return;
        }
        setSelected({ ...selected, mode_reglement: newMode });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('retrait.errorReglement'));
    } finally {
      setReglementLoading(false);
    }
  }

  async function handleAddAvance() {
    if (!selected) return;
    const montant = parseFloat(avanceInput);
    if (!montant || montant <= 0) return;

    const totalAvances = avances.reduce((s, a) => s + Number(a.montant), 0);
    const currentReste = Number(selected.total) - (Number(selected.avance_amount) ?? 0) - totalAvances;

    if (montant > currentReste) {
      setError(t('retrait.errorAvanceExceeds'));
      return;
    }
    setAvanceLoading(true);
    setError(null);

    try {
      const avRes = await db.insertAvance(selected.id, montant, avanceMode || undefined);
      if (avRes.error || !avRes.data) {
        setError(avRes.error ?? t('retrait.errorAvance'));
        return;
      }

      const createdAvance = avRes.data;
      setAvances((prev) => [...prev, createdAvance]);
      setAvanceInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('retrait.errorAvance'));
    } finally {
      setAvanceLoading(false);
    }
  }

  async function handleEditNbPieces(articleId: string, newNb: number) {
    if (!selected) return;
    if (newNb < 1) return;
    setError(null);
    try {
      const updateError = await db.updateDepotArticle(articleId, { nb_pieces: newNb });
      if (updateError) {
        setError(updateError);
        return;
      }
      await refreshSelected(selected.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('retrait.errorRetrait'));
    }
  }

  async function handleArticleRetrait(articleId: string) {
    if (!selected) return;
    setError(null);

    try {
      const now = new Date().toISOString();
      const updateError = await db.updateDepotArticle(articleId, { date_retrait: now });

      if (updateError) {
        setError(updateError);
        return;
      }

      await refreshSelected(selected.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('retrait.errorRetrait'));
    }
  }

  async function handleArticleAnnulerRetrait(articleId: string) {
    if (!selected) return;
    setError(null);

    try {
      const updateError = await db.updateDepotArticle(articleId, { date_retrait: null });

      if (updateError) {
        setError(updateError);
        return;
      }

      await refreshSelected(selected.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('retrait.errorCancel'));
    }
  }

  async function handleRetraitAll() {
    if (!selected) return;
    setConfirming(true);
    setError(null);

    try {
      const now = new Date().toISOString();
      const pendingArticles = selected.articles.filter((a) => !a.date_retrait);

      for (const art of pendingArticles) {
        const err = await db.updateDepotArticle(art.id, { date_retrait: now });
        if (err) {
          setError(err);
          return;
        }
      }

      const totalAvances = avances.reduce((s, a) => s + Number(a.montant), 0);
      const originalAvance = Number(selected.avance_amount) || 0;
      const totalPaye = originalAvance + totalAvances;
      const reste = Number(selected.total) - totalPaye;

      if (reste > 0) {
        setError(t('retrait.errorNotSettled'));
        return;
      }

      const totalAvanceAmount = originalAvance + totalAvances;
      const finalModeReglement: ModeReglement | null = selected.mode_reglement || avanceMode || null;

      const reglementsList: { montant: number; modeReglement: string | null; datePaiement: string }[] = [];
      if (originalAvance > 0) {
        reglementsList.push({ montant: originalAvance, modeReglement: selected.mode_reglement, datePaiement: selected.date_depot });
      }
      for (const av of avances) {
        reglementsList.push({ montant: Number(av.montant), modeReglement: av.mode_reglement, datePaiement: av.date_paiement });
      }

      const updateError = await db.updateDepot(selected.id, {
        statut: 'RETIRE',
        date_retrait: now,
        mode_reglement: finalModeReglement,
      });

      if (updateError) {
        setError(updateError);
        return;
      }

      const updatedSelected = { ...selected, mode_reglement: finalModeReglement };
      setRetraitSuccessData(buildReceiptData(updatedSelected, avances));
      setSuccess(selected.numero);
      setSelected(null);
      setAvances([]);
      setSearchTerm('');
      setResults([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('retrait.errorClose'));
    } finally {
      setConfirming(false);
    }
  }

  function buildReceiptData(d: DepotWithArticles, avs: DepotAvance[]): ReceiptData {
    const originalAvance = Number(d.avance_amount) || 0;
    const totalAvances = avs.reduce((s, a) => s + Number(a.montant), 0);
    const totalAvanceAmount = originalAvance + totalAvances;

    const reglementsList: { montant: number; modeReglement: string | null; datePaiement: string }[] = [];
    if (originalAvance > 0) {
      reglementsList.push({ montant: originalAvance, modeReglement: d.mode_reglement, datePaiement: d.date_depot });
    }
    for (const av of avs) {
      reglementsList.push({ montant: Number(av.montant), modeReglement: av.mode_reglement, datePaiement: av.date_paiement });
    }

    return {
      numero: d.numero ?? '—',
      clientNom: d.client?.nom ?? '—',
      clientTel: d.client?.telephone ?? null,
      portalCode: d.client?.portal_code ?? null,
      dateDepot: d.date_depot,
      dateRetraitPrevue: d.date_retrait_prevue,
      traitement: getTraitementLabelById(d.type_traitement_id, typesTraitement, d.traitement),
      coefficient: Number(d.coefficient),
      modeReglement: d.mode_reglement,
      avanceAmount: totalAvanceAmount,
      total: Number(d.total),
      totalAvantRemise: Number(d.total) + Number(d.montant_remise ?? 0),
      tauxRemise: Number(d.taux_remise ?? 0),
      montantRemise: Number(d.montant_remise ?? 0),
      notes: d.notes,
      reglements: reglementsList,
      articles: d.articles.map((art) => ({
        designation: art.designation,
        quantite: art.quantite,
        nb_pieces: art.nb_pieces,
        prix_unitaire: Number(art.prix_unitaire),
        prix_total: Number(art.prix_total),
        couleur: art.couleur,
        signe_particulier: art.signe_particulier,
        griffe: art.griffe,
      })),
    };
  }

  function handlePrintRetired(fmt: PrintFormat) {
    setPrintFormat(fmt);
    setTimeout(() => printWithFormat(fmt), 100);
  }

  function reset() {
    setSuccess(null);
    setSuccessData(null);
    setRetraitSuccessData(null);
    setSelected(null);
    setAvances([]);
    setAvanceInput('');
    setAvanceMode('');
    setSearchTerm('');
    setResults([]);
    setError(null);
    setConfirmDelete(false);
  }

  async function handleToggleReady() {
    if (!selected) return;
    setMarkingReady(true);
    setError(null);
    try {
      const newValue = !selected.ready_for_delivery;
      const updateError = await db.updateDepot(selected.id, { ready_for_delivery: newValue });
      if (updateError) throw new Error(updateError);
      setSelected({ ...selected, ready_for_delivery: newValue });
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur' : 'Error'));
    } finally {
      setMarkingReady(false);
    }
  }

  async function handleDeleteDepot() {
    if (!selected) return;
    setDeleting(true);
    setError(null);
    try {
      const delError = await db.deleteDepot(selected.id);
      if (delError) {
        setError(delError);
        return;
      }
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de la suppression' : 'Error during deletion'));
    } finally {
      setDeleting(false);
    }
  }

  // Success screen
  if (success) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 text-center no-print">
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
            <Check className="w-8 h-8 text-emerald-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">{t('retrait.depositWithdrawn')}</h2>
          <p className="text-sm text-slate-500 mt-1">
            {t('retrait.depositWithdrawnMsg', { num: success })}
          </p>

          <div className="mt-5 space-y-2">
            <div className="flex gap-2">
              <button
                onClick={() => { setPrintFormat('a5'); setTimeout(() => printWithFormat('a5'), 50); }}
                className={`flex-1 px-4 py-2.5 rounded-lg border font-medium text-sm transition-colors flex items-center justify-center gap-2 ${printFormat === 'a5' ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
              >
                <Printer className="w-4 h-4" /> A5
              </button>
              <button
                onClick={() => { setPrintFormat('ticket'); setTimeout(() => printWithFormat('ticket'), 50); }}
                className={`flex-1 px-4 py-2.5 rounded-lg border font-medium text-sm transition-colors flex items-center justify-center gap-2 ${printFormat === 'ticket' ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
              >
                <Receipt className="w-4 h-4" /> Ticket 80mm
              </button>
            </div>
            {retraitSuccessData?.clientTel && (() => {
              const totalPaye = retraitSuccessData.modeReglement === 'PAYER_DEPOT' || retraitSuccessData.modeReglement === 'SOLDE'
                ? retraitSuccessData.total
                : retraitSuccessData.avanceAmount ?? 0;
              const reste = Math.max(0, retraitSuccessData.total - totalPaye);
              const waMessage = buildWhatsAppMessage({
                entrepriseNom: receiptHeader.nom,
                entrepriseTelephone: receiptHeader.telephone,
                entrepriseAdresse: receiptHeader.adresse,
                entrepriseVille: receiptHeader.ville,
                entrepriseEmail: receiptHeader.email,
                entrepriseSlogan: receiptHeader.slogan,
                entrepriseId: entreprise?.id,
                numero: retraitSuccessData.numero,
                clientNom: retraitSuccessData.clientNom,
                portalCode: retraitSuccessData.portalCode ?? null,
                dateDepot: retraitSuccessData.dateDepot,
                dateRetraitPrevue: retraitSuccessData.dateRetraitPrevue,
                traitement: retraitSuccessData.traitement,
                coefficient: retraitSuccessData.coefficient,
                total: retraitSuccessData.total,
                totalAvantRemise: retraitSuccessData.totalAvantRemise,
                tauxRemise: retraitSuccessData.tauxRemise,
                montantRemise: retraitSuccessData.montantRemise,
                articles: retraitSuccessData.articles,
                reste,
                notes: retraitSuccessData.notes,
              });
              const waUrl = buildWhatsAppUrl(retraitSuccessData.clientTel, waMessage);
              return (
                <a
                  href={waUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 px-4 py-2.5 rounded-lg bg-emerald-500 text-white font-medium text-sm hover:bg-emerald-600 transition-colors flex items-center justify-center gap-2"
                >
                  <MessageCircle className="w-4 h-4" /> WhatsApp
                </a>
              );
            })()}
            <button
              onClick={reset}
              className="flex-1 px-4 py-2.5 rounded-lg bg-sky-500 text-white font-medium text-sm hover:bg-sky-600 transition-colors"
            >
              {t('retrait.anotherRetrait')}
            </button>
          </div>
        </div>

        {/* Hidden printable receipt */}
        {retraitSuccessData && <PrintableReceipt key={success} data={retraitSuccessData} format={printFormat} modesReglement={modesReglement} entreprise={entreprise} boutique={selectedBoutique} />}
      </div>
    );
  }

  // Detail / confirmation screen
  if (selected) {
    const totalAvances = avances.reduce((s, a) => s + Number(a.montant), 0);
    const originalAvance = Number(selected.avance_amount) || 0;
    const totalPaye = originalAvance + totalAvances;
    const reste = Number(selected.total) - totalPaye;

    const withdrawnCount = selected.articles.filter((a) => a.date_retrait).length;
    const allWithdrawn = withdrawnCount === selected.articles.length;

    return (
      <div className="max-w-2xl mx-auto space-y-5">
        <button
          onClick={() => { setSelected(null); setAvances([]); setSuccessData(null); setRetraitSuccessData(null); }}
          className="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600 transition-colors"
        >
          <X className="w-4 h-4" /> {t('retrait.backToSearch')}
        </button>

        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          {/* Header */}
          <div className="p-5 bg-gradient-to-br from-slate-800 to-slate-900">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide">{t('retrait.deposit')}</p>
                <h2 className="text-2xl font-bold text-white mt-1">{selected.numero}</h2>
              </div>
              <div className="flex items-center gap-3">
                <div
                  className={`px-3 py-1.5 rounded-full text-xs font-medium ${
                    selected.statut === 'EN_COURS'
                      ? 'bg-amber-400/20 text-amber-300'
                      : 'bg-emerald-400/20 text-emerald-300'
                  }`}
                >
                  {selected.statut === 'EN_COURS' ? t('retrait.inProgress') : t('retrait.withdrawn')}
                </div>
                <div className="flex items-center gap-2">
                  {selected.client?.telephone && (() => {
                    const receipt = buildReceiptData(selected, avances);
                    const totalPaye = receipt.modeReglement === 'PAYER_DEPOT' || receipt.modeReglement === 'SOLDE'
                      ? receipt.total
                      : receipt.avanceAmount ?? 0;
                    const reste = Math.max(0, receipt.total - totalPaye);
                    const waMessage = buildWhatsAppMessage({
                      entrepriseNom: receiptHeader.nom,
                      entrepriseTelephone: receiptHeader.telephone,
                      entrepriseAdresse: receiptHeader.adresse,
                      entrepriseVille: receiptHeader.ville,
                      entrepriseEmail: receiptHeader.email,
                      entrepriseSlogan: receiptHeader.slogan,
                      entrepriseId: entreprise?.id,
                      numero: receipt.numero,
                      portalCode: receipt.portalCode ?? null,
                      clientNom: receipt.clientNom,
                      dateDepot: receipt.dateDepot,
                      dateRetraitPrevue: receipt.dateRetraitPrevue,
                      traitement: receipt.traitement,
                      coefficient: receipt.coefficient,
                      total: receipt.total,
                      totalAvantRemise: receipt.totalAvantRemise,
                      tauxRemise: receipt.tauxRemise,
                      montantRemise: receipt.montantRemise,
                      articles: receipt.articles,
                      reste,
                      notes: receipt.notes,
                    });
                    const waUrl = buildWhatsAppUrl(selected.client.telephone, waMessage);
                    return (
                      <a
                        href={waUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-medium hover:bg-emerald-600 transition-colors flex items-center gap-1.5"
                      >
                        <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                      </a>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>

          {/* Client info */}
          <div className="p-5 border-b border-slate-100">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-slate-400">{t('retrait.client')}</p>
                <p className="text-sm font-medium text-slate-900 mt-0.5">
                  {selected.client?.nom ?? '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400">{t('retrait.phone')}</p>
                <p className="text-sm font-medium text-slate-900 mt-0.5">
                  {selected.client?.telephone ?? '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400">{t('retrait.depositDate')}</p>
                <p className="text-sm font-medium text-slate-900 mt-0.5">
                  {formatDate(selected.date_depot)}
                </p>
              </div>

              <div>
                <p className="text-xs text-slate-400">{t('retrait.treatment')}</p>
                <p className="text-sm font-medium text-slate-900 mt-0.5">
                  {getTraitementLabelById(selected.type_traitement_id, typesTraitement, selected.traitement)} (×{Number(selected.coefficient)})
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400">{t('retrait.retraitPrevu')}</p>
                <p className="text-sm font-medium text-sky-600 mt-0.5">
                  {formatDateShort(selected.date_retrait_prevue)}
                </p>
              </div>
            </div>
          </div>

          {/* Articles with per-article retrait */}
          <div className="p-5 border-b border-slate-100">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-slate-400 uppercase tracking-wide">{t('retrait.articles')}</p>
              <span className="text-xs font-medium text-slate-500">
                {t('retrait.withdrawnCount', { done: withdrawnCount, total: selected.articles.length })}
              </span>
            </div>
            <div className="space-y-2">
              {selected.articles.map((art) => {
                const isWithdrawn = !!art.date_retrait;
                return (
                  <div
                    key={art.id}
                    className={`flex items-center justify-between py-2.5 px-3 rounded-lg transition-colors ${
                      isWithdrawn ? 'bg-emerald-50 border border-emerald-100' : 'bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {isWithdrawn ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                      ) : (
                        <Circle className="w-5 h-5 text-slate-300 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${isWithdrawn ? 'text-emerald-800' : 'text-slate-900'}`}>
                          {art.designation}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-xs text-slate-400">
                            {art.quantite} × {formatPrice(Number(art.prix_unitaire))}
                          </p>
                          {selected.statut === 'EN_COURS' ? (
                            <label className="flex items-center gap-1 text-xs text-slate-400">
                              · {t('retrait.pieces')}:
                              <input
                                type="number"
                                min="1"
                                value={art.nb_pieces}
                                onChange={(e) => handleEditNbPieces(art.id, parseInt(e.target.value) || 1)}
                                className="w-14 px-1.5 py-0.5 rounded border border-slate-200 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-transparent bg-white"
                              />
                            </label>
                          ) : (
                            (Number(art.nb_pieces) || 1) * (Number(art.quantite) || 1) > 1 ? <span className="text-xs text-slate-400">· {(Number(art.nb_pieces) || 1) * (Number(art.quantite) || 1)} {t('retrait.pieces')}</span> : null
                          )}
                        </div>
                        {(art.couleur || art.signe_particulier || art.griffe) && (
                          <p className="text-xs text-slate-500 mt-1">
                            {[art.couleur, art.signe_particulier, art.griffe].filter(Boolean).join(' · ')}
                          </p>
                        )}
                        {isWithdrawn && (
                          <p className="text-xs text-emerald-500 mt-1">
                            {t('retrait.withdrawnOn', { date: formatDate(art.date_retrait) })}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                      <span className={`text-sm font-semibold ${isWithdrawn ? 'text-emerald-700' : 'text-slate-700'}`}>
                        {formatPrice(Number(art.prix_total))}
                      </span>
                      {selected.statut === 'EN_COURS' && (
                        isWithdrawn ? (
                          <button
                            onClick={() => handleArticleAnnulerRetrait(art.id)}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors"
                          >
                            {t('retrait.cancel')}
                          </button>
                        ) : (
                          <button
                            onClick={() => handleArticleRetrait(art.id)}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors flex items-center gap-1"
                          >
                            <Check className="w-3.5 h-3.5" /> {t('retrait.withdraw')}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Totals */}
          <div className="p-5">
            {/* Remise info */}
            {Number(selected.taux_remise ?? 0) > 0 && (
              <div className="mb-3 rounded-lg bg-emerald-50 border border-emerald-100 p-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">{lang === 'fr' ? 'Sous-total' : 'Subtotal'}</span>
                  <span className="text-slate-500 line-through">
                    {formatPrice(Number(selected.total) + Number(selected.montant_remise ?? 0))}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-emerald-600">{lang === 'fr' ? `Remise (${Number(selected.taux_remise)}%)` : `Discount (${Number(selected.taux_remise)}%)`}</span>
                  <span className="text-emerald-600">−{formatPrice(Number(selected.montant_remise ?? 0))}</span>
                </div>
              </div>
            )}

            <>
              <div className="flex justify-between py-1.5 text-sm">
                <span className="text-slate-500">{t('retrait.total')}</span>
                <span className="font-medium text-slate-900">{formatPrice(Number(selected.total))}</span>
              </div>
              {totalPaye > 0 && (
                <div className="flex justify-between py-1.5 text-sm">
                  <span className="text-slate-500">{t('retrait.totalPaid')}</span>
                  <span className="font-medium text-emerald-600">{formatPrice(totalPaye)}</span>
                </div>
              )}
              {(originalAvance > 0 || avances.length > 0) && (
                <div className="mt-1 mb-1 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 space-y-1">
                  {originalAvance > 0 && (
                    <div className="flex justify-between items-center text-xs text-slate-600">
                      <span className="flex items-center gap-1.5">
                        {formatDateShort(selected.date_depot)}
                        {selected.mode_reglement && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[0.65rem] font-medium">
                            {getModeReglementLabel(selected.mode_reglement, modesReglement)}
                          </span>
                        )}
                      </span>
                      <span className="font-medium text-emerald-600">{formatPrice(originalAvance)}</span>
                    </div>
                  )}
                  {avances.map((av) => (
                    <div key={av.id} className="flex justify-between items-center text-xs text-slate-600">
                      <span className="flex items-center gap-1.5">
                        {formatDateShort(av.date_paiement)}
                        {av.mode_reglement && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[0.65rem] font-medium">
                            {getModeReglementLabel(av.mode_reglement, modesReglement)}
                          </span>
                        )}
                      </span>
                      <span className="font-medium text-emerald-600">{formatPrice(Number(av.montant))}</span>
                    </div>
                  ))}
                </div>
              )}
              {reste > 0 && (
                <div className="flex justify-between py-2 pt-3 border-t border-slate-100">
                  <span className="text-sm font-semibold text-slate-700">{t('retrait.remaining')}</span>
                  <span className="text-lg font-bold text-red-600">{formatPrice(reste)}</span>
                </div>
              )}
            </>

            {/* Règlement status badge */}
            <div className="mt-4">
              {reste > 0 ? (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-100">
                  <Wallet className="w-4 h-4 text-red-500 flex-shrink-0" />
                  <p className="text-sm text-red-600 font-medium">
                    {t('retrait.pendingPayment')}
                  </p>
                </div>
              ) : (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-100">
                  <Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  <p className="text-sm text-emerald-600 font-medium">
                    {t('retrait.fullPayment')}
                  </p>
                </div>
              )}
            </div>

            {selected.notes && (
              <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-100">
                <p className="text-xs text-amber-600 font-medium">{t('retrait.notes')}</p>
                <p className="text-sm text-amber-800 mt-1">{selected.notes}</p>
              </div>
            )}

            {selected.pickup_requested && (
              <div className="mt-3 p-3 rounded-lg bg-sky-50 border border-sky-100">
                <div className="flex items-center gap-2 mb-2">
                  <Truck className="w-4 h-4 text-sky-600" />
                  <p className="text-xs text-sky-600 font-medium">
                    {lang === 'fr' ? 'Collecte à domicile demandée' : 'Home pickup requested'}
                  </p>
                </div>
                {selected.pickup_day && (
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <CalendarClock className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />
                    <p className="text-sm text-sky-800 font-medium capitalize">{selected.pickup_day}</p>
                  </div>
                )}
                {selected.pickup_address && (
                  <div className="flex items-start gap-1.5 mb-1.5">
                    <MapPin className="w-3.5 h-3.5 text-sky-400 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-sky-800">{selected.pickup_address}</p>
                  </div>
                )}
                {selected.pickup_latitude !== null && selected.pickup_longitude !== null && (
                  <a
                    href={`https://www.google.com/maps?q=${selected.pickup_latitude},${selected.pickup_longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-sky-600 hover:text-sky-700 font-medium mt-1"
                  >
                    <Navigation className="w-3.5 h-3.5" />
                    {selected.pickup_latitude.toFixed(5)}, {selected.pickup_longitude.toFixed(5)}
                  </a>
                )}
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-3 flex items-start gap-2">
            <X className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {role === 'admin' && (
          <div className="pt-2">
            {confirmDelete ? (
              <div className="rounded-xl bg-red-50 border border-red-200 p-4 space-y-3">
                <p className="text-sm font-medium text-red-700 text-center">
                  {lang === 'fr'
                    ? 'Supprimer définitivement ce dépôt ? Cette action est irréversible.'
                    : 'Permanently delete this deposit? This action cannot be undone.'}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
                  >
                    {lang === 'fr' ? 'Annuler' : 'Cancel'}
                  </button>
                  <button
                    onClick={handleDeleteDepot}
                    disabled={deleting}
                    className="flex-1 px-4 py-2.5 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {deleting ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        <Trash2 className="w-4 h-4" />
                        {lang === 'fr' ? 'Supprimer' : 'Delete'}
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="w-full px-4 py-2.5 rounded-lg border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 transition-colors flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                {lang === 'fr' ? 'Supprimer ce dépôt' : 'Delete this deposit'}
              </button>
            )}
          </div>
        )}

        {selected.statut === 'EN_COURS' ? (
          <div className="space-y-3">
            {/* Règlement section - visible s'il reste à payer */}
            {reste > 0 && (
              <div className="rounded-xl bg-amber-50 border border-amber-100 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-amber-600" />
                  <p className="text-sm font-semibold text-amber-700">{t('retrait.payment')}</p>
                </div>
                {(originalAvance > 0 || avances.length > 0) && (
                  <div className="space-y-1">
                    {originalAvance > 0 && (
                      <div className="flex justify-between items-center text-xs text-slate-600 py-1 border-b border-amber-100 last:border-b-0">
                        <span className="flex items-center gap-1.5">
                          {formatDateShort(selected.date_depot)}
                          {selected.mode_reglement && (
                            <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 text-[0.65rem] font-medium">
                              {getModeReglementLabel(selected.mode_reglement, modesReglement)}
                            </span>
                          )}
                        </span>
                        <span className="font-medium text-emerald-600">{formatPrice(originalAvance)}</span>
                      </div>
                    )}
                    {avances.map((av) => (
                      <div key={av.id} className="flex justify-between items-center text-xs text-slate-600 py-1 border-b border-amber-100 last:border-b-0">
                        <span className="flex items-center gap-1.5">
                          {formatDateShort(av.date_paiement)}
                          {av.mode_reglement && (
                            <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 text-[0.65rem] font-medium">
                              {getModeReglementLabel(av.mode_reglement, modesReglement)}
                            </span>
                          )}
                        </span>
                        <span className="font-medium text-emerald-600">{formatPrice(Number(av.montant))}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="0"
                    value={avanceInput}
                    onChange={(e) => setAvanceInput(e.target.value)}
                    placeholder={t('retrait.amount')}
                    className="w-28 px-3 py-2 rounded-lg border border-amber-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent bg-white"
                  />
                  <select
                    value={avanceMode}
                    onChange={(e) => setAvanceMode(e.target.value)}
                    className="px-2 py-2 rounded-lg border border-amber-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent bg-white"
                  >
                    <option value="">{t('retrait.modePlaceholder')}</option>
                    {modesReglement.map((m) => (
                      <option key={m.id} value={m.designation}>{m.designation}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleAddAvance}
                    disabled={avanceLoading || !avanceInput}
                    className="px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                  >
                    {avanceLoading ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <><Plus className="w-4 h-4" /> {t('retrait.save')}</>
                    )}
                  </button>
                </div>
                <button
                  onClick={handleReglement}
                  disabled={reglementLoading || !avanceMode}
                  className="w-full px-4 py-2.5 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {reglementLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      {t('retrait.submitting')}
                    </>
                  ) : (
                    <>
                      <CreditCard className="w-4 h-4" />
                      {t('retrait.settleFull', { amount: formatPrice(reste) })}
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Bouton marquer disponible pour livraison */}
            {selected.delivery_requested && (
              <div className="flex items-center gap-3 p-4 rounded-xl border border-sky-100 bg-sky-50">
                <div className="w-10 h-10 rounded-lg bg-sky-100 flex items-center justify-center flex-shrink-0">
                  <Package className="w-5 h-5 text-sky-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-sky-900">
                    {lang === 'fr' ? 'Livraison à domicile' : 'Home delivery'}
                  </p>
                  <p className="text-xs text-sky-600 mt-0.5">
                    {selected.ready_for_delivery
                      ? (lang === 'fr' ? 'Marqué comme prêt à livrer' : 'Marked as ready for delivery')
                      : (lang === 'fr' ? 'En cours de traitement' : 'Being processed')}
                  </p>
                </div>
                <button
                  onClick={handleToggleReady}
                  disabled={markingReady}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 ${
                    selected.ready_for_delivery
                      ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                      : 'bg-sky-500 text-white hover:bg-sky-600'
                  }`}
                >
                  {markingReady ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : selected.ready_for_delivery ? (
                    <><CheckCircle2 className="w-4 h-4" /> {lang === 'fr' ? 'Prêt' : 'Ready'}</>
                  ) : (
                    <><CheckCircle2 className="w-4 h-4" /> {lang === 'fr' ? 'Marquer prêt' : 'Mark ready'}</>
                  )}
                </button>
              </div>
            )}

            {/* Bouton retrait total - seulement quand tous les articles sont retirés */}
            {allWithdrawn ? (
              <button
                onClick={handleRetraitAll}
                disabled={confirming}
                className="w-full px-4 py-3 rounded-xl bg-emerald-500 text-white font-medium text-sm hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {confirming ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {t('retrait.processing')}
                  </>
                ) : (
                  <>
                    <ArrowUpFromLine className="w-4 h-4" />
                    {t('retrait.closeDeposit')}
                  </>
                )}
              </button>
            ) : (
              <div className="rounded-xl bg-sky-50 border border-sky-100 p-4 text-center">
                <p className="text-sm text-sky-700 font-medium">
                  {t('retrait.withdrawEach')}
                </p>
                <button
                  onClick={handleRetraitAll}
                  disabled={confirming}
                  className="mt-3 w-full px-4 py-2.5 rounded-lg bg-emerald-500 text-white font-medium text-sm hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {confirming ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      {t('retrait.processing')}
                    </>
                  ) : (
                    <>
                      <ArrowUpFromLine className="w-4 h-4" />
                      {t('retrait.withdrawAllClose')}
                    </>
                  )}
                </button>
              </div>
            )}
            {/* Print buttons — reprint without validating retrait */}
            <div className="flex gap-2">
              <button
                onClick={() => handlePrintRetired('a5')}
                className={`flex-1 px-4 py-2.5 rounded-lg border font-medium text-sm transition-colors flex items-center justify-center gap-2 ${printFormat === 'a5' ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
              >
                <Printer className="w-4 h-4" /> A5
              </button>
              <button
                onClick={() => handlePrintRetired('ticket')}
                className={`flex-1 px-4 py-2.5 rounded-lg border font-medium text-sm transition-colors flex items-center justify-center gap-2 ${printFormat === 'ticket' ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
              >
                <Receipt className="w-4 h-4" /> Ticket 80mm
              </button>
              <button
                onClick={async () => {
                  setShowLabels(true);
                  const { error: lblErr } = await printDepotLabels(selected, entreprise);
                  if (lblErr) setError(lblErr);
                  setShowLabels(false);
                }}
                className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 font-medium text-sm transition-colors flex items-center justify-center gap-2 text-slate-700 hover:bg-slate-50"
              >
                <Tags className="w-4 h-4" /> {lang === 'fr' ? 'Étiquettes' : 'Labels'}
              </button>
              {selected.client?.telephone && (() => {
                const receipt = buildReceiptData(selected, avances);
                const totalPaye = receipt.modeReglement === 'PAYER_DEPOT' || receipt.modeReglement === 'SOLDE'
                  ? receipt.total
                  : receipt.avanceAmount ?? 0;
                const reste = Math.max(0, receipt.total - totalPaye);
                const waMessage = buildWhatsAppMessage({
                  entrepriseNom: receiptHeader.nom,
                  entrepriseTelephone: receiptHeader.telephone,
                  entrepriseAdresse: receiptHeader.adresse,
                  entrepriseVille: receiptHeader.ville,
                  entrepriseEmail: receiptHeader.email,
                  entrepriseSlogan: receiptHeader.slogan,
                  entrepriseId: entreprise?.id,
                  numero: receipt.numero,
                  clientNom: receipt.clientNom,
                  portalCode: receipt.portalCode ?? null,
                  dateDepot: receipt.dateDepot,
                  dateRetraitPrevue: receipt.dateRetraitPrevue,
                  traitement: receipt.traitement,
                  coefficient: receipt.coefficient,
                  total: receipt.total,
                  totalAvantRemise: receipt.totalAvantRemise,
                  tauxRemise: receipt.tauxRemise,
                  montantRemise: receipt.montantRemise,
                  articles: receipt.articles,
                  reste,
                  notes: receipt.notes,
                });
                const waUrl = buildWhatsAppUrl(selected.client.telephone, waMessage);
                return (
                  <a
                    href={waUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 px-4 py-2.5 rounded-lg bg-emerald-500 text-white font-medium text-sm hover:bg-emerald-600 transition-colors flex items-center justify-center gap-2"
                  >
                    <MessageCircle className="w-4 h-4" /> WhatsApp
                  </a>
                );
              })()}
            </div>
            {detailReceiptData && (
              <PrintableReceipt key={selected.id} data={detailReceiptData} format={printFormat} modesReglement={modesReglement} entreprise={entreprise} boutique={selectedBoutique} />
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-center">
              <Check className="w-6 h-6 text-emerald-600 mx-auto mb-2" />
              <p className="text-sm font-medium text-emerald-700">
                {t('retrait.alreadyWithdrawn', { date: formatDate(selected.date_retrait) })}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handlePrintRetired('a5')}
                className={`flex-1 px-4 py-2.5 rounded-lg border font-medium text-sm transition-colors flex items-center justify-center gap-2 ${printFormat === 'a5' ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
              >
                <Printer className="w-4 h-4" /> A5
              </button>
              <button
                onClick={() => handlePrintRetired('ticket')}
                className={`flex-1 px-4 py-2.5 rounded-lg border font-medium text-sm transition-colors flex items-center justify-center gap-2 ${printFormat === 'ticket' ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
              >
                <Receipt className="w-4 h-4" /> Ticket 80mm
              </button>
              <button
                onClick={async () => {
                  setShowLabels(true);
                  const { error: lblErr } = await printDepotLabels(selected, entreprise);
                  if (lblErr) setError(lblErr);
                  setShowLabels(false);
                }}
                className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 font-medium text-sm transition-colors flex items-center justify-center gap-2 text-slate-700 hover:bg-slate-50"
              >
                <Tags className="w-4 h-4" /> {lang === 'fr' ? 'Étiquettes' : 'Labels'}
              </button>
              {detailReceiptData?.clientTel && (() => {
                const totalPaye = detailReceiptData.modeReglement === 'PAYER_DEPOT' || detailReceiptData.modeReglement === 'SOLDE'
                  ? detailReceiptData.total
                  : detailReceiptData.avanceAmount ?? 0;
                const reste = Math.max(0, detailReceiptData.total - totalPaye);
                const waMessage = buildWhatsAppMessage({
                  entrepriseNom: receiptHeader.nom,
                  entrepriseTelephone: receiptHeader.telephone,
                  entrepriseAdresse: receiptHeader.adresse,
                  entrepriseVille: receiptHeader.ville,
                  entrepriseEmail: receiptHeader.email,
                  entrepriseSlogan: receiptHeader.slogan,
                  entrepriseId: entreprise?.id,
                  numero: detailReceiptData.numero,
                  clientNom: detailReceiptData.clientNom,
                  portalCode: detailReceiptData.portalCode ?? null,
                  dateDepot: detailReceiptData.dateDepot,
                  dateRetraitPrevue: detailReceiptData.dateRetraitPrevue,
                  traitement: detailReceiptData.traitement,
                  coefficient: detailReceiptData.coefficient,
                  total: detailReceiptData.total,
                  totalAvantRemise: detailReceiptData.totalAvantRemise,
                  tauxRemise: detailReceiptData.tauxRemise,
                  montantRemise: detailReceiptData.montantRemise,
                  articles: detailReceiptData.articles,
                  reste,
                  notes: detailReceiptData.notes,
                });
                const waUrl = buildWhatsAppUrl(detailReceiptData.clientTel, waMessage);
                return (
                  <a
                    href={waUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 px-4 py-2.5 rounded-lg bg-emerald-500 text-white font-medium text-sm hover:bg-emerald-600 transition-colors flex items-center justify-center gap-2"
                  >
                    <MessageCircle className="w-4 h-4" /> WhatsApp
                  </a>
                );
              })()}
            </div>
            {detailReceiptData && (
              <PrintableReceipt key={selected.id} data={detailReceiptData} format={printFormat} modesReglement={modesReglement} entreprise={entreprise} boutique={selectedBoutique} />
            )}
            {showLabels && <PrintableLabels depot={selected} entreprise={entreprise} />}
          </div>
        )}
      </div>
    );
  }

  // Search screen
  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="text-center">
        <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-3">
          <ArrowUpFromLine className="w-7 h-7 text-emerald-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">{t('retrait.title')}</h2>
        <p className="text-sm text-slate-500 mt-1">
          {t('retrait.subtitle')}
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder={t('retrait.searchPlaceholder')}
          autoFocus
          className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
        />
      </div>

      {loading && <p className="text-sm text-slate-400 text-center">{t('retrait.searching')}</p>}

      {error && !loading && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && searchTerm && results.length === 0 && (
        <div className="text-center py-8">
          <p className="text-sm text-slate-400">{t('retrait.noResult', { term: searchTerm })}</p>
        </div>
      )}

      {!loading && !searchTerm && (
        <div className="text-center py-8">
          <p className="text-sm text-slate-400">{t('retrait.startTyping')}</p>
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((depot) => (
            <button
              key={depot.id}
              onClick={async () => {
                setAvances([]);
                setSuccessData(null);
                setSelected(depot);
                const avs = await db.getAvancesForDepot(depot.id);
                setAvances(avs);
              }}
              className="w-full flex items-center justify-between p-4 rounded-xl border border-slate-100 bg-white hover:border-emerald-200 hover:shadow-sm transition-all text-left group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    depot.statut === 'EN_COURS'
                      ? 'bg-amber-50 text-amber-500'
                      : 'bg-emerald-50 text-emerald-500'
                  }`}
                >
                  {depot.statut === 'EN_COURS' ? (
                    <Clock className="w-5 h-5" />
                  ) : (
                    <Check className="w-5 h-5" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    {depot.numero} — {depot.client?.nom ?? t('retrait.unknownClient')}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {formatDate(depot.date_depot)} · {depot.articles.length} {lang === 'fr' ? 'article(s)' : 'item(s)'} ·{' '}
                    {formatPrice(Number(depot.total))}
                  </p>
                  {depot.date_retrait_prevue && (
                    <p className="text-xs text-sky-500 mt-0.5 flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {t('retrait.retraitPrevu')}: {formatDateShort(depot.date_retrait_prevue)}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                <span
                  className={`text-xs font-medium px-2 py-1 rounded-full ${
                    depot.statut === 'EN_COURS'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-emerald-100 text-emerald-700'
                  }`}
                >
                  {depot.statut === 'EN_COURS' ? t('retrait.inProgress') : t('retrait.withdrawn')}
                </span>
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-emerald-400 transition-colors" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
