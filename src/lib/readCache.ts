// Offline & Real-Time Read Cache (Stale-While-Revalidate + IndexedDB + Read-After-Write Consistency)
// Serves cached data instantaneously (0ms) while revalidating silently in the background,
// and guarantees immediate fresh reads after any local mutation or real-time WebSocket event.

import { idbGet, idbPut, READ_CACHE_STORE } from '@/lib/offlineStorage';

const CACHE_PREFIX = 'offline_cache_';
const CACHE_TIMESTAMP_KEY = 'offline_cache_timestamps';
const LAST_CACHE_REFRESH_KEY = 'offline_last_cache_refresh';

// Minimum age before a cached read triggers a silent background network check
const SWR_REVALIDATE_AFTER_MS = 2500;

interface CacheEntry<T> {
  key?: string;
  data: T;
  timestamp: number;
}

type CacheDiffListener = (key: string) => void;
const cacheDiffListeners = new Set<CacheDiffListener>();
const inFlightRevalidations = new Map<string, Promise<void>>();

// Timestamp of the latest local write or incoming real-time server event.
// Any cache entry older than this timestamp will bypass stale return and fetch fresh immediately.
let lastInvalidatedAt = 0;

export function onBackgroundCacheDiff(listener: CacheDiffListener): () => void {
  cacheDiffListeners.add(listener);
  return () => {
    cacheDiffListeners.delete(listener);
  };
}

export function invalidateAllCacheFreshness(): void {
  lastInvalidatedAt = Date.now();
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
    lower.includes('pgrst301') ||
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

function getCacheEntrySync<T>(key: string): CacheEntry<T> | null {
  try {
    const raw = localStorage.getItem(cacheKey(key));
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry<T>;
  } catch {
    return null;
  }
}

export function getCached<T>(key: string): T | null {
  const entry = getCacheEntrySync<T>(key);
  return entry ? entry.data : null;
}

export async function getCachedAsync<T>(key: string): Promise<T | null> {
  const syncVal = getCached<T>(key);
  if (syncVal !== null) return syncVal;
  const idbEntry = await idbGet<CacheEntry<T>>(READ_CACHE_STORE, key);
  return idbEntry ? idbEntry.data : null;
}

export function setCached<T>(key: string, data: T): void {
  const now = Date.now();
  const entry: CacheEntry<T> = { key, data, timestamp: now };

  void idbPut(READ_CACHE_STORE, entry);

  try {
    localStorage.setItem(cacheKey(key), JSON.stringify({ data, timestamp: now }));
    const tsRaw = localStorage.getItem(CACHE_TIMESTAMP_KEY);
    const keys: Record<string, number> = tsRaw ? JSON.parse(tsRaw) : {};
    keys[key] = now;
    localStorage.setItem(CACHE_TIMESTAMP_KEY, JSON.stringify(keys));
  } catch {
    pruneOldEntries(5);
    try {
      localStorage.setItem(cacheKey(key), JSON.stringify({ data, timestamp: now }));
    } catch {
      // IndexedDB still holds the full entry even if localStorage is full
    }
  }
}

export function updateCached<T>(key: string, updater: (current: T | null) => T | null): void {
  const current = getCached<T>(key);
  const next = updater(current);
  if (next !== null) {
    setCached(key, next);
  }
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

function pruneOldEntries(count: number): void {
  try {
    const tsRaw = localStorage.getItem(CACHE_TIMESTAMP_KEY);
    if (!tsRaw) return;
    const keys: Record<string, number> = JSON.parse(tsRaw);
    const sorted = Object.entries(keys).sort((a, b) => a[1] - b[1]);
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
      // Silent background revalidation: ignore transient network errors
    } finally {
      inFlightRevalidations.delete(key);
    }
  })();

  inFlightRevalidations.set(key, task);
}

/**
 * Stale-While-Revalidate + Read-After-Write Consistency:
 * - Offline: returns cached result from localStorage or IndexedDB.
 * - Online with valid cache (newer than lastInvalidatedAt): returns cached data in 0ms
 *   and silently revalidates in the background if older than SWR_REVALIDATE_AFTER_MS.
 * - Online after a mutation/realtime event (or cold cache): fetches fresh from server,
 *   caches it, and falls back to existing cache on network drop.
 */
export async function cachedRead<T>(
  key: string,
  fetcher: () => Promise<T>,
  fallback: T,
): Promise<T> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const cached = await getCachedAsync<T>(key);
    return cached !== null ? cached : fallback;
  }

  const syncEntry = getCacheEntrySync<T>(key);
  if (syncEntry !== null && syncEntry.timestamp >= lastInvalidatedAt) {
    if (Date.now() - syncEntry.timestamp >= SWR_REVALIDATE_AFTER_MS) {
      revalidateInBackground(key, fetcher, syncEntry.data);
    }
    return syncEntry.data;
  }

  try {
    const result = await fetcher();
    setCached(key, result);
    return result;
  } catch {
    const cached = await getCachedAsync<T>(key);
    if (cached !== null) return cached;
    return fallback;
  }
}
