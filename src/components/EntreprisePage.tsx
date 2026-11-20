import { useState, useEffect } from 'react';
import { db } from '@/lib/db';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { Entreprise } from '@/types';
import { Building2, Save, Check, Share2, ExternalLink, Truck, Phone, Filter, LayoutDashboard, MapPin, Navigation, Loader2, QrCode, Printer, Download, Upload, Trash2, Image as ImageIcon, Tags, Usb, Plug, Monitor } from 'lucide-react';
import QRCode from 'qrcode';
import QRCodeImage from '@/components/QRCodeImage';
import { supabase } from '@/lib/supabase';
import { isSerialSupported, connectSerialPrinter, disconnectSerialPrinter, isPrinterConnected, printTestLabel } from '@/lib/serialPrinter';
import {
  getBillingPointCode,
  setBillingPointCode,
  formatDepotNumero,
  formatClientCode,
  normalizeBillingPointCode,
} from '@/lib/dbOfflineHelpers';

export default function EntreprisePage() {
  const { user, currentBoutique, reloadBoutiques } = useAuth();
  const { t, lang } = useI18n();
  const [entreprise, setEntreprise] = useState<Entreprise | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nom, setNom] = useState('');
  const [adresse, setAdresse] = useState('');
  const [ville, setVille] = useState('');
  const [telephone, setTelephone] = useState('');
  const [email, setEmail] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [slogan, setSlogan] = useState('');
  const [messagePied, setMessagePied] = useState('');
  const [pickupDays, setPickupDays] = useState<string[]>([]);
  const [phonePrefix, setPhonePrefix] = useState('+225');
  const [filtersCommercial, setFiltersCommercial] = useState<string[]>(['today']);
  const [filtersGerant, setFiltersGerant] = useState<string[]>(['today']);
  const [fidelitePerUnit, setFidelitePerUnit] = useState(1);
  const [fideliteThreshold, setFideliteThreshold] = useState(100);
  const [fideliteRedeemValue, setFideliteRedeemValue] = useState(1000);
  const [dashboardRoles, setDashboardRoles] = useState<string[]>(['gerant', 'commercial']);
  const [deliveryBaseFee, setDeliveryBaseFee] = useState(0);
  const [deliveryPricePerKm, setDeliveryPricePerKm] = useState(0);
  const [deliveryLat, setDeliveryLat] = useState('');
  const [deliveryLng, setDeliveryLng] = useState('');
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [labelFields, setLabelFields] = useState<string[]>(['date_depot', 'numero', 'client_nom', 'date_retrait', 'piece_number', 'designation']);
  const [printerType, setPrinterType] = useState<'browser' | 'serial'>('browser');
  const [printerName, setPrinterName] = useState('');
  const [baudRate, setBaudRate] = useState(9600);
  const [serialConnecting, setSerialConnecting] = useState(false);
  const [serialConnected, setSerialConnected] = useState(false);
  const [serialError, setSerialError] = useState<string | null>(null);
  const [billingPointCode, setBillingPointCodeState] = useState<string>(() => getBillingPointCode());
  const [depotStartSeq, setDepotStartSeqState] = useState<number | null>(() => db.getDepotStartNumber());
  const [startSeqInput, setStartSeqInput] = useState<string>(() => {
    const s = db.getDepotStartNumber();
    return s !== null ? String(s) : '';
  });
  const [startSeqSaved, setStartSeqSaved] = useState(false);
  const [nextDepotPreview, setNextDepotPreview] = useState<string>('');

  const refreshNumberingPreview = () => {
    const currentStart = db.getDepotStartNumber();
    setDepotStartSeqState(currentStart);
    setStartSeqInput(currentStart !== null ? String(currentStart) : '');
    void db.previewNextDepotNumero().then((p) => setNextDepotPreview(p));
  };

  useEffect(() => {
    refreshNumberingPreview();
    const onSyncChange = () => {
      setBillingPointCodeState(getBillingPointCode());
      refreshNumberingPreview();
    };
    window.addEventListener('pressinglite:billing-point-changed', onSyncChange);
    window.addEventListener('pressinglite:depot-start-seq-changed', onSyncChange);
    window.addEventListener('pressinglite:boutique-changed', onSyncChange);
    return () => {
      window.removeEventListener('pressinglite:billing-point-changed', onSyncChange);
      window.removeEventListener('pressinglite:depot-start-seq-changed', onSyncChange);
      window.removeEventListener('pressinglite:boutique-changed', onSyncChange);
    };
  }, [currentBoutique?.id]);

  useEffect(() => {
    (async () => {
      try {
        const e = await db.getEntreprise();
        if (e) {
          setEntreprise(e);
          setNom(e.nom);
          setAdresse(e.adresse ?? '');
          setVille(e.ville ?? '');
          setTelephone(e.telephone ?? '');
          setEmail(e.email ?? '');
          setLogoUrl(e.logo_url ?? '');
          setSlogan(e.slogan ?? '');
          setMessagePied(e.message_pied ?? '');
          setPickupDays(e.pickup_days ?? []);
          setPhonePrefix(e.phone_prefix ?? '+225');
          setFiltersCommercial(e.hist_filters_commercial ?? ['today']);
          setFiltersGerant(e.hist_filters_gerant ?? ['today']);
          setFidelitePerUnit(e.fidelite_points_per_unit ?? 1);
          setFideliteThreshold(e.fidelite_redeem_threshold ?? 100);
          setFideliteRedeemValue(e.fidelite_redeem_value ?? 1000);
          setDashboardRoles(e.dashboard_visible_roles ?? ['gerant', 'commercial']);
          setDeliveryBaseFee(e.delivery_base_fee ?? 0);
          setDeliveryPricePerKm(e.delivery_price_per_km ?? 0);
          setDeliveryLat(e.delivery_latitude != null ? String(e.delivery_latitude) : '');
          setDeliveryLng(e.delivery_longitude != null ? String(e.delivery_longitude) : '');
          setLabelFields(e.label_fields ?? ['date_depot', 'numero', 'client_nom', 'date_retrait', 'piece_number', 'designation']);
          setPrinterType((e.label_printer_type as 'browser' | 'serial') ?? 'browser');
          setPrinterName(e.label_printer_name ?? '');
          setBaudRate(e.label_printer_config?.baudRate ?? 9600);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur de chargement' : 'Loading error'));
      }
      setLoading(false);
    })();
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const payload = {
        nom: nom.trim() || 'PressingLite',
        adresse: adresse.trim() || null,
        ville: ville.trim() || null,
        telephone: telephone.trim() || null,
        email: email.trim() || null,
        logo_url: logoUrl.trim() || null,
        slogan: slogan.trim() || null,
        message_pied: messagePied.trim() || null,
        pickup_days: pickupDays,
        phone_prefix: phonePrefix.trim() || '+225',
        hist_filters_commercial: filtersCommercial,
        hist_filters_gerant: filtersGerant,
        fidelite_points_per_unit: fidelitePerUnit,
        fidelite_redeem_threshold: fideliteThreshold,
        fidelite_redeem_value: fideliteRedeemValue,
        dashboard_visible_roles: dashboardRoles,
        delivery_base_fee: deliveryBaseFee,
        delivery_price_per_km: deliveryPricePerKm,
        delivery_latitude: deliveryLat.trim() ? parseFloat(deliveryLat) : null,
        delivery_longitude: deliveryLng.trim() ? parseFloat(deliveryLng) : null,
        label_fields: labelFields,
        label_printer_type: printerType,
        label_printer_name: printerName.trim() || null,
        label_printer_config: { baudRate },
        updated_at: new Date().toISOString(),
      };

      const upsertError = await db.upsertEntreprise(payload, user?.id);

      if (upsertError) {
        setError(upsertError);
        return;
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de l\'enregistrement' : 'Error during saving'));
    } finally {
      setSaving(false);
    }
  }

  const [portalCopied, setPortalCopied] = useState(false);
  const [qrDownloading, setQrDownloading] = useState(false);

  async function copyPortalLink() {
    if (!entreprise) return;
    const url = `${window.location.origin}/#/portal/${entreprise.id}`;
    await navigator.clipboard.writeText(url);
    setPortalCopied(true);
    setTimeout(() => setPortalCopied(false), 2000);
  }

  async function downloadQrImage() {
    if (!entreprise) return;
    setQrDownloading(true);
    try {
      const url = `${window.location.origin}/#/portal/${entreprise.id}`;
      const dataUrl = await QRCode.toDataURL(url, {
        width: 1024,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      });
      const link = document.createElement('a');
      const safeName = entreprise.nom.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      link.download = `qr_portail_${safeName}.png`;
      link.href = dataUrl;
      link.click();
    } catch {
      // ignore
    } finally {
      setQrDownloading(false);
    }
  }

  async function handleLogoUpload(file: File) {
    if (!entreprise) return;
    setLogoError(null);
    setLogoUploading(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
      const filePath = `${entreprise.user_id ?? entreprise.id}/logo.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('logos')
        .upload(filePath, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('logos').getPublicUrl(filePath);
      const url = `${pub.publicUrl}?t=${Date.now()}`;
      setLogoUrl(url);
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : (lang === 'fr' ? 'Échec du téléversement' : 'Upload failed'));
    } finally {
      setLogoUploading(false);
    }
  }

  async function handleLogoRemove() {
    setLogoUrl('');
    setLogoError(null);
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto">
        <p className="text-sm text-slate-400 text-center">{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="text-center">
        <div className="w-14 h-14 rounded-2xl bg-sky-50 flex items-center justify-center mx-auto mb-3">
          <Building2 className="w-7 h-7 text-sky-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">{lang === 'fr' ? "Informations de l'entreprise" : 'Company information'}</h2>
        <p className="text-sm text-slate-500 mt-1">
          {lang === 'fr' ? "Ces informations apparaissent sur les reçus imprimés et dans l'en-tête de l'application." : 'This information appears on printed receipts and in the application header.'}
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            {lang === 'fr' ? "Nom de l'entreprise" : 'Company name'} *
          </label>
          <input
            type="text"
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            placeholder={lang === 'fr' ? 'Ex: PressingLite' : 'Ex: PressingLite'}
            className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            {lang === 'fr' ? 'Slogan' : 'Slogan'}
          </label>
          <input
            type="text"
            value={slogan}
            onChange={(e) => setSlogan(e.target.value)}
            placeholder={lang === 'fr' ? 'Ex: Votre pressing de confiance' : 'Ex: Your trusted dry cleaner'}
            className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            {lang === 'fr' ? 'Adresse' : 'Address'}
          </label>
          <input
            type="text"
            value={adresse}
            onChange={(e) => setAdresse(e.target.value)}
            placeholder={lang === 'fr' ? 'Ex: Rue 12, Dakar' : 'Ex: 12 Street, Dakar'}
            className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              {lang === 'fr' ? 'Ville' : 'City'}
            </label>
            <input
              type="text"
              value={ville}
              onChange={(e) => setVille(e.target.value)}
              placeholder={lang === 'fr' ? 'Ex: Dakar' : 'Ex: Dakar'}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              {t('auth.phone')}
            </label>
            <input
              type="tel"
              value={telephone}
              onChange={(e) => setTelephone(e.target.value)}
              placeholder={lang === 'fr' ? 'Ex: 33 123 45 67' : 'Ex: 33 123 45 67'}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            {t('auth.email')}
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={lang === 'fr' ? 'Ex: contact@pressinglite.com' : 'Ex: contact@pressinglite.com'}
            className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            {lang === 'fr' ? 'Logo' : 'Logo'}
          </label>
          <p className="text-xs text-slate-400 mb-3">
            {lang === 'fr' ? 'Importez une image (PNG, JPG) — elle apparaîtra sur les reçus et dans l\'en-tête.' : 'Upload an image (PNG, JPG) — it will appear on receipts and in the header.'}
          </p>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="w-20 h-20 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden flex-shrink-0">
              {logoUploading ? (
                <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
              ) : logoUrl ? (
                <img src={logoUrl} alt="Logo" className="w-full h-full object-contain" />
              ) : (
                <ImageIcon className="w-8 h-8 text-slate-300" />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="cursor-pointer px-4 py-2.5 rounded-lg bg-sky-50 border border-sky-200 text-sky-600 text-sm font-medium hover:bg-sky-100 transition-colors flex items-center gap-2">
                {logoUploading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                {lang === 'fr' ? 'Importer' : 'Upload'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="hidden"
                  disabled={logoUploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleLogoUpload(f);
                    e.target.value = '';
                  }}
                />
              </label>
              {logoUrl && (
                <button
                  type="button"
                  onClick={handleLogoRemove}
                  className="px-4 py-2.5 rounded-lg border border-slate-200 text-slate-500 text-sm font-medium hover:bg-slate-50 transition-colors flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" /> {lang === 'fr' ? 'Retirer' : 'Remove'}
                </button>
              )}
            </div>
          </div>
          {logoError && (
            <p className="text-xs text-red-500 mt-2">{logoError}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            {lang === 'fr' ? 'Message en pied de reçu' : 'Receipt footer message'}
          </label>
          <p className="text-xs text-slate-400 mb-2">
            {lang === 'fr' ? "Texte affiché en bas de chaque reçu imprimé. Laissez vide pour le message par défaut." : 'Text shown at the bottom of each printed receipt. Leave empty for the default message.'}
          </p>
          <textarea
            value={messagePied}
            onChange={(e) => setMessagePied(e.target.value)}
            rows={2}
            placeholder={lang === 'fr' ? 'Ex: Merci de votre confiance — Conservez ce reçu pour le retrait' : 'Ex: Thank you for your trust — Keep this receipt for pickup'}
            className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent resize-none"
          />
        </div>

        {/* Loyalty / Fidelity config */}
        <div className="border-t border-slate-100 pt-5 mt-2">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">
            {lang === 'fr' ? 'Programme de fidélité' : 'Loyalty program'}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {lang === 'fr' ? 'Points par 1000 F' : 'Points per 1000 F'}
              </label>
              <input
                type="number"
                min={0}
                value={fidelitePerUnit}
                onChange={(e) => setFidelitePerUnit(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {lang === 'fr' ? 'Seuil échange (pts)' : 'Redeem threshold (pts)'}
              </label>
              <input
                type="number"
                min={1}
                value={fideliteThreshold}
                onChange={(e) => setFideliteThreshold(parseInt(e.target.value) || 1)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {lang === 'fr' ? 'Valeur échange (F)' : 'Redeem value (F)'}
              </label>
              <input
                type="number"
                min={0}
                value={fideliteRedeemValue}
                onChange={(e) => setFideliteRedeemValue(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
              />
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-2">
            {lang === 'fr'
              ? `Le client gagne ${fidelitePerUnit} point(s) par tranche de 1 000 F dépensée. À ${fideliteThreshold} points, il peut échanger contre ${fideliteRedeemValue} F de remise.`
              : `Client earns ${fidelitePerUnit} point(s) per 1,000 F spent. At ${fideliteThreshold} points, they can redeem for ${fideliteRedeemValue} F discount.`}
          </p>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-3">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-lg bg-sky-500 text-white font-medium text-sm hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {lang === 'fr' ? 'Enregistrement…' : 'Saving…'}
              </>
            ) : (
              <>
                <Save className="w-4 h-4" /> {t('common.save')}
              </>
            )}
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium">
              <Check className="w-4 h-4" /> {lang === 'fr' ? 'Enregistré' : 'Saved'}
            </span>
          )}
        </div>
      </div>

      {/* Phone prefix configuration */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-9 h-9 rounded-lg bg-sky-50 flex items-center justify-center">
            <Phone className="w-4.5 h-4.5 text-sky-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {lang === 'fr' ? 'Préfixe téléphonique par défaut' : 'Default phone prefix'}
            </p>
            <p className="text-xs text-slate-400">
              {lang === 'fr'
                ? "Indicatif pays ajouté automatiquement aux numéros de clients saisis sans indicatif (ex: +225 pour la Côte d'Ivoire, +221 pour le Sénégal)."
                : 'Country code automatically added to client phone numbers entered without a prefix (ex: +225 for Ivory Coast, +221 for Senegal).'}
            </p>
          </div>
        </div>
        <input
          type="text"
          value={phonePrefix}
          onChange={(e) => setPhonePrefix(e.target.value)}
          placeholder="+225"
          className="w-32 px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
        />
      </div>

      {/* Pickup days configuration */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center">
            <Truck className="w-4.5 h-4.5 text-amber-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {lang === 'fr' ? 'Jours de collecte à domicile' : 'Home pickup days'}
            </p>
            <p className="text-xs text-slate-400">
              {lang === 'fr'
                ? "Définissez les jours où votre entreprise peut aller chercher les linges chez les clients."
                : 'Set the days your company can pick up items from clients\' homes.'}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
          {(lang === 'fr'
            ? ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
            : ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
          ).map((day, i) => {
            const dayFr = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'][i];
            const isActive = pickupDays.includes(dayFr);
            return (
              <button
                key={dayFr}
                onClick={() => {
                  setPickupDays((prev) =>
                    prev.includes(dayFr) ? prev.filter((d) => d !== dayFr) : [...prev, dayFr],
                  );
                }}
                className={`px-2 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
                    : 'bg-white border-slate-200 text-slate-500 hover:border-amber-200 hover:bg-amber-50/50'
                }`}
              >
                {day}
              </button>
            );
          })}
        </div>
        {pickupDays.length === 0 && (
          <p className="text-xs text-slate-400 mt-3">
            {lang === 'fr'
              ? 'Aucun jour défini — la collecte à domicile ne sera pas proposée aux clients.'
              : 'No days set — home pickup will not be offered to clients.'}
          </p>
        )}
      </div>

      {/* Delivery fee configuration */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-9 h-9 rounded-lg bg-sky-50 flex items-center justify-center">
            <Truck className="w-4.5 h-4.5 text-sky-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {lang === 'fr' ? 'Frais de livraison' : 'Delivery fees'}
            </p>
            <p className="text-xs text-slate-400">
              {lang === 'fr'
                ? "Les frais sont calculés automatiquement selon la distance entre votre pressing et l'adresse du client."
                : 'Fees are calculated automatically based on the distance between your shop and the client address.'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              {lang === 'fr' ? 'Frais de base (FCFA)' : 'Base fee (FCFA)'}
            </label>
            <input
              type="number"
              min={0}
              value={deliveryBaseFee}
              onChange={(e) => setDeliveryBaseFee(parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              {lang === 'fr' ? 'Prix par km (FCFA)' : 'Price per km (FCFA)'}
            </label>
            <input
              type="number"
              min={0}
              value={deliveryPricePerKm}
              onChange={(e) => setDeliveryPricePerKm(parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              {lang === 'fr' ? 'Latitude du pressing' : 'Shop latitude'}
            </label>
            <input
              type="text"
              value={deliveryLat}
              onChange={(e) => setDeliveryLat(e.target.value)}
              placeholder="Ex: 5.3600"
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              {lang === 'fr' ? 'Longitude du pressing' : 'Shop longitude'}
            </label>
            <input
              type="text"
              value={deliveryLng}
              onChange={(e) => setDeliveryLng(e.target.value)}
              placeholder="Ex: -4.0083"
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
            />
          </div>
        </div>

        <button
          onClick={() => {
            setGpsLoading(true);
            setGpsError(null);
            if (!navigator.geolocation) {
              setGpsError(lang === 'fr' ? 'Géolocalisation non supportée par votre navigateur.' : 'Geolocation not supported by your browser.');
              setGpsLoading(false);
              return;
            }
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                setDeliveryLat(pos.coords.latitude.toFixed(6));
                setDeliveryLng(pos.coords.longitude.toFixed(6));
                setGpsLoading(false);
              },
              () => {
                setGpsError(lang === 'fr' ? 'Impossible d\'obtenir votre position. Vérifiez les autorisations.' : 'Could not get your location. Check permissions.');
                setGpsLoading(false);
              },
              { enableHighAccuracy: true, timeout: 10000 }
            );
          }}
          disabled={gpsLoading}
          className="mt-3 px-3 py-2.5 rounded-lg bg-sky-50 border border-sky-200 text-sky-600 text-sm font-medium hover:bg-sky-100 transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {gpsLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Navigation className="w-4 h-4" />
          )}
          {lang === 'fr' ? 'Récupérer ma position GPS' : 'Get my GPS location'}
        </button>
        {gpsError && (
          <p className="text-xs text-red-500 mt-1.5">{gpsError}</p>
        )}
        {deliveryLat && deliveryLng && !gpsError && (
          <p className="text-xs text-emerald-600 mt-1.5 flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5" />
            {lang === 'fr' ? 'Coordonnées enregistrées' : 'Coordinates set'}
          </p>
        )}
        <p className="text-xs text-slate-400 mt-3 flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5" />
          {lang === 'fr'
            ? "Renseignez les coordonnées GPS de votre pressing pour calculer la distance avec l'adresse de livraison du client."
            : 'Enter your shop GPS coordinates to compute distance to the client delivery address.'}
        </p>
      </div>

      {/* Dashboard visibility per role */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-9 h-9 rounded-lg bg-sky-50 flex items-center justify-center">
            <LayoutDashboard className="w-4.5 h-4.5 text-sky-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {lang === 'fr' ? 'Visibilité du tableau de bord' : 'Dashboard visibility'}
            </p>
            <p className="text-xs text-slate-400">
              {lang === 'fr'
                ? "Choisissez quels rôles peuvent voir le tableau de bord dans le menu. L'administrateur y a toujours accès."
                : 'Choose which roles can see the dashboard in the menu. The administrator always has access.'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'gerant', label: lang === 'fr' ? 'Gérant' : 'Manager' },
            { id: 'commercial', label: lang === 'fr' ? 'Commercial' : 'Sales agent' },
            { id: 'collecteur', label: lang === 'fr' ? 'Collecteur' : 'Collector' },
          ].map(({ id, label }) => {
            const isActive = dashboardRoles.includes(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setDashboardRoles((prev) =>
                    isActive ? prev.filter((r) => r !== id) : [...prev, id],
                  );
                }}
                className={`px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-sky-500 text-white border-sky-500 shadow-sm'
                    : 'bg-white border-slate-200 text-slate-500 hover:border-sky-200 hover:bg-sky-50/50'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Label printing field configuration */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-9 h-9 rounded-lg bg-sky-50 flex items-center justify-center">
            <Tags className="w-4.5 h-4.5 text-sky-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {lang === 'fr' ? 'Champs des étiquettes' : 'Label fields'}
            </p>
            <p className="text-xs text-slate-400">
              {lang === 'fr'
                ? "Choisissez les informations qui apparaissent sur les étiquettes imprimées pour chaque pièce."
                : 'Choose which information appears on printed labels for each piece.'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {([
            { id: 'date_depot', label: lang === 'fr' ? 'Date dépôt' : 'Deposit date' },
            { id: 'numero', label: lang === 'fr' ? 'N° dépôt' : 'Deposit number' },
            { id: 'client_nom', label: lang === 'fr' ? 'Nom client' : 'Client name' },
            { id: 'date_retrait', label: lang === 'fr' ? 'Date retrait' : 'Pickup date' },
            { id: 'piece_number', label: lang === 'fr' ? 'N° pièce / total' : 'Piece number / total' },
            { id: 'designation', label: lang === 'fr' ? 'Désignation' : 'Designation' },
          ] as { id: string; label: string }[]).map((btn) => {
            const isActive = labelFields.includes(btn.id);
            return (
              <button
                key={btn.id}
                type="button"
                onClick={() => {
                  setLabelFields((prev) =>
                    isActive ? prev.filter((f) => f !== btn.id) : [...prev, btn.id],
                  );
                }}
                className={`px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-sky-500 text-white border-sky-500 shadow-sm'
                    : 'bg-white border-slate-200 text-slate-500 hover:border-sky-200 hover:bg-sky-50/50'
                }`}
              >
                {btn.label}
              </button>
            );
          })}
        </div>
        {labelFields.length === 0 && (
          <p className="text-xs text-amber-600 mt-3">
            {lang === 'fr'
              ? 'Aucun champ sélectionné — les étiquettes seront vides.'
              : 'No fields selected — labels will be empty.'}
          </p>
        )}
      </div>

      {/* Label printer configuration */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-9 h-9 rounded-lg bg-sky-50 flex items-center justify-center">
            <Plug className="w-4.5 h-4.5 text-sky-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {lang === 'fr' ? 'Imprimante d\'étiquettes' : 'Label printer'}
            </p>
            <p className="text-xs text-slate-400">
              {lang === 'fr'
                ? 'Choisissez comment imprimer les étiquettes: via le dialogue d\'impression standard ou directement sur une imprimante connectée au port série (y compris adaptateur USB-série).'
                : 'Choose how to print labels: via the standard print dialog or directly to a serial-port-connected printer (including USB-to-serial adapters).'}
            </p>
          </div>
        </div>

        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => setPrinterType('browser')}
            className={`flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
              printerType === 'browser'
                ? 'bg-sky-500 text-white border-sky-500 shadow-sm'
                : 'bg-white border-slate-200 text-slate-500 hover:border-sky-200 hover:bg-sky-50/50'
            }`}
          >
            <Printer className="w-4 h-4 inline mr-1.5" />
            {lang === 'fr' ? 'Dialogue d\'impression' : 'Print dialog'}
          </button>
          <button
            type="button"
            onClick={() => setPrinterType('serial')}
            disabled={!isSerialSupported()}
            className={`flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
              printerType === 'serial'
                ? 'bg-sky-500 text-white border-sky-500 shadow-sm'
                : 'bg-white border-slate-200 text-slate-500 hover:border-sky-200 hover:bg-sky-50/50'
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            <Usb className="w-4 h-4 inline mr-1.5" />
            {lang === 'fr' ? 'Port série' : 'Serial port'}
          </button>
        </div>

        {!isSerialSupported() && printerType === 'serial' && (
          <p className="text-xs text-amber-600 mb-3">
            {lang === 'fr'
              ? 'Le port série Web n\'est pas supporté par ce navigateur. Utilisez Chrome ou Edge sur ordinateur.'
              : 'Web Serial is not supported by this browser. Use Chrome or Edge on desktop.'}
          </p>
        )}
        {isSerialSupported() && printerType === 'browser' && (
          <p className="text-xs text-slate-400 mb-3">
            {lang === 'fr'
              ? 'Le port série Web fonctionne avec Chrome ou Edge. Connectez votre imprimante (port série natif ou adaptateur USB-série) puis cliquez sur « Connecter ».'
              : 'Web Serial works with Chrome or Edge. Connect your printer (native serial port or USB-to-serial adapter) then click "Connect".'}
          </p>
        )}

        {printerType === 'serial' && (
          <>
            <div className="flex items-end gap-3 mb-3">
              <div className="flex-shrink-0">
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {lang === 'fr' ? 'Vitesse (baud)' : 'Baud rate'}
                </label>
                <select
                  value={baudRate}
                  onChange={(e) => setBaudRate(parseInt(e.target.value))}
                  className="px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                >
                  <option value={9600}>9600</option>
                  <option value={19200}>19200</option>
                  <option value={38400}>38400</option>
                  <option value={57600}>57600</option>
                  <option value={115200}>115200</option>
                </select>
              </div>
              <button
                type="button"
                onClick={async () => {
                  setSerialConnecting(true);
                  setSerialError(null);
                  try {
                    if (serialConnected) {
                      await disconnectSerialPrinter();
                      setSerialConnected(false);
                    } else {
                      await connectSerialPrinter(baudRate);
                      setSerialConnected(true);
                    }
                  } catch (err) {
                    setSerialError(err instanceof Error ? err.message : 'Erreur de connexion');
                  } finally {
                    setSerialConnecting(false);
                  }
                }}
                disabled={serialConnecting}
                className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                  serialConnected
                    ? 'bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                    : 'bg-sky-500 text-white hover:bg-sky-600'
                } disabled:opacity-50`}
              >
                {serialConnecting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : serialConnected ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Usb className="w-4 h-4" />
                )}
                {serialConnected
                  ? (lang === 'fr' ? 'Connecté — Déconnecter' : 'Connected — Disconnect')
                  : (lang === 'fr' ? 'Connecter' : 'Connect')}
              </button>
            </div>

            {serialError && (
              <p className="text-xs text-red-500 mb-2">{serialError}</p>
            )}

            {serialConnected && (
              <button
                type="button"
                onClick={async () => {
                  setSerialError(null);
                  try {
                    await printTestLabel({ baudRate, charWidth: 48 });
                  } catch (err) {
                    setSerialError(err instanceof Error ? err.message : 'Erreur test impression');
                  }
                }}
                className="px-4 py-2 rounded-lg bg-slate-100 border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-200 transition-colors flex items-center gap-2"
              >
                <Printer className="w-4 h-4" />
                {lang === 'fr' ? 'Tester l\'impression' : 'Test print'}
              </button>
            )}
          </>
        )}

        {printerType === 'browser' && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {lang === 'fr' ? 'Imprimante par défaut' : 'Default printer'}
              </label>
              <input
                type="text"
                value={printerName}
                onChange={(e) => setPrinterName(e.target.value)}
                placeholder={lang === 'fr' ? 'Ex. ZD220 Étiquettes' : 'E.g. ZD220 Labels'}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
              />
              <p className="text-xs text-slate-400 mt-1">
                {lang === 'fr'
                  ? 'Le nom est mémorisé comme imprimante préférée. Le navigateur peut encore demander une confirmation.'
                  : 'The name is saved as your preferred printer. The browser may still ask for confirmation.'}
              </p>
            </div>
            <p className="text-xs text-slate-400">
              {lang === 'fr'
                ? 'L\'impression utilise la boîte de dialogue standard du navigateur.'
                : 'Printing uses the standard browser print dialog.'}
            </p>
          </div>
        )}
      </div>

      {/* History filter visibility per role */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center">
            <Filter className="w-4.5 h-4.5 text-indigo-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {lang === 'fr' ? 'Filtres historique par rôle' : 'History filters by role'}
            </p>
            <p className="text-xs text-slate-400">
              {lang === 'fr'
                ? "Choisissez les filtres de période visibles pour chaque rôle dans l'historique."
                : 'Choose which period filters are visible for each role in the history page.'}
            </p>
          </div>
        </div>

        {[
          { key: 'commercial', label: lang === 'fr' ? 'Commercial' : 'Sales agent', filters: filtersCommercial, setFilters: setFiltersCommercial },
          { key: 'gerant', label: lang === 'fr' ? 'Gérant' : 'Manager', filters: filtersGerant, setFilters: setFiltersGerant },
        ].map(({ key, label, filters, setFilters }) => (
          <div key={key} className="mb-4 last:mb-0">
            <p className="text-xs font-semibold text-slate-600 mb-2">{label}</p>
            <div className="flex flex-wrap gap-2">
              {([
                { id: 'today', label: lang === 'fr' ? "Aujourd'hui" : 'Today' },
                { id: 'week', label: lang === 'fr' ? 'Semaine' : 'Week' },
                { id: 'month', label: lang === 'fr' ? 'Mois' : 'Month' },
                { id: 'all', label: lang === 'fr' ? 'Tout' : 'All' },
                { id: 'custom', label: lang === 'fr' ? 'Personnalisé' : 'Custom' },
              ] as { id: string; label: string }[]).map((btn) => {
                const isActive = filters.includes(btn.id);
                return (
                  <button
                    key={btn.id}
                    type="button"
                    onClick={() => {
                      setFilters((prev: string[]) =>
                        isActive ? prev.filter((f) => f !== btn.id) : [...prev, btn.id],
                      );
                    }}
                    className={`px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                      isActive
                        ? 'bg-indigo-500 text-white border-indigo-500 shadow-sm'
                        : 'bg-white border-slate-200 text-slate-500 hover:border-indigo-200 hover:bg-indigo-50/50'
                    }`}
                  >
                    {btn.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Deposit numbering & Offline multi-billing-point card */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-sky-50 flex items-center justify-center">
            <Monitor className="w-4.5 h-4.5 text-sky-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {lang === 'fr'
                ? 'Numérotation Dépôts & Codes Clients — Points de facturation (Hors-ligne)'
                : 'Deposit & Client Code Numbering — Billing points (Offline)'}
            </p>
            <p className="text-xs text-slate-400">
              {lang === 'fr'
                ? 'Suite continue des numéros existants, remise à 001 des dépôts au 1er janvier et protection anti-doublon hors-ligne (dépôts & clients).'
                : 'Seamless continuation from existing numbers, deposit reset to 001 every January 1st, and offline duplicate protection (deposits & clients).'}
            </p>
          </div>
        </div>

        <div className="rounded-lg bg-slate-50 border border-slate-100 p-3.5 space-y-1.5 text-xs text-slate-600">
          <div className="flex items-center justify-between">
            <span>{lang === 'fr' ? 'Prochain numéro de dépôt sur ce poste :' : 'Next deposit number on this device:'}</span>
            <span className="font-mono font-bold text-sky-700 bg-sky-50 px-2.5 py-0.5 rounded border border-sky-200">
              {nextDepotPreview || formatDepotNumero(depotStartSeq ?? 1, new Date().getFullYear(), billingPointCode)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>{lang === 'fr' ? 'Format Code Client actif sur cet appareil :' : 'Active Client Code format on this device:'}</span>
            <span className="font-mono font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-200">
              {formatClientCode(1, billingPointCode)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>{lang === 'fr' ? 'Dépôts au 1er janvier prochain :' : 'Deposits next January 1st:'}</span>
            <span className="font-mono font-semibold text-slate-700">
              {formatDepotNumero(1, new Date().getFullYear() + 1, billingPointCode)}
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-medium text-slate-700">
            {lang === 'fr'
              ? 'Préfixe du point de facturation (spécifique à cet appareil / cette caisse)'
              : 'Billing point prefix (specific to this device / register)'}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {(['', 'C1', 'C2', 'C3', 'P1', 'P2'] as const).map((preset) => {
              const active = billingPointCode === preset;
              return (
                <button
                  key={preset || 'MAIN'}
                  type="button"
                  onClick={() => {
                    const saved = setBillingPointCode(preset);
                    setBillingPointCodeState(saved);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    active
                      ? 'bg-sky-500 text-white border-sky-500 shadow-sm'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-sky-300'
                  }`}
                >
                  {preset
                    ? `${preset} (${formatDepotNumero(1, new Date().getFullYear(), preset)})`
                    : lang === 'fr'
                      ? `Sans préfixe (${formatDepotNumero(1, new Date().getFullYear(), '')})`
                      : `No prefix (${formatDepotNumero(1, new Date().getFullYear(), '')})`}
                </button>
              );
            })}
            <input
              type="text"
              value={billingPointCode}
              onChange={(e) => {
                const saved = setBillingPointCode(normalizeBillingPointCode(e.target.value));
                setBillingPointCodeState(saved);
              }}
              maxLength={8}
              placeholder={lang === 'fr' ? 'Préfixe libre (ex: ABJ1)' : 'Custom prefix (e.g. ABJ1)'}
              className="w-44 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-mono uppercase focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
          <p className="text-xs text-slate-400">
            {lang === 'fr'
              ? 'Sans préfixe : D-001-2026 / C-0001. Avec préfixe (ex: C1 ou ABJ1) : C1-D-001-2026 / C1-C-0001. Attribuez un préfixe différent sur chaque point de facturation pour éviter tout doublon hors-ligne.'
              : 'Without prefix: D-001-2026 / C-0001. With prefix (e.g. C1 or ABJ1): C1-D-001-2026 / C1-C-0001. Assign a distinct prefix per billing point to avoid any offline duplicates.'}
          </p>
        </div>

        <div className="pt-3 border-t border-slate-100 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="block text-xs font-medium text-slate-700">
              {lang === 'fr'
                ? `Imposer un compteur de départ des dépôts${currentBoutique ? ` — ${currentBoutique.nom}` : ''} (${new Date().getFullYear()})`
                : `Enforce starting deposit counter${currentBoutique ? ` — ${currentBoutique.nom}` : ''} (${new Date().getFullYear()})`}
            </label>
            {depotStartSeq !== null && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-50 border border-sky-200 text-[11px] font-semibold text-sky-700">
                {lang === 'fr'
                  ? `Imposé : ${formatDepotNumero(depotStartSeq, new Date().getFullYear(), billingPointCode)}${currentBoutique ? ` (${currentBoutique.nom})` : ''}`
                  : `Enforced: ${formatDepotNumero(depotStartSeq, new Date().getFullYear(), billingPointCode)}${currentBoutique ? ` (${currentBoutique.nom})` : ''}`}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={1}
              step={1}
              value={startSeqInput}
              onChange={(e) => setStartSeqInput(e.target.value)}
              placeholder={lang === 'fr' ? 'Ex: 250' : 'e.g. 250'}
              className="w-36 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <button
              type="button"
              onClick={async () => {
                const parsed = parseInt(startSeqInput, 10);
                if (!Number.isFinite(parsed) || parsed < 1) return;
                const { saved } = await db.saveEnforcedDepotStartNumber(parsed);
                setDepotStartSeqState(saved);
                refreshNumberingPreview();
                void reloadBoutiques();
                setStartSeqSaved(true);
                setTimeout(() => setStartSeqSaved(false), 2500);
              }}
              className="px-3.5 py-1.5 rounded-lg bg-sky-500 text-white text-xs font-medium hover:bg-sky-600 transition-colors"
            >
              {lang === 'fr' ? 'Imposer ce compteur' : 'Enforce counter'}
            </button>
            {depotStartSeq !== null && (
              <button
                type="button"
                onClick={async () => {
                  await db.saveEnforcedDepotStartNumber(null);
                  setDepotStartSeqState(null);
                  setStartSeqInput('');
                  refreshNumberingPreview();
                  void reloadBoutiques();
                }}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-medium hover:bg-slate-50 transition-colors"
              >
                {lang === 'fr' ? 'Revenir au mode automatique' : 'Reset to auto mode'}
              </button>
            )}
            {startSeqSaved && (
              <span className="text-xs font-medium text-emerald-600 flex items-center gap-1">
                <Check className="w-3.5 h-3.5" />
                {lang === 'fr'
                  ? `Compteur imposé${currentBoutique ? ` pour ${currentBoutique.nom}` : ''} !`
                  : `Counter enforced${currentBoutique ? ` for ${currentBoutique.nom}` : ''}!`}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400">
            {lang === 'fr'
              ? `Chaque boutique dispose de son propre compteur de départ indépendant (ex: 250 → ${formatDepotNumero(250, new Date().getFullYear(), billingPointCode)}). Vous pouvez également régler le compteur de chaque boutique dans le menu Boutiques.`
              : `Each boutique has its own independent starting counter (e.g. 250 → ${formatDepotNumero(250, new Date().getFullYear(), billingPointCode)}). You can also configure each boutique's counter in the Boutiques menu.`}
          </p>
        </div>
      </div>

      {/* Portal link section */}
      {entreprise && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center">
              <Share2 className="w-4.5 h-4.5 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">
                {lang === 'fr' ? 'Lien du portail client' : 'Client portal link'}
              </p>
              <p className="text-xs text-slate-400">
                {lang === 'fr'
                  ? "Partagez ce lien à vos clients pour qu'ils consultent leur relevé et créent des commandes."
                  : 'Share this link with your clients so they can view their statement and create orders.'}
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-100 text-sm text-slate-600 truncate">
              {window.location.origin}/#/portal/{entreprise.id}
            </div>
            <button
              onClick={copyPortalLink}
              className="px-4 py-2.5 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
            >
              {portalCopied ? (
                <>
                  <Check className="w-4 h-4" /> {lang === 'fr' ? 'Copié !' : 'Copied!'}
                </>
              ) : (
                <>
                  <Share2 className="w-4 h-4" /> {lang === 'fr' ? 'Copier le lien' : 'Copy link'}
                </>
              )}
            </button>
            <a
              href={`${window.location.origin}/#/portal/${entreprise.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
            >
              <ExternalLink className="w-4 h-4" /> {lang === 'fr' ? 'Ouvrir' : 'Open'}
            </a>
          </div>

          <p className="text-xs text-slate-400 mt-3">
            {lang === 'fr'
              ? "Chaque client a un code unique (visible sur sa fiche) qu'il saisira sur cette page pour se connecter."
              : "Each client has a unique code (visible on their card) they will enter on this page to log in."}
          </p>
        </div>
      )}

      {/* QR Code flyer section */}
      {entreprise && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-9 h-9 rounded-lg bg-sky-50 flex items-center justify-center">
              <QrCode className="w-4.5 h-4.5 text-sky-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">
                {lang === 'fr' ? 'QR Code du portail client' : 'Client portal QR code'}
              </p>
              <p className="text-xs text-slate-400">
                {lang === 'fr'
                  ? 'Imprimez ce QR code et affichez-le dans votre boutique. Les clients le scannent pour créer leur compte et commander.'
                  : 'Print this QR code and display it in your shop. Clients scan it to create their account and order.'}
              </p>
            </div>
          </div>

          <div className="flex flex-col items-center gap-4">
            <div className="p-4 bg-white border-2 border-slate-200 rounded-xl">
              <QRCodeImage value={`${window.location.origin}/#/portal/${entreprise.id}`} size={200} />
            </div>

            <div className="text-center">
              <p className="text-xs text-slate-400 break-all">
                {window.location.origin}/#/portal/{entreprise.id}
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={downloadQrImage}
                disabled={qrDownloading}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50"
              >
                {qrDownloading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                {lang === 'fr' ? 'Télécharger l\'image' : 'Download image'}
              </button>
              <button
                onClick={() => window.print()}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors"
              >
                <Printer className="w-4 h-4" /> {lang === 'fr' ? 'Imprimer le flyer' : 'Print flyer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Print-only QR flyer */}
      {entreprise && (
        <div className="print-flyer fixed inset-0 bg-white z-50 p-0 m-0 hidden print:block">
          <div className="flex flex-col items-center justify-center min-h-screen px-8 py-12">
            {entreprise.logo_url && (
              <img src={entreprise.logo_url} alt="" className="w-20 h-20 object-contain mb-4 rounded-lg" />
            )}
            <h1 className="text-3xl font-bold text-slate-900 text-center">{entreprise.nom}</h1>
            {entreprise.slogan && (
              <p className="text-lg text-sky-600 mt-2 text-center font-medium">{entreprise.slogan}</p>
            )}

            <div className="my-8 p-6 bg-white border-4 border-slate-800 rounded-2xl">
              <QRCodeImage value={`${window.location.origin}/#/portal/${entreprise.id}`} size={300} />
            </div>

            <h2 className="text-xl font-bold text-slate-900 text-center max-w-md">
              {lang === 'fr' ? 'Scannez ce QR code pour créer votre compte et commander en ligne' : 'Scan this QR code to create your account and order online'}
            </h2>
            <p className="text-sm text-slate-600 text-center max-w-md mt-3">
              {lang === 'fr'
                ? 'Créez votre compte client en quelques secondes, passez vos commandes 24h/24 et suivez l\'état de vos dépôts.'
                : 'Create your client account in seconds, place orders 24/7 and track your deposits.'}
            </p>

            {(entreprise.telephone || entreprise.adresse || entreprise.ville) && (
              <div className="mt-8 text-center text-sm text-slate-500 space-y-1">
                {entreprise.telephone && (
                  <p className="flex items-center justify-center gap-1.5">
                    <Phone className="w-4 h-4" /> {entreprise.telephone}
                  </p>
                )}
                {(entreprise.adresse || entreprise.ville) && (
                  <p className="flex items-center justify-center gap-1.5">
                    <MapPin className="w-4 h-4" />
                    {[entreprise.adresse, entreprise.ville].filter(Boolean).join(', ')}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sticky save bar */}
      <div className="sticky bottom-4 z-10">
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full px-4 py-3 rounded-xl bg-sky-500 text-white font-medium text-sm hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-sky-200"
        >
          {saving ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              {lang === 'fr' ? 'Enregistrement…' : 'Saving…'}
            </>
          ) : saved ? (
            <>
              <Check className="w-4 h-4" /> {lang === 'fr' ? 'Enregistré' : 'Saved'}
            </>
          ) : (
            <>
              <Save className="w-4 h-4" /> {lang === 'fr' ? 'Enregistrer les modifications' : 'Save changes'}
            </>
          )}
        </button>
      </div>
  </div>
  );
}
