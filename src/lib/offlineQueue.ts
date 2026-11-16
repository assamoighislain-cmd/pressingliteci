// Enterprise Offline Mutation Queue & Background Synchronization Engine
// Persists writes in both localStorage and IndexedDB (shared with bg-sync-sw.js),
// coalesces redundant offline edits, coordinates across tabs/SW via Web Locks,
// handles duplicate sequential code collisions automatically, and never drops user data on network drops.

import { supabase, supabaseUrl } from '@/lib/supabase';
import {
  idbGetAll,
  idbReplaceAll,
  MUTATIONS_STORE,
  getMetaValue,
  setMetaValue,
} from '@/lib/offlineStorage';
import { isLikelyNetworkError } from '@/lib/readCache';

const QUEUE_KEY = 'offline_mutation_queue';
const LAST_SYNC_KEY = 'offline_last_sync_at';
const SYNC_TAG = 'pressinglite-sync-queue';
const PERIODIC_SYNC_TAG = 'pressinglite-periodic-sync';
const LOCK_NAME = 'pressinglite-sync-lock';
const MAX_PERMANENT_RETRIES = 6;

export interface QueuedMutation {
  id: string;
  table: string;
  operation: 'insert' | 'update' | 'upsert' | 'delete' | 'rpc';
  data: Record<string, unknown>;
  filters?: Record<string, unknown>[];
  createdAt: string;
  retries: number;
  status?: 'pending' | 'syncing' | 'failed';
  lastError?: string | null;
  nextRetryAt?: number | null;
  label?: string;
}

export interface SyncStateSnapshot {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  failedCount: number;
  totalQueueCount: number;
  syncedInBatch: number;
  totalInBatch: number;
  lastSyncAt: string | null;
  mutations: QueuedMutation[];
}

type SyncListener = (snapshot: SyncStateSnapshot) => void;
type CountListener = (count: number) => void;
type PostSyncCallback = () => void | Promise<void>;

const syncListeners = new Set<SyncListener>();
const countListeners = new Set<CountListener>();
const postSyncCallbacks = new Set<PostSyncCallback>();

let memoryQueue: QueuedMutation[] = loadQueueFromLocalStorage();
let isSyncingFlag = false;
let syncedInBatchCount = 0;
let totalInBatchCount = 0;
let lastSyncAtState: string | null = loadLastSyncFromLocalStorage();
let inFlightSyncPromise: Promise<{ processed: number; failed: number }> | null = null;
let autoSyncInitialized = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function loadQueueFromLocalStorage(): QueuedMutation[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedMutation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadLastSyncFromLocalStorage(): string | null {
  try {
    return localStorage.getItem(LAST_SYNC_KEY);
  } catch {
    return null;
  }
}

function saveLastSyncAt(iso: string): void {
  lastSyncAtState = iso;
  try {
    localStorage.setItem(LAST_SYNC_KEY, iso);
  } catch {
    // Ignore
  }
  void setMetaValue('last_sync_at', iso);
}

function buildSnapshot(): SyncStateSnapshot {
  const failedCount = memoryQueue.filter((m) => m.status === 'failed').length;
  const pendingCount = memoryQueue.length - failedCount;
  return {
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    isSyncing: isSyncingFlag,
    pendingCount,
    failedCount,
    totalQueueCount: memoryQueue.length,
    syncedInBatch: syncedInBatchCount,
    totalInBatch: totalInBatchCount,
    lastSyncAt: lastSyncAtState,
    mutations: [...memoryQueue],
  };
}

function emitState(): void {
  const snap = buildSnapshot();
  syncListeners.forEach((fn) => fn(snap));
  countListeners.forEach((fn) => fn(snap.pendingCount));
}

function persistQueue(queue: QueuedMutation[]): void {
  memoryQueue = queue;
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // IndexedDB still persists full queue
  }
  void idbReplaceAll(MUTATIONS_STORE, queue);
  emitState();
}

async function reconcileQueueWithIdb(): Promise<void> {
  const idbItems = await idbGetAll<QueuedMutation>(MUTATIONS_STORE);
  const swLastSync = await getMetaValue<string>('last_sync_at');
  if (swLastSync && (!lastSyncAtState || swLastSync > lastSyncAtState)) {
    lastSyncAtState = swLastSync;
    try {
      localStorage.setItem(LAST_SYNC_KEY, swLastSync);
    } catch {
      // Ignore
    }
  }

  if (idbItems.length > 0 || memoryQueue.length > 0) {
    // If SW synced while tab was closed, swLastSync is newer than localStorage; otherwise merge by ID
    if (swLastSync && idbItems.length === 0 && memoryQueue.length > 0) {
      const newestQueued = memoryQueue.reduce((max, m) => (m.createdAt > max ? m.createdAt : max), '');
      if (newestQueued && newestQueued <= swLastSync) {
        persistQueue([]);
        return;
      }
    }
    const mergedMap = new Map<string, QueuedMutation>();
    for (const m of idbItems) mergedMap.set(m.id, m);
    for (const m of memoryQueue) {
      if (!mergedMap.has(m.id)) mergedMap.set(m.id, m);
    }
    const merged = Array.from(mergedMap.values()).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    persistQueue(merged);
  } else {
    emitState();
  }
}

export function subscribeSyncState(listener: SyncListener): () => void {
  syncListeners.add(listener);
  listener(buildSnapshot());
  return () => {
    syncListeners.delete(listener);
  };
}

export function subscribePendingCount(listener: CountListener): () => void {
  countListeners.add(listener);
  listener(buildSnapshot().pendingCount);
  return () => {
    countListeners.delete(listener);
  };
}

export function onPostSync(callback: PostSyncCallback): () => void {
  postSyncCallbacks.add(callback);
  return () => {
    postSyncCallbacks.delete(callback);
  };
}

function genId(): string {
  return `offline_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function extractEqIdFilter(filters?: Record<string, unknown>[]): string | null {
  if (!filters || filters.length !== 1) return null;
  const f = filters[0];
  if (f.column === 'id' && f.operator === 'eq' && typeof f.value === 'string') {
    return f.value;
  }
  return null;
}

async function requestBackgroundSync(): Promise<void> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.ready;
    const syncReg = reg as ServiceWorkerRegistration & {
      sync?: { register: (tag: string) => Promise<void> };
      periodicSync?: { register: (tag: string, opts: { minInterval: number }) => Promise<void> };
    };
    if (syncReg.sync) {
      await syncReg.sync.register(SYNC_TAG);
    }
    if (syncReg.periodicSync) {
      await syncReg.periodicSync
        .register(PERIODIC_SYNC_TAG, { minInterval: 15 * 60 * 1000 })
        .catch(() => {});
    }
  } catch {
    // Background Sync API not supported in this browser; foreground listeners handle sync
  }
}

function broadcastQueueUpdated(): void {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel('pressinglite-sync');
      bc.postMessage({ type: 'QUEUE_UPDATED' });
      bc.close();
    }
  } catch {
    // Ignore
  }
}

export function enqueueMutation(
  table: string,
  operation: QueuedMutation['operation'],
  data: Record<string, unknown>,
  filters?: Record<string, unknown>[],
  label?: string,
): QueuedMutation {
  const queue = [...memoryQueue];
  const targetRowId = extractEqIdFilter(filters);

  // Coalesce offline mutations on the same record before they ever hit the server
  if (targetRowId && operation === 'update') {
    const existingInsertIdx = queue.findIndex(
      (m) =>
        m.table === table &&
        m.operation === 'insert' &&
        m.status !== 'syncing' &&
        String(m.data.id ?? '') === targetRowId,
    );
    if (existingInsertIdx >= 0) {
      const updated: QueuedMutation = {
        ...queue[existingInsertIdx],
        data: { ...queue[existingInsertIdx].data, ...data },
        status: 'pending',
        lastError: null,
      };
      queue[existingInsertIdx] = updated;
      persistQueue(queue);
      void requestBackgroundSync();
      broadcastQueueUpdated();
      return updated;
    }

    const existingUpdateIdx = queue.findIndex(
      (m) =>
        m.table === table &&
        m.operation === 'update' &&
        m.status !== 'syncing' &&
        extractEqIdFilter(m.filters) === targetRowId,
    );
    if (existingUpdateIdx >= 0) {
      const updated: QueuedMutation = {
        ...queue[existingUpdateIdx],
        data: { ...queue[existingUpdateIdx].data, ...data },
        label: label ?? queue[existingUpdateIdx].label,
        status: 'pending',
        lastError: null,
      };
      queue[existingUpdateIdx] = updated;
      persistQueue(queue);
      void requestBackgroundSync();
      broadcastQueueUpdated();
      return updated;
    }
  }

  if (targetRowId && operation === 'delete') {
    const existingInsertIdx = queue.findIndex(
      (m) =>
        m.table === table &&
        m.operation === 'insert' &&
        m.status !== 'syncing' &&
        String(m.data.id ?? '') === targetRowId,
    );
    if (existingInsertIdx >= 0) {
      // Record was created offline and deleted before syncing: cancel it + its child depot_articles/avances
      const removed = queue[existingInsertIdx];
      const filtered = queue.filter((m, idx) => {
        if (idx === existingInsertIdx) return false;
        if (table === 'depots' && String(m.data.depot_id ?? '') === targetRowId) return false;
        return true;
      });
      persistQueue(filtered);
      broadcastQueueUpdated();
      return removed;
    }
  }

  const entry: QueuedMutation = {
    id: genId(),
    table,
    operation,
    data,
    filters,
    createdAt: new Date().toISOString(),
    retries: 0,
    status: 'pending',
    lastError: null,
    nextRetryAt: null,
    label,
  };
  queue.push(entry);
  persistQueue(queue);
  void requestBackgroundSync();
  broadcastQueueUpdated();

  // If online right now, schedule a short debounced sync automatically
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    scheduleRetry(800);
  }
  return entry;
}

export function getPendingCount(): number {
  return memoryQueue.filter((m) => m.status !== 'failed').length;
}

export function getPendingMutations(): QueuedMutation[] {
  return [...memoryQueue];
}

export function removeFromQueue(id: string): void {
  const queue = memoryQueue.filter((m) => m.id !== id);
  persistQueue(queue);
  broadcastQueueUpdated();
}

export function retryQueuedMutation(id: string): void {
  const queue = memoryQueue.map((m) =>
    m.id === id ? { ...m, retries: 0, status: 'pending' as const, lastError: null, nextRetryAt: null } : m,
  );
  persistQueue(queue);
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    void processQueue();
  }
}

export function retryAllFailedMutations(): void {
  const queue = memoryQueue.map((m) =>
    m.status === 'failed'
      ? { ...m, retries: 0, status: 'pending' as const, lastError: null, nextRetryAt: null }
      : m,
  );
  persistQueue(queue);
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    void processQueue();
  }
}

export async function checkRealConnectivity(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    const res = await fetch(`${supabaseUrl}/auth/v1/health`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.status > 0 && res.status < 500;
  } catch {
    return false;
  }
}

async function resolveDuplicateKeyAndMutateData(m: QueuedMutation): Promise<boolean> {
  if (m.operation !== 'insert') return false;
  if (m.table === 'depots' && 'numero' in m.data) {
    const boutiqueId = (m.data.boutique_id as string | null) ?? null;
    const { data, error } = await supabase.rpc('next_depot_numero', { p_boutique_id: boutiqueId });
    if (!error && data) {
      m.data = { ...m.data, numero: String(data) };
      return true;
    }
  }
  if (m.table === 'clients' && 'code' in m.data) {
    const { data, error } = await supabase.rpc('generate_client_code');
    if (!error && data) {
      m.data = { ...m.data, code: String(data) };
      return true;
    }
  }
  if (m.table === 'articles' && 'code' in m.data) {
    const { data, error } = await supabase.rpc('generate_article_code');
    if (!error && data) {
      m.data = { ...m.data, code: String(data) };
      return true;
    }
  }
  return false;
}

async function executeSingleMutation(
  m: QueuedMutation,
): Promise<{ ok: boolean; transient: boolean; error?: string }> {
  try {
    if (m.operation === 'rpc') {
      const { error } = await supabase.rpc(m.table, m.data);
      if (!error) return { ok: true, transient: false };
      return { ok: false, transient: isLikelyNetworkError(error), error: error.message };
    }

    if (m.operation === 'delete') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = supabase.from(m.table).delete();
      for (const f of m.filters ?? []) {
        q = q[String(f.operator)](f.column, f.value);
      }
      const { error } = await q;
      if (!error) return { ok: true, transient: false };
      return { ok: false, transient: isLikelyNetworkError(error), error: error.message };
    }

    if (m.operation === 'update') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = supabase.from(m.table).update(m.data);
      for (const f of m.filters ?? []) {
        q = q[String(f.operator)](f.column, f.value);
      }
      const { error } = await q;
      if (!error) return { ok: true, transient: false };
      return { ok: false, transient: isLikelyNetworkError(error), error: error.message };
    }

    if (m.operation === 'upsert') {
      const { error } = await supabase.from(m.table).upsert(m.data);
      if (!error) return { ok: true, transient: false };
      return { ok: false, transient: isLikelyNetworkError(error), error: error.message };
    }

    // insert — handle duplicate code/numero or already-synced UUID idempotently
    for (let attempt = 0; attempt < 2; attempt++) {
      const { error } = await supabase.from(m.table).insert(m.data);
      if (!error) return { ok: true, transient: false };

      const msg = error.message || '';
      if (msg.includes('duplicate key')) {
        // If primary key id already exists on server, treat as already synced idempotently!
        if (msg.includes('_pkey')) {
          return { ok: true, transient: false };
        }
        if (attempt === 0 && (await resolveDuplicateKeyAndMutateData(m))) {
          continue;
        }
      }

      return { ok: false, transient: isLikelyNetworkError(error), error: msg };
    }

    return { ok: false, transient: false, error: 'Duplicate key conflict' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error';
    return { ok: false, transient: isLikelyNetworkError(err), error: msg };
  }
}

function scheduleRetry(delayMs: number): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (typeof navigator === 'undefined' || navigator.onLine) {
      void processQueue();
    }
  }, delayMs);
}

async function runProcessQueueInternal(): Promise<{ processed: number; failed: number }> {
  await reconcileQueueWithIdb();

  const actionable = memoryQueue.filter((m) => m.status !== 'failed');
  if (actionable.length === 0) {
    return { processed: 0, failed: memoryQueue.length };
  }

  const reachable = await checkRealConnectivity();
  if (!reachable) {
    scheduleRetry(10000);
    return { processed: 0, failed: 0 };
  }

  isSyncingFlag = true;
  syncedInBatchCount = 0;
  totalInBatchCount = actionable.length;
  emitState();

  let processed = 0;
  let failed = 0;
  let earliestNextRetryDelay: number | null = null;

  const workingQueue = [...memoryQueue];

  for (let i = 0; i < workingQueue.length; i++) {
    const m = workingQueue[i];
    if (m.status === 'failed') {
      failed++;
      continue;
    }

    if (m.nextRetryAt && m.nextRetryAt > Date.now()) {
      const waitMs = m.nextRetryAt - Date.now();
      earliestNextRetryDelay =
        earliestNextRetryDelay === null ? waitMs : Math.min(earliestNextRetryDelay, waitMs);
      continue;
    }

    workingQueue[i] = { ...m, status: 'syncing' };
    memoryQueue = [...workingQueue];
    emitState();

    const res = await executeSingleMutation(workingQueue[i]);
    if (res.ok) {
      workingQueue.splice(i, 1);
      i--;
      processed++;
      syncedInBatchCount = processed;
      persistQueue([...workingQueue]);
    } else if (res.transient) {
      // Transient network error: DO NOT drop or burn permanent retries! Stop FIFO batch & backoff.
      const backoffMs = Math.min(Math.pow(2, Math.min(m.retries, 4)) * 2500, 45000);
      workingQueue[i] = {
        ...m,
        status: 'pending',
        lastError: 'En attente de réseau stable…',
        nextRetryAt: Date.now() + backoffMs,
      };
      persistQueue([...workingQueue]);
      earliestNextRetryDelay = backoffMs;
      break;
    } else {
      const nextRetries = m.retries + 1;
      const isPermFailed = nextRetries >= MAX_PERMANENT_RETRIES;
      const backoffMs = Math.min(Math.pow(2, nextRetries) * 2000, 60000);
      workingQueue[i] = {
        ...m,
        retries: nextRetries,
        status: isPermFailed ? 'failed' : 'pending',
        lastError: res.error ?? 'Erreur serveur',
        nextRetryAt: isPermFailed ? null : Date.now() + backoffMs,
      };
      if (isPermFailed) {
        failed++;
      } else {
        earliestNextRetryDelay =
          earliestNextRetryDelay === null ? backoffMs : Math.min(earliestNextRetryDelay, backoffMs);
      }
      persistQueue([...workingQueue]);
    }
  }

  isSyncingFlag = false;
  if (processed > 0) {
    saveLastSyncAt(new Date().toISOString());
    broadcastQueueUpdated();
    for (const cb of postSyncCallbacks) {
      try {
        await cb();
      } catch {
        // Ignore post-sync refresh errors
      }
    }
  }
  emitState();

  if (earliestNextRetryDelay !== null) {
    scheduleRetry(earliestNextRetryDelay);
  }

  return { processed, failed };
}

export async function processQueue(): Promise<{ processed: number; failed: number }> {
  if (inFlightSyncPromise) return inFlightSyncPromise;

  const runner = async () => {
    if (typeof navigator !== 'undefined' && 'locks' in navigator && navigator.locks?.request) {
      let result = { processed: 0, failed: 0 };
      await navigator.locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
        if (!lock) return;
        result = await runProcessQueueInternal();
      });
      return result;
    }
    return runProcessQueueInternal();
  };

  inFlightSyncPromise = runner().finally(() => {
    inFlightSyncPromise = null;
  });

  return inFlightSyncPromise;
}

export function enableAutoSync(): void {
  if (autoSyncInitialized || typeof window === 'undefined') return;
  autoSyncInitialized = true;

  void reconcileQueueWithIdb().then(() => {
    if (navigator.onLine && getPendingCount() > 0) {
      void processQueue();
    }
  });

  window.addEventListener('online', () => {
    emitState();
    setTimeout(() => {
      void processQueue();
    }, 800);
  });

  window.addEventListener('offline', () => {
    emitState();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine && getPendingCount() > 0) {
      void processQueue();
    }
  });

  window.addEventListener('focus', () => {
    if (navigator.onLine && getPendingCount() > 0) {
      void processQueue();
    }
  });

  const navWithConn = navigator as Navigator & {
    connection?: { addEventListener?: (type: string, fn: () => void) => void };
  };
  navWithConn.connection?.addEventListener?.('change', () => {
    if (navigator.onLine && getPendingCount() > 0) {
      void processQueue();
    }
  });

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel('pressinglite-sync');
      bc.onmessage = (ev) => {
        const msgType = ev.data?.type;
        if (msgType === 'SW_TRIGGER_SYNC') {
          void processQueue();
        } else if (msgType === 'SW_SYNC_COMPLETED' || msgType === 'QUEUE_UPDATED') {
          void reconcileQueueWithIdb();
        }
      };
    }
  } catch {
    // Ignore
  }

  // Adaptive heartbeat every 30s when online and pending mutations exist
  setInterval(() => {
    if (navigator.onLine && !isSyncingFlag && getPendingCount() > 0) {
      void processQueue();
    }
  }, 30000);
}
