import { useEffect, useRef } from 'react';
import { subscribeRealtimeChanges } from '@/lib/realtimeSync';

/**
 * Subscribes a component to silent real-time background data updates.
 * Never sets loading=true, so forms, scroll position, and user typing remain completely undisturbed.
 */
export function useRealtimeSync(
  tables: string[],
  onSilentRefresh: () => void | Promise<void>,
): void {
  const callbackRef = useRef(onSilentRefresh);
  callbackRef.current = onSilentRefresh;

  const tablesKey = tables.join(',');

  useEffect(() => {
    const watchSet = new Set(tablesKey.split(',').filter(Boolean));
    const watchAll = watchSet.has('*');

    const unsub = subscribeRealtimeChanges((changedTables) => {
      if (watchAll || changedTables.has('*')) {
        void callbackRef.current();
        return;
      }
      for (const t of changedTables) {
        if (watchSet.has(t)) {
          void callbackRef.current();
          return;
        }
      }
    });

    return unsub;
  }, [tablesKey]);
}
