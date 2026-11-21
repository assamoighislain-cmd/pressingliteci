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
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
}
