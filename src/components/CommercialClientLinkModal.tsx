import { useState, useMemo } from 'react';
import { db } from '@/lib/db';
import { useI18n } from '@/lib/i18n';
import { searchClientsIndexed } from '@/lib/clientSearchIndex';
import {
  Client,
  Commercial,
  CommercialClientWithDetails,
  computeDateFinFromDays,
  formatDateShort,
} from '@/types';
import { Search, X, Check, Loader2, Calendar, Users } from 'lucide-react';

interface CommercialClientLinkModalProps {
  commerciaux: Commercial[];
  clients: Client[];
  initialCommercialId?: string;
  editingLink?: CommercialClientWithDetails | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void> | void;
}

const DURATION_PRESETS = [15, 30, 60, 90, 180, 365];

export default function CommercialClientLinkModal({
  commerciaux,
  clients,
  initialCommercialId,
  editingLink = null,
  onClose,
  onSaved,
}: CommercialClientLinkModalProps) {
  const { lang } = useI18n();
  const isEdit = Boolean(editingLink);

  const defaultCommercialId =
    editingLink?.commercial_id ||
    initialCommercialId ||
    commerciaux.find((c) => c.actif)?.id ||
    commerciaux[0]?.id ||
    '';

  const [commercialId, setCommercialId] = useState(defaultCommercialId);
  const [clientSearch, setClientSearch] = useState('');
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>(
    editingLink ? [editingLink.client_id] : [],
  );
  const [dateDebut, setDateDebut] = useState(
    editingLink?.date_debut?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  );
  const [dureeJours, setDureeJours] = useState<string>(
    String(editingLink?.duree_jours ?? 30),
  );
  const [customTaux, setCustomTaux] = useState<string>(
    editingLink?.taux_commission != null ? String(editingLink.taux_commission) : '',
  );
  const [actif, setActif] = useState<boolean>(editingLink?.actif ?? true);
  const [notes, setNotes] = useState<string>(editingLink?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCommercial = useMemo(
    () => commerciaux.find((c) => c.id === commercialId) ?? null,
    [commerciaux, commercialId],
  );

  const parsedDays = Math.max(1, Math.min(3650, parseInt(dureeJours, 10) || 1));
  const computedDateFin = useMemo(
    () => computeDateFinFromDays(dateDebut, parsedDays),
    [dateDebut, parsedDays],
  );

  const visibleClients = useMemo(() => {
    if (isEdit) return [];
    const term = clientSearch.trim();
    if (!term) return clients.slice(0, 40);
    return searchClientsIndexed(clients, term, 50);
  }, [clients, clientSearch, isEdit]);

  const selectedClientsMap = useMemo(() => {
    const m = new Map<string, Client>();
    if (selectedClientIds.length === 0) return m;
    const wanted = new Set(selectedClientIds);
    for (const c of clients) {
      if (wanted.has(c.id)) m.set(c.id, c);
    }
    return m;
  }, [clients, selectedClientIds]);

  function toggleClient(id: string) {
    setError(null);
    setSelectedClientIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!commercialId) {
      setError(lang === 'fr' ? 'Veuillez choisir un commercial.' : 'Please select a sales agent.');
      return;
    }

    if (!dateDebut || !/^\d{4}-\d{2}-\d{2}/.test(dateDebut)) {
      setError(lang === 'fr' ? 'Veuillez choisir une date de début valide.' : 'Please select a valid start date.');
      return;
    }

    const days = parseInt(dureeJours, 10);
    if (!Number.isFinite(days) || days < 1 || days > 3650) {
      setError(
        lang === 'fr'
          ? 'La durée doit être comprise entre 1 et 3650 jours.'
          : 'Duration must be between 1 and 3650 days.',
      );
      return;
    }

    let parsedCustomTaux: number | null = null;
    if (customTaux.trim() !== '') {
      const n = parseFloat(customTaux);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        setError(lang === 'fr' ? 'Taux personnalisé invalide (0 à 100 %).' : 'Invalid custom rate (0–100%).');
        return;
      }
      parsedCustomTaux = n;
    }

    if (!isEdit && selectedClientIds.length === 0) {
      setError(
        lang === 'fr'
          ? 'Sélectionnez au moins un client à rattacher.'
          : 'Please select at least one client to link.',
      );
      return;
    }

    setSaving(true);
    try {
      const dateFin = computeDateFinFromDays(dateDebut, days);
      if (isEdit && editingLink) {
        const err = await db.updateCommercialClient(editingLink.id, {
          commercial_id: commercialId,
          date_debut: dateDebut,
          duree_jours: days,
          date_fin: dateFin,
          taux_commission: parsedCustomTaux,
          actif,
          notes,
        });
        if (err) {
          setError(err);
          return;
        }
        await onSaved(
          lang === 'fr'
            ? `Période mise à jour pour ${editingLink.client_nom} (jusqu'au ${formatDateShort(dateFin)}).`
            : `Period updated for ${editingLink.client_nom} (until ${formatDateShort(dateFin)}).`,
        );
        onClose();
        return;
      }

      const res = await db.insertCommercialClientsBulk(
        selectedClientIds.map((cid) => ({
          commercial_id: commercialId,
          client_id: cid,
          date_debut: dateDebut,
          duree_jours: days,
          date_fin: dateFin,
          taux_commission: parsedCustomTaux,
          actif: true,
          notes,
        })),
      );
      if (res.error) {
        setError(res.error);
        return;
      }
      await onSaved(
        lang === 'fr'
          ? `${res.count} client${res.count > 1 ? 's' : ''} lié${res.count > 1 ? 's' : ''} à ${selectedCommercial?.nom ?? ''} pour ${days} jours (jusqu'au ${formatDateShort(dateFin)}).`
          : `${res.count} client(s) linked to ${selectedCommercial?.nom ?? ''} for ${days} days (until ${formatDateShort(dateFin)}).`,
      );
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : (lang === 'fr' ? 'Erreur lors de la liaison des clients.' : 'Failed to link clients.'),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
        onClick={() => !saving && onClose()}
      />
      <form
        onSubmit={handleSubmit}
        noValidate
        className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              {isEdit
                ? (lang === 'fr' ? `Modifier le rattachement — ${editingLink?.client_nom}` : `Edit assignment — ${editingLink?.client_nom}`)
                : (lang === 'fr' ? 'Lier des clients à un commercial' : 'Link clients to a sales agent')}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {lang === 'fr'
                ? 'Toutes les factures du client sur cette période génèrent une commission.'
                : 'All client invoices within this period automatically earn commission.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => !saving && onClose()}
            className="text-slate-400 hover:text-slate-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-4">

          {/* Commercial selector */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {lang === 'fr' ? 'Commercial' : 'Sales agent'} *
            </label>
            <select
              required
              value={commercialId}
              onChange={(e) => setCommercialId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="">{lang === 'fr' ? '— Choisir un commercial —' : '— Select an agent —'}</option>
              {commerciaux.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nom} ({c.taux_commission} %){!c.actif ? ' — inactif' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Multi-client selector (create mode only) */}
          {!isEdit && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-slate-400" />
                  {lang === 'fr' ? 'Clients à rattacher' : 'Clients to link'} *
                </label>
                <span className="text-xs font-medium text-sky-700 tabular-nums">
                  {selectedClientIds.length}{' '}
                  {lang === 'fr' ? 'sélectionné(s)' : 'selected'}
                </span>
              </div>

              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  placeholder={lang === 'fr' ? 'Rechercher par nom, code client ou téléphone…' : 'Search by name, code, or phone…'}
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              {selectedClientIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {selectedClientIds.map((id) => {
                    const cl = selectedClientsMap.get(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => toggleClient(id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-sky-50 border border-sky-200 text-xs font-medium text-sky-800 hover:bg-sky-100"
                      >
                        <span className="truncate max-w-[160px]">{cl?.nom ?? id}</span>
                        <X className="w-3 h-3 text-sky-600" />
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="border border-slate-200 rounded-lg max-h-48 overflow-y-auto divide-y divide-slate-100">
                {visibleClients.length === 0 ? (
                  <p className="p-4 text-xs text-slate-400 text-center">
                    {lang === 'fr' ? 'Aucun client trouvé.' : 'No clients found.'}
                  </p>
                ) : (
                  visibleClients.map((c) => {
                    const checked = selectedClientIds.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => toggleClient(c.id)}
                        className={`w-full px-3 py-2 flex items-center justify-between gap-2 text-left text-sm transition-colors ${
                          checked ? 'bg-sky-50/80' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900 truncate">{c.nom}</p>
                          <p className="text-xs text-slate-500 truncate">
                            {[c.code, c.telephone].filter(Boolean).join(' · ') || '—'}
                          </p>
                        </div>
                        <span
                          className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 ${
                            checked
                              ? 'bg-sky-600 border-sky-600 text-white'
                              : 'border-slate-300 bg-white'
                          }`}
                        >
                          {checked && <Check className="w-3.5 h-3.5" />}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
              {!clientSearch.trim() && clients.length > 40 && (
                <p className="text-xs text-slate-400">
                  {lang === 'fr'
                    ? `40 premiers clients affichés sur ${clients.length.toLocaleString('fr-FR')} — tapez un nom, code ou téléphone pour filtrer instantanément.`
                    : `Showing first 40 of ${clients.length} clients — type to filter instantly.`}
                </p>
              )}
            </div>
          )}

          {/* Start Date & Duration in days */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {lang === 'fr' ? 'Date de début' : 'Start date'} *
              </label>
              <input
                type="date"
                required
                value={dateDebut}
                onChange={(e) => setDateDebut(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {lang === 'fr' ? 'Durée (en jours)' : 'Duration (days)'} *
              </label>
              <input
                type="number"
                required
                min={1}
                max={3650}
                step={1}
                value={dureeJours}
                onChange={(e) => setDureeJours(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>

          {/* Quick day presets */}
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {DURATION_PRESETS.map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setDureeJours(String(days))}
                  className={`px-2.5 py-1 rounded-md border text-xs font-medium tabular-nums transition-colors ${
                    parsedDays === days
                      ? 'bg-slate-900 border-slate-900 text-white'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {days} {lang === 'fr' ? 'j' : 'd'}
                </button>
              ))}
              {isEdit && (
                <button
                  type="button"
                  onClick={() => setDureeJours(String(Math.min(3650, parsedDays + 30)))}
                  className="px-2.5 py-1 rounded-md border border-emerald-200 bg-emerald-50 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 tabular-nums"
                >
                  +30 {lang === 'fr' ? 'jours' : 'days'}
                </button>
              )}
            </div>

            <div className="rounded-lg bg-slate-50 border border-slate-200/80 px-3 py-2 text-xs text-slate-600 flex items-center gap-2 tabular-nums">
              <Calendar className="w-3.5 h-3.5 text-sky-600 flex-shrink-0" />
              <span>
                {lang === 'fr' ? 'Période de commission : ' : 'Commission window: '}
                <strong className="text-slate-900">{formatDateShort(dateDebut)}</strong> →{' '}
                <strong className="text-slate-900">{formatDateShort(computedDateFin)}</strong> ({parsedDays}{' '}
                {lang === 'fr' ? 'jours' : 'days'})
              </span>
            </div>
          </div>

          {/* Optional rate override */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {lang === 'fr' ? 'Taux spécifique (% — optionnel)' : 'Custom rate (% — optional)'}
              </label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={customTaux}
                onChange={(e) => setCustomTaux(e.target.value)}
                placeholder={
                  selectedCommercial
                    ? `${lang === 'fr' ? 'Par défaut' : 'Default'} : ${selectedCommercial.taux_commission} %`
                    : 'Ex: 10'
                }
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {lang === 'fr' ? 'Note (optionnel)' : 'Note (optional)'}
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={lang === 'fr' ? 'Ex: Contrat prospection' : 'Ex: Referral agreement'}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>

          {isEdit && (
            <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={actif}
                onChange={(e) => setActif(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
              />
              <span>
                {lang === 'fr'
                  ? 'Rattachement actif (désactivez pour suspendre sans supprimer)'
                  : 'Active assignment (uncheck to pause without deleting)'}
              </span>
            </label>
          )}
        </div>

        {error && (
          <div
            role="alert"
            className="mx-6 mb-3 rounded-lg bg-red-50 border border-red-200 px-3.5 py-2.5 text-sm text-red-700 flex items-start justify-between gap-2"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-red-400 hover:text-red-600 flex-shrink-0"
              aria-label={lang === 'fr' ? 'Fermer' : 'Dismiss'}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/70 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm font-medium hover:bg-slate-50"
          >
            {lang === 'fr' ? 'Annuler' : 'Cancel'}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 px-4 py-2 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEdit
              ? (lang === 'fr' ? 'Enregistrer la période' : 'Save period')
              : (lang === 'fr'
                  ? `Lier ${selectedClientIds.length > 0 ? `(${selectedClientIds.length})` : ''}`
                  : `Link ${selectedClientIds.length > 0 ? `(${selectedClientIds.length})` : ''}`)}
          </button>
        </div>
      </form>
    </div>
  );
}
