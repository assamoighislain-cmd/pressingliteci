import { useState, useEffect, useMemo } from 'react';
import { useI18n } from '@/lib/i18n';
import { db } from '@/lib/db';
import {
  DepotWithArticles,
  TypeTraitement,
  formatPrice,
  formatDateShort,
  getTraitementLabelById,
} from '@/types';
import { PrintableReport, printReport, type ReportData } from '@/components/PrintableReport';
import { Entreprise } from '@/types';
import {
  PackageSearch,
  Search,
  Printer,
  Shirt,
  ChevronDown,
  Clock,
  Calendar,
  Wallet,
  Boxes,
  Loader2,
} from 'lucide-react';

export default function Inventaire() {
  const { t, lang } = useI18n();
  const [depots, setDepots] = useState<DepotWithArticles[]>([]);
  const [typesTraitement, setTypesTraitement] = useState<TypeTraitement[]>([]);
  const [entreprise, setEntreprise] = useState<Entreprise | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [stock, types, ent] = await Promise.all([
        db.getDepotsForRetrait(),
        db.getTypesTraitement(),
        db.getEntreprise(),
      ]);
      setDepots(stock);
      setTypesTraitement(types);
      setEntreprise(ent);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const lower = searchTerm.trim().toLowerCase();
    if (!lower) return depots;
    return depots.filter(
      (d) =>
        (d.numero ?? '').toLowerCase().includes(lower) ||
        (d.client?.nom ?? '').toLowerCase().includes(lower),
    );
  }, [depots, searchTerm]);

  const totalArticles = filtered.reduce(
    (sum, d) => sum + d.articles.reduce((s, a) => s + a.quantite, 0),
    0,
  );
  const totalPieces = filtered.reduce(
    (sum, d) => sum + d.articles.reduce((s, a) => s + a.nb_pieces * a.quantite, 0),
    0,
  );
  const totalValue = filtered.reduce((sum, d) => sum + Number(d.total), 0);

  const reportData: ReportData = useMemo(() => ({
    title: lang === 'fr' ? 'Inventaire des dépôts en stock' : 'Stock inventory',
    subtitle: lang === 'fr' ? `${filtered.length} dépôt(s) — ${totalPieces} pièce(s)` : `${filtered.length} deposit(s) — ${totalPieces} item(s)`,
    entreprise,
    columns: [
      {
        key: 'numero',
        label: lang === 'fr' ? 'N° Dépôt' : 'Deposit #',
        align: 'left',
        render: (row) => String(row.numero ?? '—'),
      },
      {
        key: 'client',
        label: lang === 'fr' ? 'Client' : 'Client',
        align: 'left',
        render: (row) => String(row.client_nom ?? '—'),
      },
      {
        key: 'articles',
        label: lang === 'fr' ? 'Articles' : 'Items',
        align: 'left',
        render: (row) => String(row.articles_list ?? ''),
      },
      {
        key: 'pieces',
        label: lang === 'fr' ? 'Pièces' : 'Pieces',
        align: 'center',
        render: (row) => String(row.pieces ?? 0),
      },
      {
        key: 'date_depot',
        label: lang === 'fr' ? 'Déposé le' : 'Deposited',
        align: 'center',
        render: (row) => formatDateShort(String(row.date_depot ?? null)),
      },
      {
        key: 'retrait',
        label: lang === 'fr' ? 'Retrait prévu' : 'Pickup',
        align: 'center',
        render: (row) => formatDateShort(String(row.date_retrait_prevue ?? null)),
      },
      {
        key: 'total',
        label: lang === 'fr' ? 'Montant' : 'Amount',
        align: 'right',
        render: (row) => formatPrice(Number(row.total ?? 0)),
      },
    ],
    rows: filtered.map((d) => ({
      numero: d.numero ?? '—',
      client_nom: d.client?.nom ?? '—',
      articles_list: d.articles.map((a) => `${a.designation} (${a.nb_pieces * a.quantite})`).join(', '),
      pieces: d.articles.reduce((s, a) => s + a.nb_pieces * a.quantite, 0),
      date_depot: d.date_depot,
      date_retrait_prevue: d.date_retrait_prevue,
      total: d.total,
    })),
    summaryRows: [
      { label: lang === 'fr' ? 'Total dépôts' : 'Total deposits', value: String(filtered.length) },
      { label: lang === 'fr' ? 'Total pièces' : 'Total pieces', value: String(totalPieces) },
      { label: lang === 'fr' ? 'Valeur totale' : 'Total value', value: formatPrice(totalValue), highlight: true },
    ],
    periodLabel: lang === 'fr' ? 'Dépôts actuellement en traitement' : 'Deposits currently in processing',
  }), [filtered, entreprise, lang, totalPieces, totalValue]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-sky-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-cyan-600 flex items-center justify-center shadow-sm">
            <PackageSearch className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {lang === 'fr' ? 'Inventaire des dépôts en stock' : 'Stock inventory'}
            </h2>
            <p className="text-sm text-slate-500">
              {lang === 'fr'
                ? 'Dépôts actuellement en traitement'
                : 'Deposits currently in processing'}
            </p>
          </div>
        </div>
        {filtered.length > 0 && (
          <button
            onClick={printReport}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors shadow-sm"
          >
            <Printer className="w-4 h-4" />
            {lang === 'fr' ? 'Imprimer' : 'Print'}
          </button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 text-center">
          <div className="w-10 h-10 rounded-lg bg-sky-50 flex items-center justify-center mx-auto mb-2">
            <Boxes className="w-5 h-5 text-sky-600" />
          </div>
          <p className="text-xs text-slate-400 uppercase tracking-wide">{lang === 'fr' ? 'Dépôts' : 'Deposits'}</p>
          <p className="text-xl font-bold text-slate-900 mt-0.5">{filtered.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 text-center">
          <div className="w-10 h-10 rounded-lg bg-cyan-50 flex items-center justify-center mx-auto mb-2">
            <Shirt className="w-5 h-5 text-cyan-600" />
          </div>
          <p className="text-xs text-slate-400 uppercase tracking-wide">{lang === 'fr' ? 'Pièces' : 'Pieces'}</p>
          <p className="text-xl font-bold text-slate-900 mt-0.5">{totalPieces}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 text-center">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center mx-auto mb-2">
            <Wallet className="w-5 h-5 text-emerald-600" />
          </div>
          <p className="text-xs text-slate-400 uppercase tracking-wide">{lang === 'fr' ? 'Valeur' : 'Value'}</p>
          <p className="text-xl font-bold text-emerald-600 mt-0.5">{formatPrice(totalValue)}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder={lang === 'fr' ? 'Rechercher par numéro ou client…' : 'Search by number or client…'}
          className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white"
        />
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-10 text-center">
          <PackageSearch className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-400">
            {lang === 'fr'
              ? 'Aucun dépôt en stock actuellement.'
              : 'No deposits currently in stock.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((depot) => {
            const isExpanded = expandedId === depot.id;
            const nbArticles = depot.articles.length;
            const nbPieces = depot.articles.reduce((s, a) => s + a.nb_pieces * a.quantite, 0);
            const traitementLabel = getTraitementLabelById(depot.type_traitement_id, typesTraitement, depot.traitement);
            return (
              <div key={depot.id} className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                {/* Row header */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : depot.id)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50/50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-sky-50 flex items-center justify-center flex-shrink-0">
                      <Shirt className="w-5 h-5 text-sky-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">
                        {depot.numero ?? (lang === 'fr' ? 'Sans numéro' : 'No number')}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">
                        {depot.client?.nom ?? '—'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 flex-shrink-0">
                    <div className="hidden sm:flex flex-col items-end">
                      <span className="text-xs text-slate-400">{lang === 'fr' ? 'Pièces' : 'Pieces'}</span>
                      <span className="text-sm font-semibold text-slate-700">{nbPieces}</span>
                    </div>
                    <div className="hidden sm:flex flex-col items-end">
                      <span className="text-xs text-slate-400">{lang === 'fr' ? 'Articles' : 'Items'}</span>
                      <span className="text-sm font-semibold text-slate-700">{nbArticles}</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-xs text-slate-400">{lang === 'fr' ? 'Montant' : 'Amount'}</span>
                      <span className="text-sm font-bold text-sky-600">{formatPrice(Number(depot.total))}</span>
                    </div>
                    <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </div>
                </button>

                {/* Quick info bar */}
                <div className="px-5 py-2.5 border-t border-slate-50 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    {lang === 'fr' ? 'Déposé le' : 'Deposited'} {formatDateShort(depot.date_depot)}
                  </span>
                  {depot.date_retrait_prevue && (
                    <span className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" />
                      {lang === 'fr' ? 'Retrait prévu' : 'Pickup'} {formatDateShort(depot.date_retrait_prevue)}
                    </span>
                  )}
                  <span className="flex items-center gap-1.5">
                    <Shirt className="w-3.5 h-3.5" />
                    {traitementLabel} (×{depot.coefficient})
                  </span>
                </div>

                {/* Expanded articles */}
                {isExpanded && (
                  <div className="px-5 py-3 bg-slate-50/50 border-t border-slate-50">
                    <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2.5">
                      {lang === 'fr' ? 'Détail des articles' : 'Article details'}
                    </p>
                    <div className="space-y-2">
                      {depot.articles.map((art) => {
                        const details = [art.couleur, art.signe_particulier, art.griffe].filter(
                          (d) => d && d !== 'AUCUN',
                        );
                        return (
                          <div key={art.id} className="flex items-start justify-between gap-3 bg-white rounded-lg border border-slate-100 px-3 py-2.5">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-slate-800">{art.designation}</p>
                              <p className="text-xs text-slate-400 mt-0.5">
                                {art.quantite} × {art.nb_pieces} {lang === 'fr' ? 'pcs' : 'pcs'}
                                {details.length > 0 && ` · ${details.join(' · ')}`}
                              </p>
                            </div>
                            <span className="text-sm font-semibold text-slate-700 flex-shrink-0">
                              {formatPrice(Number(art.prix_total))}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Printable report (hidden, only for print) */}
      {filtered.length > 0 && <PrintableReport data={reportData} />}
    </div>
  );
}
