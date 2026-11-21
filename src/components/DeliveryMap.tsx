import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Map as GoogleMap,
  AdvancedMarker,
  Pin,
  InfoWindow,
  useMap,
  useMapsLibrary,
  useAdvancedMarkerRef,
  type MapMouseEvent,
} from '@vis.gl/react-google-maps';
import { GoogleMapsProvider } from '@/components/BoutiquesMap';
import {
  DEFAULT_MAP_CENTER,
  GMP_ATTRIBUTION_IDS,
  buildGoogleMapsDirectionsUrl,
  formatCoordsDisplay,
  getGoogleMapsApiKey,
  isValidCoordinatePair,
  type GeoPoint,
} from '@/lib/googleMaps';
import { useOfflineStatus } from '@/hooks/useOfflineStatus';
import {
  Crosshair,
  ExternalLink,
  Loader2,
  MapPin,
  Maximize2,
  MessageCircle,
  Phone,
  Store,
  WifiOff,
} from 'lucide-react';

function haversineDistanceKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

function ClientPickerController({
  mapId,
  selectedPos,
  shopPos,
}: {
  mapId: string;
  selectedPos: GeoPoint | null;
  shopPos: GeoPoint | null;
}) {
  const map = useMap(mapId);
  const coreLib = useMapsLibrary('core');

  useEffect(() => {
    if (!map) return;
    if (selectedPos && shopPos && coreLib) {
      const bounds = new coreLib.LatLngBounds();
      bounds.extend(selectedPos);
      bounds.extend(shopPos);
      map.fitBounds(bounds, { top: 36, right: 36, bottom: 42, left: 36 });
      return;
    }
    if (selectedPos) {
      map.panTo(selectedPos);
      if ((map.getZoom() ?? 12) < 15) map.setZoom(15);
      return;
    }
    if (shopPos) {
      map.panTo(shopPos);
      map.setZoom(13);
    }
  }, [map, coreLib, selectedPos?.lat, selectedPos?.lng, shopPos?.lat, shopPos?.lng]);

  return null;
}

export function ClientLocationMapPicker({
  id,
  latitude,
  longitude,
  shopLatitude,
  shopLongitude,
  shopName,
  accent = 'amber',
  lang,
  onSelect,
}: {
  id: string;
  latitude: number | null;
  longitude: number | null;
  shopLatitude?: number | null;
  shopLongitude?: number | null;
  shopName?: string;
  accent?: 'amber' | 'sky';
  lang: 'fr' | 'en';
  onSelect: (lat: number, lng: number) => void;
}) {
  const apiKey = getGoogleMapsApiKey();
  const { isOnline } = useOfflineStatus();
  const fr = lang === 'fr';

  const selectedPos = useMemo<GeoPoint | null>(() => {
    if (isValidCoordinatePair(latitude, longitude)) {
      return { lat: Number(latitude), lng: Number(longitude) };
    }
    return null;
  }, [latitude, longitude]);

  const shopPos = useMemo<GeoPoint | null>(() => {
    if (isValidCoordinatePair(shopLatitude, shopLongitude)) {
      return { lat: Number(shopLatitude), lng: Number(shopLongitude) };
    }
    return null;
  }, [shopLatitude, shopLongitude]);

  const distanceKm = useMemo(() => {
    if (!selectedPos || !shopPos) return null;
    return haversineDistanceKm(shopPos, selectedPos);
  }, [selectedPos, shopPos]);

  const defaultCenter = selectedPos ?? shopPos ?? DEFAULT_MAP_CENTER;
  const pinBg = accent === 'amber' ? '#d97706' : '#0284c7';
  const pinBorder = accent === 'amber' ? '#b45309' : '#0369a1';

  function handleMapClick(e: MapMouseEvent) {
    const latLng = e.detail.latLng;
    if (!latLng) return;
    onSelect(
      Math.round(latLng.lat * 1_000_000) / 1_000_000,
      Math.round(latLng.lng * 1_000_000) / 1_000_000,
    );
  }

  function handleDragEnd(e: { latLng?: { lat: () => number; lng: () => number } | null }) {
    const latLng = e.latLng;
    if (!latLng) return;
    onSelect(
      Math.round(latLng.lat() * 1_000_000) / 1_000_000,
      Math.round(latLng.lng() * 1_000_000) / 1_000_000,
    );
  }

  if (!isOnline) {
    return (
      <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-3 text-xs text-slate-500 flex items-center gap-2">
        <WifiOff className="w-4 h-4 text-slate-400 flex-shrink-0" />
        <span>
          {fr
            ? 'Carte indisponible hors ligne. Utilisez le bouton GPS ou saisissez votre adresse précise.'
            : 'Map unavailable offline. Use the GPS button or enter your exact address.'}
        </span>
      </div>
    );
  }

  if (!apiKey) {
    return null;
  }

  return (
    <div className="space-y-1.5">
      <div className="relative w-full h-[210px] rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
        <GoogleMapsProvider lang={lang}>
          <GoogleMap
            id={id}
            defaultCenter={defaultCenter}
            defaultZoom={selectedPos ? 15 : 13}
            mapId="DEMO_MAP_ID"
            internalUsageAttributionIds={GMP_ATTRIBUTION_IDS}
            gestureHandling="greedy"
            streetViewControl={false}
            mapTypeControl={false}
            fullscreenControl={false}
            style={{ width: '100%', height: '100%' }}
            onClick={handleMapClick}
          >
            <ClientPickerController mapId={id} selectedPos={selectedPos} shopPos={shopPos} />

            {shopPos && (
              <AdvancedMarker
                position={shopPos}
                title={shopName || (fr ? 'Pressing' : 'Dry cleaner')}
              >
                <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-slate-900 text-white text-[10px] font-semibold shadow-md border border-white">
                  <Store className="w-3 h-3 text-sky-400" />
                  <span className="max-w-[100px] truncate">{shopName || 'Pressing'}</span>
                </div>
              </AdvancedMarker>
            )}

            {selectedPos && (
              <AdvancedMarker
                position={selectedPos}
                draggable={true}
                onDragEnd={handleDragEnd}
                title={fr ? 'Votre position choisie' : 'Your chosen location'}
              >
                <Pin background={pinBg} borderColor={pinBorder} glyphColor="#ffffff" />
              </AdvancedMarker>
            )}
          </GoogleMap>
        </GoogleMapsProvider>

        <div className="pointer-events-none absolute bottom-2 left-2 right-2 flex justify-center">
          <span className="px-2.5 py-1 rounded-md bg-slate-900/75 text-white text-[11px] backdrop-blur-xs text-center">
            {selectedPos
              ? fr
                ? 'Cliquez sur la carte ou glissez l’épingle pour ajuster votre adresse'
                : 'Click the map or drag the pin to adjust your address'
              : fr
                ? 'Touchez la carte pour placer votre point de rendez-vous'
                : 'Tap the map to drop your meeting point'}
          </span>
        </div>
      </div>

      {distanceKm !== null && (
        <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
          <span className="inline-flex items-center gap-1">
            <MapPin className="w-3 h-3 text-sky-500" />
            {fr ? 'Distance estimée depuis le pressing :' : 'Estimated distance from dry cleaner:'}
          </span>
          <span className="font-semibold text-slate-700">{distanceKm.toFixed(1)} km</span>
        </div>
      )}
    </div>
  );
}

export interface LogisticsMapStop {
  id: string;
  title: string;
  subtitle?: string;
  address?: string | null;
  phone?: string | null;
  lat: number;
  lng: number;
  badge?: string;
  pinBg: string;
  pinBorder: string;
  amountLabel?: string;
  whatsappUrl?: string | null;
}

function TourMapController({
  mapId,
  stops,
  fitNonce,
  userPosition,
  userPosNonce,
}: {
  mapId: string;
  stops: LogisticsMapStop[];
  fitNonce: number;
  userPosition: GeoPoint | null;
  userPosNonce: number;
}) {
  const map = useMap(mapId);
  const coreLib = useMapsLibrary('core');

  const fitAll = useCallback(() => {
    if (!map) return;
    if (stops.length === 0) {
      map.panTo(DEFAULT_MAP_CENTER);
      map.setZoom(12);
      return;
    }
    if (stops.length === 1) {
      map.panTo({ lat: stops[0].lat, lng: stops[0].lng });
      map.setZoom(15);
      return;
    }
    if (!coreLib) return;
    const bounds = new coreLib.LatLngBounds();
    for (const s of stops) {
      bounds.extend({ lat: s.lat, lng: s.lng });
    }
    map.fitBounds(bounds, { top: 44, right: 44, bottom: 44, left: 44 });
  }, [map, coreLib, stops]);

  useEffect(() => {
    fitAll();
  }, [fitAll, fitNonce]);

  useEffect(() => {
    if (!map || !userPosition || userPosNonce === 0) return;
    map.panTo(userPosition);
    map.setZoom(14);
  }, [map, userPosition, userPosNonce]);

  return null;
}

function TourStopMarker({
  stop,
  index,
  isOpen,
  lang,
  onOpen,
  onClose,
}: {
  stop: LogisticsMapStop;
  index: number;
  isOpen: boolean;
  lang: 'fr' | 'en';
  onOpen: () => void;
  onClose: () => void;
}) {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const fr = lang === 'fr';

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={{ lat: stop.lat, lng: stop.lng }}
        title={stop.title}
        onClick={onOpen}
      >
        <Pin
          background={stop.pinBg}
          borderColor={stop.pinBorder}
          glyphColor="#ffffff"
          glyphText={String(index + 1)}
        />
      </AdvancedMarker>

      {isOpen && marker && (
        <InfoWindow anchor={marker} onCloseClick={onClose} maxWidth={270}>
          <div className="p-1 text-slate-800 space-y-2 min-w-[210px]">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-sm text-slate-900 truncate">{stop.title}</p>
                {stop.subtitle && (
                  <p className="text-xs text-slate-500 truncate">{stop.subtitle}</p>
                )}
              </div>
              {stop.badge && (
                <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-semibold flex-shrink-0">
                  {stop.badge}
                </span>
              )}
            </div>

            {stop.address && (
              <p className="text-xs text-slate-600 flex items-start gap-1">
                <MapPin className="w-3 h-3 text-slate-400 mt-0.5 flex-shrink-0" />
                <span>{stop.address}</span>
              </p>
            )}

            {stop.amountLabel && (
              <p className="text-xs font-semibold text-slate-800">{stop.amountLabel}</p>
            )}

            <p className="text-[10px] font-mono text-slate-400">
              {formatCoordsDisplay(stop.lat, stop.lng)}
            </p>

            <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-100">
              <a
                href={buildGoogleMapsDirectionsUrl(stop.lat, stop.lng)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-md bg-sky-500 text-white text-xs font-medium hover:bg-sky-600 transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                {fr ? 'Itinéraire' : 'Directions'}
              </a>
              {stop.phone && (
                <a
                  href={`tel:${stop.phone}`}
                  className="inline-flex items-center justify-center p-1.5 rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
                  title={stop.phone}
                >
                  <Phone className="w-3.5 h-3.5" />
                </a>
              )}
              {stop.whatsappUrl && (
                <a
                  href={stop.whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center p-1.5 rounded-md bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
                  title="WhatsApp"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
}

export function LogisticsTourMap({
  mapId,
  title,
  stops,
  lang,
}: {
  mapId: string;
  title: string;
  stops: LogisticsMapStop[];
  lang: 'fr' | 'en';
}) {
  const apiKey = getGoogleMapsApiKey();
  const { isOnline } = useOfflineStatus();
  const fr = lang === 'fr';
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fitNonce, setFitNonce] = useState(0);
  const [userPosition, setUserPosition] = useState<GeoPoint | null>(null);
  const [userPosNonce, setUserPosNonce] = useState(0);
  const [locating, setLocating] = useState(false);

  const initialCenter = useMemo<GeoPoint>(() => {
    if (stops.length > 0) return { lat: stops[0].lat, lng: stops[0].lng };
    return DEFAULT_MAP_CENTER;
  }, [stops]);

  function locateMe() {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setUserPosNonce((n) => n + 1);
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  if (!apiKey) return null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
      <div className="px-4 py-2.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <MapPin className="w-4 h-4 text-sky-600 flex-shrink-0" />
          <p className="text-sm font-semibold text-slate-900 truncate">{title}</p>
          <span className="text-xs text-slate-500">
            ({stops.length} {fr ? 'point(s) GPS' : 'GPS stop(s)'})
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {stops.length > 0 && isOnline && (
            <button
              type="button"
              onClick={() => {
                setSelectedId(null);
                setFitNonce((n) => n + 1);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              {fr ? 'Tout voir' : 'Fit all'}
            </button>
          )}
          {isOnline && (
            <button
              type="button"
              onClick={locateMe}
              disabled={locating}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-50 border border-sky-200 text-xs font-medium text-sky-700 hover:bg-sky-100 transition-colors disabled:opacity-60"
            >
              {locating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Crosshair className="w-3.5 h-3.5" />}
              {fr ? 'Ma position' : 'My location'}
            </button>
          )}
        </div>
      </div>

      {!isOnline ? (
        <div className="h-[220px] bg-slate-50 flex flex-col items-center justify-center text-center px-4 gap-1.5">
          <WifiOff className="w-5 h-5 text-slate-400" />
          <p className="text-xs text-slate-500">
            {fr ? 'Carte de tournée indisponible hors ligne' : 'Tour map unavailable offline'}
          </p>
        </div>
      ) : (
        <div className="relative w-full h-[300px] sm:h-[340px] bg-slate-100">
          <GoogleMapsProvider lang={lang}>
            <GoogleMap
              id={mapId}
              defaultCenter={initialCenter}
              defaultZoom={stops.length === 1 ? 15 : 12}
              mapId="DEMO_MAP_ID"
              internalUsageAttributionIds={GMP_ATTRIBUTION_IDS}
              gestureHandling="greedy"
              streetViewControl={false}
              mapTypeControl={false}
              fullscreenControl={true}
              style={{ width: '100%', height: '100%' }}
              onClick={() => setSelectedId(null)}
            >
              <TourMapController
                mapId={mapId}
                stops={stops}
                fitNonce={fitNonce}
                userPosition={userPosition}
                userPosNonce={userPosNonce}
              />

              {stops.map((stop, idx) => (
                <TourStopMarker
                  key={stop.id}
                  stop={stop}
                  index={idx}
                  isOpen={selectedId === stop.id}
                  lang={lang}
                  onOpen={() => setSelectedId(stop.id)}
                  onClose={() => setSelectedId((cur) => (cur === stop.id ? null : cur))}
                />
              ))}

              {userPosition && (
                <AdvancedMarker
                  position={userPosition}
                  title={fr ? 'Votre position' : 'Your position'}
                >
                  <div className="w-4 h-4 rounded-full bg-blue-600 border-2 border-white shadow-md ring-4 ring-blue-500/25" />
                </AdvancedMarker>
              )}
            </GoogleMap>
          </GoogleMapsProvider>
        </div>
      )}
    </div>
  );
}
