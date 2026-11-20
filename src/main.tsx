import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';
import { AuthProvider } from './lib/auth';
import { I18nProvider } from './lib/i18n';
import ErrorBoundary from './components/ErrorBoundary';
import { isLikelyNetworkError, hydrateReadCacheFromIdb } from './lib/readCache';

// Hydrate IndexedDB offline read cache into RAM immediately at T=0ms
void hydrateReadCacheFromIdb();

// Ask browser for persistent storage so IndexedDB/localStorage are never auto-evicted
if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.persist === 'function') {
  navigator.storage.persist().catch(() => {});
}

// Prevent stray offline fetch/WebSocket promise rejections from terminating mobile standalone PWAs
window.addEventListener('unhandledrejection', (event) => {
  if (isLikelyNetworkError(event.reason)) {
    event.preventDefault();
  }
});

// Clean up any legacy /push-sw.js registration that previously hijacked root scope '/',
// then register the unified Workbox PWA Service Worker immediately for full offline support.
async function initPwaServiceWorker() {
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

  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (registration) {
        setInterval(() => {
          if (navigator.onLine) {
            registration.update().catch(() => {});
          }
        }, 60 * 60 * 1000);
      }
    },
  });
}

void initPwaServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </I18nProvider>
    </ErrorBoundary>
  </StrictMode>,
);
