// Offline read cache — stores results of database reads in both localStorage (fast sync access)
// and IndexedDB (high-capacity fallback) so the app works seamlessly offline without corrupting
// cached data when network drops mid-request.

import { idbGet, idbPut, READ_CACHE_STORE } from '@/lib/offlineStorage';

const CACHE_PREFIX = 'offline_cache_';
const CACHE_TIMESTAMP_KEY = 'offline_cache_timestamps';
const LAST_CACHE_REFRESH_KEY = 'offline_last_cache_refresh';

interface CacheEntry<T> {
  key?: string;
  data: T;
  timestamp: number;
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
    lower.includes('networkerror') ||
    lower.includes('network request failed') ||
    lower.includes('load failed') ||
    lower.includes('fetch error') ||
    lower.includes('err_internet_disconnected') ||
    lower.includes('err_name_not_resolved') ||
    lower.includes('aborterror') ||
    lower.includes('timeout')
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

export function getCached<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(cacheKey(key));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    return entry.data;
  } catch {
    return null;
  }
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

  // Persist asynchronously to IndexedDB (virtually unlimited storage)
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

/**
 * If offline: returns cached result from localStorage or IndexedDB, or fallback.
 * If online: runs fetcher, caches result, and returns it.
 * If fetcher fails due to network loss: preserves and returns existing cache instead of overwriting with empty fallback!
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

  try {
    const result = await fetcher();
    setCached(key, result);
    return result;
  } catch (err) {
    if (isLikelyNetworkError(err)) {
      const cached = await getCachedAsync<T>(key);
      if (cached !== null) return cached;
      return fallback;
    }
    throw err;
  }
}
