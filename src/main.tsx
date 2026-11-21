import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { AuthProvider } from './lib/auth';
import { I18nProvider } from './lib/i18n';
import ErrorBoundary from './components/ErrorBoundary';
import { isLikelyNetworkError, hydrateReadCacheFromIdb } from './lib/readCache';
import { initPwaAutoUpdate } from './lib/pwaAutoUpdate';

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

// Google Maps Platform quota & auth failure detection (Tier 1)
(window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
  window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
};
const origConsoleError = console.error;
console.error = (...args: unknown[]) => {
  origConsoleError.apply(console, args);
  const msg = args.map((a) => String(a)).join(' ');
  if (msg.includes('OverQuotaMapError') || msg.includes('QuotaExceededError')) {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
};

// Register unified Workbox PWA Service Worker with automatic Vercel deployment updates
void initPwaAutoUpdate();

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
