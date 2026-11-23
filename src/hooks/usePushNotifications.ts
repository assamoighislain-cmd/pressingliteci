import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';

const VAPID_PUBLIC_KEY = 'BLtRBjIXLX_w0Q7YuoNv8PedYjWI5QnOSvc9lZYORgKeT3wHjIZpSn5Bvubx5et_XK4DK-52uYRmlZAAvXlixdk';

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function playOrderSound() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const notes = [659.25, 783.99, 987.77, 1318.51];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'triangle';
      const start = now + i * 0.12;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
      osc.start(start);
      osc.stop(start + 0.25);
    });
  } catch {
    // AudioContext not available
  }
}

/**
 * Distinctive two-phrase ascending bell chime for Super Admin company approval alerts.
 */
export function playApprovalSound() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    // Two energetic ascending phrases (C5-E5-G5-C6, pause, E5-G5-C6)
    const sequence: Array<{ freq: number; offset: number; duration: number; peak: number }> = [
      { freq: 523.25, offset: 0.0, duration: 0.22, peak: 0.28 },
      { freq: 659.25, offset: 0.14, duration: 0.22, peak: 0.28 },
      { freq: 783.99, offset: 0.28, duration: 0.24, peak: 0.30 },
      { freq: 1046.5, offset: 0.42, duration: 0.38, peak: 0.34 },
      { freq: 783.99, offset: 0.88, duration: 0.22, peak: 0.28 },
      { freq: 1046.5, offset: 1.04, duration: 0.48, peak: 0.36 },
    ];

    sequence.forEach(({ freq, offset, duration, peak }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      const start = now + offset;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(peak, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0008, start + duration);
      osc.start(start);
      osc.stop(start + duration + 0.04);
    });
  } catch {
    // AudioContext not available
  }
}

export interface PushNotificationStatus {
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  subscribed: boolean;
  subscribing: boolean;
  error: string | null;
  enableNotifications: () => Promise<boolean>;
  sendTestPush: (lang?: string) => Promise<{ ok: boolean; message: string }>;
}

function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

async function registerPushSubscriptionForTenant(
  pushTenantId: string,
  requestPermission: boolean,
): Promise<{ subscribed: boolean; permission: NotificationPermission; error?: string }> {
  if (!isPushSupported()) {
    return { subscribed: false, permission: 'denied', error: 'Notifications Push non supportées sur ce navigateur.' };
  }
  if (!navigator.onLine) {
    return { subscribed: false, permission: Notification.permission, error: 'Connexion Internet requise.' };
  }

  let permission = Notification.permission;
  if (permission === 'default' && requestPermission) {
    permission = await Notification.requestPermission();
  }
  if (permission !== 'granted') {
    return {
      subscribed: false,
      permission,
      error:
        permission === 'denied'
          ? 'Notifications bloquées dans les paramètres du navigateur.'
          : 'Autorisation de notification non accordée.',
    };
  }

  // IMPORTANT: Use the active Workbox PWA Service Worker (which imports bg-sync-sw.js).
  // Never register a separate SW at scope '/' or it will evict Workbox offline caching!
  const reg = await navigator.serviceWorker.ready;
  let subscription = await reg.pushManager.getSubscription();

  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const subData = subscription.toJSON();
  const { endpoint, keys } = subData as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return { subscribed: false, permission, error: 'Abonnement Push incomplet.' };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    return { subscribed: false, permission, error: 'Session expirée.' };
  }

  const { error: upsertError } = await supabase.from('push_subscriptions').upsert(
    {
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      tenant_id: pushTenantId,
    },
    { onConflict: 'endpoint' },
  );

  if (upsertError) {
    return { subscribed: false, permission, error: upsertError.message };
  }

  return { subscribed: true, permission };
}

export interface DemoLicencePushPayload {
  title: string;
  body: string;
  icon: string;
  badge: string;
  tag: string;
  renotify: boolean;
  requireInteraction: boolean;
  silent: boolean;
  vibrate: number[];
  data: {
    url: string;
    type: 'demo_licence_activated';
    entreprise_nom: string;
    date_fin: string | null;
  };
}

export function buildDemoLicencePushPayload(
  entrepriseNom: string,
  dateFinIso?: string | null,
  lang = 'fr',
): DemoLicencePushPayload {
  const safeNom = entrepriseNom.trim() || 'PressingLite';
  let formattedDate = '';
  if (dateFinIso) {
    try {
      formattedDate = new Date(dateFinIso).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });
    } catch {
      formattedDate = dateFinIso;
    }
  }

  const title =
    lang === 'fr'
      ? 'Licence Démo 30 jours activée !'
      : '30-Day Demo License Activated!';
  const body =
    lang === 'fr'
      ? `Bienvenue ${safeNom} ! Votre nouvelle entreprise bénéficie automatiquement d'une licence Démo gratuite de 30 jours${formattedDate ? ` (valable jusqu'au ${formattedDate})` : ''}.`
      : `Welcome ${safeNom}! Your new company automatically benefits from a free 30-day Demo license${formattedDate ? ` (valid until ${formattedDate})` : ''}.`;

  return {
    title,
    body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: `demo-licence-30d-${safeNom.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32)}`,
    renotify: true,
    requireInteraction: true,
    silent: false,
    vibrate: [250, 120, 250, 120, 350],
    data: {
      url: '/',
      type: 'demo_licence_activated',
      entreprise_nom: safeNom,
      date_fin: dateFinIso ?? null,
    },
  };
}

/**
 * Notifies a newly created company by Push notification that its 30-day Demo licence is active.
 * - Always dispatches server Web Push via Edge Function for all subscribed devices of `tenantId`.
 * - Optionally displays an immediate local Service Worker / Browser Push notification in the current session.
 */
export async function notifyCompanyDemoLicencePush(params: {
  tenantId: string;
  entrepriseNom: string;
  dateFin?: string | null;
  lang?: string;
  requestPermissionIfDefault?: boolean;
  showLocalNotification?: boolean;
}): Promise<{ webPushSent: boolean; localShown: boolean }> {
  const {
    tenantId,
    entrepriseNom,
    dateFin = null,
    lang = 'fr',
    requestPermissionIfDefault = false,
    showLocalNotification = false,
  } = params;

  const payload = buildDemoLicencePushPayload(entrepriseNom, dateFin, lang);
  let webPushSent = false;
  let localShown = false;

  // 1. If in the company's own browser, try to register push subscription first when permission is granted/requested
  if (showLocalNotification && isPushSupported()) {
    try {
      const subResult = await registerPushSubscriptionForTenant(tenantId, requestPermissionIfDefault);
      if (subResult.permission === 'granted') {
        try {
          const reg = await Promise.race([
            navigator.serviceWorker.ready,
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
          ]);
          if (reg && 'showNotification' in reg) {
            await reg.showNotification(payload.title, {
              body: payload.body,
              icon: payload.icon,
              badge: payload.badge,
              tag: payload.tag,
              requireInteraction: payload.requireInteraction,
              silent: false,
              data: payload.data,
            });
            localShown = true;
          } else if (typeof Notification !== 'undefined') {
            new Notification(payload.title, {
              body: payload.body,
              icon: payload.icon,
              tag: payload.tag,
            });
            localShown = true;
          }
          if (localShown) {
            playApprovalSound();
          }
        } catch {
          // Fallback silently to in-app push toast
        }
      }
    } catch {
      // Non-blocking
    }
  }

  // 2. Dispatch server Web Push via Edge Function (reaches all subscribed devices, even when closed)
  if (typeof navigator === 'undefined' || navigator.onLine) {
    try {
      const { error } = await supabase.functions.invoke('send-push-notification', {
        body: {
          tenant_id: tenantId,
          payload,
        },
      });
      if (!error) webPushSent = true;
    } catch {
      // Non-blocking: DB trigger also dispatches push
    }
  }

  return { webPushSent, localShown };
}

export function usePushNotifications(): PushNotificationStatus {
  const { tenantId, isSuperAdmin } = useAuth();
  const pushTenantId = isSuperAdmin ? 'super_admin' : tenantId;

  const supported = isPushSupported();
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    supported ? Notification.permission : 'unsupported',
  );
  const [subscribed, setSubscribed] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subscribedTenantRef = useRef<string | null>(null);

  const syncSubscription = useCallback(
    async (requestPermission: boolean): Promise<boolean> => {
      if (!pushTenantId || !supported) return false;
      setSubscribing(true);
      setError(null);
      try {
        const result = await registerPushSubscriptionForTenant(pushTenantId, requestPermission);
        setPermission(result.permission);
        setSubscribed(result.subscribed);
        if (result.subscribed) {
          subscribedTenantRef.current = pushTenantId;
        }
        if (result.error && requestPermission) {
          setError(result.error);
        }
        return result.subscribed;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erreur abonnement Push';
        if (requestPermission) setError(msg);
        return false;
      } finally {
        setSubscribing(false);
      }
    },
    [pushTenantId, supported],
  );

  useEffect(() => {
    if (!pushTenantId || !supported) {
      setSubscribed(false);
      subscribedTenantRef.current = null;
      return;
    }

    // Attempt automatic subscription on login/mount (if already granted, refreshes silently; if default, tries once)
    const runSync = async () => {
      if (subscribedTenantRef.current === pushTenantId) return;
      await syncSubscription(Notification.permission === 'default');
    };

    void runSync();

    const handleOnline = () => {
      if (subscribedTenantRef.current !== pushTenantId) {
        void syncSubscription(false);
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [pushTenantId, supported, syncSubscription]);

  // Listen for messages from service worker to play sound when push arrives while app is open
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === 'PLAY_NOTIFICATION_SOUND') {
        if (
          event.data?.soundType === 'new_entreprise_approval' ||
          event.data?.soundType === 'demo_licence_activated'
        ) {
          playApprovalSound();
        } else {
          playOrderSound();
        }
      }
    }

    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleMessage);
      return () => {
        navigator.serviceWorker.removeEventListener('message', handleMessage);
      };
    }
  }, []);

  const enableNotifications = useCallback(async (): Promise<boolean> => {
    const ok = await syncSubscription(true);
    if (ok) {
      playApprovalSound();
    }
    return ok;
  }, [syncSubscription]);

  const sendTestPush = useCallback(
    async (lang = 'fr'): Promise<{ ok: boolean; message: string }> => {
      if (!pushTenantId) {
        return {
          ok: false,
          message: lang === 'fr' ? 'Compte non connecté.' : 'Account not signed in.',
        };
      }
      playApprovalSound();
      if (!subscribed) {
        const enabled = await syncSubscription(true);
        if (!enabled) {
          return {
            ok: false,
            message:
              lang === 'fr'
                ? 'Activez d’abord l’autorisation des notifications dans le navigateur.'
                : 'Please allow browser notifications first.',
          };
        }
      }

      try {
        const { data, error: fnError } = await supabase.functions.invoke('send-push-notification', {
          body: {
            tenant_id: pushTenantId,
            payload: {
              title: lang === 'fr' ? 'Test alerte approbation PressingLite' : 'PressingLite approval alert test',
              body:
                lang === 'fr'
                  ? 'Les notifications sonores en arrière-plan (même appli fermée) sont bien actives !'
                  : 'Background sound notifications (even when closed) are active!',
              icon: '/pwa-192x192.png',
              badge: '/pwa-192x192.png',
              tag: `test-push-${Date.now()}`,
              renotify: true,
              requireInteraction: false,
              silent: false,
              vibrate: [300, 150, 300],
              data: {
                url: '/#/super-admin',
                type: 'new_entreprise_approval',
              },
            },
          },
        });
        if (fnError) {
          return { ok: false, message: fnError.message };
        }
        const sentCount = (data as { sent?: number } | null)?.sent ?? 0;
        return {
          ok: true,
          message:
            lang === 'fr'
              ? `Notification sonore & Push envoyée (${sentCount} appareil${sentCount > 1 ? 's' : ''}).`
              : `Sound & Push notification sent (${sentCount} device${sentCount > 1 ? 's' : ''}).`,
        };
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : (lang === 'fr' ? 'Échec de l’envoi Push' : 'Push send failed'),
        };
      }
    },
    [pushTenantId, subscribed, syncSubscription],
  );

  return {
    supported,
    permission,
    subscribed,
    subscribing,
    error,
    enableNotifications,
    sendTestPush,
  };
}
