import { registerSW } from 'virtual:pwa-register';

export type PwaUpdateStatus =
  | { status: 'idle' }
  | { status: 'updating'; buildId?: string }
  | { status: 'pending'; buildId?: string };

const UPDATE_EVENT = 'pressinglite:pwa-update-status';
const LAST_RELOAD_BUILD_KEY = 'pressinglite_last_auto_reload_build';
const LAST_RELOAD_AT_KEY = 'pressinglite_last_auto_reload_at';
const RELOAD_COOLDOWN_MS = 20_000;
const CHECK_THROTTLE_MS = 15_000;
const POLL_INTERVAL_MS = 2 * 60 * 1000;

let swRegistration: ServiceWorkerRegistration | null = null;
let reloadInProgress = false;
let pendingBuildId: string | null = null;
let lastCheckAt = 0;
let initialized = false;

function dispatchStatus(detail: PwaUpdateStatus) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<PwaUpdateStatus>(UPDATE_EVENT, { detail }));
}

function isUserTypingInForm(): boolean {
  if (typeof document === 'undefined') return false;
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  const tag = active.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    const input = active as HTMLInputElement;
    if (input.type !== 'button' && input.type !== 'submit' && input.type !== 'checkbox') {
      return true;
    }
  }
  return Boolean(active.isContentEditable);
}

function canAutoReload(targetBuildId?: string | null): boolean {
  if (reloadInProgress) return false;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  try {
    const lastAt = Number(sessionStorage.getItem(LAST_RELOAD_AT_KEY) || '0');
    if (Date.now() - lastAt < RELOAD_COOLDOWN_MS) return false;
    if (targetBuildId) {
      const lastBuild = sessionStorage.getItem(LAST_RELOAD_BUILD_KEY);
      if (lastBuild === targetBuildId) return false;
    }
  } catch {
    // Ignore sessionStorage errors
  }
  return true;
}

function markReloaded(targetBuildId?: string | null) {
  try {
    sessionStorage.setItem(LAST_RELOAD_AT_KEY, String(Date.now()));
    if (targetBuildId) {
      sessionStorage.setItem(LAST_RELOAD_BUILD_KEY, targetBuildId);
    }
  } catch {
    // Ignore sessionStorage errors
  }
}

async function clearStaleAssetCachesOnly(): Promise<void> {
  // Only clears HTTP/Workbox static asset caches — NEVER touches IndexedDB or localStorage
  // so offline client lists, deposits, auth sessions, and sync queues remain 100% intact.
  if (typeof caches === 'undefined') return;
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.includes('workbox') || k.includes('app-same-origin-runtime-cache'))
        .map((k) => caches.delete(k)),
    );
  } catch {
    // Non-blocking
  }
}

export async function applyPendingPwaUpdateNow(clearCaches = false): Promise<void> {
  if (reloadInProgress) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  reloadInProgress = true;
  const targetBuild = pendingBuildId;
  markReloaded(targetBuild);
  dispatchStatus({ status: 'updating', buildId: targetBuild ?? undefined });

  try {
    if (swRegistration?.waiting) {
      swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    if (clearCaches) {
      await clearStaleAssetCachesOnly();
    }
  } catch {
    // Continue to reload
  }

  setTimeout(() => {
    window.location.reload();
  }, 550);
}

function triggerUpdateIfReady(targetBuildId?: string | null, clearCaches = false) {
  if (!canAutoReload(targetBuildId)) return;
  pendingBuildId = targetBuildId ?? pendingBuildId;

  // If the user is actively typing in a form field, show a clean update banner
  // instead of abruptly clearing their unsaved input; otherwise auto-apply seamlessly.
  if (isUserTypingInForm()) {
    dispatchStatus({ status: 'pending', buildId: pendingBuildId ?? undefined });
    return;
  }

  void applyPendingPwaUpdateNow(clearCaches);
}

async function fetchRemoteBuildId(): Promise<string | null> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return null;
    const json = (await res.json()) as { buildId?: unknown };
    return typeof json?.buildId === 'string' && json.buildId.length > 0 ? json.buildId : null;
  } catch {
    return null;
  }
}

export async function checkForAppUpdate(force = false): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  if (reloadInProgress) return;

  const now = Date.now();
  if (!force && now - lastCheckAt < CHECK_THROTTLE_MS) return;
  lastCheckAt = now;

  // 1. Ask the browser to check Vercel for a newer Service Worker
  if (swRegistration) {
    try {
      await swRegistration.update();
      if (swRegistration.waiting) {
        swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    } catch {
      // Non-blocking
    }
  }

  // 2. Compare running bundle buildId against fresh /version.json from Vercel
  const currentBuild = typeof __APP_BUILD_ID__ === 'string' ? __APP_BUILD_ID__ : '';
  if (!currentBuild) return;

  const remoteBuild = await fetchRemoteBuildId();
  if (!remoteBuild || remoteBuild === currentBuild) return;

  pendingBuildId = remoteBuild;

  // Give the newly fetched Service Worker ~1.5s to take control via controllerchange;
  // if the browser (e.g. iOS Safari standalone PWA) kept the old SW cache, clear static
  // asset caches and reload cleanly once for this buildId.
  setTimeout(() => {
    if (!reloadInProgress) {
      triggerUpdateIfReady(remoteBuild, true);
    }
  }, 1500);
}

export async function initPwaAutoUpdate(): Promise<void> {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  // Clean up any legacy /push-sw.js registration that previously hijacked root scope '/'
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        const scriptUrl =
          reg.active?.scriptURL || reg.waiting?.scriptURL || reg.installing?.scriptURL || '';
        if (scriptUrl.endsWith('/push-sw.js')) {
          await reg.unregister();
        }
      }
    }
  } catch {
    // Ignore cleanup errors
  }

  // Track whether this page already had an active SW before registering,
  // so the very first install doesn't cause an unnecessary reload,
  // while every subsequent Vercel deploy reloads installed PWAs automatically.
  const hadController = Boolean('serviceWorker' in navigator && navigator.serviceWorker.controller);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      triggerUpdateIfReady(pendingBuildId ?? 'sw-controller-update', false);
    });
  }

  // Recover automatically when an installed PWA requests an outdated lazy JS chunk
  // that was replaced by a newer Vercel deployment.
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    if (canAutoReload('preload-error')) {
      void applyPendingPwaUpdateNow(true);
    }
  });

  registerSW({
    immediate: true,
    onNeedRefresh() {
      if (swRegistration?.waiting) {
        swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      triggerUpdateIfReady(pendingBuildId ?? 'sw-need-refresh', false);
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      swRegistration = registration;

      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            installing.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });

      void checkForAppUpdate(true);
    },
  });

  // Check for Vercel updates whenever the installed PWA comes back to foreground,
  // regains focus, reconnects to the internet, or periodically every 2 minutes.
  const onWake = () => {
    if (pendingBuildId && !isUserTypingInForm()) {
      triggerUpdateIfReady(pendingBuildId, true);
      return;
    }
    void checkForAppUpdate(false);
  };

  window.addEventListener('online', () => void checkForAppUpdate(true));
  window.addEventListener('focus', onWake);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      onWake();
    }
  });
  setInterval(() => void checkForAppUpdate(false), POLL_INTERVAL_MS);

  // Initial version check even if SW registration was delayed or unavailable
  setTimeout(() => void checkForAppUpdate(true), 1200);
}
