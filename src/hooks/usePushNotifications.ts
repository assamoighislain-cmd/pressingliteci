import { useEffect, useRef } from 'react';
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

function playOrderSound() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
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

export function usePushNotifications() {
  const { tenantId, isSuperAdmin } = useAuth();
  const subscribedRef = useRef(false);

  const pushTenantId = isSuperAdmin ? 'super_admin' : tenantId;

  useEffect(() => {
    if (!pushTenantId) return;
    if (subscribedRef.current) return;

    async function subscribeToPush() {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;

        // Register a dedicated push service worker (not the self-unregistering one)
        const reg = await navigator.serviceWorker.register('/push-sw.js');
        await navigator.serviceWorker.ready;
        let subscription = await reg.pushManager.getSubscription();

        if (!subscription) {
          subscription = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
          });
        }

        const subData = subscription.toJSON();
        const { endpoint, keys } = subData as { endpoint: string; keys: { p256dh: string; auth: string } };
        if (!endpoint || !keys?.p256dh || !keys?.auth) return;

        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        if (!accessToken) return;

        await supabase.from('push_subscriptions').upsert(
          {
            endpoint,
            p256dh: keys.p256dh,
            auth: keys.auth,
            tenant_id: pushTenantId,
          },
          { onConflict: 'endpoint' },
        );

        subscribedRef.current = true;
      } catch {
        // Push subscription failed — not critical
      }
    }

    subscribeToPush();
  }, [pushTenantId]);

  // Listen for messages from service worker to play sound when push arrives
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === 'PLAY_NOTIFICATION_SOUND') {
        playOrderSound();
      }
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleMessage);
      return () => {
        navigator.serviceWorker.removeEventListener('message', handleMessage);
      };
    }
  }, []);
}
