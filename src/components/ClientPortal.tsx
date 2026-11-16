import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';
import { formatPrice, formatDateShort } from '@/types';
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
} from 'lucide-react';
import { usePwaInstall } from '@/hooks/usePwaInstall';

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
  total: number;
  mode_reglement: string | null;
  avance_amount: number | null;
  notes: string | null;
  type_traitement_id: string | null;
  coefficient: number;
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

interface PortalTypeTraitement {
  id: string;
  libelle: string;
  coefficient: number;
  nb_jours: number;
}

interface OrderArticle {
  id: string;
  designation: string;
  prix_unitaire: number;
  quantite: number | '';
  nb_pieces: number;
  prix_total: number;
  couleur: string;
  signe_particulier: string;
  griffe: string;
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
  const [typesTraitement, setTypesTraitement] = useState<PortalTypeTraitement[]>([]);
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
  const [deliveryRequested, setDeliveryRequested] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryLat, setDeliveryLat] = useState<number | null>(null);
  const [deliveryLng, setDeliveryLng] = useState<number | null>(null);
  const [deliveryGpsLoading, setDeliveryGpsLoading] = useState(false);
  const [deliveryGpsError, setDeliveryGpsError] = useState<string | null>(null);
  const { canInstall, promptInstall, platform, hasInstallPrompt, installed } = usePwaInstall();
  const [showInstallModal, setShowInstallModal] = useState(false);

  // Edit mode for uncollected orders
  const [editingDepotId, setEditingDepotId] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editLoading, setEditLoading] = useState(false);

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

  async function loadReleve(c: string) {
    setLoadingReleve(true);
    try {
      const { data, error } = await supabase.rpc('portal_get_releve', {
        p_code: c,
        e_id: entrepriseId,
      });
      if (error) throw error;
      const result = data as { depots?: PortalDepot[] };
      setDepots(result?.depots ?? []);
    } catch {
      setDepots([]);
    } finally {
      setLoadingReleve(false);
    }
  }

  // Load catalog and treatment types via the portal RPC
  useEffect(() => {
    if (!client) return;
    (async () => {
      try {
        const [catalogRes, typesRes, pickupDaysRes] = await Promise.all([
          supabase.rpc('portal_get_catalog', { e_id: entrepriseId }),
          supabase.rpc('portal_get_types_traitement', { e_id: entrepriseId }),
          supabase.rpc('portal_get_pickup_days', { e_id: entrepriseId }),
        ]);
        if (catalogRes.error) throw catalogRes.error;
        setCatalog((catalogRes.data as CatalogArticle[]) ?? []);
        const types = (typesRes.data as PortalTypeTraitement[]) ?? [];
        setTypesTraitement(types);
        if (types.length > 0) setSelectedTypeTraitementId(types[0].id);
        const days = (pickupDaysRes.data as string[]) ?? [];
        setPickupDays(days);
        if (days.length > 0) setSelectedPickupDay(days[0]);
      } catch {
        setCatalog([]);
        setTypesTraitement([]);
      }
    })();
  }, [client]);

  function logout() {
    setClient(null);
    setDepots([]);
    setView('releve');
    setOrderArticles([]);
    setOrderSuccess(false);
    setOrderError(null);
    setPickupRequested(false);
    setPickupAddress('');
    setPickupLat(null);
    setPickupLng(null);
    setSelectedPickupDay(pickupDays.length > 0 ? pickupDays[0] : '');
    setDeliveryRequested(false);
    setDeliveryAddress('');
    setDeliveryLat(null);
    setDeliveryLng(null);
    setDeliveryGpsError(null);
    setEditingDepotId(null);
    setEditError(null);
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

  function addArticleToOrder(cat: CatalogArticle) {
    const coef = getSelectedCoefficient();
    const prixTraite = Number(cat.prix_unitaire) * coef;
    const newArticle: OrderArticle = {
      id: uid(),
      designation: cat.designation,
      prix_unitaire: Number(cat.prix_unitaire),
      quantite: '',
      nb_pieces: Number(cat.nb_pieces),
      prix_total: prixTraite,
      couleur: '',
      signe_particulier: 'AUCUN',
      griffe: 'AUCUN',
    };
    setOrderArticles((prev) => [...prev, newArticle]);
    setSearchTerm('');
  }

  function updateOrderArticle(id: string, field: keyof OrderArticle, value: string | number) {
    setOrderArticles((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a;
        const updated = { ...a, [field]: value } as OrderArticle;
        if (field === 'quantite' || field === 'nb_pieces' || field === 'prix_unitaire') {
          const coef = getSelectedCoefficient();
          const prixTraite = (Number(updated.prix_unitaire) || 0) * coef;
          const qte = updated.quantite === '' ? 0 : Number(updated.quantite) || 0;
          updated.prix_total =
            prixTraite *
            qte;
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
      prev.map((a) => ({
        ...a,
        prix_total: (Number(a.prix_unitaire) || 0) * coef * (a.quantite === '' ? 0 : Number(a.quantite) || 0),
      })),
    );
  }, [selectedTypeTraitementId]);

  function removeOrderArticle(id: string) {
    setOrderArticles((prev) => prev.filter((a) => a.id !== id));
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

  const deliveryFeeEstimate: number | null = (() => {
    if (!deliveryRequested) return null;
    if (!client) return null;
    if (client.delivery_latitude == null || client.delivery_longitude == null) return client.delivery_base_fee;
    if (deliveryLat == null || deliveryLng == null) return client.delivery_base_fee;
    const dist = haversineKm(client.delivery_latitude, client.delivery_longitude, deliveryLat, deliveryLng);
    return client.delivery_base_fee + client.delivery_price_per_km * dist;
  })();

  const pickupFeeEstimate: number | null = (() => {
    if (!pickupRequested) return null;
    if (!client) return null;
    if (client.delivery_latitude == null || client.delivery_longitude == null) return client.delivery_base_fee;
    if (pickupLat == null || pickupLng == null) return client.delivery_base_fee;
    const dist = haversineKm(client.delivery_latitude, client.delivery_longitude, pickupLat, pickupLng);
    return client.delivery_base_fee + client.delivery_price_per_km * dist;
  })();

  const totalFees = (pickupFeeEstimate ?? 0) + (deliveryFeeEstimate ?? 0);
  const grandTotal = orderTotal + totalFees;

  async function submitOrder() {
    if (orderArticles.length === 0) return;
    if (typesTraitement.length > 0 && !selectedTypeTraitementId) {
      setOrderError(fr ? 'Veuillez sélectionner un type de traitement' : 'Please select a treatment type');
      return;
    }
    setSubmitting(true);
    setOrderError(null);
    setOrderSuccess(false);
    try {
      const articlesJson = orderArticles.map((a) => ({
        designation: a.designation,
        prix_unitaire: a.prix_unitaire,
        prix_traitement: a.prix_unitaire,
        quantite: a.quantite === '' ? 1 : a.quantite,
        nb_pieces: a.nb_pieces,
        prix_total: a.quantite === '' ? a.prix_unitaire * getSelectedCoefficient() : a.prix_total,
        couleur: a.couleur || null,
        signe_particulier: a.signe_particulier || null,
        griffe: a.griffe || null,
      }));

      const { data, error } = await supabase.rpc('portal_create_depot', {
        p_code: code.trim().toUpperCase(),
        e_id: entrepriseId,
        p_articles: articlesJson,
        p_notes: null,
        p_date_retrait: null,
        p_type_traitement_id: selectedTypeTraitementId || null,
        p_pickup_requested: pickupRequested,
        p_pickup_address: pickupRequested ? (pickupAddress.trim() || null) : null,
        p_pickup_latitude: pickupRequested ? pickupLat : null,
        p_pickup_longitude: pickupRequested ? pickupLng : null,
        p_pickup_day: pickupRequested ? (selectedPickupDay || null) : null,
        p_delivery_requested: deliveryRequested,
        p_delivery_address: deliveryRequested ? (deliveryAddress.trim() || null) : null,
        p_delivery_latitude: deliveryRequested ? deliveryLat : null,
        p_delivery_longitude: deliveryRequested ? deliveryLng : null,
        p_delivery_day: null,
      });

      if (error) throw error;
      const result = data as { depot_id: string; numero: string }[];
      if (!result || result.length === 0) throw new Error('No result');

      setOrderSuccess(true);
      setOrderArticles([]);
      setPickupRequested(false);
      setPickupAddress('');
      setPickupLat(null);
      setPickupLng(null);
      setSelectedPickupDay(pickupDays.length > 0 ? pickupDays[0] : '');
      setDeliveryRequested(false);
      setDeliveryAddress('');
      setDeliveryLat(null);
      setDeliveryLng(null);
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
    setEditingDepotId(depot.id);
    setEditError(null);
    setView('commande');
    setOrderSuccess(false);
    setOrderError(null);
    setSelectedTypeTraitementId(depot.type_traitement_id ?? (typesTraitement.length > 0 ? typesTraitement[0].id : ''));
    setOrderArticles(depot.articles.map((a) => ({
      id: uid(),
      designation: a.designation,
      prix_unitaire: Number(a.prix_unitaire) || 0,
      quantite: a.quantite,
      nb_pieces: a.nb_pieces,
      prix_total: Number(a.prix_total) || 0,
      couleur: a.couleur ?? '',
      signe_particulier: a.signe_particulier ?? 'AUCUN',
      griffe: a.griffe ?? 'AUCUN',
    })));
    setPickupRequested(depot.pickup_requested ?? false);
    setPickupAddress(depot.pickup_address ?? '');
    setPickupLat(depot.pickup_latitude ?? null);
    setPickupLng(depot.pickup_longitude ?? null);
    setSelectedPickupDay(depot.pickup_day ?? (pickupDays.length > 0 ? pickupDays[0] : ''));
    setDeliveryRequested(depot.delivery_requested ?? false);
    setDeliveryAddress(depot.delivery_address ?? '');
    setDeliveryLat(depot.delivery_latitude ?? null);
    setDeliveryLng(depot.delivery_longitude ?? null);
    setDeliveryGpsError(null);
    setSearchTerm('');
  }

  function cancelEdit() {
    setEditingDepotId(null);
    setEditError(null);
    setOrderArticles([]);
    setOrderError(null);
    setOrderSuccess(false);
    setPickupRequested(false);
    setPickupAddress('');
    setPickupLat(null);
    setPickupLng(null);
    setSelectedPickupDay(pickupDays.length > 0 ? pickupDays[0] : '');
    setDeliveryRequested(false);
    setDeliveryAddress('');
    setDeliveryLat(null);
    setDeliveryLng(null);
    setDeliveryGpsError(null);
    setSearchTerm('');
    setView('releve');
  }

  async function submitEditOrder() {
    if (!editingDepotId || orderArticles.length === 0) return;
    if (typesTraitement.length > 0 && !selectedTypeTraitementId) {
      setOrderError(fr ? 'Veuillez sélectionner un type de traitement' : 'Please select a treatment type');
      return;
    }
    setEditLoading(true);
    setEditError(null);
    setOrderError(null);
    try {
      const articlesJson = orderArticles.map((a) => ({
        designation: a.designation,
        prix_unitaire: a.prix_unitaire,
        prix_traitement: a.prix_unitaire,
        quantite: a.quantite === '' ? 1 : a.quantite,
        nb_pieces: a.nb_pieces,
        prix_total: a.quantite === '' ? a.prix_unitaire * getSelectedCoefficient() : a.prix_total,
        couleur: a.couleur || null,
        signe_particulier: a.signe_particulier || null,
        griffe: a.griffe || null,
      }));

      const { error } = await supabase.rpc('portal_update_depot', {
        p_code: code.trim().toUpperCase(),
        e_id: entrepriseId,
        p_depot_id: editingDepotId,
        p_articles: articlesJson,
        p_type_traitement_id: selectedTypeTraitementId || null,
        p_pickup_requested: pickupRequested,
        p_pickup_address: pickupRequested ? (pickupAddress.trim() || null) : null,
        p_pickup_latitude: pickupRequested ? pickupLat : null,
        p_pickup_longitude: pickupRequested ? pickupLng : null,
        p_pickup_day: pickupRequested ? (selectedPickupDay || null) : null,
        p_delivery_requested: deliveryRequested,
        p_delivery_address: deliveryRequested ? (deliveryAddress.trim() || null) : null,
        p_delivery_latitude: deliveryRequested ? deliveryLat : null,
        p_delivery_longitude: deliveryRequested ? deliveryLng : null,
        p_delivery_day: null,
      });

      if (error) throw error;

      setEditingDepotId(null);
      setOrderArticles([]);
      setPickupRequested(false);
      setPickupAddress('');
      setPickupLat(null);
      setPickupLng(null);
      setSelectedPickupDay(pickupDays.length > 0 ? pickupDays[0] : '');
      setDeliveryRequested(false);
      setDeliveryAddress('');
      setDeliveryLat(null);
      setDeliveryLng(null);
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
                {depots.map((depot) => {
                  const avance = Number(depot.avance_amount) ?? 0;
                  const extraAvances = depot.avances.reduce((s2, a) => s2 + Number(a.montant), 0);
                  const mode = depot.mode_reglement;
                  const paye = mode === 'PAYER_DEPOT' ? Number(depot.total) : mode === 'AVANCE' ? avance + extraAvances : mode === 'SOLDE' ? Number(depot.total) : extraAvances;
                  const reste = Number(depot.total) - paye;
                  return (
                    <div key={depot.id} className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                      <div className="flex items-center justify-between px-5 py-3.5 bg-slate-50/50 border-b border-slate-50">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">
                            {depot.numero ?? (fr ? 'Commande en attente' : 'Pending order')}
                          </p>
                          <p className="text-xs text-slate-400 mt-0.5">{formatDateShort(depot.date_depot)}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                            depot.statut === 'COMMANDE' ? 'bg-sky-100 text-sky-700' : depot.statut === 'EN_COURS' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                          }`}>
                            {depot.statut === 'COMMANDE' ? (fr ? 'Commande' : 'Order') : depot.statut === 'EN_COURS' ? (fr ? 'En cours' : 'In progress') : (fr ? 'Retiré' : 'Picked up')}
                          </span>
                          <p className="text-sm font-bold text-slate-900">{formatPrice(Number(depot.total))}</p>
                        </div>
                      </div>
                      <div className="px-5 py-3 space-y-1.5">
                        {depot.articles.map((art) => (
                          <div key={art.id} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="w-1.5 h-1.5 rounded-full bg-sky-400 flex-shrink-0" />
                              <span className="text-slate-700 truncate">{art.designation}</span>
                              <span className="text-xs text-slate-400 flex-shrink-0">({(Number(art.nb_pieces) || 0) * (Number(art.quantite) || 0)} {fr ? 'pcs' : 'pcs'})</span>
                            </div>
                            <span className="text-slate-600 flex-shrink-0 ml-2">{formatPrice(Number(art.prix_total))}</span>
                          </div>
                        ))}
                      </div>
                      <div className="px-5 py-3 border-t border-slate-50 flex items-center justify-between text-sm">
                        <span className="text-slate-500">{fr ? 'Payé' : 'Paid'}: <span className="text-emerald-600 font-medium">{formatPrice(paye)}</span></span>
                        <span className="text-slate-500">{fr ? 'Reste' : 'Remaining'}: <span className={reste > 0 ? 'text-red-600 font-medium' : 'text-slate-400'}>{formatPrice(reste)}</span></span>
                      </div>
                      {depot.statut === 'COMMANDE' && (
                        <div className="px-5 pb-3 pt-1 border-t border-slate-50">
                          <button
                            onClick={() => startEditOrder(depot)}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-sky-50 border border-sky-200 text-sky-700 text-sm font-medium hover:bg-sky-100 transition-colors"
                          >
                            <Pencil className="w-4 h-4" />
                            {fr ? 'Modifier la commande' : 'Edit order'}
                          </button>
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

                {/* Treatment type selector */}
                {typesTraitement.length > 0 && (
                  <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <Sparkles className="w-4 h-4 text-sky-500" />
                      <h3 className="text-sm font-semibold text-slate-900">
                        {fr ? 'Type de traitement' : 'Treatment type'}
                        <span className="text-red-500 ml-0.5">*</span>
                      </h3>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {typesTraitement.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => setSelectedTypeTraitementId(t.id)}
                          className={`px-3 py-2.5 rounded-lg border text-sm font-medium transition-all text-left ${
                            selectedTypeTraitementId === t.id
                              ? 'border-sky-500 bg-sky-50 text-sky-700 ring-1 ring-sky-500'
                              : 'border-slate-200 text-slate-600 hover:border-sky-200 hover:bg-sky-50/50'
                          }`}
                        >
                          <span className="block">{t.libelle}</span>
                          <span className="text-xs text-slate-400 mt-0.5 block">
                            ×{t.coefficient} · {t.nb_jours}j
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Estimated pickup date */}
                {selectedTypeTraitementId && (
                  <div className="rounded-xl bg-sky-50 border border-sky-100 p-4 flex items-center gap-3">
                    <Calendar className="w-5 h-5 text-sky-500 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-slate-500">
                        {fr ? 'Date de retrait estimée' : 'Estimated pickup date'}
                      </p>
                      <p className="text-sm font-semibold text-sky-700">
                        {new Date(Date.now() + getSelectedNbJours() * 86400000).toLocaleDateString(fr ? 'fr-FR' : 'en-US', {
                          weekday: 'long',
                          day: '2-digit',
                          month: 'long',
                        })}
                      </p>
                    </div>
                  </div>
                )}

                {/* Catalog search */}
                <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
                  <h3 className="text-sm font-semibold text-slate-900 mb-3">{fr ? 'Ajouter des articles' : 'Add items'}</h3>
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
                  {searchTerm.trim() && (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {filteredCatalog.length === 0 ? (
                        <p className="text-xs text-slate-400 text-center py-3">
                          {fr ? 'Aucun article trouvé.' : 'No item found.'}
                        </p>
                      ) : (
                        filteredCatalog.map((cat) => (
                          <button
                            key={cat.id}
                            onClick={() => addArticleToOrder(cat)}
                            className="w-full flex items-center justify-between p-3 rounded-lg border border-slate-100 hover:border-sky-200 hover:bg-sky-50/50 transition-all text-left group"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <Plus className="w-4 h-4 text-sky-400 flex-shrink-0" />
                              <span className="text-sm font-medium text-slate-700 truncate">{cat.designation}</span>
                            </div>
                            <span className="text-sm text-slate-500 flex-shrink-0 ml-2">{formatPrice(Number(cat.prix_unitaire))}</span>
                          </button>
                        ))
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
                      {orderArticles.map((art) => (
                        <div key={art.id} className="px-5 py-3.5">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-sm font-medium text-slate-900">{art.designation}</p>
                            <button
                              onClick={() => removeOrderArticle(art.id)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-2">
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
                              <label className="text-xs text-slate-400">{fr ? 'Prix' : 'Price'}</label>
                              <input
                                type="number"
                                min={0}
                                step="100"
                                value={art.prix_unitaire}
                                onChange={(e) => updateOrderArticle(art.id, 'prix_unitaire', parseFloat(e.target.value) || 0)}
                                className="w-20 px-2 py-1 rounded border border-slate-200 text-sm text-center focus:outline-none focus:ring-1 focus:ring-sky-500"
                              />
                            </div>
                            <div className="flex items-center gap-1">
                              <label className="text-xs text-slate-400">{fr ? 'Couleur' : 'Color'}</label>
                              <input
                                type="text"
                                value={art.couleur}
                                onChange={(e) => updateOrderArticle(art.id, 'couleur', e.target.value)}
                                className="w-20 px-2 py-1 rounded border border-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500"
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
                          <p className="text-sm font-semibold text-slate-900 mt-2">{formatPrice(art.prix_total)}</p>
                        </div>
                      ))}
                    </div>
                    <div className="px-5 py-4 bg-slate-50/50 border-t border-slate-50 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-slate-900">{fr ? 'Total' : 'Total'}</p>
                        {getSelectedCoefficient() !== 1 && (
                          <p className="text-xs text-slate-400 mt-0.5">
                            {getSelectedTypeLibelle()} (×{getSelectedCoefficient()})
                          </p>
                        )}
                      </div>
                      <p className="text-lg font-bold text-sky-600">{formatPrice(grandTotal)}</p>
                      {totalFees > 0 && (
                        <p className="text-xs text-slate-400 mt-0.5">
                          {fr ? ' dont ' : 'incl. '}{formatPrice(totalFees)} {fr ? 'de frais' : 'fees'}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {(orderError || editError) && (
                  <div className="rounded-lg bg-red-50 border border-red-200 p-3">
                    <p className="text-sm text-red-600">{orderError ?? editError}</p>
                  </div>
                )}

                {/* Pickup option */}
                {orderArticles.length > 0 && (
                  <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                    <button
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
                            ? (fr ? 'L\'entreprise viendra chercher vos articles (frais selon la distance)' : 'The company will pick up your items (distance-based fee)')
                            : (fr ? 'Demander à l\'entreprise de venir chercher les articles' : 'Request the company to pick up items')}
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
                        {pickupDays.length > 0 && (
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">
                              {fr ? 'Jour de collecte' : 'Pickup day'}
                            </label>
                            <div className="flex flex-wrap gap-2">
                              {pickupDays.map((day) => {
                                const dayLabels: Record<string, { fr: string; en: string }> = {
                                  lundi: { fr: 'Lundi', en: 'Mon' },
                                  mardi: { fr: 'Mardi', en: 'Tue' },
                                  mercredi: { fr: 'Mercredi', en: 'Wed' },
                                  jeudi: { fr: 'Jeudi', en: 'Thu' },
                                  vendredi: { fr: 'Vendredi', en: 'Fri' },
                                  samedi: { fr: 'Samedi', en: 'Sat' },
                                  dimanche: { fr: 'Dimanche', en: 'Sun' },
                                };
                                const label = dayLabels[day]?.[lang === 'fr' ? 'fr' : 'en'] ?? day;
                                return (
                                  <button
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
                            {fr ? 'Adresse de collecte' : 'Pickup address'}
                          </label>
                          <input
                            type="text"
                            value={pickupAddress}
                            onChange={(e) => setPickupAddress(e.target.value)}
                            placeholder={fr ? 'Ex: Rue 12, Quartier Médina, Dakar' : 'Ex: 12 Main St, Downtown'}
                            className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1.5">
                            {fr ? 'Position GPS' : 'GPS location'}
                          </label>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={captureGps}
                              disabled={gpsLoading}
                              className="px-3 py-2.5 rounded-lg bg-sky-50 border border-sky-200 text-sky-600 text-sm font-medium hover:bg-sky-100 transition-colors disabled:opacity-50 flex items-center gap-2 flex-shrink-0"
                            >
                              {gpsLoading ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Navigation className="w-4 h-4" />
                              )}
                              {fr ? 'Partager ma position' : 'Share my location'}
                            </button>
                            {pickupLat !== null && pickupLng !== null && (
                              <div className="flex items-center gap-1.5 text-sm text-emerald-600 flex-1 min-w-0">
                                <Check className="w-4 h-4 flex-shrink-0" />
                                <span className="truncate">
                                  {pickupLat.toFixed(5)}, {pickupLng.toFixed(5)}
                                </span>
                                <a
                                  href={`https://www.google.com/maps?q=${pickupLat},${pickupLng}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sky-500 hover:text-sky-600 text-xs underline flex-shrink-0"
                                >
                                  {fr ? 'Voir' : 'View'}
                                </a>
                              </div>
                            )}
                          </div>
                          {gpsError && (
                            <p className="text-xs text-red-500 mt-1.5">{gpsError}</p>
                          )}
                          {pickupLat === null && !gpsError && (
                            <p className="text-xs text-slate-400 mt-1.5">
                              {fr ? 'Partagez votre position pour calculer les frais selon la distance.' : 'Share your location to calculate fees based on distance.'}
                            </p>
                          )}
                        </div>

                        {pickupFeeEstimate !== null && (
                          <div className="rounded-lg bg-amber-50 border border-amber-100 p-3 flex items-center justify-between">
                            <span className="text-xs text-slate-600">
                              {fr ? 'Frais de collecte estimés' : 'Estimated pickup fee'}
                            </span>
                            <span className="text-sm font-bold text-amber-700">{formatPrice(pickupFeeEstimate)}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {orderArticles.length > 0 && (
                  <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                    <button
                      onClick={() => setDeliveryRequested(!deliveryRequested)}
                      className="w-full flex items-center gap-3 px-5 py-4 hover:bg-slate-50/50 transition-colors"
                    >
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
                        deliveryRequested ? 'bg-sky-100 text-sky-600' : 'bg-slate-100 text-slate-400'
                      }`}>
                        <Truck className="w-5 h-5" />
                      </div>
                      <div className="text-left flex-1">
                        <p className="text-sm font-semibold text-slate-900">
                          {fr ? 'Livraison à domicile' : 'Home delivery'}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {deliveryRequested
                            ? (fr ? 'La commande sera livrée à l’adresse indiquée' : 'The order will be delivered to the address below')
                            : (fr ? 'Demander la livraison de votre commande' : 'Request delivery of your order')}
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
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1.5">
                            {fr ? 'Adresse de livraison' : 'Delivery address'}
                          </label>
                          <input
                            type="text"
                            value={deliveryAddress}
                            onChange={(e) => setDeliveryAddress(e.target.value)}
                            placeholder={fr ? 'Ex: Rue 12, Quartier Médina, Dakar' : 'Ex: 12 Main St, Downtown'}
                            className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1.5">
                            {fr ? 'Position GPS (pour le calcul des frais)' : 'GPS location (for fee calculation)'}
                          </label>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={captureDeliveryGps}
                              disabled={deliveryGpsLoading}
                              className="px-3 py-2.5 rounded-lg bg-sky-50 border border-sky-200 text-sky-600 text-sm font-medium hover:bg-sky-100 transition-colors disabled:opacity-50 flex items-center gap-2 flex-shrink-0"
                            >
                              {deliveryGpsLoading ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Navigation className="w-4 h-4" />
                              )}
                              {fr ? 'Partager ma position' : 'Share my location'}
                            </button>
                            {deliveryLat !== null && deliveryLng !== null && (
                              <div className="flex items-center gap-1.5 text-sm text-emerald-600 flex-1 min-w-0">
                                <Check className="w-4 h-4 flex-shrink-0" />
                                <span className="truncate">
                                  {deliveryLat.toFixed(5)}, {deliveryLng.toFixed(5)}
                                </span>
                                <a
                                  href={`https://www.google.com/maps?q=${deliveryLat},${deliveryLng}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sky-500 hover:text-sky-600 text-xs underline flex-shrink-0"
                                >
                                  {fr ? 'Voir' : 'View'}
                                </a>
                              </div>
                            )}
                          </div>
                          {deliveryGpsError && (
                            <p className="text-xs text-red-500 mt-1.5">{deliveryGpsError}</p>
                          )}
                          {deliveryLat === null && !deliveryGpsError && (
                            <p className="text-xs text-slate-400 mt-1.5">
                              {fr ? 'Partagez votre position pour calculer les frais selon la distance.' : 'Share your location to calculate fees based on distance.'}
                            </p>
                          )}
                        </div>

                        {deliveryFeeEstimate !== null && (
                          <div className="rounded-lg bg-sky-50 border border-sky-100 p-3 flex items-center justify-between">
                            <span className="text-xs text-slate-600">
                              {fr ? 'Frais de livraison estimés' : 'Estimated delivery fee'}
                            </span>
                            <span className="text-sm font-bold text-sky-700">{formatPrice(deliveryFeeEstimate)}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {orderArticles.length > 0 && (
                  <div className="space-y-2">
                    {editingDepotId && (
                      <button
                        onClick={cancelEdit}
                        className="w-full px-4 py-3 rounded-lg border border-slate-200 text-slate-600 font-medium text-sm hover:bg-slate-50 transition-colors"
                      >
                        {fr ? 'Annuler la modification' : 'Cancel edit'}
                      </button>
                    )}
                    <button
                      onClick={editingDepotId ? submitEditOrder : submitOrder}
                      disabled={(editingDepotId ? editLoading : submitting) || (typesTraitement.length > 0 && !selectedTypeTraitementId)}
                      className="w-full px-4 py-3 rounded-lg bg-sky-500 text-white font-medium text-sm hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
                            : (fr ? 'Valider ma commande' : 'Submit my order')}
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
