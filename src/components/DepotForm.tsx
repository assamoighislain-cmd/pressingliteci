import { useState, useEffect, useCallback } from 'react';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { db, rpc } from '@/lib/db';
import {
  Client,
  TypeTraitement,
  ArticleCatalog,
  ArticleVariant,
  TraitementCode,
  ModeReglement,
  ModeReglementRow,
  BonReduction,
  getCoefficientById,
  getNbJoursById,
  computeDateRetraitPrevueById,
  getTraitementLabelById,
  formatPrice,
  formatDate,
  formatDateShort,
} from '@/types';
import {
  Trash2,
  Search,
  UserPlus,
  Check,
  ChevronDown,
  X,
  Printer,
  Calendar,
  Percent,
  MessageCircle,
  Receipt,
  PlusCircle,
  Ticket,
  Tags,
  Monitor,
  Lock,
  Hash,
} from 'lucide-react';
import PrintableReceipt, { PrintFormat } from '@/components/PrintableReceipt';
import PrintableLabels from '@/components/PrintableLabels';
import { printWithFormat, printDepotLabels } from '@/lib/print';
import {
  getBillingPointCode,
  setBillingPointCode,
  formatDepotNumero,
  formatClientCode,
  normalizeBillingPointCode,
} from '@/lib/dbOfflineHelpers';
import { Entreprise, buildWhatsAppMessage, buildWhatsAppUrl, getModeReglementLabel, applyPhonePrefix, resolveReceiptHeader } from '@/types';

interface ArticleDraft {
  id: string;
  article_id: string | null;
  variant_id: string | null;
  designation: string;
  prix_unitaire: string;
  quantite: string;
  nb_pieces: string;
  couleur: string;
  signe_particulier: string;
  griffe: string;
}

function uid(): string {
  return Math.random().toString(36).slice(2);
}

interface PaymentLineDraft {
  id: string;
  modeReglement: ModeReglement;
  montant: string;
}

function makeDefaultPaymentLine(montant = '', modeReglement: ModeReglement = ''): PaymentLineDraft {
  return {
    id: uid(),
    modeReglement,
    montant,
  };
}

function makeDefaultArticle(): ArticleDraft {
  return {
    id: uid(),
    article_id: null,
    variant_id: null,
    designation: '',
    prix_unitaire: '',
    quantite: '1',
    nb_pieces: '1',
    couleur: '',
    signe_particulier: '',
    griffe: '',
  };
}

export default function DepotForm({ onDone }: { onDone: () => void }) {
  const { t, lang } = useI18n();
  const { role, currentBoutique, reloadBoutiques } = useAuth();
  const canManageCounter = !role || role === 'admin' || role === 'gerant';
  const [step, setStep] = useState<'client' | 'articles' | 'paiement'>('client');

  const [typesTraitement, setTypesTraitement] = useState<TypeTraitement[]>([]);
  const [catalogArticles, setCatalogArticles] = useState<ArticleCatalog[]>([]);
  const [allVariants, setAllVariants] = useState<ArticleVariant[]>([]);
  const [modesReglement, setModesReglement] = useState<ModeReglementRow[]>([]);
  const [fieldHistory, setFieldHistory] = useState<{ couleur: string[]; signe_particulier: string[]; griffe: string[] }>({ couleur: [], signe_particulier: [], griffe: [] });

  // Client state
  const [searchTerm, setSearchTerm] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClientNom, setNewClientNom] = useState('');
  const [newClientTel, setNewClientTel] = useState('');
  const [clientSearchLoading, setClientSearchLoading] = useState(false);

  // Articles state
  const [articles, setArticles] = useState<ArticleDraft[]>([makeDefaultArticle()]);
  const [articleSearch, setArticleSearch] = useState<Record<string, string>>({});
  const [activeSearchId, setActiveSearchId] = useState<string | null>(null);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogOpen, setCatalogOpen] = useState(false);

  // Inline article creation
  const [showNewArticle, setShowNewArticle] = useState<string | null>(null);
  const [newArtDesignation, setNewArtDesignation] = useState('');
  const [newArtPrix, setNewArtPrix] = useState('');
  const [newArtPieces, setNewArtPieces] = useState('1');
  const [creatingArticle, setCreatingArticle] = useState(false);

  // Treatment state (depot-level) — stores the type_traitement ID
  const [typeTraitementId, setTypeTraitementId] = useState<string>('');

  function handleTypeTraitementChange(newId: string) {
    const oldCoef = getCoefficientById(typeTraitementId, typesTraitement);
    const newCoef = getCoefficientById(newId, typesTraitement);
    setTypeTraitementId(newId);
    if (oldCoef !== newCoef) {
      setArticles((prev) =>
        prev.map((a) => {
          const pu = parseFloat(a.prix_unitaire) || 0;
          const base = oldCoef !== 0 ? pu / oldCoef : pu;
          return { ...a, prix_unitaire: String(base * newCoef) };
        }),
      );
    }
  }

  // Paiement state (supports multiple payment methods per deposit)
  const [paymentLines, setPaymentLines] = useState<PaymentLineDraft[]>([makeDefaultPaymentLine()]);
  const [notes, setNotes] = useState('');

  // Coupon state
  const [couponCode, setCouponCode] = useState('');
  const [couponLoading, setCouponLoading] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState<BonReduction | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);

  // Success
  const [success, setSuccess] = useState<{
    numero: string;
    total: number;
    dateRetraitPrevue: string;
    dateDepot: string;
    traitement: string;
    coefficient: number;
    modeReglement: ModeReglement | null;
    avanceAmount: number;
    reglements: { montant: number; modeReglement: string | null; datePaiement: string }[];
    notes: string | null;
    articles: {
      designation: string;
      quantite: number;
      nb_pieces: number;
      prix_unitaire: number;
      prix_total: number;
      couleur: string | null;
      signe_particulier: string | null;
      griffe: string | null;
    }[];
    totalAvantRemise: number;
    tauxRemise: number;
    montantRemise: number;
    modeReglementRemise: number;
    modeReglementTauxRemise: number;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [creatingClient, setCreatingClient] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entreprise, setEntreprise] = useState<Entreprise | null>(null);
  const [printFormat, setPrintFormat] = useState<PrintFormat>('a5');
  const [previewMode, setPreviewMode] = useState<'receipt' | 'labels'>('receipt');
  const [billingPointCode, setBillingPointCodeState] = useState<string>(() => getBillingPointCode());
  const [showBillingPointPicker, setShowBillingPointPicker] = useState(false);
  const [depotStartSeq, setDepotStartSeqState] = useState<number | null>(() => db.getDepotStartNumber());
  const [startSeqInput, setStartSeqInput] = useState<string>(() => {
    const s = db.getDepotStartNumber();
    return s !== null ? String(s) : '';
  });
  const [startSeqSavedMsg, setStartSeqSavedMsg] = useState(false);
  const [nextDepotPreview, setNextDepotPreview] = useState<string>('');

  // Load treatment types and catalog
  useEffect(() => {
    (async () => {
      const [typesData, articlesData, variantsData, entreprise, modesData, couleurs, signes, griffes] = await Promise.all([
        db.getTypesTraitement(),
        db.getArticles(),
        db.getAllVariants(),
        db.getEntreprise(),
        db.getModesReglement(),
        db.getDistinctFieldValues('couleur'),
        db.getDistinctFieldValues('signe_particulier'),
        db.getDistinctFieldValues('griffe'),
      ]);
      setTypesTraitement(typesData);
      if (typesData.length > 0) setTypeTraitementId(typesData[0].id);
      setCatalogArticles(articlesData);
      setAllVariants(variantsData);
      setModesReglement(modesData);
      setEntreprise(entreprise);
      setFieldHistory({
        couleur: couleurs.filter((v) => v.toUpperCase() !== 'AUCUN'),
        signe_particulier: signes.filter((v) => v.toUpperCase() !== 'AUCUN'),
        griffe: griffes.filter((v) => v.toUpperCase() !== 'AUCUN'),
      });
    })();
  }, []);

  const searchClients = useCallback(async (term: string) => {
    if (term.trim().length < 1) {
      setClients([]);
      return;
    }
    setClientSearchLoading(true);
    setClients(await db.searchClients(term));
    setClientSearchLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => searchClients(searchTerm), 250);
    return () => clearTimeout(timer);
  }, [searchTerm, searchClients]);



  function addArticleFromCatalog(catalogId: string) {
    const catalogItem = catalogArticles.find((c) => c.id === catalogId);
    if (!catalogItem) return;
    const variants = allVariants.filter((v) => v.article_id === catalogItem.id);
    const firstVariant = variants.length > 0 ? variants[0] : null;
    const coef = getCoefficientById(typeTraitementId, typesTraitement);
    const basePrice = firstVariant ? firstVariant.prix_traitement : catalogItem.prix_unitaire;
    const newArticle: ArticleDraft = {
      id: uid(),
      article_id: catalogItem.id,
      variant_id: firstVariant?.id ?? null,
      designation: catalogItem.designation,
      prix_unitaire: String(basePrice * coef),
      quantite: '1',
      nb_pieces: String(catalogItem.nb_pieces),
      couleur: '',
      signe_particulier: '',
      griffe: '',
    };
    setArticles((prev) => {
      const hasEmpty = prev.length === 1 && !prev[0].designation.trim() && !prev[0].article_id;
      if (hasEmpty) return [newArticle];
      return [...prev, newArticle];
    });
  }

  function removeArticle(id: string) {
    setArticles((prev) => (prev.length > 1 ? prev.filter((a) => a.id !== id) : prev));
  }

  function updateArticle(id: string, field: keyof ArticleDraft, value: string) {
    setArticles((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a;
        const updated = { ...a, [field]: value } as ArticleDraft;

        // When selecting a catalog article, fill in designation + price
        if (field === 'article_id') {
          const catalogItem = catalogArticles.find((c) => c.id === value);
          if (catalogItem) {
            updated.designation = catalogItem.designation;
            updated.nb_pieces = String(catalogItem.nb_pieces);
            updated.article_id = catalogItem.id;
            const variants = allVariants.filter((v) => v.article_id === catalogItem.id);
            const coef = getCoefficientById(typeTraitementId, typesTraitement);
            if (variants.length > 0) {
              updated.variant_id = variants[0].id;
              updated.prix_unitaire = String(variants[0].prix_traitement * coef);
            } else {
              updated.variant_id = null;
              updated.prix_unitaire = String(catalogItem.prix_unitaire * coef);
            }
          } else {
            updated.article_id = null;
            updated.variant_id = null;
          }
        } else if (field === 'variant_id') {
          const variant = allVariants.find((v) => v.id === value);
          const coef = getCoefficientById(typeTraitementId, typesTraitement);
          if (variant) {
            updated.variant_id = variant.id;
            updated.prix_unitaire = String(variant.prix_traitement * coef);
          } else {
            updated.variant_id = null;
            const catalogItem = catalogArticles.find((c) => c.id === a.article_id);
            if (catalogItem) updated.prix_unitaire = String(catalogItem.prix_unitaire * coef);
          }
        }
        return updated;
      }),
    );
  }

  function getFilteredArticles(id: string): ArticleCatalog[] {
    const term = (articleSearch[id] ?? '').trim().toLowerCase();
    if (!term) return [];
    return catalogArticles
      .filter((c) => c.designation.toLowerCase().includes(term))
      .slice(0, 8);
  }

  function selectCatalogArticle(rowId: string, catalogId: string) {
    const catalogItem = catalogArticles.find((c) => c.id === catalogId);
    if (!catalogItem) return;
    const variants = allVariants.filter((v) => v.article_id === catalogItem.id);
    const firstVariant = variants.length > 0 ? variants[0] : null;
    setArticles((prev) =>
      prev.map((a) => {
        if (a.id !== rowId) return a;
        return {
          ...a,
          article_id: catalogItem.id,
          variant_id: firstVariant?.id ?? null,
          designation: catalogItem.designation,
          nb_pieces: String(catalogItem.nb_pieces),
          prix_unitaire: String((firstVariant ? firstVariant.prix_traitement : catalogItem.prix_unitaire) * getCoefficientById(typeTraitementId, typesTraitement)),
        };
      }),
    );
    setArticleSearch((prev) => { const next = { ...prev }; delete next[rowId]; return next; });
    setActiveSearchId(null);
  }

  function computeArticleTotal(article: ArticleDraft): number {
    const pu = parseFloat(article.prix_unitaire) || 0;
    const qte = parseInt(article.quantite) || 0;
    return pu * qte;
  }

  const grandTotal = articles.reduce((sum, a) => sum + computeArticleTotal(a), 0);
  const totalPieces = articles.reduce((sum, a) => sum + (parseInt(a.nb_pieces) || 0) * (parseInt(a.quantite) || 0), 0);

  // Remise: only for NORMAL treatment, if client has a rate and condition is met
  const clientTauxRemise = selectedClient?.taux_remise ?? 0;
  const clientConditionRemise = selectedClient?.condition_remise ?? 0;
  const traitementCoef = getCoefficientById(typeTraitementId, typesTraitement);
  const remiseApplicable = traitementCoef <= 1 && clientTauxRemise > 0 && grandTotal >= clientConditionRemise;
  const tauxRemise = remiseApplicable ? clientTauxRemise : 0;
  const montantRemise = Math.round(grandTotal * tauxRemise / 100);
  const afterClientRemise = grandTotal - montantRemise;

  // Coupon discount (applied after client remise)
  const couponDiscount = appliedCoupon
    ? appliedCoupon.type_remise === 'pourcentage'
      ? Math.round(afterClientRemise * appliedCoupon.valeur / 100)
      : Math.min(appliedCoupon.valeur, afterClientRemise)
    : 0;
  const totalApresRemise = afterClientRemise - couponDiscount;

  // Mode de règlement discount (supports single and multiple payment lines)
  const paymentDiscountItems = paymentLines
    .map((line) => ({
      line,
      amount: parseFloat(line.montant) || 0,
      mode: modesReglement.find((m) => m.designation === line.modeReglement),
    }))
    .filter((item) => item.mode && item.mode.taux_remise > 0);

  let modeReglementRemise = 0;
  let modeReglementTauxRemise = 0;
  let modeReglementRemiseLabel = '';

  if (paymentLines.length === 1) {
    const only = paymentDiscountItems[0];
    if (only?.mode) {
      modeReglementTauxRemise = only.mode.taux_remise;
      modeReglementRemise = Math.round(totalApresRemise * modeReglementTauxRemise / 100);
      modeReglementRemiseLabel = only.mode.designation;
    }
  } else if (paymentDiscountItems.length > 0) {
    let remainingBase = totalApresRemise;
    for (const item of paymentDiscountItems) {
      if (!item.mode || item.amount <= 0 || remainingBase <= 0) continue;
      const base = Math.min(item.amount, remainingBase);
      modeReglementRemise += Math.round(base * item.mode.taux_remise / 100);
      remainingBase -= base;
    }
    modeReglementRemise = Math.min(modeReglementRemise, totalApresRemise);
    if (modeReglementRemise > 0) {
      modeReglementTauxRemise = Math.round((modeReglementRemise / Math.max(1, totalApresRemise)) * 100);
      modeReglementRemiseLabel = Array.from(
        new Set(paymentDiscountItems.filter((i) => i.amount > 0 && i.mode).map((i) => i.mode!.designation)),
      ).join(' + ');
    }
  }

  const totalFinal = totalApresRemise - modeReglementRemise;
  const totalPayeInput = paymentLines.reduce((sum, l) => sum + (parseFloat(l.montant) || 0), 0);
  const resteAPayer = Math.max(0, totalFinal - totalPayeInput);
  const tropPercu = Math.max(0, totalPayeInput - totalFinal);

  function updatePaymentLine(id: string, field: 'modeReglement' | 'montant', value: string) {
    setPaymentLines((prev) => prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)));
  }

  function addPaymentLine() {
    const remaining = Math.max(0, totalFinal - totalPayeInput);
    const usedModes = new Set(paymentLines.map((l) => l.modeReglement).filter(Boolean));
    const nextMode = modesReglement.find((m) => !usedModes.has(m.designation))?.designation ?? '';
    setPaymentLines((prev) => [
      ...prev,
      makeDefaultPaymentLine(remaining > 0 ? String(remaining) : '', nextMode),
    ]);
  }

  function removePaymentLine(id: string) {
    setPaymentLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));
  }

  function fillRemainingForLine(id: string) {
    const otherPaid = paymentLines
      .filter((l) => l.id !== id)
      .reduce((sum, l) => sum + (parseFloat(l.montant) || 0), 0);
    const remaining = Math.max(0, totalFinal - otherPaid);
    setPaymentLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, montant: remaining > 0 ? String(remaining) : '' } : l)),
    );
  }

  // Compute date retrait prévue (auto, can be overridden)
  const autoDateRetraitPrevue = computeDateRetraitPrevueById(
    new Date(),
    typeTraitementId || null,
    typesTraitement,
  );
  const [dateRetraitOverride, setDateRetraitOverride] = useState<string>('');
  const [dateDepotOverride, setDateDepotOverride] = useState<string>('');
  const dateRetraitPrevue = dateRetraitOverride
    ? new Date(dateRetraitOverride + 'T18:00:00')
    : autoDateRetraitPrevue;
  const dateDepotEffective = dateDepotOverride
    ? new Date(dateDepotOverride + 'T12:00:00')
    : new Date();
  const effectiveYear = dateDepotEffective.getFullYear();

  const refreshNextPreview = useCallback(() => {
    const d = dateDepotOverride ? new Date(dateDepotOverride + 'T12:00:00') : new Date();
    const currentStart = db.getDepotStartNumber(d);
    setDepotStartSeqState(currentStart);
    setStartSeqInput(currentStart !== null ? String(currentStart) : '');
    void db.previewNextDepotNumero(d).then((preview) => setNextDepotPreview(preview));
  }, [dateDepotOverride]);

  useEffect(() => {
    refreshNextPreview();
  }, [refreshNextPreview, billingPointCode, effectiveYear, success, currentBoutique?.id]);

  useEffect(() => {
    const onSyncChange = () => {
      setBillingPointCodeState(getBillingPointCode());
      refreshNextPreview();
    };
    window.addEventListener('pressinglite:billing-point-changed', onSyncChange);
    window.addEventListener('pressinglite:depot-start-seq-changed', onSyncChange);
    window.addEventListener('pressinglite:boutique-changed', onSyncChange);
    return () => {
      window.removeEventListener('pressinglite:billing-point-changed', onSyncChange);
      window.removeEventListener('pressinglite:depot-start-seq-changed', onSyncChange);
      window.removeEventListener('pressinglite:boutique-changed', onSyncChange);
    };
  }, [refreshNextPreview]);

  function canProceedArticles(): boolean {
    return articles.every(
      (a) =>
        a.designation.trim() !== '' &&
        parseFloat(a.prix_unitaire) > 0 &&
        parseInt(a.quantite) > 0 &&
        parseInt(a.nb_pieces) > 0,
    );
  }

  async function handleCreateClient() {
    if (!newClientNom.trim()) return;
    setError(null);
    setCreatingClient(true);
    try {
      const { data: generatedCode, error: codeError } = await rpc<string>('generate_client_code');
      if (codeError || !generatedCode) {
        setError(codeError ?? t('depot.errorGenCode'));
        return;
      }

      const newClient = await db.insertClient({
        code: generatedCode,
        nom: newClientNom.trim(),
        telephone: applyPhonePrefix(newClientTel, entreprise?.phone_prefix) || null,
        taux_remise: 0,
        condition_remise: null,
      });
      if (!newClient.data) {
        setError(newClient.error ?? t('depot.errorCreateClient'));
        return;
      }
      setSelectedClient(newClient.data);
      setShowNewClient(false);
      setNewClientNom('');
      setNewClientTel('');
      setStep('articles');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('depot.errorCreateClient'));
    } finally {
      setCreatingClient(false);
    }
  }

  async function handleCreateArticleInline(forRowId: string | null) {
    if (!newArtDesignation.trim() || !(parseFloat(newArtPrix) > 0)) return;
    setCreatingArticle(true);
    setError(null);
    try {
      const { data: code, error: codeErr } = await rpc<string>('generate_article_code');
      if (codeErr || !code) { setError(codeErr ?? 'Code error'); return; }
      const prix = parseFloat(newArtPrix);
      const nbPieces = parseInt(newArtPieces) || 1;
      const res = await db.insertArticleReturning({ code, designation: newArtDesignation.trim(), prix_unitaire: prix, nb_pieces: nbPieces });
      if (res.error || !res.data) { setError(res.error ?? 'Insert error'); return; }
      const created = res.data;
      setCatalogArticles((prev) => [...prev, created]);
      const coef = getCoefficientById(typeTraitementId, typesTraitement);
      const newDraft: ArticleDraft = {
        id: uid(),
        article_id: created.id,
        variant_id: null,
        designation: created.designation,
        prix_unitaire: String(created.prix_unitaire * coef),
        quantite: '1',
        nb_pieces: String(created.nb_pieces),
        couleur: '',
        signe_particulier: '',
        griffe: '',
      };
      if (forRowId) {
        setArticles((prev) => prev.map((a) => a.id === forRowId ? { ...newDraft, id: a.id } : a));
      } else {
        setArticles((prev) => {
          const hasEmpty = prev.length === 1 && !prev[0].designation.trim() && !prev[0].article_id;
          return hasEmpty ? [newDraft] : [...prev, newDraft];
        });
      }
      setShowNewArticle(null);
      setNewArtDesignation('');
      setNewArtPrix('');
      setNewArtPieces('1');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setCreatingArticle(false);
    }
  }

  async function handleSubmit() {
    if (!selectedClient) return;

    const paidLines = paymentLines
      .map((l) => ({
        modeReglement: l.modeReglement,
        montant: parseFloat(l.montant) || 0,
      }))
      .filter((l) => l.montant > 0);

    if (paidLines.length > 1 && paidLines.some((l) => !l.modeReglement)) {
      setError(
        lang === 'fr'
          ? 'Veuillez sélectionner un mode de règlement pour chaque ligne de paiement.'
          : 'Please select a payment method for each payment line.',
      );
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const numeroResult = await db.nextDepotNumero(dateDepotEffective);
      if (numeroResult.error || !numeroResult.numero) {
        throw new Error(numeroResult.error ?? t('depot.errorCounter'));
      }
      const numero = numeroResult.numero;

      const primaryLine = paidLines[0] ?? {
        modeReglement: paymentLines[0]?.modeReglement ?? '',
        montant: 0,
      };
      const primaryAvance = primaryLine.montant;
      const primaryModeReglement = primaryLine.modeReglement || null;
      const totalPaid = paidLines.reduce((sum, l) => sum + l.montant, 0);

      const coef = getCoefficientById(typeTraitementId, typesTraitement);
      const selectedType = typesTraitement.find((t) => t.id === typeTraitementId);
      const traitementLibelle = selectedType?.libelle ?? '';

      const depotData = await db.insertDepot({
        numero,
        client_id: selectedClient.id,
        statut: 'EN_COURS',
        mode_reglement: primaryModeReglement,
        avance_amount: primaryAvance,
        total: totalFinal,
        traitement: traitementLibelle,
        taux_remise: tauxRemise,
        montant_remise: montantRemise + modeReglementRemise,
        coefficient: coef,
        type_traitement_id: typeTraitementId || null,
        date_depot: dateDepotEffective.toISOString(),
        date_retrait_prevue: dateRetraitPrevue.toISOString(),
        notes: notes.trim() || null,
      });

      const createdDepot = depotData.data;
      if (!createdDepot) throw new Error(depotData.error ?? (lang === 'fr' ? 'Erreur lors de la création du dépôt' : 'Error creating deposit'));

      const articlesToInsert = articles.map((a) => {
        const prixTrait = parseFloat(a.prix_unitaire);
        const qte = parseInt(a.quantite);
        const piecesParArticle = parseInt(a.nb_pieces);
        const basePu = coef !== 0 ? prixTrait / coef : prixTrait;
        return {
          depot_id: createdDepot.id,
          designation: a.designation.trim(),
          prix_unitaire: basePu,
          prix_traitement: prixTrait,
          quantite: qte,
          nb_pieces: piecesParArticle,
          prix_total: prixTrait * qte,
          couleur: a.couleur.trim() || null,
          signe_particulier: a.signe_particulier.trim() || null,
          griffe: a.griffe.trim() || null,
        };
      });

      const articlesError = await db.insertDepotArticles(articlesToInsert);
      if (articlesError) throw new Error(articlesError);

      // The first payment line is stored in depots.avance_amount + depots.mode_reglement.
      // Any additional payment lines are stored in depot_avances so there is zero double-counting
      // (totalPaye = depots.avance_amount + SUM(depot_avances.montant)).
      for (const extraLine of paidLines.slice(1)) {
        const avRes = await db.insertAvance(
          createdDepot.id,
          extraLine.montant,
          extraLine.modeReglement || undefined,
          dateDepotEffective.toISOString(),
        );
        if (avRes.error) {
          throw new Error(avRes.error);
        }
      }

      // Award fidelity points
      const ptsRate = entreprise?.fidelite_points_per_unit ?? 1;
      if (ptsRate > 0) {
        const earnedPts = Math.floor((totalFinal / 1000) * ptsRate);
        if (earnedPts > 0) {
          await db.addFidelitePoints(
            selectedClient.id,
            earnedPts,
            lang === 'fr' ? `Dépôt ${numero}` : `Deposit ${numero}`,
            createdDepot.id,
          );
        }
      }

      // Increment coupon usage
      if (appliedCoupon) {
        await db.incrementBonUsage(appliedCoupon.id);
      }

      const reglements = paidLines.map((l) => ({
        montant: l.montant,
        modeReglement: l.modeReglement || null,
        datePaiement: dateDepotEffective.toISOString(),
      }));

      setSuccess({
        numero,
        total: totalFinal,
        totalAvantRemise: grandTotal,
        tauxRemise,
        montantRemise: montantRemise + modeReglementRemise,
        modeReglementRemise,
        modeReglementTauxRemise,
        dateRetraitPrevue: dateRetraitPrevue.toISOString(),
        dateDepot: dateDepotEffective.toISOString(),
        traitement: getTraitementLabelById(typeTraitementId, typesTraitement),
        coefficient: coef,
        modeReglement: primaryModeReglement,
        avanceAmount: totalPaid,
        reglements,
        notes: notes.trim() || null,
        articles: articles.map((a) => {
          const prixTrait = parseFloat(a.prix_unitaire);
          return {
            designation: a.designation.trim(),
            quantite: parseInt(a.quantite),
            nb_pieces: parseInt(a.nb_pieces),
            prix_unitaire: prixTrait,
            prix_total: prixTrait * parseInt(a.quantite),
            couleur: a.couleur.trim() || null,
            signe_particulier: a.signe_particulier.trim() || null,
            griffe: a.griffe.trim() || null,
          };
        }),
      });
    } catch (err) {
      console.error('DepotForm handleSubmit error:', err);
      setError(err instanceof Error ? err.message : t('depot.error'));
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setStep('client');
    setSelectedClient(null);
    setSearchTerm('');
    setArticles([makeDefaultArticle()]);
    setDateRetraitOverride('');
    setDateDepotOverride('');
    setTypeTraitementId('');
    setPaymentLines([makeDefaultPaymentLine()]);
    setNotes('');
    setCouponCode('');
    setAppliedCoupon(null);
    setCouponError(null);
    setSuccess(null);
    setError(null);
    setPreviewMode('receipt');
  }

  async function handleApplyCoupon() {
    if (!couponCode.trim()) return;
    setCouponLoading(true);
    setCouponError(null);
    const res = await db.validateBonReduction(couponCode.trim());
    if (res.error || !res.data) {
      setCouponError(res.error ?? 'Code invalide');
      setAppliedCoupon(null);
    } else {
      setAppliedCoupon(res.data);
      setCouponError(null);
    }
    setCouponLoading(false);
  }

  function removeCoupon() {
    setAppliedCoupon(null);
    setCouponCode('');
    setCouponError(null);
  }

  // ─── Success screen ──────────────────────────────────────

  if (success) {
    const receiptData = {
      numero: success.numero,
      clientNom: selectedClient?.nom ?? '—',
      clientTel: selectedClient?.telephone ?? null,
      dateDepot: success.dateDepot,
      dateRetraitPrevue: success.dateRetraitPrevue,
      traitement: success.traitement,
      coefficient: success.coefficient,
      modeReglement: success.modeReglement,
      avanceAmount: success.avanceAmount,
      total: success.total,
      totalAvantRemise: success.totalAvantRemise,
      tauxRemise: success.tauxRemise,
      montantRemise: success.montantRemise,
      modeReglementRemise: success.modeReglementRemise,
      modeReglementTauxRemise: success.modeReglementTauxRemise,
      notes: success.notes,
      reglements: success.reglements,
      articles: success.articles,
    };

    const labelsData: { date: string; numero: string; clientNom: string; dateRetrait: string; designation: string; pieceIndex: number; pieceTotal: number }[] = [];
    for (const art of success.articles) {
      const totalPieces = Number(art.nb_pieces ?? 1) * Number(art.quantite ?? 1);
      for (let i = 0; i < totalPieces; i++) {
        labelsData.push({
          date: formatDateShort(success.dateDepot),
          numero: success.numero,
          clientNom: selectedClient?.nom ?? '—',
          dateRetrait: formatDateShort(success.dateRetraitPrevue),
          designation: art.designation,
          pieceIndex: i + 1,
          pieceTotal: totalPieces,
        });
      }
    }

    const labelFieldsCfg = entreprise?.label_fields ?? ['date_depot', 'numero', 'client_nom', 'date_retrait', 'piece_number', 'designation'];
    const showField = (f: string) => labelFieldsCfg.includes(f);

    if (previewMode === 'labels') {
      return (
        <div className="max-w-lg mx-auto">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 no-print">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Tags className="w-5 h-5 text-sky-500" /> {lang === 'fr' ? 'Étiquettes' : 'Labels'}
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    const labelsDepot = {
                      id: '',
                      numero: success.numero,
                      client_id: selectedClient?.id ?? '',
                      statut: 'EN_COURS' as const,
                      mode_reglement: success.modeReglement,
                      avance_amount: success.avanceAmount ?? null,
                      total: success.total,
                      traitement: success.traitement,
                      coefficient: success.coefficient,
                      type_traitement_id: null,
                      date_depot: success.dateDepot,
                      date_retrait_prevue: success.dateRetraitPrevue,
                      date_retrait: null,
                      notes: success.notes,
                      taux_remise: success.tauxRemise ?? null,
                      montant_remise: success.montantRemise ?? null,
                      pickup_requested: null, pickup_address: null, pickup_latitude: null, pickup_longitude: null, pickup_day: null,
                      delivery_requested: null, delivery_address: null, delivery_latitude: null, delivery_longitude: null, delivery_day: null,
                      collected_at: null, created_at: success.dateDepot,
                      articles: success.articles.map((a) => ({ id: '', depot_id: '', designation: a.designation, prix_unitaire: a.prix_unitaire, prix_traitement: a.prix_unitaire, quantite: a.quantite, nb_pieces: a.nb_pieces, prix_total: a.prix_total, couleur: a.couleur, signe_particulier: a.signe_particulier, griffe: a.griffe, date_retrait: null, created_at: success.dateDepot })),
                      client: { nom: selectedClient?.nom ?? '—', telephone: selectedClient?.telephone ?? null, portal_code: selectedClient?.portal_code ?? null },
                    } as import('@/types').DepotWithArticles;
                    const { error: lblErr } = await printDepotLabels(labelsDepot, entreprise);
                    if (lblErr) setError(lblErr);
                  }}
                  className="px-4 py-2 rounded-lg bg-sky-500 text-white font-medium text-sm hover:bg-sky-600 transition-colors flex items-center gap-2"
                >
                  <Printer className="w-4 h-4" /> {lang === 'fr' ? 'Imprimer' : 'Print'}
                </button>
                <button
                  onClick={() => setPreviewMode('receipt')}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 font-medium text-sm hover:bg-slate-50 transition-colors"
                >
                  {lang === 'fr' ? 'Retour au reçu' : 'Back to receipt'}
                </button>
              </div>
            </div>
            <p className="text-sm text-slate-500 mb-4">
              {success.numero} — {selectedClient?.nom} — {labelsData.length} {lang === 'fr' ? 'étiquette(s)' : 'label(s)'}
            </p>
            <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 max-h-[500px] overflow-y-auto">
              <div className="flex flex-col gap-[3px] max-w-[400px] mx-auto">
                {labelsData.map((label, idx) => (
                  <div key={idx} className="flex items-center gap-2 border border-slate-400 rounded px-2 bg-white" style={{ height: '40px' }}>
                    {showField('date_depot') && <span className="text-xs font-semibold text-slate-600 whitespace-nowrap shrink-0">{label.date}</span>}
                    {showField('numero') && <span className="text-sm font-extrabold text-slate-900 whitespace-nowrap shrink-0">{label.numero}</span>}
                    {showField('client_nom') && <span className="text-xs font-bold text-slate-800 truncate flex-1 min-w-0">{label.clientNom}</span>}
                    {showField('date_retrait') && <span className="text-xs font-semibold text-sky-700 whitespace-nowrap shrink-0">{label.dateRetrait}</span>}
                    {showField('designation') && <span className="text-xs font-semibold text-slate-900 truncate flex-1 min-w-0">{label.designation}</span>}
                    {showField('piece_number') && <span className="text-sm font-extrabold text-slate-900 whitespace-nowrap shrink-0">{label.pieceIndex}/{label.pieceTotal}</span>}
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={resetForm}
                className="flex-1 px-4 py-2.5 rounded-lg bg-sky-500 text-white font-medium text-sm hover:bg-sky-600 transition-colors"
              >
                {t('depot.newDepot')}
              </button>
              <button
                onClick={onDone}
                className="px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 font-medium text-sm hover:bg-slate-50 transition-colors"
              >
                {t('depot.backToDashboard')}
              </button>
            </div>
          </div>
          {(() => {
            const labelsDepot = {
              id: '',
              numero: success.numero,
              client_id: selectedClient?.id ?? '',
              statut: 'EN_COURS' as const,
              mode_reglement: success.modeReglement,
              avance_amount: success.avanceAmount ?? null,
              total: success.total,
              traitement: success.traitement,
              coefficient: success.coefficient,
              type_traitement_id: null,
              date_depot: success.dateDepot,
              date_retrait_prevue: success.dateRetraitPrevue,
              date_retrait: null,
              notes: success.notes,
              taux_remise: success.tauxRemise ?? null,
              montant_remise: success.montantRemise ?? null,
              pickup_requested: null,
              pickup_address: null,
              pickup_latitude: null,
              pickup_longitude: null,
              pickup_day: null,
              delivery_requested: null,
              delivery_address: null,
              delivery_latitude: null,
              delivery_longitude: null,
              delivery_day: null,
              collected_at: null,
              created_at: success.dateDepot,
              articles: success.articles.map((a) => ({
                id: '',
                depot_id: '',
                designation: a.designation,
                prix_unitaire: a.prix_unitaire,
                prix_traitement: a.prix_unitaire,
                quantite: a.quantite,
                nb_pieces: a.nb_pieces,
                prix_total: a.prix_total,
                couleur: a.couleur,
                signe_particulier: a.signe_particulier,
                griffe: a.griffe,
                date_retrait: null,
                created_at: success.dateDepot,
              })),
              client: { nom: selectedClient?.nom ?? '—', telephone: selectedClient?.telephone ?? null, portal_code: selectedClient?.portal_code ?? null },
            } as import('@/types').DepotWithArticles;
            return <PrintableLabels depot={labelsDepot} entreprise={entreprise} />;
          })()}
        </div>
      );
    }

    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 text-center no-print">
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
            <Check className="w-8 h-8 text-emerald-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">{t('depot.depositSaved')}</h2>
          <p className="text-sm text-slate-500 mt-1">{t('depot.invoiceCreated')}</p>

          <div className="mt-6 rounded-xl bg-slate-50 p-5 text-left space-y-1">
            <div className="flex justify-between py-2">
              <span className="text-sm text-slate-500">{t('depot.number')}</span>
              <span className="text-sm font-semibold text-slate-900">{success.numero}</span>
            </div>
            <div className="flex justify-between py-2 border-t border-slate-100">
              <span className="text-sm text-slate-500">{t('depot.client')}</span>
              <span className="text-sm font-semibold text-slate-900">{selectedClient?.nom}</span>
            </div>
            <div className="flex justify-between py-2 border-t border-slate-100">
              <span className="text-sm text-slate-500 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" /> {t('depot.retraitDate')}
              </span>
              <span className="text-sm font-semibold text-sky-600">
                {formatDate(success.dateRetraitPrevue)}
              </span>
            </div>
            <div className="flex justify-between py-2 border-t border-slate-100">
              <span className="text-sm text-slate-500">{t('depot.total')}</span>
              <span className="text-sm font-semibold text-slate-900">
                {formatPrice(success.total)}
              </span>
            </div>
            {success.tauxRemise > 0 && (
              <>
                <div className="flex justify-between py-2 border-t border-slate-100">
                  <span className="text-sm text-slate-500">{t('depot.subtotal')}</span>
                  <span className="text-sm text-slate-500 line-through">
                    {formatPrice(success.totalAvantRemise)}
                  </span>
                </div>
                <div className="flex justify-between py-2 border-t border-slate-100">
                  <span className="text-sm text-emerald-600">{t('depot.discount', { rate: success.tauxRemise })}</span>
                  <span className="text-sm font-semibold text-emerald-600">
                    −{formatPrice(success.montantRemise)}
                  </span>
                </div>
              </>
            )}
            {success.reglements.length > 0 && (
              <div className="py-2 border-t border-slate-100 space-y-1">
                <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                  {lang === 'fr' ? 'Règlements encaissés' : 'Payments received'}
                </span>
                {success.reglements.map((r, idx) => (
                  <div key={idx} className="flex justify-between text-sm">
                    <span className="text-slate-600">
                      {r.modeReglement ? getModeReglementLabel(r.modeReglement, modesReglement) : '—'}
                    </span>
                    <span className="font-semibold text-emerald-600">{formatPrice(r.montant)}</span>
                  </div>
                ))}
                {Math.max(0, success.total - success.avanceAmount) > 0 && (
                  <div className="flex justify-between text-sm pt-1 border-t border-slate-100">
                    <span className="text-red-500 font-medium">{t('depot.remainingToPay')}</span>
                    <span className="font-semibold text-red-600">
                      {formatPrice(Math.max(0, success.total - success.avanceAmount))}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-5 space-y-2">
            <div className="flex gap-2">
              <button
                onClick={() => { setPreviewMode('receipt'); setPrintFormat('a5'); setTimeout(() => printWithFormat('a5'), 50); }}
                className={`flex-1 px-4 py-2.5 rounded-lg border font-medium text-sm transition-colors flex items-center justify-center gap-2 ${previewMode === 'receipt' && printFormat === 'a5' ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
              >
                <Printer className="w-4 h-4" /> A5
              </button>
              <button
                onClick={() => { setPreviewMode('receipt'); setPrintFormat('ticket'); setTimeout(() => printWithFormat('ticket'), 50); }}
                className={`flex-1 px-4 py-2.5 rounded-lg border font-medium text-sm transition-colors flex items-center justify-center gap-2 ${previewMode === 'receipt' && printFormat === 'ticket' ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
              >
                <Receipt className="w-4 h-4" /> Ticket 80mm
              </button>
              <button
                onClick={() => setPreviewMode('labels')}
                className="flex-1 px-4 py-2.5 rounded-lg border font-medium text-sm transition-colors flex items-center justify-center gap-2 border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                <Tags className="w-4 h-4" /> {lang === 'fr' ? 'Étiquettes' : 'Labels'}
              </button>
            </div>
            {selectedClient?.telephone && (() => {
              const totalPaye = success.modeReglement === 'PAYER_DEPOT' || success.modeReglement === 'SOLDE'
                ? success.total
                : success.avanceAmount ?? 0;
              const reste = Math.max(0, success.total - totalPaye);
              const receiptHeader = resolveReceiptHeader(entreprise, currentBoutique);
              const waMessage = buildWhatsAppMessage({
                entrepriseNom: receiptHeader.nom,
                entrepriseTelephone: receiptHeader.telephone,
                entrepriseAdresse: receiptHeader.adresse,
                entrepriseVille: receiptHeader.ville,
                entrepriseEmail: receiptHeader.email,
                entrepriseSlogan: receiptHeader.slogan,
                entrepriseId: entreprise?.id,
                numero: success.numero,
                clientNom: selectedClient?.nom ?? '—',
                portalCode: selectedClient?.portal_code ?? null,
                dateDepot: success.dateDepot,
                dateRetraitPrevue: success.dateRetraitPrevue,
                traitement: success.traitement,
                coefficient: success.coefficient,
                total: success.total,
                totalAvantRemise: success.totalAvantRemise,
                tauxRemise: success.tauxRemise,
                montantRemise: success.montantRemise,
                modeReglementRemise: success.modeReglementRemise,
                modeReglementTauxRemise: success.modeReglementTauxRemise,
                articles: success.articles,
                reste,
                notes: success.notes,
              });
              const waUrl = buildWhatsAppUrl(selectedClient.telephone, waMessage);
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
              onClick={resetForm}
              className="flex-1 px-4 py-2.5 rounded-lg bg-sky-500 text-white font-medium text-sm hover:bg-sky-600 transition-colors"
            >
              {t('depot.newDepot')}
            </button>
          </div>
          <button onClick={onDone} className="mt-3 text-sm text-slate-400 hover:text-slate-600">
            {t('depot.backToDashboard')}
          </button>
        </div>

        <PrintableReceipt data={receiptData} format={printFormat} modesReglement={modesReglement} entreprise={entreprise} boutique={currentBoutique} />
      </div>
    );
  }

  // ─── Form ────────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Stepper */}
      <div className="flex items-center justify-center gap-2">
        {(['client', 'articles', 'paiement'] as const).map((s, i) => {
          const labels = [t('depot.stepClient'), t('depot.stepArticles'), t('depot.stepPaiement')];
          const isActive = step === s;
          const isPast =
            (step === 'articles' && s === 'client') ||
            (step === 'paiement' && (s === 'client' || s === 'articles'));
          return (
            <div key={s} className="flex items-center">
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-sky-500 text-white'
                    : isPast
                      ? 'bg-sky-50 text-sky-600'
                      : 'bg-slate-100 text-slate-400'
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                    isActive ? 'bg-white/20' : isPast ? 'bg-sky-100' : 'bg-slate-200'
                  }`}
                >
                  {isPast ? <Check className="w-3 h-3" /> : i + 1}
                </span>
                {labels[i]}
              </div>
              {i < 2 && <div className="w-6 h-px bg-slate-200 mx-1" />}
            </div>
          );
        })}
      </div>

      {/* Point de facturation & Compteur de départ du dépôt (côte à côte) */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm px-4 py-3 space-y-2.5">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:divide-x lg:divide-slate-100">
          {/* Point de facturation */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <Monitor className="w-3.5 h-3.5 text-sky-600 shrink-0" />
              <span>
                {lang === 'fr' ? 'Point de facturation :' : 'Billing point:'}{' '}
                <strong className="text-slate-900">
                  {billingPointCode || (lang === 'fr' ? 'Aucun' : 'None')}
                </strong>
              </span>
              <span
                className="px-2 py-0.5 rounded bg-sky-50 text-sky-700 font-mono font-semibold"
                title={lang === 'fr' ? 'Prochain numéro de dépôt qui sera attribué' : 'Next deposit number to be assigned'}
              >
                {lang === 'fr' ? 'Prochain :' : 'Next:'}{' '}
                {nextDepotPreview || formatDepotNumero(depotStartSeq ?? 1, effectiveYear, billingPointCode)}
              </span>
              <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-mono font-semibold">
                {formatClientCode(1, billingPointCode)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowBillingPointPicker((v) => !v)}
              className="text-xs font-medium text-sky-600 hover:text-sky-700 whitespace-nowrap"
            >
              {showBillingPointPicker
                ? lang === 'fr'
                  ? 'Fermer'
                  : 'Close'
                : lang === 'fr'
                  ? 'Modifier'
                  : 'Edit'}
            </button>
          </div>

          {/* Compteur départ du dépôt (directement à côté du point de facturation) */}
          <div className="flex flex-wrap items-center justify-between gap-2 lg:pl-3 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-100">
            <div className="flex items-center gap-1.5 text-xs text-slate-700 font-medium">
              <Hash className="w-3.5 h-3.5 text-sky-600 shrink-0" />
              <span>
                {lang === 'fr' ? 'Compteur départ dépôt' : 'Starting counter'}
                {currentBoutique ? (
                  <span className="text-slate-400 font-normal"> ({currentBoutique.nom})</span>
                ) : null}
                {' :'}
              </span>
            </div>

            {canManageCounter ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={startSeqInput}
                  onChange={(e) => setStartSeqInput(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    const parsed = parseInt(startSeqInput, 10);
                    if (!Number.isFinite(parsed) || parsed < 1) return;
                    const { saved } = await db.saveEnforcedDepotStartNumber(parsed, dateDepotEffective);
                    setDepotStartSeqState(saved);
                    refreshNextPreview();
                    void reloadBoutiques();
                    setStartSeqSavedMsg(true);
                    setTimeout(() => setStartSeqSavedMsg(false), 2000);
                  }}
                  placeholder={lang === 'fr' ? 'Auto (001)' : 'Auto (001)'}
                  title={
                    lang === 'fr'
                      ? `Numéro de départ des dépôts pour ${currentBoutique?.nom ?? 'cette boutique'} (${effectiveYear})`
                      : `Starting deposit number for ${currentBoutique?.nom ?? 'this boutique'} (${effectiveYear})`
                  }
                  className="w-24 px-2 py-1 rounded-md border border-slate-200 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const parsed = parseInt(startSeqInput, 10);
                    if (!Number.isFinite(parsed) || parsed < 1) return;
                    const { saved } = await db.saveEnforcedDepotStartNumber(parsed, dateDepotEffective);
                    setDepotStartSeqState(saved);
                    refreshNextPreview();
                    void reloadBoutiques();
                    setStartSeqSavedMsg(true);
                    setTimeout(() => setStartSeqSavedMsg(false), 2000);
                  }}
                  className="px-2.5 py-1 rounded-md bg-sky-500 text-white text-xs font-medium hover:bg-sky-600 transition-colors"
                >
                  {lang === 'fr' ? 'Imposer' : 'Enforce'}
                </button>
                {depotStartSeq !== null && (
                  <button
                    type="button"
                    onClick={async () => {
                      await db.saveEnforcedDepotStartNumber(null, dateDepotEffective);
                      setDepotStartSeqState(null);
                      setStartSeqInput('');
                      refreshNextPreview();
                      void reloadBoutiques();
                    }}
                    className="px-2 py-1 rounded-md border border-slate-200 text-slate-600 text-xs hover:bg-slate-50 transition-colors"
                    title={lang === 'fr' ? 'Revenir à la numérotation automatique' : 'Reset to automatic numbering'}
                  >
                    {lang === 'fr' ? 'Auto' : 'Auto'}
                  </button>
                )}
                {startSeqSavedMsg && (
                  <span className="text-xs font-medium text-emerald-600 flex items-center gap-0.5">
                    <Check className="w-3.5 h-3.5" />
                    {lang === 'fr' ? 'OK' : 'OK'}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="font-mono font-semibold text-slate-700">
                  {depotStartSeq !== null
                    ? formatDepotNumero(depotStartSeq, effectiveYear, billingPointCode)
                    : lang === 'fr'
                      ? 'Auto (001)'
                      : 'Auto (001)'}
                </span>
              </div>
            )}
          </div>
        </div>

        {showBillingPointPicker && (
          <div className="pt-2.5 border-t border-slate-100 space-y-1.5">
            <p className="text-xs font-medium text-slate-700">
              {lang === 'fr'
                ? 'Préfixe du point de facturation (anti-doublon hors-ligne)'
                : 'Billing point prefix (offline anti-duplicate)'}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {(['', 'C1', 'C2', 'C3', 'P1', 'P2'] as const).map((preset) => {
                const active = billingPointCode === preset;
                return (
                  <button
                    key={preset || 'MAIN'}
                    type="button"
                    onClick={() => {
                      const saved = setBillingPointCode(preset);
                      setBillingPointCodeState(saved);
                    }}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                      active
                        ? 'bg-sky-500 text-white border-sky-500'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-sky-300'
                    }`}
                  >
                    {preset || (lang === 'fr' ? 'Sans préfixe (D-001)' : 'No prefix (D-001)')}
                  </button>
                );
              })}
              <input
                type="text"
                value={billingPointCode}
                onChange={(e) => {
                  const saved = setBillingPointCode(normalizeBillingPointCode(e.target.value));
                  setBillingPointCodeState(saved);
                }}
                maxLength={8}
                placeholder={lang === 'fr' ? 'Votre préfixe…' : 'Your prefix…'}
                className="w-32 px-2.5 py-1 rounded-md border border-slate-200 text-xs font-mono uppercase focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 flex items-start gap-2">
          <X className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Step 1: Client */}
      {step === 'client' && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{t('depot.selectClient')}</h2>
            <p className="text-sm text-slate-500 mt-1">
              {t('depot.searchClient')}
            </p>
          </div>

          {!showNewClient ? (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={t('depot.clientPlaceholder')}
                  autoFocus
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                />
              </div>

              {clientSearchLoading && (
                <p className="text-sm text-slate-400 text-center">{t('depot.searching')}</p>
              )}

              {!clientSearchLoading && searchTerm && clients.length === 0 && (
                <div className="text-center py-4">
                  <p className="text-sm text-slate-400 mb-3">
                    {t('depot.noClientFound', { term: searchTerm })}
                  </p>
                  <button
                    onClick={() => {
                      setShowNewClient(true);
                      setNewClientNom(searchTerm);
                    }}
                    className="inline-flex items-center gap-2 text-sm font-medium text-sky-600 hover:text-sky-700"
                  >
                    <UserPlus className="w-4 h-4" /> {t('depot.createThisClient')}
                  </button>
                </div>
              )}

              {clients.length > 0 && (
                <div className="space-y-2">
                  {clients.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setSelectedClient(c);
                        setStep('articles');
                      }}
                      className="w-full flex items-center justify-between p-3 rounded-lg border border-slate-100 hover:border-sky-200 hover:bg-sky-50 transition-all text-left group"
                    >
                      <div className="flex items-center gap-3">
                        {c.code && (
                          <span className="text-xs font-bold text-sky-600 bg-sky-50 px-2 py-1 rounded">
                            {c.code}
                          </span>
                        )}
                        <div>
                          <p className="text-sm font-medium text-slate-900">{c.nom}</p>
                          {c.telephone && (
                            <p className="text-xs text-slate-400 mt-0.5">{c.telephone}</p>
                          )}
                        </div>
                      </div>
                      <ChevronDown className="w-4 h-4 text-slate-300 -rotate-90 group-hover:text-sky-400 transition-transform" />
                    </button>
                  ))}
                </div>
              )}

              <button
                onClick={() => setShowNewClient(true)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 border-dashed border-slate-200 text-slate-500 text-sm font-medium hover:border-sky-300 hover:text-sky-600 transition-all"
              >
                <UserPlus className="w-4 h-4" /> {t('depot.createNewClient')}
              </button>
            </>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  {t('depot.clientNameRequired')}
                </label>
                <input
                  type="text"
                  value={newClientNom}
                  onChange={(e) => setNewClientNom(e.target.value)}
                  placeholder={t('depot.clientNameEx')}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  {t('depot.phone')}
                </label>
                <input
                  type="tel"
                  value={newClientTel}
                  onChange={(e) => setNewClientTel(e.target.value)}
                  placeholder={t('depot.phoneEx')}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowNewClient(false);
                    setNewClientNom('');
                    setNewClientTel('');
                  }}
                  className="px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
                >
                  {t('depot.cancel')}
                </button>
                <button
                  onClick={handleCreateClient}
                  disabled={!newClientNom.trim()}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t('depot.saveContinue')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Articles */}
      {step === 'articles' && selectedClient && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{t('depot.articles')}</h2>
              <p className="text-sm text-slate-500 mt-1">
                {lang === 'fr' ? 'Client' : 'Client'}: <span className="font-medium text-slate-700">{selectedClient.nom}</span>
              </p>
            </div>
            <button
              onClick={() => setStep('client')}
              className="text-sm text-slate-400 hover:text-slate-600"
            >
              {t('depot.changeClient')}
            </button>
          </div>

          {/* Treatment selector (depot-level) — at top, before articles */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">
              {t('depot.treatmentType')}
            </label>
            <select
              value={typeTraitementId}
              onChange={(e) => handleTypeTraitementChange(e.target.value)}
              disabled={typesTraitement.length === 0}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white disabled:bg-slate-50 disabled:text-slate-400"
            >
              {typesTraitement.length === 0 && <option value="">{t('depot.noTreatmentType')}</option>}
              {typesTraitement.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.libelle} (×{t.coefficient}, {t.nb_jours}j)
                </option>
              ))}
            </select>
          </div>

          {/* Date de dépôt et de retrait — editable */}
          <div className="rounded-xl bg-sky-50 border border-sky-100 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2.5">
                <Calendar className="w-5 h-5 text-slate-500" />
                <div>
                  <p className="text-xs text-slate-500">{lang === 'fr' ? 'Date de dépôt' : 'Deposit date'}</p>
                  <p className="text-sm font-semibold text-slate-700">
                    {formatDate(dateDepotEffective.toISOString())}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={dateDepotOverride}
                  onChange={(e) => setDateDepotOverride(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white"
                />
                {dateDepotOverride && (
                  <button
                    type="button"
                    onClick={() => setDateDepotOverride('')}
                    className="text-xs text-slate-400 hover:text-slate-600"
                  >
                    {t('depot.auto')}
                  </button>
                )}
              </div>
            </div>
            <p className="text-xs text-slate-400">
              {dateDepotOverride ? (lang === 'fr' ? 'Date personnalisée' : 'Custom date') : (lang === 'fr' ? 'Date du jour par défaut' : 'Today by default')}
            </p>

            <div className="flex items-center justify-between gap-3 flex-wrap border-t border-sky-100 pt-3">
              <div className="flex items-center gap-2.5">
                <Calendar className="w-5 h-5 text-sky-500" />
                <div>
                  <p className="text-xs text-slate-500">{t('depot.retraitDate')}</p>
                  <p className="text-sm font-semibold text-sky-700">
                    {formatDate(dateRetraitPrevue.toISOString())}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={dateRetraitOverride}
                  onChange={(e) => setDateRetraitOverride(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-sky-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white"
                />
                {dateRetraitOverride && (
                  <button
                    type="button"
                    onClick={() => setDateRetraitOverride('')}
                    className="text-xs text-slate-400 hover:text-slate-600"
                  >
                    {t('depot.auto')}
                  </button>
                )}
              </div>
            </div>
            <p className="text-xs text-slate-400">
              {dateRetraitOverride ? t('depot.customDate') : t('depot.autoCalc')}
            </p>
          </div>

          {/* Catalog dropdown */}
          <div className="relative">
            <label className="block text-xs font-medium text-slate-500 mb-1.5">
              {t('depot.addFromCatalog')}
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={catalogSearch}
                disabled={catalogArticles.length === 0}
                onChange={(e) => { setCatalogSearch(e.target.value); setCatalogOpen(true); }}
                onFocus={() => setCatalogOpen(true)}
                onBlur={() => setTimeout(() => setCatalogOpen(false), 150)}
                placeholder={catalogArticles.length === 0 ? t('depot.noCatalogItems') : t('depot.selectCatalogItem')}
                className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white disabled:bg-slate-50 disabled:text-slate-400"
              />
            </div>
            {catalogOpen && catalogArticles.length > 0 && (() => {
              const term = catalogSearch.trim().toLowerCase();
              const filtered = (term ? catalogArticles.filter((c) => c.designation.toLowerCase().includes(term)) : catalogArticles).slice(0, 20);
              if (filtered.length === 0) return null;
              return (
                <div className="absolute z-20 left-0 right-0 mt-1 bg-white rounded-lg border border-slate-200 shadow-lg max-h-56 overflow-y-auto">
                  {filtered.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        addArticleFromCatalog(c.id);
                        setCatalogSearch('');
                        setCatalogOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-sky-50 transition-colors border-b border-slate-50 last:border-b-0"
                    >
                      <span className="text-sm font-medium text-slate-800">{c.designation}</span>
                      <span className="text-xs text-slate-400 ml-2">
                        {formatPrice(Number(c.prix_unitaire))} · {c.nb_pieces} pcs
                      </span>
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* Inline new article form */}
          {showNewArticle && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-emerald-800 flex items-center gap-2">
                  <PlusCircle className="w-4 h-4" />
                  {lang === 'fr' ? 'Nouvel article' : 'New article'}
                </h3>
                <button type="button" onClick={() => setShowNewArticle(null)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t('depot.designation')}</label>
                  <input
                    type="text"
                    value={newArtDesignation}
                    onChange={(e) => setNewArtDesignation(e.target.value)}
                    autoFocus
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t('depot.unitPrice')}</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={newArtPrix}
                    onChange={(e) => setNewArtPrix(e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t('depot.nbPieces')}</label>
                  <input
                    type="number"
                    min="1"
                    value={newArtPieces}
                    onChange={(e) => setNewArtPieces(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent bg-white"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewArticle(null)}
                  className="px-3 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-white transition-colors"
                >
                  {t('depot.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => handleCreateArticleInline(showNewArticle)}
                  disabled={creatingArticle || !newArtDesignation.trim() || !(parseFloat(newArtPrix) > 0)}
                  className="px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {creatingArticle ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  {lang === 'fr' ? 'Créer et ajouter' : 'Create & add'}
                </button>
              </div>
            </div>
          )}

          {/* Articles table */}
          <div className="overflow-x-auto -mx-2 sm:mx-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-slate-200">
                  <th className="text-left py-2.5 px-2 font-semibold text-slate-600 text-xs uppercase tracking-wide">
                    {t('depot.designation')}
                  </th>
                  <th className="text-left py-2.5 px-2 font-semibold text-slate-600 text-xs uppercase tracking-wide whitespace-nowrap">
                    {t('depot.variant')}
                  </th>
                  <th className="text-left py-2.5 px-2 font-semibold text-slate-600 text-xs uppercase tracking-wide whitespace-nowrap">
                    {t('depot.color')}
                  </th>
                  <th className="text-left py-2.5 px-2 font-semibold text-slate-600 text-xs uppercase tracking-wide whitespace-nowrap">
                    {t('depot.sign')}
                  </th>
                  <th className="text-left py-2.5 px-2 font-semibold text-slate-600 text-xs uppercase tracking-wide">
                    {t('depot.griffe')}
                  </th>
                  <th className="text-right py-2.5 px-2 font-semibold text-slate-600 text-xs uppercase tracking-wide whitespace-nowrap">
                    {t('depot.unitPrice')}
                  </th>
                  <th className="text-center py-2.5 px-2 font-semibold text-slate-600 text-xs uppercase tracking-wide whitespace-nowrap">
                    {t('depot.qty')}
                  </th>
                  <th className="text-center py-2.5 px-2 font-semibold text-slate-600 text-xs uppercase tracking-wide whitespace-nowrap">
                    {t('depot.nbPieces')}
                  </th>
                  <th className="text-right py-2.5 px-2 font-semibold text-slate-600 text-xs uppercase tracking-wide whitespace-nowrap">
                    {t('depot.amount')}
                  </th>
                  <th className="py-2.5 px-2 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {articles.map((article) => (
                  <tr key={article.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="py-2 px-2 relative">
                      <input
                        type="text"
                        value={article.designation}
                        onChange={(e) => {
                          updateArticle(article.id, 'designation', e.target.value);
                          setArticleSearch((prev) => ({ ...prev, [article.id]: e.target.value }));
                          setActiveSearchId(article.id);
                          if (article.article_id) updateArticle(article.id, 'article_id', '');
                        }}
                        onFocus={() => {
                          setArticleSearch((prev) => ({ ...prev, [article.id]: article.designation }));
                          setActiveSearchId(article.id);
                        }}
                        onBlur={() => setTimeout(() => setActiveSearchId(null), 150)}
                        placeholder={lang === 'fr' ? 'Désignation…' : 'Description…'}
                        className="w-full px-2 py-1.5 rounded-md border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white"
                      />
                      {activeSearchId === article.id && (() => {
                        const term = (articleSearch[article.id] ?? '').trim();
                        const filtered = getFilteredArticles(article.id);
                        const exactMatch = term && catalogArticles.some((c) => c.designation.toLowerCase() === term.toLowerCase());
                        if (!term) return null;
                        return (
                          <div className="absolute z-20 left-2 right-2 mt-1 bg-white rounded-lg border border-slate-200 shadow-lg max-h-48 overflow-y-auto">
                            {filtered.map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  selectCatalogArticle(article.id, c.id);
                                }}
                                className="w-full text-left px-3 py-2 hover:bg-sky-50 transition-colors border-b border-slate-50 last:border-b-0"
                              >
                                <span className="text-sm font-medium text-slate-800">{c.designation}</span>
                                <span className="text-xs text-slate-400 ml-2">
                                  {formatPrice(Number(c.prix_unitaire))} · {c.nb_pieces} pcs
                                </span>
                              </button>
                            ))}
                            {!exactMatch && (
                              <button
                                type="button"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  setShowNewArticle(article.id);
                                  setNewArtDesignation(term);
                                  setNewArtPrix('');
                                  setNewArtPieces('1');
                                  setActiveSearchId(null);
                                }}
                                className="w-full text-left px-3 py-2.5 hover:bg-emerald-50 transition-colors flex items-center gap-2 text-emerald-700 border-t border-slate-100"
                              >
                                <PlusCircle className="w-4 h-4" />
                                <span className="text-sm font-medium">{lang === 'fr' ? 'Créer' : 'Create'} "{term}"</span>
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="py-2 px-2">
                      {article.article_id && allVariants.filter((v) => v.article_id === article.article_id).length > 0 ? (
                        <select
                          value={article.variant_id ?? ''}
                          onChange={(e) => updateArticle(article.id, 'variant_id', e.target.value)}
                          className="w-full min-w-[120px] px-2 py-1.5 rounded-md border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white"
                        >
                          {allVariants
                            .filter((v) => v.article_id === article.article_id)
                            .map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.designation} ({formatPrice(Number(v.prix_traitement))})
                              </option>
                            ))}
                        </select>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="text"
                        list="dl-couleur"
                        value={article.couleur}
                        onChange={(e) => updateArticle(article.id, 'couleur', e.target.value)}
                        placeholder="—"
                        className="w-full min-w-[80px] px-2 py-1.5 rounded-md border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="text"
                        list="dl-signe"
                        value={article.signe_particulier}
                        onChange={(e) => updateArticle(article.id, 'signe_particulier', e.target.value)}
                        placeholder="—"
                        className="w-full min-w-[80px] px-2 py-1.5 rounded-md border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="text"
                        list="dl-griffe"
                        value={article.griffe}
                        onChange={(e) => updateArticle(article.id, 'griffe', e.target.value)}
                        placeholder="—"
                        className="w-full min-w-[70px] px-2 py-1.5 rounded-md border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={article.prix_unitaire}
                        onChange={(e) => {
                          updateArticle(article.id, 'prix_unitaire', e.target.value);
                        }}
                        placeholder="0"
                        className="w-24 px-2 py-1.5 rounded-md border border-slate-200 text-sm text-right focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="number"
                        min="1"
                        value={article.quantite}
                        onChange={(e) => updateArticle(article.id, 'quantite', e.target.value)}
                        className="w-16 px-2 py-1.5 rounded-md border border-slate-200 text-sm text-center focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white"
                      />
                    </td>
                    <td className="py-2 px-2 text-center font-medium text-slate-700 whitespace-nowrap">
                      {(parseInt(article.quantite) || 0) * (parseInt(article.nb_pieces) || 0)}
                    </td>
                    <td className="py-2 px-2 text-right font-semibold text-slate-700 whitespace-nowrap">
                      {formatPrice(computeArticleTotal(article))}
                    </td>
                    <td className="py-2 px-1 text-center">
                      {articles.length > 1 && (
                        <button
                          onClick={() => removeArticle(article.id)}
                          className="p-1 rounded text-slate-300 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-slate-100 p-4 flex items-center justify-between">
              <span className="text-sm text-slate-500">{t('depot.totalPieces')}</span>
              <span className="text-lg font-bold text-slate-900">{totalPieces}</span>
            </div>
            <div className="rounded-xl bg-slate-900 p-4 flex items-center justify-between">
              <span className="text-sm text-slate-300">{t('depot.totalAmount')}</span>
              <span className="text-lg font-bold text-white">{formatPrice(grandTotal)}</span>
            </div>
          </div>

          {/* Remise info */}
          {remiseApplicable && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Percent className="w-4 h-4 text-emerald-600" />
                <p className="text-sm font-semibold text-emerald-700">
                  {t('depot.discountApplied', { rate: tauxRemise })}
                </p>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">{t('depot.subtotal')}</span>
                <span className="font-medium text-slate-700">{formatPrice(grandTotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">{t('depot.discount', { rate: tauxRemise })}</span>
                <span className="font-medium text-emerald-600">−{formatPrice(montantRemise)}</span>
              </div>
              <div className="flex justify-between text-sm pt-2 border-t border-emerald-200">
                <span className="font-semibold text-slate-700">{t('depot.totalAfterDiscount')}</span>
                <span className="font-bold text-emerald-700">{formatPrice(totalFinal)}</span>
              </div>
            </div>
          )}
          {traitementCoef <= 1 && clientTauxRemise > 0 && !remiseApplicable && (
            <div className="rounded-xl bg-amber-50 border border-amber-100 p-3 flex items-center gap-2">
              <Percent className="w-4 h-4 text-amber-500" />
              <p className="text-xs text-amber-700">
                {t('depot.discountHint', { rate: clientTauxRemise, amount: formatPrice(clientConditionRemise), current: formatPrice(grandTotal) })}
              </p>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => setStep('client')}
              className="px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              {t('depot.back')}
            </button>
            <button
              onClick={() => setStep('paiement')}
              disabled={!canProceedArticles()}
              className="flex-1 px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('depot.continuePayment')}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Paiement */}
      {step === 'paiement' && selectedClient && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{t('depot.summary')}</h2>
            <p className="text-sm text-slate-500 mt-1">
              {t('depot.summaryHint')}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              {t('depot.notes')}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder={t('depot.notesPlaceholder')}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent resize-none"
            />
          </div>

          {/* Coupon code */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1.5">
              <Ticket className="w-4 h-4 text-sky-500" />
              {t('depot.couponCode')}
            </label>
            {appliedCoupon ? (
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200">
                <Ticket className="w-4 h-4 text-emerald-600" />
                <div className="flex-1">
                  <span className="text-sm font-bold text-emerald-700 font-mono tracking-wider">{appliedCoupon.code}</span>
                  <span className="text-sm text-emerald-600 ml-2">
                    −{appliedCoupon.type_remise === 'pourcentage' ? `${appliedCoupon.valeur}%` : formatPrice(appliedCoupon.valeur)}
                  </span>
                </div>
                <button onClick={removeCoupon} className="text-xs text-slate-500 hover:text-red-500 transition-colors">{t('depot.couponRemove')}</button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={couponCode}
                  onChange={(e) => { setCouponCode(e.target.value.toUpperCase()); setCouponError(null); }}
                  placeholder={t('depot.couponPlaceholder')}
                  className="flex-1 px-3 py-2.5 rounded-lg border border-slate-200 text-sm font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                />
                <button
                  onClick={handleApplyCoupon}
                  disabled={couponLoading || !couponCode.trim()}
                  className="px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {couponLoading ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    t('depot.couponApply')
                  )}
                </button>
              </div>
            )}
            {couponError && <p className="text-xs text-red-500 mt-1">{couponError}</p>}
          </div>

          {/* Summary */}
          <div className="rounded-xl bg-slate-50 p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">{t('depot.client')}</span>
              <span className="font-medium text-slate-900">{selectedClient.nom}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">{t('depot.nbArticles')}</span>
              <span className="font-medium text-slate-900">{articles.length}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">{t('depot.treatment')}</span>
              <span className="font-medium text-slate-900">
                {getTraitementLabelById(typeTraitementId, typesTraitement)} (×{getCoefficientById(typeTraitementId, typesTraitement)})
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">{t('depot.totalPieces')}</span>
              <span className="font-medium text-slate-900">{totalPieces}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" /> {t('depot.retraitPrevu')}
              </span>
              <span className="font-medium text-sky-600">
                {formatDate(dateRetraitPrevue.toISOString())}
              </span>
            </div>
            <div className="flex justify-between text-sm pt-2 border-t border-slate-200">
              <span className="text-slate-700 font-medium">{t('depot.total')}</span>
              <span className="font-bold text-slate-900">{formatPrice(grandTotal)}</span>
            </div>
            {remiseApplicable && (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-emerald-600">{t('depot.discount', { rate: tauxRemise })}</span>
                  <span className="font-medium text-emerald-600">−{formatPrice(montantRemise)}</span>
                </div>
              </>
            )}
            {couponDiscount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-sky-600 flex items-center gap-1"><Ticket className="w-3.5 h-3.5" /> {t('depot.couponDiscount')}</span>
                <span className="font-medium text-sky-600">−{formatPrice(couponDiscount)}</span>
              </div>
            )}
            {modeReglementRemise > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-amber-600 flex items-center gap-1.5">
                  <Percent className="w-3.5 h-3.5" />
                  {lang === 'fr'
                    ? `Remise ${modeReglementTauxRemise}% (${modeReglementRemiseLabel || 'mode de règlement'})`
                    : `Discount ${modeReglementTauxRemise}% (${modeReglementRemiseLabel || 'payment method'})`}
                </span>
                <span className="font-medium text-amber-600">−{formatPrice(modeReglementRemise)}</span>
              </div>
            )}
            {(remiseApplicable || couponDiscount > 0 || modeReglementRemise > 0) && (
              <div className="flex justify-between text-sm pt-2 border-t border-slate-200">
                <span className="text-slate-700 font-semibold">{t('depot.totalToPay')}</span>
                <span className="font-bold text-emerald-700">{formatPrice(totalFinal)}</span>
              </div>
            )}
          </div>

          {/* Règlement(s) — multi-mode support just before validation */}
          <div className="border-t border-slate-200 pt-5 space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-semibold text-slate-700">
                {paymentLines.length > 1
                  ? (lang === 'fr' ? 'Modes de règlement' : 'Payment methods')
                  : t('depot.paymentMode')}
              </label>
              <button
                type="button"
                onClick={addPaymentLine}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-600 hover:text-sky-700 px-2.5 py-1.5 rounded-lg hover:bg-sky-50 transition-colors"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                {lang === 'fr' ? 'Ajouter un mode' : 'Add method'}
              </button>
            </div>

            <div className="space-y-2.5">
              {paymentLines.map((line, index) => {
                const lineMode = modesReglement.find((m) => m.designation === line.modeReglement);
                return (
                  <div
                    key={line.id}
                    className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2"
                  >
                    {paymentLines.length > 1 && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          {lang === 'fr' ? `Règlement ${index + 1}` : `Payment ${index + 1}`}
                        </span>
                        <button
                          type="button"
                          onClick={() => removePaymentLine(line.id)}
                          className="text-slate-400 hover:text-red-500 p-1 rounded-md hover:bg-red-50 transition-colors"
                          title={lang === 'fr' ? 'Supprimer ce règlement' : 'Remove payment'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">
                          {t('depot.paymentMode')}
                        </label>
                        <select
                          value={line.modeReglement}
                          onChange={(e) => updatePaymentLine(line.id, 'modeReglement', e.target.value)}
                          className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white"
                        >
                          <option value="">{t('depot.selectPaymentMode')}</option>
                          {modesReglement.map((mode) => (
                            <option key={mode.id} value={mode.designation}>
                              {mode.designation}{mode.taux_remise > 0 ? ` (−${mode.taux_remise}%)` : ''}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">
                          {t('depot.payment')}
                        </label>
                        <div className="flex gap-1.5">
                          <input
                            type="number"
                            min="0"
                            value={line.montant}
                            onChange={(e) => updatePaymentLine(line.id, 'montant', e.target.value)}
                            placeholder="0"
                            className="flex-1 min-w-0 px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white"
                          />
                          <button
                            type="button"
                            onClick={() => fillRemainingForLine(line.id)}
                            className="px-2.5 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-sky-600 hover:bg-sky-50 hover:border-sky-200 transition-colors whitespace-nowrap"
                            title={lang === 'fr' ? 'Remplir le reste à payer' : 'Fill remaining balance'}
                          >
                            {lang === 'fr' ? 'Solde' : 'Full'}
                          </button>
                        </div>
                      </div>
                    </div>

                    {lineMode && lineMode.taux_remise > 0 && (
                      <p className="text-xs text-amber-600 flex items-center gap-1">
                        <Percent className="w-3 h-3" />
                        {lang === 'fr'
                          ? `Remise de ${lineMode.taux_remise}% applicable sur ce mode de règlement.`
                          : `${lineMode.taux_remise}% discount applies to this payment method.`}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {resteAPayer > 0 && totalPayeInput > 0 && (
              <button
                type="button"
                onClick={addPaymentLine}
                className="w-full py-2 px-3 rounded-lg border border-dashed border-sky-300 bg-sky-50/50 text-sky-700 text-xs font-semibold hover:bg-sky-50 transition-colors flex items-center justify-center gap-1.5"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                {lang === 'fr'
                  ? `Compléter le reste (${formatPrice(resteAPayer)}) avec un autre mode`
                  : `Pay remaining (${formatPrice(resteAPayer)}) with another method`}
              </button>
            )}

            {/* Payment totals summary */}
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">
                  {lang === 'fr' ? 'Total encaissé' : 'Total paid'}
                </span>
                <span className={`font-semibold ${totalPayeInput > 0 ? 'text-emerald-600' : 'text-slate-600'}`}>
                  {formatPrice(totalPayeInput)}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">{t('depot.remainingToPay')}</span>
                <span className={`font-semibold ${resteAPayer > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {resteAPayer > 0
                    ? formatPrice(resteAPayer)
                    : (lang === 'fr' ? 'Soldé (0)' : 'Settled (0)')}
                </span>
              </div>
              {tropPercu > 0 && (
                <div className="flex justify-between text-xs pt-1 border-t border-slate-200">
                  <span className="text-amber-700 font-medium">
                    {lang === 'fr' ? 'Trop-perçu / Monnaie à rendre' : 'Overpayment / Change'}
                  </span>
                  <span className="font-bold text-amber-700">{formatPrice(tropPercu)}</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep('articles')}
              className="px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              {t('depot.back')}
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex-1 px-4 py-2.5 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {t('depot.submitting')}
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  {t('depot.validate')}
                </>
              )}
            </button>
          </div>
        </div>
      )}
      <datalist id="dl-couleur">
        {fieldHistory.couleur.map((v) => <option key={v} value={v} />)}
      </datalist>
      <datalist id="dl-signe">
        {fieldHistory.signe_particulier.map((v) => <option key={v} value={v} />)}
      </datalist>
      <datalist id="dl-griffe">
        {fieldHistory.griffe.map((v) => <option key={v} value={v} />)}
      </datalist>
    </div>
  );
}
