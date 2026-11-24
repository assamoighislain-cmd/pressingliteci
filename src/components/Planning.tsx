import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { db } from '@/lib/db';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { DepotWithClient, DepotWithArticles, DepotAvance, TypeTraitement, ModeReglementRow, Entreprise, formatPrice, formatDate, formatDateShort, getTraitementLabelById, getModeReglementLabel, buildWhatsAppMessage, buildWhatsAppUrl, resolveReceiptHeader } from '@/types';
import { Calendar, Clock, Check, ChevronDown, ChevronRight, ArrowUpFromLine, RotateCcw, Package, MessageCircle, Printer } from 'lucide-react';
import { PrintableReport, printReport, type ReportData } from '@/components/PrintableReport';

type FilterMode = 'all' | 'en_cours' | 'retire';

interface DateGroup {
  date: string;
  label: string;
  depots: DepotWithClient[];
  recettePrevu: number;
}

export default function Planning() {
  const { t, lang } = useI18n();
  const { boutiques, currentBoutique } = useAuth();
  const [depots, setDepots] = useState<DepotWithClient[]>([]);
  const [typesTraitement, setTypesTraitement] = useState<TypeTraitement[]>([]);
  const [modesReglement, setModesReglement] = useState<ModeReglementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterMode>('en_cours');
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<DepotWithArticles | null>(null);
  const [detailAvances, setDetailAvances] = useState<DepotAvance[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [entreprise, setEntreprise] = useState<Entreprise | null>(null);

  useEffect(() => {
    void loadPlanning(false);
  }, []);

  useRealtimeSync(['depots', 'depot_articles', 'depot_avances', 'clients'], () => loadPlanning(true));

  async function loadPlanning(silent = false) {
    if (!silent) setLoading(true);
    const [depotsData, typesData, modesData, entrepriseData] = await Promise.all([
      db.getDepotsForPlanning(),
      db.getTypesTraitement(),
      db.getModesReglement(),
      db.getEntreprise(),
    ]);
    setDepots(depotsData);
    setTypesTraitement(typesData);
    setModesReglement(modesData);
    setEntreprise(entrepriseData);
    if (!silent) setLoading(false);
  }

  function buildWhatsAppLink(depot: DepotWithClient): string | null {
    const phone = depot.clients?.telephone;
    if (!phone) return null;
    const originalAvance = depot.mode_reglement === 'AVANCE' ? (Number(depot.avance_amount) ?? 0) : 0;
    const reste = Math.max(0, Number(depot.total) - originalAvance);
    const depotBoutique =
      (depot.boutique_id ? boutiques.find((b) => b.id === depot.boutique_id) : null) ??
      currentBoutique;
    const header = resolveReceiptHeader(entreprise, depotBoutique);
    const message = buildWhatsAppMessage({
      entrepriseNom: header.nom,
      entrepriseTelephone: header.telephone,
      entrepriseAdresse: header.adresse,
      entrepriseVille: header.ville,
      entrepriseEmail: header.email,
      entrepriseSlogan: header.slogan,
      entrepriseId: entreprise?.id,
      numero: depot.numero,
      portalCode: depot.clients?.portal_code ?? null,
      clientNom: depot.clients?.nom ?? '',
      dateDepot: depot.date_depot ?? '',
      dateRetraitPrevue: depot.date_retrait_prevue ?? null,
      traitement: getTraitementLabelById(depot.type_traitement_id, typesTraitement, depot.traitement),
      coefficient: Number(depot.coefficient),
      total: Number(depot.total),
      tauxRemise: Number(depot.taux_remise ?? 0) > 0 ? Number(depot.taux_remise) : undefined,
      montantRemise: Number(depot.montant_remise ?? 0) > 0 ? Number(depot.montant_remise) : undefined,
      articles: [],
      reste,
      notes: depot.notes ?? undefined,
    });
    return buildWhatsAppUrl(phone, message);
  }

  async function changeStatut(depotId: string, newStatut: 'EN_COURS' | 'RETIRE') {
    setUpdatingId(depotId);

    try {
      const payload: Record<string, unknown> = { statut: newStatut };
      if (newStatut === 'RETIRE') {
        payload.date_retrait = new Date().toISOString();
      } else {
        payload.date_retrait = null;
      }

      const error = await db.updateDepot(depotId, payload);

      if (error) {
        console.error('Erreur changement statut:', error);
        return;
      }

      setDepots((prev) =>
        prev.map((d) =>
          d.id === depotId
            ? {
                ...d,
                statut: newStatut,
                date_retrait: newStatut === 'RETIRE' ? new Date().toISOString() : null,
              }
            : d,
        ),
      );
    } catch (err) {
      console.error('Erreur changement statut:', err);
    } finally {
      setUpdatingId(null);
    }
  }

  function toggleDate(date: string) {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  async function toggleDetail(depotId: string) {
    if (detailId === depotId) {
      setDetailId(null);
      setDetailData(null);
      setDetailAvances([]);
      return;
    }
    setDetailId(depotId);
    setDetailLoading(true);
    const [depot, avs] = await Promise.all([
      db.getDepotById(depotId),
      db.getAvancesForDepot(depotId),
    ]);
    setDetailData(depot);
    setDetailAvances(avs);
    setDetailLoading(false);
  }

  // Filter
  const filtered = depots.filter((d) => {
    if (filter === 'en_cours') return d.statut === 'EN_COURS';
    if (filter === 'retire') return d.statut === 'RETIRE';
    return true;
  });

  // Group by date_retrait_prevue
  const groups: DateGroup[] = [];
  const groupMap = new Map<string, DepotWithClient[]>();

  filtered.forEach((depot) => {
    const dateKey = depot.date_retrait_prevue
      ? formatDateShort(depot.date_retrait_prevue)
      : t('planning.noDate');
    if (!groupMap.has(dateKey)) groupMap.set(dateKey, []);
    groupMap.get(dateKey)!.push(depot);
  });

  const noDateKey = t('planning.noDate');
  const sortedKeys = Array.from(groupMap.keys()).sort((a, b) => {
    if (a === noDateKey) return 1;
    if (b === noDateKey) return -1;
    return a.localeCompare(b);
  });

  sortedKeys.forEach((key) => {
    const dayDepots = groupMap.get(key)!;
    const recettePrevu = dayDepots.reduce((sum, d) => sum + Number(d.total), 0);
    groups.push({ date: key, label: key, depots: dayDepots, recettePrevu });
  });

  // Auto-expand first group
  useEffect(() => {
    if (groups.length > 0 && expandedDates.size === 0) {
      setExpandedDates(new Set([groups[0].date]));
    }
  }, [groups, expandedDates.size]);

  const today = formatDateShort(new Date().toISOString());

  const filterButtons: { id: FilterMode; label: string; count: number }[] = [
    { id: 'en_cours', label: t('planning.inProgress'), count: depots.filter((d) => d.statut === 'EN_COURS').length },
    { id: 'retire', label: t('planning.withdrawn'), count: depots.filter((d) => d.statut === 'RETIRE').length },
    { id: 'all', label: t('planning.all'), count: depots.length },
  ];

  const reportData: ReportData = {
    title: lang === 'fr' ? 'Planning de retrait' : 'Pickup planning',
    subtitle: lang === 'fr' ? 'Dépôts à retirer' : 'Deposits to pick up',
    entreprise,
    columns: [
      { key: 'date', label: lang === 'fr' ? 'Date retrait' : 'Pickup date', align: 'left', render: (r) => String(r.date ?? '—') },
      { key: 'numero', label: 'N°', align: 'left', render: (r) => String(r.numero ?? '—') },
      { key: 'client', label: lang === 'fr' ? 'Client' : 'Client', align: 'left', render: (r) => String(r.client ?? '') },
      { key: 'tel', label: lang === 'fr' ? 'Téléphone' : 'Phone', align: 'left', render: (r) => String(r.tel ?? '—') },
      { key: 'traitement', label: lang === 'fr' ? 'Traitement' : 'Treatment', align: 'left', render: (r) => String(r.traitement ?? '') },
      { key: 'statut', label: lang === 'fr' ? 'Statut' : 'Status', align: 'center', render: (r) => String(r.statut ?? '') },
      { key: 'total', label: lang === 'fr' ? 'Total' : 'Total', align: 'right', render: (r) => formatPrice(Number(r.total ?? 0)) },
    ],
    rows: groups.flatMap((g) =>
      g.depots.map((d) => ({
        date: g.date,
        numero: d.numero,
        client: d.clients?.nom ?? '',
        tel: d.clients?.telephone ?? '',
        traitement: getTraitementLabelById(d.type_traitement_id, typesTraitement, d.traitement),
        statut: d.statut,
        total: d.total,
      })),
    ),
    summaryRows: [
      { label: lang === 'fr' ? 'Nombre de dépôts' : 'Deposit count', value: String(filtered.length) },
      { label: lang === 'fr' ? 'Recette prévue totale' : 'Total expected revenue', value: formatPrice(filtered.reduce((s, d) => s + Number(d.total), 0)), highlight: true },
    ],
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="text-center">
        <div className="w-14 h-14 rounded-2xl bg-sky-50 flex items-center justify-center mx-auto mb-3">
          <Calendar className="w-7 h-7 text-sky-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">{t('planning.title')}</h2>
        <p className="text-sm text-slate-500 mt-1">
          {t('planning.subtitle')}
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 justify-center">
        {filterButtons.map((btn) => (
          <button
            key={btn.id}
            onClick={() => setFilter(btn.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              filter === btn.id
                ? 'bg-sky-500 text-white shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'
            }`}
          >
            {btn.label}
            <span className={`ml-1.5 text-xs ${filter === btn.id ? 'text-sky-100' : 'text-slate-400'}`}>
              {btn.count}
            </span>
          </button>
        ))}
      </div>

      {/* Print button */}
      {!loading && filtered.length > 0 && (
        <button
          onClick={() => printReport()}
          className="w-full py-2.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 transition-colors flex items-center justify-center gap-2"
        >
          <Printer className="w-4 h-4" /> {lang === 'fr' ? 'Imprimer le planning' : 'Print planning'}
        </button>
      )}

      {loading ? (
        <p className="text-sm text-slate-400 text-center py-8">{t('planning.loading')}</p>
      ) : groups.length === 0 ? (
        <div className="text-center py-12">
          <Calendar className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-400">{t('planning.noDeposits')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => {
            const isExpanded = expandedDates.has(group.date);
            const isToday = group.date === today;
            const enCoursCount = group.depots.filter((d) => d.statut === 'EN_COURS').length;

            return (
              <div
                key={group.date}
                className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden"
              >
                {/* Date header */}
                <button
                  onClick={() => toggleDate(group.date)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        isToday ? 'bg-sky-100 text-sky-600' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      <Calendar className="w-5 h-5" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-semibold text-slate-900">
                        {group.date}
                        {isToday && (
                          <span className="ml-2 text-xs font-medium text-sky-600 bg-sky-50 px-2 py-0.5 rounded-full">
                            {t('planning.today')}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {t('planning.depositCount', { count: group.depots.length })}
                        {enCoursCount > 0 && ` · ${t('planning.inProgressCount', { count: enCoursCount })}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-sm font-semibold text-emerald-600 whitespace-nowrap">{formatPrice(group.recettePrevu)}</p>
                      <p className="text-xs text-slate-400">{lang === 'fr' ? 'Recette prévue' : 'Expected revenue'}</p>
                    </div>
                    {isExpanded ? (
                      <ChevronDown className="w-5 h-5 text-slate-400" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-slate-400" />
                    )}
                  </div>
                </button>

                {/* Depot list */}
                {isExpanded && (
                  <div className="divide-y divide-slate-50">
                    {group.depots.map((depot) => {
                      const isUpdating = updatingId === depot.id;
                      const isEnCours = depot.statut === 'EN_COURS';

                      return (
                        <div key={depot.id}>
                          <div
                            className="px-5 py-3.5 flex items-center justify-between hover:bg-slate-50/50 transition-colors cursor-pointer"
                            onClick={() => toggleDetail(depot.id)}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div
                                className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                                  isEnCours ? 'bg-amber-400' : 'bg-emerald-400'
                                }`}
                              />
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-slate-900 truncate">
                                  {depot.numero} — {depot.clients?.nom ?? t('retrait.unknownClient')}
                                </p>
                                <p className="text-xs text-slate-400 mt-0.5">
                                  {getTraitementLabelById(depot.type_traitement_id, typesTraitement, depot.traitement)} (×{Number(depot.coefficient)})
                                  {' · '}
                                  {formatPrice(Number(depot.total))}
                                </p>
                                {depot.clients?.telephone && (
                                  <p className="text-xs text-slate-400 mt-0.5">
                                    {t('planning.tel')}: {depot.clients.telephone}
                                  </p>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                              {detailId === depot.id && (
                                <ChevronDown className="w-4 h-4 text-slate-400" />
                              )}
                              <span
                                className={`text-xs font-medium px-2.5 py-1 rounded-full flex items-center gap-1 ${
                                  isEnCours
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-emerald-100 text-emerald-700'
                                }`}
                              >
                                {isEnCours ? (
                                  <>
                                    <Clock className="w-3 h-3" /> {t('planning.inProgress')}
                                  </>
                                ) : (
                                  <>
                                    <Check className="w-3 h-3" /> {lang === 'fr' ? 'Retiré' : 'Picked up'}
                                  </>
                                )}
                              </span>

                              {isUpdating ? (
                                <div className="w-8 h-8 flex items-center justify-center">
                                  <div className="w-4 h-4 border-2 border-slate-200 border-t-sky-500 rounded-full animate-spin" />
                                </div>
                              ) : isEnCours ? (
                                <button
                                  onClick={(e) => { e.stopPropagation(); changeStatut(depot.id, 'RETIRE'); }}
                                  title={t('planning.markWithdrawn')}
                                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors"
                                >
                                  <ArrowUpFromLine className="w-4 h-4" />
                                </button>
                              ) : (
                                <button
                                  onClick={(e) => { e.stopPropagation(); changeStatut(depot.id, 'EN_COURS'); }}
                                  title={t('planning.markInProgress')}
                                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors"
                                >
                                  <RotateCcw className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Detail panel */}
                          {detailId === depot.id && (
                            <div className="px-5 pb-4 bg-slate-50/70 border-t border-slate-100">
                              {detailLoading ? (
                                <p className="text-sm text-slate-400 py-4 text-center">{t('planning.loading')}</p>
                              ) : detailData ? (
                                <div className="pt-3 space-y-3">
                                  {/* Dates */}
                                  <div className="grid grid-cols-2 gap-3 text-xs">
                                    <div>
                                      <p className="text-slate-400">{t('planning.depositedOn')}</p>
                                      <p className="font-medium text-slate-700 mt-0.5">{formatDate(detailData.date_depot)}</p>
                                    </div>
                                    <div>
                                      <p className="text-slate-400">{t('planning.retraitPrevu')}</p>
                                      <p className="font-medium text-slate-700 mt-0.5">{formatDate(detailData.date_retrait_prevue)}</p>
                                    </div>
                                    {detailData.date_retrait && (
                                      <div>
                                        <p className="text-slate-400">{t('planning.withdrawnOn')}</p>
                                        <p className="font-medium text-emerald-600 mt-0.5">{formatDate(detailData.date_retrait)}</p>
                                      </div>
                                    )}
                                    <div>
                                      <p className="text-slate-400">{t('planning.payment')}</p>
                                      <p className="font-medium text-slate-700 mt-0.5">{getModeReglementLabel(detailData.mode_reglement, modesReglement)}</p>
                                    </div>
                                  </div>

                                  {/* Articles */}
                                  <div>
                                    <p className="text-xs text-slate-400 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                                      <Package className="w-3 h-3" /> {t('planning.articles')}
                                    </p>
                                    <div className="space-y-1">
                                      {detailData.articles.map((art) => (
                                        <div key={art.id} className="flex justify-between text-xs py-1 px-2 bg-white rounded border border-slate-100">
                                          <div>
                                            <p className="font-medium text-slate-700">{art.designation}</p>
                                            <p className="text-slate-400">
                                              {art.quantite} × {formatPrice(Number(art.prix_unitaire))}
                                              {(Number(art.nb_pieces) || 1) * (Number(art.quantite) || 1) > 1 ? (lang === 'fr' ? ` · ${(Number(art.nb_pieces) || 1) * (Number(art.quantite) || 1)} pièces` : ` · ${(Number(art.nb_pieces) || 1) * (Number(art.quantite) || 1)} items`) : ''}
                                            </p>
                                            {(art.couleur || art.signe_particulier || art.griffe) && (
                                              <p className="text-slate-400 italic">
                                                {[art.couleur, art.signe_particulier, art.griffe].filter(Boolean).join(' · ')}
                                              </p>
                                            )}
                                          </div>
                                          <span className="font-medium text-slate-700 whitespace-nowrap self-center">{formatPrice(Number(art.prix_total))}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>

                                  {/* Payment summary */}
                                  <div className="pt-2 border-t border-slate-200 space-y-1">
                                    {Number(detailData.taux_remise ?? 0) > 0 && (
                                      <div className="flex justify-between text-xs">
                                        <span className="text-slate-400">{t('planning.discount', { rate: Number(detailData.taux_remise) })}</span>
                                        <span className="text-emerald-600">−{formatPrice(Number(detailData.montant_remise ?? 0))}</span>
                                      </div>
                                    )}
                                    <div className="flex justify-between text-xs font-semibold">
                                      <span className="text-slate-600">{t('planning.total')}</span>
                                      <span className="text-slate-900">{formatPrice(Number(detailData.total))}</span>
                                    </div>
                                    {(() => {
                                      const originalAvance = detailData.mode_reglement === 'AVANCE' ? (Number(detailData.avance_amount) ?? 0) : 0;
                                      const extraAvances = detailAvances.reduce((s, a) => s + Number(a.montant), 0);
                                      const totalPaye = originalAvance + extraAvances;
                                      const reste = Number(detailData.total) - totalPaye;
                                      return (
                                        <>
                                          {totalPaye > 0 && (
                                            <div className="flex justify-between text-xs">
                                              <span className="text-slate-400">{t('planning.amountPaid')}</span>
                                              <span className="font-medium text-emerald-600">{formatPrice(totalPaye)}</span>
                                            </div>
                                          )}
                                          {reste > 0 && (
                                            <div className="flex justify-between text-xs font-semibold">
                                              <span className="text-red-500">{t('planning.remaining')}</span>
                                              <span className="text-red-600">{formatPrice(reste)}</span>
                                            </div>
                                          )}
                                          {detailAvances.length > 0 && (
                                            <div className="pt-1 space-y-0.5">
                                              {detailAvances.map((av) => (
                                                <div key={av.id} className="flex justify-between text-[0.7em] text-slate-400">
                                                  <span>{t('planning.avance', { date: formatDateShort(av.date_paiement) })}</span>
                                                  <span>{formatPrice(Number(av.montant))}</span>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </>
                                      );
                                    })()}
                                  </div>

                                  {detailData.notes && (
                                    <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded p-2">
                                      <span className="font-medium">{t('planning.notes')}: </span>{detailData.notes}
                                    </div>
                                  )}

                                  {/* WhatsApp button */}
                                  {depot.clients?.telephone && (() => {
                                    const waUrl = buildWhatsAppLink(depot);
                                    return waUrl ? (
                                      <a
                                        href={waUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-emerald-500 text-white font-medium text-sm hover:bg-emerald-600 transition-colors"
                                      >
                                        <MessageCircle className="w-4 h-4" />
                                        {lang === 'fr' ? 'Envoyer par WhatsApp' : 'Send via WhatsApp'}
                                      </a>
                                    ) : null;
                                  })()}
                                </div>
                              ) : (
                                <p className="text-sm text-slate-400 py-4 text-center">{t('planning.notFound')}</p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <PrintableReport data={reportData} />
    </div>
  );
}
