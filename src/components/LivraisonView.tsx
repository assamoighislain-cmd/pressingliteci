import { useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '@/lib/db';
import { useI18n } from '@/lib/i18n';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { notifyRealtimeMutation } from '@/lib/realtimeSync';
import {
  DepotAvance,
  DepotWithArticles,
  ModeReglementRow,
  TypeTraitement,
  buildWhatsAppUrl,
  formatDate,
  formatPrice,
  getTraitementLabelById,
} from '@/types';
import { LogisticsTourMap, type LogisticsMapStop } from '@/components/DeliveryMap';
import { isValidCoordinatePair } from '@/lib/googleMaps';
import {
  Truck,
  MapPin,
  Phone,
  Navigation,
  Package,
  Check,
  Loader2,
  Home,
  ChevronDown,
  Shirt,
  Clock,
  CheckCircle2,
  Map as MapIcon,
  MessageCircle,
  Wallet,
  Banknote,
  X,
  FileText,
  Sparkles,
} from 'lucide-react';

const DAY_LABELS: Record<string, { fr: string; en: string }> = {
  lundi: { fr: 'Lundi', en: 'Monday' },
  mardi: { fr: 'Mardi', en: 'Tuesday' },
  mercredi: { fr: 'Mercredi', en: 'Wednesday' },
  jeudi: { fr: 'Jeudi', en: 'Thursday' },
  vendredi: { fr: 'Vendredi', en: 'Friday' },
  samedi: { fr: 'Samedi', en: 'Saturday' },
  dimanche: { fr: 'Dimanche', en: 'Sunday' },
};

type DeliveryFilter = 'ALL' | 'READY' | 'PROCESSING' | 'PENDING';

export default function LivraisonView() {
  const { lang } = useI18n();
  const fr = lang === 'fr';
  const [depots, setDepots] = useState<DepotWithArticles[]>([]);
  const [avances, setAvances] = useState<DepotAvance[]>([]);
  const [typesTraitement, setTypesTraitement] = useState<TypeTraitement[]>([]);
  const [modesReglement, setModesReglement] = useState<ModeReglementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deliveringId, setDeliveringId] = useState<string | null>(null);
  const [markingReadyId, setMarkingReadyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<DeliveryFilter>('ALL');
  const [showMap, setShowMap] = useState(false);

  // Delivery checkout & confirmation modal
  const [modalDepot, setModalDepot] = useState<DepotWithArticles | null>(null);
  const [paymentMode, setPaymentMode] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [modalError, setModalError] = useState<string | null>(null);

  const loadLivraisons = useCallback(async () => {
    const [all, types, allAvances, modes] = await Promise.all([
      db.getAllDepotsWithClient(),
      db.getTypesTraitement(),
      db.getAllAvances(),
      db.getModesReglement(),
    ]);
    setTypesTraitement(types);
    setAvances(allAvances);
    setModesReglement(modes);
    setDepots(all.filter((d) => d.delivery_requested && (d.statut === 'EN_COURS' || d.statut === 'COMMANDE')));
    setLoading(false);
  }, []);

  useEffect(() => {
    loadLivraisons();
  }, [loadLivraisons]);

  useRealtimeSync(
    ['depots', 'depot_articles', 'depot_avances', 'clients', 'types_traitement', 'modes_reglement'],
    loadLivraisons,
  );

  const computeBalance = useCallback(
    (depot: DepotWithArticles) => {
      const total = Number(depot.total) || 0;
      const mode = depot.mode_reglement;
      const extraAvances = avances
        .filter((a) => a.depot_id === depot.id)
        .reduce((s, a) => s + Number(a.montant), 0);
      const initialAvance = Number(depot.avance_amount) || 0;

      let paid = 0;
      if (mode === 'PAYER_DEPOT' || mode === 'SOLDE') {
        paid = total;
      } else if (extraAvances > 0) {
        paid = extraAvances;
      } else if (mode === 'AVANCE') {
        paid = initialAvance;
      }
      const remaining = Math.max(0, total - paid);
      return { total, paid, remaining };
    },
    [avances],
  );

  const counts = useMemo(() => {
    const ready = depots.filter((d) => d.statut === 'EN_COURS' && d.ready_for_delivery).length;
    const processing = depots.filter((d) => d.statut === 'EN_COURS' && !d.ready_for_delivery).length;
    const pending = depots.filter((d) => d.statut === 'COMMANDE').length;
    return { all: depots.length, ready, processing, pending };
  }, [depots]);

  const filteredDepots = useMemo(() => {
    return depots.filter((d) => {
      if (filter === 'READY') return d.statut === 'EN_COURS' && Boolean(d.ready_for_delivery);
      if (filter === 'PROCESSING') return d.statut === 'EN_COURS' && !d.ready_for_delivery;
      if (filter === 'PENDING') return d.statut === 'COMMANDE';
      return true;
    });
  }, [depots, filter]);

  const mapStops = useMemo<LogisticsMapStop[]>(() => {
    return filteredDepots
      .filter((d) => isValidCoordinatePair(d.delivery_latitude, d.delivery_longitude))
      .map((d) => {
        const { remaining } = computeBalance(d);
        const isReady = d.statut === 'EN_COURS' && Boolean(d.ready_for_delivery);
        const waMsg = fr
          ? `Bonjour ${d.client?.nom ?? ''}, votre commande ${d.numero ?? ''} est prête et notre livreur est en route.${remaining > 0 ? ` Reste à régler : ${formatPrice(remaining)}.` : ''}`
          : `Hello ${d.client?.nom ?? ''}, your order ${d.numero ?? ''} is ready and our driver is on the way.${remaining > 0 ? ` Remaining balance: ${formatPrice(remaining)}.` : ''}`;
        return {
          id: d.id,
          title: d.client?.nom ?? 'Client',
          subtitle: d.numero ?? (fr ? 'Commande' : 'Order'),
          address: d.delivery_address,
          phone: d.client?.telephone ?? null,
          lat: Number(d.delivery_latitude),
          lng: Number(d.delivery_longitude),
          badge: isReady ? (fr ? 'Prêt' : 'Ready') : (fr ? 'Traitement' : 'Processing'),
          pinBg: isReady ? '#059669' : '#0284c7',
          pinBorder: isReady ? '#047857' : '#0369a1',
          amountLabel:
            remaining > 0
              ? `${fr ? 'Reste :' : 'Due:'} ${formatPrice(remaining)}`
              : fr
                ? 'Déjà soldé'
                : 'Fully paid',
          whatsappUrl: d.client?.telephone ? buildWhatsAppUrl(d.client.telephone, waMsg) : null,
        };
      });
  }, [filteredDepots, computeBalance, fr]);

  async function handleMarkReady(depotId: string) {
    setMarkingReadyId(depotId);
    try {
      const err = await db.updateDepot(depotId, { ready_for_delivery: true });
      if (!err) {
        setDepots((prev) =>
          prev.map((d) => (d.id === depotId ? { ...d, ready_for_delivery: true } : d)),
        );
        notifyRealtimeMutation('depots');
      }
    } finally {
      setMarkingReadyId(null);
    }
  }

  function openDeliverModal(depot: DepotWithArticles) {
    const { remaining } = computeBalance(depot);
    setModalDepot(depot);
    setPaymentMode(remaining > 0 && modesReglement.length > 0 ? modesReglement[0].designation : '');
    setPaymentAmount(remaining > 0 ? String(Math.round(remaining)) : '');
    setModalError(null);
  }

  function closeDeliverModal() {
    setModalDepot(null);
    setPaymentMode('');
    setPaymentAmount('');
    setModalError(null);
  }

  async function handleConfirmDelivered() {
    if (!modalDepot) return;
    setDeliveringId(modalDepot.id);
    setModalError(null);
    try {
      const { total, paid, remaining } = computeBalance(modalDepot);
      const collectedNow = parseFloat(paymentAmount) || 0;

      if (collectedNow > 0 && !paymentMode) {
        setModalError(fr ? 'Sélectionnez un mode de règlement pour le montant encaissé.' : 'Select a payment method for the collected amount.');
        setDeliveringId(null);
        return;
      }

      if (collectedNow > 0 && paymentMode) {
        const avRes = await db.insertAvance(modalDepot.id, collectedNow, paymentMode);
        if (avRes.error) throw new Error(avRes.error);
      }

      const totalPaidAfter = paid + collectedNow;
      const updatePayload: Record<string, unknown> = {
        statut: 'RETIRE',
        date_retrait: new Date().toISOString(),
      };
      if (remaining > 0 && collectedNow > 0) {
        if (totalPaidAfter >= total) {
          updatePayload.mode_reglement = 'SOLDE';
          updatePayload.avance_amount = total;
        } else {
          updatePayload.mode_reglement = 'AVANCE';
          updatePayload.avance_amount = totalPaidAfter;
        }
      }

      const updateError = await db.updateDepot(modalDepot.id, updatePayload);
      if (updateError) throw new Error(updateError);

      notifyRealtimeMutation('depots');
      setDepots((prev) => prev.filter((d) => d.id !== modalDepot.id));
      closeDeliverModal();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : (fr ? 'Erreur lors de la livraison' : 'Error completing delivery'));
    } finally {
      setDeliveringId(null);
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto">
        <p className="text-sm text-slate-400 text-center py-8">{fr ? 'Chargement…' : 'Loading…'}</p>
      </div>
    );
  }

  const modalBalance = modalDepot ? computeBalance(modalDepot) : null;

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="text-center">
        <div className="w-14 h-14 rounded-2xl bg-sky-50 flex items-center justify-center mx-auto mb-3">
          <Home className="w-7 h-7 text-sky-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">
          {fr ? 'Commandes à livrer' : 'Orders to deliver'}
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          {fr
            ? 'Préparation, tournée de livraison à domicile et encaissement du solde'
            : 'Preparation, home delivery route and balance collection'}
        </p>
      </div>

      {/* Filters & Tour map button */}
      {depots.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-3.5 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap gap-1.5">
            {([
              { key: 'ALL', label: fr ? 'Toutes' : 'All', count: counts.all },
              { key: 'READY', label: fr ? 'Prêtes à livrer' : 'Ready', count: counts.ready },
              { key: 'PROCESSING', label: fr ? 'En traitement' : 'Processing', count: counts.processing },
              { key: 'PENDING', label: fr ? 'En attente' : 'Pending', count: counts.pending },
            ] as const).map((tab) => (
              <button
                type="button"
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filter === tab.key
                    ? 'bg-sky-500 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>
          {mapStops.length > 0 && (
            <button
              type="button"
              onClick={() => setShowMap((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                showMap
                  ? 'bg-sky-500 text-white border-sky-500'
                  : 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100'
              }`}
            >
              <MapIcon className="w-3.5 h-3.5" />
              {showMap
                ? (fr ? 'Masquer la carte' : 'Hide map')
                : (fr ? `Carte livraison (${mapStops.length})` : `Delivery map (${mapStops.length})`)}
            </button>
          )}
        </div>
      )}

      {showMap && mapStops.length > 0 && (
        <LogisticsTourMap
          mapId="livraison-tour-map"
          title={fr ? 'Carte de tournée — Livraisons à domicile' : 'Tour Map — Home Deliveries'}
          stops={mapStops}
          lang={lang}
        />
      )}

      {filteredDepots.length === 0 ? (
        <div className="text-center py-12">
          <Home className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-400">
            {fr ? 'Aucune livraison dans cette catégorie' : 'No deliveries in this category'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredDepots.map((depot) => {
            const { total, paid, remaining } = computeBalance(depot);
            const waMsg = fr
              ? `Bonjour ${depot.client?.nom ?? ''}, votre commande ${depot.numero ?? ''} est prête et notre livreur est en route vers ${depot.delivery_address || 'votre adresse'}.${remaining > 0 ? ` Reste à régler à la livraison : ${formatPrice(remaining)}.` : ' Votre commande est déjà soldée.'}`
              : `Hello ${depot.client?.nom ?? ''}, your order ${depot.numero ?? ''} is ready and on the way to ${depot.delivery_address || 'your address'}.${remaining > 0 ? ` Balance due on delivery: ${formatPrice(remaining)}.` : ' Already paid in full.'}`;
            const waUrl = depot.client?.telephone ? buildWhatsAppUrl(depot.client.telephone, waMsg) : null;

            return (
              <div
                key={depot.id}
                className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow"
              >
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-sky-50 text-sky-500">
                      <Truck className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-slate-900">
                          {depot.numero ?? (fr ? 'Commande en attente' : 'Pending order')}
                        </p>
                        {depot.statut === 'COMMANDE' ? (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                            {fr ? 'Commande' : 'Order'}
                          </span>
                        ) : depot.ready_for_delivery ? (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            {fr ? 'Prêt à livrer' : 'Ready'}
                          </span>
                        ) : (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {fr ? 'En traitement' : 'Processing'}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-medium text-slate-800 mt-1">{depot.client?.nom ?? '—'}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {formatDate(depot.date_depot)}
                        {' · '}
                        {getTraitementLabelById(depot.type_traitement_id, typesTraitement, depot.traitement)} (×{Number(depot.coefficient)})
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
                      <p className="text-sm font-bold text-slate-800">{formatPrice(total)}</p>
                      {remaining > 0 ? (
                        <p className="text-xs font-semibold text-red-600 mt-0.5">
                          {fr ? 'Reste :' : 'Due:'} {formatPrice(remaining)}
                        </p>
                      ) : (
                        <p className="text-xs font-semibold text-emerald-600 mt-0.5">
                          {fr ? 'Soldé' : 'Paid'}
                        </p>
                      )}
                      <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-0.5 justify-end">
                        <Package className="w-3 h-3" />
                        {depot.articles?.length ?? 0} {fr ? 'art.' : 'items'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="px-4 pb-3 -mt-1 space-y-2">
                  {depot.delivery_day && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-sky-50 border border-sky-100">
                      <Package className="w-4 h-4 text-sky-600 flex-shrink-0" />
                      <span className="text-sm font-medium text-sky-800">
                        {DAY_LABELS[depot.delivery_day]?.[fr ? 'fr' : 'en'] ?? depot.delivery_day}
                      </span>
                    </div>
                  )}
                  {depot.delivery_address && (
                    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-sky-50 border border-sky-100">
                      <MapPin className="w-4 h-4 text-sky-600 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-sky-800">{depot.delivery_address}</p>
                    </div>
                  )}
                  {depot.notes && (
                    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100">
                      <FileText className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-slate-600 italic">{depot.notes}</p>
                    </div>
                  )}
                  {depot.delivery_latitude !== null && depot.delivery_longitude !== null && (
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${depot.delivery_latitude},${depot.delivery_longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-100 hover:bg-emerald-100 transition-colors"
                    >
                      <Navigation className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                      <span className="text-sm text-emerald-700 font-medium">
                        {fr ? 'Ouvrir l’itinéraire Google Maps' : 'Open Google Maps directions'}
                      </span>
                      <span className="text-xs text-emerald-500 ml-auto font-mono">
                        {depot.delivery_latitude.toFixed(4)}, {depot.delivery_longitude.toFixed(4)}
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
                    {paid > 0 && (
                      <span className="text-xs text-emerald-600">({fr ? 'Payé' : 'Paid'}: {formatPrice(paid)})</span>
                    )}
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

                  {depot.statut === 'EN_COURS' && depot.ready_for_delivery ? (
                    <button
                      type="button"
                      onClick={() => openDeliverModal(depot)}
                      disabled={deliveringId === depot.id}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-semibold hover:bg-sky-600 transition-colors disabled:opacity-50"
                    >
                      <Check className="w-4 h-4" />
                      {remaining > 0
                        ? (fr ? `Livrer & encaisser (${formatPrice(remaining)})` : `Deliver & collect (${formatPrice(remaining)})`)
                        : (fr ? 'Confirmer la livraison' : 'Confirm delivery')}
                    </button>
                  ) : depot.statut === 'COMMANDE' ? (
                    <div className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-100 text-slate-500 text-xs font-medium text-center">
                      {fr
                        ? 'En attente de collecte ou conversion en dépôt'
                        : 'Awaiting pickup or deposit conversion'}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleMarkReady(depot.id)}
                      disabled={markingReadyId === depot.id}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 text-sm font-medium hover:bg-amber-100 transition-colors disabled:opacity-50"
                    >
                      {markingReadyId === depot.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Sparkles className="w-4 h-4" />
                      )}
                      {fr ? 'Marquer prêt pour la livraison' : 'Mark ready for delivery'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delivery confirmation & balance collection modal */}
      {modalDepot && modalBalance && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6 overflow-y-auto">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={closeDeliverModal} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md my-auto">
            <div className="border-b border-slate-100 px-5 py-4 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  {fr ? 'Confirmation de livraison' : 'Delivery confirmation'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {modalDepot.numero} · {modalDepot.client?.nom}
                </p>
              </div>
              <button type="button" onClick={closeDeliverModal} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div className="rounded-xl bg-slate-50 border border-slate-100 p-3.5 space-y-1.5 text-sm">
                <div className="flex justify-between text-slate-600">
                  <span>{fr ? 'Total commande' : 'Order total'}</span>
                  <span className="font-semibold text-slate-900">{formatPrice(modalBalance.total)}</span>
                </div>
                <div className="flex justify-between text-emerald-700">
                  <span>{fr ? 'Déjà réglé' : 'Already paid'}</span>
                  <span className="font-semibold">{formatPrice(modalBalance.paid)}</span>
                </div>
                <div className="flex justify-between text-base font-bold pt-1.5 border-t border-slate-200">
                  <span className="text-slate-800">{fr ? 'Reste à encaisser' : 'Balance due'}</span>
                  <span className={modalBalance.remaining > 0 ? 'text-red-600' : 'text-emerald-600'}>
                    {formatPrice(modalBalance.remaining)}
                  </span>
                </div>
              </div>

              {modalBalance.remaining > 0 && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">
                      {fr ? 'Mode de règlement encaissé à la livraison' : 'Payment method collected on delivery'}
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {modesReglement.map((mode) => {
                        const selected = paymentMode === mode.designation;
                        const isCash = mode.designation.toUpperCase().includes('ESP');
                        return (
                          <button
                            type="button"
                            key={mode.id}
                            onClick={() => setPaymentMode(selected ? '' : mode.designation)}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                              selected
                                ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                                : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                            }`}
                          >
                            {isCash ? <Banknote className="w-3.5 h-3.5" /> : <Wallet className="w-3.5 h-3.5" />}
                            <span className="truncate">{mode.designation}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      {fr ? 'Montant encaissé maintenant (0 si différé)' : 'Amount collected now (0 if deferred)'}
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>
              )}

              {modalError && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700">
                  {modalError}
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 px-5 py-4 flex gap-3">
              <button
                type="button"
                onClick={closeDeliverModal}
                disabled={deliveringId === modalDepot.id}
                className="px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50"
              >
                {fr ? 'Annuler' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDelivered()}
                disabled={deliveringId === modalDepot.id}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-semibold hover:bg-sky-600 disabled:opacity-50"
              >
                {deliveringId === modalDepot.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                {fr ? 'Valider la livraison' : 'Confirm delivery'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
