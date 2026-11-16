import { useEffect, useState, useCallback } from 'react';
import {
  processQueue,
  subscribeSyncState,
  removeFromQueue,
  retryQueuedMutation,
  retryAllFailedMutations,
  type QueuedMutation,
  type SyncStateSnapshot,
} from '@/lib/offlineQueue';

export interface OfflineStatus extends SyncStateSnapshot {
  sync: () => Promise<void>;
  removeMutation: (id: string) => void;
  retryMutation: (id: string) => void;
  retryAllFailed: () => void;
}

export type { QueuedMutation };

export function useOfflineStatus(): OfflineStatus {
  const [snapshot, setSnapshot] = useState<SyncStateSnapshot>(() => ({
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    isSyncing: false,
    pendingCount: 0,
    failedCount: 0,
    totalQueueCount: 0,
    syncedInBatch: 0,
    totalInBatch: 0,
    lastSyncAt: null,
    mutations: [],
  }));

  useEffect(() => {
    const unsub = subscribeSyncState((next) => {
      setSnapshot(next);
    });
    return unsub;
  }, []);

  const sync = useCallback(async () => {
    await processQueue();
  }, []);

  const removeMutation = useCallback((id: string) => {
    removeFromQueue(id);
  }, []);

  const retryMutation = useCallback((id: string) => {
    retryQueuedMutation(id);
  }, []);

  const retryAllFailed = useCallback(() => {
    retryAllFailedMutations();
  }, []);

  return {
    ...snapshot,
    sync,
    removeMutation,
    retryMutation,
    retryAllFailed,
  };
}
