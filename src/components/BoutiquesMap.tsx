import { useEffect, useMemo, useRef, useState, useCallback, type ReactNode } from 'react';
import {
  APIProvider,
  APILoadingStatus,
  Map as GoogleMap,
  AdvancedMarker,
  Pin,
  InfoWindow,
  useApiLoadingStatus,
  useMap,
  useMapsLibrary,
  useAdvancedMarkerRef,
  type MapMouseEvent,
} from '@vis.gl/react-google-maps';
import type { Boutique } from '@/types';
import {
  DEFAULT_MAP_CENTER,
  GMP_ATTRIBUTION_IDS,
  buildGoogleMapsDirectionsUrl,
  formatCoordsDisplay,
  getGoogleMapsApiKey,
  isValidCoordinatePair,
  normalizeCoordinate,
  type GeoPoint,
} from '@/lib/googleMaps';
import { useOfflineStatus } from '@/hooks/useOfflineStatus';
import {
  Crosshair,
  Edit2,
  ExternalLink,
  Loader2,
  MapPin,
  Maximize2,
  Navigation,
  Phone,
  Search,
  Star,
  Store,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react';

function resolveMapsRegion(lang: 'fr' | 'en'): string {
  if (typeof navigator !== 'undefined' && navigator.language) {
    const parts = navigator.language.split('-');
    if (parts.length >= 2 && /^[A-Za-z]{2}$/.test(parts[1])) {
      return parts[1].toUpperCase();
    }
  }
  return lang === 'fr' ? 'CI' : 'US';
}

function MapsAuthWatcher() {
  const status = useApiLoadingStatus();
  useEffect(() => {
    if (status === APILoadingStatus.AUTH_FAILURE) {
      window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
    }
  }, [status]);
  return null;
}

export function GoogleMapsProvider({
  lang,
  children,
}: {
  lang: 'fr' | 'en';
  children: ReactNode;
}) {
  const apiKey = getGoogleMapsApiKey();
  const region = useMemo(() => resolveMapsRegion(lang), [lang]);
  if (!apiKey) {
    return <>{children}</>;
  }
  return (
    <APIProvider apiKey={apiKey} language={lang} region={region}>
      <MapsAuthWatcher />
      {children}
    </APIProvider>
  );
}

interface LocatedBoutique extends Boutique {
  latitude: number;
  longitude: number;
}

function OverviewMapController({
  locatedBoutiques,
  focusedBoutique,
  focusNonce,
  fitAllNonce,
  userPosition,
  userPosNonce,
}: {
  locatedBoutiques: LocatedBoutique[];
  focusedBoutique: LocatedBoutique | null;
  focusNonce: number;
  fitAllNonce: number;
  userPosition: GeoPoint | null;
  userPosNonce: number;
}) {
  const map = useMap('boutiques-overview-map');
  const coreLib = useMapsLibrary('core');

  const fitAll = useCallback(() => {
    if (!map) return;
    if (locatedBoutiques.length === 0) {
      map.panTo(DEFAULT_MAP_CENTER);
      map.setZoom(12);
      return;
    }
    if (locatedBoutiques.length === 1) {
      map.panTo({
        lat: locatedBoutiques[0].latitude,
        lng: locatedBoutiques[0].longitude,
      });
      map.setZoom(15);
      return;
    }
    if (!coreLib) return;
    const bounds = new coreLib.LatLngBounds();
    for (const b of locatedBoutiques) {
      bounds.extend({ lat: b.latitude, lng: b.longitude });
    }
    map.fitBounds(bounds, { top: 48, right: 48, bottom: 48, left: 48 });
  }, [map, coreLib, locatedBoutiques]);

  useEffect(() => {
    fitAll();
  }, [fitAll, fitAllNonce]);

  useEffect(() => {
    if (!map || !focusedBoutique || focusNonce === 0) return;
    map.panTo({ lat: focusedBoutique.latitude, lng: focusedBoutique.longitude });
    map.setZoom(16);
  }, [map, focusedBoutique, focusNonce]);

  useEffect(() => {
    if (!map || !userPosition || userPosNonce === 0) return;
    map.panTo(userPosition);
    map.setZoom(15);
  }, [map, userPosition, userPosNonce]);

  return null;
}

function BoutiqueMarkerItem({
  boutique,
  isCurrent,
  isOpen,
  canEdit,
  lang,
  onOpen,
  onClose,
  onSelect,
  onEdit,
}: {
  boutique: LocatedBoutique;
  isCurrent: boolean;
  isOpen: boolean;
  canEdit: boolean;
  lang: 'fr' | 'en';
  onOpen: () => void;
  onClose: () => void;
  onSelect: (b: Boutique) => void;
  onEdit?: (b: Boutique) => void;
}) {
  const [markerRef, marker] = useAdvancedMarkerRef();

  const pinStyle = isCurrent
    ? { background: '#0284c7', borderColor: '#0369a1', glyphColor: '#ffffff' }
    : boutique.is_default
      ? { background: '#d97706', borderColor: '#b45309', glyphColor: '#ffffff' }
      : { background: '#334155', borderColor: '#0f172a', glyphColor: '#ffffff' };

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={{ lat: boutique.latitude, lng: boutique.longitude }}
        title={boutique.nom}
        onClick={onOpen}
      >
        <Pin
          background={pinStyle.background}
          borderColor={pinStyle.borderColor}
          glyphColor={pinStyle.glyphColor}
          scale={isCurrent ? 1.15 : 1}
        />
      </AdvancedMarker>

      {isOpen && marker && (
        <InfoWindow anchor={marker} onCloseClick={onClose} maxWidth={280}>
          <div className="p-1 text-slate-800 space-y-2 min-w-[210px]">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <Store className="w-3.5 h-3.5 text-sky-600 flex-shrink-0" />
                  <h4 className="font-semibold text-sm text-slate-900 truncate">
                    {boutique.nom}
                  </h4>
                </div>
                {boutique.ville && (
                  <p className="text-xs text-slate-500 mt-0.5">{boutique.ville}</p>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {isCurrent && (
                  <span className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 text-[10px] font-semibold">
                    {lang === 'fr' ? 'Active' : 'Active'}
                  </span>
                )}
                {boutique.is_default && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-semibold">
                    <Star className="w-2.5 h-2.5" />
                    {lang === 'fr' ? 'Défaut' : 'Default'}
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-1 text-xs text-slate-600">
              {boutique.adresse && (
                <div className="flex items-start gap-1.5">
                  <MapPin className="w-3 h-3 text-slate-400 mt-0.5 flex-shrink-0" />
                  <span>{boutique.adresse}</span>
                </div>
              )}
              {boutique.telephone && (
                <div className="flex items-center gap-1.5">
                  <Phone className="w-3 h-3 text-slate-400 flex-shrink-0" />
                  <span>{boutique.telephone}</span>
                </div>
              )}
              <div className="font-mono text-[11px] text-slate-500 bg-slate-50 px-2 py-1 rounded border border-slate-100">
                {formatCoordsDisplay(boutique.latitude, boutique.longitude)}
              </div>
            </div>

            <div className="flex items-center gap-1.5 pt-1 border-t border-slate-100">
              {!isCurrent && (
                <button
                  type="button"
                  onClick={() => onSelect(boutique)}
                  className="flex-1 px-2.5 py-1.5 rounded-md bg-sky-500 text-white text-xs font-medium hover:bg-sky-600 transition-colors"
                >
                  {lang === 'fr' ? 'Sélectionner' : 'Select'}
                </button>
              )}
              <a
                href={buildGoogleMapsDirectionsUrl(boutique.latitude, boutique.longitude)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-md bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200 transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                {lang === 'fr' ? 'Itinéraire' : 'Directions'}
              </a>
              {canEdit && onEdit && (
                <button
                  type="button"
                  onClick={() => onEdit(boutique)}
                  title={lang === 'fr' ? 'Modifier la position' : 'Edit location'}
                  className="p-1.5 rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
}

export function BoutiquesOverviewMap({
  boutiques,
  currentBoutiqueId,
  focusedBoutiqueId,
  focusNonce,
  onSelectBoutique,
  onEditBoutique,
  canEdit,
  lang,
}: {
  boutiques: Boutique[];
  currentBoutiqueId: string | null;
  focusedBoutiqueId: string | null;
  focusNonce: number;
  onSelectBoutique: (b: Boutique) => void;
  onEditBoutique?: (b: Boutique) => void;
  canEdit: boolean;
  lang: 'fr' | 'en';
}) {
  const apiKey = getGoogleMapsApiKey();
  const { isOnline } = useOfflineStatus();
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [fitAllNonce, setFitAllNonce] = useState(0);
  const [userPosition, setUserPosition] = useState<GeoPoint | null>(null);
  const [userPosNonce, setUserPosNonce] = useState(0);
  const [locatingUser, setLocatingUser] = useState(false);
  const [geoMessage, setGeoMessage] = useState<string | null>(null);

  const locatedBoutiques = useMemo<LocatedBoutique[]>(() => {
    return boutiques.filter((b): b is LocatedBoutique =>
      isValidCoordinatePair(b.latitude, b.longitude),
    );
  }, [boutiques]);

  const focusedBoutique = useMemo<LocatedBoutique | null>(() => {
    if (!focusedBoutiqueId) return null;
    return locatedBoutiques.find((b) => b.id === focusedBoutiqueId) ?? null;
  }, [focusedBoutiqueId, locatedBoutiques]);

  useEffect(() => {
    if (focusedBoutique && focusNonce > 0) {
      setSelectedMarkerId(focusedBoutique.id);
    }
  }, [focusedBoutique, focusNonce]);

  const initialCenter = useMemo<GeoPoint>(() => {
    if (locatedBoutiques.length > 0) {
      return {
        lat: locatedBoutiques[0].latitude,
        lng: locatedBoutiques[0].longitude,
      };
    }
    return DEFAULT_MAP_CENTER;
  }, [locatedBoutiques]);

  function handleLocateMe() {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setGeoMessage(
        lang === 'fr'
          ? 'La géolocalisation n’est pas prise en charge par votre navigateur.'
          : 'Geolocation is not supported by your browser.',
      );
      return;
    }
    setLocatingUser(true);
    setGeoMessage(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setUserPosNonce((n) => n + 1);
        setLocatingUser(false);
      },
      (err) => {
        setLocatingUser(false);
        if (err.code === err.PERMISSION_DENIED) {
          setGeoMessage(
            lang === 'fr'
              ? 'Accès GPS refusé. Autorisez la localisation dans votre navigateur.'
              : 'Location permission denied. Allow location access in your browser.',
          );
        } else {
          setGeoMessage(
            lang === 'fr'
              ? 'Impossible de récupérer votre position GPS actuellement.'
              : 'Unable to retrieve your current GPS position.',
          );
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
      {/* Map Header */}
      <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center flex-shrink-0">
            <MapPin className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 truncate">
              {lang === 'fr' ? 'Carte des boutiques' : 'Boutiques Map'}
            </h2>
            <p className="text-xs text-slate-500">
              {lang === 'fr'
                ? `${locatedBoutiques.length} / ${boutiques.length} boutique${boutiques.length > 1 ? 's' : ''} géolocalisée${locatedBoutiques.length > 1 ? 's' : ''}`
                : `${locatedBoutiques.length} / ${boutiques.length} boutique${boutiques.length > 1 ? 's' : ''} geolocated`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {locatedBoutiques.length > 0 && isOnline && apiKey && (
            <button
              type="button"
              onClick={() => {
                setSelectedMarkerId(null);
                setFitAllNonce((n) => n + 1);
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              {lang === 'fr' ? 'Tout afficher' : 'Fit all'}
            </button>
          )}
          {isOnline && apiKey && (
            <button
              type="button"
              onClick={handleLocateMe}
              disabled={locatingUser}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sky-50 border border-sky-200 text-xs font-medium text-sky-700 hover:bg-sky-100 transition-colors disabled:opacity-60"
            >
              {locatingUser ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Crosshair className="w-3.5 h-3.5" />
              )}
              {lang === 'fr' ? 'Ma position' : 'My location'}
            </button>
          )}
        </div>
      </div>

      {geoMessage && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-800">
          {geoMessage}
        </div>
      )}

      {/* Map Viewport */}
      {!isOnline ? (
        <div className="h-[240px] bg-slate-50 flex flex-col items-center justify-center text-center px-6 gap-2">
          <div className="w-11 h-11 rounded-full bg-slate-200/70 flex items-center justify-center text-slate-500">
            <WifiOff className="w-5 h-5" />
          </div>
          <p className="text-sm font-medium text-slate-700">
            {lang === 'fr' ? 'Carte indisponible hors-ligne' : 'Map unavailable offline'}
          </p>
          <p className="text-xs text-slate-500 max-w-sm">
            {lang === 'fr'
              ? 'Les coordonnées GPS de vos boutiques restent enregistrées localement et s’afficheront sur la carte dès le retour de la connexion.'
              : 'Your boutique GPS coordinates remain saved locally and will appear on the map as soon as you reconnect.'}
          </p>
        </div>
      ) : !apiKey ? (
        <div className="h-[240px] bg-slate-50 flex flex-col items-center justify-center text-center px-6 gap-2">
          <div className="w-11 h-11 rounded-full bg-amber-100 flex items-center justify-center text-amber-600">
            <MapPin className="w-5 h-5" />
          </div>
          <p className="text-sm font-medium text-slate-800">
            {lang === 'fr'
              ? 'Clé Google Maps non configurée'
              : 'Google Maps API key not configured'}
          </p>
          <p className="text-xs text-slate-500 max-w-md">
            {lang === 'fr'
              ? 'Ajoutez la variable VITE_GOOGLE_MAPS_API_KEY dans votre environnement pour afficher la carte interactive. Vous pouvez tout de même enregistrer les coordonnées GPS sur chaque boutique.'
              : 'Add VITE_GOOGLE_MAPS_API_KEY to your environment to render the interactive map. You can still save GPS coordinates on each boutique.'}
          </p>
        </div>
      ) : (
        <div className="relative w-full h-[340px] sm:h-[390px] bg-slate-100">
          <GoogleMap
            id="boutiques-overview-map"
            defaultCenter={initialCenter}
            defaultZoom={locatedBoutiques.length === 1 ? 15 : 12}
            mapId="DEMO_MAP_ID"
            internalUsageAttributionIds={GMP_ATTRIBUTION_IDS}
            gestureHandling="greedy"
            streetViewControl={false}
            mapTypeControl={true}
            fullscreenControl={true}
            style={{ width: '100%', height: '100%' }}
            onClick={() => setSelectedMarkerId(null)}
          >
            <OverviewMapController
              locatedBoutiques={locatedBoutiques}
              focusedBoutique={focusedBoutique}
              focusNonce={focusNonce}
              fitAllNonce={fitAllNonce}
              userPosition={userPosition}
              userPosNonce={userPosNonce}
            />

            {locatedBoutiques.map((b) => (
              <BoutiqueMarkerItem
                key={b.id}
                boutique={b}
                isCurrent={currentBoutiqueId === b.id}
                isOpen={selectedMarkerId === b.id}
                canEdit={canEdit}
                lang={lang}
                onOpen={() => setSelectedMarkerId(b.id)}
                onClose={() => setSelectedMarkerId((cur) => (cur === b.id ? null : cur))}
                onSelect={onSelectBoutique}
                onEdit={onEditBoutique}
              />
            ))}

            {userPosition && (
              <AdvancedMarker
                position={userPosition}
                title={lang === 'fr' ? 'Votre position actuelle' : 'Your current location'}
              >
                <div className="w-4 h-4 rounded-full bg-blue-600 border-2 border-white shadow-md ring-4 ring-blue-500/25" />
              </AdvancedMarker>
            )}
          </GoogleMap>

          {locatedBoutiques.length === 0 && (
            <div className="pointer-events-none absolute inset-x-4 bottom-4 flex justify-center">
              <div className="pointer-events-auto bg-white/95 backdrop-blur-xs border border-slate-200 rounded-lg px-3.5 py-2 shadow-md text-xs text-slate-700 flex items-center gap-2 max-w-lg">
                <Navigation className="w-3.5 h-3.5 text-sky-600 flex-shrink-0" />
                <span>
                  {lang === 'fr'
                    ? 'Aucune boutique n’a encore de position GPS. Cliquez sur « Localiser » sur une carte boutique ci-dessous pour la placer sur la carte.'
                    : 'No boutique has GPS coordinates yet. Click "Locate" on a boutique card below to place it on the map.'}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Legend Footer */}
      <div className="px-4 py-2.5 bg-slate-50/70 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-sky-600" />
            {lang === 'fr' ? 'Boutique active' : 'Active boutique'}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-600" />
            {lang === 'fr' ? 'Par défaut' : 'Default'}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-700" />
            {lang === 'fr' ? 'Autre boutique' : 'Other boutique'}
          </span>
        </div>
        <span className="text-[11px] text-slate-400">
          {lang === 'fr'
            ? 'Cliquez sur un marqueur pour voir les détails et l’itinéraire'
            : 'Click any marker to view details and directions'}
        </span>
      </div>
    </div>
  );
}

function PickerMapController({
  position,
  panNonce,
}: {
  position: GeoPoint | null;
  panNonce: number;
}) {
  const map = useMap('boutique-location-picker-map');

  useEffect(() => {
    if (!map || !position) return;
    map.panTo(position);
    const curZoom = map.getZoom() ?? 12;
    if (curZoom < 15) {
      map.setZoom(16);
    }
  }, [map, position, panNonce]);

  return null;
}

function isQuotaError(err: unknown): boolean {
  const msg = String(err ?? '');
  return (
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('OVER_QUERY_LIMIT') ||
    msg.includes('QuotaExceededError') ||
    msg.includes('429')
  );
}

interface ResolvedPlaceDetails {
  lat: string;
  lng: string;
  address?: string;
  city?: string;
}

function BoutiquePlaceSearch({
  lang,
  onSelectPlace,
}: {
  lang: 'fr' | 'en';
  onSelectPlace: (details: ResolvedPlaceDetails) => void;
}) {
  const placesLib = useMapsLibrary('places');
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompleteSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [resolving, setResolving] = useState(false);

  const resetSession = useCallback(() => {
    sessionTokenRef.current = null;
    setSuggestions([]);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!placesLib || trimmed.length < 3) {
      setSuggestions([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        setSearching(true);
        const { AutocompleteSessionToken, AutocompleteSuggestion } = placesLib;
        if (!sessionTokenRef.current) {
          sessionTokenRef.current = new AutocompleteSessionToken();
        }
        const res = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: trimmed,
          sessionToken: sessionTokenRef.current,
        });
        if (!cancelled) {
          setSuggestions(res?.suggestions ?? []);
        }
      } catch (err) {
        if (isQuotaError(err)) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        if (!cancelled) {
          setSuggestions([]);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [placesLib, query]);

  async function handlePickSuggestion(suggestion: google.maps.places.AutocompleteSuggestion) {
    if (!placesLib || !suggestion.placePrediction) return;
    setResolving(true);
    try {
      const place = suggestion.placePrediction.toPlace();
      await place.fetchFields({
        fields: ['location', 'formattedAddress', 'addressComponents'],
      });

      const loc = place.location;
      if (loc) {
        const lat = (Math.round(loc.lat() * 1_000_000) / 1_000_000).toString();
        const lng = (Math.round(loc.lng() * 1_000_000) / 1_000_000).toString();
        const components = place.addressComponents ?? [];
        const cityComp = components.find(
          (c) => c.types.includes('locality') || c.types.includes('administrative_area_level_2'),
        );
        onSelectPlace({
          lat,
          lng,
          address: place.formattedAddress ?? undefined,
          city: cityComp?.longText ?? undefined,
        });
      }
      setQuery(suggestion.placePrediction.text?.text ?? '');
      resetSession();
    } catch (err) {
      if (isQuotaError(err)) {
        window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
      }
    } finally {
      setResolving(false);
    }
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            lang === 'fr'
              ? 'Rechercher une adresse ou un quartier sur Google Maps…'
              : 'Search an address or neighborhood on Google Maps…'
          }
          className="w-full pl-8 pr-8 py-2 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white"
        />
        {(searching || resolving) ? (
          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-sky-500 animate-spin" />
        ) : query ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              resetSession();
            }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            aria-label={lang === 'fr' ? 'Effacer la recherche' : 'Clear search'}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : null}
      </div>

      {suggestions.length > 0 && (
        <ul className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto divide-y divide-slate-100">
          {suggestions.map((suggestion, idx) => {
            const label = suggestion.placePrediction?.text?.text;
            if (!label) return null;
            return (
              <li key={suggestion.placePrediction?.placeId ?? idx}>
                <button
                  type="button"
                  onClick={() => void handlePickSuggestion(suggestion)}
                  className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-sky-50 hover:text-sky-800 flex items-start gap-2 transition-colors"
                >
                  <MapPin className="w-3.5 h-3.5 text-sky-500 flex-shrink-0 mt-0.5" />
                  <span className="line-clamp-2">{label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function BoutiqueLocationPicker({
  latitude,
  longitude,
  onChange,
  onPlaceResolved,
  lang,
  boutiqueName,
}: {
  latitude: string;
  longitude: string;
  onChange: (lat: string, lng: string) => void;
  onPlaceResolved?: (details: ResolvedPlaceDetails) => void;
  lang: 'fr' | 'en';
  boutiqueName?: string;
}) {
  const apiKey = getGoogleMapsApiKey();
  const { isOnline } = useOfflineStatus();
  const [capturing, setCapturing] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [panNonce, setPanNonce] = useState(0);

  const parsedLat = normalizeCoordinate(latitude);
  const parsedLng = normalizeCoordinate(longitude);
  const validPosition = useMemo<GeoPoint | null>(() => {
    if (isValidCoordinatePair(parsedLat, parsedLng)) {
      return { lat: parsedLat!, lng: parsedLng! };
    }
    return null;
  }, [parsedLat, parsedLng]);

  function handleCaptureGps() {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setGpsError(
        lang === 'fr'
          ? 'La géolocalisation n’est pas disponible sur cet appareil.'
          : 'Geolocation is not available on this device.',
      );
      return;
    }
    setCapturing(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = (Math.round(pos.coords.latitude * 1_000_000) / 1_000_000).toString();
        const lng = (Math.round(pos.coords.longitude * 1_000_000) / 1_000_000).toString();
        onChange(lat, lng);
        setPanNonce((n) => n + 1);
        setCapturing(false);
      },
      (err) => {
        setCapturing(false);
        if (err.code === err.PERMISSION_DENIED) {
          setGpsError(
            lang === 'fr'
              ? 'Permission GPS refusée. Autorisez la localisation ou cliquez sur la carte.'
              : 'Location permission denied. Allow GPS or click directly on the map.',
          );
        } else {
          setGpsError(
            lang === 'fr'
              ? 'Impossible d’obtenir le signal GPS. Placez le marqueur sur la carte.'
              : 'Unable to get GPS signal. Place the pin directly on the map.',
          );
        }
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 },
    );
  }

  function handleMapClick(e: MapMouseEvent) {
    const latLng = e.detail.latLng;
    if (!latLng) return;
    const lat = (Math.round(latLng.lat * 1_000_000) / 1_000_000).toString();
    const lng = (Math.round(latLng.lng * 1_000_000) / 1_000_000).toString();
    setGpsError(null);
    onChange(lat, lng);
  }

  function handleMarkerDragEnd(e: { latLng?: { lat: () => number; lng: () => number } | null }) {
    const latLng = e.latLng;
    if (!latLng) return;
    const lat = (Math.round(latLng.lat() * 1_000_000) / 1_000_000).toString();
    const lng = (Math.round(latLng.lng() * 1_000_000) / 1_000_000).toString();
    setGpsError(null);
    onChange(lat, lng);
  }

  return (
    <div className="pt-3 border-t border-slate-100 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
          <MapPin className="w-4 h-4 text-sky-600" />
          {lang === 'fr' ? 'Géolocalisation GPS de la boutique' : 'Boutique GPS Location'}
        </label>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCaptureGps}
            disabled={capturing}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sky-50 border border-sky-200 text-xs font-medium text-sky-700 hover:bg-sky-100 transition-colors disabled:opacity-60"
          >
            {capturing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Crosshair className="w-3.5 h-3.5" />
            )}
            {lang === 'fr' ? 'Ma position GPS' : 'Use my GPS'}
          </button>
          {(latitude.trim() !== '' || longitude.trim() !== '') && (
            <button
              type="button"
              onClick={() => {
                setGpsError(null);
                onChange('', '');
              }}
              title={lang === 'fr' ? 'Effacer la position' : 'Clear position'}
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {gpsError && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          {gpsError}
        </div>
      )}

      {/* Interactive Picker Map */}
      {isOnline && apiKey ? (
        <div className="space-y-2">
          <BoutiquePlaceSearch
            lang={lang}
            onSelectPlace={(details) => {
              setGpsError(null);
              onChange(details.lat, details.lng);
              onPlaceResolved?.(details);
              setPanNonce((n) => n + 1);
            }}
          />
          <div className="relative w-full h-[220px] rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
          <GoogleMap
            id="boutique-location-picker-map"
            defaultCenter={validPosition ?? DEFAULT_MAP_CENTER}
            defaultZoom={validPosition ? 16 : 12}
            mapId="DEMO_MAP_ID"
            internalUsageAttributionIds={GMP_ATTRIBUTION_IDS}
            gestureHandling="greedy"
            streetViewControl={false}
            mapTypeControl={false}
            fullscreenControl={false}
            style={{ width: '100%', height: '100%' }}
            onClick={handleMapClick}
          >
            <PickerMapController position={validPosition} panNonce={panNonce} />
            {validPosition && (
              <AdvancedMarker
                position={validPosition}
                draggable={true}
                onDragEnd={handleMarkerDragEnd}
                title={boutiqueName || (lang === 'fr' ? 'Position de la boutique' : 'Boutique location')}
              >
                <Pin background="#0284c7" borderColor="#0369a1" glyphColor="#ffffff" />
              </AdvancedMarker>
            )}
          </GoogleMap>
          <div className="pointer-events-none absolute bottom-2 left-2 right-2 flex justify-center">
            <span className="px-2.5 py-1 rounded-md bg-slate-900/75 text-white text-[11px] backdrop-blur-xs">
              {validPosition
                ? lang === 'fr'
                  ? 'Cliquez sur la carte ou glissez le marqueur pour ajuster'
                  : 'Click the map or drag the pin to adjust'
                : lang === 'fr'
                  ? 'Cliquez sur la carte pour positionner la boutique'
                  : 'Click on the map to place the boutique'}
            </span>
          </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5 text-xs text-slate-500">
          {lang === 'fr'
            ? 'Utilisez « Ma position GPS » ou saisissez directement la latitude et la longitude ci-dessous.'
            : 'Use "Use my GPS" or enter latitude and longitude coordinates below.'}
        </div>
      )}

      {/* Manual Lat / Lng inputs */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            {lang === 'fr' ? 'Latitude' : 'Latitude'}
          </label>
          <input
            type="number"
            step="any"
            value={latitude}
            onChange={(e) => onChange(e.target.value, longitude)}
            placeholder="5.359952"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            {lang === 'fr' ? 'Longitude' : 'Longitude'}
          </label>
          <input
            type="number"
            step="any"
            value={longitude}
            onChange={(e) => onChange(latitude, e.target.value)}
            placeholder="-4.008256"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
          />
        </div>
      </div>
    </div>
  );
}
