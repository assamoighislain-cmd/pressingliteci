export interface GeoPoint {
  lat: number;
  lng: number;
}

export const DEFAULT_MAP_CENTER: GeoPoint = {
  lat: 5.359952,
  lng: -4.008256,
};

export const GMP_ATTRIBUTION_IDS: string[] = ['gmp_mcp_codeassist_v1_aistudio'];

export function getGoogleMapsApiKey(): string {
  const fromImportMeta = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim();
  if (fromImportMeta) return fromImportMeta;
  if (typeof __GOOGLE_MAPS_API_KEY__ !== 'undefined' && __GOOGLE_MAPS_API_KEY__.trim()) {
    return __GOOGLE_MAPS_API_KEY__.trim();
  }
  return '';
}

export function isValidCoordinatePair(
  lat: number | null | undefined,
  lng: number | null | undefined,
): boolean {
  if (lat == null || lng == null) return false;
  const nLat = Number(lat);
  const nLng = Number(lng);
  return (
    Number.isFinite(nLat) &&
    Number.isFinite(nLng) &&
    nLat >= -90 &&
    nLat <= 90 &&
    nLng >= -180 &&
    nLng <= 180
  );
}

export function normalizeCoordinate(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.').trim());
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 1_000_000) / 1_000_000;
}

export function formatCoordsDisplay(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export function buildGoogleMapsDirectionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lng}`)}`;
}

function haversineDistanceKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

export function orderStopsNearestNeighbor<T extends GeoPoint>(
  stops: T[],
  origin?: GeoPoint | null,
): T[] {
  if (stops.length <= 1) return [...stops];
  const remaining = [...stops];
  const ordered: T[] = [];
  let current: GeoPoint = origin ?? remaining[0];

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const dist = haversineDistanceKm(current, remaining[i]);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    const [next] = remaining.splice(bestIdx, 1);
    ordered.push(next);
    current = next;
  }
  return ordered;
}

/**
 * Builds a single Google Maps multi-stop driving route URL for up to 10 stops
 * (Google Maps web limit: 1 destination + up to 9 waypoints).
 */
export function buildMultiStopGoogleMapsUrl(
  stops: GeoPoint[],
  origin?: GeoPoint | null,
): string | null {
  const valid = stops.filter((s) => isValidCoordinatePair(s.lat, s.lng));
  if (valid.length === 0) return null;

  const ordered = orderStopsNearestNeighbor(valid, origin).slice(0, 10);
  const destination = ordered[ordered.length - 1];
  const waypoints = ordered.slice(0, -1);

  const params = new URLSearchParams({
    api: '1',
    travelmode: 'driving',
    destination: `${destination.lat},${destination.lng}`,
  });

  if (origin && isValidCoordinatePair(origin.lat, origin.lng)) {
    params.set('origin', `${origin.lat},${origin.lng}`);
  }
  if (waypoints.length > 0) {
    params.set(
      'waypoints',
      waypoints.map((w) => `${w.lat},${w.lng}`).join('|'),
    );
  }

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

