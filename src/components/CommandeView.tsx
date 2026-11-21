import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/db';
import { useI18n } from '@/lib/i18n';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { notifyRealtimeMutation } from '@/lib/realtimeSync';
import { DepotWithArticles, DepotArticle, ModeReglementRow, formatPrice, formatDate, getTraitementLabelById, TypeTraitement, getCoefficientById, computeDateRetraitPrevueById } from '@/types';
import { ShoppingBag, MapPin, Truck, CalendarClock, Phone, Package, ArrowRightLeft, Loader2, Pencil, X, Plus, Trash2, Save, Wallet, Banknote, Check, Clock, CheckCircle2, Home, TrendingUp } from 'lucide-react';

interface ArticleDraft {
  id?: string;
  designation: string;
  prix_unitaire: number;
  quantite: number;
  nb_pieces: number;
  couleur: string;
  signe_particulier: string;
  griffe: string;
}

export default function CommandeView() {
  const { t, lang } = useI18n();
  const [depots, setDepots] = useState<DepotWithArticles[]>([]);
  const [typesTraitement, setTypesTraitement] = useState<TypeTraitement[]>([]);
  const [loading, setLoading] = useState(true);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [modesReglement, setModesReglement] = useState<ModeReglementRow[]>([]);
  const [paymentDepot, setPaymentDepot] = useState<DepotWithArticles | null>(null);
  const [paymentMode, setPaymentMode] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [editingDepot, setEditingDepot] = useState<DepotWithArticles | null>(null);
  const [editArticles, setEditArticles] = useState<ArticleDraft[]>([]);
  const [editNotes, setEditNotes] = useState('');
  const [editPickupRequested, setEditPickupRequested] = useState(false);
  const [editPickupAddress, setEditPickupAddress] = useState('');
  const [editPickupDay, setEditPickupDay] = useState('');
  const [editDeliveryRequested, setEditDeliveryRequested] = useState(false);
  const [editDeliveryAddress, setEditDeliveryAddress] = useState('');
  const [editDeliveryDay, setEditDeliveryDay] = useState('');
  const [editTypeTraitementId, setEditTypeTraitementId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [allDepots, setAllDepots] = useState<DepotWithArticles[]>([]);

  const loadDepots = useCallback(async () => {
    const [all, types, modes] = await Promise.all([
      db.getAllDepotsWithClient(),
      db.getTypesTraitement(),
      db.getModesReglement(),
    ]);
    setTypesTraitement(types);
    setModesReglement(modes);
    setDepots(all.filter((d) => d.statut === 'COMMANDE'));
    setAllDepots(all);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDepots();
  }, [loadDepots]);

  useRealtimeSync(['depots', 'depot_articles', 'clients', 'types_traitement', 'modes_reglement'], loadDepots);

  function openPaymentModal(depot: DepotWithArticles) {
    setPaymentDepot(depot);
    setPaymentMode('');
    setPaymentAmount('');
    setConvertError(null);
  }

  function closePaymentModal() {
    setPaymentDepot(null);
    setPaymentMode('');
    setPaymentAmount('');
    setConvertError(null);
  }

  async function handleConvert() {
    if (!paymentDepot) return;
    setConvertingId(paymentDepot.id);
    try {
      const now = new Date();
      const numeroResult = await db.nextDepotNumero(now);
      if (numeroResult.error || !numeroResult.numero) {
        throw new Error(
          numeroResult.error ??
            (lang === 'fr' ? 'Erreur lors de la génération du numéro' : 'Error generating deposit number'),
        );
      }

      const avance = parseFloat(paymentAmount) || 0;
      const modeValue = paymentMode || null;
      const depotTotal = Number(paymentDepot.total) || 0;
      const updatePayload: Record<string, unknown> = {
        statut: 'EN_COURS',
        date_depot: now.toISOString(),
        numero: numeroResult.numero,
      };
      if (modeValue && avance > 0) {
        updatePayload.mode_reglement = avance >= depotTotal ? 'PAYER_DEPOT' : 'AVANCE';
        updatePayload.avance_amount = Math.min(avance, depotTotal);
      }

      const updateErr = await db.updateDepot(paymentDepot.id, updatePayload);
      if (updateErr) throw new Error(updateErr);

      if (modeValue && avance > 0) {
        await db.insertAvance(paymentDepot.id, Math.min(avance, depotTotal), modeValue);
      }

      notifyRealtimeMutation('depots');
      closePaymentModal();
      await loadDepots();
    } catch (err) {
      setConvertError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de la validation' : 'Error during validation'));
    } finally {
      setConvertingId(null);
    }
  }

  function openEditModal(depot: DepotWithArticles) {
    setEditingDepot(depot);
    setEditArticles(
      depot.articles.map((a: DepotArticle) => ({
        id: a.id,
        designation: a.designation,
        prix_unitaire: Number(a.prix_unitaire),
        quantite: a.quantite,
        nb_pieces: a.nb_pieces,
        couleur: a.couleur ?? '',
        signe_particulier: a.signe_particulier ?? '',
        griffe: a.griffe ?? '',
      })),
    );
    setEditNotes(depot.notes ?? '');
    setEditPickupRequested(depot.pickup_requested ?? false);
    setEditPickupAddress(depot.pickup_address ?? '');
    setEditPickupDay(depot.pickup_day ?? '');
    setEditDeliveryRequested(depot.delivery_requested ?? false);
    setEditDeliveryAddress(depot.delivery_address ?? '');
    setEditDeliveryDay(depot.delivery_day ?? '');
    setEditTypeTraitementId(depot.type_traitement_id);
  }

  function closeEditModal() {
    setEditingDepot(null);
    setEditArticles([]);
  }

  function updateArticle(idx: number, field: keyof ArticleDraft, value: string | number) {
    setEditArticles((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [field]: value };
      return copy;
    });
  }

  function addArticle() {
    setEditArticles((prev) => [
      ...prev,
      { designation: '', prix_unitaire: 0, quantite: 1, nb_pieces: 1, couleur: '', signe_particulier: '', griffe: '' },
    ]);
  }

  function removeArticle(idx: number) {
    setEditArticles((prev) => prev.filter((_, i) => i !== idx));
  }

  function computeEditTotal(): number {
    const coef = getCoefficientById(editTypeTraitementId, typesTraitement);
    const articlesSum = editArticles.reduce((sum, a) => {
      const prixTrait = a.prix_unitaire * coef;
      return sum + prixTrait * a.quantite;
    }, 0);
    const pickupFee = editPickupRequested ? (Number(editingDepot?.frais_collecte) || 0) : 0;
    const deliveryFee = editDeliveryRequested ? (Number(editingDepot?.frais_livraison) || 0) : 0;
    return articlesSum + pickupFee + deliveryFee;
  }

  async function handleSaveEdit() {
    if (!editingDepot) return;
    setSaving(true);
    try {
      const coef = getCoefficientById(editTypeTraitementId, typesTraitement);
      const total = computeEditTotal();

      const dateRetrait = computeDateRetraitPrevueById(new Date(), editTypeTraitementId, typesTraitement);
      const typeTrait = typesTraitement.find((t) => t.id === editTypeTraitementId);
      const traitementLibelle = typeTrait?.libelle ?? '';

      const { error: depotError } = await supabase
        .from('depots')
        .update({
          notes: editNotes || null,
          pickup_requested: editPickupRequested,
          pickup_address: editPickupRequested ? editPickupAddress || null : null,
          pickup_day: editPickupRequested ? editPickupDay || null : null,
          frais_collecte: editPickupRequested ? (Number(editingDepot.frais_collecte) || 0) : 0,
          delivery_requested: editDeliveryRequested,
          delivery_address: editDeliveryRequested ? editDeliveryAddress || null : null,
          delivery_day: editDeliveryRequested ? editDeliveryDay || null : null,
          frais_livraison: editDeliveryRequested ? (Number(editingDepot.frais_livraison) || 0) : 0,
          type_traitement_id: editTypeTraitementId,
          traitement: traitementLibelle,
          coefficient: coef,
          total,
          date_retrait_prevue: dateRetrait.toISOString(),
        })
        .eq('id', editingDepot.id);

      if (depotError) throw depotError;

      // Delete existing articles and re-insert
      const { error: delError } = await supabase
        .from('depot_articles')
        .delete()
        .eq('depot_id', editingDepot.id);
      if (delError) throw delError;

      if (editArticles.length > 0) {
        const rows = editArticles
          .filter((a) => a.designation.trim())
          .map((a) => ({
            depot_id: editingDepot.id,
            designation: a.designation,
            prix_unitaire: a.prix_unitaire,
            prix_traitement: a.prix_unitaire * coef,
            quantite: a.quantite,
            nb_pieces: a.nb_pieces,
            prix_total: a.prix_unitaire * coef * a.quantite,
            couleur: a.couleur || null,
            signe_particulier: a.signe_particulier || null,
            griffe: a.griffe || null,
          }));

        const { error: insError } = await supabase
          .from('depot_articles')
          .insert(rows);
        if (insError) throw insError;
      }

      await loadDepots();
      closeEditModal();
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto">
        <p className="text-sm text-slate-400 text-center py-8">{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="text-center">
        <div className="w-14 h-14 rounded-2xl bg-sky-50 flex items-center justify-center mx-auto mb-3">
          <ShoppingBag className="w-7 h-7 text-sky-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">
          {lang === 'fr' ? 'Commandes' : 'Orders'}
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          {lang === 'fr'
            ? 'Commandes en attente de validation'
            : 'Orders pending validation'}
        </p>
      </div>

      {/* Dashboard */}
      {(() => {
        const commandes = allDepots.filter((d) => d.statut === 'COMMANDE');
        const enCours = allDepots.filter((d) => d.statut === 'EN_COURS');
        const pretsLivraison = enCours.filter((d) => d.delivery_requested && d.ready_for_delivery);
        const caCommandes = commandes.reduce((s, d) => s + Number(d.total), 0);
        const caEnCours = enCours.reduce((s, d) => s + Number(d.total), 0);

        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 text-center">
              <div className="w-10 h-10 rounded-lg bg-sky-50 flex items-center justify-center mx-auto mb-2">
                <ShoppingBag className="w-5 h-5 text-sky-600" />
              </div>
              <p className="text-2xl font-bold text-slate-900">{commandes.length}</p>
              <p className="text-xs text-slate-400 mt-0.5">{lang === 'fr' ? 'En attente' : 'Pending'}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 text-center">
              <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center mx-auto mb-2">
                <Clock className="w-5 h-5 text-amber-500" />
              </div>
              <p className="text-2xl font-bold text-amber-600">{enCours.length}</p>
              <p className="text-xs text-slate-400 mt-0.5">{lang === 'fr' ? 'En traitement' : 'Processing'}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 text-center">
              <div className="w-10 h-10 rounded-lg bg-violet-50 flex items-center justify-center mx-auto mb-2">
                <Home className="w-5 h-5 text-violet-600" />
              </div>
              <p className="text-2xl font-bold text-violet-600">{pretsLivraison.length}</p>
              <p className="text-xs text-slate-400 mt-0.5">{lang === 'fr' ? 'Prêts à livrer' : 'Ready to deliver'}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 text-center">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center mx-auto mb-2">
                <TrendingUp className="w-5 h-5 text-emerald-600" />
              </div>
              <p className="text-sm font-bold text-emerald-600">{formatPrice(caCommandes + caEnCours)}</p>
              <p className="text-xs text-slate-400 mt-0.5">{lang === 'fr' ? 'CA en cours' : 'Active revenue'}</p>
            </div>
          </div>
        );
      })()}

      {depots.length === 0 ? (
        <div className="text-center py-12">
          <ShoppingBag className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-400">
            {lang === 'fr' ? 'Aucune commande en attente' : 'No pending orders'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {depots.map((depot) => (
            <div
              key={depot.id}
              className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-sky-50 text-sky-500">
                  <ShoppingBag className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-slate-900">
                      {depot.numero ?? (lang === 'fr' ? 'Commande en attente' : 'Pending order')}
                    </p>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">
                      {lang === 'fr' ? 'Commande' : 'Order'}
                    </span>
                    {depot.pickup_requested && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                        <Truck className="w-3 h-3" />
                        {lang === 'fr' ? 'Collecte' : 'Pickup'}
                      </span>
                    )}
                    {depot.delivery_requested && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                        <Home className="w-3 h-3" />
                        {lang === 'fr' ? 'Livraison' : 'Delivery'}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-700 mt-1">{depot.client?.nom ?? '—'}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {formatDate(depot.date_depot)}
                    {' · '}
                    {getTraitementLabelById(depot.type_traitement_id, typesTraitement, depot.traitement)} (×{Number(depot.coefficient)})
                  </p>
                  {depot.client?.telephone && (
                    <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                      <Phone className="w-3 h-3" /> {depot.client.telephone}
                    </p>
                  )}
                  {depot.pickup_requested && (
                    <div className="mt-2 p-2 rounded-lg bg-amber-50/70 border border-amber-100 space-y-1">
                      <p className="text-[11px] font-semibold text-amber-800">
                        {lang === 'fr' ? 'Collecte à domicile' : 'Home pickup'}
                        {Number(depot.frais_collecte || 0) > 0 && ` · ${formatPrice(Number(depot.frais_collecte))}`}
                      </p>
                      {depot.pickup_day && (
                        <p className="text-xs text-amber-700 flex items-center gap-1">
                          <CalendarClock className="w-3 h-3" />
                          <span className="capitalize">{depot.pickup_day}</span>
                        </p>
                      )}
                      {depot.pickup_address && (
                        <p className="text-xs text-amber-800 flex items-start gap-1">
                          <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0" />
                          {depot.pickup_address}
                        </p>
                      )}
                      {depot.pickup_latitude !== null && depot.pickup_longitude !== null && (
                        <a
                          href={`https://www.google.com/maps/dir/?api=1&destination=${depot.pickup_latitude},${depot.pickup_longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-amber-700 hover:text-amber-800 underline"
                        >
                          {depot.pickup_latitude.toFixed(5)}, {depot.pickup_longitude.toFixed(5)}
                        </a>
                      )}
                    </div>
                  )}
                  {depot.delivery_requested && (
                    <div className="mt-2 p-2 rounded-lg bg-sky-50 border border-sky-100 space-y-1">
                      <p className="text-[11px] font-semibold text-sky-800">
                        {lang === 'fr' ? 'Livraison à domicile' : 'Home delivery'}
                        {Number(depot.frais_livraison || 0) > 0 && ` · ${formatPrice(Number(depot.frais_livraison))}`}
                      </p>
                      {depot.delivery_day && (
                        <p className="text-xs text-sky-700 flex items-center gap-1">
                          <CalendarClock className="w-3 h-3" />
                          <span className="capitalize">{depot.delivery_day}</span>
                        </p>
                      )}
                      {depot.delivery_address && (
                        <p className="text-xs text-sky-800 flex items-start gap-1">
                          <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0" />
                          {depot.delivery_address}
                        </p>
                      )}
                      {depot.delivery_latitude !== null && depot.delivery_longitude !== null && (
                        <a
                          href={`https://www.google.com/maps/dir/?api=1&destination=${depot.delivery_latitude},${depot.delivery_longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-sky-600 hover:text-sky-700 underline"
                        >
                          {depot.delivery_latitude.toFixed(5)}, {depot.delivery_longitude.toFixed(5)}
                        </a>
                      )}
                    </div>
                  )}
                  {depot.notes && (
                    <p className="mt-2 text-xs text-slate-500 italic bg-slate-50 rounded-lg px-2.5 py-1.5 border border-slate-100">
                      {depot.notes}
                    </p>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-semibold text-slate-700">{formatPrice(Number(depot.total))}</p>
                  <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-0.5 justify-end">
                    <Package className="w-3 h-3" />
                    {depot.articles?.length ?? 0} {lang === 'fr' ? 'art.' : 'items'}
                  </p>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-slate-50 flex gap-2">
                <button
                  onClick={() => openEditModal(depot)}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 transition-colors"
                >
                  <Pencil className="w-4 h-4" />
                  {lang === 'fr' ? 'Modifier' : 'Edit'}
                </button>
                <button
                  onClick={() => openPaymentModal(depot)}
                  disabled={convertingId === depot.id}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {convertingId === depot.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ArrowRightLeft className="w-4 h-4" />
                  )}
                  {lang === 'fr' ? 'Convertir en dépôt' : 'Convert to deposit'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Payment modal */}
      {paymentDepot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6 overflow-y-auto">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={closePaymentModal} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md my-auto">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex items-center justify-between rounded-t-2xl z-10">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                  <Wallet className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    {lang === 'fr' ? 'Valider et encaisser' : 'Validate and collect'}
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {paymentDepot.client?.nom} · {formatPrice(Number(paymentDepot.total))}
                  </p>
                </div>
              </div>
              <button onClick={closePaymentModal} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">
                  {lang === 'fr' ? 'Mode de règlement' : 'Payment method'}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {modesReglement.map((mode) => {
                    const isSelected = paymentMode === mode.designation;
                    const isCash = mode.designation.toUpperCase().includes('ESP');
                    const isWave = mode.designation.toUpperCase().includes('WAVE');
                    const isOrange = mode.designation.toUpperCase().includes('ORANGE');
                    const isMoov = mode.designation.toUpperCase().includes('MOOV');
                    const icon = isCash ? <Banknote className="w-4 h-4" /> : isWave ? <Wallet className="w-4 h-4" /> : isOrange ? <Wallet className="w-4 h-4" /> : isMoov ? <Wallet className="w-4 h-4" /> : <Wallet className="w-4 h-4" />;
                    return (
                      <button
                        key={mode.id}
                        onClick={() => setPaymentMode(mode.designation)}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                          isSelected
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                            : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <span className={isSelected ? 'text-emerald-600' : 'text-slate-400'}>{icon}</span>
                        <span className="truncate">{mode.designation}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">
                  {lang === 'fr' ? 'Montant versé' : 'Amount paid'}
                </label>
                <input
                  type="number"
                  min="0"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  placeholder="0"
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
                {paymentAmount && parseFloat(paymentAmount) > 0 && (
                  <p className="text-xs text-slate-400 mt-1.5">
                    {lang === 'fr' ? 'Reste à payer' : 'Remaining'}: {formatPrice(Number(paymentDepot.total) - (parseFloat(paymentAmount) || 0))}
                  </p>
                )}
              </div>

              {!paymentMode && (
                <p className="text-xs text-slate-400">
                  {lang === 'fr'
                    ? 'Le client peut payer via mobile money (Wave, Orange, Moov) ou en espèces au collecteur.'
                    : 'Client can pay via mobile money (Wave, Orange, Moov) or cash to the collector.'}
                </p>
              )}
            </div>

            {convertError && (
              <div className="mx-5 mb-3 p-3 rounded-lg bg-red-50 border border-red-200">
                <div className="flex items-start gap-2">
                  <div className="w-5 h-5 rounded-full bg-red-100 text-red-600 flex items-center justify-center flex-shrink-0 text-xs font-bold">!</div>
                  <p className="text-sm text-red-700">{convertError}</p>
                </div>
              </div>
            )}

            <div className="sticky bottom-0 bg-white border-t border-slate-100 px-5 py-4 flex gap-3 rounded-b-2xl">
              <button
                onClick={closePaymentModal}
                disabled={!!convertingId}
                className="px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                {t('pw.cancel')}
              </button>
              <button
                onClick={handleConvert}
                disabled={!!convertingId}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {convertingId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {paymentMode && (parseFloat(paymentAmount) || 0) > 0
                  ? (lang === 'fr' ? 'Valider & encaisser' : 'Validate & collect')
                  : (lang === 'fr' ? 'Convertir (paiement à la livraison/retrait)' : 'Convert (pay on delivery/pickup)')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editingDepot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6 overflow-y-auto">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={closeEditModal} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg my-auto max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex items-center justify-between rounded-t-2xl z-10">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  {lang === 'fr' ? 'Modifier la commande' : 'Edit order'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">{editingDepot.numero ?? (lang === 'fr' ? 'Commande en attente' : 'Pending order')} · {editingDepot.client?.nom}</p>
              </div>
              <button onClick={closeEditModal} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* Treatment type */}
              {typesTraitement.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">
                    {lang === 'fr' ? 'Type de traitement' : 'Treatment type'}
                  </label>
                  <select
                    value={editTypeTraitementId ?? ''}
                    onChange={(e) => setEditTypeTraitementId(e.target.value || null)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <option value="">—</option>
                    {typesTraitement.map((t) => (
                      <option key={t.id} value={t.id}>{t.libelle} (×{t.coefficient})</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Articles */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-slate-500">
                    {lang === 'fr' ? 'Articles' : 'Items'}
                  </label>
                  <button
                    onClick={addArticle}
                    className="flex items-center gap-1 text-xs font-medium text-sky-600 hover:text-sky-700"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {lang === 'fr' ? 'Ajouter' : 'Add'}
                  </button>
                </div>
                <div className="space-y-2">
                  {editArticles.map((a, idx) => (
                    <div key={idx} className="p-3 rounded-lg border border-slate-100 space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={a.designation}
                          onChange={(e) => updateArticle(idx, 'designation', e.target.value)}
                          placeholder={lang === 'fr' ? 'Désignation' : 'Designation'}
                          className="flex-1 px-2 py-1.5 rounded border border-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500"
                        />
                        <button
                          onClick={() => removeArticle(idx)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <div className="flex items-center gap-1">
                          <label className="text-xs text-slate-400">{lang === 'fr' ? 'Qté' : 'Qty'}</label>
                          <input
                            type="number"
                            min={1}
                            value={a.quantite}
                            onChange={(e) => updateArticle(idx, 'quantite', parseInt(e.target.value) || 1)}
                            className="w-14 px-2 py-1 rounded border border-slate-200 text-sm text-center focus:outline-none focus:ring-1 focus:ring-sky-500"
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <label className="text-xs text-slate-400">{lang === 'fr' ? 'Pièces' : 'Pieces'}</label>
                          <input
                            type="number"
                            min={1}
                            value={a.nb_pieces}
                            onChange={(e) => updateArticle(idx, 'nb_pieces', parseInt(e.target.value) || 1)}
                            className="w-14 px-2 py-1 rounded border border-slate-200 text-sm text-center focus:outline-none focus:ring-1 focus:ring-sky-500"
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <label className="text-xs text-slate-400">{lang === 'fr' ? 'Prix' : 'Price'}</label>
                          <input
                            type="number"
                            min={0}
                            step="100"
                            value={a.prix_unitaire}
                            onChange={(e) => updateArticle(idx, 'prix_unitaire', parseFloat(e.target.value) || 0)}
                            className="w-20 px-2 py-1 rounded border border-slate-200 text-sm text-center focus:outline-none focus:ring-1 focus:ring-sky-500"
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <label className="text-xs text-slate-400">{lang === 'fr' ? 'Couleur' : 'Color'}</label>
                          <input
                            type="text"
                            value={a.couleur}
                            onChange={(e) => updateArticle(idx, 'couleur', e.target.value)}
                            className="w-20 px-2 py-1 rounded border border-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500"
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <label className="text-xs text-slate-400">{lang === 'fr' ? 'Signe' : 'Sign'}</label>
                          <input
                            type="text"
                            value={a.signe_particulier}
                            onChange={(e) => updateArticle(idx, 'signe_particulier', e.target.value)}
                            className="w-20 px-2 py-1 rounded border border-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500"
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <label className="text-xs text-slate-400">{lang === 'fr' ? 'Griffe' : 'Brand'}</label>
                          <input
                            type="text"
                            value={a.griffe}
                            onChange={(e) => updateArticle(idx, 'griffe', e.target.value)}
                            className="w-20 px-2 py-1 rounded border border-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                  {editArticles.length === 0 && (
                    <p className="text-xs text-slate-400 text-center py-3">
                      {lang === 'fr' ? 'Aucun article' : 'No items'}
                    </p>
                  )}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">
                  {lang === 'fr' ? 'Notes' : 'Notes'}
                </label>
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none"
                />
              </div>

              {/* Pickup */}
              <div>
                <button
                  onClick={() => setEditPickupRequested(!editPickupRequested)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border border-slate-100 hover:bg-slate-50/50 transition-colors"
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
                    editPickupRequested ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-400'
                  }`}>
                    <Truck className="w-4 h-4" />
                  </div>
                  <div className="text-left flex-1">
                    <p className="text-sm font-medium text-slate-900">
                      {lang === 'fr' ? 'Collecte à domicile' : 'Home pickup'}
                    </p>
                  </div>
                  <div className={`w-11 h-6 rounded-full flex items-center transition-colors flex-shrink-0 ${
                    editPickupRequested ? 'bg-sky-500 justify-end' : 'bg-slate-200 justify-start'
                  }`}>
                    <div className="w-5 h-5 rounded-full bg-white shadow-sm mx-0.5 transition-transform" />
                  </div>
                </button>
                {editPickupRequested && (
                  <div className="mt-2 space-y-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">
                        {lang === 'fr' ? 'Jour de collecte' : 'Pickup day'}
                      </label>
                      <select
                        value={editPickupDay}
                        onChange={(e) => setEditPickupDay(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                      >
                        <option value="">—</option>
                        {['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'].map((d) => (
                          <option key={d} value={d} className="capitalize">{d}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">
                        {lang === 'fr' ? 'Adresse de collecte' : 'Pickup address'}
                      </label>
                      <input
                        type="text"
                        value={editPickupAddress}
                        onChange={(e) => setEditPickupAddress(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Delivery */}
              <div>
                <button
                  type="button"
                  onClick={() => setEditDeliveryRequested(!editDeliveryRequested)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border border-slate-100 hover:bg-slate-50/50 transition-colors"
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
                    editDeliveryRequested ? 'bg-sky-100 text-sky-600' : 'bg-slate-100 text-slate-400'
                  }`}>
                    <Home className="w-4 h-4" />
                  </div>
                  <div className="text-left flex-1">
                    <p className="text-sm font-medium text-slate-900">
                      {lang === 'fr' ? 'Livraison à domicile' : 'Home delivery'}
                    </p>
                  </div>
                  <div className={`w-11 h-6 rounded-full flex items-center transition-colors flex-shrink-0 ${
                    editDeliveryRequested ? 'bg-sky-500 justify-end' : 'bg-slate-200 justify-start'
                  }`}>
                    <div className="w-5 h-5 rounded-full bg-white shadow-sm mx-0.5 transition-transform" />
                  </div>
                </button>
                {editDeliveryRequested && (
                  <div className="mt-2 space-y-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">
                        {lang === 'fr' ? 'Jour de livraison' : 'Delivery day'}
                      </label>
                      <select
                        value={editDeliveryDay}
                        onChange={(e) => setEditDeliveryDay(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                      >
                        <option value="">—</option>
                        {['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'].map((d) => (
                          <option key={d} value={d} className="capitalize">{d}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">
                        {lang === 'fr' ? 'Adresse de livraison' : 'Delivery address'}
                      </label>
                      <input
                        type="text"
                        value={editDeliveryAddress}
                        onChange={(e) => setEditDeliveryAddress(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Total */}
              <div className="flex items-center justify-between px-3 py-3 rounded-lg bg-slate-50">
                <div>
                  <span className="text-sm font-semibold text-slate-700">{lang === 'fr' ? 'Total (frais inclus)' : 'Total (incl. fees)'}</span>
                  {((editPickupRequested ? Number(editingDepot?.frais_collecte) || 0 : 0) +
                    (editDeliveryRequested ? Number(editingDepot?.frais_livraison) || 0 : 0)) > 0 && (
                    <p className="text-[11px] text-slate-400">
                      {lang === 'fr' ? 'Inclut frais collecte/livraison' : 'Includes pickup/delivery fees'}
                    </p>
                  )}
                </div>
                <span className="text-lg font-bold text-sky-600">{formatPrice(computeEditTotal())}</span>
              </div>
            </div>

            <div className="sticky bottom-0 bg-white border-t border-slate-100 px-5 py-4 flex gap-3 rounded-b-2xl">
              <button
                onClick={closeEditModal}
                className="px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                {t('pw.cancel')}
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {lang === 'fr' ? 'Enregistrer' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
