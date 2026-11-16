// Real-Time Silent Background Synchronization Engine
// Combines Supabase Realtime (postgres_changes + instant peer-to-peer WebSocket broadcast),
// cross-tab BroadcastChannel, and silent idle revalidation so every tab & device stays
// synchronized in real time in the background without spinners or user interruption.

import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { invalidateAllCacheFreshness, onBackgroundCacheDiff } from '@/lib/readCache';
import { onPostSync, processQueue, getPendingCount } from '@/lib/offlineQueue';

const INSTANCE_ID = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
const CROSS_TAB_CHANNEL = 'pressinglite-realtime';
const DEBOUNCE_MS = 220;
const IDLE_POLL_INTERVAL_MS = 25000;

export type RealtimeListener = (changedTables: Set<string>) => void;

const listeners = new Set<RealtimeListener>();
let pendingTables = new Set<string>();
let emitTimer: ReturnType<typeof setTimeout> | null = null;

let activeTenantChannel: RealtimeChannel | null = null;
let activeTenantKey: string | null = null;
let platformChannel: RealtimeChannel | null = null;
let crossTabBc: BroadcastChannel | null = null;
let engineInitialized = false;
let lastBroadcastSentAt: Record<string, number> = {};
let lastConnectParams: { tenantId: string | null; isSuperAdmin: boolean; userId: string | null } | null = null;

function scheduleEmit(tables: string[]): void {
  for (const t of tables) pendingTables.add(t);
  if (emitTimer) clearTimeout(emitTimer);
  emitTimer = setTimeout(() => {
    const batch = new Set(pendingTables);
    pendingTables = new Set();
    emitTimer = null;
    listeners.forEach((fn) => {
      try {
        fn(batch);
      } catch {
        // Ignore subscriber errors
      }
    });
  }, DEBOUNCE_MS);
}

export function subscribeRealtimeChanges(listener: RealtimeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Called automatically by db.ts and SuperAdminPage whenever a local write occurs.
 * Broadcasts lightweight invalidation over WebSocket (to other devices) and BroadcastChannel (to other tabs)
 * without blocking the caller.
 */
export function notifyRealtimeMutation(table: string, isPlatformWide = false): void {
  invalidateAllCacheFreshness();

  // Notify other local views mounted in the same tab (e.g. header/sidebar/badges)
  scheduleEmit([table]);

  // Notify other tabs in the same browser immediately (< 5ms)
  try {
    if (crossTabBc) {
      crossTabBc.postMessage({ type: 'MUTATION', table, sourceId: INSTANCE_ID });
    }
  } catch {
    // Ignore
  }

  // Throttle identical table broadcasts within 150ms to coalesce batch inserts (e.g. depot_articles)
  const now = Date.now();
  const key = `${isPlatformWide ? 'platform' : 'tenant'}:${table}`;
  if (lastBroadcastSentAt[key] && now - lastBroadcastSentAt[key] < 150) {
    return;
  }
  lastBroadcastSentAt[key] = now;

  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  try {
    if (isPlatformWide && platformChannel) {
      void platformChannel.send({
        type: 'broadcast',
        event: 'data_changed',
        payload: { table, sourceId: INSTANCE_ID, ts: now },
      });
    } else if (activeTenantChannel) {
      void activeTenantChannel.send({
        type: 'broadcast',
        event: 'data_changed',
        payload: { table, sourceId: INSTANCE_ID, ts: now },
      });
    }
  } catch {
    // Silent background broadcast — ignore transient socket errors
  }
}

function handleIncomingRemoteChange(table: string, sourceId?: string): void {
  if (sourceId && sourceId === INSTANCE_ID) return;
  invalidateAllCacheFreshness();
  scheduleEmit([table || '*']);
}

function ensureGlobalEngineInitialized(): void {
  if (engineInitialized || typeof window === 'undefined') return;
  engineInitialized = true;

  // Listen to background SWR cache diffs -> silently notify mounted views
  onBackgroundCacheDiff(() => {
    scheduleEmit(['*']);
  });

  // Listen to offlineQueue finishing background sync -> notify all views & peers!
  onPostSync(() => {
    invalidateAllCacheFreshness();
    scheduleEmit(['*']);
    notifyRealtimeMutation('*');
  });

  // Cross-tab BroadcastChannel
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      crossTabBc = new BroadcastChannel(CROSS_TAB_CHANNEL);
      crossTabBc.onmessage = (ev) => {
        if (ev.data?.type === 'MUTATION' && ev.data?.sourceId !== INSTANCE_ID) {
          handleIncomingRemoteChange(String(ev.data.table || '*'), ev.data.sourceId);
        }
      };
    }
  } catch {
    // Ignore
  }

  // Silent background refresh & WebSocket reconnect when network returns; pause sockets when offline
  window.addEventListener('online', () => {
    if (lastConnectParams?.userId) {
      connectRealtimeSync(lastConnectParams);
    }
    invalidateAllCacheFreshness();
    scheduleEmit(['*']);
  });

  window.addEventListener('offline', () => {
    disconnectRealtimeSync();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      invalidateAllCacheFreshness();
      scheduleEmit(['*']);
    }
  });

  // Quiet background sync poll every 25s while online & visible (catches portal / DB trigger updates)
  setInterval(() => {
    if (
      typeof document !== 'undefined' &&
      document.visibilityState === 'visible' &&
      navigator.onLine &&
      listeners.size > 0
    ) {
      invalidateAllCacheFreshness();
      scheduleEmit(['*']);
    }
  }, IDLE_POLL_INTERVAL_MS);
}

/**
 * Connects (or updates) the multiplexed real-time WebSocket channels for the current session.
 */
export function connectRealtimeSync(params: {
  tenantId: string | null;
  isSuperAdmin: boolean;
  userId: string | null;
}): () => void {
  ensureGlobalEngineInitialized();
  lastConnectParams = params;

  const { tenantId, isSuperAdmin, userId } = params;
  if (!userId) {
    disconnectRealtimeSync();
    return () => {};
  }

  // Do not open WebSocket retry loops while offline — cross-tab BroadcastChannel & local events still work!
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return () => {};
  }

  // 1. Platform channel (for Super Admin approvals, licences, join requests, and pending companies)
  if (!platformChannel) {
    platformChannel = supabase
      .channel('realtime-platform')
      .on('broadcast', { event: 'data_changed' }, ({ payload }) => {
        handleIncomingRemoteChange(String(payload?.table || 'entreprise'), payload?.sourceId);
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'entreprise' },
        () => handleIncomingRemoteChange('entreprise'),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'licences' },
        () => handleIncomingRemoteChange('licences'),
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' && getPendingCount() > 0) {
          void processQueue();
        }
      });
  }

  // 2. Tenant-scoped channel (for instant multi-user/multi-device sync within the pressing)
  const desiredKey = isSuperAdmin ? 'superadmin' : tenantId;
  if (desiredKey && desiredKey !== activeTenantKey) {
    if (activeTenantChannel) {
      void supabase.removeChannel(activeTenantChannel);
      activeTenantChannel = null;
    }
    activeTenantKey = desiredKey;

    let hadDisconnected = false;
    const chan = supabase
      .channel(`realtime-tenant:${desiredKey}`)
      .on('broadcast', { event: 'data_changed' }, ({ payload }) => {
        handleIncomingRemoteChange(String(payload?.table || '*'), payload?.sourceId);
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public' },
        (payload) => {
          const table = payload.table || '*';
          handleIncomingRemoteChange(table);
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (getPendingCount() > 0) {
            void processQueue();
          }
          if (hadDisconnected) {
            hadDisconnected = false;
            invalidateAllCacheFreshness();
            scheduleEmit(['*']);
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          hadDisconnected = true;
        }
      });

    activeTenantChannel = chan;
  }

  return () => {
    // Cleanup handled on user change or explicit disconnect
  };
}

export function disconnectRealtimeSync(): void {
  if (activeTenantChannel) {
    void supabase.removeChannel(activeTenantChannel);
    activeTenantChannel = null;
    activeTenantKey = null;
  }
  if (platformChannel) {
    void supabase.removeChannel(platformChannel);
    platformChannel = null;
  }
}
