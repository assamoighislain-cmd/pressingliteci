/* Service Worker Background Sync extension for PressingLite.
 * Imported by VitePWA / Workbox via workbox.importScripts.
 * Replays queued mutations from IndexedDB when no foreground tab is open,
 * or notifies open tabs via BroadcastChannel to run a coordinated sync.
 */

const DB_NAME = 'pressinglite_offline_db';
const DB_VERSION = 1;
const MUTATIONS_STORE = 'mutations';
const META_STORE = 'meta';
const SYNC_TAG = 'pressinglite-sync-queue';
const PERIODIC_SYNC_TAG = 'pressinglite-periodic-sync';
const LOCK_NAME = 'pressinglite-sync-lock';

function openOfflineDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MUTATIONS_STORE)) {
        db.createObjectStore(MUTATIONS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('read_cache')) {
        db.createObjectStore('read_cache', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function idbDelete(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbPut(db, storeName, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function notifyTabs(payload) {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel('pressinglite-sync');
      bc.postMessage(payload);
      bc.close();
    }
  } catch {
    // Ignore BroadcastChannel errors
  }
}

function buildFilterQuery(filters) {
  if (!Array.isArray(filters) || filters.length === 0) return '';
  const params = new URLSearchParams();
  for (const f of filters) {
    if (!f || !f.column || !f.operator) continue;
    params.append(String(f.column), `${f.operator}.${String(f.value)}`);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

async function replayMutationRest(m, authMeta) {
  const { supabaseUrl, supabaseAnonKey, accessToken } = authMeta;
  if (!supabaseUrl || !supabaseAnonKey || !accessToken) {
    return { ok: false, transient: true, error: 'Missing auth token in SW' };
  }

  const headers = {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };

  try {
    let url = `${supabaseUrl}/rest/v1/${encodeURIComponent(m.table)}`;
    let method = 'POST';
    let body = JSON.stringify(m.data || {});

    if (m.operation === 'rpc') {
      url = `${supabaseUrl}/rest/v1/rpc/${encodeURIComponent(m.table)}`;
      method = 'POST';
      body = JSON.stringify(m.data || {});
    } else if (m.operation === 'insert') {
      method = 'POST';
    } else if (m.operation === 'upsert') {
      method = 'POST';
      headers.Prefer = 'resolution=merge-duplicates,return=minimal';
    } else if (m.operation === 'update') {
      url += buildFilterQuery(m.filters);
      method = 'PATCH';
    } else if (m.operation === 'delete') {
      url += buildFilterQuery(m.filters);
      method = 'DELETE';
      body = undefined;
    }

    const res = await fetch(url, { method, headers, body });
    if (res.ok) return { ok: true, transient: false };

    const text = await res.text().catch(() => `HTTP ${res.status}`);
    // 401 (expired token), 408, 429, 5xx -> transient so foreground tab refreshes token & retries
    const transient = res.status === 401 || res.status === 408 || res.status === 429 || res.status >= 500;
    // Duplicate key needs foreground RPC code regeneration -> leave for foreground or next sync
    if (text.includes('duplicate key') || res.status === 409) {
      return { ok: false, transient: true, error: text };
    }
    return { ok: false, transient, error: text };
  } catch (err) {
    return { ok: false, transient: true, error: err && err.message ? err.message : 'Network error' };
  }
}

async function runSwQueueSync() {
  // If any window client is open, ask it to sync (it has fresh JWT auto-refresh and optimistic cache hooks)
  const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (windowClients && windowClients.length > 0) {
    notifyTabs({ type: 'SW_TRIGGER_SYNC' });
    return;
  }

  const work = async () => {
    const db = await openOfflineDb();
    const authRecord = await idbGet(db, META_STORE, 'auth_session');
    if (!authRecord || !authRecord.value) return;

    const all = await idbGetAll(db, MUTATIONS_STORE);
    if (!all.length) return;

    all.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

    let syncedAny = false;
    for (const m of all) {
      if (m.status === 'failed' && (m.retries || 0) >= 8) continue;
      const res = await replayMutationRest(m, authRecord.value);
      if (res.ok) {
        await idbDelete(db, MUTATIONS_STORE, m.id);
        syncedAny = true;
      } else if (res.transient) {
        // Stop FIFO queue on transient/token error so dependent child rows stay ordered
        break;
      } else {
        const retries = (m.retries || 0) + 1;
        await idbPut(db, MUTATIONS_STORE, {
          ...m,
          retries,
          status: retries >= 5 ? 'failed' : 'pending',
          lastError: res.error || 'Sync failed',
        });
      }
    }

    if (syncedAny) {
      await idbPut(db, META_STORE, { key: 'last_sync_at', value: new Date().toISOString() });
      notifyTabs({ type: 'SW_SYNC_COMPLETED' });
    }
  };

  if (self.navigator && self.navigator.locks && self.navigator.locks.request) {
    await self.navigator.locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
      if (!lock) return;
      await work();
    });
  } else {
    await work();
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(runSwQueueSync());
  }
});

self.addEventListener('periodicsync', (event) => {
  if (event.tag === PERIODIC_SYNC_TAG) {
    event.waitUntil(runSwQueueSync());
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'TRIGGER_BG_SYNC') {
    event.waitUntil(runSwQueueSync());
  }
});
