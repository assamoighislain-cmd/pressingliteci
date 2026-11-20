import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, supabaseUrl, supabaseAnonKey } from '@/lib/supabase';
import { resetTenantCache, setCachedTenantId } from '@/lib/db';
import { saveAuthSessionForSw } from '@/lib/offlineStorage';
import { isLikelyNetworkError } from '@/lib/readCache';
import {
  readOfflineSessionBackup,
  writeOfflineSessionBackup,
  clearOfflineSessionBackup,
} from '@/lib/offlineSession';
import type { Boutique } from '@/types';

export type UserRole = 'admin' | 'gerant' | 'commercial' | 'collecteur' | null;

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  membershipLoading: boolean;
  role: UserRole;
  tenantId: string | null;
  isSuperAdmin: boolean;
  boutiques: Boutique[];
  currentBoutique: Boutique | null;
  setBoutique: (b: Boutique) => void;
  reloadBoutiques: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, entrepriseNom: string, fullName: string, contact: string) => Promise<{ error: string | null; joinRequested?: boolean }>;
  signOut: () => Promise<void>;
}

interface CachedMembership {
  role: UserRole;
  tenantId: string | null;
  isSuperAdmin: boolean;
  memberBoutiqueId: string | null;
  boutiques: Boutique[];
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const BOUTIQUE_STORAGE_KEY = 'app-current-boutique';
const MEMBERSHIP_CACHE_PREFIX = 'offline_auth_membership_';
const AUTH_BROADCAST_CHANNEL = 'pressinglite-auth';

function readCachedMembership(userId: string): CachedMembership | null {
  try {
    const raw = localStorage.getItem(`${MEMBERSHIP_CACHE_PREFIX}${userId}`);
    return raw ? (JSON.parse(raw) as CachedMembership) : null;
  } catch {
    return null;
  }
}

function writeCachedMembership(userId: string, data: CachedMembership): void {
  try {
    localStorage.setItem(`${MEMBERSHIP_CACHE_PREFIX}${userId}`, JSON.stringify(data));
  } catch {
    // Ignore
  }
}

function resolveInitialBoutiqueSelection(bsInput: Boutique[], memberBoutiqueId: string | null): {
  list: Boutique[];
  selected: Boutique | null;
} {
  if (!bsInput || bsInput.length === 0) {
    return { list: [], selected: null };
  }
  let bs = [...bsInput];
  if (memberBoutiqueId) {
    bs = bs.filter((b) => b.id === memberBoutiqueId);
    if (bs.length === 0) return { list: [], selected: null };
    return { list: bs, selected: bs[0] };
  }
  try {
    const stored = localStorage.getItem(BOUTIQUE_STORAGE_KEY);
    const found = stored ? bs.find((b) => b.id === stored) : null;
    if (found) return { list: bs, selected: found };
  } catch {
    // Ignore
  }
  const def = bs.find((b) => b.is_default) ?? bs[0];
  return { list: bs, selected: def };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Synchronous 0ms cold-boot from offline backup so the app NEVER closes or hangs offline!
  const initialBackup = typeof window !== 'undefined' ? readOfflineSessionBackup() : null;
  const initialMembership =
    initialBackup?.user?.id ? readCachedMembership(initialBackup.user.id) : null;
  const initialBoutiqueState = initialMembership
    ? resolveInitialBoutiqueSelection(initialMembership.boutiques ?? [], initialMembership.memberBoutiqueId)
    : { list: [], selected: null };

  if (initialMembership?.tenantId) {
    setCachedTenantId(initialMembership.tenantId);
  }

  const [user, setUser] = useState<User | null>(() => initialBackup?.user ?? null);
  const [session, setSession] = useState<Session | null>(() => initialBackup?.session ?? null);
  const [loading, setLoading] = useState<boolean>(() => !initialBackup);
  const [role, setRole] = useState<UserRole>(() => initialMembership?.role ?? null);
  const [tenantId, setTenantId] = useState<string | null>(() => initialMembership?.tenantId ?? null);
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean>(() => initialMembership?.isSuperAdmin ?? false);
  const [membershipLoading, setMembershipLoading] = useState<boolean>(() =>
    initialBackup ? !initialMembership : true,
  );
  const [boutiques, setBoutiques] = useState<Boutique[]>(() => initialBoutiqueState.list);
  const [currentBoutique, setCurrentBoutique] = useState<Boutique | null>(() => initialBoutiqueState.selected);

  const signingOutRef = useRef(false);
  const lastLoadedUserIdRef = useRef<string | null>(
    initialMembership && initialBackup?.user?.id ? initialBackup.user.id : null,
  );

  function applyBoutiquesList(bsInput: Boutique[], memberBoutiqueId: string | null) {
    const { list, selected } = resolveInitialBoutiqueSelection(bsInput, memberBoutiqueId);
    setBoutiques(list);
    setCurrentBoutique(selected);
    if (selected) {
      try {
        localStorage.setItem(BOUTIQUE_STORAGE_KEY, selected.id);
      } catch {
        // Ignore
      }
    }
  }

  async function loadBoutiques(tId: string, memberBoutiqueId: string | null): Promise<Boutique[]> {
    const { data, error } = await supabase
      .from('boutiques')
      .select('*')
      .eq('tenant_id', tId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });
    if (error) {
      if (isLikelyNetworkError(error)) {
        throw new Error(error.message);
      }
      setBoutiques([]);
      setCurrentBoutique(null);
      return [];
    }
    const bs = ((data as unknown as Boutique[]) ?? []);
    applyBoutiquesList(bs, memberBoutiqueId);
    return bs;
  }

  async function reloadBoutiques() {
    if (!tenantId) return;
    try {
      const bs = await loadBoutiques(tenantId, null);
      if (user?.id) {
        writeCachedMembership(user.id, {
          role,
          tenantId,
          isSuperAdmin,
          memberBoutiqueId: null,
          boutiques: bs,
        });
      }
    } catch {
      // Offline: keep existing boutiques in state
    }
  }

  function setBoutique(b: Boutique) {
    setCurrentBoutique(b);
    try {
      localStorage.setItem(BOUTIQUE_STORAGE_KEY, b.id);
    } catch {
      // Ignore
    }
  }

  function restoreCachedMembership(userId: string): boolean {
    const cached = readCachedMembership(userId);
    if (cached) {
      setRole(cached.role);
      setTenantId(cached.tenantId);
      setCachedTenantId(cached.tenantId);
      setIsSuperAdmin(cached.isSuperAdmin);
      applyBoutiquesList(cached.boutiques ?? [], cached.memberBoutiqueId);
      return true;
    }
    // Fallback if offline before membership cache was written: use stored tenant ID or user ID
    try {
      const fallbackTenant = localStorage.getItem('offline_last_tenant_id') || userId;
      if (fallbackTenant) {
        setRole('admin');
        setTenantId(fallbackTenant);
        setCachedTenantId(fallbackTenant);
        return true;
      }
    } catch {
      // Ignore
    }
    return false;
  }

  async function loadMembership(targetUser?: User | null) {
    const activeUser = targetUser !== undefined ? targetUser : user;
    if (!activeUser) {
      setRole(null);
      setTenantId(null);
      setCachedTenantId(null);
      setIsSuperAdmin(false);
      setBoutiques([]);
      setCurrentBoutique(null);
      setMembershipLoading(false);
      return;
    }

    const uid = activeUser.id;
    const hasExistingMembership = Boolean(readCachedMembership(uid));
    if (!hasExistingMembership) {
      setMembershipLoading(true);
    }

    // Offline: immediately restore cached role/tenant/boutiques so user is NEVER locked out
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      restoreCachedMembership(uid);
      setMembershipLoading(false);
      return;
    }

    try {
      const [roleRes, tenantRes, superRes] = await Promise.all([
        supabase.rpc('get_user_role'),
        supabase.rpc('get_tenant_id'),
        supabase.rpc('is_super_admin'),
      ]);

      if (
        roleRes.error ||
        tenantRes.error ||
        superRes.error
      ) {
        if (restoreCachedMembership(uid)) {
          setMembershipLoading(false);
          return;
        }
      }

      const tId = (tenantRes.data as string) ?? null;
      const r = (roleRes.data as UserRole) ?? null;
      const superFlag = Boolean(superRes.data);
      setRole(r);
      setTenantId(tId);
      setCachedTenantId(tId);
      setIsSuperAdmin(superFlag);

      let memberBoutiqueId: string | null = null;
      let loadedBoutiques: Boutique[] = [];
      if (tId) {
        if (r !== 'admin') {
          const { data: boutiqueData } = await supabase.rpc('get_member_boutique_id');
          memberBoutiqueId = (boutiqueData as string) ?? null;
        }
        loadedBoutiques = await loadBoutiques(tId, memberBoutiqueId);
      }

      writeCachedMembership(uid, {
        role: r,
        tenantId: tId,
        isSuperAdmin: superFlag,
        memberBoutiqueId,
        boutiques: loadedBoutiques,
      });
    } catch {
      if (!restoreCachedMembership(uid)) {
        setRole(null);
        setTenantId(null);
        setIsSuperAdmin(false);
        setBoutiques([]);
        setCurrentBoutique(null);
      }
    } finally {
      setMembershipLoading(false);
    }
  }

  function clearLocalAuthState() {
    lastLoadedUserIdRef.current = null;
    clearOfflineSessionBackup();
    setUser(null);
    setSession(null);
    setRole(null);
    setTenantId(null);
    setCachedTenantId(null);
    setIsSuperAdmin(false);
    setBoutiques([]);
    setCurrentBoutique(null);
    setMembershipLoading(false);
    setLoading(false);
    resetTenantCache();
    void saveAuthSessionForSw({ accessToken: null, supabaseUrl, supabaseAnonKey });
  }

  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel(AUTH_BROADCAST_CHANNEL);
        bc.onmessage = (ev) => {
          if (ev.data?.type === 'EXPLICIT_SIGN_OUT') {
            clearLocalAuthState();
          }
        };
      }
    } catch {
      // Ignore
    }

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (data.session?.user) {
          writeOfflineSessionBackup(data.session);
          setSession(data.session);
          setUser(data.session.user);
          void saveAuthSessionForSw({
            accessToken: data.session.access_token ?? null,
            supabaseUrl,
            supabaseAnonKey,
          });
        } else if (!signingOutRef.current) {
          // If GoTrue failed to refresh offline and returned null, keep our offline backup alive!
          const backup = readOfflineSessionBackup();
          if (backup) {
            setSession(backup.session);
            setUser(backup.user);
          } else {
            setSession(null);
            setUser(null);
          }
        }
        setLoading(false);
      })
      .catch(() => {
        const backup = readOfflineSessionBackup();
        if (backup && !signingOutRef.current) {
          setSession(backup.session);
          setUser(backup.user);
        }
        setLoading(false);
      });

    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (signingOutRef.current) return;

      if (newSession?.user) {
        writeOfflineSessionBackup(newSession);
        void saveAuthSessionForSw({
          accessToken: newSession.access_token ?? null,
          supabaseUrl,
          supabaseAnonKey,
        });
        if (event === 'TOKEN_REFRESHED') {
          setSession(newSession);
          return;
        }
        setSession(newSession);
        setUser(newSession.user);
        return;
      }

      // CRITICAL OFFLINE PROTECTION:
      // Never allow an involuntary SIGNED_OUT / failed background token refresh to close the app!
      // Only clear user state if the user explicitly signed out (which clears offlineSessionBackup).
      const backup = readOfflineSessionBackup();
      if (backup) {
        setSession(backup.session);
        setUser(backup.user);
        return;
      }

      setSession(null);
      setUser(null);
    });

    return () => {
      listener.subscription.unsubscribe();
      bc?.close();
    };
  }, []);

  useEffect(() => {
    const uid = user?.id ?? null;
    if (uid === lastLoadedUserIdRef.current) return;
    lastLoadedUserIdRef.current = uid;
    void loadMembership(user);
  }, [user]);

  // Refresh membership silently when coming back online
  useEffect(() => {
    const handleOnline = () => {
      if (user) {
        void loadMembership(user);
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [user]);

  async function signIn(email: string, password: string): Promise<{ error: string | null }> {
    resetTenantCache();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (data?.session?.user) {
      writeOfflineSessionBackup(data.session);
      setSession(data.session);
      setUser(data.session.user);
    }
    return { error: error?.message ?? null };
  }

  async function signUp(email: string, password: string, entrepriseNom: string, fullName: string, contact: string): Promise<{ error: string | null; joinRequested?: boolean }> {
    let gpsLat: string | null = null;
    let gpsLng: string | null = null;
    if (entrepriseNom && 'geolocation' in navigator) {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000, maximumAge: 60000 });
        });
        gpsLat = String(pos.coords.latitude);
        gpsLng = String(pos.coords.longitude);
      } catch {
        // User denied or timeout — proceed without GPS
      }
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          ...(entrepriseNom ? { entreprise_nom: entrepriseNom } : {}),
          ...(fullName ? { full_name: fullName } : {}),
          ...(contact ? { contact } : {}),
          ...(gpsLat ? { gps_latitude: gpsLat } : {}),
          ...(gpsLng ? { gps_longitude: gpsLng } : {}),
        },
      },
    });
    if (error) return { error: error.message };

    if (data.session?.user) {
      writeOfflineSessionBackup(data.session);
    }

    const newUser = data.user;
    if (!newUser) return { error: null };

    if (entrepriseNom) {
      const { data: reqData } = await supabase
        .from('join_requests')
        .select('id')
        .eq('user_id', newUser.id)
        .eq('status', 'pending')
        .maybeSingle();

      if (reqData) {
        return { error: null, joinRequested: true } as { error: string | null; joinRequested: boolean };
      }

      const { error: rpcError } = await supabase.rpc('signup_create_entreprise', {
        entreprise_nom: entrepriseNom,
      });
      if (rpcError) {
        console.warn('signup_create_entreprise RPC failed (trigger will handle it):', rpcError.message);
      }

      // Ensure 30-day Demo licence is activated right away on company creation (best-effort)
      try {
        await supabase.rpc('ensure_trial_licence');
      } catch {
        // Trigger or Super Admin approval will also guarantee the 30-day Demo licence
      }

      // Immediately dispatch audible Web Push notification to Super Admin (even when app is closed)
      try {
        const safeNom = entrepriseNom.trim();
        await supabase.functions.invoke('send-push-notification', {
          body: {
            tenant_id: 'super_admin',
            payload: {
              title: 'Nouvelle entreprise à approuver',
              body: `${safeNom} vient de s'inscrire (Licence Démo 30 jours) — en attente d'approbation`,
              icon: '/pwa-192x192.png',
              badge: '/pwa-192x192.png',
              tag: `new-entreprise-${newUser.id}`,
              renotify: true,
              requireInteraction: true,
              silent: false,
              vibrate: [300, 150, 300, 150, 400],
              actions: [{ action: 'open', title: 'Approuver' }],
              data: {
                url: '/#/super-admin',
                type: 'new_entreprise_approval',
                entreprise_nom: safeNom,
                user_id: newUser.id,
              },
            },
          },
        });
      } catch {
        // Non-blocking: DB trigger also attempts push delivery
      }
    }

    return { error: null };
  }

  async function signOut(): Promise<void> {
    signingOutRef.current = true;
    clearLocalAuthState();
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        const bc = new BroadcastChannel(AUTH_BROADCAST_CHANNEL);
        bc.postMessage({ type: 'EXPLICIT_SIGN_OUT' });
        bc.close();
      }
    } catch {
      // Ignore
    }
    try {
      if (typeof navigator === 'undefined' || navigator.onLine) {
        await supabase.auth.signOut();
      } else {
        await supabase.auth.signOut({ scope: 'local' });
      }
    } catch {
      // State already reset; ignore network errors
    } finally {
      signingOutRef.current = false;
    }
  }

  return (
    <AuthContext.Provider value={{
      user, session, loading, membershipLoading, role, tenantId, isSuperAdmin,
      boutiques, currentBoutique, setBoutique, reloadBoutiques,
      signIn, signUp, signOut
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
