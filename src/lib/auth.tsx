import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, supabaseUrl, supabaseAnonKey } from '@/lib/supabase';
import { resetTenantCache, setCachedTenantId, setCurrentBoutiqueId } from '@/lib/db';
import { saveAuthSessionForSw, getMetaValue, setMetaValue } from '@/lib/offlineStorage';
import { isLikelyNetworkError } from '@/lib/readCache';
import {
  readOfflineSessionBackup,
  writeOfflineSessionBackup,
  clearOfflineSessionBackup,
} from '@/lib/offlineSession';
import {
  setCompanyDepotStartSeq,
  setDepotStartSeq,
  syncBoutiqueDepotStartSeqs,
  hydrateBoutiquesWithGeo,
  hydrateBoutiquesWithReceiptHeader,
} from '@/lib/dbOfflineHelpers';
import type { Boutique } from '@/types';
import { notifyCompanyDemoLicencePush } from '@/hooks/usePushNotifications';

export type UserRole = 'admin' | 'gerant' | 'commercial' | 'collecteur' | 'comptable' | 'associe' | null;

export function isMultiBoutiqueRole(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'comptable' || role === 'associe';
}

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
  refreshMembership: () => Promise<void>;
  requestJoinEntreprise: (entrepriseNom: string, fullName?: string, contact?: string, requestedRole?: string) => Promise<{ error: string | null; status?: 'pending' | 'already_member'; entrepriseNom?: string; needsAdminInvite?: boolean }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, entrepriseNom: string, fullName: string, contact: string, depotStartNumber?: number | null, joiningExistingTeam?: boolean) => Promise<{ error: string | null; joinRequested?: boolean; alreadyRegistered?: boolean; alreadyRegisteredSignedIn?: boolean; needsAdminInvite?: boolean }>;
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
  void setMetaValue(`${MEMBERSHIP_CACHE_PREFIX}${userId}`, data);
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
    ? resolveInitialBoutiqueSelection(
        hydrateBoutiquesWithReceiptHeader(hydrateBoutiquesWithGeo(initialMembership.boutiques ?? [])),
        initialMembership.memberBoutiqueId,
      )
    : { list: [], selected: null };

  if (initialMembership?.tenantId) {
    setCachedTenantId(initialMembership.tenantId);
  }
  if (initialBoutiqueState.selected?.id) {
    setCurrentBoutiqueId(initialBoutiqueState.selected.id);
  } else if (typeof window !== 'undefined' && !initialMembership) {
    try {
      const storedBoutiqueId = localStorage.getItem(BOUTIQUE_STORAGE_KEY);
      if (storedBoutiqueId) setCurrentBoutiqueId(storedBoutiqueId);
    } catch {
      // Ignore
    }
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
    syncBoutiqueDepotStartSeqs(bsInput);
    const hydrated = hydrateBoutiquesWithReceiptHeader(hydrateBoutiquesWithGeo(bsInput));
    const { list, selected } = resolveInitialBoutiqueSelection(hydrated, memberBoutiqueId);
    setBoutiques(list);
    setCurrentBoutique(selected);
    setCurrentBoutiqueId(selected?.id ?? null);
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
    const bs = hydrateBoutiquesWithReceiptHeader(hydrateBoutiquesWithGeo((data as unknown as Boutique[]) ?? []));
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
    setCurrentBoutiqueId(b.id);
    try {
      localStorage.setItem(BOUTIQUE_STORAGE_KEY, b.id);
    } catch {
      // Ignore
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('pressinglite:boutique-changed', { detail: b.id }));
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
    // Also attempt asynchronous restore from IndexedDB META_STORE in case localStorage was cleared
    void getMetaValue<CachedMembership>(`${MEMBERSHIP_CACHE_PREFIX}${userId}`).then((idbCached) => {
      if (!idbCached) return;
      try {
        localStorage.setItem(`${MEMBERSHIP_CACHE_PREFIX}${userId}`, JSON.stringify(idbCached));
      } catch {
        // Ignore
      }
      setRole(idbCached.role);
      setTenantId(idbCached.tenantId);
      setCachedTenantId(idbCached.tenantId);
      setIsSuperAdmin(idbCached.isSuperAdmin);
      applyBoutiquesList(idbCached.boutiques ?? [], idbCached.memberBoutiqueId);
    });
    // Fallback if offline before membership cache was written: use stored tenant ID or user ID
    try {
      const fallbackTenant = localStorage.getItem('offline_last_tenant_id') || userId;
      const storedBoutiqueId = localStorage.getItem(BOUTIQUE_STORAGE_KEY);
      if (storedBoutiqueId) {
        setCurrentBoutiqueId(storedBoutiqueId);
      }
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
    const cleanEmail = email.trim().toLowerCase();
    let { data, error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });

    // If user accidentally copied a leading/trailing space in the password, retry once with trimmed password
    if (
      error &&
      error.message.toLowerCase().includes('invalid login credentials') &&
      password !== password.trim() &&
      password.trim().length >= 6
    ) {
      const retry = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: password.trim(),
      });
      data = retry.data;
      error = retry.error;
    }

    if (data?.session?.user) {
      writeOfflineSessionBackup(data.session);
      setSession(data.session);
      setUser(data.session.user);
    }
    return { error: error?.message ?? null };
  }

  async function refreshMembership(): Promise<void> {
    await loadMembership(user);
  }

  async function requestJoinEntreprise(
    entrepriseNom: string,
    fullName?: string,
    contact?: string,
    requestedRole = 'commercial',
  ): Promise<{ error: string | null; status?: 'pending' | 'already_member'; entrepriseNom?: string; needsAdminInvite?: boolean }> {
    const cleanEntNom = entrepriseNom.trim();
    if (!cleanEntNom) {
      return { error: "Veuillez saisir le nom exact de l'entreprise." };
    }

    // 1. Primary path: SECURITY DEFINER RPC (works even with strict entreprise RLS)
    const { data: rpcData, error: rpcErr } = await supabase.rpc('request_join_entreprise', {
      p_entreprise_nom: cleanEntNom,
      p_full_name: fullName?.trim() || null,
      p_contact: contact?.trim() || null,
      p_role: requestedRole,
    });

    if (!rpcErr) {
      const payload = (rpcData as { status?: 'pending' | 'already_member'; entreprise_nom?: string } | null) ?? {};
      return {
        error: null,
        status: payload.status ?? 'pending',
        entrepriseNom: payload.entreprise_nom ?? cleanEntNom,
      };
    }

    // If RPC exists and returned a real business error (e.g. company not found), surface it
    const rpcMsg = (rpcErr.message || '').toLowerCase();
    const isMissingRpc =
      rpcErr.code === 'PGRST202' ||
      rpcMsg.includes('could not find the function') ||
      rpcMsg.includes('does not exist');

    if (!isMissingRpc) {
      return { error: rpcErr.message };
    }

    // 2. Fallback if migration not yet applied on live DB: attempt direct lookup + insert
    try {
      const { data: sessionData } = await supabase.auth.getUser();
      const activeUser = sessionData.user ?? user;
      if (!activeUser) {
        return { error: 'Utilisateur non connecté.' };
      }

      const { data: targetEnt } = await supabase
        .from('entreprise')
        .select('user_id, nom')
        .ilike('nom', cleanEntNom)
        .limit(1)
        .maybeSingle();

      if (targetEnt?.user_id) {
        const { error: insErr } = await supabase.from('join_requests').insert({
          tenant_id: targetEnt.user_id,
          user_id: activeUser.id,
          user_email: (activeUser.email ?? '').toLowerCase(),
          full_name: fullName?.trim() || (activeUser.user_metadata?.full_name as string) || null,
          contact: contact?.trim() || (activeUser.user_metadata?.contact as string) || null,
          requested_role: requestedRole,
          status: 'pending',
        });
        if (!insErr || insErr.code === '23505') {
          return {
            error: null,
            status: 'pending',
            entrepriseNom: targetEnt.nom ?? cleanEntNom,
          };
        }
      }
    } catch {
      // Fall through to admin-invite guidance
    }

    return {
      error: null,
      needsAdminInvite: true,
      entrepriseNom: cleanEntNom,
    };
  }

  async function signUp(
    email: string,
    password: string,
    entrepriseNom: string,
    fullName: string,
    contact: string,
    depotStartNumber?: number | null,
    joiningExistingTeam = false,
  ): Promise<{
    error: string | null;
    joinRequested?: boolean;
    alreadyRegistered?: boolean;
    alreadyRegisteredSignedIn?: boolean;
    needsAdminInvite?: boolean;
  }> {
    const cleanEmail = email.trim().toLowerCase();
    const cleanEntNom = entrepriseNom.trim();
    let gpsLat: string | null = null;
    let gpsLng: string | null = null;
    if (!joiningExistingTeam && cleanEntNom && 'geolocation' in navigator) {
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
      email: cleanEmail,
      password,
      options: {
        data: {
          ...(!joiningExistingTeam && cleanEntNom ? { entreprise_nom: cleanEntNom } : {}),
          ...(joiningExistingTeam ? { joining_existing_team: true, target_entreprise_nom: cleanEntNom || null } : {}),
          ...(fullName ? { full_name: fullName } : {}),
          ...(contact ? { contact } : {}),
          ...(gpsLat ? { gps_latitude: gpsLat } : {}),
          ...(gpsLng ? { gps_longitude: gpsLng } : {}),
        },
      },
    });

    if (error) {
      const lowerMsg = error.message.toLowerCase();
      const isAlreadyRegistered =
        lowerMsg.includes('already registered') ||
        lowerMsg.includes('already exists') ||
        lowerMsg.includes('user already');

      if (isAlreadyRegistered) {
        // If joining an existing team, try signing in directly with the provided credentials
        // so the user doesn't hit a dead-end "User already registered" error!
        if (joiningExistingTeam) {
          const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
            email: cleanEmail,
            password,
          });
          if (!signInErr && signInData.session?.user) {
            writeOfflineSessionBackup(signInData.session);
            setSession(signInData.session);
            setUser(signInData.session.user);

            // Check if user already belongs to a company; if not and company name provided, send join request
            const { data: existingTenant } = await supabase.rpc('get_tenant_id');
            if (!existingTenant && cleanEntNom) {
              const joinRes = await requestJoinEntreprise(cleanEntNom, fullName, contact);
              if (joinRes.error) {
                return { error: joinRes.error, alreadyRegisteredSignedIn: true };
              }
              return {
                error: null,
                joinRequested: joinRes.status === 'pending',
                alreadyRegisteredSignedIn: true,
                needsAdminInvite: joinRes.needsAdminInvite,
              };
            }
            return { error: null, alreadyRegisteredSignedIn: true };
          }
          return { error: 'ALREADY_REGISTERED_WRONG_PASSWORD', alreadyRegistered: true };
        }
        return { error: 'ALREADY_REGISTERED', alreadyRegistered: true };
      }

      return { error: error.message };
    }

    if (data.session?.user) {
      writeOfflineSessionBackup(data.session);
    }

    const newUser = data.user;
    if (!newUser) return { error: null };

    // Joining an existing team: NEVER create a duplicate company!
    if (joiningExistingTeam) {
      if (cleanEntNom) {
        const joinRes = await requestJoinEntreprise(cleanEntNom, fullName, contact);
        if (!joinRes.error && joinRes.status === 'pending') {
          return { error: null, joinRequested: true };
        }
        if (joinRes.needsAdminInvite) {
          return { error: null, needsAdminInvite: true };
        }
      }
      return { error: null };
    }

    if (cleanEntNom) {
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
        entreprise_nom: cleanEntNom,
      });
      if (rpcError) {
        console.warn('signup_create_entreprise RPC failed (trigger will handle it):', rpcError.message);
      }

      // Enforce initial deposit starting counter if specified during installation / signup
      const normalizedStart =
        depotStartNumber != null && Number.isFinite(depotStartNumber) && depotStartNumber >= 1
          ? Math.max(1, Math.floor(depotStartNumber))
          : null;
      if (normalizedStart !== null) {
        const currentYear = new Date().getFullYear();
        setCompanyDepotStartSeq(normalizedStart, currentYear);
        setDepotStartSeq(null, currentYear, '', normalizedStart);
        try {
          await supabase
            .from('entreprise')
            .update({
              depot_start_number: normalizedStart,
              depot_start_year: currentYear,
            })
            .eq('user_id', newUser.id);
        } catch {
          // Non-blocking: local enforcement is already active
        }
        try {
          await supabase
            .from('boutiques')
            .update({
              depot_start_number: normalizedStart,
              depot_start_year: currentYear,
            })
            .eq('tenant_id', newUser.id)
            .eq('is_default', true);
        } catch {
          // Non-blocking: default boutique falls back to company counter if column not yet migrated
        }
      }

      // Ensure 30-day Demo licence is activated right away on company creation (best-effort)
      const demoEndDateIso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      try {
        await supabase.rpc('ensure_trial_licence');
      } catch {
        // Trigger or Super Admin approval will also guarantee the 30-day Demo licence
      }

      const safeNom = entrepriseNom.trim();
      try {
        localStorage.setItem(
          `demo_30d_welcome_pending_${newUser.id}`,
          JSON.stringify({
            entrepriseNom: safeNom,
            dateFin: demoEndDateIso,
            createdAt: new Date().toISOString(),
          }),
        );
      } catch {
        // Ignore storage errors
      }

      // Immediately notify the newly created company by Push about its automatic 30-day Demo licence
      try {
        await notifyCompanyDemoLicencePush({
          tenantId: newUser.id,
          entrepriseNom: safeNom,
          dateFin: demoEndDateIso,
          lang: localStorage.getItem('lang') || 'fr',
          requestPermissionIfDefault: true,
          showLocalNotification: true,
        });
      } catch {
        // Non-blocking: in-app Push notification & DB trigger also notify the company
      }

      // Immediately dispatch audible Web Push notification to Super Admin (even when app is closed)
      try {
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
      refreshMembership, requestJoinEntreprise,
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
