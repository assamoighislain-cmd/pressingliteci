import { useState, useEffect, useCallback } from 'react';
import { db } from '@/lib/db';
import { useI18n } from '@/lib/i18n';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { DepotWithArticles, formatPrice, formatDate, getTraitementLabelById, TypeTraitement } from '@/types';
import { Truck, MapPin, CalendarClock, Phone, Navigation, Package, Clock, Check, ShoppingBag, Loader2, ChevronDown, Shirt } from 'lucide-react';

export default function CollecteView() {
  const { t, lang } = useI18n();
  const [depots, setDepots] = useState<DepotWithArticles[]>([]);
  const [typesTraitement, setTypesTraitement] = useState<TypeTraitement[]>([]);
  const [loading, setLoading] = useState(true);
  const [collectingId, setCollectingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadCollectes = useCallback(async () => {
    const [all, types] = await Promise.all([
      db.getAllDepotsWithClient(),
      db.getTypesTraitement(),
    ]);
    setTypesTraitement(types);
    setDepots(all.filter((d) => d.pickup_requested && !d.collected_at));
    setLoading(false);
  }, []);

  useEffect(() => {
    loadCollectes();
  }, [loadCollectes]);

  useRealtimeSync(['depots', 'depot_articles', 'clients', 'types_traitement'], loadCollectes);

  async function handleCollect(depotId: string) {
    setCollectingId(depotId);
    setError(null);
    try {
      const updateError = await db.updateDepot(depotId, {
        collected_at: new Date().toISOString(),
        statut: 'EN_COURS',
      });
      if (updateError) throw new Error(updateError);
      setDepots((prev) => prev.filter((d) => d.id !== depotId));
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de la collecte' : 'Error during collection'));
    } finally {
      setCollectingId(null);
    }
  }

  const dayLabels: Record<string, { fr: string; en: string }> = {
    lundi: { fr: 'Lundi', en: 'Monday' },
    mardi: { fr: 'Mardi', en: 'Tuesday' },
    mercredi: { fr: 'Mercredi', en: 'Wednesday' },
    jeudi: { fr: 'Jeudi', en: 'Thursday' },
    vendredi: { fr: 'Vendredi', en: 'Friday' },
    samedi: { fr: 'Samedi', en: 'Saturday' },
    dimanche: { fr: 'Dimanche', en: 'Sunday' },
  };

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
        <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-3">
          <Truck className="w-7 h-7 text-amber-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">
          {lang === 'fr' ? 'Linge à collecter' : 'Items to pick up'}
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          {lang === 'fr'
            ? 'Commandes nécessitant une collecte à domicile'
            : 'Orders requiring home pickup'}
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {depots.length === 0 ? (
        <div className="text-center py-12">
          <Truck className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-400">
            {lang === 'fr' ? 'Aucune collecte en attente' : 'No pickups pending'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {depots.map((depot) => {
            const isCommande = depot.statut === 'COMMANDE';
            const isEnCours = depot.statut === 'EN_COURS';
            const isRetire = depot.statut === 'RETIRE';
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
                        <p className="text-sm font-semibold text-slate-900">{depot.numero ?? (lang === 'fr' ? 'Commande en attente' : 'Pending order')}</p>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          isCommande ? 'bg-sky-100 text-sky-700' : isEnCours ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                        }`}>
                          {isCommande
                            ? (lang === 'fr' ? 'Commande' : 'Order')
                            : isEnCours
                              ? (lang === 'fr' ? 'En cours' : 'In progress')
                              : (lang === 'fr' ? 'Retiré' : 'Picked up')}
                        </span>
                      </div>
                      <p className="text-sm text-slate-700 mt-1">{depot.client?.nom ?? '—'}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {formatDate(depot.date_depot)}
                        {' · '}
                        {getTraitementLabelById(depot.type_traitement_id, typesTraitement, depot.traitement)} (×{Number(depot.coefficient)})
                      </p>
                      {depot.client?.telephone && (
                        <a
                          href={`tel:${depot.client.telephone}`}
                          className="text-xs text-sky-600 mt-0.5 flex items-center gap-1 hover:text-sky-700"
                        >
                          <Phone className="w-3 h-3" /> {depot.client.telephone}
                        </a>
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
                </div>

                <div className="px-4 pb-4 -mt-1 space-y-2">
                  {depot.pickup_day && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-100">
                      <CalendarClock className="w-4 h-4 text-amber-600 flex-shrink-0" />
                      <span className="text-sm font-medium text-amber-800">
                        {dayLabels[depot.pickup_day]?.[lang === 'fr' ? 'fr' : 'en'] ?? depot.pickup_day}
                      </span>
                    </div>
                  )}
                  {depot.pickup_address && (
                    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-sky-50 border border-sky-100">
                      <MapPin className="w-4 h-4 text-sky-600 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-sky-800">{depot.pickup_address}</p>
                    </div>
                  )}
                  {depot.pickup_latitude !== null && depot.pickup_longitude !== null && (
                    <a
                      href={`https://www.google.com/maps?q=${depot.pickup_latitude},${depot.pickup_longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-100 hover:bg-emerald-100 transition-colors"
                    >
                      <Navigation className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                      <span className="text-sm text-emerald-700 font-medium">
                        {lang === 'fr' ? 'Voir sur la carte' : 'View on map'}
                      </span>
                      <span className="text-xs text-emerald-500 ml-auto">
                        {depot.pickup_latitude.toFixed(5)}, {depot.pickup_longitude.toFixed(5)}
                      </span>
                    </a>
                  )}
                </div>

                <div className="px-4 pb-4 pt-2 space-y-2">
                  <button
                    onClick={() => setExpandedId(expandedId === depot.id ? null : depot.id)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm font-medium hover:bg-slate-200 transition-colors"
                  >
                    <Shirt className="w-4 h-4" />
                    {lang === 'fr' ? 'Détails des articles' : 'Item details'}
                    <ChevronDown className={`w-4 h-4 transition-transform ${expandedId === depot.id ? 'rotate-180' : ''}`} />
                  </button>
                  {expandedId === depot.id && depot.articles && depot.articles.length > 0 && (
                    <div className="rounded-lg border border-slate-100 divide-y divide-slate-50">
                      {depot.articles.map((art) => (
                        <div key={art.id} className="px-3 py-2 flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-800 truncate">{art.designation}</p>
                            <p className="text-xs text-slate-400">
                              {art.quantite} × {art.nb_pieces} {lang === 'fr' ? 'pcs' : 'pcs'}
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
                    onClick={() => handleCollect(depot.id)}
                    disabled={collectingId === depot.id}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {collectingId === depot.id ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {lang === 'fr' ? 'Enregistrement…' : 'Saving…'}
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        {lang === 'fr' ? 'Marquer comme collecté' : 'Mark as collected'}
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
