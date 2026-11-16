import { useState, useEffect, useCallback } from 'react';
import { db } from '@/lib/db';
import { useI18n } from '@/lib/i18n';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { DepotWithArticles, formatPrice, formatDate, getTraitementLabelById, TypeTraitement } from '@/types';
import { Truck, MapPin, Phone, Navigation, Package, Check, Loader2, Home, ChevronDown, Shirt, Clock, CheckCircle2 } from 'lucide-react';

export default function LivraisonView() {
  const { lang } = useI18n();
  const [depots, setDepots] = useState<DepotWithArticles[]>([]);
  const [typesTraitement, setTypesTraitement] = useState<TypeTraitement[]>([]);
  const [loading, setLoading] = useState(true);
  const [deliveringId, setDeliveringId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadLivraisons = useCallback(async () => {
    const [all, types] = await Promise.all([
      db.getAllDepotsWithClient(),
      db.getTypesTraitement(),
    ]);
    setTypesTraitement(types);
    setDepots(all.filter((d) => d.delivery_requested && (d.statut === 'EN_COURS' || d.statut === 'COMMANDE')));
    setLoading(false);
  }, []);

  useEffect(() => {
    loadLivraisons();
  }, [loadLivraisons]);

  useRealtimeSync(['depots', 'depot_articles', 'clients', 'types_traitement'], loadLivraisons);

  async function handleDelivered(depotId: string) {
    setDeliveringId(depotId);
    try {
      const updateError = await db.updateDepot(depotId, {
        statut: 'RETIRE',
        date_retrait: new Date().toISOString(),
      });
      if (updateError) throw new Error(updateError);
      setDepots((prev) => prev.filter((d) => d.id !== depotId));
    } catch {
      // ignore
    } finally {
      setDeliveringId(null);
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
        <p className="text-sm text-slate-400 text-center py-8">{lang === 'fr' ? 'Chargement…' : 'Loading…'}</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="text-center">
        <div className="w-14 h-14 rounded-2xl bg-sky-50 flex items-center justify-center mx-auto mb-3">
          <Home className="w-7 h-7 text-sky-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">
          {lang === 'fr' ? 'Commandes à livrer' : 'Orders to deliver'}
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          {lang === 'fr'
            ? 'Commandes prêtes à être livrées à domicile'
            : 'Orders ready for home delivery'}
        </p>
      </div>

      {depots.length === 0 ? (
        <div className="text-center py-12">
          <Home className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-400">
            {lang === 'fr' ? 'Aucune livraison en attente' : 'No deliveries pending'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {depots.map((depot) => (
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
                      <p className="text-sm font-semibold text-slate-900">{depot.numero ?? (lang === 'fr' ? 'Commande' : 'Order')}</p>
                      {depot.statut === 'COMMANDE' ? (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                          {lang === 'fr' ? 'Commande' : 'Order'}
                        </span>
                      ) : depot.ready_for_delivery ? (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          {lang === 'fr' ? 'Prêt' : 'Ready'}
                        </span>
                      ) : (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {lang === 'fr' ? 'En traitement' : 'Processing'}
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
                {depot.delivery_day && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-sky-50 border border-sky-100">
                    <Package className="w-4 h-4 text-sky-600 flex-shrink-0" />
                    <span className="text-sm font-medium text-sky-800">
                      {dayLabels[depot.delivery_day]?.[lang === 'fr' ? 'fr' : 'en'] ?? depot.delivery_day}
                    </span>
                  </div>
                )}
                {depot.delivery_address && (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-sky-50 border border-sky-100">
                    <MapPin className="w-4 h-4 text-sky-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-sky-800">{depot.delivery_address}</p>
                  </div>
                )}
                {depot.delivery_latitude !== null && depot.delivery_longitude !== null && (
                  <a
                    href={`https://www.google.com/maps?q=${depot.delivery_latitude},${depot.delivery_longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-100 hover:bg-emerald-100 transition-colors"
                  >
                    <Navigation className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                    <span className="text-sm text-emerald-700 font-medium">
                      {lang === 'fr' ? 'Voir sur la carte' : 'View on map'}
                    </span>
                    <span className="text-xs text-emerald-500 ml-auto">
                      {depot.delivery_latitude.toFixed(5)}, {depot.delivery_longitude.toFixed(5)}
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
                {depot.statut === 'EN_COURS' && depot.ready_for_delivery ? (
                  <button
                    onClick={() => handleDelivered(depot.id)}
                    disabled={deliveringId === depot.id}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {deliveringId === depot.id ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {lang === 'fr' ? 'Enregistrement…' : 'Saving…'}
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        {lang === 'fr' ? 'Commande livrée' : 'Order delivered'}
                      </>
                    )}
                  </button>
                ) : depot.statut === 'COMMANDE' ? (
                  <div className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-100 text-slate-400 text-sm font-medium text-center">
                    {lang === 'fr' ? 'À convertir en dépôt d’abord' : 'Convert to deposit first'}
                  </div>
                ) : (
                  <div className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-amber-50 text-amber-600 text-sm font-medium text-center border border-amber-100">
                    <Clock className="w-4 h-4" />
                    {lang === 'fr' ? 'En cours de traitement — marquer disponible pour livrer' : 'Processing — mark as ready to deliver'}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
