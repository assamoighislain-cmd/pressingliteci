import { createClient } from '@supabase/supabase-js';
import { supabase, supabaseUrl, supabaseAnonKey } from '@/lib/supabase';
import { notifyRealtimeMutation } from '@/lib/realtimeSync';

/**
 * Creates a temporary, isolated Supabase Auth client that NEVER touches
 * localStorage or the currently signed-in admin/super-admin session.
 */
function createEphemeralAuthClient() {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: `ephemeral-member-creator-${Date.now()}`,
    },
  });
}

export function generateTemporaryPassword(length = 10): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export interface CreateOrAttachMemberParams {
  mode: 'create' | 'attach';
  scope: 'team_admin' | 'super_admin';
  email: string;
  password?: string;
  fullName?: string;
  contact?: string;
  role: string;
  boutiqueId?: string | null;
  targetTenantId?: string; // Required when scope === 'super_admin'
}

export interface CreateOrAttachMemberResult {
  error: string | null;
  memberUserId?: string | null;
  createdNewAccount: boolean;
  alreadyExisted: boolean;
  needsEmailConfirmation: boolean;
  passwordUpdated?: boolean;
  passwordResetMissingRpc?: boolean;
  roleConstraintMissing?: boolean;
  loginVerified?: boolean;
  email: string;
  password?: string;
}

export const ROLE_MIGRATION_SQL = `ALTER TABLE public.entreprise_members DROP CONSTRAINT IF EXISTS entreprise_members_role_check;
ALTER TABLE public.entreprise_members ADD CONSTRAINT entreprise_members_role_check
  CHECK (role = ANY (ARRAY['admin'::text, 'gerant'::text, 'commercial'::text, 'collecteur'::text, 'comptable'::text, 'associe'::text]));

CREATE OR REPLACE FUNCTION public.add_team_member(member_email text, member_role text, member_boutique_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); t_id uuid; member_uid uuid; v_full_name text; v_contact text;
BEGIN
  t_id := public.get_tenant_id();
  IF t_id IS NULL THEN RAISE EXCEPTION 'Aucune entreprise trouvée'; END IF;
  IF NOT public.is_tenant_admin(t_id) THEN RAISE EXCEPTION 'Seul l''administrateur peut ajouter des membres'; END IF;
  IF member_role NOT IN ('admin', 'gerant', 'commercial', 'collecteur', 'comptable', 'associe') THEN RAISE EXCEPTION 'Rôle invalide'; END IF;
  SELECT id, NULLIF(trim(COALESCE(raw_user_meta_data ->> 'full_name', '')), ''), NULLIF(trim(COALESCE(raw_user_meta_data ->> 'contact', '')), '')
  INTO member_uid, v_full_name, v_contact FROM auth.users WHERE lower(email) = lower(trim(member_email)) LIMIT 1;
  IF member_uid IS NULL THEN RAISE EXCEPTION 'Utilisateur introuvable. L''utilisateur doit d''abord créer un compte.'; END IF;
  IF member_uid = uid THEN RAISE EXCEPTION 'Vous êtes déjà membre de cette entreprise'; END IF;
  INSERT INTO public.entreprise_members (tenant_id, user_id, role, boutique_id, full_name, contact)
  VALUES (t_id, member_uid, member_role, member_boutique_id, v_full_name, v_contact)
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role, boutique_id = EXCLUDED.boutique_id,
    full_name = COALESCE(public.entreprise_members.full_name, EXCLUDED.full_name), contact = COALESCE(public.entreprise_members.contact, EXCLUDED.contact);
  UPDATE auth.users SET email_confirmed_at = COALESCE(email_confirmed_at, now()), updated_at = now() WHERE id = member_uid AND email_confirmed_at IS NULL;
  RETURN member_uid;
END; $$;

CREATE OR REPLACE FUNCTION public.add_member_to_entreprise(member_email text, target_tenant_id uuid, member_role text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE member_uid uuid; v_full_name text; v_contact text;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'Seul le super-administrateur peut ajouter des membres'; END IF;
  IF member_role NOT IN ('admin', 'gerant', 'commercial', 'collecteur', 'comptable', 'associe') THEN RAISE EXCEPTION 'Rôle invalide'; END IF;
  SELECT id, NULLIF(trim(COALESCE(raw_user_meta_data ->> 'full_name', '')), ''), NULLIF(trim(COALESCE(raw_user_meta_data ->> 'contact', '')), '')
  INTO member_uid, v_full_name, v_contact FROM auth.users WHERE lower(email) = lower(trim(member_email)) LIMIT 1;
  IF member_uid IS NULL THEN RAISE EXCEPTION 'Utilisateur introuvable. La personne doit d''abord créer un compte avec cet email.'; END IF;
  INSERT INTO public.entreprise_members (tenant_id, user_id, role, full_name, contact)
  VALUES (target_tenant_id, member_uid, member_role, v_full_name, v_contact)
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role,
    full_name = COALESCE(public.entreprise_members.full_name, EXCLUDED.full_name), contact = COALESCE(public.entreprise_members.contact, EXCLUDED.contact);
  UPDATE auth.users SET email_confirmed_at = COALESCE(email_confirmed_at, now()), updated_at = now() WHERE id = member_uid AND email_confirmed_at IS NULL;
  RETURN member_uid;
END; $$;

CREATE OR REPLACE FUNCTION public.current_user_can_write_financial()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.is_super_admin() OR COALESCE(public.get_user_role(), 'admin') <> 'associe';
$$;
CREATE OR REPLACE FUNCTION public.current_user_can_write_operational()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.is_super_admin() OR COALESCE(public.get_user_role(), 'admin') NOT IN ('associe', 'comptable');
$$;
GRANT EXECUTE ON FUNCTION public.current_user_can_write_financial() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_can_write_operational() TO authenticated;

DO $$
DECLARE
  t text;
  op_tables text[] := ARRAY['clients','depots','depot_articles','depot_avances','articles','article_variants','types_traitement','modes_reglement','consommables','consommable_mouvements','boutiques','entreprise','bons_reduction','commerciaux','commercial_clients','relances','fidelite_points'];
  fin_tables text[] := ARRAY['depenses','depense_categories','commission_versements'];
BEGIN
  IF to_regclass('public.commission_versements') IS NOT NULL THEN
    DROP POLICY IF EXISTS "insert_tenant_commission_versements" ON public.commission_versements;
    CREATE POLICY "insert_tenant_commission_versements" ON public.commission_versements FOR INSERT TO authenticated
      WITH CHECK (public.is_super_admin() OR EXISTS (SELECT 1 FROM public.entreprise_members em WHERE em.user_id = auth.uid() AND em.tenant_id = commission_versements.tenant_id AND em.role IN ('admin', 'gerant', 'comptable')));
    DROP POLICY IF EXISTS "update_tenant_commission_versements" ON public.commission_versements;
    CREATE POLICY "update_tenant_commission_versements" ON public.commission_versements FOR UPDATE TO authenticated
      USING (public.is_super_admin() OR EXISTS (SELECT 1 FROM public.entreprise_members em WHERE em.user_id = auth.uid() AND em.tenant_id = commission_versements.tenant_id AND em.role IN ('admin', 'gerant', 'comptable')))
      WITH CHECK (public.is_super_admin() OR EXISTS (SELECT 1 FROM public.entreprise_members em WHERE em.user_id = auth.uid() AND em.tenant_id = commission_versements.tenant_id AND em.role IN ('admin', 'gerant', 'comptable')));
    DROP POLICY IF EXISTS "delete_tenant_commission_versements" ON public.commission_versements;
    CREATE POLICY "delete_tenant_commission_versements" ON public.commission_versements FOR DELETE TO authenticated
      USING (public.is_super_admin() OR EXISTS (SELECT 1 FROM public.entreprise_members em WHERE em.user_id = auth.uid() AND em.tenant_id = commission_versements.tenant_id AND em.role IN ('admin', 'gerant', 'comptable')));
  END IF;
  FOREACH t IN ARRAY op_tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS "restrict_readonly_insert" ON public.%I', t);
      EXECUTE format('CREATE POLICY "restrict_readonly_insert" ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.current_user_can_write_operational())', t);
      EXECUTE format('DROP POLICY IF EXISTS "restrict_readonly_update" ON public.%I', t);
      EXECUTE format('CREATE POLICY "restrict_readonly_update" ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.current_user_can_write_operational()) WITH CHECK (public.current_user_can_write_operational())', t);
      EXECUTE format('DROP POLICY IF EXISTS "restrict_readonly_delete" ON public.%I', t);
      EXECUTE format('CREATE POLICY "restrict_readonly_delete" ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (public.current_user_can_write_operational())', t);
    END IF;
  END LOOP;
  FOREACH t IN ARRAY fin_tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS "restrict_associe_insert" ON public.%I', t);
      EXECUTE format('CREATE POLICY "restrict_associe_insert" ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.current_user_can_write_financial())', t);
      EXECUTE format('DROP POLICY IF EXISTS "restrict_associe_update" ON public.%I', t);
      EXECUTE format('CREATE POLICY "restrict_associe_update" ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.current_user_can_write_financial()) WITH CHECK (public.current_user_can_write_financial())', t);
      EXECUTE format('DROP POLICY IF EXISTS "restrict_associe_delete" ON public.%I', t);
      EXECUTE format('CREATE POLICY "restrict_associe_delete" ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (public.current_user_can_write_financial())', t);
    END IF;
  END LOOP;
END $$;`;

export function buildMemberPasswordResetSql(email: string, password: string): string {
  const safeEmail = email.trim().toLowerCase().replace(/'/g, "''");
  const safePw = password.trim().replace(/'/g, "''");
  return `CREATE OR REPLACE FUNCTION public.admin_reset_member_password(target_user_id uuid, new_password text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
DECLARE v_ok boolean := false;
BEGIN
  IF new_password IS NULL OR length(trim(new_password)) < 6 THEN RAISE EXCEPTION 'Mot de passe trop court (min. 6 caractères).'; END IF;
  IF public.is_super_admin() OR EXISTS (SELECT 1 FROM public.entreprise_members em WHERE em.user_id = target_user_id AND public.is_tenant_admin(em.tenant_id)) THEN v_ok := true; END IF;
  IF NOT v_ok THEN RAISE EXCEPTION 'Accès refusé.'; END IF;
  UPDATE auth.users SET encrypted_password = extensions.crypt(trim(new_password), extensions.gen_salt('bf')), email_confirmed_at = COALESCE(email_confirmed_at, now()), updated_at = now() WHERE id = target_user_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_reset_member_password(uuid, text) TO authenticated;

UPDATE auth.users
SET encrypted_password = extensions.crypt('${safePw}', extensions.gen_salt('bf')),
    email_confirmed_at = COALESCE(email_confirmed_at, now()),
    updated_at = now()
WHERE lower(email) = lower('${safeEmail}')
RETURNING id, email, email_confirmed_at;`;
}

/**
 * Tests whether an email + password can actually sign in on Supabase
 * using an isolated ephemeral client (never touches the admin's active session).
 */
export async function verifyMemberLogin(
  email: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const cleanEmail = email.trim().toLowerCase();
  const cleanPw = password.trim();
  if (!cleanEmail || cleanPw.length < 6) {
    return { ok: false, error: 'Email ou mot de passe trop court (min. 6 caractères).' };
  }
  const ephemeral = createEphemeralAuthClient();
  try {
    const { data, error } = await ephemeral.auth.signInWithPassword({
      email: cleanEmail,
      password: cleanPw,
    });
    try {
      await ephemeral.auth.signOut({ scope: 'local' });
    } catch {
      // Ignore
    }
    if (error) {
      return { ok: false, error: error.message };
    }
    if (data.session?.user) {
      return { ok: true };
    }
    return { ok: false, error: 'Aucune session retournée.' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Erreur réseau' };
  }
}

export async function adminResetMemberPassword(
  targetUserId: string,
  newPassword: string,
): Promise<{ error: string | null; missingRpc?: boolean }> {
  const cleanPw = newPassword.trim();
  if (cleanPw.length < 6) {
    return { error: 'Le mot de passe doit contenir au moins 6 caractères.' };
  }
  const { error } = await supabase.rpc('admin_reset_member_password', {
    target_user_id: targetUserId,
    new_password: cleanPw,
  });
  if (error) {
    const msg = (error.message || '').toLowerCase();
    const missingRpc =
      error.code === 'PGRST202' ||
      msg.includes('could not find the function') ||
      msg.includes('does not exist');
    return { error: error.message, missingRpc };
  }
  return { error: null };
}

export function buildDeleteMemberSql(email: string): string {
  const safeEmail = email.trim().toLowerCase().replace(/'/g, "''");
  return `DO $$
DECLARE
  v_uid uuid;
  v_tid uuid;
  v_dup_ent_id bigint;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE lower(trim(email)) = lower('${safeEmail}') LIMIT 1;
  IF v_uid IS NULL THEN RAISE NOTICE 'Compte introuvable ou déjà supprimé.'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = v_uid) THEN RAISE EXCEPTION 'Impossible de supprimer un Super Admin.'; END IF;
  SELECT tenant_id INTO v_tid FROM public.entreprise_members WHERE user_id = v_uid LIMIT 1;
  IF v_tid = v_uid THEN RAISE EXCEPTION 'Impossible de supprimer le propriétaire principal de l''entreprise.'; END IF;
  IF v_tid IS NOT NULL THEN
    UPDATE public.clients SET user_id = v_tid WHERE user_id = v_uid AND tenant_id = v_tid;
    UPDATE public.depots SET user_id = v_tid WHERE user_id = v_uid AND tenant_id = v_tid;
    UPDATE public.depot_articles SET user_id = v_tid WHERE user_id = v_uid AND tenant_id = v_tid;
    UPDATE public.depot_avances SET user_id = v_tid WHERE user_id = v_uid AND tenant_id = v_tid;
    UPDATE public.articles SET user_id = v_tid WHERE user_id = v_uid AND tenant_id = v_tid;
    UPDATE public.types_traitement SET user_id = v_tid WHERE user_id = v_uid AND tenant_id = v_tid;
    UPDATE public.modes_reglement SET user_id = v_tid WHERE user_id = v_uid AND tenant_id = v_tid;
    UPDATE public.depenses SET user_id = v_tid WHERE user_id = v_uid AND tenant_id = v_tid;
    UPDATE public.depense_categories SET user_id = v_tid WHERE user_id = v_uid AND tenant_id = v_tid;
    UPDATE public.depot_counter SET user_id = v_tid WHERE user_id = v_uid AND tenant_id = v_tid;
    DELETE FROM public.code_counter WHERE user_id = v_uid AND EXISTS (SELECT 1 FROM public.code_counter t WHERE t.id = code_counter.id AND t.user_id = v_tid);
    UPDATE public.code_counter SET user_id = v_tid WHERE user_id = v_uid AND tenant_id = v_tid;
  END IF;
  SELECT id INTO v_dup_ent_id FROM public.entreprise WHERE user_id = v_uid LIMIT 1;
  IF v_dup_ent_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.depots WHERE tenant_id = v_uid) OR EXISTS (SELECT 1 FROM public.clients WHERE tenant_id = v_uid) THEN
      RAISE EXCEPTION 'Ce compte possède sa propre entreprise avec des données.';
    END IF;
    DELETE FROM public.join_requests WHERE tenant_id = v_uid;
    DELETE FROM public.licences WHERE entreprise_id = v_dup_ent_id;
    DELETE FROM public.boutiques WHERE tenant_id = v_uid;
    DELETE FROM public.entreprise_members WHERE tenant_id = v_uid;
    DELETE FROM public.entreprise WHERE id = v_dup_ent_id;
  END IF;
  DELETE FROM public.entreprise_members WHERE user_id = v_uid;
  DELETE FROM public.join_requests WHERE user_id = v_uid OR lower(trim(user_email)) = lower('${safeEmail}');
  DELETE FROM public.push_subscriptions WHERE user_id = v_uid;
  DELETE FROM auth.users WHERE id = v_uid;
END $$;`;
}

export async function adminDeleteMemberAccount(
  targetUserId: string,
  targetTenantId?: string | null,
): Promise<{ error: string | null; missingRpc?: boolean; authAccountDeleted?: boolean }> {
  const { data, error } = await supabase.rpc('admin_delete_member_account', {
    target_user_id: targetUserId,
    target_tenant_id: targetTenantId ?? null,
  });

  if (error) {
    const msg = (error.message || '').toLowerCase();
    const missingRpc =
      error.code === 'PGRST202' ||
      msg.includes('could not find the function') ||
      msg.includes('does not exist');
    return { error: error.message, missingRpc };
  }

  notifyRealtimeMutation('entreprise_members', true);
  const res = data as { auth_account_deleted?: boolean } | null;
  return {
    error: null,
    authAccountDeleted: Boolean(res?.auth_account_deleted),
  };
}

/**
 * Creates a brand-new user account (without ever creating a duplicate company
 * and without logging out the current admin) OR attaches an already-existing
 * account directly into the target company.
 */
export async function createOrAttachCompanyMember(
  params: CreateOrAttachMemberParams,
): Promise<CreateOrAttachMemberResult> {
  const cleanEmail = params.email.trim().toLowerCase();
  const cleanName = params.fullName?.trim() || null;
  const cleanContact = params.contact?.trim() || null;
  const cleanPassword = params.password?.trim() || '';

  if (!cleanEmail) {
    return {
      error: "Veuillez saisir l'adresse email du membre.",
      createdNewAccount: false,
      alreadyExisted: false,
      needsEmailConfirmation: false,
      email: cleanEmail,
    };
  }

  let createdNewAccount = false;
  let alreadyExisted = false;
  let needsEmailConfirmation = false;

  // Step 1: If creating a brand-new member account, register them via an isolated
  // ephemeral client WITHOUT entreprise_nom (so the DB trigger NEVER creates a duplicate company!)
  if (params.mode === 'create') {
    if (cleanPassword.length < 6) {
      return {
        error: 'Le mot de passe temporaire doit contenir au moins 6 caractères.',
        createdNewAccount: false,
        alreadyExisted: false,
        needsEmailConfirmation: false,
        email: cleanEmail,
      };
    }

    const ephemeral = createEphemeralAuthClient();
    const { data: signUpData, error: signUpErr } = await ephemeral.auth.signUp({
      email: cleanEmail,
      password: cleanPassword,
      options: {
        data: {
          joining_existing_team: true,
          ...(cleanName ? { full_name: cleanName } : {}),
          ...(cleanContact ? { contact: cleanContact } : {}),
        },
      },
    });

    // Always clear ephemeral memory session immediately
    try {
      await ephemeral.auth.signOut({ scope: 'local' });
    } catch {
      // Ignore
    }

    if (signUpErr) {
      const msgLower = signUpErr.message.toLowerCase();
      if (
        msgLower.includes('already registered') ||
        msgLower.includes('already exists') ||
        msgLower.includes('user already')
      ) {
        // Account already exists in auth.users — DO NOT fail! Proceed to attach them directly!
        alreadyExisted = true;
      } else {
        return {
          error: signUpErr.message,
          createdNewAccount: false,
          alreadyExisted: false,
          needsEmailConfirmation: false,
          email: cleanEmail,
        };
      }
    } else if (signUpData.user) {
      // Supabase returns empty identities[] when email confirmation is enabled and user already exists
      const identities = (signUpData.user as { identities?: unknown[] }).identities;
      if (Array.isArray(identities) && identities.length === 0) {
        alreadyExisted = true;
      } else {
        createdNewAccount = true;
        // If Supabase Auth has "Confirm email" enabled, signUpData.session is null!
        if (!signUpData.session) {
          needsEmailConfirmation = true;
        }
      }
    }
  }

  // Step 2: Attach the user to the company using the authenticated admin/super-admin client
  let memberUid: string | null = null;

  if (params.scope === 'super_admin') {
    if (!params.targetTenantId) {
      return {
        error: 'Entreprise cible introuvable.',
        createdNewAccount,
        alreadyExisted,
        needsEmailConfirmation,
        email: cleanEmail,
      };
    }

    let { data: rpcData, error: rpcErr } = await supabase.rpc('add_member_to_entreprise', {
      member_email: cleanEmail,
      target_tenant_id: params.targetTenantId,
      member_role: params.role,
    });

    // Fallback if live unpatched RPC doesn't yet accept 'collecteur', 'comptable', or 'associe'
    if (
      rpcErr &&
      (params.role === 'collecteur' || params.role === 'comptable' || params.role === 'associe') &&
      rpcErr.message.toLowerCase().includes('invalide')
    ) {
      const retry = await supabase.rpc('add_member_to_entreprise', {
        member_email: cleanEmail,
        target_tenant_id: params.targetTenantId,
        member_role: 'commercial',
      });
      rpcErr = retry.error;
      rpcData = retry.data;
      if (!rpcErr && typeof rpcData === 'string') {
        const { error: updErr } = await supabase
          .from('entreprise_members')
          .update({ role: params.role })
          .eq('tenant_id', params.targetTenantId)
          .eq('user_id', rpcData);
        if (updErr) {
          return {
            error: updErr.message,
            createdNewAccount,
            alreadyExisted,
            needsEmailConfirmation,
            roleConstraintMissing: /role_check|violates check constraint|invalide/i.test(updErr.message),
            email: cleanEmail,
          };
        }
      }
    }

    if (rpcErr) {
      return {
        error: rpcErr.message,
        createdNewAccount,
        alreadyExisted,
        needsEmailConfirmation,
        roleConstraintMissing: /role_check|violates check constraint|rôle invalide/i.test(rpcErr.message),
        email: cleanEmail,
      };
    }

    if (typeof rpcData === 'string') {
      memberUid = rpcData;
    }

    // Populate full_name and contact immediately on entreprise_members
    if (memberUid && (cleanName || cleanContact)) {
      const updates: Record<string, string> = {};
      if (cleanName) updates.full_name = cleanName;
      if (cleanContact) updates.contact = cleanContact;
      await supabase
        .from('entreprise_members')
        .update(updates)
        .eq('tenant_id', params.targetTenantId)
        .eq('user_id', memberUid);
    }
  } else {
    // scope === 'team_admin'
    const resolvedBoutiqueId = params.role !== 'admin' && params.boutiqueId ? params.boutiqueId : null;

    let { data: rpcData, error: rpcErr } = await supabase.rpc('add_team_member', {
      member_email: cleanEmail,
      member_role: params.role,
      member_boutique_id: resolvedBoutiqueId,
    });

    // Fallback if live DB has older 2-arg add_team_member or rejects newer roles
    if (rpcErr) {
      const lowerErr = rpcErr.message.toLowerCase();
      if (
        (params.role === 'collecteur' || params.role === 'comptable' || params.role === 'associe') &&
        lowerErr.includes('invalide')
      ) {
        const retry = await supabase.rpc('add_team_member', {
          member_email: cleanEmail,
          member_role: 'commercial',
          member_boutique_id: resolvedBoutiqueId,
        });
        rpcErr = retry.error;
        rpcData = retry.data;
        if (!rpcErr && typeof rpcData === 'string') {
          const { error: updErr } = await supabase
            .from('entreprise_members')
            .update({ role: params.role })
            .eq('user_id', rpcData);
          if (updErr) {
            return {
              error: updErr.message,
              createdNewAccount,
              alreadyExisted,
              needsEmailConfirmation,
              roleConstraintMissing: /role_check|violates check constraint|invalide/i.test(updErr.message),
              email: cleanEmail,
            };
          }
        }
      } else if (lowerErr.includes('could not find the function') || rpcErr.code === 'PGRST202') {
        const retry = await supabase.rpc('add_team_member', {
          member_email: cleanEmail,
          member_role: params.role,
        });
        rpcErr = retry.error;
        rpcData = retry.data;
      }
    }

    if (rpcErr) {
      return {
        error: rpcErr.message,
        createdNewAccount,
        alreadyExisted,
        needsEmailConfirmation,
        roleConstraintMissing: /role_check|violates check constraint|rôle invalide/i.test(rpcErr.message),
        email: cleanEmail,
      };
    }

    if (typeof rpcData === 'string') {
      memberUid = rpcData;
    }

    // Populate full_name, contact, and boutique_id immediately via tenant admin RLS
    if (memberUid) {
      const updates: Record<string, string | null> = {};
      if (cleanName) updates.full_name = cleanName;
      if (cleanContact) updates.contact = cleanContact;
      if (resolvedBoutiqueId) updates.boutique_id = resolvedBoutiqueId;
      if (Object.keys(updates).length > 0) {
        let q = supabase.from('entreprise_members').update(updates).eq('user_id', memberUid);
        if (params.targetTenantId) {
          q = q.eq('tenant_id', params.targetTenantId);
        }
        await q;
      }
    }
  }

  // Step 3: Best-effort auto-confirm email (and apply new password if account already existed in 'create' mode)
  let passwordUpdated = false;
  let passwordResetMissingRpc = false;
  if (memberUid) {
    if (params.mode === 'create' && alreadyExisted && cleanPassword.length >= 6) {
      const resetRes = await adminResetMemberPassword(memberUid, cleanPassword);
      if (!resetRes.error) {
        passwordUpdated = true;
        needsEmailConfirmation = false;
      } else if (resetRes.missingRpc) {
        passwordResetMissingRpc = true;
      }
    } else if (needsEmailConfirmation) {
      const { error: confirmErr } = await supabase.rpc('confirm_member_email', {
        target_user_id: memberUid,
      });
      if (!confirmErr) {
        needsEmailConfirmation = false;
      }
    }
  }

  // Step 4: Verify live against Supabase Auth that the credentials actually sign in
  let loginVerified = false;
  const activePassword = createdNewAccount || passwordUpdated ? cleanPassword : undefined;
  if (activePassword && !needsEmailConfirmation) {
    const check = await verifyMemberLogin(cleanEmail, activePassword);
    loginVerified = check.ok;
  }

  notifyRealtimeMutation('entreprise_members', true);

  return {
    error: null,
    memberUserId: memberUid,
    createdNewAccount,
    alreadyExisted,
    needsEmailConfirmation,
    passwordUpdated,
    passwordResetMissingRpc,
    loginVerified,
    email: cleanEmail,
    password: activePassword,
  };
}
