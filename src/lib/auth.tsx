import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, supabaseUrl, supabaseAnonKey } from '@/lib/supabase';
import { resetTenantCache, setCachedTenantId } from '@/lib/db';
import { saveAuthSessionForSw } from '@/lib/offlineStorage';
import { isLikelyNetworkError } from '@/lib/readCache';
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<UserRole>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [membershipLoading, setMembershipLoading] = useState(true);
  const [boutiques, setBoutiques] = useState<Boutique[]>([]);
  const [currentBoutique, setCurrentBoutique] = useState<Boutique | null>(null);
  const signingOutRef = useRef(false);
  const lastLoadedUserIdRef = useRef<string | null>(null);

  function applyBoutiquesList(bsInput: Boutique[], memberBoutiqueId: string | null) {
    if (!bsInput || bsInput.length === 0) {
      setBoutiques([]);
      setCurrentBoutique(null);
      return;
    }
    let bs = [...bsInput];
    if (memberBoutiqueId) {
      bs = bs.filter((b) => b.id === memberBoutiqueId);
      if (bs.length === 0) {
        setBoutiques([]);
        setCurrentBoutique(null);
        return;
      }
      setBoutiques(bs);
      setCurrentBoutique(bs[0]);
      localStorage.setItem(BOUTIQUE_STORAGE_KEY, bs[0].id);
      return;
    }

    setBoutiques(bs);
    const stored = localStorage.getItem(BOUTIQUE_STORAGE_KEY);
    const found = stored ? bs.find((b) => b.id === stored) : null;
    if (found) {
      setCurrentBoutique(found);
    } else {
      const def = bs.find((b) => b.is_default) ?? bs[0];
      setCurrentBoutique(def);
      localStorage.setItem(BOUTIQUE_STORAGE_KEY, def.id);
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
    localStorage.setItem(BOUTIQUE_STORAGE_KEY, b.id);
  }

  function restoreCachedMembership(userId: string): boolean {
    const cached = readCachedMembership(userId);
    if (!cached) return false;
    setRole(cached.role);
    setTenantId(cached.tenantId);
    setCachedTenantId(cached.tenantId);
    setIsSuperAdmin(cached.isSuperAdmin);
    applyBoutiquesList(cached.boutiques ?? [], cached.memberBoutiqueId);
    return true;
  }

  async function loadMembership() {
    if (!session?.user) {
      setRole(null);
      setTenantId(null);
      setCachedTenantId(null);
      setIsSuperAdmin(false);
      setBoutiques([]);
      setCurrentBoutique(null);
      setMembershipLoading(false);
      return;
    }

    const uid = session.user.id;
    setMembershipLoading(true);

    // Offline cold-boot: immediately restore cached role/tenant/boutiques so user is never locked out!
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
        isLikelyNetworkError(roleRes.error) ||
        isLikelyNetworkError(tenantRes.error) ||
        isLikelyNetworkError(superRes.error)
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      void saveAuthSessionForSw({
        accessToken: data.session?.access_token ?? null,
        supabaseUrl,
        supabaseAnonKey,
      });
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (signingOutRef.current) return;
      void saveAuthSessionForSw({
        accessToken: newSession?.access_token ?? null,
        supabaseUrl,
        supabaseAnonKey,
      });
      if (event === 'TOKEN_REFRESHED') {
        setSession(newSession);
        return;
      }
      setSession(newSession);
      setUser(newSession?.user ?? null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const uid = user?.id ?? null;
    if (uid === lastLoadedUserIdRef.current) return;
    lastLoadedUserIdRef.current = uid;
    void loadMembership();
  }, [user]);

  // Refresh membership silently when coming back online if tenantId was missing
  useEffect(() => {
    const handleOnline = () => {
      if (user && !tenantId && !isSuperAdmin) {
        void loadMembership();
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [user, tenantId, isSuperAdmin]);

  async function signIn(email: string, password: string): Promise<{ error: string | null }> {
    resetTenantCache();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
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
    }

    return { error: null };
  }

  async function signOut(): Promise<void> {
    signingOutRef.current = true;
    lastLoadedUserIdRef.current = null;
    setUser(null);
    setSession(null);
    setRole(null);
    setTenantId(null);
    setCachedTenantId(null);
    setIsSuperAdmin(false);
    setBoutiques([]);
    setCurrentBoutique(null);
    setMembershipLoading(false);
    resetTenantCache();
    void saveAuthSessionForSw({ accessToken: null, supabaseUrl, supabaseAnonKey });
    try {
      await supabase.auth.signOut();
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
