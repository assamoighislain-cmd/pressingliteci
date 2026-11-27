import { useState, useEffect, useCallback } from 'react';
import { db } from '@/lib/db';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import {
  Client,
  DepotWithArticles,
  TypeTraitement,
  ModeReglement,
  ModeReglementRow,
  formatPrice,
  formatDateShort,
  getModeReglementLabel,
  getTraitementLabelById,
  buildWhatsAppUrl,
  formatEntrepriseHeader,
  resolveReceiptHeader,
} from '@/types';
import { Search, Receipt, Printer, ChevronRight, ArrowLeft, Phone, MessageCircle } from 'lucide-react';
import type { Entreprise } from '@/types';

interface ReleveRow {
  depot: DepotWithArticles;
  date: string;
  numero: string;
  traitementLibelle: string;
  nbArticles: number;
  totalPieces: number;
  montant: number;
  paye: number;
  reste: number;
}

export default function ReleveClient() {
  const { t, lang } = useI18n();
  const { currentBoutique } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [loadingClients, setLoadingClients] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [rows, setRows] = useState<ReleveRow[]>([]);
  const [typesTraitement, setTypesTraitement] = useState<TypeTraitement[]>([]);
  const [modesReglement, setModesReglement] = useState<ModeReglementRow[]>([]);
  const [loadingReleve, setLoadingReleve] = useState(false);
  const [entreprise, setEntreprise] = useState<Entreprise | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);

  const logoSrc = entreprise?.logo_url?.trim() || null;

  useEffect(() => {
    setLogoFailed(false);
    if (!logoSrc) return;
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.src = logoSrc;
  }, [logoSrc]);

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

  const searchClients = useCallback(async (term: string) => {
    if (term.trim().length < 1) {
      setClients([]);
      return;
    }
    setLoadingClients(true);
    setClients(await db.searchClients(term));
    setLoadingClients(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => searchClients(searchTerm), 250);
    return () => clearTimeout(timer);
  }, [searchTerm, searchClients]);

  async function loadReleve(client: Client) {
    setSelectedClient(client);
    setLoadingReleve(true);
    setSearchTerm('');

    const depots = await db.getDepotsForReleve(client.id);

    const releveRows: ReleveRow[] = await Promise.all(depots.map(async (depot) => {
      const totalPieces = depot.articles.reduce(
        (sum, a) => sum + (Number(a.nb_pieces) || 0) * (Number(a.quantite) || 1),
        0,
      );
      const montant = Number(depot.total);
      const avance = Number(depot.avance_amount) || 0;
      const mode = depot.mode_reglement;
      const extraAvances = await db.getAvancesForDepot(depot.id);
      const extraTotal = extraAvances.reduce((s, a) => s + Number(a.montant), 0);
      const paye = mode === 'PAYER_DEPOT' || mode === 'SOLDE' ? montant : avance + extraTotal;
      const reste = Math.max(0, montant - paye);

      const traitementLibelle = getTraitementLabelById(depot.type_traitement_id, typesTraitement, depot.traitement);

      return {
        depot,
        date: depot.date_depot,
        numero: depot.numero ?? '—',
        traitementLibelle,
        nbArticles: depot.articles.length,
        totalPieces,
        montant,
        paye,
        reste,
      };
    }));

    setRows(releveRows);
    setLoadingReleve(false);
  }

  function reset() {
    setSelectedClient(null);
    setRows([]);
    setSearchTerm('');
  }

  // ─── Account statement view ─────────────────────────────
  if (selectedClient) {
    const totalMontant = rows.reduce((s, r) => s + r.montant, 0);
    const totalPaye = rows.reduce((s, r) => s + r.paye, 0);
    const totalReste = rows.reduce((s, r) => s + r.reste, 0);
    const totalPieces = rows.reduce((s, r) => s + r.totalPieces, 0);

    return (
      <div className="max-w-4xl mx-auto space-y-5 print-releve">
        <button
          onClick={reset}
          className="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600 transition-colors no-print"
        >
          <ArrowLeft className="w-4 h-4" /> {t('retrait.backToSearch')}
        </button>

        {/* Print-only boutique receipt header */}
        {(() => {
          const releveHeader = resolveReceiptHeader(entreprise, currentBoutique);
          return (
            <div className="hidden print:block text-center mb-4 pb-2 border-b border-slate-300">
              {logoSrc && !logoFailed && (
                <img
                  src={logoSrc}
                  alt={releveHeader.nom}
                  className="mx-auto mb-2 max-h-14 max-w-[45mm] w-auto h-auto object-contain"
                  referrerPolicy="no-referrer"
                  onError={() => setLogoFailed(true)}
                />
              )}
              <p className="text-lg font-bold">{releveHeader.nom}</p>
              {releveHeader.telephone && <p className="text-sm text-slate-500">{lang === 'fr' ? 'Tél' : 'Tel'}: {releveHeader.telephone}</p>}
              {(releveHeader.adresse || releveHeader.ville) && (
                <p className="text-sm text-slate-500">{[releveHeader.adresse, releveHeader.ville].filter(Boolean).join(', ')}</p>
              )}
              {releveHeader.email && <p className="text-sm text-slate-500">{releveHeader.email}</p>}
              {releveHeader.slogan && <p className="text-sm text-slate-500 mt-1">{releveHeader.slogan}</p>}
            </div>
          );
        })()}

        {/* Client header */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="p-5 bg-gradient-to-br from-slate-800 to-slate-900">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide">{lang === 'fr' ? 'Relevé de compte' : 'Account statement'}</p>
                <h2 className="text-2xl font-bold text-white mt-1">{selectedClient.nom}</h2>
                {selectedClient.telephone && (
                  <p className="text-sm text-slate-400 mt-1 flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5" /> {selectedClient.telephone}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 no-print">
                <button
                  onClick={() => window.print()}
                  className="px-4 py-2.5 rounded-lg bg-white/10 text-white text-sm font-medium hover:bg-white/20 transition-colors flex items-center gap-2"
                >
                  <Printer className="w-4 h-4" /> {t('depot.print')}
                </button>
                {selectedClient.telephone && (() => {
                  const lignes: string[] = [];
                  const releveHeader = resolveReceiptHeader(entreprise, currentBoutique);
                  const header = formatEntrepriseHeader({
                    nom: releveHeader.nom,
                    telephone: releveHeader.telephone,
                    adresse: releveHeader.adresse,
                    ville: releveHeader.ville,
                    email: releveHeader.email,
                    slogan: releveHeader.slogan,
                  });
                  if (header.length > 0) {
                    lignes.push(...header);
                    lignes.push('');
                  }
                  lignes.push(lang === 'fr' ? '*Relevé de compte*' : '*Account statement*');
                  lignes.push(`${lang === 'fr' ? 'Client' : 'Client'}: ${selectedClient.nom}`);
                  lignes.push(`${lang === 'fr' ? 'Dépôts' : 'Deposits'}: ${rows.length}`);
                  lignes.push(`${lang === 'fr' ? 'Total pièces' : 'Total items'}: ${totalPieces}`);
                  lignes.push(`${lang === 'fr' ? 'Total montant' : 'Total amount'}: ${formatPrice(totalMontant)}`);
                  lignes.push(`${lang === 'fr' ? 'Total payé' : 'Total paid'}: ${formatPrice(totalPaye)}`);
                  lignes.push(`${lang === 'fr' ? 'Reste à payer' : 'Remaining to pay'}: ${formatPrice(totalReste)}`);
                  lignes.push('');
                  lignes.push(lang === 'fr' ? '*Détail:*' : '*Details:*');
                  for (const row of rows) {
                    lignes.push(`• ${row.numero} (${formatDateShort(row.date)}) - ${formatPrice(row.montant)} | ${lang === 'fr' ? 'Payé' : 'Paid'}: ${formatPrice(row.paye)} | ${lang === 'fr' ? 'Reste' : 'Remaining'}: ${formatPrice(row.reste)}`);
                  }
                  const waUrl = buildWhatsAppUrl(selectedClient.telephone, lignes.join('\n'));
                  return (
                    <a
                      href={waUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2.5 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 transition-colors flex items-center gap-2"
                    >
                      <MessageCircle className="w-4 h-4" /> WhatsApp
                    </a>
                  );
                })()}
              </div>
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-slate-100">
            <div className="p-4 text-center">
              <p className="text-xs text-slate-400 uppercase tracking-wide">{lang === 'fr' ? 'Dépôts' : 'Deposits'}</p>
              <p className="text-xl font-bold text-slate-900 mt-1">{rows.length}</p>
            </div>
            <div className="p-4 text-center">
              <p className="text-xs text-slate-400 uppercase tracking-wide">{lang === 'fr' ? 'Total pièces' : 'Total items'}</p>
              <p className="text-xl font-bold text-slate-900 mt-1">{totalPieces}</p>
            </div>
            <div className="p-4 text-center">
              <p className="text-xs text-slate-400 uppercase tracking-wide">{lang === 'fr' ? 'Total payé' : 'Total paid'}</p>
              <p className="text-xl font-bold text-emerald-600 mt-1">{formatPrice(totalPaye)}</p>
            </div>
            <div className="p-4 text-center">
              <p className="text-xs text-slate-400 uppercase tracking-wide">{t('retrait.remaining')}</p>
              <p className="text-xl font-bold text-red-600 mt-1">{formatPrice(totalReste)}</p>
            </div>
          </div>
        </div>

        {/* Statement table */}
        {loadingReleve ? (
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-8 text-center text-slate-400 text-sm">
            {t('common.loading')}
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-8 text-center">
            <p className="text-slate-400 text-sm">{lang === 'fr' ? 'Aucun dépôt trouvé pour ce client.' : 'No deposit found for this client.'}</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-slate-200 bg-slate-50">
                    <th className="text-left py-3 px-4 font-semibold text-slate-600 text-xs uppercase tracking-wide">
                      {lang === 'fr' ? 'Date' : 'Date'}
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-slate-600 text-xs uppercase tracking-wide">
                      {lang === 'fr' ? 'N° Dépôt' : 'Deposit No.'}
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-slate-600 text-xs uppercase tracking-wide">
                      {t('retrait.treatment')}
                    </th>
                    <th className="text-center py-3 px-4 font-semibold text-slate-600 text-xs uppercase tracking-wide">
                      {t('retrait.articles')}
                    </th>
                    <th className="text-center py-3 px-4 font-semibold text-slate-600 text-xs uppercase tracking-wide">
                      {lang === 'fr' ? 'Pièces' : 'Items'}
                    </th>
                    <th className="text-right py-3 px-4 font-semibold text-slate-600 text-xs uppercase tracking-wide">
                      {t('retrait.amount')}
                    </th>
                    <th className="text-right py-3 px-4 font-semibold text-slate-600 text-xs uppercase tracking-wide">
                      {lang === 'fr' ? 'Payé' : 'Paid'}
                    </th>
                    <th className="text-right py-3 px-4 font-semibold text-slate-600 text-xs uppercase tracking-wide">
                      {lang === 'fr' ? 'Reste' : 'Remaining'}
                    </th>
                    <th className="text-center py-3 px-4 font-semibold text-slate-600 text-xs uppercase tracking-wide">
                      {lang === 'fr' ? 'Statut' : 'Status'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <tr key={row.depot.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                        {formatDateShort(row.date)}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">
                        {row.numero}
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {row.traitementLibelle}
                      </td>
                      <td className="py-3 px-4 text-center text-slate-600">
                        {row.nbArticles}
                      </td>
                      <td className="py-3 px-4 text-center text-slate-600">
                        {row.totalPieces}
                      </td>
                      <td className="py-3 px-4 text-right font-medium text-slate-900 whitespace-nowrap">
                        {formatPrice(row.montant)}
                      </td>
                      <td className="py-3 px-4 text-right text-emerald-600 whitespace-nowrap">
                        {formatPrice(row.paye)}
                      </td>
                      <td className="py-3 px-4 text-right font-medium whitespace-nowrap">
                        {row.reste > 0 ? (
                          <span className="text-red-600">{formatPrice(row.reste)}</span>
                        ) : (
                          <span className="text-slate-300">{formatPrice(0)}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`text-xs font-medium px-2 py-1 rounded-full ${
                            row.depot.statut === 'EN_COURS'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {row.depot.statut === 'EN_COURS' ? (lang === 'fr' ? 'En cours' : 'In progress') : (lang === 'fr' ? 'Retiré' : 'Picked up')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50">
                    <td className="py-3 px-4 font-semibold text-slate-700" colSpan={4}>
                      {lang === 'fr' ? 'Totaux' : 'Totals'}
                    </td>
                    <td className="py-3 px-4 text-center font-bold text-slate-900">
                      {totalPieces}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-slate-900 whitespace-nowrap">
                      {formatPrice(totalMontant)}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-emerald-600 whitespace-nowrap">
                      {formatPrice(totalPaye)}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-red-600 whitespace-nowrap">
                      {formatPrice(totalReste)}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* Payment mode legend */}
        <div className="flex flex-wrap gap-4 text-xs text-slate-400 no-print">
          {modesReglement.map((m) => (
            <span key={m.id} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-slate-300" />
              {m.designation}
            </span>
          ))}
        </div>
      </div>
    );
  }

  // ─── Client search view ─────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="text-center">
        <div className="w-14 h-14 rounded-2xl bg-sky-50 flex items-center justify-center mx-auto mb-3">
          <Receipt className="w-7 h-7 text-sky-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">{lang === 'fr' ? 'Relevé de compte client' : 'Client account statement'}</h2>
        <p className="text-sm text-slate-500 mt-1">
          {lang === 'fr' ? 'Recherchez un client pour afficher l\'historique de ses dépôts et soldes.' : 'Search for a client to display their deposit and balance history.'}
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder={lang === 'fr' ? 'Nom du client…' : 'Client name…'}
          className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
        />
      </div>

      {loadingClients && (
        <p className="text-sm text-slate-400 text-center">{t('depot.searching')}</p>
      )}

      {!loadingClients && searchTerm && clients.length === 0 && (
        <div className="text-center py-8">
          <p className="text-sm text-slate-400">{lang === 'fr' ? `Aucun client trouvé pour « ${searchTerm} ».` : `No client found for "${searchTerm}".`}</p>
        </div>
      )}

      {!loadingClients && !searchTerm && (
        <div className="text-center py-8">
          <p className="text-sm text-slate-400">{lang === 'fr' ? 'Commencez à taper pour rechercher un client.' : 'Start typing to search for a client.'}</p>
        </div>
      )}

      {clients.length > 0 && (
        <div className="space-y-2">
          {clients.map((c) => (
            <button
              key={c.id}
              onClick={() => loadReleve(c)}
              className="w-full flex items-center justify-between p-4 rounded-xl border border-slate-100 bg-white hover:border-sky-200 hover:shadow-sm transition-all text-left group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-sky-50 flex items-center justify-center flex-shrink-0">
                  <Receipt className="w-5 h-5 text-sky-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{c.nom}</p>
                  {c.telephone && (
                    <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                      <Phone className="w-3 h-3" /> {c.telephone}
                    </p>
                  )}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-sky-400 transition-colors flex-shrink-0 ml-3" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
