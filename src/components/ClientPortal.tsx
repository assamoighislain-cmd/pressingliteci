import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';
import {
  formatPrice,
  formatDateShort,
  parseTraitementFromNotes,
  stripTraitementTagFromNotes,
  formatNotesWithTraitementTag,
  buildWhatsAppUrl,
} from '@/types';
import {
  Lock,
  Receipt,
  ShoppingCart,
  ArrowLeft,
  Check,
  Plus,
  Trash2,
  Search,
  Loader2,
  Package,
  Phone,
  MapPin,
  Calendar,
  Sparkles,
  Navigation,
  Truck,
  CalendarClock,
  Download,
  Smartphone,
  Share,
  Monitor,
  CheckCircle2,
  X,
  UserPlus,
  Store,
  Clock,
  Zap,
  ShieldCheck,
  Pencil,
  Home,
  Map as MapIcon,
  Copy,
  FileText,
  AlertCircle,
  RefreshCw,
  MessageCircle,
  ArrowLeftRight,
  ShoppingBag,
} from 'lucide-react';
import { usePwaInstall } from '@/hooks/usePwaInstall';
import { ClientLocationMapPicker } from '@/components/DeliveryMap';

interface PortalClient {
  client_id: string;
  client_nom: string;
  client_telephone: string | null;
  taux_remise: number;
  condition_remise: number | null;
  entreprise_nom: string;
  entreprise_telephone: string | null;
  entreprise_adresse: string | null;
  entreprise_ville: string | null;
  delivery_base_fee: number;
  delivery_price_per_km: number;
  delivery_latitude: number | null;
  delivery_longitude: number | null;
}

interface PortalDepot {
  id: string;
  numero: string | null;
  statut: string;
  date_depot: string;
  date_retrait_prevue: string | null;
  date_retrait?: string | null;
  collected_at?: string | null;
  ready_for_delivery?: boolean | null;
  total: number;
  mode_reglement: string | null;
  avance_amount: number | null;
  notes: string | null;
  type_traitement_id: string | null;
  traitement?: string | null;
  coefficient: number;
  taux_remise?: number | null;
  montant_remise?: number | null;
  frais_collecte?: number | null;
  frais_livraison?: number | null;
  pickup_requested: boolean | null;
  pickup_address: string | null;
  pickup_latitude: number | null;
  pickup_longitude: number | null;
  pickup_day: string | null;
  delivery_requested: boolean | null;
  delivery_address: string | null;
  delivery_latitude: number | null;
  delivery_longitude: number | null;
  delivery_day: string | null;
  articles: {
    id: string;
    designation: string;
    quantite: number;
    nb_pieces: number;
    prix_unitaire: number;
    prix_traitement: number;
    prix_total: number;
    couleur: string | null;
    signe_particulier: string | null;
    griffe: string | null;
  }[];
  avances: {
    id: string;
    montant: number;
    mode_reglement: string | null;
    date_paiement: string;
  }[];
}

interface CatalogArticle {
  id: string;
  designation: string;
  prix_unitaire: number;
  nb_pieces: number;
}

interface PortalArticleVariant {
  id: string;
  article_id: string;
  designation: string;
  prix_traitement: number;
}

interface PortalTypeTraitement {
  id: string;
  libelle: string;
  coefficient: number;
  nb_jours: number;
  isFallback?: boolean;
}

const FALLBACK_PORTAL_TYPES_TRAITEMENT: PortalTypeTraitement[] = [
  { id: 'fallback:normal', libelle: 'NORMAL', coefficient: 1, nb_jours: 3, isFallback: true },
  { id: 'fallback:express', libelle: 'EXPRESS', coefficient: 1.5, nb_jours: 2, isFallback: true },
  { id: 'fallback:super_express', libelle: 'SUPER EXPRESS', coefficient: 2, nb_jours: 1, isFallback: true },
];

interface OrderArticle {
  id: string;
  article_id: string | null;
  variant_id: string | null;
  designation: string;
  base_designation: string;
  prix_unitaire: number;
  quantite: number | '';
  nb_pieces: number;
  prix_total: number;
  couleur: string;
  signe_particulier: string;
  griffe: string;
}

const TIME_SLOTS: { value: string; fr: string; en: string }[] = [
  { value: 'Matin (8h-12h)', fr: 'Matin (8h–12h)', en: 'Morning (8am–12pm)' },
  { value: 'Après-midi (13h-17h)', fr: 'Après-midi (13h–17h)', en: 'Afternoon (1pm–5pm)' },
  { value: 'Soir (17h-20h)', fr: 'Soir (17h–20h)', en: 'Evening (5pm–8pm)' },
];

const DAY_LABELS_MAP: Record<string, { fr: string; en: string }> = {
  lundi: { fr: 'Lundi', en: 'Monday' },
  mardi: { fr: 'Mardi', en: 'Tuesday' },
  mercredi: { fr: 'Mercredi', en: 'Wednesday' },
  jeudi: { fr: 'Jeudi', en: 'Thursday' },
  vendredi: { fr: 'Vendredi', en: 'Friday' },
  samedi: { fr: 'Samedi', en: 'Saturday' },
  dimanche: { fr: 'Dimanche', en: 'Sunday' },
};

function composeDayAndSlot(day: string, slot: string): string | null {
  const cleanDay = day.trim();
  const cleanSlot = slot.trim();
  if (cleanDay && cleanSlot) return `${cleanDay} · ${cleanSlot}`;
  if (cleanDay) return cleanDay;
  if (cleanSlot) return cleanSlot;
  return null;
}

function parseDayAndSlot(raw: string | null | undefined): { day: string; slot: string } {
  if (!raw) return { day: '', slot: '' };
  const parts = raw.split('·').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return { day: '', slot: '' };
  if (parts.length === 1) {
    const isSlotOnly = TIME_SLOTS.some((s) => s.value === parts[0]);
    return isSlotOnly ? { day: '', slot: parts[0] } : { day: parts[0].toLowerCase(), slot: '' };
  }
  return { day: parts[0].toLowerCase(), slot: parts.slice(1).join(' · ') };
}

function formatDayAndSlotLabel(raw: string | null | undefined, fr: boolean): string {
  if (!raw) return '';
  const { day, slot } = parseDayAndSlot(raw);
  const dayLabel = day ? (DAY_LABELS_MAP[day]?.[fr ? 'fr' : 'en'] ?? day) : '';
  if (dayLabel && slot) return `${dayLabel} · ${slot}`;
  return dayLabel || slot;
}

function uid(): string {
  return Math.random().toString(36).slice(2);
}

export default function ClientPortal({ entrepriseId }: { entrepriseId: number }) {
  const { lang } = useI18n();
  const fr = lang === 'fr';

  const [code, setCode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(`portal_code_${entrepriseId}`) ?? '';
    }
    return '';
  });
  const [client, setClient] = useState<PortalClient | null>(null);
  const [depots, setDepots] = useState<PortalDepot[]>([]);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [view, setView] = useState<'releve' | 'commande'>('releve');
  const [catalog, setCatalog] = useState<CatalogArticle[]>([]);
  const [articleVariants, setArticleVariants] = useState<PortalArticleVariant[]>([]);
  const [typesTraitement, setTypesTraitement] = useState<PortalTypeTraitement[]>([]);
  const [typesLoading, setTypesLoading] = useState(false);
  const [typesLoadError, setTypesLoadError] = useState<string | null>(null);
  const [selectedTypeTraitementId, setSelectedTypeTraitementId] = useState<string>('');
  const [orderArticles, setOrderArticles] = useState<OrderArticle[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [loadingReleve, setLoadingReleve] = useState(false);
  const [pickupRequested, setPickupRequested] = useState(false);
  const [pickupAddress, setPickupAddress] = useState('');
  const [pickupLat, setPickupLat] = useState<number | null>(null);
  const [pickupLng, setPickupLng] = useState<number | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [pickupDays, setPickupDays] = useState<string[]>([]);
  const [selectedPickupDay, setSelectedPickupDay] = useState<string>('');
  const [selectedPickupSlot, setSelectedPickupSlot] = useState<string>('');
  const [deliveryRequested, setDeliveryRequested] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryLat, setDeliveryLat] = useState<number | null>(null);
  const [deliveryLng, setDeliveryLng] = useState<number | null>(null);
  const [selectedDeliveryDay, setSelectedDeliveryDay] = useState<string>('');
  const [selectedDeliverySlot, setSelectedDeliverySlot] = useState<string>('');
  const [sameAddressAsPickup, setSameAddressAsPickup] = useState(false);
  const [showPickupMap, setShowPickupMap] = useState(false);
  const [showDeliveryMap, setShowDeliveryMap] = useState(false);
  const [orderNotes, setOrderNotes] = useState('');
  const [deliveryGpsLoading, setDeliveryGpsLoading] = useState(false);
  const [deliveryGpsError, setDeliveryGpsError] = useState<string | null>(null);
  const { canInstall, promptInstall, platform, hasInstallPrompt, installed } = usePwaInstall();
  const [showInstallModal, setShowInstallModal] = useState(false);

  // Saved client home address (remembered locally for fast re-ordering)
  const [savedHomeAddress, setSavedHomeAddress] = useState<{
    address: string;
    lat: number | null;
    lng: number | null;
  } | null>(null);

  // Edit & cancel mode for uncollected orders
  const [editingDepotId, setEditingDepotId] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Showcase + signup
  const [showSignup, setShowSignup] = useState(false);
  const [signupNom, setSignupNom] = useState('');
  const [signupTel, setSignupTel] = useState('');
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupError, setSignupError] = useState<string | null>(null);
  const [signupResult, setSignupResult] = useState<{ code: string; nom: string } | null>(null);
  const [entrepriseInfo, setEntrepriseInfo] = useState<{
    nom: string; slogan: string | null; logo_url: string | null;
    telephone: string | null; adresse: string | null; ville: string | null;
    pickup_days: string[] | null;
  } | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('entreprise')
        .select('nom, logo_url, slogan, telephone, adresse, ville, pickup_days')
        .eq('id', entrepriseId)
        .maybeSingle();
      const ent = data as {
        nom: string; logo_url: string | null; slogan: string | null;
        telephone: string | null; adresse: string | null; ville: string | null;
        pickup_days: string[] | null;
      } | null;
      if (ent) setEntrepriseInfo(ent);
      const ogImage = document.querySelector('meta[property="og:image"]');
      const ogTitle = document.querySelector('meta[property="og:title"]');
      const twitterImage = document.querySelector('meta[name="twitter:image"]');
      const twitterTitle = document.querySelector('meta[name="twitter:title"]');
      if (ogImage && twitterImage) {
        const img = ent?.logo_url || '/pwa-512x512.png';
        ogImage.setAttribute('content', img);
        twitterImage.setAttribute('content', img);
      }
      if (ogTitle && twitterTitle) {
        const title = ent?.nom || '';
        ogTitle.setAttribute('content', title);
        twitterTitle.setAttribute('content', title);
      }
    })();
  }, [entrepriseId]);

  // Auto-login with saved code
  useEffect(() => {
    const savedCode = localStorage.getItem(`portal_code_${entrepriseId}`);
    if (savedCode && !client) {
      setCode(savedCode);
      (async () => {
        setLoggingIn(true);
        try {
          const { data, error } = await supabase.rpc('portal_login', {
            p_code: savedCode.toUpperCase(),
            e_id: entrepriseId,
          });
          if (error) throw error;
          const rows = data as PortalClient[];
          if (rows && rows.length > 0) {
            setClient(rows[0]);
            await loadReleve(savedCode.toUpperCase());
          } else {
            localStorage.removeItem(`portal_code_${entrepriseId}`);
          }
        } catch {
          localStorage.removeItem(`portal_code_${entrepriseId}`);
        } finally {
          setLoggingIn(false);
        }
      })();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entrepriseId]);

  async function handleLogin() {
    if (!code.trim()) return;
    setLoggingIn(true);
    setLoginError(null);
    try {
      const { data, error } = await supabase.rpc('portal_login', {
        p_code: code.trim().toUpperCase(),
        e_id: entrepriseId,
      });
      if (error) throw error;
      const rows = data as PortalClient[];
      if (!rows || rows.length === 0) {
        setLoginError(fr ? 'Code client invalide. Vérifiez le code fourni par votre pressing.' : 'Invalid client code. Check the code provided by your dry cleaner.');
        setLoggingIn(false);
        return;
      }
      setClient(rows[0]);
      localStorage.setItem(`portal_code_${entrepriseId}`, code.trim().toUpperCase());
      await loadReleve(code.trim().toUpperCase());
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : (fr ? 'Erreur de connexion' : 'Connection error'));
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleSignup() {
    if (!signupNom.trim()) return;
    setSignupLoading(true);
    setSignupError(null);
    try {
      const { data, error } = await supabase.rpc('portal_signup', {
        p_nom: signupNom.trim(),
        p_telephone: signupTel.trim() || null,
        e_id: entrepriseId,
      });
      if (error) throw error;
      const result = data as { portal_code: string; client_id: string }[];
      if (!result || result.length === 0) throw new Error('No result');
      setSignupResult({ code: result[0].portal_code, nom: signupNom.trim() });
      setSignupNom('');
      setSignupTel('');
    } catch (err) {
      setSignupError(err instanceof Error ? err.message : (fr ? 'Erreur lors de l\'inscription' : 'Error during registration'));
    } finally {
      setSignupLoading(false);
    }
  }

  const loadReleve = useCallback(async (c: string, silent = false) => {
    if (!silent) setLoadingReleve(true);
    try {
      const { data, error } = await supabase.rpc('portal_get_releve', {
        p_code: c,
        e_id: entrepriseId,
      });
      if (error) throw error;
      const result = data as { depots?: PortalDepot[] };
      setDepots(result?.depots ?? []);
    } catch {
      if (!silent) setDepots([]);
    } finally {
      if (!silent) setLoadingReleve(false);
    }
  }, [entrepriseId]);

  // Automatic background status refresh when client is tracking orders on Relevé tab
  useEffect(() => {
    if (!client || view !== 'releve') return;
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) return;
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadReleve(cleanCode, true);
      }
    }, 30000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void loadReleve(cleanCode, true);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [client, view, code, loadReleve]);

  // Load catalog, treatment types, article variants, and pickup days via portal RPCs
  const loadPortalCatalogAndTypes = useCallback(async () => {
    setTypesLoading(true);
    setTypesLoadError(null);
    try {
      const [catalogRes, typesRes, pickupDaysRes, variantsRes] = await Promise.all([
        supabase.rpc('portal_get_catalog', { e_id: entrepriseId }),
        supabase.rpc('portal_get_types_traitement', { e_id: entrepriseId }),
        supabase.rpc('portal_get_pickup_days', { e_id: entrepriseId }),
        supabase.rpc('portal_get_article_variants', { e_id: entrepriseId }),
      ]);

      if (!catalogRes.error) {
        setCatalog((catalogRes.data as CatalogArticle[]) ?? []);
      } else {
        setCatalog([]);
      }

      let resolvedTypes: PortalTypeTraitement[] = [];
      if (!typesRes.error && Array.isArray(typesRes.data) && typesRes.data.length > 0) {
        resolvedTypes = (typesRes.data as PortalTypeTraitement[]).map((t) => ({
          id: t.id,
          libelle: t.libelle,
          coefficient: Number(t.coefficient) || 1,
          nb_jours: Number(t.nb_jours) || 1,
          isFallback: false,
        }));
      } else {
        // Fallback 1: try direct read if permitted (e.g. authenticated session or public policy)
        const fallbackRes = await supabase
          .from('types_traitement')
          .select('id, libelle, coefficient, nb_jours')
          .order('coefficient', { ascending: true });
        if (!fallbackRes.error && Array.isArray(fallbackRes.data) && fallbackRes.data.length > 0) {
          resolvedTypes = (fallbackRes.data as PortalTypeTraitement[]).map((t) => ({
            id: t.id,
            libelle: t.libelle,
            coefficient: Number(t.coefficient) || 1,
            nb_jours: Number(t.nb_jours) || 1,
            isFallback: false,
          }));
        } else {
          // Fallback 2: always provide selectable standard treatments so clients are never blocked
          resolvedTypes = FALLBACK_PORTAL_TYPES_TRAITEMENT.map((t) => ({ ...t }));
        }
      }

      setTypesTraitement(resolvedTypes);
      setSelectedTypeTraitementId((prev) => {
        if (prev && resolvedTypes.some((t) => t.id === prev)) return prev;
        return resolvedTypes.length > 0 ? resolvedTypes[0].id : '';
      });

      if (!variantsRes.error && Array.isArray(variantsRes.data)) {
        setArticleVariants(
          (variantsRes.data as PortalArticleVariant[]).map((v) => ({
            id: v.id,
            article_id: v.article_id,
            designation: v.designation,
            prix_traitement: Number(v.prix_traitement) || 0,
          })),
        );
      } else {
        setArticleVariants([]);
      }

      const days = (!pickupDaysRes.error ? (pickupDaysRes.data as string[]) : []) ?? [];
      setPickupDays(days);
      if (days.length > 0) {
        setSelectedPickupDay((prev) => prev || days[0]);
      }
    } catch {
      setCatalog([]);
      setTypesTraitement(FALLBACK_PORTAL_TYPES_TRAITEMENT.map((t) => ({ ...t })));
      setSelectedTypeTraitementId((prev) => prev || FALLBACK_PORTAL_TYPES_TRAITEMENT[0].id);
      setArticleVariants([]);
    } finally {
      setTypesLoading(false);
    }
  }, [entrepriseId]);

  useEffect(() => {
    if (!client) return;
    void loadPortalCatalogAndTypes();
    try {
      const raw = localStorage.getItem(`portal_home_addr_${entrepriseId}_${code.trim().toUpperCase()}`);
      if (raw) {
        const parsed = JSON.parse(raw) as { address?: string; lat?: number | null; lng?: number | null };
        if (parsed.address || (parsed.lat != null && parsed.lng != null)) {
          setSavedHomeAddress({
            address: parsed.address ?? '',
            lat: parsed.lat ?? null,
            lng: parsed.lng ?? null,
          });
        }
      }
    } catch {
      // Ignore storage errors
    }
  }, [client, loadPortalCatalogAndTypes, entrepriseId, code]);

  // If fallback treatment types are active, enrich them with any real DB type_traitement_id seen in the client's depots
  useEffect(() => {
    if (depots.length === 0) return;
    setTypesTraitement((prev) => {
      if (prev.length > 0 && prev.every((t) => !t.isFallback)) return prev;
      const fromDepots = new Map<string, PortalTypeTraitement>();
      for (const d of depots) {
        if (!d.type_traitement_id) continue;
        const label = (d.traitement ?? '').trim() || (Number(d.coefficient) > 1 ? `EXPRESS ×${d.coefficient}` : 'NORMAL');
        const key = label.toLowerCase();
        if (!fromDepots.has(key)) {
          const coef = Number(d.coefficient) || 1;
          fromDepots.set(key, {
            id: d.type_traitement_id,
            libelle: label,
            coefficient: coef,
            nb_jours: coef >= 2 ? 1 : coef > 1 ? 2 : 3,
            isFallback: false,
          });
        }
      }
      if (fromDepots.size === 0) return prev;
      const baseList = prev.length > 0 ? prev : FALLBACK_PORTAL_TYPES_TRAITEMENT;
      const merged: PortalTypeTraitement[] = [];
      const seenKeys = new Set<string>();
      for (const item of baseList) {
        const key = item.libelle.trim().toLowerCase();
        const real = fromDepots.get(key);
        merged.push(real ?? item);
        seenKeys.add(key);
      }
      for (const [key, real] of fromDepots.entries()) {
        if (!seenKeys.has(key)) merged.push(real);
      }
      merged.sort((a, b) => a.coefficient - b.coefficient || a.libelle.localeCompare(b.libelle));
      return merged;
    });
  }, [depots]);

  // Keep selectedTypeTraitementId valid whenever typesTraitement upgrades from fallback to real UUID
  useEffect(() => {
    if (typesTraitement.length === 0) return;
    if (!selectedTypeTraitementId || !typesTraitement.some((t) => t.id === selectedTypeTraitementId)) {
      setSelectedTypeTraitementId(typesTraitement[0].id);
    }
  }, [typesTraitement, selectedTypeTraitementId]);

  // Keep delivery address in sync with pickup address when "same address" is toggled on
  useEffect(() => {
    if (sameAddressAsPickup && pickupRequested && deliveryRequested) {
      setDeliveryAddress(pickupAddress);
      setDeliveryLat(pickupLat);
      setDeliveryLng(pickupLng);
    }
  }, [sameAddressAsPickup, pickupRequested, deliveryRequested, pickupAddress, pickupLat, pickupLng]);

  function saveHomeAddressLocally(address: string, lat: number | null, lng: number | null) {
    if (!address.trim() && (lat == null || lng == null)) return;
    const payload = { address: address.trim(), lat, lng };
    setSavedHomeAddress(payload);
    try {
      localStorage.setItem(
        `portal_home_addr_${entrepriseId}_${code.trim().toUpperCase()}`,
        JSON.stringify(payload),
      );
    } catch {
      // Ignore storage errors
    }
  }

  function logout() {
    setClient(null);
    setDepots([]);
    setView('releve');
    setOrderArticles([]);
    setOrderSuccess(false);
    setOrderError(null);
    setOrderNotes('');
    setPickupRequested(false);
    setPickupAddress('');
    setPickupLat(null);
    setPickupLng(null);
    setSelectedPickupDay(pickupDays.length > 0 ? pickupDays[0] : '');
    setDeliveryRequested(false);
    setDeliveryAddress('');
    setDeliveryLat(null);
    setDeliveryLng(null);
    setSelectedDeliveryDay('');
    setSameAddressAsPickup(false);
    setShowPickupMap(false);
    setShowDeliveryMap(false);
    setDeliveryGpsError(null);
    setEditingDepotId(null);
    setEditError(null);
    setConfirmCancelId(null);
    setCancelError(null);
  }

  function captureGps() {
    setGpsLoading(true);
    setGpsError(null);
    if (!navigator.geolocation) {
      setGpsError(fr ? 'Géolocalisation non supportée par votre navigateur.' : 'Geolocation not supported by your browser.');
      setGpsLoading(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPickupLat(pos.coords.latitude);
        setPickupLng(pos.coords.longitude);
        setGpsLoading(false);
      },
      (err) => {
        setGpsError(fr ? 'Impossible d\'obtenir votre position. Vérifiez les autorisations.' : 'Could not get your location. Check permissions.');
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function getSelectedCoefficient(): number {
    const t = typesTraitement.find((t) => t.id === selectedTypeTraitementId);
    return t?.coefficient ?? 1;
  }

  function getSelectedNbJours(): number {
    const t = typesTraitement.find((t) => t.id === selectedTypeTraitementId);
    return t?.nb_jours ?? 1;
  }

  function getSelectedTypeLibelle(): string {
    const t = typesTraitement.find((t) => t.id === selectedTypeTraitementId);
    return t?.libelle ?? '';
  }

  function resolveDepotTreatmentLabel(depot: PortalDepot): string | null {
    if (depot.type_traitement_id) {
      const found = typesTraitement.find((t) => t.id === depot.type_traitement_id);
      if (found) return found.libelle;
    }
    if (depot.traitement && depot.traitement.trim()) {
      return depot.traitement.trim();
    }
    const fromNotes = parseTraitementFromNotes(depot.notes);
    if (fromNotes) return fromNotes.libelle;
    return null;
  }

  function resolveDepotTreatmentCoefficient(depot: PortalDepot): number {
    if (depot.type_traitement_id) {
      return Number(depot.coefficient) || 1;
    }
    const fromNotes = parseTraitementFromNotes(depot.notes);
    if (fromNotes) return fromNotes.coefficient;
    return Number(depot.coefficient) || 1;
  }

  function addArticleToOrder(cat: CatalogArticle) {
    const coef = getSelectedCoefficient();
    const variants = articleVariants.filter((v) => v.article_id === cat.id);
    const firstVariant = variants.length > 0 ? variants[0] : null;
    const basePrice = firstVariant ? Number(firstVariant.prix_traitement) : Number(cat.prix_unitaire);
    const prixTraite = basePrice * coef;
    const newArticle: OrderArticle = {
      id: uid(),
      article_id: cat.id,
      variant_id: firstVariant?.id ?? null,
      designation: firstVariant ? `${cat.designation} (${firstVariant.designation})` : cat.designation,
      base_designation: cat.designation,
      prix_unitaire: basePrice,
      quantite: 1,
      nb_pieces: Number(cat.nb_pieces) || 1,
      prix_total: prixTraite,
      couleur: '',
      signe_particulier: '',
      griffe: '',
    };
    setOrderArticles((prev) => [...prev, newArticle]);
    setSearchTerm('');
  }

  function updateOrderArticle(id: string, field: keyof OrderArticle, value: string | number | null) {
    setOrderArticles((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a;
        const coef = getSelectedCoefficient();
        if (field === 'variant_id') {
          const variant = articleVariants.find((v) => v.id === value);
          const catalogItem = catalog.find((c) => c.id === a.article_id);
          const nextBasePrice = variant
            ? Number(variant.prix_traitement)
            : Number(catalogItem?.prix_unitaire ?? a.prix_unitaire);
          const nextDesignation = variant
            ? `${a.base_designation} (${variant.designation})`
            : a.base_designation;
          const qte = a.quantite === '' ? 1 : Number(a.quantite) || 1;
          return {
            ...a,
            variant_id: variant?.id ?? null,
            designation: nextDesignation,
            prix_unitaire: nextBasePrice,
            prix_total: nextBasePrice * coef * qte,
          };
        }
        const updated = { ...a, [field]: value } as OrderArticle;
        if (field === 'quantite' || field === 'nb_pieces' || field === 'prix_unitaire') {
          const prixTraite = (Number(updated.prix_unitaire) || 0) * coef;
          const qte = updated.quantite === '' ? 0 : Number(updated.quantite) || 0;
          updated.prix_total = prixTraite * qte;
        }
        return updated;
      }),
    );
  }

  // Recalculate all article totals when treatment type changes
  useEffect(() => {
    if (selectedTypeTraitementId === '') return;
    const coef = getSelectedCoefficient();
    setOrderArticles((prev) =>
      prev.map((a) => {
        const qte = a.quantite === '' ? 1 : Number(a.quantite) || 1;
        return {
          ...a,
          prix_total: (Number(a.prix_unitaire) || 0) * coef * qte,
        };
      }),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTypeTraitementId, typesTraitement]);

  function removeOrderArticle(id: string) {
    setOrderArticles((prev) => prev.filter((a) => a.id !== id));
  }

  function addQuickPickupBag() {
    setOrderArticles((prev) => {
      const alreadyHas = prev.some(
        (a) => a.prix_unitaire === 0 && a.designation.toLowerCase().includes('inventorier'),
      );
      if (alreadyHas) return prev;
      return [
        ...prev,
        {
          id: uid(),
          article_id: null,
          variant_id: null,
          designation: fr
            ? 'Lot de linge à inventorier à la collecte'
            : 'Laundry bag to inventory at pickup',
          base_designation: fr
            ? 'Lot de linge à inventorier à la collecte'
            : 'Laundry bag to inventory at pickup',
          prix_unitaire: 0,
          quantite: 1,
          nb_pieces: 1,
          prix_total: 0,
          couleur: '',
          signe_particulier: '',
          griffe: '',
        },
      ];
    });
    setOrderError(null);
  }

  function applyServiceMode(mode: 'roundtrip' | 'pickup' | 'delivery' | 'drop_off') {
    if (mode === 'roundtrip') {
      setPickupRequested(true);
      setDeliveryRequested(true);
      setSameAddressAsPickup(true);
      if (savedHomeAddress && !pickupAddress && pickupLat === null) {
        setPickupAddress(savedHomeAddress.address);
        setPickupLat(savedHomeAddress.lat);
        setPickupLng(savedHomeAddress.lng);
      }
    } else if (mode === 'pickup') {
      setPickupRequested(true);
      setDeliveryRequested(false);
      setSameAddressAsPickup(false);
      if (savedHomeAddress && !pickupAddress && pickupLat === null) {
        setPickupAddress(savedHomeAddress.address);
        setPickupLat(savedHomeAddress.lat);
        setPickupLng(savedHomeAddress.lng);
      }
    } else if (mode === 'delivery') {
      setPickupRequested(false);
      setDeliveryRequested(true);
      setSameAddressAsPickup(false);
      if (savedHomeAddress && !deliveryAddress && deliveryLat === null) {
        setDeliveryAddress(savedHomeAddress.address);
        setDeliveryLat(savedHomeAddress.lat);
        setDeliveryLng(savedHomeAddress.lng);
      }
    } else {
      setPickupRequested(false);
      setDeliveryRequested(false);
      setSameAddressAsPickup(false);
    }
    setOrderError(null);
  }

  const orderTotal = orderArticles.reduce((sum, a) => sum + a.prix_total, 0);

  function captureDeliveryGps() {
    setDeliveryGpsLoading(true);
    setDeliveryGpsError(null);
    if (!navigator.geolocation) {
      setDeliveryGpsError(fr ? 'Géolocalisation non supportée par votre navigateur.' : 'Geolocation not supported by your browser.');
      setDeliveryGpsLoading(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDeliveryLat(pos.coords.latitude);
        setDeliveryLng(pos.coords.longitude);
        setDeliveryGpsLoading(false);
      },
      () => {
        setDeliveryGpsError(fr ? 'Impossible d\'obtenir votre position. Vérifiez les autorisations.' : 'Could not get your location. Check permissions.');
        setDeliveryGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.asin(Math.sqrt(a));
  }

  const pickupDistanceKm: number | null = (() => {
    if (!pickupRequested || !client) return null;
    if (client.delivery_latitude == null || client.delivery_longitude == null) return null;
    if (pickupLat == null || pickupLng == null) return null;
    return haversineKm(client.delivery_latitude, client.delivery_longitude, pickupLat, pickupLng);
  })();

  const deliveryDistanceKm: number | null = (() => {
    if (!deliveryRequested || !client) return null;
    if (client.delivery_latitude == null || client.delivery_longitude == null) return null;
    if (deliveryLat == null || deliveryLng == null) return null;
    return haversineKm(client.delivery_latitude, client.delivery_longitude, deliveryLat, deliveryLng);
  })();

  const deliveryFeeEstimate: number | null = (() => {
    if (!deliveryRequested || !client) return null;
    if (deliveryDistanceKm == null) return client.delivery_base_fee;
    return client.delivery_base_fee + client.delivery_price_per_km * deliveryDistanceKm;
  })();

  const pickupFeeEstimate: number | null = (() => {
    if (!pickupRequested || !client) return null;
    if (pickupDistanceKm == null) return client.delivery_base_fee;
    return client.delivery_base_fee + client.delivery_price_per_km * pickupDistanceKm;
  })();

  const currentCoef = getSelectedCoefficient();
  const clientDiscountAmount = (() => {
    if (!client) return 0;
    if (
      currentCoef <= 1 &&
      client.taux_remise > 0 &&
      client.condition_remise !== null &&
      orderTotal >= client.condition_remise
    ) {
      return (orderTotal * client.taux_remise) / 100;
    }
    return 0;
  })();

  const totalFees = (pickupFeeEstimate ?? 0) + (deliveryFeeEstimate ?? 0);
  const grandTotal = Math.max(0, orderTotal - clientDiscountAmount) + totalFees;

  function validateOrderBeforeSubmit(): string | null {
    if (orderArticles.length === 0) {
      return fr ? 'Ajoutez au moins un article à votre commande.' : 'Add at least one item to your order.';
    }
    if (typesTraitement.length > 0 && !selectedTypeTraitementId) {
      return fr ? 'Veuillez sélectionner un type de traitement.' : 'Please select a treatment type.';
    }
    if (pickupRequested) {
      if (pickupDays.length > 0 && !selectedPickupDay) {
        return fr ? 'Veuillez choisir un jour de collecte.' : 'Please select a pickup day.';
      }
      if (!pickupAddress.trim() && (pickupLat === null || pickupLng === null)) {
        return fr
          ? 'Veuillez saisir votre adresse de collecte ou indiquer votre position GPS / carte.'
          : 'Please enter your pickup address or share your GPS / map pin.';
      }
    }
    if (deliveryRequested) {
      const effectiveAddr = sameAddressAsPickup && pickupRequested ? pickupAddress : deliveryAddress;
      const effectiveLat = sameAddressAsPickup && pickupRequested ? pickupLat : deliveryLat;
      const effectiveLng = sameAddressAsPickup && pickupRequested ? pickupLng : deliveryLng;
      if (!effectiveAddr.trim() && (effectiveLat === null || effectiveLng === null)) {
        return fr
          ? 'Veuillez saisir votre adresse de livraison ou indiquer votre position GPS / carte.'
          : 'Please enter your delivery address or share your GPS / map pin.';
      }
    }
    return null;
  }

  async function handleCancelOrder(depotId: string) {
    setCancellingId(depotId);
    setCancelError(null);
    try {
      const { error } = await supabase.rpc('portal_cancel_depot', {
        p_code: code.trim().toUpperCase(),
        e_id: entrepriseId,
        p_depot_id: depotId,
      });
      if (error) throw error;
      setConfirmCancelId(null);
      await loadReleve(code.trim().toUpperCase());
    } catch {
      setCancelError(
        fr
          ? 'Impossible d’annuler en ligne pour le moment. Contactez votre pressing par téléphone.'
          : 'Unable to cancel online right now. Please contact your dry cleaner by phone.',
      );
    } finally {
      setCancellingId(null);
    }
  }

  async function submitOrder() {
    const validationErr = validateOrderBeforeSubmit();
    if (validationErr) {
      setOrderError(validationErr);
      return;
    }
    setSubmitting(true);
    setOrderError(null);
    setOrderSuccess(false);
    try {
      const selectedType = typesTraitement.find((t) => t.id === selectedTypeTraitementId) ?? null;
      const isFallbackType = Boolean(selectedType?.isFallback);
      const coef = getSelectedCoefficient();
      const articlesJson = orderArticles.map((a) => {
        const qte = a.quantite === '' ? 1 : Math.max(1, Number(a.quantite) || 1);
        const prixTrait = a.prix_unitaire * coef;
        return {
          designation: a.designation,
          // When DB RPC is unpatched (fallback treatment), bake the coefficient into prix_unitaire
          // so server-computed total (v_coef = 1.0) matches the client's selected treatment price.
          prix_unitaire: isFallbackType ? prixTrait : a.prix_unitaire,
          prix_traitement: prixTrait,
          quantite: qte,
          nb_pieces: a.nb_pieces,
          prix_total: prixTrait * qte,
          couleur: a.couleur || null,
          signe_particulier: a.signe_particulier || null,
          griffe: a.griffe || null,
        };
      });

      const finalDeliveryAddr = sameAddressAsPickup && pickupRequested ? pickupAddress : deliveryAddress;
      const finalDeliveryLat = sameAddressAsPickup && pickupRequested ? pickupLat : deliveryLat;
      const finalDeliveryLng = sameAddressAsPickup && pickupRequested ? pickupLng : deliveryLng;

      if (pickupRequested) {
        saveHomeAddressLocally(pickupAddress, pickupLat, pickupLng);
      } else if (deliveryRequested) {
        saveHomeAddressLocally(finalDeliveryAddr, finalDeliveryLat, finalDeliveryLng);
      }

      const finalNotes = isFallbackType && selectedType
        ? formatNotesWithTraitementTag(orderNotes, selectedType.libelle, selectedType.coefficient)
        : (stripTraitementTagFromNotes(orderNotes) || null);
      const fallbackRetraitDate = isFallbackType && selectedType
        ? new Date(Date.now() + selectedType.nb_jours * 86400000).toISOString()
        : null;

      const { data, error } = await supabase.rpc('portal_create_depot', {
        p_code: code.trim().toUpperCase(),
        e_id: entrepriseId,
        p_articles: articlesJson,
        p_notes: finalNotes,
        p_date_retrait: fallbackRetraitDate,
        p_type_traitement_id: isFallbackType ? null : (selectedTypeTraitementId || null),
        p_pickup_requested: pickupRequested,
        p_pickup_address: pickupRequested ? (pickupAddress.trim() || null) : null,
        p_pickup_latitude: pickupRequested ? pickupLat : null,
        p_pickup_longitude: pickupRequested ? pickupLng : null,
        p_pickup_day: pickupRequested ? composeDayAndSlot(selectedPickupDay, selectedPickupSlot) : null,
        p_delivery_requested: deliveryRequested,
        p_delivery_address: deliveryRequested ? (finalDeliveryAddr.trim() || null) : null,
        p_delivery_latitude: deliveryRequested ? finalDeliveryLat : null,
        p_delivery_longitude: deliveryRequested ? finalDeliveryLng : null,
        p_delivery_day: deliveryRequested ? composeDayAndSlot(selectedDeliveryDay, selectedDeliverySlot) : null,
      });

      if (error) throw error;
      const result = data as { depot_id: string; numero: string }[];
      if (!result || result.length === 0) throw new Error('No result');

      setOrderSuccess(true);
      setOrderArticles([]);
      setOrderNotes('');
      setPickupRequested(false);
      setPickupAddress('');
      setPickupLat(null);
      setPickupLng(null);
      setSelectedPickupDay(pickupDays.length > 0 ? pickupDays[0] : '');
      setSelectedPickupSlot('');
      setDeliveryRequested(false);
      setDeliveryAddress('');
      setDeliveryLat(null);
      setDeliveryLng(null);
      setSelectedDeliveryDay('');
      setSelectedDeliverySlot('');
      setSameAddressAsPickup(false);
      setShowPickupMap(false);
      setShowDeliveryMap(false);
      setDeliveryGpsError(null);
      await loadReleve(code.trim().toUpperCase());
      setView('releve');
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : (fr ? 'Erreur lors de la commande' : 'Error placing order'));
    } finally {
      setSubmitting(false);
    }
  }

  function startEditOrder(depot: PortalDepot) {
    const parsedFromNotes = !depot.type_traitement_id ? parseTraitementFromNotes(depot.notes) : null;
    const matchedByLabel = !depot.type_traitement_id && (depot.traitement || parsedFromNotes?.libelle)
      ? typesTraitement.find(
          (t) => t.libelle.trim().toLowerCase() === (depot.traitement || parsedFromNotes?.libelle || '').trim().toLowerCase(),
        )
      : null;
    const preAppliedCoef = !depot.type_traitement_id && parsedFromNotes && parsedFromNotes.coefficient > 1
      ? parsedFromNotes.coefficient
      : 1;

    setEditingDepotId(depot.id);
    setEditError(null);
    setView('commande');
    setOrderSuccess(false);
    setOrderError(null);
    setOrderNotes(stripTraitementTagFromNotes(depot.notes));
    setSelectedTypeTraitementId(
      depot.type_traitement_id ??
      matchedByLabel?.id ??
      (typesTraitement.length > 0 ? typesTraitement[0].id : ''),
    );
    setOrderArticles(depot.articles.map((a) => {
      const matchedCatalog = catalog.find(
        (c) => c.designation === a.designation || a.designation.startsWith(`${c.designation} (`),
      );
      const matchedVariant = matchedCatalog
        ? articleVariants.find(
            (v) =>
              v.article_id === matchedCatalog.id &&
              a.designation === `${matchedCatalog.designation} (${v.designation})`,
          )
        : undefined;
      const baseUnitPrice = preAppliedCoef > 1
        ? Math.round((Number(a.prix_unitaire) || 0) / preAppliedCoef)
        : (Number(a.prix_unitaire) || 0);
      return {
        id: uid(),
        article_id: matchedCatalog?.id ?? null,
        variant_id: matchedVariant?.id ?? null,
        designation: a.designation,
        base_designation: matchedCatalog?.designation ?? a.designation,
        prix_unitaire: baseUnitPrice,
        quantite: Math.max(1, Number(a.quantite) || 1),
        nb_pieces: Math.max(1, Number(a.nb_pieces) || 1),
        prix_total: Number(a.prix_total) || 0,
        couleur: a.couleur ?? '',
        signe_particulier: a.signe_particulier && a.signe_particulier !== 'AUCUN' ? a.signe_particulier : '',
        griffe: a.griffe && a.griffe !== 'AUCUN' ? a.griffe : '',
      };
    }));
    const parsedPickup = parseDayAndSlot(depot.pickup_day);
    const parsedDelivery = parseDayAndSlot(depot.delivery_day);
    setPickupRequested(depot.pickup_requested ?? false);
    setPickupAddress(depot.pickup_address ?? '');
    setPickupLat(depot.pickup_latitude ?? null);
    setPickupLng(depot.pickup_longitude ?? null);
    setSelectedPickupDay(parsedPickup.day || (pickupDays.length > 0 ? pickupDays[0] : ''));
    setSelectedPickupSlot(parsedPickup.slot);
    setDeliveryRequested(depot.delivery_requested ?? false);
    setDeliveryAddress(depot.delivery_address ?? '');
    setDeliveryLat(depot.delivery_latitude ?? null);
    setDeliveryLng(depot.delivery_longitude ?? null);
    setSelectedDeliveryDay(parsedDelivery.day);
    setSelectedDeliverySlot(parsedDelivery.slot);
    const sameAddr =
      Boolean(depot.pickup_requested) &&
      Boolean(depot.delivery_requested) &&
      (depot.pickup_address ?? '') === (depot.delivery_address ?? '') &&
      depot.pickup_latitude === depot.delivery_latitude &&
      depot.pickup_longitude === depot.delivery_longitude;
    setSameAddressAsPickup(sameAddr);
    setShowPickupMap(false);
    setShowDeliveryMap(false);
    setDeliveryGpsError(null);
    setSearchTerm('');
  }

  function cancelEdit() {
    setEditingDepotId(null);
    setEditError(null);
    setOrderArticles([]);
    setOrderNotes('');
    setOrderError(null);
    setOrderSuccess(false);
    setPickupRequested(false);
    setPickupAddress('');
    setPickupLat(null);
    setPickupLng(null);
    setSelectedPickupDay(pickupDays.length > 0 ? pickupDays[0] : '');
    setSelectedPickupSlot('');
    setDeliveryRequested(false);
    setDeliveryAddress('');
    setDeliveryLat(null);
    setDeliveryLng(null);
    setSelectedDeliveryDay('');
    setSelectedDeliverySlot('');
    setSameAddressAsPickup(false);
    setShowPickupMap(false);
    setShowDeliveryMap(false);
    setDeliveryGpsError(null);
    setSearchTerm('');
    setView('releve');
  }

  async function submitEditOrder() {
    if (!editingDepotId) return;
    const validationErr = validateOrderBeforeSubmit();
    if (validationErr) {
      setOrderError(validationErr);
      return;
    }
    setEditLoading(true);
    setEditError(null);
    setOrderError(null);
    try {
      const selectedType = typesTraitement.find((t) => t.id === selectedTypeTraitementId) ?? null;
      const isFallbackType = Boolean(selectedType?.isFallback);
      const coef = getSelectedCoefficient();
      const articlesJson = orderArticles.map((a) => {
        const qte = a.quantite === '' ? 1 : Math.max(1, Number(a.quantite) || 1);
        const prixTrait = a.prix_unitaire * coef;
        return {
          designation: a.designation,
          prix_unitaire: isFallbackType ? prixTrait : a.prix_unitaire,
          prix_traitement: prixTrait,
          quantite: qte,
          nb_pieces: a.nb_pieces,
          prix_total: prixTrait * qte,
          couleur: a.couleur || null,
          signe_particulier: a.signe_particulier || null,
          griffe: a.griffe || null,
        };
      });

      const finalDeliveryAddr = sameAddressAsPickup && pickupRequested ? pickupAddress : deliveryAddress;
      const finalDeliveryLat = sameAddressAsPickup && pickupRequested ? pickupLat : deliveryLat;
      const finalDeliveryLng = sameAddressAsPickup && pickupRequested ? pickupLng : deliveryLng;

      if (pickupRequested) {
        saveHomeAddressLocally(pickupAddress, pickupLat, pickupLng);
      } else if (deliveryRequested) {
        saveHomeAddressLocally(finalDeliveryAddr, finalDeliveryLat, finalDeliveryLng);
      }

      const { error } = await supabase.rpc('portal_update_depot', {
        p_code: code.trim().toUpperCase(),
        e_id: entrepriseId,
        p_depot_id: editingDepotId,
        p_articles: articlesJson,
        p_type_traitement_id: isFallbackType ? null : (selectedTypeTraitementId || null),
        p_pickup_requested: pickupRequested,
        p_pickup_address: pickupRequested ? (pickupAddress.trim() || null) : null,
        p_pickup_latitude: pickupRequested ? pickupLat : null,
        p_pickup_longitude: pickupRequested ? pickupLng : null,
        p_pickup_day: pickupRequested ? composeDayAndSlot(selectedPickupDay, selectedPickupSlot) : null,
        p_delivery_requested: deliveryRequested,
        p_delivery_address: deliveryRequested ? (finalDeliveryAddr.trim() || null) : null,
        p_delivery_latitude: deliveryRequested ? finalDeliveryLat : null,
        p_delivery_longitude: deliveryRequested ? finalDeliveryLng : null,
        p_delivery_day: deliveryRequested ? composeDayAndSlot(selectedDeliveryDay, selectedDeliverySlot) : null,
      });

      if (error) throw error;

      setEditingDepotId(null);
      setOrderArticles([]);
      setOrderNotes('');
      setPickupRequested(false);
      setPickupAddress('');
      setPickupLat(null);
      setPickupLng(null);
      setSelectedPickupDay(pickupDays.length > 0 ? pickupDays[0] : '');
      setSelectedPickupSlot('');
      setDeliveryRequested(false);
      setDeliveryAddress('');
      setDeliveryLat(null);
      setDeliveryLng(null);
      setSelectedDeliveryDay('');
      setSelectedDeliverySlot('');
      setSameAddressAsPickup(false);
      setShowPickupMap(false);
      setShowDeliveryMap(false);
      setDeliveryGpsError(null);
      setOrderSuccess(true);
      await loadReleve(code.trim().toUpperCase());
      setView('releve');
    } catch (err) {
      setEditError(err instanceof Error ? err.message : (fr ? 'Erreur lors de la modification' : 'Error updating order'));
    } finally {
      setEditLoading(false);
    }
  }

  const filteredCatalog = searchTerm.trim()
    ? catalog.filter((c) => c.designation.toLowerCase().includes(searchTerm.trim().toLowerCase()))
    : catalog;

  // ─── Login screen (showcase + login + signup) ──────────────
  if (!client) {
    const entName = entrepriseInfo?.nom || (fr ? 'Notre pressing' : 'Our dry cleaner');
    const entSlogan = entrepriseInfo?.slogan;
    const entLogo = entrepriseInfo?.logo_url;

    // Signup success screen
    if (signupResult) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-sky-50 flex items-center justify-center px-4 py-8">
          <div className="max-w-sm w-full">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 text-center space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8 text-emerald-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  {fr ? 'Inscription réussie !' : 'Registration successful!'}
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  {fr ? `Bienvenue ${signupResult.nom}, votre compte a été créé.` : `Welcome ${signupResult.nom}, your account has been created.`}
                </p>
              </div>
              <div className="rounded-xl bg-sky-50 border border-sky-100 p-4">
                <p className="text-xs text-slate-500 mb-1">
                  {fr ? 'Votre code client' : 'Your client code'}
                </p>
                <p className="text-2xl font-bold tracking-widest text-sky-600">{signupResult.code}</p>
              </div>
              <p className="text-xs text-slate-400">
                {fr ? 'Notez ce code, il vous servira à chaque connexion.' : 'Save this code, you\'ll need it to log in each time.'}
              </p>
              <button
                onClick={() => {
                  setCode(signupResult.code);
                  setSignupResult(null);
                  setShowSignup(false);
                  handleLogin();
                }}
                className="w-full px-4 py-3 rounded-lg bg-sky-500 text-white font-medium text-sm hover:bg-sky-600 transition-colors flex items-center justify-center gap-2"
              >
                <Lock className="w-4 h-4" /> {fr ? 'Accéder à mon espace' : 'Access my account'}
              </button>
              <button
                onClick={() => setSignupResult(null)}
                className="w-full px-4 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                {fr ? 'Retour' : 'Back'}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-sky-50">
        <div className="max-w-md mx-auto px-4 py-8">
          {/* ─── Showcase header ─── */}
          <div className="text-center mb-6">
            <div className="w-16 h-16 rounded-2xl bg-sky-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-sky-200 overflow-hidden">
              {entLogo ? (
                <img src={entLogo} alt={entName} className="w-full h-full object-cover" />
              ) : (
                <Store className="w-8 h-8 text-white" />
              )}
            </div>
            <h1 className="text-xl font-bold text-slate-900">{entName}</h1>
            {entSlogan && (
              <p className="text-sm text-sky-600 mt-1 font-medium">{entSlogan}</p>
            )}
          </div>

          {/* ─── Showcase features ─── */}
          {!showSignup && (
            <div className="space-y-3 mb-6">
              {[
                { icon: ShoppingCart, title: fr ? 'Commandez en ligne 24h/24' : 'Order online 24/7', desc: fr ? 'Choisissez vos articles et passez commande à tout moment' : 'Choose your items and place orders anytime' },
                { icon: Receipt, title: fr ? 'Suivez vos commandes' : 'Track your orders', desc: fr ? 'Consultez votre relevé et l\'état de vos dépôts en temps réel' : 'View your statement and deposit status in real time' },
                { icon: Truck, title: fr ? 'Collecte & livraison à domicile' : 'Home pickup & delivery', desc: fr ? 'Demandez la collecte et la livraison sans vous déplacer' : 'Request pickup and delivery without leaving home' },
                { icon: ShieldCheck, title: fr ? 'Vos informations en sécurité' : 'Your data is secure', desc: fr ? 'Accédez à votre compte avec votre code client unique' : 'Access your account with your unique client code' },
              ].map((f, i) => (
                <div key={i} className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-sky-50 flex items-center justify-center flex-shrink-0">
                    <f.icon className="w-5 h-5 text-sky-500" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{f.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ─── Login form ─── */}
          {!showSignup && (
            <>
              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    {fr ? 'J\'ai déjà un code client' : 'I already have a client code'}
                  </label>
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleLogin(); }}
                    placeholder="ABC123"
                    maxLength={6}
                    className="w-full px-4 py-3 rounded-lg border border-slate-200 text-center text-lg font-bold tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                  />
                </div>

                {loginError && (
                  <p className="text-sm text-red-600 text-center">{loginError}</p>
                )}

                <button
                  onClick={handleLogin}
                  disabled={!code.trim() || loggingIn}
                  className="w-full px-4 py-3 rounded-lg bg-sky-500 text-white font-medium text-sm hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loggingIn ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {fr ? 'Connexion…' : 'Connecting…'}
                    </>
                  ) : (
                    <>
                      <Lock className="w-4 h-4" /> {fr ? 'Se connecter' : 'Log in'}
                    </>
                  )}
                </button>
              </div>

              {/* Divider */}
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-xs text-slate-400 font-medium">{fr ? 'OU' : 'OR'}</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>

              {/* New client signup button */}
              <button
                onClick={() => setShowSignup(true)}
                className="w-full px-4 py-3 rounded-lg bg-white border border-sky-200 text-sky-700 font-medium text-sm hover:bg-sky-50 transition-colors flex items-center justify-center gap-2"
              >
                <UserPlus className="w-4 h-4" />
                {fr ? 'Nouveau client ? Créer mon compte' : 'New client? Create my account'}
              </button>
            </>
          )}

          {/* ─── Signup form ─── */}
          {showSignup && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-900">
                  {fr ? 'Créer mon compte client' : 'Create my client account'}
                </h2>
                <button
                  onClick={() => { setShowSignup(false); setSignupError(null); }}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  {fr ? 'Nom complet *' : 'Full name *'}
                </label>
                <input
                  type="text"
                  value={signupNom}
                  onChange={(e) => setSignupNom(e.target.value)}
                  placeholder={fr ? 'Ex: Awa Diallo' : 'Ex: Jane Doe'}
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  {fr ? 'Téléphone (optionnel)' : 'Phone (optional)'}
                </label>
                <input
                  type="tel"
                  value={signupTel}
                  onChange={(e) => setSignupTel(e.target.value)}
                  placeholder={fr ? 'Ex: 77 123 45 67' : 'Ex: +1 234 567 8900'}
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                />
                <p className="text-xs text-slate-400 mt-1">
                  {fr ? 'Pour vous contacter concernant vos commandes' : 'So we can contact you about your orders'}
                </p>
              </div>

              {signupError && (
                <p className="text-sm text-red-600 text-center">{signupError}</p>
              )}

              <button
                onClick={handleSignup}
                disabled={!signupNom.trim() || signupLoading}
                className="w-full px-4 py-3 rounded-lg bg-emerald-500 text-white font-medium text-sm hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {signupLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {fr ? 'Création…' : 'Creating…'}
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4" /> {fr ? 'Créer mon compte' : 'Create my account'}
                  </>
                )}
              </button>

              <p className="text-xs text-slate-400 text-center">
                {fr ? 'Vous recevrez un code client unique pour accéder à votre espace.' : 'You\'ll receive a unique client code to access your account.'}
              </p>
            </div>
          )}

          {/* ─── Enterprise contact info (showcase) ─── */}
          {!showSignup && (entrepriseInfo?.telephone || entrepriseInfo?.adresse || entrepriseInfo?.ville) && (
            <div className="mt-6 bg-white/60 rounded-xl border border-slate-100 p-4 space-y-2">
              {entrepriseInfo.telephone && (
                <a href={`tel:${entrepriseInfo.telephone}`} className="flex items-center gap-2 text-sm text-slate-600 hover:text-sky-600 transition-colors">
                  <Phone className="w-4 h-4 text-sky-500" /> {entrepriseInfo.telephone}
                </a>
              )}
              {(entrepriseInfo.adresse || entrepriseInfo.ville) && (
                <p className="flex items-center gap-2 text-sm text-slate-600">
                  <MapPin className="w-4 h-4 text-sky-500" />
                  {[entrepriseInfo.adresse, entrepriseInfo.ville].filter(Boolean).join(', ')}
                </p>
              )}
            </div>
          )}

          {/* Install app button */}
          {!showSignup && canInstall && !installed && (
            <button
              onClick={() => {
                if (hasInstallPrompt) {
                  promptInstall();
                } else {
                  setShowInstallModal(true);
                }
              }}
              className="w-full mt-4 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-sky-50 border border-sky-200 text-sky-700 text-sm font-medium hover:bg-sky-100 transition-colors"
            >
              <Download className="w-4 h-4" />
              {fr ? 'Installer l\'application sur mon téléphone' : 'Install app on my phone'}
            </button>
          )}
          {!showSignup && installed && (
            <div className="mt-4 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-700 text-xs font-medium">
              <CheckCircle2 className="w-4 h-4" />
              {fr ? 'Application installée' : 'App installed'}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Logged in ────────────────────────────────────────────
  const totalMontant = depots.reduce((s, d) => s + Number(d.total), 0);
  const totalPaye = depots.reduce((s, d) => {
    const avance = Number(d.avance_amount) ?? 0;
    const extraAvances = d.avances.reduce((s2, a) => s2 + Number(a.montant), 0);
    const mode = d.mode_reglement;
    const paye = mode === 'PAYER_DEPOT' ? Number(d.total) : mode === 'AVANCE' ? avance + extraAvances : mode === 'SOLDE' ? Number(d.total) : extraAvances;
    return s + paye;
  }, 0);
  const totalReste = totalMontant - totalPaye;

  return (
    <div className="min-h-screen bg-slate-50 pb-8">
      {/* Header */}
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 px-4 py-6">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wide">{client.entreprise_nom}</p>
              <h1 className="text-xl font-bold text-white mt-0.5">{client.client_nom}</h1>
              {client.client_telephone && (
                <p className="text-sm text-slate-400 mt-0.5 flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5" /> {client.client_telephone}
                </p>
              )}
            </div>
            <button
              onClick={logout}
              className="px-3 py-2 rounded-lg bg-white/10 text-white text-xs font-medium hover:bg-white/20 transition-colors"
            >
              {fr ? 'Déconnexion' : 'Log out'}
            </button>
          </div>

          {/* Enterprise contact */}
          <div className="flex flex-wrap gap-4 mt-4 text-xs text-slate-400">
            {client.entreprise_telephone && (
              <span className="flex items-center gap-1.5">
                <Phone className="w-3 h-3" /> {client.entreprise_telephone}
              </span>
            )}
            {(client.entreprise_adresse || client.entreprise_ville) && (
              <span className="flex items-center gap-1.5">
                <MapPin className="w-3 h-3" />
                {[client.entreprise_adresse, client.entreprise_ville].filter(Boolean).join(', ')}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 mt-5 space-y-5">
        {/* Tab switcher */}
        <div className="flex gap-2 bg-white rounded-xl border border-slate-100 p-1.5">
          <button
            onClick={() => setView('releve')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
              view === 'releve' ? 'bg-sky-500 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            <Receipt className="w-4 h-4" /> {fr ? 'Mon relevé' : 'My statement'}
          </button>
          <button
            onClick={() => { setView('commande'); setOrderSuccess(false); setOrderError(null); }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
              view === 'commande' ? 'bg-sky-500 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            <ShoppingCart className="w-4 h-4" /> {fr ? 'Nouvelle commande' : 'New order'}
          </button>
        </div>

        {/* ─── Releve view ─── */}
        {view === 'releve' && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 text-center">
                <p className="text-xs text-slate-400 uppercase tracking-wide">{fr ? 'Dépôts' : 'Deposits'}</p>
                <p className="text-lg font-bold text-slate-900 mt-1">{depots.length}</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 text-center">
                <p className="text-xs text-slate-400 uppercase tracking-wide">{fr ? 'Total payé' : 'Total paid'}</p>
                <p className="text-lg font-bold text-emerald-600 mt-1">{formatPrice(totalPaye)}</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 text-center">
                <p className="text-xs text-slate-400 uppercase tracking-wide">{fr ? 'Reste à payer' : 'Remaining'}</p>
                <p className="text-lg font-bold text-red-600 mt-1">{formatPrice(totalReste)}</p>
              </div>
            </div>

            {/* Depot list */}
            {loadingReleve ? (
              <div className="text-center py-12">
                <Loader2 className="w-6 h-6 text-sky-500 animate-spin mx-auto" />
              </div>
            ) : depots.length === 0 ? (
              <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-8 text-center">
                <Package className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <p className="text-sm text-slate-400">
                  {fr ? 'Aucun dépôt pour le moment. Créez une commande pour commencer !' : 'No deposits yet. Place an order to get started!'}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {cancelError && (
                  <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800 flex items-center justify-between gap-2">
                    <span>{cancelError}</span>
                    <button onClick={() => setCancelError(null)} className="text-amber-600 hover:text-amber-800">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-slate-500">
                    {fr ? 'Suivi en temps réel de vos commandes' : 'Real-time tracking of your orders'}
                  </p>
                  <button
                    type="button"
                    onClick={() => void loadReleve(code.trim().toUpperCase())}
                    disabled={loadingReleve}
                    className="inline-flex items-center gap-1 text-xs font-medium text-sky-600 hover:text-sky-700 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingReleve ? 'animate-spin' : ''}`} />
                    {fr ? 'Actualiser' : 'Refresh'}
                  </button>
                </div>
                {depots.map((depot) => {
                  const avance = Number(depot.avance_amount) ?? 0;
                  const extraAvances = depot.avances.reduce((s2, a) => s2 + Number(a.montant), 0);
                  const mode = depot.mode_reglement;
                  const paye = mode === 'PAYER_DEPOT' ? Number(depot.total) : mode === 'AVANCE' ? avance + extraAvances : mode === 'SOLDE' ? Number(depot.total) : extraAvances;
                  const reste = Math.max(0, Number(depot.total) - paye);

                  // Step-by-step lifecycle tracker
                  const isCollected = Boolean(depot.collected_at) || depot.statut === 'EN_COURS' || depot.statut === 'RETIRE';
                  const isProcessing = depot.statut === 'EN_COURS' || depot.statut === 'RETIRE';
                  const isReady = Boolean(depot.ready_for_delivery) || depot.statut === 'RETIRE';
                  const isDone = depot.statut === 'RETIRE';

                  const steps: { key: string; label: string; done: boolean; active: boolean }[] = [
                    {
                      key: 'ordered',
                      label: fr ? 'Commandé' : 'Ordered',
                      done: true,
                      active: depot.statut === 'COMMANDE',
                    },
                    ...(depot.pickup_requested
                      ? [{
                          key: 'collected',
                          label: fr ? 'Collecté' : 'Picked up',
                          done: isCollected,
                          active: depot.statut === 'COMMANDE' && Boolean(depot.collected_at),
                        }]
                      : []),
                    {
                      key: 'processing',
                      label: fr ? 'Traitement' : 'Processing',
                      done: isProcessing,
                      active: depot.statut === 'EN_COURS' && !depot.ready_for_delivery,
                    },
                    ...(depot.delivery_requested
                      ? [{
                          key: 'ready',
                          label: fr ? 'Prêt livr.' : 'Ready',
                          done: isReady,
                          active: depot.statut === 'EN_COURS' && Boolean(depot.ready_for_delivery),
                        }]
                      : []),
                    {
                      key: 'done',
                      label: depot.delivery_requested ? (fr ? 'Livré' : 'Delivered') : (fr ? 'Retiré' : 'Picked up'),
                      done: isDone,
                      active: isDone,
                    },
                  ];

                  const statusLabel =
                    depot.statut === 'COMMANDE'
                      ? (depot.pickup_requested
                          ? (fr ? 'En attente de collecte' : 'Awaiting pickup')
                          : (fr ? 'Commande en attente' : 'Pending order'))
                      : depot.statut === 'EN_COURS'
                        ? (depot.delivery_requested && depot.ready_for_delivery
                            ? (fr ? 'Prêt à livrer' : 'Ready for delivery')
                            : (fr ? 'En traitement' : 'Processing'))
                        : (depot.delivery_requested
                            ? (fr ? 'Livré' : 'Delivered')
                            : (fr ? 'Retiré' : 'Picked up'));

                  const statusBadgeClass =
                    depot.statut === 'COMMANDE'
                      ? 'bg-sky-100 text-sky-700'
                      : depot.statut === 'EN_COURS'
                        ? (depot.delivery_requested && depot.ready_for_delivery
                            ? 'bg-violet-100 text-violet-700'
                            : 'bg-amber-100 text-amber-700')
                        : 'bg-emerald-100 text-emerald-700';

                  return (
                    <div key={depot.id} className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                      <div className="flex items-center justify-between px-5 py-3.5 bg-slate-50/50 border-b border-slate-50 gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-slate-900">
                              {depot.numero ?? (fr ? 'Commande en attente' : 'Pending order')}
                            </p>
                            {(() => {
                              const label = resolveDepotTreatmentLabel(depot);
                              if (!label) return null;
                              const coef = resolveDepotTreatmentCoefficient(depot);
                              return (
                                <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                                  <Sparkles className="w-3 h-3" />
                                  {label}{coef !== 1 ? ` (×${coef})` : ''}
                                </span>
                              );
                            })()}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {formatDateShort(depot.date_depot)}
                            {depot.date_retrait_prevue && (
                              <>
                                {' · '}
                                {depot.delivery_requested ? (fr ? 'Livraison prévue :' : 'Est. delivery:') : (fr ? 'Retrait prévu :' : 'Est. pickup:')}{' '}
                                <span className="text-slate-600 font-medium">{formatDateShort(depot.date_retrait_prevue)}</span>
                              </>
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-2.5 flex-shrink-0">
                          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusBadgeClass}`}>
                            {statusLabel}
                          </span>
                          <p className="text-sm font-bold text-slate-900">{formatPrice(Number(depot.total))}</p>
                        </div>
                      </div>

                      {/* Step-by-step progress timeline */}
                      <div className="px-5 py-3 bg-white border-b border-slate-50">
                        <div className="flex items-center justify-between gap-1">
                          {steps.map((st, idx) => (
                            <div key={st.key} className="flex-1 flex items-center">
                              <div className="flex flex-col items-center flex-shrink-0">
                                <div
                                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors ${
                                    st.done
                                      ? st.active
                                        ? 'bg-sky-500 text-white ring-4 ring-sky-100'
                                        : 'bg-emerald-500 text-white'
                                      : 'bg-slate-100 text-slate-400'
                                  }`}
                                >
                                  {st.done ? <Check className="w-3.5 h-3.5" /> : idx + 1}
                                </div>
                                <span
                                  className={`text-[10px] mt-1 font-medium text-center leading-tight ${
                                    st.active
                                      ? 'text-sky-700'
                                      : st.done
                                        ? 'text-slate-700'
                                        : 'text-slate-400'
                                  }`}
                                >
                                  {st.label}
                                </span>
                              </div>
                              {idx < steps.length - 1 && (
                                <div
                                  className={`h-0.5 flex-1 mx-1 -mt-4 rounded-full ${
                                    steps[idx + 1].done ? 'bg-emerald-400' : 'bg-slate-200'
                                  }`}
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Logistics details (pickup / delivery / notes) */}
                      {(() => {
                        const cleanNotes = stripTraitementTagFromNotes(depot.notes);
                        if (!depot.pickup_requested && !depot.delivery_requested && !cleanNotes) return null;
                        return (
                          <div className="px-5 py-2.5 bg-slate-50/40 border-b border-slate-50 space-y-1.5 text-xs">
                            {depot.pickup_requested && (
                              <div className="flex items-start gap-2 text-amber-800">
                                <Truck className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
                                <div className="min-w-0 flex-1">
                                  <span className="font-semibold">{fr ? 'Collecte :' : 'Pickup:'}</span>{' '}
                                  {depot.pickup_day && (
                                    <span className="font-medium">{formatDayAndSlotLabel(depot.pickup_day, fr)} · </span>
                                  )}
                                  <span>{depot.pickup_address || (fr ? 'Position GPS partagée' : 'GPS location shared')}</span>
                                  {Number(depot.frais_collecte || 0) > 0 && (
                                    <span className="ml-1.5 text-amber-700 font-medium">
                                      ({formatPrice(Number(depot.frais_collecte))})
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                            {depot.delivery_requested && (
                              <div className="flex items-start gap-2 text-sky-800">
                                <Home className="w-3.5 h-3.5 text-sky-600 flex-shrink-0 mt-0.5" />
                                <div className="min-w-0 flex-1">
                                  <span className="font-semibold">{fr ? 'Livraison :' : 'Delivery:'}</span>{' '}
                                  {depot.delivery_day && (
                                    <span className="font-medium">{formatDayAndSlotLabel(depot.delivery_day, fr)} · </span>
                                  )}
                                  <span>{depot.delivery_address || (fr ? 'Position GPS partagée' : 'GPS location shared')}</span>
                                  {Number(depot.frais_livraison || 0) > 0 && (
                                    <span className="ml-1.5 text-sky-700 font-medium">
                                      ({formatPrice(Number(depot.frais_livraison))})
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                            {cleanNotes && (
                              <div className="flex items-start gap-2 text-slate-600">
                                <FileText className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
                                <span className="italic">{cleanNotes}</span>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      <div className="px-5 py-3 space-y-1.5">
                        {depot.articles.map((art) => (
                          <div key={art.id} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="w-1.5 h-1.5 rounded-full bg-sky-400 flex-shrink-0" />
                              <span className="text-slate-700 truncate">{art.designation}</span>
                              <span className="text-xs text-slate-400 flex-shrink-0">
                                ({Number(art.quantite) || 1}× · {(Number(art.nb_pieces) || 1) * (Number(art.quantite) || 1)} {fr ? 'pcs' : 'pcs'})
                              </span>
                            </div>
                            <span className="text-slate-600 flex-shrink-0 ml-2">{formatPrice(Number(art.prix_total))}</span>
                          </div>
                        ))}
                      </div>
                      <div className="px-5 py-3 border-t border-slate-50 flex items-center justify-between text-sm">
                        <span className="text-slate-500">{fr ? 'Payé' : 'Paid'}: <span className="text-emerald-600 font-medium">{formatPrice(paye)}</span></span>
                        <span className="text-slate-500">{fr ? 'Reste' : 'Remaining'}: <span className={reste > 0 ? 'text-red-600 font-medium' : 'text-slate-400'}>{formatPrice(reste)}</span></span>
                      </div>
                      {client.entreprise_telephone && depot.statut !== 'RETIRE' && (() => {
                        const refLabel = depot.numero ?? (fr ? 'ma commande en attente' : 'my pending order');
                        const waText = fr
                          ? `Bonjour ${client.entreprise_nom}, je suis ${client.client_nom}. Je souhaite un suivi concernant ${refLabel}.`
                          : `Hello ${client.entreprise_nom}, this is ${client.client_nom}. I'd like an update on ${refLabel}.`;
                        const waHref = buildWhatsAppUrl(client.entreprise_telephone, waText);
                        return (
                          <div className="px-5 py-2.5 border-t border-slate-50 bg-slate-50/40 flex flex-wrap items-center gap-2">
                            {waHref && (
                              <a
                                href={waHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium hover:bg-emerald-100 transition-colors"
                              >
                                <MessageCircle className="w-3.5 h-3.5" />
                                {fr ? 'Contacter sur WhatsApp' : 'Message on WhatsApp'}
                              </a>
                            )}
                            <a
                              href={`tel:${client.entreprise_telephone}`}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-xs font-medium hover:bg-slate-50 transition-colors"
                            >
                              <Phone className="w-3.5 h-3.5" />
                              {fr ? 'Appeler le pressing' : 'Call dry cleaner'}
                            </a>
                          </div>
                        );
                      })()}
                      {depot.statut === 'COMMANDE' && (
                        <div className="px-5 pb-3.5 pt-2 border-t border-slate-50 space-y-2">
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => startEditOrder(depot)}
                              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-sky-50 border border-sky-200 text-sky-700 text-sm font-medium hover:bg-sky-100 transition-colors"
                            >
                              <Pencil className="w-4 h-4" />
                              {fr ? 'Modifier' : 'Edit'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmCancelId(confirmCancelId === depot.id ? null : depot.id)}
                              className="px-3.5 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-sm font-medium hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors flex items-center gap-1.5"
                            >
                              <Trash2 className="w-4 h-4" />
                              {fr ? 'Annuler' : 'Cancel'}
                            </button>
                          </div>
                          {confirmCancelId === depot.id && (
                            <div className="rounded-lg bg-red-50 border border-red-200 p-3 flex items-center justify-between gap-2">
                              <p className="text-xs text-red-700 font-medium">
                                {fr ? 'Confirmer l’annulation de cette commande ?' : 'Confirm cancelling this order?'}
                              </p>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                <button
                                  type="button"
                                  onClick={() => setConfirmCancelId(null)}
                                  className="px-2.5 py-1 rounded bg-white border border-slate-200 text-xs text-slate-600 hover:bg-slate-50"
                                >
                                  {fr ? 'Non' : 'No'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleCancelOrder(depot.id)}
                                  disabled={cancellingId === depot.id}
                                  className="px-2.5 py-1 rounded bg-red-600 text-white text-xs font-medium hover:bg-red-700 disabled:opacity-50 inline-flex items-center gap-1"
                                >
                                  {cancellingId === depot.id && <Loader2 className="w-3 h-3 animate-spin" />}
                                  {fr ? 'Oui, annuler' : 'Yes, cancel'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ─── Commande view ─── */}
        {view === 'commande' && (
          <>
            {orderSuccess && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 text-center">
                <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
                  <Check className="w-6 h-6 text-emerald-600" />
                </div>
                <p className="text-sm font-semibold text-emerald-700">
                  {editingDepotId
                    ? (fr ? 'Commande modifiée avec succès !' : 'Order updated successfully!')
                    : (fr ? 'Commande créée avec succès !' : 'Order created successfully!')}
                </p>
                <p className="text-xs text-emerald-600 mt-1">
                  {fr ? 'Votre pressing va traiter votre demande.' : 'Your dry cleaner will process your request.'}
                </p>
                <button
                  onClick={() => { setOrderSuccess(false); setEditingDepotId(null); }}
                  className="mt-4 px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 transition-colors"
                >
                  {fr ? 'Nouvelle commande' : 'New order'}
                </button>
              </div>
            )}

            {!orderSuccess && (
              <>
                {/* Edit mode banner */}
                {editingDepotId && (
                  <div className="rounded-xl bg-sky-50 border border-sky-200 p-4 flex items-center gap-3">
                    <Pencil className="w-5 h-5 text-sky-600 flex-shrink-0" />
                    <p className="text-sm font-medium text-sky-800 flex-1">
                      {fr ? 'Vous modifiez une commande non collectée' : 'You are editing an uncollected order'}
                    </p>
                    <button
                      onClick={cancelEdit}
                      className="px-3 py-1.5 rounded-lg bg-white border border-sky-200 text-sky-700 text-xs font-medium hover:bg-sky-100 transition-colors"
                    >
                      {fr ? 'Annuler' : 'Cancel'}
                    </button>
                  </div>
                )}

                {/* Service mode quick selector — always visible so clients immediately see door-to-door options */}
                <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <ArrowLeftRight className="w-4 h-4 text-sky-500" />
                    <h3 className="text-sm font-semibold text-slate-900">
                      {fr ? 'Mode de prise en charge' : 'Service mode'}
                    </h3>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    {([
                      {
                        key: 'roundtrip' as const,
                        active: pickupRequested && deliveryRequested,
                        icon: ArrowLeftRight,
                        title: fr ? 'Collecte + Livraison' : 'Pickup + Delivery',
                        sub: fr ? 'Aller-retour à domicile' : 'Full door-to-door',
                        badge: fr ? 'Complet' : 'Full',
                      },
                      {
                        key: 'pickup' as const,
                        active: pickupRequested && !deliveryRequested,
                        icon: Truck,
                        title: fr ? 'Collecte à domicile' : 'Home pickup',
                        sub: fr ? 'Retrait au pressing' : 'Shop pickup after',
                        badge: null,
                      },
                      {
                        key: 'delivery' as const,
                        active: !pickupRequested && deliveryRequested,
                        icon: Home,
                        title: fr ? 'Livraison à domicile' : 'Home delivery',
                        sub: fr ? 'Je dépose au pressing' : 'I drop off at shop',
                        badge: null,
                      },
                      {
                        key: 'drop_off' as const,
                        active: !pickupRequested && !deliveryRequested,
                        icon: Store,
                        title: fr ? 'Au pressing' : 'In-store',
                        sub: fr ? 'Dépôt et retrait sur place' : 'Drop off & pick up',
                        badge: null,
                      },
                    ]).map((opt) => {
                      const Icon = opt.icon;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => applyServiceMode(opt.key)}
                          className={`p-3 rounded-xl border text-left transition-all flex items-start gap-2.5 ${
                            opt.active
                              ? 'border-sky-500 bg-sky-50/70 ring-1 ring-sky-200'
                              : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60'
                          }`}
                        >
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                            opt.active ? 'bg-sky-500 text-white' : 'bg-slate-100 text-slate-500'
                          }`}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className={`text-xs font-semibold leading-tight ${opt.active ? 'text-sky-900' : 'text-slate-800'}`}>
                                {opt.title}
                              </p>
                              {opt.badge && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                                  {opt.badge}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{opt.sub}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Treatment type selector — always visible so client explicitly picks treatment */}
                <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-sky-500" />
                      <h3 className="text-sm font-semibold text-slate-900">
                        {fr ? 'Type de traitement' : 'Treatment type'}
                        <span className="text-red-500 ml-0.5">*</span>
                      </h3>
                    </div>
                    {selectedTypeTraitementId && getSelectedTypeLibelle() && (
                      <span className="text-xs font-medium text-sky-700 bg-sky-50 border border-sky-100 px-2 py-0.5 rounded-md">
                        {getSelectedTypeLibelle()} · ×{getSelectedCoefficient()}
                      </span>
                    )}
                  </div>

                  {typesLoading ? (
                    <div className="flex items-center justify-center gap-2 py-4 text-xs text-slate-400">
                      <Loader2 className="w-4 h-4 animate-spin text-sky-500" />
                      {fr ? 'Chargement des types de traitement…' : 'Loading treatment types…'}
                    </div>
                  ) : typesTraitement.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      {typesTraitement.map((t) => {
                        const isSelected = selectedTypeTraitementId === t.id;
                        return (
                          <button
                            type="button"
                            key={t.id}
                            onClick={() => setSelectedTypeTraitementId(t.id)}
                            className={`relative px-3.5 py-3 rounded-xl border text-sm font-medium transition-all text-left ${
                              isSelected
                                ? 'border-sky-500 bg-sky-50 text-sky-800 ring-2 ring-sky-500/20 shadow-xs'
                                : 'border-slate-200 text-slate-700 hover:border-sky-300 hover:bg-sky-50/40'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="font-semibold truncate">{t.libelle}</span>
                              {isSelected && (
                                <span className="w-4 h-4 rounded-full bg-sky-500 text-white flex items-center justify-center flex-shrink-0">
                                  <Check className="w-2.5 h-2.5" />
                                </span>
                              )}
                            </div>
                            <span className={`text-xs mt-1 flex items-center gap-1.5 ${isSelected ? 'text-sky-600' : 'text-slate-400'}`}>
                              <span className="font-mono font-medium">×{t.coefficient}</span>
                              <span>·</span>
                              <span className="inline-flex items-center gap-0.5">
                                <Clock className="w-3 h-3" />
                                {t.nb_jours}{fr ? 'j' : 'd'}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-lg bg-amber-50 border border-amber-200/80 p-3 flex items-center justify-between gap-3">
                      <p className="text-xs text-amber-800">
                        {typesLoadError
                          ? (fr
                              ? 'Impossible de charger les types de traitement pour le moment.'
                              : 'Unable to load treatment types right now.')
                          : (fr
                              ? 'Aucun type de traitement configuré par ce pressing.'
                              : 'No treatment type configured by this dry cleaner.')}
                      </p>
                      <button
                        type="button"
                        onClick={() => void loadPortalCatalogAndTypes()}
                        className="px-2.5 py-1 rounded-md bg-white border border-amber-200 text-xs font-medium text-amber-800 hover:bg-amber-100 transition-colors flex-shrink-0"
                      >
                        {fr ? 'Réessayer' : 'Retry'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Estimated pickup date */}
                {selectedTypeTraitementId && (
                  <div className="rounded-xl bg-sky-50 border border-sky-100 p-4 flex items-center gap-3">
                    <Calendar className="w-5 h-5 text-sky-500 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-slate-500">
                        {fr ? 'Date de retrait estimée' : 'Estimated pickup date'}
                      </p>
                      <p className="text-sm font-semibold text-sky-700 capitalize">
                        {new Date(Date.now() + getSelectedNbJours() * 86400000).toLocaleDateString(fr ? 'fr-FR' : 'en-US', {
                          weekday: 'long',
                          day: '2-digit',
                          month: 'long',
                        })}
                      </p>
                    </div>
                  </div>
                )}

                {/* Catalog search + quick browse */}
                <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <h3 className="text-sm font-semibold text-slate-900">{fr ? 'Ajouter des articles' : 'Add items'}</h3>
                    {catalog.length > 0 && (
                      <span className="text-xs text-slate-400">
                        {filteredCatalog.length} {fr ? 'disponible(s)' : 'available'}
                      </span>
                    )}
                  </div>
                  {pickupRequested && (
                    <button
                      type="button"
                      onClick={addQuickPickupBag}
                      className="w-full mb-3 p-3 rounded-xl bg-amber-50 border border-amber-200 hover:bg-amber-100/70 transition-colors flex items-center justify-between gap-3 text-left"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-amber-500 text-white flex items-center justify-center flex-shrink-0">
                          <ShoppingBag className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-amber-900">
                            {fr ? 'Collecte rapide sans inventaire' : 'Quick pickup without listing items'}
                          </p>
                          <p className="text-[11px] text-amber-800/80">
                            {fr
                              ? 'Le collecteur comptera et chiffrera vos pièces sur place'
                              : 'Our collector will count and price your items on site'}
                          </p>
                        </div>
                      </div>
                      <span className="text-xs font-semibold text-amber-800 bg-white border border-amber-200 px-2.5 py-1 rounded-lg flex-shrink-0">
                        {fr ? '+ Ajouter' : '+ Add'}
                      </span>
                    </button>
                  )}
                  <div className="relative mb-3">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder={fr ? 'Rechercher un article…' : 'Search an item…'}
                      className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                    />
                  </div>
                  {catalog.length > 0 && (
                    <div className="space-y-1.5 max-h-56 overflow-y-auto">
                      {filteredCatalog.length === 0 ? (
                        <p className="text-xs text-slate-400 text-center py-3">
                          {fr ? 'Aucun article trouvé.' : 'No item found.'}
                        </p>
                      ) : (
                        (searchTerm.trim() ? filteredCatalog : filteredCatalog.slice(0, 10)).map((cat) => {
                          const coef = getSelectedCoefficient();
                          const adjustedPrice = Number(cat.prix_unitaire) * coef;
                          return (
                            <button
                              type="button"
                              key={cat.id}
                              onClick={() => addArticleToOrder(cat)}
                              className="w-full flex items-center justify-between p-3 rounded-lg border border-slate-100 hover:border-sky-200 hover:bg-sky-50/50 transition-all text-left group"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <Plus className="w-4 h-4 text-sky-400 flex-shrink-0" />
                                <span className="text-sm font-medium text-slate-700 truncate">{cat.designation}</span>
                              </div>
                              <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                                {coef !== 1 && (
                                  <span className="text-xs text-slate-400 line-through">
                                    {formatPrice(Number(cat.prix_unitaire))}
                                  </span>
                                )}
                                <span className="text-sm font-medium text-slate-700">
                                  {formatPrice(adjustedPrice)}
                                </span>
                              </div>
                            </button>
                          );
                        })
                      )}
                      {!searchTerm.trim() && filteredCatalog.length > 10 && (
                        <p className="text-[11px] text-slate-400 text-center pt-1">
                          {fr
                            ? `Tapez un mot-clé pour filtrer parmi les ${filteredCatalog.length} articles.`
                            : `Type a keyword to filter across all ${filteredCatalog.length} items.`}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Order articles */}
                {orderArticles.length > 0 && (
                  <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                    <div className="px-5 py-3.5 bg-slate-50/50 border-b border-slate-50">
                      <p className="text-sm font-semibold text-slate-900">
                        {fr ? 'Ma commande' : 'My order'} ({orderArticles.length} {fr ? 'article(s)' : 'item(s)'})
                      </p>
                    </div>
                    <div className="divide-y divide-slate-50">
                      {orderArticles.map((art) => {
                        const artVariants = art.article_id
                          ? articleVariants.filter((v) => v.article_id === art.article_id)
                          : [];
                        const coef = getSelectedCoefficient();
                        return (
                          <div key={art.id} className="px-5 py-3.5">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-sm font-medium text-slate-900">{art.designation}</p>
                              <button
                                type="button"
                                onClick={() => removeOrderArticle(art.id)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            {artVariants.length > 0 && (
                              <div className="mb-2.5">
                                <label className="block text-xs text-slate-500 mb-1">
                                  {fr ? 'Option / Variante de traitement' : 'Treatment variant'}
                                </label>
                                <select
                                  value={art.variant_id ?? ''}
                                  onChange={(e) => updateOrderArticle(art.id, 'variant_id', e.target.value || null)}
                                  className="w-full sm:w-auto min-w-[200px] px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
                                >
                                  {artVariants.map((v) => (
                                    <option key={v.id} value={v.id}>
                                      {v.designation} ({formatPrice(Number(v.prix_traitement) * coef)})
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="flex items-center gap-1">
                                <label className="text-xs text-slate-400">{fr ? 'Qté' : 'Qty'}</label>
                                <input
                                  type="number"
                                  min={1}
                                  value={art.quantite}
                                  onChange={(e) => updateOrderArticle(art.id, 'quantite', e.target.value === '' ? '' : parseInt(e.target.value) || 1)}
                                  className="w-14 px-2 py-1 rounded border border-slate-200 text-sm text-center focus:outline-none focus:ring-1 focus:ring-sky-500"
                                />
                              </div>
                              <div className="flex items-center gap-1">
                                <label className="text-xs text-slate-400">{fr ? 'Pièces' : 'Pieces'}</label>
                                <input
                                  type="number"
                                  min={1}
                                  value={art.nb_pieces}
                                  onChange={(e) => updateOrderArticle(art.id, 'nb_pieces', parseInt(e.target.value) || 1)}
                                  className="w-14 px-2 py-1 rounded border border-slate-200 text-sm text-center focus:outline-none focus:ring-1 focus:ring-sky-500"
                                />
                              </div>
                              <div className="flex items-center gap-1">
                                <label className="text-xs text-slate-400">{fr ? 'Couleur' : 'Color'}</label>
                                <input
                                  type="text"
                                  value={art.couleur}
                                  onChange={(e) => updateOrderArticle(art.id, 'couleur', e.target.value)}
                                  placeholder={fr ? 'Optionnel' : 'Optional'}
                                  className="w-24 px-2 py-1 rounded border border-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500"
                                />
                              </div>
                              <div className="flex items-center gap-1">
                                <label className="text-xs text-slate-400">{fr ? 'Signe' : 'Sign'}</label>
                                <input
                                  type="text"
                                  value={art.signe_particulier}
                                  onChange={(e) => updateOrderArticle(art.id, 'signe_particulier', e.target.value)}
                                  className="w-20 px-2 py-1 rounded border border-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500"
                                />
                              </div>
                              <div className="flex items-center gap-1">
                                <label className="text-xs text-slate-400">{fr ? 'Griffe' : 'Brand'}</label>
                                <input
                                  type="text"
                                  value={art.griffe}
                                  onChange={(e) => updateOrderArticle(art.id, 'griffe', e.target.value)}
                                  className="w-20 px-2 py-1 rounded border border-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500"
                                />
                              </div>
                            </div>
                            <div className="flex items-center justify-between mt-2">
                              <span className="text-xs text-slate-400">
                                {fr ? 'Tarif unitaire :' : 'Unit rate:'}{' '}
                                <span className="font-medium text-slate-600">{formatPrice(art.prix_unitaire * coef)}</span>
                                {coef !== 1 && (
                                  <span className="ml-1 text-slate-400">({formatPrice(art.prix_unitaire)} ×{coef})</span>
                                )}
                              </span>
                              <p className="text-sm font-semibold text-slate-900">{formatPrice(art.prix_total)}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Pickup option — always accessible */}
                <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setPickupRequested(!pickupRequested)}
                      className="w-full flex items-center gap-3 px-5 py-4 hover:bg-slate-50/50 transition-colors"
                    >
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
                        pickupRequested ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-400'
                      }`}>
                        <Truck className="w-5 h-5" />
                      </div>
                      <div className="text-left flex-1">
                        <p className="text-sm font-semibold text-slate-900">
                          {fr ? 'Collecte à domicile' : 'Home pickup'}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {pickupRequested
                            ? (fr ? 'Notre collecteur passera récupérer votre linge à domicile' : 'Our collector will pick up your laundry at home')
                            : (fr ? 'Demander à l\'entreprise de venir chercher vos articles' : 'Request the company to pick up items')}
                        </p>
                      </div>
                      <div className={`w-11 h-6 rounded-full flex items-center transition-colors flex-shrink-0 ${
                        pickupRequested ? 'bg-sky-500 justify-end' : 'bg-slate-200 justify-start'
                      }`}>
                        <div className="w-5 h-5 rounded-full bg-white shadow-sm mx-0.5 transition-transform" />
                      </div>
                    </button>

                    {pickupRequested && (
                      <div className="px-5 pb-5 space-y-4 border-t border-slate-50 pt-4">
                        {savedHomeAddress && !pickupAddress && pickupLat === null && (
                          <button
                            type="button"
                            onClick={() => {
                              setPickupAddress(savedHomeAddress.address);
                              setPickupLat(savedHomeAddress.lat);
                              setPickupLng(savedHomeAddress.lng);
                            }}
                            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-amber-50/70 border border-amber-200 text-xs text-amber-800 hover:bg-amber-50 transition-colors"
                          >
                            <span className="flex items-center gap-1.5 truncate">
                              <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                              <span className="truncate">
                                {fr ? 'Réutiliser ma dernière adresse :' : 'Reuse my last address:'}{' '}
                                <strong>{savedHomeAddress.address || (fr ? 'Position GPS enregistrée' : 'Saved GPS location')}</strong>
                              </span>
                            </span>
                            <span className="font-semibold flex-shrink-0">{fr ? 'Appliquer' : 'Apply'}</span>
                          </button>
                        )}

                        {pickupDays.length > 0 && (
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">
                              {fr ? 'Jour de collecte souhaité *' : 'Preferred pickup day *'}
                            </label>
                            <div className="flex flex-wrap gap-2">
                              {pickupDays.map((day) => {
                                const label = DAY_LABELS_MAP[day]?.[fr ? 'fr' : 'en'] ?? day;
                                return (
                                  <button
                                    type="button"
                                    key={day}
                                    onClick={() => setSelectedPickupDay(day)}
                                    className={`px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                                      selectedPickupDay === day
                                        ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
                                        : 'bg-white border-slate-200 text-slate-600 hover:border-amber-200 hover:bg-amber-50/50'
                                    }`}
                                  >
                                    {label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1.5">
                            {fr ? 'Créneau horaire de collecte (optionnel)' : 'Preferred pickup time slot (optional)'}
                          </label>
                          <div className="flex flex-wrap gap-1.5">
                            {TIME_SLOTS.map((slot) => {
                              const active = selectedPickupSlot === slot.value;
                              return (
                                <button
                                  type="button"
                                  key={slot.value}
                                  onClick={() => setSelectedPickupSlot(active ? '' : slot.value)}
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                                    active
                                      ? 'bg-amber-500 text-white border-amber-500 shadow-xs'
                                      : 'bg-white border-slate-200 text-slate-600 hover:border-amber-200 hover:bg-amber-50/50'
                                  }`}
                                >
                                  <Clock className="w-3 h-3" />
                                  {fr ? slot.fr : slot.en}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1.5">
                            {fr ? 'Adresse de collecte (quartier, rue, repère) *' : 'Pickup address (district, street, landmark) *'}
                          </label>
                          <input
                            type="text"
                            value={pickupAddress}
                            onChange={(e) => setPickupAddress(e.target.value)}
                            placeholder={fr ? 'Ex: Cocody Angré, Immeuble bleu 2e étage' : 'Ex: 12 Main St, Apt 2B'}
                            className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                          />
                        </div>

                        <div className="space-y-2.5">
                          <label className="block text-xs font-medium text-slate-500">
                            {fr ? 'Position GPS / Carte (recommandé pour le collecteur)' : 'GPS / Map location (recommended for pickup)'}
                          </label>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={captureGps}
                              disabled={gpsLoading}
                              className="px-3 py-2 rounded-lg bg-sky-50 border border-sky-200 text-sky-600 text-xs font-medium hover:bg-sky-100 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                            >
                              {gpsLoading ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Navigation className="w-3.5 h-3.5" />
                              )}
                              {fr ? 'Ma position GPS' : 'My GPS location'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowPickupMap((v) => !v)}
                              className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-100 transition-colors flex items-center gap-1.5"
                            >
                              <MapIcon className="w-3.5 h-3.5 text-amber-600" />
                              {showPickupMap
                                ? (fr ? 'Masquer la carte' : 'Hide map')
                                : (fr ? 'Choisir sur la carte' : 'Pick on map')}
                            </button>
                            {pickupLat !== null && pickupLng !== null && (
                              <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
                                <Check className="w-3.5 h-3.5" />
                                {pickupLat.toFixed(4)}, {pickupLng.toFixed(4)}
                              </span>
                            )}
                          </div>
                          {gpsError && <p className="text-xs text-red-500">{gpsError}</p>}
                          {showPickupMap && (
                            <ClientLocationMapPicker
                              id="client-pickup-map"
                              latitude={pickupLat}
                              longitude={pickupLng}
                              shopLatitude={client.delivery_latitude}
                              shopLongitude={client.delivery_longitude}
                              shopName={client.entreprise_nom}
                              accent="amber"
                              lang={lang}
                              onSelect={(lat, lng) => {
                                setPickupLat(lat);
                                setPickupLng(lng);
                                setGpsError(null);
                              }}
                            />
                          )}
                        </div>

                        {pickupFeeEstimate !== null && (
                          <div className="rounded-lg bg-amber-50 border border-amber-100 p-3 flex items-center justify-between">
                            <div>
                              <span className="text-xs font-medium text-slate-700">
                                {fr ? 'Frais de collecte estimés' : 'Estimated pickup fee'}
                              </span>
                              {pickupDistanceKm !== null && (
                                <span className="text-[11px] text-amber-700 ml-1.5">
                                  ({pickupDistanceKm.toFixed(1)} km)
                                </span>
                              )}
                            </div>
                            <span className="text-sm font-bold text-amber-700">{formatPrice(pickupFeeEstimate)}</span>
                          </div>
                        )}
                      </div>
                    )}
                </div>

                {/* Delivery option — always accessible */}
                <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                    <button
                      type="button"
                      onClick={() => {
                        const next = !deliveryRequested;
                        setDeliveryRequested(next);
                        if (next && pickupRequested && !deliveryAddress && deliveryLat === null) {
                          setSameAddressAsPickup(true);
                        }
                      }}
                      className="w-full flex items-center gap-3 px-5 py-4 hover:bg-slate-50/50 transition-colors"
                    >
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
                        deliveryRequested ? 'bg-sky-100 text-sky-600' : 'bg-slate-100 text-slate-400'
                      }`}>
                        <Home className="w-5 h-5" />
                      </div>
                      <div className="text-left flex-1">
                        <p className="text-sm font-semibold text-slate-900">
                          {fr ? 'Livraison à domicile' : 'Home delivery'}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {deliveryRequested
                            ? (fr ? 'Votre linge propre vous sera livré directement chez vous' : 'Your clean laundry will be delivered directly to you')
                            : (fr ? 'Demander la livraison une fois le linge traité' : 'Request delivery once laundry is processed')}
                        </p>
                      </div>
                      <div className={`w-11 h-6 rounded-full flex items-center transition-colors flex-shrink-0 ${
                        deliveryRequested ? 'bg-sky-500 justify-end' : 'bg-slate-200 justify-start'
                      }`}>
                        <div className="w-5 h-5 rounded-full bg-white shadow-sm mx-0.5 transition-transform" />
                      </div>
                    </button>

                    {deliveryRequested && (
                      <div className="px-5 pb-5 space-y-4 border-t border-slate-50 pt-4">
                        {pickupRequested && (
                          <label className="flex items-center gap-2.5 p-3 rounded-lg bg-sky-50/70 border border-sky-100 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={sameAddressAsPickup}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setSameAddressAsPickup(checked);
                                if (checked) {
                                  setDeliveryAddress(pickupAddress);
                                  setDeliveryLat(pickupLat);
                                  setDeliveryLng(pickupLng);
                                }
                              }}
                              className="w-4 h-4 rounded border-sky-300 text-sky-600 focus:ring-sky-500"
                            />
                            <Copy className="w-3.5 h-3.5 text-sky-600 flex-shrink-0" />
                            <span className="text-xs font-medium text-sky-900">
                              {fr ? 'Même adresse et position GPS que la collecte' : 'Same address and GPS location as pickup'}
                            </span>
                          </label>
                        )}

                        {!sameAddressAsPickup && savedHomeAddress && !deliveryAddress && deliveryLat === null && (
                          <button
                            type="button"
                            onClick={() => {
                              setDeliveryAddress(savedHomeAddress.address);
                              setDeliveryLat(savedHomeAddress.lat);
                              setDeliveryLng(savedHomeAddress.lng);
                            }}
                            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-sky-50/70 border border-sky-200 text-xs text-sky-800 hover:bg-sky-50 transition-colors"
                          >
                            <span className="flex items-center gap-1.5 truncate">
                              <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                              <span className="truncate">
                                {fr ? 'Réutiliser ma dernière adresse :' : 'Reuse my last address:'}{' '}
                                <strong>{savedHomeAddress.address || (fr ? 'Position GPS enregistrée' : 'Saved GPS location')}</strong>
                              </span>
                            </span>
                            <span className="font-semibold flex-shrink-0">{fr ? 'Appliquer' : 'Apply'}</span>
                          </button>
                        )}

                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1.5">
                            {fr ? 'Jour de livraison souhaité (optionnel)' : 'Preferred delivery day (optional)'}
                          </label>
                          <div className="flex flex-wrap gap-1.5">
                            {(pickupDays.length > 0
                              ? pickupDays
                              : ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
                            ).map((day) => {
                                const label = DAY_LABELS_MAP[day]?.[fr ? 'fr' : 'en'] ?? day;
                                const isSelected = selectedDeliveryDay === day;
                                return (
                                  <button
                                    type="button"
                                    key={day}
                                    onClick={() => setSelectedDeliveryDay(isSelected ? '' : day)}
                                    className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                                      isSelected
                                        ? 'bg-sky-500 text-white border-sky-500 shadow-xs'
                                        : 'bg-white border-slate-200 text-slate-600 hover:border-sky-200 hover:bg-sky-50/50'
                                    }`}
                                  >
                                    {label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">
                              {fr ? 'Créneau horaire de livraison (optionnel)' : 'Preferred delivery time slot (optional)'}
                            </label>
                            <div className="flex flex-wrap gap-1.5">
                              {TIME_SLOTS.map((slot) => {
                                const active = selectedDeliverySlot === slot.value;
                                return (
                                  <button
                                    type="button"
                                    key={slot.value}
                                    onClick={() => setSelectedDeliverySlot(active ? '' : slot.value)}
                                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                                      active
                                        ? 'bg-sky-500 text-white border-sky-500 shadow-xs'
                                        : 'bg-white border-slate-200 text-slate-600 hover:border-sky-200 hover:bg-sky-50/50'
                                    }`}
                                  >
                                    <Clock className="w-3 h-3" />
                                    {fr ? slot.fr : slot.en}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                        {!sameAddressAsPickup && (
                          <>
                            <div>
                              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                                {fr ? 'Adresse de livraison *' : 'Delivery address *'}
                              </label>
                              <input
                                type="text"
                                value={deliveryAddress}
                                onChange={(e) => setDeliveryAddress(e.target.value)}
                                placeholder={fr ? 'Ex: Plateau, Immeuble Alpha, 4e étage' : 'Ex: 12 Main St, Downtown'}
                                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                              />
                            </div>

                            <div className="space-y-2.5">
                              <label className="block text-xs font-medium text-slate-500">
                                {fr ? 'Position GPS / Carte (pour le calcul des frais et le livreur)' : 'GPS / Map location (for fee calculation & driver)'}
                              </label>
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={captureDeliveryGps}
                                  disabled={deliveryGpsLoading}
                                  className="px-3 py-2 rounded-lg bg-sky-50 border border-sky-200 text-sky-600 text-xs font-medium hover:bg-sky-100 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                                >
                                  {deliveryGpsLoading ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Navigation className="w-3.5 h-3.5" />
                                  )}
                                  {fr ? 'Ma position GPS' : 'My GPS location'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setShowDeliveryMap((v) => !v)}
                                  className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-100 transition-colors flex items-center gap-1.5"
                                >
                                  <MapIcon className="w-3.5 h-3.5 text-sky-600" />
                                  {showDeliveryMap
                                    ? (fr ? 'Masquer la carte' : 'Hide map')
                                    : (fr ? 'Choisir sur la carte' : 'Pick on map')}
                                </button>
                                {deliveryLat !== null && deliveryLng !== null && (
                                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
                                    <Check className="w-3.5 h-3.5" />
                                    {deliveryLat.toFixed(4)}, {deliveryLng.toFixed(4)}
                                  </span>
                                )}
                              </div>
                              {deliveryGpsError && <p className="text-xs text-red-500">{deliveryGpsError}</p>}
                              {showDeliveryMap && (
                                <ClientLocationMapPicker
                                  id="client-delivery-map"
                                  latitude={deliveryLat}
                                  longitude={deliveryLng}
                                  shopLatitude={client.delivery_latitude}
                                  shopLongitude={client.delivery_longitude}
                                  shopName={client.entreprise_nom}
                                  accent="sky"
                                  lang={lang}
                                  onSelect={(lat, lng) => {
                                    setDeliveryLat(lat);
                                    setDeliveryLng(lng);
                                    setDeliveryGpsError(null);
                                  }}
                                />
                              )}
                            </div>
                          </>
                        )}

                        {deliveryFeeEstimate !== null && (
                          <div className="rounded-lg bg-sky-50 border border-sky-100 p-3 flex items-center justify-between">
                            <div>
                              <span className="text-xs font-medium text-slate-700">
                                {fr ? 'Frais de livraison estimés' : 'Estimated delivery fee'}
                              </span>
                              {deliveryDistanceKm !== null && (
                                <span className="text-[11px] text-sky-700 ml-1.5">
                                  ({deliveryDistanceKm.toFixed(1)} km)
                                </span>
                              )}
                            </div>
                            <span className="text-sm font-bold text-sky-700">{formatPrice(deliveryFeeEstimate)}</span>
                          </div>
                        )}
                      </div>
                    )}
                </div>

                {/* Special instructions / notes */}
                {orderArticles.length > 0 && (
                  <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-900 mb-2">
                      <FileText className="w-4 h-4 text-sky-500" />
                      {fr ? 'Instructions & remarques (optionnel)' : 'Special instructions (optional)'}
                    </label>
                    <textarea
                      value={orderNotes}
                      onChange={(e) => setOrderNotes(e.target.value)}
                      rows={2}
                      placeholder={
                        fr
                          ? 'Ex : Appeler 15 min avant, portail vert, tache de café sur la chemise blanche…'
                          : 'Ex: Call 15 min ahead, green gate, coffee stain on white shirt…'
                      }
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent resize-none"
                    />
                  </div>
                )}

                {/* Transparent order summary breakdown */}
                {orderArticles.length > 0 && (
                  <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5 space-y-2.5">
                    <div className="flex items-center justify-between text-xs text-slate-600">
                      <span>
                        {fr ? 'Sous-total articles' : 'Items subtotal'}
                        {getSelectedTypeLibelle() && (
                          <span className="text-sky-700 font-medium ml-1">
                            ({getSelectedTypeLibelle()} ×{getSelectedCoefficient()})
                          </span>
                        )}
                      </span>
                      <span className="font-medium text-slate-800">{formatPrice(orderTotal)}</span>
                    </div>

                    {clientDiscountAmount > 0 && (
                      <div className="flex items-center justify-between text-xs text-emerald-700">
                        <span>
                          {fr ? `Remise fidélité (${client.taux_remise}%)` : `Client discount (${client.taux_remise}%)`}
                        </span>
                        <span className="font-semibold">-{formatPrice(clientDiscountAmount)}</span>
                      </div>
                    )}

                    {pickupRequested && pickupFeeEstimate !== null && (
                      <div className="flex items-center justify-between text-xs text-amber-700">
                        <span>
                          {fr ? 'Frais de collecte à domicile' : 'Home pickup fee'}
                          {pickupDistanceKm !== null ? ` (${pickupDistanceKm.toFixed(1)} km)` : ''}
                        </span>
                        <span className="font-medium">{formatPrice(pickupFeeEstimate)}</span>
                      </div>
                    )}

                    {deliveryRequested && deliveryFeeEstimate !== null && (
                      <div className="flex items-center justify-between text-xs text-sky-700">
                        <span>
                          {fr ? 'Frais de livraison à domicile' : 'Home delivery fee'}
                          {deliveryDistanceKm !== null ? ` (${deliveryDistanceKm.toFixed(1)} km)` : ''}
                        </span>
                        <span className="font-medium">{formatPrice(deliveryFeeEstimate)}</span>
                      </div>
                    )}

                    <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-slate-900">
                          {fr ? 'Total estimé' : 'Estimated total'}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {fr
                            ? 'Ajustable après vérification physique des pièces à la collecte'
                            : 'Adjustable after physical count at pickup'}
                        </p>
                      </div>
                      <p className="text-xl font-bold text-sky-600">{formatPrice(grandTotal)}</p>
                    </div>
                  </div>
                )}

                {(orderError || editError) && (
                  <div className="rounded-xl bg-red-50 border border-red-200 p-3.5 flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-700">{orderError ?? editError}</p>
                  </div>
                )}

                {orderArticles.length > 0 && (
                  <div className="space-y-2">
                    {editingDepotId && (
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="w-full px-4 py-3 rounded-lg border border-slate-200 text-slate-600 font-medium text-sm hover:bg-slate-50 transition-colors"
                      >
                        {fr ? 'Annuler la modification' : 'Cancel edit'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={editingDepotId ? submitEditOrder : submitOrder}
                      disabled={(editingDepotId ? editLoading : submitting) || (typesTraitement.length > 0 && !selectedTypeTraitementId)}
                      className="w-full px-4 py-3.5 rounded-xl bg-sky-500 text-white font-semibold text-sm hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-sm"
                    >
                      {(editingDepotId ? editLoading : submitting) ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {fr ? 'Enregistrement…' : 'Saving…'}
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4" />
                          {editingDepotId
                            ? (fr ? 'Enregistrer les modifications' : 'Save changes')
                            : (fr ? `Valider ma commande · ${formatPrice(grandTotal)}` : `Submit my order · ${formatPrice(grandTotal)}`)}
                        </>
                      )}
                    </button>
                  </div>
                )}

                {orderArticles.length === 0 && !orderSuccess && (
                  <div className="text-center py-8">
                    <ShoppingCart className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                    <p className="text-sm text-slate-400">
                      {fr ? 'Recherchez et ajoutez des articles pour créer votre commande.' : 'Search and add items to create your order.'}
                    </p>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Install modal */}
      {showInstallModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowInstallModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                {fr ? 'Installer l\'application' : 'Install app'}
              </h3>
              <button onClick={() => setShowInstallModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-slate-500">
              {fr ? 'Installez l\'application sur votre appareil pour un accès rapide et hors ligne.' : 'Install the app on your device for quick offline access.'}
            </p>

            {platform === 'ios' && (
              <div className="flex items-start gap-3 rounded-xl bg-sky-50 border border-sky-100 p-4">
                <Smartphone className="w-5 h-5 text-sky-600 flex-shrink-0 mt-0.5" />
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-sky-900">{fr ? 'Sur iPhone / iPad (Safari)' : 'On iPhone / iPad (Safari)'}</p>
                  <p className="text-xs text-sky-700">
                    {fr ? 'Appuyez sur l\'icône Partager, puis « Sur l\'écran d\'accueil ».' : 'Tap the Share icon, then "Add to Home Screen".'}
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <Share className="w-4 h-4 text-sky-600" />
                    <span className="text-xs text-sky-600 font-medium">
                      {fr ? 'Partager → Sur l\'écran d\'accueil' : 'Share → Add to Home Screen'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {platform === 'android' && (
              <div className="space-y-3">
                <div className="flex items-start gap-3 rounded-xl bg-emerald-50 border border-emerald-100 p-4">
                  <Smartphone className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-emerald-900">{fr ? 'Sur Chrome / Android' : 'On Chrome / Android'}</p>
                    <p className="text-xs text-emerald-700">
                      {fr ? 'Appuyez sur le bouton « Installer » ci-dessous, puis confirmez.' : 'Tap the "Install" button below, then confirm.'}
                    </p>
                  </div>
                </div>
                {hasInstallPrompt && (
                  <button
                    onClick={() => { promptInstall(); setShowInstallModal(false); }}
                    className="w-full px-4 py-3 rounded-xl bg-sky-500 text-white font-medium text-sm hover:bg-sky-600 transition-colors flex items-center justify-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    {fr ? 'Installer maintenant' : 'Install now'}
                  </button>
                )}
              </div>
            )}

            {platform === 'desktop' && (
              <div className="space-y-3">
                <div className="flex items-start gap-3 rounded-xl bg-slate-50 border border-slate-100 p-4">
                  <Monitor className="w-5 h-5 text-slate-600 flex-shrink-0 mt-0.5" />
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-slate-900">{fr ? 'Sur ordinateur (Chrome / Edge)' : 'On desktop (Chrome / Edge)'}</p>
                    <p className="text-xs text-slate-600">
                      {fr ? 'Cliquez sur l\'icône d\'installation dans la barre d\'adresse, ou le bouton ci-dessous.' : 'Click the install icon in the address bar, or the button below.'}
                    </p>
                  </div>
                </div>
                {hasInstallPrompt && (
                  <button
                    onClick={() => { promptInstall(); setShowInstallModal(false); }}
                    className="w-full px-4 py-3 rounded-xl bg-sky-500 text-white font-medium text-sm hover:bg-sky-600 transition-colors flex items-center justify-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    {fr ? 'Installer maintenant' : 'Install now'}
                  </button>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <p className="text-xs text-emerald-700">
                {fr ? 'L\'application fonctionne hors ligne une fois installée.' : 'The app works offline once installed.'}
              </p>
            </div>

            <button
              onClick={() => setShowInstallModal(false)}
              className="w-full px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              {fr ? 'Fermer' : 'Close'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
