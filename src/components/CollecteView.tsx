import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/db';
import { useI18n } from '@/lib/i18n';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { notifyRealtimeMutation } from '@/lib/realtimeSync';
import {
  ArticleCatalog,
  DepotWithArticles,
  ModeReglementRow,
  TypeTraitement,
  buildWhatsAppUrl,
  computeDateRetraitPrevueById,
  formatDate,
  formatPrice,
  getCoefficientById,
  getTraitementLabelById,
  parseTraitementFromNotes,
  stripTraitementTagFromNotes,
} from '@/types';
import { LogisticsTourMap, type LogisticsMapStop } from '@/components/DeliveryMap';
import { buildMultiStopGoogleMapsUrl, isValidCoordinatePair } from '@/lib/googleMaps';
import {
  Truck,
  MapPin,
  CalendarClock,
  Phone,
  Navigation,
  Package,
  Clock,
  Check,
  ShoppingBag,
  Loader2,
  ChevronDown,
  Shirt,
  Map as MapIcon,
  MessageCircle,
  Search,
  X,
  Plus,
  Trash2,
  Wallet,
  Banknote,
  FileText,
  Home,
} from 'lucide-react';

interface CollectArticleDraft {
  id?: string;
  designation: string;
  prix_unitaire: number;
  quantite: number;
  nb_pieces: number;
  couleur: string;
  signe_particulier: string;
  griffe: string;
}

const DAY_LABELS: Record<string, { fr: string; en: string }> = {
  lundi: { fr: 'Lundi', en: 'Monday' },
  mardi: { fr: 'Mardi', en: 'Tuesday' },
  mercredi: { fr: 'Mercredi', en: 'Wednesday' },
  jeudi: { fr: 'Jeudi', en: 'Thursday' },
  vendredi: { fr: 'Vendredi', en: 'Friday' },
  samedi: { fr: 'Samedi', en: 'Saturday' },
  dimanche: { fr: 'Dimanche', en: 'Sunday' },
};

function extractBaseDayKey(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.split('·')[0].trim().toLowerCase();
}

function formatDayAndSlot(raw: string | null | undefined, fr: boolean): string {
  if (!raw) return '';
  const [dayPart, ...slotParts] = raw.split('·').map((s) => s.trim());
  const dayLabel = DAY_LABELS[dayPart.toLowerCase()]?.[fr ? 'fr' : 'en'] ?? dayPart;
  const slot = slotParts.join(' · ');
  return slot ? `${dayLabel} · ${slot}` : dayLabel;
}

export default function CollecteView() {
  const { t, lang } = useI18n();
  const fr = lang === 'fr';
  const [depots, setDepots] = useState<DepotWithArticles[]>([]);
  const [typesTraitement, setTypesTraitement] = useState<TypeTraitement[]>([]);
  const [modesReglement, setModesReglement] = useState<ModeReglementRow[]>([]);
  const [catalogArticles, setCatalogArticles] = useState<ArticleCatalog[]>([]);
  const [loading, setLoading] = useState(true);
  const [collectingId, setCollectingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedDayFilter, setSelectedDayFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [showMap, setShowMap] = useState(false);

  // Reception & verification modal state
  const [modalDepot, setModalDepot] = useState<DepotWithArticles | null>(null);
  const [draftArticles, setDraftArticles] = useState<CollectArticleDraft[]>([]);
  const [draftTypeTraitementId, setDraftTypeTraitementId] = useState<string | null>(null);
  const [draftNotes, setDraftNotes] = useState('');
  const [paymentMode, setPaymentMode] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [modalError, setModalError] = useState<string | null>(null);
  const [catalogPickerId, setCatalogPickerId] = useState('');
  const [collectedReceipt, setCollectedReceipt] = useState<{
    numero: string;
    clientNom: string;
    clientPhone: string | null;
    total: number;
    paid: number;
    piecesCount: number;
    traitementLabel: string;
    whatsappUrl: string | null;
  } | null>(null);

  const loadCollectes = useCallback(async () => {
    const [all, types, modes, catalog] = await Promise.all([
      db.getAllDepotsWithClient(),
      db.getTypesTraitement(),
      db.getModesReglement(),
      db.getArticles(),
    ]);
    setTypesTraitement(types);
    setModesReglement(modes);
    setCatalogArticles(catalog);
    setDepots(all.filter((d) => d.pickup_requested && !d.collected_at && d.statut !== 'RETIRE'));
    setLoading(false);
  }, []);

  useEffect(() => {
    loadCollectes();
  }, [loadCollectes]);

  useRealtimeSync(['depots', 'depot_articles', 'clients', 'types_traitement', 'modes_reglement'], loadCollectes);

  const availableDays = useMemo(() => {
    const set = new Set<string>();
    depots.forEach((d) => {
      const baseDay = extractBaseDayKey(d.pickup_day);
      if (baseDay) set.add(baseDay);
    });
    return Array.from(set);
  }, [depots]);

  const filteredDepots = useMemo(() => {
    return depots.filter((d) => {
      if (selectedDayFilter !== 'ALL' && extractBaseDayKey(d.pickup_day) !== selectedDayFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const name = (d.client?.nom ?? '').toLowerCase();
        const phone = (d.client?.telephone ?? '').toLowerCase();
        const addr = (d.pickup_address ?? '').toLowerCase();
        const num = (d.numero ?? '').toLowerCase();
        if (!name.includes(q) && !phone.includes(q) && !addr.includes(q) && !num.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [depots, selectedDayFilter, searchQuery]);

  const mapStops = useMemo<LogisticsMapStop[]>(() => {
    return filteredDepots
      .filter((d) => isValidCoordinatePair(d.pickup_latitude, d.pickup_longitude))
      .map((d) => {
        const waMsg = fr
          ? `Bonjour ${d.client?.nom ?? ''}, notre collecteur est en route pour récupérer votre linge à domicile (${d.pickup_address || 'votre adresse'}).`
          : `Hello ${d.client?.nom ?? ''}, our collector is on the way to pick up your laundry (${d.pickup_address || 'your address'}).`;
        return {
          id: d.id,
          title: d.client?.nom ?? (fr ? 'Client' : 'Client'),
          subtitle: d.numero ?? (fr ? 'Commande en attente' : 'Pending order'),
          address: d.pickup_address,
          phone: d.client?.telephone ?? null,
          lat: Number(d.pickup_latitude),
          lng: Number(d.pickup_longitude),
          badge: d.pickup_day ? formatDayAndSlot(d.pickup_day, fr) : (fr ? 'Collecte' : 'Pickup'),
          pinBg: '#d97706',
          pinBorder: '#b45309',
          amountLabel: `${formatPrice(Number(d.total))} · ${d.articles?.length ?? 0} art.`,
          whatsappUrl: d.client?.telephone ? buildWhatsAppUrl(d.client.telephone, waMsg) : null,
        };
      });
  }, [filteredDepots, fr]);

  const multiStopRouteUrl = useMemo(() => {
    return buildMultiStopGoogleMapsUrl(
      mapStops.map((s) => ({ lat: s.lat, lng: s.lng })),
    );
  }, [mapStops]);

  function openCollectModal(depot: DepotWithArticles) {
    const parsedFromNotes = !depot.type_traitement_id ? parseTraitementFromNotes(depot.notes) : null;
    const matchedType = !depot.type_traitement_id && parsedFromNotes
      ? typesTraitement.find((tt) => tt.libelle.trim().toLowerCase() === parsedFromNotes.libelle.trim().toLowerCase())
      : null;
    const preAppliedCoef = !depot.type_traitement_id && parsedFromNotes && matchedType && parsedFromNotes.coefficient > 1
      ? parsedFromNotes.coefficient
      : 1;

    setModalDepot(depot);
    setDraftTypeTraitementId(depot.type_traitement_id ?? matchedType?.id ?? null);
    setDraftArticles(
      (depot.articles ?? []).map((a) => ({
        id: a.id,
        designation: a.designation,
        prix_unitaire: preAppliedCoef > 1
          ? Math.round((Number(a.prix_unitaire) || 0) / preAppliedCoef)
          : (Number(a.prix_unitaire) || 0),
        quantite: Math.max(1, Number(a.quantite) || 1),
        nb_pieces: Math.max(1, Number(a.nb_pieces) || 1),
        couleur: a.couleur ?? '',
        signe_particulier: a.signe_particulier ?? '',
        griffe: a.griffe ?? '',
      })),
    );
    setDraftNotes(stripTraitementTagFromNotes(depot.notes));
    setPaymentMode('');
    setPaymentAmount('');
    setModalError(null);
  }

  function closeCollectModal() {
    setModalDepot(null);
    setDraftArticles([]);
    setDraftTypeTraitementId(null);
    setDraftNotes('');
    setPaymentMode('');
    setPaymentAmount('');
    setModalError(null);
  }

  function updateDraftArticle(idx: number, field: keyof CollectArticleDraft, value: string | number) {
    setDraftArticles((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  }

  function addDraftArticle() {
    setDraftArticles((prev) => [
      ...prev,
      { designation: '', prix_unitaire: 0, quantite: 1, nb_pieces: 1, couleur: '', signe_particulier: '', griffe: '' },
    ]);
  }

  function addCatalogArticleToDraft(articleId: string) {
    const cat = catalogArticles.find((a) => a.id === articleId);
    if (!cat) return;
    setDraftArticles((prev) => {
      // Remove placeholder "Lot de linge à inventorier" row automatically once real articles are added
      const cleaned = prev.filter(
        (a) => !(a.prix_unitaire === 0 && a.designation.toLowerCase().includes('inventorier')),
      );
      return [
        ...cleaned,
        {
          designation: cat.designation,
          prix_unitaire: Number(cat.prix_unitaire) || 0,
          quantite: 1,
          nb_pieces: Math.max(1, Number(cat.nb_pieces) || 1),
          couleur: '',
          signe_particulier: '',
          griffe: '',
        },
      ];
    });
    setCatalogPickerId('');
  }

  function removeDraftArticle(idx: number) {
    setDraftArticles((prev) => prev.filter((_, i) => i !== idx));
  }

  function computeModalTotals() {
    if (!modalDepot) return { articlesTotal: 0, fees: 0, grandTotal: 0 };
    const coef = draftTypeTraitementId
      ? getCoefficientById(draftTypeTraitementId, typesTraitement)
      : (Number(modalDepot.coefficient) || 1);
    const articlesTotal = draftArticles.reduce((sum, a) => sum + a.prix_unitaire * coef * Math.max(1, a.quantite), 0);
    const fees = (Number(modalDepot.frais_collecte) || 0) + (Number(modalDepot.frais_livraison) || 0);
    return { articlesTotal, fees, grandTotal: articlesTotal + fees };
  }

  async function handleConfirmCollect() {
    if (!modalDepot) return;
    const validArticles = draftArticles.filter((a) => a.designation.trim());
    if (validArticles.length === 0) {
      setModalError(fr ? 'Conservez au moins un article pour confirmer la collecte.' : 'Keep at least one item to confirm pickup.');
      return;
    }

    setCollectingId(modalDepot.id);
    setModalError(null);
    setError(null);
    try {
      const now = new Date();
      let assignedNumero = modalDepot.numero;

      // Fix critical bug: generate a real deposit ticket number when collecting a COMMANDE
      if (!assignedNumero) {
        const numeroResult = await db.nextDepotNumero(now);
        if (numeroResult.error || !numeroResult.numero) {
          throw new Error(
            numeroResult.error ??
              (fr ? 'Erreur lors de la génération du numéro de dépôt' : 'Error generating deposit number'),
          );
        }
        assignedNumero = numeroResult.numero;
      }

      const selectedTrait = draftTypeTraitementId
        ? typesTraitement.find((tt) => tt.id === draftTypeTraitementId) ?? null
        : null;
      const coef = selectedTrait ? Number(selectedTrait.coefficient) : (Number(modalDepot.coefficient) || 1);
      const { grandTotal } = computeModalTotals();
      const paid = parseFloat(paymentAmount) || 0;

      const updatePayload: Record<string, unknown> = {
        collected_at: now.toISOString(),
        statut: 'EN_COURS',
        numero: assignedNumero,
        total: grandTotal,
        notes: draftNotes.trim() || null,
      };
      if (selectedTrait) {
        updatePayload.type_traitement_id = selectedTrait.id;
        updatePayload.traitement = selectedTrait.libelle;
        updatePayload.coefficient = coef;
        updatePayload.date_retrait_prevue = computeDateRetraitPrevueById(now, selectedTrait.id, typesTraitement).toISOString();
      }
      if (modalDepot.statut === 'COMMANDE') {
        updatePayload.date_depot = now.toISOString();
      }
      if (paymentMode && paid > 0) {
        if (paid >= grandTotal) {
          updatePayload.mode_reglement = 'PAYER_DEPOT';
          updatePayload.avance_amount = grandTotal;
        } else {
          updatePayload.mode_reglement = 'AVANCE';
          updatePayload.avance_amount = paid;
        }
      }

      const updateError = await db.updateDepot(modalDepot.id, updatePayload);
      if (updateError) throw new Error(updateError);

      // Update articles to reflect physical verification on site
      const { error: delError } = await supabase
        .from('depot_articles')
        .delete()
        .eq('depot_id', modalDepot.id);
      if (delError) throw delError;

      const rows = validArticles.map((a) => ({
        depot_id: modalDepot.id,
        designation: a.designation.trim(),
        prix_unitaire: a.prix_unitaire,
        prix_traitement: a.prix_unitaire * coef,
        quantite: Math.max(1, a.quantite),
        nb_pieces: Math.max(1, a.nb_pieces),
        prix_total: a.prix_unitaire * coef * Math.max(1, a.quantite),
        couleur: a.couleur || null,
        signe_particulier: a.signe_particulier || null,
        griffe: a.griffe || null,
      }));
      const { error: insError } = await supabase.from('depot_articles').insert(rows);
      if (insError) throw insError;

      // Record payment trace in depot_avances if paid at pickup
      if (paymentMode && paid > 0) {
        await db.insertAvance(modalDepot.id, Math.min(paid, grandTotal), paymentMode);
      }

      const piecesCount = validArticles.reduce(
        (sum, a) => sum + Math.max(1, a.quantite) * Math.max(1, a.nb_pieces),
        0,
      );
      const traitementLabel = selectedTrait?.libelle
        ?? getTraitementLabelById(modalDepot.type_traitement_id, typesTraitement, modalDepot.traitement, modalDepot.notes);
      const articlesLines = validArticles
        .map((a) => `• ${a.designation.trim()} (×${Math.max(1, a.quantite)}) — ${formatPrice(a.prix_unitaire * coef * Math.max(1, a.quantite))}`)
        .join('\n');
      const paidFinal = paymentMode && paid > 0 ? Math.min(paid, grandTotal) : 0;
      const resteFinal = Math.max(0, grandTotal - paidFinal);
      const receiptMsg = fr
        ? `Bonjour ${modalDepot.client?.nom ?? ''},\nVotre linge a bien été collecté !\n\nTicket : ${assignedNumero}\nTraitement : ${traitementLabel} (×${coef})\nPièces vérifiées : ${piecesCount}\n${articlesLines}\n\nTotal : ${formatPrice(grandTotal)}${paidFinal > 0 ? `\nPayé à la collecte : ${formatPrice(paidFinal)}` : ''}\nReste à régler : ${formatPrice(resteFinal)}\n\nMerci pour votre confiance !`
        : `Hello ${modalDepot.client?.nom ?? ''},\nYour laundry has been collected!\n\nTicket: ${assignedNumero}\nTreatment: ${traitementLabel} (×${coef})\nVerified pieces: ${piecesCount}\n${articlesLines}\n\nTotal: ${formatPrice(grandTotal)}${paidFinal > 0 ? `\nPaid at pickup: ${formatPrice(paidFinal)}` : ''}\nBalance due: ${formatPrice(resteFinal)}\n\nThank you!`;

      setCollectedReceipt({
        numero: assignedNumero,
        clientNom: modalDepot.client?.nom ?? 'Client',
        clientPhone: modalDepot.client?.telephone ?? null,
        total: grandTotal,
        paid: paidFinal,
        piecesCount,
        traitementLabel,
        whatsappUrl: modalDepot.client?.telephone
          ? buildWhatsAppUrl(modalDepot.client.telephone, receiptMsg)
          : null,
      });

      notifyRealtimeMutation('depots');
      setDepots((prev) => prev.filter((d) => d.id !== modalDepot.id));
      closeCollectModal();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : (fr ? 'Erreur lors de la collecte' : 'Error during collection'));
    } finally {
      setCollectingId(null);
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto">
        <p className="text-sm text-slate-400 text-center py-8">{t('common.loading')}</p>
      </div>
    );
  }

  const { articlesTotal, fees, grandTotal } = computeModalTotals();

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="text-center">
        <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-3">
          <Truck className="w-7 h-7 text-amber-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">
          {fr ? 'Linge à collecter' : 'Items to pick up'}
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          {fr
            ? 'Tournée de collecte à domicile, vérification sur place et prise en charge'
            : 'Home pickup route, on-site item verification and intake'}
        </p>
      </div>

      {/* Post-collection confirmation & WhatsApp receipt */}
      {collectedReceipt && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-emerald-900 flex items-center gap-1.5">
              <Check className="w-4 h-4 text-emerald-600" />
              {fr
                ? `Collecte confirmée — Ticket ${collectedReceipt.numero}`
                : `Pickup confirmed — Ticket ${collectedReceipt.numero}`}
            </p>
            <p className="text-xs text-emerald-800">
              {collectedReceipt.clientNom} · {collectedReceipt.piecesCount} {fr ? 'pièce(s)' : 'piece(s)'} · {collectedReceipt.traitementLabel} · <strong>{formatPrice(collectedReceipt.total)}</strong>
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {collectedReceipt.whatsappUrl && (
              <a
                href={collectedReceipt.whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors"
              >
                <MessageCircle className="w-3.5 h-3.5" />
                {fr ? 'Envoyer reçu WhatsApp' : 'Send WhatsApp receipt'}
              </a>
            )}
            <button
              type="button"
              onClick={() => setCollectedReceipt(null)}
              className="p-1.5 rounded-lg text-emerald-700 hover:bg-emerald-100"
              aria-label={fr ? 'Fermer' : 'Close'}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Filters & Map toggle */}
      {depots.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-3.5 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={fr ? 'Rechercher client, téléphone, adresse…' : 'Search client, phone, address…'}
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            {mapStops.length > 0 && (
              <button
                type="button"
                onClick={() => setShowMap((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                  showMap
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                }`}
              >
                <MapIcon className="w-3.5 h-3.5" />
                {showMap
                  ? (fr ? 'Masquer la carte' : 'Hide map')
                  : (fr ? `Carte tournée (${mapStops.length})` : `Route map (${mapStops.length})`)}
              </button>
            )}
            {multiStopRouteUrl && mapStops.length >= 2 && (
              <a
                href={multiStopRouteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 transition-colors"
              >
                <Navigation className="w-3.5 h-3.5" />
                {fr ? `Tournée Maps (${Math.min(mapStops.length, 10)})` : `Maps Route (${Math.min(mapStops.length, 10)})`}
              </a>
            )}
          </div>

          {availableDays.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedDayFilter('ALL')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  selectedDayFilter === 'ALL'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {fr ? 'Tous les jours' : 'All days'} ({depots.length})
              </button>
              {availableDays.map((day) => {
                const count = depots.filter((d) => extractBaseDayKey(d.pickup_day) === day).length;
                return (
                  <button
                    type="button"
                    key={day}
                    onClick={() => setSelectedDayFilter(day)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                      selectedDayFilter === day
                        ? 'bg-amber-500 text-white'
                        : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
                    }`}
                  >
                    {DAY_LABELS[day]?.[fr ? 'fr' : 'en'] ?? day} ({count})
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {showMap && mapStops.length > 0 && (
        <LogisticsTourMap
          mapId="collecte-tour-map"
          title={fr ? 'Carte de tournée — Collectes à domicile' : 'Tour Map — Home Pickups'}
          stops={mapStops}
          lang={lang}
        />
      )}

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {filteredDepots.length === 0 ? (
        <div className="text-center py-12">
          <Truck className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-400">
            {fr ? 'Aucune collecte en attente' : 'No pickups pending'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredDepots.map((depot) => {
            const isCommande = depot.statut === 'COMMANDE';
            const isEnCours = depot.statut === 'EN_COURS';
            const waMsg = fr
              ? `Bonjour ${depot.client?.nom ?? ''}, notre collecteur passe récupérer votre linge à domicile (${depot.pickup_address || 'votre adresse'}). Merci de le préparer !`
              : `Hello ${depot.client?.nom ?? ''}, our collector is on the way to pick up your laundry (${depot.pickup_address || 'your address'}).`;
            const waUrl = depot.client?.telephone ? buildWhatsAppUrl(depot.client.telephone, waMsg) : null;

            return (
              <div
                key={depot.id}
                className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow"
              >
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      isCommande ? 'bg-sky-50 text-sky-500' : isEnCours ? 'bg-amber-50 text-amber-500' : 'bg-emerald-50 text-emerald-500'
                    }`}>
                      {isCommande ? <ShoppingBag className="w-5 h-5" /> : isEnCours ? <Clock className="w-5 h-5" /> : <Check className="w-5 h-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-slate-900">
                          {depot.numero ?? (fr ? 'Commande en attente' : 'Pending order')}
                        </p>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          isCommande ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                          {isCommande ? (fr ? 'À collecter' : 'To pick up') : (fr ? 'En cours' : 'In progress')}
                        </span>
                        {depot.delivery_requested && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">
                            <Home className="w-3 h-3" />
                            {fr ? '+ Livraison retour' : '+ Return delivery'}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-medium text-slate-800 mt-1">{depot.client?.nom ?? '—'}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {formatDate(depot.date_depot)}
                        {' · '}
                        {getTraitementLabelById(depot.type_traitement_id, typesTraitement, depot.traitement, depot.notes)} (×{
                          depot.type_traitement_id
                            ? Number(depot.coefficient)
                            : (parseTraitementFromNotes(depot.notes)?.coefficient ?? Number(depot.coefficient))
                        })
                      </p>
                      <div className="flex flex-wrap items-center gap-3 mt-1">
                        {depot.client?.telephone && (
                          <a
                            href={`tel:${depot.client.telephone}`}
                            className="text-xs text-sky-600 inline-flex items-center gap-1 hover:text-sky-700 font-medium"
                          >
                            <Phone className="w-3 h-3" /> {depot.client.telephone}
                          </a>
                        )}
                        {waUrl && (
                          <a
                            href={waUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-emerald-600 inline-flex items-center gap-1 hover:text-emerald-700 font-medium"
                          >
                            <MessageCircle className="w-3 h-3" />
                            {fr ? 'Prévenir sur WhatsApp' : 'Notify on WhatsApp'}
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-slate-800">{formatPrice(Number(depot.total))}</p>
                      <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-0.5 justify-end">
                        <Package className="w-3 h-3" />
                        {depot.articles?.length ?? 0} {fr ? 'art.' : 'items'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="px-4 pb-3 -mt-1 space-y-2">
                  {depot.pickup_day && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-100">
                      <CalendarClock className="w-4 h-4 text-amber-600 flex-shrink-0" />
                      <span className="text-sm font-medium text-amber-800">
                        {formatDayAndSlot(depot.pickup_day, fr)}
                      </span>
                    </div>
                  )}
                  {depot.pickup_address && (
                    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-sky-50 border border-sky-100">
                      <MapPin className="w-4 h-4 text-sky-600 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-sky-800">{depot.pickup_address}</p>
                    </div>
                  )}
                  {stripTraitementTagFromNotes(depot.notes) && (
                    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100">
                      <FileText className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-slate-600 italic">{stripTraitementTagFromNotes(depot.notes)}</p>
                    </div>
                  )}
                  {depot.pickup_latitude !== null && depot.pickup_longitude !== null && (
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${depot.pickup_latitude},${depot.pickup_longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-100 hover:bg-emerald-100 transition-colors"
                    >
                      <Navigation className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                      <span className="text-sm text-emerald-700 font-medium">
                        {fr ? 'Ouvrir l’itinéraire Google Maps' : 'Open Google Maps directions'}
                      </span>
                      <span className="text-xs text-emerald-500 ml-auto font-mono">
                        {depot.pickup_latitude.toFixed(4)}, {depot.pickup_longitude.toFixed(4)}
                      </span>
                    </a>
                  )}
                </div>

                <div className="px-4 pb-4 pt-1 space-y-2">
                  <button
                    type="button"
                    onClick={() => setExpandedId(expandedId === depot.id ? null : depot.id)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm font-medium hover:bg-slate-200 transition-colors"
                  >
                    <Shirt className="w-4 h-4" />
                    {fr ? 'Détails des articles' : 'Item details'}
                    <ChevronDown className={`w-4 h-4 transition-transform ${expandedId === depot.id ? 'rotate-180' : ''}`} />
                  </button>
                  {expandedId === depot.id && depot.articles && depot.articles.length > 0 && (
                    <div className="rounded-lg border border-slate-100 divide-y divide-slate-50">
                      {depot.articles.map((art) => (
                        <div key={art.id} className="px-3 py-2 flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-800 truncate">{art.designation}</p>
                            <p className="text-xs text-slate-400">
                              {art.quantite} × {art.nb_pieces} pcs
                              {art.couleur && art.couleur !== 'AUCUN' && ` · ${art.couleur}`}
                              {art.signe_particulier && art.signe_particulier !== 'AUCUN' && ` · ${art.signe_particulier}`}
                              {art.griffe && art.griffe !== 'AUCUN' && ` · ${art.griffe}`}
                            </p>
                          </div>
                          <p className="text-sm font-semibold text-slate-700 flex-shrink-0">{formatPrice(Number(art.prix_total))}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => openCollectModal(depot)}
                    disabled={collectingId === depot.id}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Check className="w-4 h-4" />
                    {fr ? 'Vérifier & confirmer la collecte' : 'Verify & confirm pickup'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* On-site verification & ticket creation modal */}
      {modalDepot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6 overflow-y-auto">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={closeCollectModal} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg my-auto max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex items-center justify-between rounded-t-2xl z-10">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  {fr ? 'Réception & vérification à la collecte' : 'Pickup intake & verification'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {modalDepot.client?.nom} · {getTraitementLabelById(draftTypeTraitementId ?? modalDepot.type_traitement_id, typesTraitement, modalDepot.traitement, modalDepot.notes)} (×{
                    draftTypeTraitementId
                      ? getCoefficientById(draftTypeTraitementId, typesTraitement)
                      : (parseTraitementFromNotes(modalDepot.notes)?.coefficient ?? Number(modalDepot.coefficient))
                  })
                </p>
              </div>
              <button type="button" onClick={closeCollectModal} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {!modalDepot.numero && (
                <div className="rounded-lg bg-sky-50 border border-sky-100 px-3 py-2 text-xs text-sky-800">
                  {fr
                    ? 'Un numéro de ticket dépôt sera automatiquement généré et la commande passera en traitement.'
                    : 'A deposit ticket number will be automatically generated and the order will enter processing.'}
                </div>
              )}

              {typesTraitement.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">
                    {fr ? 'Type de traitement' : 'Treatment type'}
                  </label>
                  <select
                    value={draftTypeTraitementId ?? ''}
                    onChange={(e) => setDraftTypeTraitementId(e.target.value || null)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <option value="">{fr ? 'Conserver le traitement actuel' : 'Keep current treatment'}</option>
                    {typesTraitement.map((tt) => (
                      <option key={tt.id} value={tt.id}>
                        {tt.libelle} (×{tt.coefficient} · {tt.nb_jours}{fr ? 'j' : 'd'})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Verified items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                    {fr ? 'Articles comptés chez le client' : 'Items counted on site'}
                  </label>
                  <button
                    type="button"
                    onClick={addDraftArticle}
                    className="inline-flex items-center gap-1 text-xs font-medium text-sky-600 hover:text-sky-700"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {fr ? 'Ligne libre' : 'Custom row'}
                  </button>
                </div>
                {catalogArticles.length > 0 && (
                  <div className="mb-2.5 flex items-center gap-2">
                    <select
                      value={catalogPickerId}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCatalogPickerId(val);
                        if (val) addCatalogArticleToDraft(val);
                      }}
                      className="flex-1 px-2.5 py-2 rounded-lg border border-sky-200 bg-sky-50/40 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    >
                      <option value="">
                        {fr ? '+ Ajouter rapidement depuis le catalogue…' : '+ Quick-add from catalog…'}
                      </option>
                      {catalogArticles.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.designation} — {formatPrice(Number(cat.prix_unitaire))}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="space-y-2">
                  {draftArticles.map((art, idx) => {
                    const liveCoef = draftTypeTraitementId
                      ? getCoefficientById(draftTypeTraitementId, typesTraitement)
                      : (Number(modalDepot.coefficient) || 1);
                    return (
                    <div key={idx} className="p-3 rounded-lg border border-slate-200/80 space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={art.designation}
                          onChange={(e) => updateDraftArticle(idx, 'designation', e.target.value)}
                          placeholder={fr ? 'Désignation' : 'Item name'}
                          className="flex-1 px-2.5 py-1.5 rounded border border-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500"
                        />
                        <button
                          type="button"
                          onClick={() => removeDraftArticle(idx)}
                          className="p-1.5 rounded text-slate-400 hover:text-red-500 hover:bg-red-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-1">
                          <label className="text-xs text-slate-400">{fr ? 'Qté' : 'Qty'}</label>
                          <input
                            type="number"
                            min={1}
                            value={art.quantite}
                            onChange={(e) => updateDraftArticle(idx, 'quantite', Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-14 px-2 py-1 rounded border border-slate-200 text-sm text-center"
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <label className="text-xs text-slate-400">{fr ? 'Pièces' : 'Pcs'}</label>
                          <input
                            type="number"
                            min={1}
                            value={art.nb_pieces}
                            onChange={(e) => updateDraftArticle(idx, 'nb_pieces', Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-14 px-2 py-1 rounded border border-slate-200 text-sm text-center"
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <label className="text-xs text-slate-400">{fr ? 'P.U.' : 'Unit'}</label>
                          <input
                            type="number"
                            min={0}
                            step="100"
                            value={art.prix_unitaire}
                            onChange={(e) => updateDraftArticle(idx, 'prix_unitaire', Math.max(0, parseFloat(e.target.value) || 0))}
                            className="w-24 px-2 py-1 rounded border border-slate-200 text-sm text-center"
                          />
                        </div>
                        <span className="ml-auto text-xs font-semibold text-slate-700">
                          {formatPrice(art.prix_unitaire * liveCoef * art.quantite)}
                        </span>
                      </div>
                    </div>
                  );
                  })}
                </div>
              </div>

              {/* Collector notes */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {fr ? 'Observations à la collecte (tâches, état, remarques)' : 'Pickup notes (stains, condition, remarks)'}
                </label>
                <textarea
                  value={draftNotes}
                  onChange={(e) => setDraftNotes(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none"
                />
              </div>

              {/* Optional payment at pickup */}
              <div className="rounded-xl border border-slate-200/80 p-3.5 space-y-3 bg-slate-50/50">
                <p className="text-xs font-semibold text-slate-700">
                  {fr ? 'Encaissement à la collecte (optionnel)' : 'Payment at pickup (optional)'}
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {modesReglement.map((mode) => {
                    const selected = paymentMode === mode.designation;
                    const isCash = mode.designation.toUpperCase().includes('ESP');
                    return (
                      <button
                        type="button"
                        key={mode.id}
                        onClick={() => setPaymentMode(selected ? '' : mode.designation)}
                        className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg border text-xs font-medium transition-colors ${
                          selected
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {isCash ? <Banknote className="w-3.5 h-3.5" /> : <Wallet className="w-3.5 h-3.5" />}
                        <span className="truncate">{mode.designation}</span>
                      </button>
                    );
                  })}
                </div>
                {paymentMode && (
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">
                      {fr ? 'Montant versé au collecteur' : 'Amount paid to collector'}
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      placeholder={String(Math.round(grandTotal))}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                )}
              </div>

              {/* Totals summary */}
              <div className="rounded-xl bg-slate-50 border border-slate-100 p-3.5 space-y-1 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>{fr ? 'Sous-total articles' : 'Items subtotal'}</span>
                  <span className="font-medium">{formatPrice(articlesTotal)}</span>
                </div>
                {fees > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>{fr ? 'Frais collecte & livraison' : 'Pickup & delivery fees'}</span>
                    <span className="font-medium">{formatPrice(fees)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold text-slate-900 pt-1.5 border-t border-slate-200">
                  <span>{fr ? 'Total dépôt' : 'Deposit total'}</span>
                  <span className="text-sky-600">{formatPrice(grandTotal)}</span>
                </div>
              </div>

              {modalError && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700">
                  {modalError}
                </div>
              )}
            </div>

            <div className="sticky bottom-0 bg-white border-t border-slate-100 px-5 py-4 flex gap-3 rounded-b-2xl">
              <button
                type="button"
                onClick={closeCollectModal}
                disabled={collectingId === modalDepot.id}
                className="px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50"
              >
                {t('pw.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmCollect()}
                disabled={collectingId === modalDepot.id}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600 disabled:opacity-50"
              >
                {collectingId === modalDepot.id ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {fr ? 'Validation…' : 'Confirming…'}
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    {fr ? 'Confirmer la collecte' : 'Confirm pickup'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
