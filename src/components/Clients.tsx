import { useState, useEffect, useCallback } from 'react';
import { db, rpc } from '@/lib/db';
import { useI18n } from '@/lib/i18n';

import { Client, formatDate, formatDateShort, formatPrice, applyPhonePrefix } from '@/types';
import type { Entreprise } from '@/types';
import {
  Search,
  UserPlus,
  Pencil,
  Trash2,
  Check,
  X,
  Users,
  Phone,
  Save,
  Percent,
  CalendarClock,
  Share2,
  Copy,
  Printer,
  Cake,
  Store,
  Globe,
} from 'lucide-react';
import ImportExcel from '@/components/ImportExcel';
import { PrintableReport, printReport, type ReportData } from '@/components/PrintableReport';

interface ClientWithLastDepot extends Client {
  dernier_depot: string | null;
  portal_code: string | null;
  fidelite_points: number;
  source?: string | null;
}

export default function Clients() {
  const { t, lang } = useI18n();
  const [clients, setClients] = useState<ClientWithLastDepot[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newNom, setNewNom] = useState('');
  const [newTel, setNewTel] = useState('');
  const [newRemise, setNewRemise] = useState('');
  const [newCondition, setNewCondition] = useState('');
  const [newDateNaissance, setNewDateNaissance] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNom, setEditNom] = useState('');
  const [editTel, setEditTel] = useState('');
  const [editRemise, setEditRemise] = useState('');
  const [editCondition, setEditCondition] = useState('');
  const [editDateNaissance, setEditDateNaissance] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [entreprise, setEntreprise] = useState<Entreprise | null>(null);

  useEffect(() => {
    db.getEntreprise().then(setEntreprise);
  }, []);

  async function handleImportClients(rows: Record<string, string | number | null>[], onProgress?: (current: number, total: number) => void): Promise<{ success: number; errors: string[] }> {
    let success = 0;
    const errors: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const nom = String(row.nom ?? '').trim();
      if (!nom) { errors.push(`Ligne: nom manquant`); onProgress?.(i + 1, rows.length); continue; }
      try {
        const { data: codeData } = await rpc<string>('generate_client_code');
        const code = codeData ?? `C-${Date.now().toString(36).toUpperCase()}`;
        const telephone = row.telephone ? applyPhonePrefix(String(row.telephone), entreprise?.phone_prefix) : null;
        const taux = row.taux_remise != null ? Number(row.taux_remise) : 0;
        const condition = row.condition_remise != null ? Number(row.condition_remise) : null;

        const result = await db.insertClient({ code, nom, telephone, taux_remise: taux, condition_remise: condition });
        if (result.error) { errors.push(`${nom}: ${result.error}`); }
        else { success++; }
      } catch (err) {
        errors.push(`${nom}: ${err instanceof Error ? err.message : 'erreur'}`);
      }
      onProgress?.(i + 1, rows.length);
    }
    if (success > 0) load();
    return { success, errors };
  }

  async function copyPortalLink(client: ClientWithLastDepot) {
    const entreprise = await db.getEntreprise();
    if (!entreprise) return;
    const portalUrl = `${window.location.origin}/#/portal/${entreprise.id}`;
    let pickupDaysLine = '';
    if (entreprise.pickup_days && entreprise.pickup_days.length > 0) {
      const dayLabelsFr: Record<string, string> = { lundi: 'Lundi', mardi: 'Mardi', mercredi: 'Mercredi', jeudi: 'Jeudi', vendredi: 'Vendredi', samedi: 'Samedi', dimanche: 'Dimanche' };
      const dayLabelsEn: Record<string, string> = { lundi: 'Monday', mardi: 'Tuesday', mercredi: 'Wednesday', jeudi: 'Thursday', vendredi: 'Friday', samedi: 'Saturday', dimanche: 'Sunday' };
      const labels = lang === 'fr' ? dayLabelsFr : dayLabelsEn;
      const days = entreprise.pickup_days.map((d) => labels[d] ?? d).join(', ');
      pickupDaysLine = lang === 'fr'
        ? `\n\n*Jours de collecte:* ${days}\nUne commande validée doit être réglée à la collecte (Wave, Orange, Moov ou espèces).`
        : `\n\n*Pickup days:* ${days}\nA validated order must be paid at pickup (Wave, Orange, Moov or cash).`;
    }
    const msg = lang === 'fr'
      ? `*${entreprise.nom}*\n\nBonjour ${client.nom},\n\nVotre code client est: ${client.portal_code}\n\nAvec votre espace client, vous pouvez:\n- Suivre l'état de vos commandes en temps réel\n- Passer de nouvelles commandes en ligne 24h/24\n- Consulter votre relevé et vos paiements\n- Demander la collecte et la livraison à domicile\n\nConnectez-vous dès maintenant pour profiter de ces avantages !${pickupDaysLine}\n\n${portalUrl}`
      : `*${entreprise.nom}*\n\nHello ${client.nom},\n\nYour client code is: ${client.portal_code}\n\nWith your client account you can:\n- Track your orders in real time\n- Place new orders online 24/7\n- View your statement and payments\n- Request home pickup and delivery\n\nLog in now to enjoy these benefits!${pickupDaysLine}\n\n${portalUrl}`;
    const waUrl = client.telephone
      ? `https://wa.me/${client.telephone.replace(/[^\d]/g, '')}?text=${encodeURIComponent(msg)}`
      : null;
    if (waUrl) {
      window.open(waUrl, '_blank');
    } else {
      await navigator.clipboard.writeText(msg);
      setCopiedId(client.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  }

  async function copyCodeOnly(client: ClientWithLastDepot) {
    const text = client.portal_code ?? '';
    await navigator.clipboard.writeText(text);
    setCopiedId(client.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  const load = useCallback(async () => {
    setLoading(true);
    const clientsData = await db.getAllClients();

    const clientIds = clientsData.map((c) => c.id);
    const [lastDepotMap, pointsMap] = await Promise.all([
      db.getLastDepotDates(clientIds),
      db.getAllClientPoints(),
    ]);

    const enriched: ClientWithLastDepot[] = clientsData.map((c) => ({
      ...c,
      portal_code: c.portal_code ?? null,
      dernier_depot: lastDepotMap[c.id]?.date ?? null,
      fidelite_points: pointsMap[c.id] ?? 0,
    }));

    setClients(enriched);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function generateClientCode(): Promise<string> {
    const { data, error } = await rpc<string>('generate_client_code');
    if (error || !data) return `C-${Date.now().toString(36).toUpperCase()}`;
    return data;
  }

  async function handleAdd() {
    if (!newNom.trim()) return;
    setError(null);
    setSaving(true);
    try {
      const code = await generateClientCode();
      const taux = parseFloat(newRemise) || 0;

      const newClient = await db.insertClient({
        code,
        nom: newNom.trim(),
        telephone: applyPhonePrefix(newTel, entreprise?.phone_prefix) || null,
        taux_remise: taux,
        condition_remise: parseFloat(newCondition) || null,
        date_naissance: newDateNaissance || null,
      });

      if (!newClient.data) {
        setError(newClient.error ?? (lang === 'fr' ? 'Erreur lors de la création du client' : 'Error creating client'));
        return;
      }

      const createdClient: ClientWithLastDepot = {
        ...newClient.data,
        portal_code: newClient.data.portal_code ?? null,
        dernier_depot: null,
        fidelite_points: 0,
      };

      setClients((prev) =>
        [...prev, createdClient].sort((a, b) =>
          a.nom.localeCompare(b.nom),
        ),
      );
      setNewNom('');
      setNewTel('');
      setNewRemise('');
      setNewCondition('');
      setNewDateNaissance('');
      setShowAdd(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de l\'ajout' : 'Error during addition'));
    } finally {
      setSaving(false);
    }
  }

  async function handleSave(id: string) {
    setError(null);
    setSaving(true);
    try {
      const taux = parseFloat(editRemise) || 0;
      const updateError = await db.updateClient(id, {
        nom: editNom.trim(),
        telephone: applyPhonePrefix(editTel, entreprise?.phone_prefix) || null,
        taux_remise: taux,
        condition_remise: parseFloat(editCondition) || null,
        date_naissance: editDateNaissance || null,
      });

      if (updateError) {
        setError(updateError);
        return;
      }

      setClients((prev) =>
        prev
          .map((c) =>
            c.id === id
              ? {
                  ...c,
                  nom: editNom.trim(),
                  telephone: applyPhonePrefix(editTel, entreprise?.phone_prefix) || null,
                  taux_remise: taux,
                  condition_remise: parseFloat(editCondition) || null,
                  date_naissance: editDateNaissance || null,
                }
              : c,
          )
          .sort((a, b) => a.nom.localeCompare(b.nom)),
      );
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de la modification' : 'Error during modification'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(lang === 'fr' ? 'Supprimer ce client ?' : 'Delete this client?')) return;
    setError(null);
    try {
      const deleteError = await db.deleteClient(id);
      if (deleteError) {
        setError(deleteError);
        return;
      }
      setClients((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de la suppression' : 'Error during deletion'));
    }
  }

  function startEdit(client: ClientWithLastDepot) {
    setEditingId(client.id);
    setEditNom(client.nom);
    setEditTel(client.telephone ?? '');
    setEditRemise(String(client.taux_remise ?? 0));
    setEditCondition(client.condition_remise != null ? String(client.condition_remise) : '');
    setEditDateNaissance(client.date_naissance ?? '');
  }

  const filtered = clients.filter((c) => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return true;
    return (
      c.nom.toLowerCase().includes(term) ||
      (c.code ?? '').toLowerCase().includes(term) ||
      (c.telephone ?? '').toLowerCase().includes(term)
    );
  });

  const reportData: ReportData = {
    title: lang === 'fr' ? 'Liste des clients' : 'Client list',
    subtitle: lang === 'fr' ? 'Annuaire clients' : 'Client directory',
    entreprise,
    columns: [
      { key: 'code', label: 'Code', align: 'left', width: '12%', render: (r) => String(r.code ?? '—') },
      { key: 'nom', label: lang === 'fr' ? 'Nom' : 'Name', align: 'left', render: (r) => String(r.nom ?? '') },
      { key: 'tel', label: lang === 'fr' ? 'Téléphone' : 'Phone', align: 'left', render: (r) => String(r.tel ?? '—') },
      { key: 'remise', label: lang === 'fr' ? 'Remise %' : 'Discount %', align: 'center', render: (r) => String(r.remise ?? '0') },
      { key: 'dernier', label: lang === 'fr' ? 'Dernier dépôt' : 'Last deposit', align: 'left', render: (r) => formatDateShort(r.dernier as string | null) },
    ],
    rows: filtered.map((c) => ({
      code: c.code,
      nom: c.nom,
      tel: c.telephone,
      remise: c.taux_remise ?? 0,
      dernier: c.dernier_depot,
    })),
    summaryRows: [
      { label: lang === 'fr' ? 'Nombre de clients' : 'Client count', value: String(filtered.length), highlight: true },
    ],
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="text-center">
        <div className="w-14 h-14 rounded-2xl bg-sky-50 flex items-center justify-center mx-auto mb-3">
          <Users className="w-7 h-7 text-sky-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">{lang === 'fr' ? 'Liste des clients' : 'Client list'}</h2>
        <p className="text-sm text-slate-500 mt-1">
          {clients.length} {lang === 'fr' ? `client${clients.length > 1 ? 's' : ''} enregistré${clients.length > 1 ? 's' : ''}` : `client${clients.length > 1 ? 's' : ''} registered`}
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 flex items-start gap-2">
          <X className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Print button */}
      {!loading && filtered.length > 0 && (
        <button
          onClick={() => printReport()}
          className="w-full py-2.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 transition-colors flex items-center justify-center gap-2"
        >
          <Printer className="w-4 h-4" /> {lang === 'fr' ? 'Imprimer la liste' : 'Print list'}
        </button>
      )}

      {/* Search + Add */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={lang === 'fr' ? 'Rechercher par nom, code ou téléphone…' : 'Search by name, code or phone…'}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
          />
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors flex-shrink-0"
        >
          <UserPlus className="w-4 h-4" /> <span className="hidden sm:inline">{lang === 'fr' ? 'Nouveau' : 'New'}</span>
        </button>
        <ImportExcel
          config={{
            entityType: 'clients',
            columns: [
              { key: 'nom', label: 'Nom', required: true, type: 'string' },
              { key: 'telephone', label: 'Téléphone', required: false, type: 'string' },
              { key: 'taux_remise', label: 'Taux remise %', required: false, type: 'number' },
              { key: 'condition_remise', label: 'Condition remise', required: false, type: 'number' },
            ],
            onImport: handleImportClients,
          }}
        />
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">{lang === 'fr' ? 'Nouveau client' : 'New client'}</h3>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={newNom}
              onChange={(e) => setNewNom(e.target.value)}
              placeholder={lang === 'fr' ? 'Nom du client *' : 'Client name *'}
              className="flex-1 px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
            />
            <input
              type="tel"
              value={newTel}
              onChange={(e) => setNewTel(e.target.value)}
              placeholder={lang === 'fr' ? 'Téléphone (optionnel)' : 'Phone (optional)'}
              className="flex-1 px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
            />
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Percent className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={newRemise}
                onChange={(e) => setNewRemise(e.target.value)}
                placeholder={lang === 'fr' ? 'Taux de remise %' : 'Discount rate %'}
                className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
              />
            </div>
            <input
              type="number"
              min="0"
              step="100"
              value={newCondition}
              onChange={(e) => setNewCondition(e.target.value)}
              placeholder={lang === 'fr' ? 'Montant min. dépôt (FCFA)' : 'Min. deposit amount (FCFA)'}
              className="flex-1 px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
            />
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Cake className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="date"
                value={newDateNaissance}
                onChange={(e) => setNewDateNaissance(e.target.value)}
                className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
              />
            </div>
            <div className="flex-1" />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setShowAdd(false);
                setNewNom('');
                setNewTel('');
                setNewRemise('');
                setNewCondition('');
                setNewDateNaissance('');
              }}
              className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleAdd}
              disabled={!newNom.trim()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="w-4 h-4" /> {t('common.save')}
            </button>
          </div>
        </div>
      )}

      {/* Client list */}
      {loading ? (
        <p className="text-sm text-slate-400 text-center py-8">{t('common.loading')}</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <Users className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-400">
            {searchTerm ? (lang === 'fr' ? 'Aucun client trouvé.' : 'No client found.') : (lang === 'fr' ? 'Aucun client enregistré pour le moment.' : 'No client registered yet.')}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="divide-y divide-slate-50">
            {filtered.map((client) => (
              <div
                key={client.id}
                className="px-5 py-3.5 flex items-center justify-between hover:bg-slate-50/50 transition-colors"
              >
                {editingId === client.id ? (
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        value={editNom}
                        onChange={(e) => setEditNom(e.target.value)}
                        className="flex-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                      />
                      <input
                        type="tel"
                        value={editTel}
                        onChange={(e) => setEditTel(e.target.value)}
                        placeholder={lang === 'fr' ? 'Téléphone' : 'Phone'}
                        className="flex-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                      />
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <div className="relative flex-1">
                        <Percent className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.5"
                          value={editRemise}
                          onChange={(e) => setEditRemise(e.target.value)}
                          placeholder={lang === 'fr' ? 'Remise %' : 'Discount %'}
                          className="w-full pl-8 pr-2.5 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                        />
                      </div>
                      <input
                        type="number"
                        min="0"
                        step="100"
                        value={editCondition}
                        onChange={(e) => setEditCondition(e.target.value)}
                        placeholder={lang === 'fr' ? 'Montant min. dépôt' : 'Min. deposit amount'}
                        className="flex-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                      />
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <div className="relative flex-1">
                        <Cake className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                        <input
                          type="date"
                          value={editDateNaissance}
                          onChange={(e) => setEditDateNaissance(e.target.value)}
                          className="w-full pl-8 pr-2.5 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                        />
                      </div>
                      <div className="flex-1" />
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleSave(client.id)}
                        className="p-1.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="p-1.5 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-sky-50 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-bold text-sky-600">
                          {(client.nom.charAt(0) + (client.nom.charAt(1) ?? '')).toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">{client.nom}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {client.code && (
                            <span className="text-xs font-medium text-sky-600 bg-sky-50 px-1.5 py-0.5 rounded">
                              {client.code}
                            </span>
                          )}
                          {client.portal_code && (
                            <button
                              onClick={() => copyCodeOnly(client)}
                              className="text-xs font-medium text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded flex items-center gap-1 hover:bg-emerald-100 transition-colors"
                              title={lang === 'fr' ? 'Copier le code client' : 'Copy client code'}
                            >
                              {copiedId === client.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                              {client.portal_code}
                            </button>
                          )}
                          {client.telephone && (
                            <span className="text-xs text-slate-400 flex items-center gap-1">
                              <Phone className="w-3 h-3" />
                              {client.telephone}
                            </span>
                          )}
                          {client.date_naissance && (
                            <span className="text-xs text-pink-500 flex items-center gap-1">
                              <Cake className="w-3 h-3" />
                              {(() => { const d = new Date(client.date_naissance); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }); })()}
                            </span>
                          )}
                          {client.source === 'portal' ? (
                            <span className="text-xs font-medium text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded flex items-center gap-1" title={lang === 'fr' ? 'Inscrit depuis le portail client' : 'Registered from client portal'}>
                              <Globe className="w-3 h-3" />
                              {lang === 'fr' ? 'Portail' : 'Portal'}
                            </span>
                          ) : (
                            <span className="text-xs font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-1" title={lang === 'fr' ? 'Créé au pressing' : 'Created at the shop'}>
                              <Store className="w-3 h-3" />
                              {lang === 'fr' ? 'Pressing' : 'Shop'}
                            </span>
                          )}
                          <span className="text-xs text-slate-300">
                            {formatDate(client.created_at)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {client.dernier_depot && (
                            <span className="text-xs text-slate-400 flex items-center gap-1">
                              <CalendarClock className="w-3 h-3" />
                              {lang === 'fr' ? 'Dernier dépôt' : 'Last deposit'}: {formatDateShort(client.dernier_depot)}
                            </span>
                          )}
                          {(client.taux_remise ?? 0) > 0 && (
                            <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded flex items-center gap-1">
                              <Percent className="w-3 h-3" />
                              {client.taux_remise}% {lang === 'fr' ? 'remise' : 'discount'}
                            </span>
                          )}
                          {(client.fidelite_points ?? 0) > 0 && (
                            <span className="text-xs font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                              {client.fidelite_points} pts
                            </span>
                          )}
                          {client.condition_remise != null && client.condition_remise > 0 && (
                            <span className="text-xs text-slate-400">
                              {lang === 'fr' ? 'dès' : 'from'} {formatPrice(client.condition_remise)} {lang === 'fr' ? 'de dépôt' : 'deposit'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-3 flex-shrink-0">
                      <button
                        onClick={() => copyPortalLink(client)}
                        title={lang === 'fr' ? 'Partager le lien WhatsApp' : 'Share WhatsApp link'}
                        className="p-2 rounded-lg text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 transition-all"
                      >
                        {copiedId === client.id ? <Check className="w-4 h-4 text-emerald-500" /> : <Share2 className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => startEdit(client)}
                        className="p-2 rounded-lg text-slate-400 hover:text-sky-500 hover:bg-sky-50 transition-all"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(client.id)}
                        className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <PrintableReport data={reportData} />
    </div>
  );
}
