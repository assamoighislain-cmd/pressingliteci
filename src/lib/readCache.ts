// Offline & Real-Time Read Cache (3-Tier: Memory + Protected localStorage + IndexedDB)
// Serves cached data instantaneously (0ms) while revalidating silently in the background,
// protects core tables (clients, articles, entreprise, etc.) from localStorage quota eviction,
// supports automatic boutique-scope fallback on cold offline boot, and never wipes cache on errors.

import { idbClear, idbGet, idbGetAll, idbPut, READ_CACHE_STORE } from '@/lib/offlineStorage';

const CACHE_PREFIX = 'offline_cache_';
const CACHE_TIMESTAMP_KEY = 'offline_cache_timestamps';
const LAST_CACHE_REFRESH_KEY = 'offline_last_cache_refresh';
const BOUTIQUE_STORAGE_KEY = 'app-current-boutique';

// Minimum age before a cached read triggers a silent background network check
const SWR_REVALIDATE_AFTER_MS = 2500;
// Large lists (e.g. 4,000+ clients) revalidate less aggressively on idle reads;
// any local mutation or Realtime event still invalidates immediately via lastInvalidatedAt.
const LARGE_LIST_SWR_REVALIDATE_AFTER_MS = 60_000;

// Non-pinned entries larger than this stay in Memory + IndexedDB so they never evict core lists from localStorage
const MAX_LOCALSTORAGE_UNPINNED_CHARS = 350_000;
// Even pinned lists larger than this (e.g. 4,000+ clients ≈ 1 MB) stay in Memory + IndexedDB
// to avoid synchronous main-thread JSON/localStorage stalls and QuotaExceededError eviction loops.
const MAX_LOCALSTORAGE_PINNED_CHARS = 550_000;

// Core tables that must stay pinned in localStorage AND IndexedDB
const PINNED_CACHE_BASES = [
  'all_clients',
  'articles',
  'types_traitement',
  'modes_reglement',
  'entreprise',
  'all_variants',
  'boutiques',
  'bons_reduction',
];

const UUID_SUFFIX_RE = /_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CacheEntry<T> {
  key: string;
  data: T;
  timestamp: number;
}

type CacheDiffListener = (key: string) => void;
const cacheDiffListeners = new Set<CacheDiffListener>();
const inFlightRevalidations = new Map<string, Promise<void>>();
const memoryCache = new Map<string, CacheEntry<unknown>>();
let hydrationPromise: Promise<void> | null = null;

// Timestamp of the latest local write or incoming real-time server event.
// Any cache entry older than this timestamp will bypass stale return and fetch fresh immediately.
let lastInvalidatedAt = 0;

function isPinnedKey(key: string): boolean {
  return PINNED_CACHE_BASES.some((base) => key === base || key.startsWith(`${base}_`));
}

function getBaseKey(key: string): string {
  return key.replace(UUID_SUFFIX_RE, '');
}

function isNonEmptyValue(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  if (Array.isArray(val)) return val.length > 0;
  if (typeof val === 'object') return Object.keys(val as Record<string, unknown>).length > 0;
  return true;
}

export function onBackgroundCacheDiff(listener: CacheDiffListener): () => void {
  cacheDiffListeners.add(listener);
  return () => {
    cacheDiffListeners.delete(listener);
  };
}

export function invalidateAllCacheFreshness(): void {
  lastInvalidatedAt = Date.now();
}

/**
 * Purges all cached read entries across RAM, localStorage, and IndexedDB.
 * Must be called on explicit sign-out or when switching between different companies
 * on a shared terminal so data from Company A can never bleed into Company B.
 */
export async function clearAllReadCache(): Promise<void> {
  memoryCache.clear();
  inFlightRevalidations.clear();
  lastInvalidatedAt = 0;
  hydrationPromise = null;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (
        k &&
        (k.startsWith(CACHE_PREFIX) ||
          k === CACHE_TIMESTAMP_KEY ||
          k === LAST_CACHE_REFRESH_KEY)
      ) {
        keysToRemove.push(k);
      }
    }
    for (const k of keysToRemove) {
      localStorage.removeItem(k);
    }
  } catch {
    // Ignore storage errors
  }
  await idbClear(READ_CACHE_STORE);
}

export class OfflineNetworkError extends Error {
  constructor(message = 'Network unavailable') {
    super(message);
    this.name = 'OfflineNetworkError';
  }
}

export function isLikelyNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  if (err instanceof OfflineNetworkError) return true;
  const msg =
    typeof err === 'string'
      ? err
      : err && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message)
        : '';
  const lower = msg.toLowerCase();
  return (
    lower.includes('failed to fetch') ||
    lower.includes('offline') ||
    lower.includes('networkerror') ||
    lower.includes('network request failed') ||
    lower.includes('load failed') ||
    lower.includes('fetch error') ||
    lower.includes('hostname could not be found') ||
    lower.includes('err_internet_disconnected') ||
    lower.includes('err_network_changed') ||
    lower.includes('err_connection') ||
    lower.includes('err_name_not_resolved') ||
    lower.includes('unexpected token') ||
    lower.includes('jwt expired') ||
    lower.includes('invalid jwt') ||
    lower.includes('pgrst301') ||
    lower.includes('authsessionmissing') ||
    lower.includes('aborterror') ||
    lower.includes('timeout') ||
    lower.includes('timed out')
  );
}

export function throwIfNetworkError(error: { message?: string } | string | null | undefined): void {
  if (!error) return;
  const msg = typeof error === 'string' ? error : (error.message ?? '');
  if (isLikelyNetworkError(msg)) {
    throw new OfflineNetworkError(msg || 'Network error');
  }
}

function cacheKey(key: string): string {
  return `${CACHE_PREFIX}${key}`;
}

function writeLocalStorageEntry<T>(key: string, entry: CacheEntry<T>): void {
  // Fast heuristic before JSON.stringify: huge arrays (e.g. > 1,500 rows) belong in Memory + IndexedDB only
  if (Array.isArray(entry.data) && entry.data.length > 1500) {
    return;
  }
  const serialized = JSON.stringify({ data: entry.data, timestamp: entry.timestamp });
  const maxChars = isPinnedKey(key) ? MAX_LOCALSTORAGE_PINNED_CHARS : MAX_LOCALSTORAGE_UNPINNED_CHARS;
  if (serialized.length > maxChars) {
    // Keep large datasets (e.g. 4,000 clients or hundreds of depots) in Memory + IndexedDB only
    return;
  }

  try {
    localStorage.setItem(cacheKey(key), serialized);
    const tsRaw = localStorage.getItem(CACHE_TIMESTAMP_KEY);
    const keys: Record<string, number> = tsRaw ? JSON.parse(tsRaw) : {};
    keys[key] = entry.timestamp;
    localStorage.setItem(CACHE_TIMESTAMP_KEY, JSON.stringify(keys));
  } catch {
    pruneOldEntries(6, true);
    try {
      localStorage.setItem(cacheKey(key), serialized);
      const tsRaw = localStorage.getItem(CACHE_TIMESTAMP_KEY);
      const keys: Record<string, number> = tsRaw ? JSON.parse(tsRaw) : {};
      keys[key] = entry.timestamp;
      localStorage.setItem(CACHE_TIMESTAMP_KEY, JSON.stringify(keys));
    } catch {
      // IndexedDB + memoryCache still hold the full entry safely
    }
  }
}

/**
 * Loads all persisted read-cache entries from IndexedDB into RAM on app launch,
 * ensuring 0ms access to large datasets and restoring any pinned tables missing from localStorage.
 */
export function hydrateReadCacheFromIdb(): Promise<void> {
  if (hydrationPromise) return hydrationPromise;
  hydrationPromise = (async () => {
    try {
      const rows = await idbGetAll<CacheEntry<unknown>>(READ_CACHE_STORE);
      for (const row of rows) {
        if (!row || typeof row.key !== 'string') continue;
        const existing = memoryCache.get(row.key);
        if (!existing || (row.timestamp ?? 0) > (existing.timestamp ?? 0)) {
          memoryCache.set(row.key, row);
        }
        // Re-seed pinned tables (like all_clients) into localStorage if missing
        if (isPinnedKey(row.key)) {
          try {
            if (!localStorage.getItem(cacheKey(row.key))) {
              writeLocalStorageEntry(row.key, row);
            }
          } catch {
            // Ignore
          }
        }
      }
    } catch {
      // IndexedDB unavailable
    }
  })();
  return hydrationPromise;
}

// Kick off hydration immediately on module load
if (typeof window !== 'undefined') {
  void hydrateReadCacheFromIdb();
}

function getCacheEntrySync<T>(key: string): CacheEntry<T> | null {
  const mem = memoryCache.get(key) as CacheEntry<T> | undefined;
  if (mem) return mem;
  try {
    const raw = localStorage.getItem(cacheKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data: T; timestamp: number };
    const entry: CacheEntry<T> = { key, data: parsed.data, timestamp: parsed.timestamp ?? 0 };
    memoryCache.set(key, entry);
    return entry;
  } catch {
    return null;
  }
}

export function getCached<T>(key: string): T | null {
  const entry = getCacheEntrySync<T>(key);
  return entry ? entry.data : null;
}

export async function getCachedEntryAsync<T>(key: string): Promise<CacheEntry<T> | null> {
  const syncEntry = getCacheEntrySync<T>(key);
  if (syncEntry !== null) return syncEntry;
  const idbEntry = await idbGet<CacheEntry<T>>(READ_CACHE_STORE, key);
  if (idbEntry) {
    memoryCache.set(key, idbEntry);
    return idbEntry;
  }
  return null;
}

export async function getCachedAsync<T>(key: string): Promise<T | null> {
  const entry = await getCachedEntryAsync<T>(key);
  return entry ? entry.data : null;
}

/**
 * Looks up a cached entry by exact key first, and if missing (e.g. cold offline boot where
 * boutiqueId wasn't resolved yet or differed from when cache was written), safely falls back
 * across unscoped / stored-boutique / IndexedDB prefix-matched entries.
 */
export async function getCachedWithScopeFallbackAsync<T>(key: string): Promise<T | null> {
  // Ensure IDB hydration has run if memoryCache doesn't have the key yet
  const exact = await getCachedEntryAsync<T>(key);
  if (exact !== null) return exact.data;

  await hydrateReadCacheFromIdb();
  const exactAfterHydrate = memoryCache.get(key) as CacheEntry<T> | undefined;
  if (exactAfterHydrate) return exactAfterHydrate.data;

  const base = getBaseKey(key);

  // Strict multi-boutique isolation:
  // If the caller explicitly requested a boutique-scoped key (`key !== base`), NEVER
  // fall back to another boutique's cached dataset or an unscoped list!
  // Cross-scope fallback is only safe on cold offline boot when boutiqueId is not yet known (`key === base`).
  if (key !== base) {
    return null;
  }

  // 2. Try last stored boutique ID from localStorage (covers cold offline boot when currentBoutiqueId was still null)
  try {
    const storedBoutiqueId = localStorage.getItem(BOUTIQUE_STORAGE_KEY);
    if (storedBoutiqueId) {
      const storedKey = `${base}_${storedBoutiqueId}`;
      if (storedKey !== key) {
        const storedEntry = await getCachedEntryAsync<T>(storedKey);
        if (storedEntry !== null) return storedEntry.data;
      }
    }
  } catch {
    // Ignore
  }

  // 3. Scan memoryCache (already hydrated from IDB) for any matching prefix entry
  const prefix = `${base}_`;
  let bestCandidate: CacheEntry<T> | null = null;
  for (const [k, v] of memoryCache.entries()) {
    if (k === base || k.startsWith(prefix)) {
      const cand = v as CacheEntry<T>;
      if (!bestCandidate) {
        bestCandidate = cand;
      } else {
        const candNonEmpty = isNonEmptyValue(cand.data);
        const bestNonEmpty = isNonEmptyValue(bestCandidate.data);
        if (candNonEmpty && !bestNonEmpty) {
          bestCandidate = cand;
        } else if (candNonEmpty === bestNonEmpty && (cand.timestamp ?? 0) > (bestCandidate.timestamp ?? 0)) {
          bestCandidate = cand;
        }
      }
    }
  }

  if (bestCandidate) return bestCandidate.data;

  // 4. Final fallback: scan localStorage keys matching prefix
  try {
    const lsPrefix = cacheKey(prefix);
    let lsBest: CacheEntry<T> | null = null;
    for (let i = 0; i < localStorage.length; i++) {
      const fullK = localStorage.key(i);
      if (!fullK || !fullK.startsWith(lsPrefix)) continue;
      const raw = localStorage.getItem(fullK);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as { data: T; timestamp?: number };
        const entry: CacheEntry<T> = {
          key: fullK.slice(CACHE_PREFIX.length),
          data: parsed.data,
          timestamp: parsed.timestamp ?? 0,
        };
        if (!lsBest || (isNonEmptyValue(entry.data) && !isNonEmptyValue(lsBest.data)) || entry.timestamp > lsBest.timestamp) {
          lsBest = entry;
        }
      } catch {
        // Ignore malformed entry
      }
    }
    if (lsBest) {
      memoryCache.set(lsBest.key, lsBest);
      return lsBest.data;
    }
  } catch {
    // Ignore
  }

  return null;
}

export function setCached<T>(key: string, data: T): void {
  const now = Date.now();
  const entry: CacheEntry<T> = { key, data, timestamp: now };

  memoryCache.set(key, entry);
  void idbPut(READ_CACHE_STORE, entry);
  writeLocalStorageEntry(key, entry);
}

/**
 * Safely updates a cached entry without EVER wiping an IndexedDB-only list with a partial item.
 * If the entry is already in memory/localStorage, updates synchronously (0ms).
 * Otherwise loads the full existing entry from IndexedDB first, applies the updater, and saves.
 */
export function updateCached<T>(key: string, updater: (current: T | null) => T | null): void {
  const currentSync = getCached<T>(key);
  if (currentSync !== null) {
    const next = updater(currentSync);
    if (next !== null) {
      setCached(key, next);
    }
    return;
  }

  // Not in sync memory/localStorage yet — load from IndexedDB/scope fallback BEFORE writing
  // so we never overwrite a full persisted list with a single optimistic item!
  void (async () => {
    const persisted = await getCachedWithScopeFallbackAsync<T>(key);
    const next = updater(persisted);
    if (next !== null) {
      setCached(key, next);
    }
  })();
}

export function markCacheRefreshedNow(): void {
  try {
    localStorage.setItem(LAST_CACHE_REFRESH_KEY, new Date().toISOString());
  } catch {
    // Ignore
  }
}

export function getLastCacheRefreshAt(): string | null {
  try {
    return localStorage.getItem(LAST_CACHE_REFRESH_KEY);
  } catch {
    return null;
  }
}

function pruneOldEntries(count: number, preservePinned = true): void {
  try {
    const tsRaw = localStorage.getItem(CACHE_TIMESTAMP_KEY);
    if (!tsRaw) return;
    const keys: Record<string, number> = JSON.parse(tsRaw);
    const sorted = Object.entries(keys)
      .filter(([k]) => !preservePinned || !isPinnedKey(k))
      .sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < Math.min(count, sorted.length); i++) {
      const [key] = sorted[i];
      localStorage.removeItem(cacheKey(key));
      delete keys[key];
    }
    localStorage.setItem(CACHE_TIMESTAMP_KEY, JSON.stringify(keys));
  } catch {
    // Ignore
  }
}

function revalidateInBackground<T>(key: string, fetcher: () => Promise<T>, prevData: T): void {
  if (inFlightRevalidations.has(key)) return;

  const task = (async () => {
    try {
      const fresh = await fetcher();
      let changed = false;
      try {
        changed = JSON.stringify(fresh) !== JSON.stringify(prevData);
      } catch {
        changed = true;
      }
      setCached(key, fresh);
      if (changed) {
        cacheDiffListeners.forEach((fn) => fn(key));
      }
    } catch {
      // Silent background revalidation: ignore transient network/auth errors
    } finally {
      inFlightRevalidations.delete(key);
    }
  })();

  inFlightRevalidations.set(key, task);
}

/**
 * Stale-While-Revalidate + Read-After-Write Consistency + Bulletproof Offline Fallback:
 * - Offline: returns cached result from memory, localStorage, or IndexedDB (with boutique-scope fallback).
 * - Online with valid cache (newer than lastInvalidatedAt): returns cached data in 0ms
 *   and silently revalidates in the background if older than SWR_REVALIDATE_AFTER_MS.
 * - Online after a mutation/realtime event (or cold cache): fetches fresh from server,
 *   caches it, and falls back to existing cache on any network/auth error.
 */
export async function cachedRead<T>(
  key: string,
  fetcher: () => Promise<T>,
  fallback: T,
): Promise<T> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const cached = await getCachedWithScopeFallbackAsync<T>(key);
    return cached !== null ? cached : fallback;
  }

  let existingEntry = getCacheEntrySync<T>(key);
  if (existingEntry === null) {
    existingEntry = await getCachedEntryAsync<T>(key);
  }

  if (existingEntry !== null && existingEntry.timestamp >= lastInvalidatedAt) {
    const isLargeList = Array.isArray(existingEntry.data) && existingEntry.data.length >= 500;
    const revalidateAfter = isLargeList
      ? LARGE_LIST_SWR_REVALIDATE_AFTER_MS
      : SWR_REVALIDATE_AFTER_MS;
    if (Date.now() - existingEntry.timestamp >= revalidateAfter) {
      revalidateInBackground(key, fetcher, existingEntry.data);
    }
    return existingEntry.data;
  }

  try {
    const result = await fetcher();
    setCached(key, result);
    return result;
  } catch {
    const cached = await getCachedWithScopeFallbackAsync<T>(key);
    if (cached !== null) return cached;
    return fallback;
  }
}
