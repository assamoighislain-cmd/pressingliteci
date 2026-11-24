import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { db } from '@/lib/db';
import {
  formatDepotNumero,
  getBillingPointCode,
  getBoutiqueGeo,
  getBoutiqueReceiptHeader,
} from '@/lib/dbOfflineHelpers';
import {
  buildGoogleMapsDirectionsUrl,
  formatCoordsDisplay,
  isValidCoordinatePair,
  normalizeCoordinate,
} from '@/lib/googleMaps';
import {
  BoutiqueLocationPicker,
  BoutiquesOverviewMap,
  GoogleMapsProvider,
} from '@/components/BoutiquesMap';
import { resolveReceiptHeader, type Boutique, type Entreprise } from '@/types';
import {
  Store,
  Plus,
  Edit2,
  Trash2,
  Star,
  X,
  Loader2,
  MapPin,
  Phone,
  Building2,
  Hash,
  Navigation,
  ExternalLink,
  Crosshair,
  Receipt,
  Mail,
} from 'lucide-react';

export default function BoutiquesPage() {
  const { t, lang } = useI18n();
  const { boutiques, currentBoutique, setBoutique, reloadBoutiques, role } = useAuth();
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingBoutique, setEditingBoutique] = useState<Boutique | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counterTick, setCounterTick] = useState(0);
  const [focusedBoutiqueId, setFocusedBoutiqueId] = useState<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const mapSectionRef = useRef<HTMLDivElement | null>(null);

  const [entreprise, setEntreprise] = useState<Entreprise | null>(null);

  const [form, setForm] = useState({
    nom: '',
    adresse: '',
    ville: '',
    telephone: '',
    email: '',
    slogan: '',
    message_pied: '',
    depot_start_number: '',
    latitude: '',
    longitude: '',
  });

  const currentYear = new Date().getFullYear();
  const pointCode = getBillingPointCode();

  useEffect(() => {
    setLoading(false);
    void db.getEntreprise().then((e) => setEntreprise(e));
    const onRefreshTick = () => setCounterTick((v) => v + 1);
    window.addEventListener('pressinglite:depot-start-seq-changed', onRefreshTick);
    window.addEventListener('pressinglite:billing-point-changed', onRefreshTick);
    window.addEventListener('pressinglite:boutique-geo-changed', onRefreshTick);
    window.addEventListener('pressinglite:boutique-header-changed', onRefreshTick);
    return () => {
      window.removeEventListener('pressinglite:depot-start-seq-changed', onRefreshTick);
      window.removeEventListener('pressinglite:billing-point-changed', onRefreshTick);
      window.removeEventListener('pressinglite:boutique-geo-changed', onRefreshTick);
      window.removeEventListener('pressinglite:boutique-header-changed', onRefreshTick);
    };
  }, []);

  function resolveBoutiqueCoords(b: Boutique): { latitude: number; longitude: number } | null {
    void counterTick;
    if (isValidCoordinatePair(b.latitude, b.longitude)) {
      return { latitude: Number(b.latitude), longitude: Number(b.longitude) };
    }
    return getBoutiqueGeo(b.id);
  }

  function resolveBoutiqueStartNumber(b: Boutique): number | null {
    void counterTick;
    if (
      b.depot_start_number != null &&
      Number.isFinite(Number(b.depot_start_number)) &&
      Number(b.depot_start_number) >= 1 &&
      (!b.depot_start_year || Number(b.depot_start_year) === currentYear)
    ) {
      return Math.floor(Number(b.depot_start_number));
    }
    return db.getBoutiqueDepotStartNumber(b.id);
  }

  const boutiquesWithCoords: Boutique[] = boutiques.map((b) => {
    const coords = resolveBoutiqueCoords(b);
    const localHeader = getBoutiqueReceiptHeader(b.id);
    return {
      ...b,
      latitude: coords ? coords.latitude : null,
      longitude: coords ? coords.longitude : null,
      email: b.email ?? localHeader?.email ?? null,
      slogan: b.slogan ?? localHeader?.slogan ?? null,
      message_pied: b.message_pied ?? localHeader?.message_pied ?? null,
    };
  });

  function openCreate() {
    setEditingBoutique(null);
    setForm({
      nom: '',
      adresse: '',
      ville: '',
      telephone: '',
      email: '',
      slogan: '',
      message_pied: '',
      depot_start_number: '',
      latitude: '',
      longitude: '',
    });
    setError(null);
    setShowModal(true);
  }

  function openEdit(b: Boutique) {
    setEditingBoutique(b);
    const existingStart = resolveBoutiqueStartNumber(b);
    const existingCoords = resolveBoutiqueCoords(b);
    const localHeader = getBoutiqueReceiptHeader(b.id);
    setForm({
      nom: b.nom,
      adresse: b.adresse ?? '',
      ville: b.ville ?? '',
      telephone: b.telephone ?? '',
      email: b.email ?? localHeader?.email ?? '',
      slogan: b.slogan ?? localHeader?.slogan ?? '',
      message_pied: b.message_pied ?? localHeader?.message_pied ?? '',
      depot_start_number: existingStart !== null ? String(existingStart) : '',
      latitude: existingCoords ? String(existingCoords.latitude) : '',
      longitude: existingCoords ? String(existingCoords.longitude) : '',
    });
    setError(null);
    setShowModal(true);
  }

  function handleFocusOnMap(b: Boutique) {
    setFocusedBoutiqueId(b.id);
    setFocusNonce((n) => n + 1);
    mapSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function handleSave() {
    if (!form.nom.trim()) {
      setError(lang === 'fr' ? 'Le nom est obligatoire' : 'Name is required');
      return;
    }

    let parsedStart: number | null = null;
    const rawStart = form.depot_start_number.trim();
    if (rawStart !== '') {
      const n = parseInt(rawStart, 10);
      if (!Number.isFinite(n) || n < 1) {
        setError(
          lang === 'fr'
            ? 'Le compteur de départ doit être un entier supérieur ou égal à 1.'
            : 'Starting counter must be an integer greater than or equal to 1.',
        );
        return;
      }
      parsedStart = Math.floor(n);
    }

    const rawLat = form.latitude.trim();
    const rawLng = form.longitude.trim();
    let parsedLat: number | null = null;
    let parsedLng: number | null = null;

    if (rawLat !== '' || rawLng !== '') {
      parsedLat = normalizeCoordinate(rawLat);
      parsedLng = normalizeCoordinate(rawLng);
      if (!isValidCoordinatePair(parsedLat, parsedLng)) {
        setError(
          lang === 'fr'
            ? 'Coordonnées GPS invalides. La latitude doit être entre -90 et 90, et la longitude entre -180 et 180.'
            : 'Invalid GPS coordinates. Latitude must be between -90 and 90, and longitude between -180 and 180.',
        );
        return;
      }
    }

    setSaving(true);
    setError(null);
    try {
      if (editingBoutique) {
        const err = await db.updateBoutique(editingBoutique.id, {
          nom: form.nom.trim(),
          adresse: form.adresse.trim() || null,
          ville: form.ville.trim() || null,
          telephone: form.telephone.trim() || null,
          email: form.email.trim() || null,
          slogan: form.slogan.trim() || null,
          message_pied: form.message_pied.trim() || null,
          depot_start_number: parsedStart,
          depot_start_year: parsedStart !== null ? currentYear : null,
          latitude: parsedLat,
          longitude: parsedLng,
        });
        if (err) {
          setError(err);
          return;
        }
        if (parsedLat !== null && parsedLng !== null) {
          setFocusedBoutiqueId(editingBoutique.id);
          setFocusNonce((n) => n + 1);
        }
      } else {
        const { data: created, error: insErr } = await db.insertBoutique({
          nom: form.nom.trim(),
          adresse: form.adresse.trim() || null,
          ville: form.ville.trim() || null,
          telephone: form.telephone.trim() || null,
          email: form.email.trim() || null,
          slogan: form.slogan.trim() || null,
          message_pied: form.message_pied.trim() || null,
          depot_start_number: parsedStart,
          depot_start_year: parsedStart !== null ? currentYear : null,
          latitude: parsedLat,
          longitude: parsedLng,
        });
        if (insErr) {
          setError(insErr);
          return;
        }
        if (created?.id && parsedLat !== null && parsedLng !== null) {
          setFocusedBoutiqueId(created.id);
          setFocusNonce((n) => n + 1);
        }
      }
      await reloadBoutiques();
      setCounterTick((v) => v + 1);
      setShowModal(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(b: Boutique) {
    if (b.is_default) return;
    if (boutiques.length <= 1) return;
    const confirmMsg = lang === 'fr'
      ? `Supprimer la boutique « ${b.nom} » ? Les données associées ne seront pas supprimées mais ne seront plus liées à cette boutique.`
      : `Delete boutique "${b.nom}"? Associated data will not be deleted but will no longer be linked to this boutique.`;
    if (!window.confirm(confirmMsg)) return;
    const err = await db.deleteBoutique(b.id);
    if (err) {
      setError(err);
      return;
    }
    if (currentBoutique?.id === b.id) {
      const remaining = boutiques.filter((x) => x.id !== b.id);
      if (remaining.length > 0) setBoutique(remaining[0]);
    }
    await reloadBoutiques();
  }

  async function handleSetDefault(b: Boutique) {
    if (b.is_default) return;
    const err = await db.setDefaultBoutique(b.id);
    if (err) {
      setError(err);
      return;
    }
    await reloadBoutiques();
  }

  const parsedModalStart = parseInt(form.depot_start_number.trim(), 10);
  const validModalStart = Number.isFinite(parsedModalStart) && parsedModalStart >= 1 ? parsedModalStart : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-sky-500 animate-spin" />
      </div>
    );
  }

  return (
    <GoogleMapsProvider lang={lang}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{t('boutiques.title')}</h1>
            <p className="text-sm text-slate-500 mt-1">{t('boutiques.subtitle')}</p>
          </div>
          {role === 'admin' && (
            <button
              onClick={openCreate}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors shadow-sm flex-shrink-0"
            >
              <Plus className="w-4 h-4" />
              {t('boutiques.add')}
            </button>
          )}
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-3">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Interactive Boutiques Map */}
        <div ref={mapSectionRef}>
          <BoutiquesOverviewMap
            boutiques={boutiquesWithCoords}
            currentBoutiqueId={currentBoutique?.id ?? null}
            focusedBoutiqueId={focusedBoutiqueId}
            focusNonce={focusNonce}
            onSelectBoutique={setBoutique}
            onEditBoutique={role === 'admin' ? openEdit : undefined}
            canEdit={role === 'admin'}
            lang={lang}
          />
        </div>

        {/* Boutique cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {boutiquesWithCoords.map((b) => {
            const boutiqueStart = resolveBoutiqueStartNumber(b);
            const hasCoords = isValidCoordinatePair(b.latitude, b.longitude);
            return (
              <div
                key={b.id}
                className={`relative bg-white rounded-xl border p-5 transition-all ${
                  currentBoutique?.id === b.id
                    ? 'border-sky-300 ring-2 ring-sky-100'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                {b.is_default && (
                  <span className="absolute top-3 right-3 flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-xs text-amber-700 font-medium">
                    <Star className="w-3 h-3" />
                    {t('boutiques.default')}
                  </span>
                )}
                <div className="flex items-start gap-3 mb-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    currentBoutique?.id === b.id ? 'bg-sky-100 text-sky-600' : 'bg-slate-100 text-slate-400'
                  }`}>
                    <Store className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 pr-16">
                    <h3 className="font-semibold text-slate-900 truncate">{b.nom}</h3>
                    {b.ville && <p className="text-xs text-slate-500 mt-0.5">{b.ville}</p>}
                  </div>
                </div>

                <div className="space-y-2 text-sm text-slate-600">
                  {b.adresse && (
                    <div className="flex items-start gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
                      <span className="truncate">{b.adresse}</span>
                    </div>
                  )}
                  {b.telephone && (
                    <div className="flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <span>{b.telephone}</span>
                    </div>
                  )}

                  {/* GPS Status Row */}
                  <div className="pt-0.5">
                    {hasCoords ? (
                      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-emerald-50/80 border border-emerald-200/80 text-xs">
                        <div className="flex items-center gap-1.5 min-w-0 text-emerald-800">
                          <Navigation className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                          <span className="font-mono truncate">
                            {formatCoordsDisplay(b.latitude!, b.longitude!)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => handleFocusOnMap(b)}
                            className="px-2 py-0.5 rounded bg-white border border-emerald-200 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
                          >
                            {lang === 'fr' ? 'Carte' : 'Map'}
                          </button>
                          <a
                            href={buildGoogleMapsDirectionsUrl(b.latitude!, b.longitude!)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={lang === 'fr' ? 'Ouvrir dans Google Maps' : 'Open in Google Maps'}
                            className="p-1 rounded bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-100 transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200/70 text-xs text-slate-500">
                        <span className="inline-flex items-center gap-1.5 truncate">
                          <MapPin className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                          {lang === 'fr' ? 'Position GPS non définie' : 'No GPS location set'}
                        </span>
                        {role === 'admin' && (
                          <button
                            type="button"
                            onClick={() => openEdit(b)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-50 border border-sky-200 text-[11px] font-medium text-sky-700 hover:bg-sky-100 transition-colors flex-shrink-0"
                          >
                            <Crosshair className="w-3 h-3" />
                            {lang === 'fr' ? 'Localiser' : 'Locate'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Deposit Start Counter Badge */}
                  <div>
                    {boutiqueStart !== null ? (
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-sky-50 border border-sky-200/80 text-xs text-sky-700">
                        <Hash className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>
                          {lang === 'fr' ? `Départ ${currentYear} :` : `Start ${currentYear}:`}{' '}
                          <strong className="font-mono">
                            {formatDepotNumero(boutiqueStart, currentYear, pointCode)}
                          </strong>
                        </span>
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-50 border border-slate-200/70 text-xs text-slate-500">
                        <Hash className="w-3.5 h-3.5 flex-shrink-0 text-slate-400" />
                        <span>
                          {lang === 'fr'
                            ? `Compteur ${currentYear} : Auto (${formatDepotNumero(1, currentYear, pointCode)})`
                            : `Counter ${currentYear}: Auto (${formatDepotNumero(1, currentYear, pointCode)})`}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">
                  {currentBoutique?.id !== b.id && (
                    <button
                      onClick={() => setBoutique(b)}
                      className="flex-1 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 hover:bg-slate-100 transition-colors font-medium"
                    >
                      {t('boutiques.select')}
                    </button>
                  )}
                  {currentBoutique?.id === b.id && (
                    <span className="flex-1 text-center px-3 py-1.5 rounded-lg bg-sky-50 border border-sky-100 text-xs text-sky-700 font-medium">
                      {t('boutiques.current')}
                    </span>
                  )}
                  {role === 'admin' && (
                    <>
                      {!b.is_default && (
                        <button
                          onClick={() => handleSetDefault(b)}
                          title={t('boutiques.set_default')}
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-amber-50 hover:text-amber-600 transition-colors"
                        >
                          <Star className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => openEdit(b)}
                        title={t('common.edit')}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      {!b.is_default && boutiques.length > 1 && (
                        <button
                          onClick={() => handleDelete(b)}
                          title={t('common.delete')}
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Create/Edit modal */}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowModal(false)} />
            <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
                <h3 className="text-base font-semibold text-slate-900">
                  {editingBoutique ? t('boutiques.edit') : t('boutiques.add')}
                </h3>
                <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="px-6 py-4 space-y-3.5 overflow-y-auto flex-1">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    {t('boutiques.name')} *
                  </label>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      value={form.nom}
                      onChange={(e) => setForm({ ...form, nom: e.target.value })}
                      placeholder={t('boutiques.name_placeholder')}
                      className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    {t('boutiques.address')}
                  </label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      value={form.adresse}
                      onChange={(e) => setForm({ ...form, adresse: e.target.value })}
                      placeholder={t('boutiques.address_placeholder')}
                      className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      {t('boutiques.city')}
                    </label>
                    <input
                      type="text"
                      value={form.ville}
                      onChange={(e) => setForm({ ...form, ville: e.target.value })}
                      placeholder={t('boutiques.city_placeholder')}
                      className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      {t('boutiques.phone')}
                    </label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type="tel"
                        value={form.telephone}
                        onChange={(e) => setForm({ ...form, telephone: e.target.value })}
                        placeholder={t('boutiques.phone_placeholder')}
                        className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                </div>

                {/* Per-boutique receipt header section */}
                <div className="pt-2 border-t border-slate-100 space-y-3">
                  <div className="flex items-center gap-2">
                    <Receipt className="w-4 h-4 text-sky-600" />
                    <span className="text-sm font-semibold text-slate-800">
                      {lang === 'fr' ? 'En-tête du reçu de cette boutique' : 'Receipt header for this boutique'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {lang === 'fr'
                      ? "Le nom de cette boutique s'affiche comme nom de l'entreprise sur ses reçus, avec sa propre adresse, ville et téléphone."
                      : "This boutique's name appears as the business name on its receipts, with its own address, city, and phone."}
                  </p>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      {lang === 'fr' ? 'Email de la boutique (optionnel)' : 'Boutique email (optional)'}
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type="email"
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        placeholder={entreprise?.email || 'contact@boutique.com'}
                        className="w-full pl-10 pr-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      {lang === 'fr' ? 'Slogan en en-tête (optionnel)' : 'Receipt header slogan (optional)'}
                    </label>
                    <input
                      type="text"
                      value={form.slogan}
                      onChange={(e) => setForm({ ...form, slogan: e.target.value })}
                      placeholder={entreprise?.slogan || (lang === 'fr' ? 'Ex: Qualité et rapidité' : 'e.g. Fast & spotless')}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      {lang === 'fr' ? 'Message pied de reçu (optionnel)' : 'Receipt footer message (optional)'}
                    </label>
                    <textarea
                      rows={2}
                      value={form.message_pied}
                      onChange={(e) => setForm({ ...form, message_pied: e.target.value })}
                      placeholder={entreprise?.message_pied || (lang === 'fr' ? 'Ex: Merci de votre confiance — Retrait sous 30 jours' : 'e.g. Thank you for your trust')}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent resize-none"
                    />
                  </div>

                  {/* Live receipt header preview */}
                  {(() => {
                    const preview = resolveReceiptHeader(entreprise, {
                      id: editingBoutique?.id ?? 'preview',
                      tenant_id: editingBoutique?.tenant_id ?? '',
                      nom: form.nom,
                      adresse: form.adresse || null,
                      ville: form.ville || null,
                      telephone: form.telephone || null,
                      email: form.email || null,
                      slogan: form.slogan || null,
                      message_pied: form.message_pied || null,
                      is_default: editingBoutique?.is_default ?? false,
                      slug: null,
                      created_at: '',
                      updated_at: '',
                    });
                    return (
                      <div className="rounded-xl bg-slate-50 border border-dashed border-slate-300 p-3 text-center space-y-0.5">
                        <p className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">
                          {lang === 'fr' ? 'Aperçu en-tête du reçu' : 'Receipt header preview'}
                        </p>
                        <p className="text-sm font-bold text-slate-900">
                          {preview.nom || (lang === 'fr' ? 'Nom de la boutique' : 'Boutique name')}
                        </p>
                        {preview.telephone && (
                          <p className="text-xs text-slate-600">Tél: {preview.telephone}</p>
                        )}
                        {(preview.adresse || preview.ville) && (
                          <p className="text-xs text-slate-600">
                            {[preview.adresse, preview.ville].filter(Boolean).join(', ')}
                          </p>
                        )}
                        {preview.email && (
                          <p className="text-[11px] text-slate-500">{preview.email}</p>
                        )}
                        {preview.slogan && (
                          <p className="text-[11px] italic text-slate-500">{preview.slogan}</p>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* GPS Location Picker */}
                <BoutiqueLocationPicker
                  latitude={form.latitude}
                  longitude={form.longitude}
                  boutiqueName={form.nom}
                  lang={lang}
                  onChange={(lat, lng) => setForm((prev) => ({ ...prev, latitude: lat, longitude: lng }))}
                />

                <div className="pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <label className="block text-sm font-medium text-slate-700">
                      {lang === 'fr'
                        ? `Compteur de départ des dépôts (${currentYear})`
                        : `Starting deposit counter (${currentYear})`}
                    </label>
                    <span className="text-[11px] font-mono font-semibold text-sky-700 bg-sky-50 border border-sky-100 px-2 py-0.5 rounded">
                      {formatDepotNumero(validModalStart ?? 1, currentYear, pointCode)}
                    </span>
                  </div>
                  <div className="relative">
                    <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={form.depot_start_number}
                      onChange={(e) => setForm({ ...form, depot_start_number: e.target.value })}
                      placeholder={lang === 'fr' ? 'Automatique (001) ou ex: 150' : 'Automatic (001) or e.g. 150'}
                      className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    {lang === 'fr'
                      ? 'Propre à cette boutique. Laissez vide pour démarrer automatiquement à 001.'
                      : 'Specific to this boutique. Leave blank to start automatically at 001.'}
                  </p>
                </div>

                {error && (
                  <div className="rounded-lg bg-red-50 border border-red-200 p-3">
                    <p className="text-sm text-red-600">{error}</p>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex-shrink-0">
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2.5 rounded-lg bg-white border border-slate-200 text-sm text-slate-600 hover:bg-slate-100 transition-colors font-medium"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {t('common.save')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </GoogleMapsProvider>
  );
}
