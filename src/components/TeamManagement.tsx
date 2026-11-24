import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { createOrAttachCompanyMember, generateTemporaryPassword, adminResetMemberPassword } from '@/lib/memberCreator';
import { buildWhatsAppUrl } from '@/types';
import { UserPlus, Trash2, Shield, Crown, UserCog, Mail, Loader2, X, Check, Pencil, Phone, User, UserCheck, Clock, Store, Truck, RefreshCw, Lock, Eye, EyeOff, Copy, Sparkles, MessageCircle, KeyRound, AlertTriangle } from 'lucide-react';

interface Member {
  id: string;
  user_id: string;
  role: string;
  created_at: string;
  email: string;
  full_name: string | null;
  contact: string | null;
  boutique_id: string | null;
}

interface JoinRequest {
  id: string;
  user_email: string;
  full_name: string | null;
  contact: string | null;
  requested_role: string;
  status: string;
  created_at: string;
}

const ROLE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  admin: Crown,
  gerant: Shield,
  commercial: UserCog,
  collecteur: Truck,
};

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-amber-100 text-amber-700 border-amber-200',
  gerant: 'bg-sky-100 text-sky-700 border-sky-200',
  commercial: 'bg-slate-100 text-slate-600 border-slate-200',
  collecteur: 'bg-orange-100 text-orange-700 border-orange-200',
};

export default function TeamManagement() {
  const { user, role, tenantId, boutiques } = useAuth();
  const { t, lang } = useI18n();

  const ROLE_LABELS: Record<string, string> = {
    admin: lang === 'fr' ? 'Administrateur' : 'Administrator',
    gerant: lang === 'fr' ? 'Gérant' : 'Manager',
    commercial: lang === 'fr' ? 'Commercial' : 'Sales',
    collecteur: lang === 'fr' ? 'Collecteur' : 'Collector',
  };
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteMode, setInviteMode] = useState<'create' | 'attach'>('create');
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [showInvitePassword, setShowInvitePassword] = useState(false);
  const [inviteFullName, setInviteFullName] = useState('');
  const [inviteContact, setInviteContact] = useState('');
  const [inviteRole, setInviteRole] = useState<string>('commercial');
  const [inviteBoutiqueId, setInviteBoutiqueId] = useState<string>('');
  const [createdCredentials, setCreatedCredentials] = useState<{
    email: string;
    password?: string;
    fullName?: string;
    contact?: string;
    role: string;
    needsEmailConfirmation?: boolean;
  } | null>(null);
  const [copiedCreds, setCopiedCreds] = useState(false);
  const [resetPwMember, setResetPwMember] = useState<Member | null>(null);
  const [resetPwValue, setResetPwValue] = useState('');
  const [resetPwMissingRpc, setResetPwMissingRpc] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'members' | 'requests'>('members');
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  // Edit modal state
  const [editMember, setEditMember] = useState<Member | null>(null);
  const [editFullName, setEditFullName] = useState('');
  const [editContact, setEditContact] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editBoutiqueId, setEditBoutiqueId] = useState('');

  const isAdmin = role === 'admin';

  const loadMembers = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('entreprise_members')
      .select('id, user_id, role, created_at, full_name, contact, boutique_id')
      .order('created_at', { ascending: true });
    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }
    const { data, error } = await query;

    if (error) {
      setError(error.message);
      setMembers([]);
    } else {
      const rows = data ?? [];
      const userIds = rows.map((m) => m.user_id);
      const emailMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: emailData } = await supabase.rpc('get_member_emails', { user_ids: userIds });
        for (const e of (emailData as { user_id: string; email: string }[]) ?? []) {
          emailMap[e.user_id] = e.email;
        }
      }
      const enriched: Member[] = rows.map((m) => ({
        ...m,
        email: emailMap[m.user_id] ?? '—',
      }));
      setMembers(enriched);
    }
    setLoading(false);
  }, [tenantId]);

  const loadRequests = useCallback(async () => {
    setRequestsLoading(true);
    let query = supabase
      .from('join_requests')
      .select('id, user_email, full_name, contact, requested_role, status, created_at')
      .order('created_at', { ascending: false });
    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }
    const { data, error } = await query;

    if (error) {
      setRequests([]);
    } else {
      setRequests((data as JoinRequest[]) ?? []);
    }
    setRequestsLoading(false);
  }, [tenantId]);

  useEffect(() => {
    void loadMembers();
    void loadRequests();
  }, [loadMembers, loadRequests]);

  useRealtimeSync(['entreprise_members', 'join_requests'], () => {
    void loadMembers();
    void loadRequests();
  });

  async function handleApprove(requestId: string) {
    setActionLoadingId(requestId);
    setError(null);
    setSuccess(null);
    try {
      const { error } = await supabase.rpc('approve_join_request', { p_request_id: requestId });
      if (error) {
        setError(error.message);
      } else {
        setSuccess(lang === 'fr' ? 'Demande approuvée. Le membre a été ajouté à l\'équipe.' : 'Request approved. The member has been added to the team.');
        await Promise.all([loadRequests(), loadMembers()]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de l\'approbation' : 'Error during approval'));
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleReject(requestId: string) {
    setActionLoadingId(requestId);
    setError(null);
    setSuccess(null);
    try {
      const { error } = await supabase.rpc('reject_join_request', { p_request_id: requestId });
      if (error) {
        setError(error.message);
      } else {
        setSuccess(lang === 'fr' ? 'Demande refusée.' : 'Request rejected.');
        await loadRequests();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors du refus' : 'Error during rejection'));
    } finally {
      setActionLoadingId(null);
    }
  }

  function getDefaultBoutiqueId(): string {
    return boutiques.find((b) => b.is_default)?.id ?? boutiques[0]?.id ?? '';
  }

  function openInviteModal() {
    setInviteMode('create');
    setInviteEmail('');
    setInviteFullName('');
    setInviteContact('');
    setInvitePassword(generateTemporaryPassword(10));
    setShowInvitePassword(true);
    setInviteRole('commercial');
    setInviteBoutiqueId(getDefaultBoutiqueId());
    setError(null);
    setShowInvite(true);
  }

  async function handleInvite() {
    if (!inviteEmail.trim()) return;
    if (inviteMode === 'create' && invitePassword.trim().length < 6) {
      setError(lang === 'fr' ? 'Le mot de passe doit contenir au moins 6 caractères.' : 'Password must be at least 6 characters.');
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await createOrAttachCompanyMember({
        mode: inviteMode,
        scope: 'team_admin',
        email: inviteEmail,
        password: inviteMode === 'create' ? invitePassword : undefined,
        fullName: inviteFullName,
        contact: inviteContact,
        role: inviteRole,
        boutiqueId: inviteRole !== 'admin' ? (inviteBoutiqueId || getDefaultBoutiqueId() || null) : null,
        targetTenantId: tenantId ?? undefined,
      });

      if (res.error) {
        setError(res.error);
      } else {
        if (res.createdNewAccount || res.passwordUpdated) {
          setCreatedCredentials({
            email: res.email,
            password: res.password,
            fullName: inviteFullName.trim() || undefined,
            contact: inviteContact.trim() || undefined,
            role: inviteRole,
            needsEmailConfirmation: res.needsEmailConfirmation,
          });
          setSuccess(
            lang === 'fr'
              ? `Compte membre prêt et ajouté à votre entreprise : ${res.email}`
              : `Member account ready and added to your company: ${res.email}`,
          );
        } else if (res.alreadyExisted) {
          setCreatedCredentials(null);
          setSuccess(
            lang === 'fr'
              ? `Ce compte existait déjà (${res.email}) : il a été directement rattaché à votre entreprise avec son mot de passe existant (cliquez sur l'icône Clé pour définir un nouveau mot de passe).`
              : `This account already existed (${res.email}): it has been attached directly to your company with its existing password (click the Key icon to set a new password).`,
          );
        } else {
          setCreatedCredentials(null);
          setSuccess(`${lang === 'fr' ? 'Membre rattaché' : 'Member attached'}: ${res.email}`);
        }
        setInviteEmail('');
        setInviteFullName('');
        setInviteContact('');
        setInvitePassword('');
        setInviteRole('commercial');
        setInviteBoutiqueId(getDefaultBoutiqueId());
        setShowInvite(false);
        await loadMembers();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? "Erreur lors de l'ajout" : 'Error during addition'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleChangeRole(memberId: string, newRole: string) {
    const member = members.find((m) => m.id === memberId);
    if (newRole !== 'admin' && member && !member.boutique_id) {
      setError(lang === 'fr'
        ? 'Veuillez assigner une boutique à ce membre via le bouton de modification avant de changer son rôle.'
        : 'Please assign a boutique to this member via the edit button before changing their role.');
      return;
    }
    setError(null);
    try {
      const updates: Record<string, string | null> = { role: newRole };
      if (newRole === 'admin') updates.boutique_id = null;
      const { error } = await supabase
        .from('entreprise_members')
        .update(updates)
        .eq('id', memberId);

      if (error) {
        setError(error.message);
      } else {
        setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, role: newRole, boutique_id: newRole === 'admin' ? null : m.boutique_id } : m)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors du changement de rôle' : 'Error during role change'));
    }
  }

  async function handleRemoveMember(memberId: string, memberUserId: string) {
    if (memberUserId === user?.id) {
      setError(lang === 'fr' ? "Vous ne pouvez pas vous retirer de l'équipe." : "You cannot remove yourself from the team.");
      return;
    }
    if (!window.confirm(lang === 'fr' ? 'Retirer ce membre de l\'équipe ?' : 'Remove this member from the team?')) return;

    setError(null);
    try {
      const { error } = await supabase
        .from('entreprise_members')
        .delete()
        .eq('id', memberId);

      if (error) {
        setError(error.message);
      } else {
        setMembers((prev) => prev.filter((m) => m.id !== memberId));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors du retrait' : 'Error during removal'));
    }
  }

  function openResetPasswordModal(m: Member) {
    setResetPwMember(m);
    setResetPwValue(generateTemporaryPassword(10));
    setResetPwMissingRpc(false);
    setCopiedSql(false);
    setError(null);
  }

  async function handleResetMemberPassword() {
    if (!resetPwMember || resetPwValue.trim().length < 6) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    setResetPwMissingRpc(false);
    try {
      const res = await adminResetMemberPassword(resetPwMember.user_id, resetPwValue);
      if (res.error) {
        if (res.missingRpc) {
          setResetPwMissingRpc(true);
        } else {
          setError(res.error);
        }
      } else {
        setCreatedCredentials({
          email: resetPwMember.email,
          password: resetPwValue.trim(),
          fullName: resetPwMember.full_name ?? undefined,
          contact: resetPwMember.contact ?? undefined,
          role: resetPwMember.role,
          needsEmailConfirmation: false,
        });
        setSuccess(
          lang === 'fr'
            ? `Mot de passe réinitialisé et compte confirmé pour ${resetPwMember.email}.`
            : `Password reset and account confirmed for ${resetPwMember.email}.`,
        );
        setResetPwMember(null);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function openEditModal(m: Member) {
    setEditMember(m);
    setEditFullName(m.full_name ?? '');
    setEditContact(m.contact ?? '');
    setEditEmail(m.email);
    setEditRole(m.role);
    setEditBoutiqueId(m.boutique_id ?? '');
  }

  async function handleSaveEdit() {
    if (!editMember) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const updates: Record<string, string | null> = {
        full_name: editFullName.trim() || null,
        contact: editContact.trim() || null,
        role: editRole,
        boutique_id: editRole !== 'admin' && editBoutiqueId ? editBoutiqueId : null,
      };
      const { error } = await supabase
        .from('entreprise_members')
        .update(updates)
        .eq('id', editMember.id);

      if (error) {
        setError(error.message);
      } else {
        setSuccess(lang === 'fr' ? 'Profil mis à jour' : 'Profile updated');
        setMembers((prev) =>
          prev.map((m) =>
            m.id === editMember.id
              ? { ...m, full_name: editFullName.trim() || null, contact: editContact.trim() || null, role: editRole, boutique_id: editRole !== 'admin' && editBoutiqueId ? editBoutiqueId : null }
              : m,
          ),
        );
        setEditMember(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de l\'enregistrement' : 'Error during saving'));
    } finally {
      setSubmitting(false);
    }
  }

  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-8 text-center">
          <Shield className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-slate-900">{lang === 'fr' ? 'Accès restreint' : 'Restricted access'}</h2>
          <p className="text-sm text-slate-500 mt-1">
            {lang === 'fr' ? "Seuls les administrateurs peuvent gérer les utilisateurs de l'entreprise." : 'Only administrators can manage company users.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{lang === 'fr' ? 'Utilisateurs' : 'Users'}</h2>
          <p className="text-sm text-slate-500 mt-1">
            {lang === 'fr' ? 'Gérez les membres de votre entreprise et leurs rôles.' : 'Manage your company members and their roles.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { void loadMembers(); void loadRequests(); }}
            className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
            title={lang === 'fr' ? 'Actualiser la liste' : 'Refresh list'}
          >
            <RefreshCw className={`w-4 h-4 ${loading || requestsLoading ? 'animate-spin' : ''}`} />
            {lang === 'fr' ? 'Actualiser' : 'Refresh'}
          </button>
          {activeTab === 'members' && (
            <button
              onClick={openInviteModal}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors"
            >
              <UserPlus className="w-4 h-4" /> {lang === 'fr' ? 'Créer / Ajouter un membre' : 'Create / Add member'}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl">
        <button
          onClick={() => setActiveTab('members')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${
            activeTab === 'members' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <UserCog className="w-4 h-4" /> {lang === 'fr' ? 'Membres' : 'Members'}
        </button>
        <button
          onClick={() => setActiveTab('requests')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${
            activeTab === 'requests' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <Clock className="w-4 h-4" /> {lang === 'fr' ? 'Demandes' : 'Requests'}
          {requests.filter((r) => r.status === 'pending').length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">
              {requests.filter((r) => r.status === 'pending').length}
            </span>
          )}
        </button>
      </div>

      {activeTab === 'members' && requests.filter((r) => r.status === 'pending').length > 0 && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-sm text-amber-800">
            <Clock className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <span>
              {lang === 'fr'
                ? `${requests.filter((r) => r.status === 'pending').length} demande(s) d'adhésion en attente d'approbation.`
                : `${requests.filter((r) => r.status === 'pending').length} join request(s) pending approval.`}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('requests')}
            className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 transition-colors"
          >
            {lang === 'fr' ? 'Voir les demandes' : 'View requests'}
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 flex items-start gap-2">
          <X className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {success && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 flex items-start gap-2">
          <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-emerald-600">{success}</p>
        </div>
      )}

      {createdCredentials && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-emerald-900">
                {lang === 'fr' ? 'Identifiants du nouveau membre prêts à partager' : 'New member credentials ready to share'}
              </p>
              <p className="text-xs text-emerald-700 mt-0.5">
                {lang === 'fr'
                  ? "Le membre peut se connecter immédiatement via « Connexion » (sans jamais recréer d'entreprise)."
                  : 'The member can sign in immediately via "Sign In" (without creating a duplicate company).'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCreatedCredentials(null)}
              className="text-emerald-600 hover:text-emerald-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="rounded-lg bg-white border border-emerald-200 p-3 text-xs font-mono space-y-1 text-slate-800">
            <div><span className="text-slate-400">Email :</span> <strong>{createdCredentials.email}</strong></div>
            {createdCredentials.password && (
              <div><span className="text-slate-400">{lang === 'fr' ? 'Mot de passe :' : 'Password:'}</span> <strong>{createdCredentials.password}</strong></div>
            )}
            <div><span className="text-slate-400">{lang === 'fr' ? 'Rôle :' : 'Role:'}</span> <strong>{ROLE_LABELS[createdCredentials.role] ?? createdCredentials.role}</strong></div>
          </div>
          {createdCredentials.needsEmailConfirmation && (
            <div className="rounded-lg bg-amber-50 border border-amber-300 p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-900">
                {lang === 'fr'
                  ? `Attention : Supabase exige une confirmation d'email pour « ${createdCredentials.email} ». Si cette adresse n'a pas de boîte mail, désactivez « Confirm email » dans Supabase (Authentication → Providers → Email) ou confirmez le compte dans Authentication → Users.`
                  : `Warning: Supabase requires email confirmation for "${createdCredentials.email}". Disable "Confirm email" in Supabase (Authentication → Providers → Email) or confirm the user in Authentication → Users.`}
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                const text =
                  lang === 'fr'
                    ? `Bonjour${createdCredentials.fullName ? ` ${createdCredentials.fullName}` : ''},\nVoici vos identifiants PressingLite :\nLien : ${window.location.origin}\nEmail : ${createdCredentials.email}\nMot de passe : ${createdCredentials.password ?? '(votre mot de passe habituel)'}`
                    : `Hello${createdCredentials.fullName ? ` ${createdCredentials.fullName}` : ''},\nHere are your PressingLite credentials:\nURL: ${window.location.origin}\nEmail: ${createdCredentials.email}\nPassword: ${createdCredentials.password ?? '(your existing password)'}`;
                navigator.clipboard.writeText(text);
                setCopiedCreds(true);
                setTimeout(() => setCopiedCreds(false), 2000);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 transition-colors"
            >
              {copiedCreds ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedCreds ? (lang === 'fr' ? 'Copié !' : 'Copied!') : (lang === 'fr' ? 'Copier les identifiants' : 'Copy credentials')}
            </button>
            {createdCredentials.contact && createdCredentials.contact.replace(/[^\d]/g, '').length >= 8 && (
              <a
                href={buildWhatsAppUrl(
                  createdCredentials.contact,
                  lang === 'fr'
                    ? `Bonjour${createdCredentials.fullName ? ` ${createdCredentials.fullName}` : ''},\n\nVotre compte membre PressingLite a été créé.\nConnectez-vous sur : ${window.location.origin}\nEmail : ${createdCredentials.email}\nMot de passe : ${createdCredentials.password ?? '(votre mot de passe habituel)'}`
                    : `Hello${createdCredentials.fullName ? ` ${createdCredentials.fullName}` : ''},\n\nYour PressingLite team account is ready.\nSign in at: ${window.location.origin}\nEmail: ${createdCredentials.email}\nPassword: ${createdCredentials.password ?? '(your existing password)'}`,
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs font-medium hover:bg-green-700 transition-colors"
              >
                <MessageCircle className="w-3.5 h-3.5" />
                {lang === 'fr' ? 'Envoyer par WhatsApp' : 'Send via WhatsApp'}
              </a>
            )}
          </div>
        </div>
      )}

      {/* Create / Attach member modal */}
      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6 overflow-y-auto">
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowInvite(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4 my-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                {lang === 'fr' ? 'Créer ou rattacher un membre' : 'Create or attach a member'}
              </h3>
              <button onClick={() => setShowInvite(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mode tabs */}
            <div className="flex gap-1 p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => {
                  setInviteMode('create');
                  if (!invitePassword) setInvitePassword(generateTemporaryPassword(10));
                }}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
                  inviteMode === 'create' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {lang === 'fr' ? 'Créer un nouveau membre' : 'Create new member'}
              </button>
              <button
                type="button"
                onClick={() => setInviteMode('attach')}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
                  inviteMode === 'attach' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {lang === 'fr' ? 'Compte déjà existant' : 'Existing account'}
              </button>
            </div>

            <p className="text-xs text-slate-500">
              {inviteMode === 'create'
                ? (lang === 'fr'
                    ? "Crée directement le compte du collaborateur et l'ajoute à votre entreprise (sans aucun doublon d'entreprise)."
                    : 'Directly creates the staff account and attaches it to your company (zero duplicate companies).')
                : (lang === 'fr'
                    ? "Rattache immédiatement un utilisateur qui possède déjà un compte PressingLite avec cet email."
                    : 'Immediately attaches a user who already has a PressingLite account with this email.')}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  {lang === 'fr' ? 'Nom et prénoms' : 'Full name'}
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={inviteFullName}
                    onChange={(e) => setInviteFullName(e.target.value)}
                    placeholder={lang === 'fr' ? 'Ex: Kouassi Jean' : 'e.g. John Doe'}
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  {lang === 'fr' ? 'Téléphone' : 'Phone'}
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="tel"
                    value={inviteContact}
                    onChange={(e) => setInviteContact(e.target.value)}
                    placeholder="+225 07..."
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{lang === 'fr' ? 'Email du membre' : 'Member email'} *</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="membre@exemple.com"
                  className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                />
              </div>
            </div>

            {inviteMode === 'create' && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-slate-700">
                    {lang === 'fr' ? 'Mot de passe provisoire' : 'Temporary password'} *
                  </label>
                  <button
                    type="button"
                    onClick={() => setInvitePassword(generateTemporaryPassword(10))}
                    className="inline-flex items-center gap-1 text-xs text-sky-600 hover:text-sky-700 font-medium"
                  >
                    <Sparkles className="w-3 h-3" />
                    {lang === 'fr' ? 'Générer' : 'Generate'}
                  </button>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type={showInvitePassword ? 'text' : 'password'}
                    value={invitePassword}
                    onChange={(e) => setInvitePassword(e.target.value)}
                    minLength={6}
                    placeholder="Minimum 6 caractères"
                    className="w-full pl-10 pr-10 py-2.5 rounded-lg border border-slate-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => setShowInvitePassword((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showInvitePassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{lang === 'fr' ? 'Rôle' : 'Role'}</label>
              <select
                value={inviteRole}
                onChange={(e) => {
                  const nextRole = e.target.value;
                  setInviteRole(nextRole);
                  if (nextRole !== 'admin' && !inviteBoutiqueId) {
                    setInviteBoutiqueId(getDefaultBoutiqueId());
                  }
                }}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white"
              >
                <option value="admin">{ROLE_LABELS.admin}</option>
                <option value="gerant">{ROLE_LABELS.gerant}</option>
                <option value="commercial">{ROLE_LABELS.commercial}</option>
                <option value="collecteur">{ROLE_LABELS.collecteur}</option>
              </select>
            </div>
            {inviteRole !== 'admin' && boutiques.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{lang === 'fr' ? 'Boutique assignée' : 'Assigned boutique'} *</label>
                <select
                  value={inviteBoutiqueId}
                  onChange={(e) => setInviteBoutiqueId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white"
                >
                  <option value="">{lang === 'fr' ? '— Choisir une boutique —' : '— Select a boutique —'}</option>
                  {boutiques.map((b) => (
                    <option key={b.id} value={b.id}>{b.nom}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowInvite(false)}
                className="px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleInvite}
                disabled={
                  submitting ||
                  !inviteEmail.trim() ||
                  (inviteMode === 'create' && invitePassword.trim().length < 6) ||
                  (inviteRole !== 'admin' && boutiques.length > 0 && !inviteBoutiqueId)
                }
                className="flex-1 px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                {submitting
                  ? (lang === 'fr' ? 'Traitement…' : 'Processing…')
                  : inviteMode === 'create'
                    ? (lang === 'fr' ? 'Créer le membre' : 'Create member')
                    : (lang === 'fr' ? 'Rattacher le membre' : 'Attach member')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset member password & confirm account modal */}
      {resetPwMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setResetPwMember(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-amber-600" />
                <h3 className="text-base font-semibold text-slate-900">
                  {lang === 'fr' ? 'Mot de passe & activation' : 'Password & activation'}
                </h3>
              </div>
              <button onClick={() => setResetPwMember(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-500">
              {lang === 'fr'
                ? `Définissez un nouveau mot de passe pour « ${resetPwMember.email} » et confirmez son compte pour une connexion immédiate.`
                : `Set a new password for "${resetPwMember.email}" and confirm their account for immediate sign-in.`}
            </p>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-slate-700">
                  {lang === 'fr' ? 'Nouveau mot de passe' : 'New password'}
                </label>
                <button
                  type="button"
                  onClick={() => setResetPwValue(generateTemporaryPassword(10))}
                  className="inline-flex items-center gap-1 text-xs text-sky-600 hover:text-sky-700 font-medium"
                >
                  <Sparkles className="w-3 h-3" /> {lang === 'fr' ? 'Générer' : 'Generate'}
                </button>
              </div>
              <input
                type="text"
                value={resetPwValue}
                onChange={(e) => setResetPwValue(e.target.value)}
                minLength={6}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            {resetPwMissingRpc && (() => {
              const safeEmail = resetPwMember.email.replace(/'/g, "''");
              const safePw = resetPwValue.trim().replace(/'/g, "''");
              const sqlSnippet = `UPDATE auth.users\nSET encrypted_password = extensions.crypt('${safePw}', extensions.gen_salt('bf')),\n    email_confirmed_at = COALESCE(email_confirmed_at, now()),\n    updated_at = now()\nWHERE lower(email) = lower('${safeEmail}');`;
              return (
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 space-y-2">
                  <p className="text-xs font-medium text-amber-900">
                    {lang === 'fr'
                      ? 'La migration SQL n’est pas encore exécutée sur Supabase. Exécutez cette commande dans Supabase → SQL Editor pour activer immédiatement ce compte :'
                      : 'The SQL migration is not yet applied on Supabase. Run this in Supabase → SQL Editor to unlock this account immediately:'}
                  </p>
                  <pre className="text-[11px] font-mono bg-white border border-amber-200 rounded-lg p-2.5 overflow-x-auto text-slate-800 whitespace-pre-wrap">{sqlSnippet}</pre>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(sqlSnippet);
                      setCopiedSql(true);
                      setTimeout(() => setCopiedSql(false), 2000);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-medium hover:bg-amber-700"
                  >
                    {copiedSql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedSql ? (lang === 'fr' ? 'SQL copié !' : 'SQL copied!') : (lang === 'fr' ? 'Copier le SQL' : 'Copy SQL')}
                  </button>
                </div>
              );
            })()}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setResetPwMember(null)}
                className="px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void handleResetMemberPassword()}
                disabled={submitting || resetPwValue.trim().length < 6}
                className="flex-1 px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                {lang === 'fr' ? 'Activer & appliquer' : 'Activate & apply'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setEditMember(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">{lang === 'fr' ? 'Modifier le profil' : 'Edit profile'}</h3>
              <button onClick={() => setEditMember(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('auth.email')}</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="email"
                  value={editEmail}
                  disabled
                  className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm bg-slate-50 text-slate-400"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{lang === 'fr' ? 'Nom et prénoms' : 'Full name'}</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  placeholder={lang === 'fr' ? 'Jean Dupont' : 'John Doe'}
                  className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{lang === 'fr' ? 'Contact' : 'Contact'}</label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="tel"
                  value={editContact}
                  onChange={(e) => setEditContact(e.target.value)}
                  placeholder="+225 07 00 00 00"
                  className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{lang === 'fr' ? 'Rôle' : 'Role'}</label>
              <select
                value={editRole}
                onChange={(e) => { setEditRole(e.target.value); setEditBoutiqueId(''); }}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white"
              >
                <option value="admin">{ROLE_LABELS.admin}</option>
                <option value="gerant">{ROLE_LABELS.gerant}</option>
                <option value="commercial">{ROLE_LABELS.commercial}</option>
                <option value="collecteur">{ROLE_LABELS.collecteur}</option>
              </select>
            </div>
            {editRole !== 'admin' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">{lang === 'fr' ? 'Boutique assignée' : 'Assigned boutique'} *</label>
                <select
                  value={editBoutiqueId}
                  onChange={(e) => setEditBoutiqueId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white"
                >
                  <option value="">{lang === 'fr' ? '— Choisir une boutique —' : '— Select a boutique —'}</option>
                  {boutiques.map((b) => (
                    <option key={b.id} value={b.id}>{b.nom}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setEditMember(null)}
                className="px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={submitting || (editRole !== 'admin' && !editBoutiqueId)}
                className="flex-1 px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {submitting ? (lang === 'fr' ? 'Enregistrement…' : 'Saving…') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Members list */}
      {activeTab === 'members' && (
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-sky-500 animate-spin" />
          </div>
        ) : members.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-slate-400">{lang === 'fr' ? 'Aucun membre trouvé.' : 'No member found.'}</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {members.map((m) => {
              const RoleIcon = ROLE_ICONS[m.role] ?? UserCog;
              const isSelf = m.user_id === user?.id;
              return (
                <div key={m.id} className="flex items-center justify-between p-4 hover:bg-slate-50/50 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${ROLE_COLORS[m.role] ?? ROLE_COLORS.commercial}`}>
                      <RoleIcon className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {m.full_name || m.email}
                        {isSelf && <span className="text-xs text-slate-400 ml-1.5">({lang === 'fr' ? 'vous' : 'you'})</span>}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {m.full_name && (
                          <span className="text-xs text-slate-500 truncate">{m.email}</span>
                        )}
                        {m.contact && (
                          <span className="flex items-center gap-1 text-xs text-slate-400">
                            <Phone className="w-3 h-3" />
                            {m.contact}
                          </span>
                        )}
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${ROLE_COLORS[m.role] ?? ROLE_COLORS.commercial}`}>
                          {ROLE_LABELS[m.role] ?? m.role}
                        </span>
                        {m.boutique_id && (() => {
                          const b = boutiques.find((x) => x.id === m.boutique_id);
                          return b ? (
                            <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                              <Store className="w-3 h-3" />
                              {b.nom}
                            </span>
                          ) : null;
                        })()}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {!isSelf && (
                      <>
                        <button
                          type="button"
                          onClick={() => openResetPasswordModal(m)}
                          className="p-2 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                          title={lang === 'fr' ? 'Mot de passe & activation' : 'Password & activation'}
                        >
                          <KeyRound className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => openEditModal(m)}
                          className="p-2 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors"
                          title={lang === 'fr' ? 'Modifier le profil' : 'Edit profile'}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <select
                          value={m.role}
                          onChange={(e) => handleChangeRole(m.id, e.target.value)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white"
                        >
                          <option value="admin">{ROLE_LABELS.admin}</option>
                          <option value="gerant">{ROLE_LABELS.gerant}</option>
                          <option value="commercial">{ROLE_LABELS.commercial}</option>
                          <option value="collecteur">{ROLE_LABELS.collecteur}</option>
                        </select>
                        <button
                          onClick={() => handleRemoveMember(m.id, m.user_id)}
                          className="p-2 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                          title={lang === 'fr' ? 'Retirer' : 'Remove'}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}

      {/* Join requests list */}
      {activeTab === 'requests' && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          {requestsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-sky-500 animate-spin" />
            </div>
          ) : requests.length === 0 ? (
            <div className="py-12 text-center">
              <Clock className="w-10 h-10 text-slate-200 mx-auto mb-2" />
              <p className="text-sm text-slate-400">{lang === 'fr' ? 'Aucune demande en attente.' : 'No pending requests.'}</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {requests.map((r) => (
                <div key={r.id} className="flex items-center justify-between p-4 hover:bg-slate-50/50 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                      r.status === 'pending' ? 'bg-amber-100 text-amber-600' :
                      r.status === 'approved' ? 'bg-emerald-100 text-emerald-600' :
                      'bg-red-100 text-red-600'
                    }`}>
                      {r.status === 'pending' ? <Clock className="w-5 h-5" /> :
                       r.status === 'approved' ? <UserCheck className="w-5 h-5" /> :
                       <X className="w-5 h-5" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {r.full_name || r.user_email}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {r.full_name && (
                          <span className="text-xs text-slate-500 truncate">{r.user_email}</span>
                        )}
                        {r.contact && (
                          <span className="flex items-center gap-1 text-xs text-slate-400">
                            <Phone className="w-3 h-3" />
                            {r.contact}
                          </span>
                        )}
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${
                          r.status === 'pending' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                          r.status === 'approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                          'bg-red-50 text-red-700 border-red-200'
                        }`}>
                          {r.status === 'pending' ? (lang === 'fr' ? 'En attente' : 'Pending') : r.status === 'approved' ? (lang === 'fr' ? 'Approuvée' : 'Approved') : (lang === 'fr' ? 'Refusée' : 'Rejected')}
                        </span>
                      </div>
                    </div>
                  </div>
                  {r.status === 'pending' && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleApprove(r.id)}
                        disabled={actionLoadingId === r.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {actionLoadingId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        {lang === 'fr' ? 'Approuver' : 'Approve'}
                      </button>
                      <button
                        onClick={() => handleReject(r.id)}
                        disabled={actionLoadingId === r.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-red-600 text-xs font-medium border border-red-200 hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {actionLoadingId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                        {lang === 'fr' ? 'Refuser' : 'Reject'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Role descriptions */}
      {activeTab === 'members' && (
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 space-y-3">
        <h3 className="text-sm font-semibold text-slate-700">{lang === 'fr' ? 'Rôles disponibles' : 'Available roles'}</h3>
        <div className="space-y-2">
          <div className="flex items-start gap-3">
            <Crown className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-slate-900">{ROLE_LABELS.admin}</p>
              <p className="text-xs text-slate-500">{lang === 'fr' ? 'Accès complet : gestion des utilisateurs, paramètres entreprise, et toutes les opérations.' : 'Full access: user management, company settings, and all operations.'}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Shield className="w-4 h-4 text-sky-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-slate-900">{ROLE_LABELS.gerant}</p>
              <p className="text-xs text-slate-500">{lang === 'fr' ? 'Toutes les opérations (dépôt, retrait, clients, catalogue) sauf gestion des utilisateurs. Assigné à une seule boutique.' : 'All operations (deposit, pickup, clients, catalog) except user management. Assigned to a single boutique.'}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <UserCog className="w-4 h-4 text-slate-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-slate-900">{ROLE_LABELS.commercial}</p>
              <p className="text-xs text-slate-500">{lang === 'fr' ? 'Accès aux opérations courantes (dépôt, retrait, clients) sans modifier les paramètres. Assigné à une seule boutique.' : 'Access to current operations (deposit, pickup, clients) without modifying settings. Assigned to a single boutique.'}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Truck className="w-4 h-4 text-orange-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-slate-900">{ROLE_LABELS.collecteur}</p>
              <p className="text-xs text-slate-500">{lang === 'fr' ? 'Voit le linge à collecter chez les clients (adresse + GPS). Accès limité à la collecte.' : 'Sees items to pick up at clients\' homes (address + GPS). Limited to pickup access.'}</p>
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
