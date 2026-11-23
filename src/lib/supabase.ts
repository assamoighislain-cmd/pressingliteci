import { createClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = 'https://jijjtwmobfzkwzkozjyb.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imppamp0d21vYmZ6a3d6a296anliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MzI5MzUsImV4cCI6MjEwMzAwODkzNX0.uPb8rJXJVtEohNggAcwINsiB3VKLO8OKNNM4rX2UO7s';

function stripQuotes(value?: string): string {
  if (!value) return '';
  return value.trim().replace(/^['"]+|['"]+$/g, '').trim();
}

function isValidSupabaseApiKey(key: string): boolean {
  if (!key || key === 'your-supabase-anon-key' || key.startsWith('MY_')) return false;
  if (/^https?:\/\//i.test(key)) return false;
  // Legacy JWT anon key (3 dot-separated base64url segments starting with eyJ)
  if (key.startsWith('eyJ') && key.split('.').length === 3 && key.length > 40) {
    return true;
  }
  // New Supabase publishable key format
  if (key.startsWith('sb_publishable_') && key.length > 20) {
    return true;
  }
  return false;
}

const envUrl = stripQuotes(import.meta.env.VITE_SUPABASE_URL);
const envAnonKey = stripQuotes(import.meta.env.VITE_SUPABASE_ANON_KEY);

export const supabaseUrl =
  envUrl && /^https?:\/\//i.test(envUrl) && !envUrl.includes('your-project.supabase.co')
    ? envUrl.replace(/\/+$/, '')
    : DEFAULT_SUPABASE_URL;

export const supabaseAnonKey = isValidSupabaseApiKey(envAnonKey)
  ? envAnonKey
  : DEFAULT_SUPABASE_ANON_KEY;

/**
 * Offline-resilient fetch wrapper for Supabase:
 * 1. Fails in 0ms when navigator.onLine === false so offline reads/writes never hang on OS socket timeouts.
 * 2. Protects GoTrue token refresh (/auth/v1/token?grant_type=refresh_token) against captive portals
 *    (e.g. mobile data exhausted returning HTML) and transient 5xx/timeout errors so Supabase Auth
 *    NEVER deletes the user's session or closes the app while offline.
 */
const offlineSafeFetch: typeof fetch = async (input, init) => {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new TypeError('Failed to fetch (offline)');
  }

  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

  const isRefreshTokenCall =
    url.includes('/auth/v1/token') && url.includes('grant_type=refresh_token');

  if (isRefreshTokenCall) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(input, {
        ...init,
        signal: init?.signal ?? controller.signal,
      });
      const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
      // If a captive portal returns HTML or a gateway returns 5xx/408/429, treat as network failure
      // so GoTrue does NOT revoke the stored session!
      if (!contentType.includes('application/json') || res.status >= 500 || res.status === 408 || res.status === 429) {
        throw new TypeError('Failed to fetch (transient auth network error)');
      }
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  return fetch(input, init);
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: typeof navigator === 'undefined' ? true : navigator.onLine,
    detectSessionInUrl: true,
  },
  global: {
    fetch: offlineSafeFetch,
  },
});

if (typeof window !== 'undefined') {
  if (!navigator.onLine) {
    void supabase.auth.stopAutoRefresh();
  }
  window.addEventListener('offline', () => {
    void supabase.auth.stopAutoRefresh();
  });
  window.addEventListener('online', () => {
    void supabase.auth.startAutoRefresh();
  });
}
