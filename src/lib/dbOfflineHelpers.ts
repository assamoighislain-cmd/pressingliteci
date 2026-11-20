import { getCached, setCached, updateCached } from '@/lib/readCache';
import type {
  ArticleCatalog,
  Client,
  Consommable,
  Depense,
  Depot,
  DepotArticle,
  DepotAvance,
  DepotWithArticles,
  DepotWithClient,
  TypeTraitement,
} from '@/types';

export const UUID_PK_TABLES = new Set<string>([
  'clients',
  'types_traitement',
  'articles',
  'depots',
  'depot_articles',
  'depot_avances',
  'depenses',
  'depense_categories',
  'article_variants',
  'fidelite_points',
  'fidelite_history',
  'bons_reduction',
  'consommables',
  'consommable_mouvements',
  'relances',
]);

export function bKey(base: string, boutiqueId: string | null): string {
  return boutiqueId ? `${base}_${boutiqueId}` : base;
}

export function getScopedCached<T>(base: string, boutiqueId: string | null): T | null {
  const scoped = getCached<T>(bKey(base, boutiqueId));
  if (scoped !== null) return scoped;
  const unscoped = getCached<T>(base);
  if (unscoped !== null) return unscoped;
  try {
    const storedBoutiqueId = localStorage.getItem('app-current-boutique');
    if (storedBoutiqueId && storedBoutiqueId !== boutiqueId) {
      return getCached<T>(`${base}_${storedBoutiqueId}`);
    }
  } catch {
    // Ignore
  }
  return null;
}

export function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const BILLING_POINT_STORAGE_KEY = 'pressinglite_billing_point_code';
const OFFLINE_QUEUE_STORAGE_KEY = 'offline_mutation_queue';

export function normalizeBillingPointCode(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
}

export function getBillingPointCode(): string {
  try {
    return normalizeBillingPointCode(localStorage.getItem(BILLING_POINT_STORAGE_KEY));
  } catch {
    return '';
  }
}

export function setBillingPointCode(raw: string): string {
  const clean = normalizeBillingPointCode(raw);
  try {
    if (clean) {
      localStorage.setItem(BILLING_POINT_STORAGE_KEY, clean);
    } else {
      localStorage.removeItem(BILLING_POINT_STORAGE_KEY);
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('pressinglite:billing-point-changed', { detail: clean }));
    }
  } catch {
    // Ignore storage errors
  }
  return clean;
}

/**
 * Formats a deposit number using nomenclature `D-001-YYYY` (or `<PREFIX>-D-001-YYYY`
 * when a billing-point prefix is configured on this terminal).
 * Every January 1st, `year` changes and `seq` starts back at `001`.
 */
export function formatDepotNumero(seq: number, year: number, pointCode = ''): string {
  const cleanPoint = normalizeBillingPointCode(pointCode);
  const safeSeq = Math.max(1, Math.floor(seq));
  const base = `D-${String(safeSeq).padStart(3, '0')}-${year}`;
  return cleanPoint ? `${cleanPoint}-${base}` : base;
}

const LEGACY_DEPOT_TRANSITION_MAX_YEAR = 2026;

export interface ParsedDepotNumero {
  seq: number;
  year: number;
  pointCode: string;
}

export function parseDepotNumeroInfo(numero: string | null | undefined): ParsedDepotNumero | null {
  if (!numero) return null;
  const trimmed = numero.trim().toUpperCase();
  const match = trimmed.match(/^(?:([A-Z0-9]{1,8})-)?D-?(\d+)-(\d{4})$/);
  if (!match) return null;
  const pointCode = match[1] ? normalizeBillingPointCode(match[1]) : '';
  const seq = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);
  if (!Number.isFinite(seq) || seq <= 0 || !Number.isFinite(year) || year < 2000 || year > 2100) {
    return null;
  }
  return { seq, year, pointCode };
}

/**
 * Parses legacy pre-annual deposit numbers (`D-0001`, `D-0145`, `D0145`) so the
 * transition year continues seamlessly from the last deposit number while
 * resetting to `001` on January 1st of subsequent years.
 */
export function parseLegacyDepotSeq(numero: string | null | undefined): number {
  if (!numero) return 0;
  const trimmed = numero.trim().toUpperCase();
  const match = trimmed.match(/^D-?(\d+)$/);
  if (!match) return 0;
  const seq = parseInt(match[1], 10);
  return Number.isFinite(seq) && seq > 0 ? seq : 0;
}

/**
 * Formats a client code using nomenclature `C-0001` (or `<PREFIX>-C-0001` when a
 * billing-point prefix is configured on this terminal to prevent offline duplicates
 * across multiple billing points or boutiques).
 */
export function formatClientCode(seq: number, pointCode = ''): string {
  const cleanPoint = normalizeBillingPointCode(pointCode);
  const safeSeq = Math.max(1, Math.floor(seq));
  const base = `C-${String(safeSeq).padStart(4, '0')}`;
  return cleanPoint ? `${cleanPoint}-${base}` : base;
}

export interface ParsedClientCode {
  seq: number;
  pointCode: string;
}

export function parseClientCodeInfo(code: string | null | undefined): ParsedClientCode | null {
  if (!code) return null;
  const trimmed = code.trim().toUpperCase();
  const match = trimmed.match(/^(?:([A-Z0-9]{1,8})-)?C-(\d+)$/);
  if (!match) return null;
  const pointCode = match[1] ? normalizeBillingPointCode(match[1]) : '';
  const seq = parseInt(match[2], 10);
  if (!Number.isFinite(seq) || seq <= 0) return null;
  return { seq, pointCode };
}

function depotSeqKey(boutiqueId: string | null, year: number, pointCode: string): string {
  const cleanPoint = normalizeBillingPointCode(pointCode);
  return `depot_v2_${boutiqueId ?? 'global'}_${year}_${cleanPoint || 'MAIN'}`;
}

function depotLegacySeqKey(boutiqueId: string | null): string {
  return `depot_v2_${boutiqueId ?? 'global'}_${LEGACY_DEPOT_TRANSITION_MAX_YEAR}_LEGACY`;
}

function clientSeqKey(pointCode: string): string {
  const cleanPoint = normalizeBillingPointCode(pointCode);
  return `client_v2_tenant_${cleanPoint || 'MAIN'}`;
}

const CLIENT_BASE_SEQ_KEY = 'client_v2_tenant_BASE';

function parsePrefixedNumber(val: string | null | undefined, prefix: string): number {
  if (!val || !val.startsWith(prefix)) return 0;
  const numPart = val.slice(prefix.length).trim();
  if (!/^\d+$/.test(numPart)) return 0;
  return parseInt(numPart, 10) || 0;
}

function getStoredMaxSeq(counterKey: string): number {
  try {
    return parseInt(localStorage.getItem(`offline_seq_${counterKey}`) || '0', 10) || 0;
  } catch {
    return 0;
  }
}

function setStoredMaxSeq(counterKey: string, value: number): void {
  try {
    const cur = getStoredMaxSeq(counterKey);
    if (value > cur) {
      localStorage.setItem(`offline_seq_${counterKey}`, String(value));
    }
  } catch {
    // Ignore
  }
}

function setExactStoredSeq(counterKey: string, value: number): void {
  try {
    localStorage.setItem(`offline_seq_${counterKey}`, String(Math.max(0, Math.floor(value))));
  } catch {
    // Ignore
  }
}

function depotStartSeqStorageKey(boutiqueId: string | null, year: number, pointCode: string): string {
  const cleanPoint = normalizeBillingPointCode(pointCode);
  return `pressinglite_depot_start_seq_${boutiqueId ?? 'global'}_${year}_${cleanPoint || 'MAIN'}`;
}

function depotCustomProgStorageKey(boutiqueId: string | null, year: number, pointCode: string): string {
  const cleanPoint = normalizeBillingPointCode(pointCode);
  return `pressinglite_depot_custom_prog_${boutiqueId ?? 'global'}_${year}_${cleanPoint || 'MAIN'}`;
}

function companyDepotStartSeqStorageKey(year: number): string {
  return `pressinglite_company_depot_start_seq_${year}`;
}

export function getCompanyDepotStartSeq(year: number): number | null {
  try {
    const raw = localStorage.getItem(companyDepotStartSeqStorageKey(year));
    if (!raw) return null;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : null;
  } catch {
    return null;
  }
}

export function setCompanyDepotStartSeq(
  startSeq: number | null,
  year: number = new Date().getFullYear(),
): number | null {
  const key = companyDepotStartSeqStorageKey(year);
  try {
    if (startSeq !== null && Number.isFinite(startSeq) && startSeq >= 1) {
      const normalized = Math.max(1, Math.floor(startSeq));
      localStorage.setItem(key, String(normalized));
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('pressinglite:depot-start-seq-changed', { detail: normalized }));
      }
      return normalized;
    } else {
      localStorage.removeItem(key);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('pressinglite:depot-start-seq-changed', { detail: null }));
      }
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * Hydrates the company-wide enforced starting counter from `entreprise` row into localStorage
 * so every device and offline session honors it immediately.
 */
export function syncCompanyDepotStartSeqFromEntreprise(
  startSeq: number | null | undefined,
  startYear: number | null | undefined,
): void {
  const currentYear = new Date().getFullYear();
  if (startSeq != null && Number.isFinite(Number(startSeq)) && Number(startSeq) >= 1) {
    const targetYear =
      startYear != null && Number.isFinite(Number(startYear)) && Number(startYear) >= 2000
        ? Math.floor(Number(startYear))
        : currentYear;
    const existing = getCompanyDepotStartSeq(targetYear);
    const normalized = Math.max(1, Math.floor(Number(startSeq)));
    if (existing !== normalized) {
      setCompanyDepotStartSeq(normalized, targetYear);
    }
  } else if (startSeq === null) {
    // Only clear if server explicitly returned null (not undefined when column doesn't exist yet)
    if (getCompanyDepotStartSeq(currentYear) !== null) {
      setCompanyDepotStartSeq(null, currentYear);
    }
  }
}

export function getDepotStartSeq(
  boutiqueId: string | null,
  year: number,
  pointCode?: string,
): number | null {
  const cleanPoint = pointCode !== undefined ? normalizeBillingPointCode(pointCode) : getBillingPointCode();
  try {
    const raw = localStorage.getItem(depotStartSeqStorageKey(boutiqueId, year, cleanPoint));
    if (raw) {
      const parsed = parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed >= 1) return parsed;
    }
  } catch {
    // Ignore localStorage error
  }
  return getCompanyDepotStartSeq(year);
}

export function setDepotStartSeq(
  boutiqueId: string | null,
  year: number,
  pointCode: string,
  startSeq: number | null,
): number | null {
  const cleanPoint = normalizeBillingPointCode(pointCode);
  const startKey = depotStartSeqStorageKey(boutiqueId, year, cleanPoint);
  const progKey = depotCustomProgStorageKey(boutiqueId, year, cleanPoint);
  try {
    if (startSeq !== null && Number.isFinite(startSeq) && startSeq >= 1) {
      const normalized = Math.max(1, Math.floor(startSeq));
      localStorage.setItem(startKey, String(normalized));
      localStorage.setItem(progKey, String(normalized - 1));
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('pressinglite:depot-start-seq-changed', { detail: normalized }));
      }
      return normalized;
    } else {
      localStorage.removeItem(startKey);
      localStorage.removeItem(progKey);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('pressinglite:depot-start-seq-changed', { detail: null }));
      }
      return null;
    }
  } catch {
    return null;
  }
}

function getDepotCustomProgSeq(boutiqueId: string | null, year: number, pointCode: string): number {
  try {
    const raw = localStorage.getItem(depotCustomProgStorageKey(boutiqueId, year, pointCode));
    if (!raw) return 0;
    return parseInt(raw, 10) || 0;
  } catch {
    return 0;
  }
}

function setDepotCustomProgSeq(boutiqueId: string | null, year: number, pointCode: string, val: number): void {
  try {
    localStorage.setItem(
      depotCustomProgStorageKey(boutiqueId, year, pointCode),
      String(Math.max(0, Math.floor(val))),
    );
  } catch {
    // Ignore
  }
}

function collectPendingQueueDepotSeqs(
  boutiqueId: string | null,
  year: number,
  pointCode: string,
): { max: number; usedSeqs: Set<number> } {
  const cleanPoint = normalizeBillingPointCode(pointCode);
  const usedSeqs = new Set<number>();
  let max = 0;
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_STORAGE_KEY);
    if (!raw) return { max: 0, usedSeqs };
    const items = JSON.parse(raw) as Array<{
      table?: string;
      operation?: string;
      data?: Record<string, unknown>;
    }>;
    if (!Array.isArray(items)) return { max: 0, usedSeqs };
    for (const item of items) {
      if (item.table !== 'depots' || item.operation !== 'insert' || !item.data) continue;
      const itemBoutique = (item.data.boutique_id as string | null | undefined) ?? null;
      if (boutiqueId && itemBoutique && itemBoutique !== boutiqueId) continue;
      const rawNum = String(item.data.numero ?? '');
      const parsed = parseDepotNumeroInfo(rawNum);
      if (parsed && parsed.year === year && parsed.pointCode === cleanPoint) {
        usedSeqs.add(parsed.seq);
        if (parsed.seq > max) max = parsed.seq;
      } else if (year <= LEGACY_DEPOT_TRANSITION_MAX_YEAR) {
        const leg = parseLegacyDepotSeq(rawNum);
        if (leg > max) max = leg;
      }
    }
    return { max, usedSeqs };
  } catch {
    return { max: 0, usedSeqs };
  }
}

export function getPendingOfflineQueueDepotMaxSeq(
  boutiqueId: string | null,
  year: number,
  pointCode: string,
): number {
  return collectPendingQueueDepotSeqs(boutiqueId, year, pointCode).max;
}

export function getPendingOfflineQueueClientMaxSeq(pointCode: string): number {
  const cleanPoint = normalizeBillingPointCode(pointCode);
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_STORAGE_KEY);
    if (!raw) return 0;
    const items = JSON.parse(raw) as Array<{
      table?: string;
      operation?: string;
      data?: Record<string, unknown>;
    }>;
    if (!Array.isArray(items)) return 0;
    let max = 0;
    for (const item of items) {
      if (item.table !== 'clients' || item.operation !== 'insert' || !item.data) continue;
      const parsed = parseClientCodeInfo(String(item.data.code ?? ''));
      if (!parsed) continue;
      if ((parsed.pointCode === cleanPoint || parsed.pointCode === '') && parsed.seq > max) {
        max = parsed.seq;
      }
    }
    return max;
  } catch {
    return 0;
  }
}

export function observeDepotNumeros(
  depots: Array<{ numero?: string | null }>,
  boutiqueId: string | null,
): void {
  const maxByBucket = new Map<string, { year: number; pointCode: string; max: number }>();
  let maxLegacy = 0;
  for (const d of depots) {
    const parsed = parseDepotNumeroInfo(d.numero);
    if (parsed) {
      const bucketKey = `${parsed.year}_${parsed.pointCode}`;
      const existing = maxByBucket.get(bucketKey);
      if (!existing || parsed.seq > existing.max) {
        maxByBucket.set(bucketKey, {
          year: parsed.year,
          pointCode: parsed.pointCode,
          max: parsed.seq,
        });
      }
    } else {
      const leg = parseLegacyDepotSeq(d.numero);
      if (leg > maxLegacy) maxLegacy = leg;
    }
  }
  for (const entry of maxByBucket.values()) {
    setStoredMaxSeq(depotSeqKey(boutiqueId, entry.year, entry.pointCode), entry.max);
  }
  if (maxLegacy > 0) {
    setStoredMaxSeq(depotLegacySeqKey(boutiqueId), maxLegacy);
  }
}

export function observeClientCodes(
  clients: Array<{ code?: string | null }>,
  _boutiqueId?: string | null,
): void {
  const maxByPoint = new Map<string, number>();
  let maxBase = 0;
  for (const c of clients) {
    const parsed = parseClientCodeInfo(c.code);
    if (!parsed) continue;
    const prev = maxByPoint.get(parsed.pointCode) ?? 0;
    if (parsed.seq > prev) {
      maxByPoint.set(parsed.pointCode, parsed.seq);
    }
    if (parsed.pointCode === '' && parsed.seq > maxBase) {
      maxBase = parsed.seq;
    }
  }
  for (const [pointCode, max] of maxByPoint.entries()) {
    setStoredMaxSeq(clientSeqKey(pointCode), max);
  }
  if (maxBase > 0) {
    setStoredMaxSeq(CLIENT_BASE_SEQ_KEY, maxBase);
  }
}

export function observeArticleCodes(
  articles: Array<{ code?: string | null }>,
  boutiqueId: string | null,
): void {
  const key = `article_${boutiqueId ?? 'global'}`;
  let max = 0;
  for (const a of articles) {
    const n = parsePrefixedNumber(a.code, 'A-');
    if (n > max) max = n;
  }
  if (max > 0) setStoredMaxSeq(key, max);
}

export function observeTraitementCodes(
  traitements: Array<{ code?: string | null }>,
  boutiqueId: string | null,
): void {
  const key = `traitement_${boutiqueId ?? 'global'}`;
  let max = 0;
  for (const t of traitements) {
    const n = parsePrefixedNumber(t.code, 'T-');
    if (n > max) max = n;
  }
  if (max > 0) setStoredMaxSeq(key, max);
}

function resolveOnlineDepotNumeroInternal(
  dbRows: Array<{ numero?: string | null }>,
  boutiqueId: string | null,
  targetYear: number | undefined,
  pointCodeOverride: string | undefined,
  commit: boolean,
): string {
  const year = targetYear ?? new Date().getFullYear();
  const pointCode =
    pointCodeOverride !== undefined ? normalizeBillingPointCode(pointCodeOverride) : getBillingPointCode();
  const customStart = getDepotStartSeq(boutiqueId, year, pointCode);
  const { max: queuedMax, usedSeqs } = collectPendingQueueDepotSeqs(boutiqueId, year, pointCode);

  let dbMax = 0;
  let legacyMax = 0;
  for (const row of dbRows) {
    const parsed = parseDepotNumeroInfo(row.numero);
    if (parsed && parsed.year === year && parsed.pointCode === pointCode) {
      usedSeqs.add(parsed.seq);
      if (parsed.seq > dbMax) dbMax = parsed.seq;
    } else if (year <= LEGACY_DEPOT_TRANSITION_MAX_YEAR) {
      const leg = parseLegacyDepotSeq(row.numero);
      if (leg > legacyMax) legacyMax = leg;
    }
  }
  if (legacyMax > 0) {
    setStoredMaxSeq(depotLegacySeqKey(boutiqueId), legacyMax);
  }

  let next: number;
  if (customStart !== null) {
    const prog = getDepotCustomProgSeq(boutiqueId, year, pointCode);
    const syncedFloor = dbMax >= customStart ? dbMax + 1 : customStart;
    const queuedFloor = queuedMax >= customStart ? queuedMax + 1 : customStart;
    next = Math.max(customStart, syncedFloor, queuedFloor, prog + 1);
    while (usedSeqs.has(next)) {
      next++;
    }
    if (commit) {
      setDepotCustomProgSeq(boutiqueId, year, pointCode, next);
      setExactStoredSeq(depotSeqKey(boutiqueId, year, pointCode), Math.max(dbMax, next));
    }
  } else {
    next = Math.max(dbMax, legacyMax, queuedMax) + 1;
    if (commit) {
      setExactStoredSeq(depotSeqKey(boutiqueId, year, pointCode), next);
    }
  }

  return formatDepotNumero(next, year, pointCode);
}

export function previewOnlineDepotNumero(
  dbRows: Array<{ numero?: string | null }>,
  boutiqueId: string | null,
  targetYear?: number,
  pointCodeOverride?: string,
): string {
  return resolveOnlineDepotNumeroInternal(dbRows, boutiqueId, targetYear, pointCodeOverride, false);
}

/**
 * Computes the next online deposit number (`D-001-YYYY` or `<PREFIX>-D-001-YYYY`),
 * honoring any custom starting number positioned for this year/point, seamlessly
 * continuing from legacy `D-XXXX` numbers in <=2026, and resetting to `001` every Jan 1st.
 */
export function computeNextOnlineDepotNumero(
  dbRows: Array<{ numero?: string | null }>,
  boutiqueId: string | null,
  targetYear?: number,
  pointCodeOverride?: string,
): string {
  return resolveOnlineDepotNumeroInternal(dbRows, boutiqueId, targetYear, pointCodeOverride, true);
}

function resolveOfflineDepotNumeroInternal(
  boutiqueId: string | null,
  targetYear: number | undefined,
  pointCodeOverride: string | undefined,
  commit: boolean,
): string {
  const year = targetYear ?? new Date().getFullYear();
  const pointCode =
    pointCodeOverride !== undefined ? normalizeBillingPointCode(pointCodeOverride) : getBillingPointCode();
  const key = depotSeqKey(boutiqueId, year, pointCode);

  const cachedAll = getScopedCached<DepotWithArticles[]>('all_depots', boutiqueId) ?? [];
  const cachedRecent = getScopedCached<DepotWithClient[]>('recent_depots', boutiqueId) ?? [];
  const cachedRetrait = getScopedCached<DepotWithArticles[]>('depots_retrait', boutiqueId) ?? [];
  const cachedPlanning = getScopedCached<DepotWithClient[]>('depots_planning', boutiqueId) ?? [];
  observeDepotNumeros(cachedAll, boutiqueId);
  observeDepotNumeros(cachedRecent, boutiqueId);
  observeDepotNumeros(cachedRetrait, boutiqueId);
  observeDepotNumeros(cachedPlanning, boutiqueId);

  const { max: queuedMax, usedSeqs } = collectPendingQueueDepotSeqs(boutiqueId, year, pointCode);
  for (const list of [cachedAll, cachedRecent, cachedRetrait, cachedPlanning]) {
    for (const d of list) {
      const parsed = parseDepotNumeroInfo(d.numero);
      if (parsed && parsed.year === year && parsed.pointCode === pointCode) {
        usedSeqs.add(parsed.seq);
      }
    }
  }

  const customStart = getDepotStartSeq(boutiqueId, year, pointCode);
  let next: number;
  if (customStart !== null) {
    const prog = getDepotCustomProgSeq(boutiqueId, year, pointCode);
    const storedMax = getStoredMaxSeq(key);
    const storedFloor = storedMax >= customStart ? storedMax + 1 : customStart;
    const queuedFloor = queuedMax >= customStart ? queuedMax + 1 : customStart;
    next = Math.max(customStart, storedFloor, queuedFloor, prog + 1);
    while (usedSeqs.has(next)) {
      next++;
    }
    if (commit) {
      setDepotCustomProgSeq(boutiqueId, year, pointCode, next);
      setStoredMaxSeq(key, next);
    }
  } else {
    const legacyMax =
      year <= LEGACY_DEPOT_TRANSITION_MAX_YEAR ? getStoredMaxSeq(depotLegacySeqKey(boutiqueId)) : 0;
    const currentMax = Math.max(getStoredMaxSeq(key), legacyMax, queuedMax);
    next = currentMax + 1;
    if (commit) {
      setStoredMaxSeq(key, next);
    }
  }

  return formatDepotNumero(next, year, pointCode);
}

export function previewOfflineDepotNumero(
  boutiqueId: string | null,
  targetYear?: number,
  pointCodeOverride?: string,
): string {
  return resolveOfflineDepotNumeroInternal(boutiqueId, targetYear, pointCodeOverride, false);
}

/**
 * Generates a collision-free offline deposit number (`D-001-YYYY` or `<PREFIX>-D-001-YYYY`),
 * honoring custom starting numbers, continuing from legacy `D-XXXX` in <=2026,
 * and resetting to `001` every January 1st.
 */
export function generateOfflineDepotNumero(
  boutiqueId: string | null,
  targetYear?: number,
  pointCodeOverride?: string,
): string {
  return resolveOfflineDepotNumeroInternal(boutiqueId, targetYear, pointCodeOverride, true);
}

/**
 * Computes the next online client code (`C-0001` or `<POINT>-C-0001`),
 * continuing from the highest existing client code and priming offline counters.
 */
export function computeNextOnlineClientCode(
  dbRows: Array<{ code?: string | null }>,
  pointCodeOverride?: string,
): string {
  const pointCode =
    pointCodeOverride !== undefined ? normalizeBillingPointCode(pointCodeOverride) : getBillingPointCode();
  let dbPointMax = 0;
  let dbBaseMax = 0;
  for (const row of dbRows) {
    const parsed = parseClientCodeInfo(row.code);
    if (!parsed) continue;
    if (parsed.pointCode === pointCode && parsed.seq > dbPointMax) {
      dbPointMax = parsed.seq;
    }
    if (parsed.pointCode === '' && parsed.seq > dbBaseMax) {
      dbBaseMax = parsed.seq;
    }
  }
  if (dbBaseMax > 0) {
    setStoredMaxSeq(CLIENT_BASE_SEQ_KEY, dbBaseMax);
  }
  const queuedMax = getPendingOfflineQueueClientMaxSeq(pointCode);
  const next = Math.max(dbPointMax, dbBaseMax, queuedMax) + 1;
  setExactStoredSeq(clientSeqKey(pointCode), next);
  if (pointCode === '') {
    setExactStoredSeq(CLIENT_BASE_SEQ_KEY, next);
  }
  return formatClientCode(next, pointCode);
}

/**
 * Generates a collision-free offline client code (`C-0001` or `<POINT>-C-0001`)
 * across multiple billing points and boutiques.
 */
export function generateOfflineClientCode(
  boutiqueId: string | null,
  pointCodeOverride?: string,
): string {
  const pointCode =
    pointCodeOverride !== undefined ? normalizeBillingPointCode(pointCodeOverride) : getBillingPointCode();
  const key = clientSeqKey(pointCode);

  const cachedScoped = getScopedCached<Client[]>('all_clients', boutiqueId) ?? [];
  const cachedGlobal = getCached<Client[]>('all_clients') ?? [];
  observeClientCodes(cachedScoped, boutiqueId);
  observeClientCodes(cachedGlobal, null);

  const baseMax = getStoredMaxSeq(CLIENT_BASE_SEQ_KEY);
  const queuedMax = getPendingOfflineQueueClientMaxSeq(pointCode);
  const currentMax = Math.max(getStoredMaxSeq(key), baseMax, queuedMax);
  const next = currentMax + 1;
  setStoredMaxSeq(key, next);
  if (pointCode === '') {
    setStoredMaxSeq(CLIENT_BASE_SEQ_KEY, next);
  }
  return formatClientCode(next, pointCode);
}

export function generateOfflineRpcCode(fnName: string, boutiqueId: string | null): string | null {
  if (fnName === 'generate_client_code') {
    return generateOfflineClientCode(boutiqueId);
  }
  if (fnName === 'generate_article_code') {
    const cached = getScopedCached<ArticleCatalog[]>('articles', boutiqueId) ?? [];
    observeArticleCodes(cached, boutiqueId);
    const key = `article_${boutiqueId ?? 'global'}`;
    const next = getStoredMaxSeq(key) + 1;
    setStoredMaxSeq(key, next);
    return `A-${String(next).padStart(4, '0')}`;
  }
  if (fnName === 'generate_traitement_code') {
    const cached = getScopedCached<TypeTraitement[]>('types_traitement', boutiqueId) ?? [];
    observeTraitementCodes(cached, boutiqueId);
    const key = `traitement_${boutiqueId ?? 'global'}`;
    const next = getStoredMaxSeq(key) + 1;
    setStoredMaxSeq(key, next);
    return `T-${String(next).padStart(4, '0')}`;
  }
  return null;
}

export function prepareOfflineInsertRows(
  table: string,
  rows: Record<string, unknown>[],
): { dbRows: Record<string, unknown>[]; optimisticRows: Record<string, unknown>[] } {
  const now = new Date().toISOString();
  const dbRows: Record<string, unknown>[] = [];
  const optimisticRows: Record<string, unknown>[] = [];

  for (const r of rows) {
    const dbRow: Record<string, unknown> = { ...r };
    if (UUID_PK_TABLES.has(table) && !dbRow.id) {
      dbRow.id = generateUuid();
    }
    const optRow: Record<string, unknown> = {
      ...dbRow,
      id: dbRow.id ?? Date.now(),
      created_at: dbRow.created_at ?? now,
    };
    if (table === 'clients') {
      optRow.portal_code = optRow.portal_code ?? Math.random().toString(36).slice(2, 8).toUpperCase();
    }
    if (table === 'depot_avances') {
      optRow.date_paiement = optRow.date_paiement ?? now;
    }
    if (table === 'bons_reduction') {
      optRow.actif = optRow.actif ?? true;
      optRow.usage_count = optRow.usage_count ?? 0;
    }
    if (table === 'relances') {
      optRow.date_relance = optRow.date_relance ?? now;
    }
    dbRows.push(dbRow);
    optimisticRows.push(optRow);
  }

  return { dbRows, optimisticRows };
}

export function buildMutationLabel(
  table: string,
  op: 'insert' | 'update' | 'upsert' | 'delete',
  data: Record<string, unknown>,
): string {
  if (table === 'clients') {
    if (op === 'insert') return `Nouveau client : ${String(data.nom ?? '')}`;
    if (op === 'update') return `Modification client : ${String(data.nom ?? '')}`;
    if (op === 'delete') return 'Suppression client';
  }
  if (table === 'depots') {
    if (op === 'insert') return `Nouveau dépôt ${String(data.numero ?? '')}`.trim();
    if (op === 'update') {
      if (data.statut === 'RETIRE') return 'Retrait de dépôt';
      return 'Mise à jour dépôt';
    }
    if (op === 'delete') return 'Suppression dépôt';
  }
  if (table === 'depot_articles') {
    if (op === 'insert') return `Article dépôt : ${String(data.designation ?? '')}`;
    if (op === 'update') return 'Mise à jour article dépôt';
  }
  if (table === 'depot_avances') {
    return `Règlement / Avance (${Number(data.montant ?? 0).toLocaleString('fr-FR')} FCFA)`;
  }
  if (table === 'depenses') {
    if (op === 'insert') return `Nouvelle dépense : ${String(data.libelle ?? '')}`;
    if (op === 'update') return `Modification dépense : ${String(data.libelle ?? '')}`;
    if (op === 'delete') return 'Suppression dépense';
  }
  if (table === 'articles') {
    if (op === 'insert') return `Nouvel article : ${String(data.designation ?? '')}`;
    if (op === 'update') return `Modification article : ${String(data.designation ?? '')}`;
    if (op === 'delete') return 'Suppression article';
  }
  if (table === 'consommables' || table === 'consommable_mouvements') {
    return 'Mouvement de stock consommable';
  }
  const verb = op === 'insert' ? 'Ajout' : op === 'update' ? 'Modification' : op === 'delete' ? 'Suppression' : 'Mise à jour';
  return `${verb} (${table})`;
}

// ─── Optimistic local read-cache updaters ──────────────────

export function optimisticUpsertClient(client: Client, boutiqueId: string | null): void {
  const key = bKey('all_clients', boutiqueId);
  updateCached<Client[]>(key, (list) => {
    const base = list ?? getCached<Client[]>('all_clients') ?? [];
    const idx = base.findIndex((c) => c.id === client.id);
    const next = idx >= 0 ? base.map((c, i) => (i === idx ? { ...c, ...client } : c)) : [...base, client];
    return next.sort((a, b) => (a.nom ?? '').localeCompare(b.nom ?? ''));
  });
}

export function optimisticPatchClient(
  id: string,
  values: Partial<Client>,
  boutiqueId: string | null,
): void {
  const key = bKey('all_clients', boutiqueId);
  updateCached<Client[]>(key, (list) => {
    const base = list ?? getCached<Client[]>('all_clients');
    if (!base) return null;
    return base.map((c) => (c.id === id ? { ...c, ...values } : c));
  });
}

export function optimisticRemoveClient(id: string, boutiqueId: string | null): void {
  const key = bKey('all_clients', boutiqueId);
  updateCached<Client[]>(key, (list) => {
    const base = list ?? getCached<Client[]>('all_clients');
    return base ? base.filter((c) => c.id !== id) : null;
  });
}

export function optimisticUpsertArticle(article: ArticleCatalog, boutiqueId: string | null): void {
  const key = bKey('articles', boutiqueId);
  updateCached<ArticleCatalog[]>(key, (list) => {
    const base = list ?? getCached<ArticleCatalog[]>('articles') ?? [];
    const idx = base.findIndex((a) => a.id === article.id);
    const next = idx >= 0 ? base.map((a, i) => (i === idx ? { ...a, ...article } : a)) : [...base, article];
    return next.sort((a, b) => (a.designation ?? '').localeCompare(b.designation ?? ''));
  });
}

export function optimisticInsertDepot(depot: Depot, boutiqueId: string | null): void {
  const clients = getScopedCached<Client[]>('all_clients', boutiqueId) ?? [];
  const matchedClient = clients.find((c) => c.id === depot.client_id);
  const clientRel = matchedClient
    ? {
        nom: matchedClient.nom,
        telephone: matchedClient.telephone ?? '',
        portal_code: matchedClient.portal_code,
      }
    : { nom: 'Client', telephone: '' };

  const withArticles: DepotWithArticles = {
    ...depot,
    articles: [],
    client: clientRel,
    clients: clientRel,
  };
  const withClient: DepotWithClient = {
    ...depot,
    clients: clientRel,
  };

  updateCached<DepotWithArticles[]>(bKey('all_depots', boutiqueId), (cur) => [
    withArticles,
    ...(cur ?? []),
  ]);
  if (depot.statut === 'EN_COURS') {
    updateCached<DepotWithArticles[]>(bKey('depots_retrait', boutiqueId), (cur) => [
      withArticles,
      ...(cur ?? []),
    ]);
  }
  updateCached<DepotWithClient[]>(bKey('recent_depots', boutiqueId), (cur) =>
    [withClient, ...(cur ?? [])].slice(0, 8),
  );
  updateCached<DepotWithClient[]>(bKey('depots_planning', boutiqueId), (cur) => [
    withClient,
    ...(cur ?? []),
  ]);
}

export function optimisticAttachDepotArticles(
  rows: Record<string, unknown>[],
  boutiqueId: string | null,
): void {
  if (!rows.length) return;
  const depotId = String(rows[0].depot_id ?? '');
  if (!depotId) return;

  const now = new Date().toISOString();
  const normalized: DepotArticle[] = rows.map((a) => ({
    id: String(a.id ?? generateUuid()),
    depot_id: depotId,
    article_id: (a.article_id as string | null) ?? null,
    designation: String(a.designation ?? ''),
    prix_unitaire: Number(a.prix_unitaire ?? 0),
    prix_traitement: Number(a.prix_traitement ?? 0),
    quantite: Number(a.quantite ?? 1),
    nb_pieces: Number(a.nb_pieces ?? 1),
    couleur: String(a.couleur ?? ''),
    marque: String(a.marque ?? ''),
    signe_particulier: String(a.signe_particulier ?? ''),
    griffe: String(a.griffe ?? ''),
    emplacement: String(a.emplacement ?? ''),
    checked_out: Boolean(a.checked_out ?? false),
    date_retrait: (a.date_retrait as string | null) ?? null,
    photo_url: (a.photo_url as string | null) ?? null,
    prix_total: Number(a.prix_total ?? 0),
    created_at: String(a.created_at ?? now),
  }));

  const attach = (list: DepotWithArticles[] | null): DepotWithArticles[] | null => {
    if (!list) return null;
    return list.map((d) =>
      d.id === depotId ? { ...d, articles: [...(d.articles ?? []), ...normalized] } : d,
    );
  };

  updateCached<DepotWithArticles[]>(bKey('all_depots', boutiqueId), attach);
  updateCached<DepotWithArticles[]>(bKey('depots_retrait', boutiqueId), attach);
}

export function optimisticPatchDepot(
  id: string,
  values: Record<string, unknown>,
  boutiqueId: string | null,
): void {
  updateCached<DepotWithArticles[]>(bKey('all_depots', boutiqueId), (list) =>
    list ? list.map((d) => (d.id === id ? ({ ...d, ...values } as DepotWithArticles) : d)) : null,
  );
  updateCached<DepotWithArticles[]>(bKey('depots_retrait', boutiqueId), (list) => {
    if (!list) return null;
    if (values.statut && values.statut !== 'EN_COURS') {
      return list.filter((d) => d.id !== id);
    }
    return list.map((d) => (d.id === id ? ({ ...d, ...values } as DepotWithArticles) : d));
  });
  updateCached<DepotWithClient[]>(bKey('recent_depots', boutiqueId), (list) =>
    list ? list.map((d) => (d.id === id ? ({ ...d, ...values } as DepotWithClient) : d)) : null,
  );
  updateCached<DepotWithClient[]>(bKey('depots_planning', boutiqueId), (list) =>
    list ? list.map((d) => (d.id === id ? ({ ...d, ...values } as DepotWithClient) : d)) : null,
  );
}

export function optimisticRemoveDepot(id: string, boutiqueId: string | null): void {
  updateCached<DepotWithArticles[]>(bKey('all_depots', boutiqueId), (l) =>
    l ? l.filter((d) => d.id !== id) : null,
  );
  updateCached<DepotWithArticles[]>(bKey('depots_retrait', boutiqueId), (l) =>
    l ? l.filter((d) => d.id !== id) : null,
  );
  updateCached<DepotWithClient[]>(bKey('recent_depots', boutiqueId), (l) =>
    l ? l.filter((d) => d.id !== id) : null,
  );
  updateCached<DepotWithClient[]>(bKey('depots_planning', boutiqueId), (l) =>
    l ? l.filter((d) => d.id !== id) : null,
  );
}

export function optimisticPatchDepotArticle(
  articleRowId: string,
  values: Record<string, unknown>,
  boutiqueId: string | null,
): void {
  const patchList = (list: DepotWithArticles[] | null): DepotWithArticles[] | null => {
    if (!list) return null;
    return list.map((d) => ({
      ...d,
      articles: (d.articles ?? []).map((a) =>
        a.id === articleRowId ? ({ ...a, ...values } as DepotArticle) : a,
      ),
    }));
  };
  updateCached<DepotWithArticles[]>(bKey('all_depots', boutiqueId), patchList);
  updateCached<DepotWithArticles[]>(bKey('depots_retrait', boutiqueId), patchList);
}

export function optimisticInsertAvance(avance: DepotAvance, boutiqueId: string | null): void {
  updateCached<DepotAvance[]>(bKey('all_avances', boutiqueId), (list) => [
    ...(list ?? []),
    avance,
  ]);
}

export function optimisticInsertDepense(depense: Depense, boutiqueId: string | null): void {
  updateCached<Depense[]>(bKey('depenses', boutiqueId), (list) => [depense, ...(list ?? [])]);
}

export function optimisticPatchDepense(
  id: string,
  values: Partial<Depense>,
  boutiqueId: string | null,
): void {
  updateCached<Depense[]>(bKey('depenses', boutiqueId), (list) =>
    list ? list.map((d) => (d.id === id ? { ...d, ...values } : d)) : null,
  );
}

export function optimisticRemoveDepense(id: string, boutiqueId: string | null): void {
  updateCached<Depense[]>(bKey('depenses', boutiqueId), (list) =>
    list ? list.filter((d) => d.id !== id) : null,
  );
}

export function optimisticAdjustConsommable(
  consommableId: string,
  delta: number,
  boutiqueId: string | null,
): void {
  const key = bKey('consommables', boutiqueId);
  const current = getScopedCached<Consommable[]>('consommables', boutiqueId);
  if (!current) return;
  setCached(
    key,
    current.map((c) =>
      c.id === consommableId ? { ...c, quantite: Math.max(0, Number(c.quantite) + delta) } : c,
    ),
  );
}
