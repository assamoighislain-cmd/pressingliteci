import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { UserPlus, Trash2, Shield, Crown, UserCog, Mail, Loader2, X, Check, Pencil, Phone, User, UserCheck, Clock, Store, Truck } from 'lucide-react';

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
  const { user, role } = useAuth();
  const { t, lang } = useI18n();
  const { boutiques } = useAuth();

  const ROLE_LABELS: Record<string, string> = {
    admin: lang === 'fr' ? 'Administrateur' : 'Administrator',
    gerant: lang === 'fr' ? 'Gérant' : 'Manager',
    commercial: lang === 'fr' ? 'Commercial' : 'Sales',
    collecteur: lang === 'fr' ? 'Collecteur' : 'Collector',
  };
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<string>('commercial');
  const [inviteBoutiqueId, setInviteBoutiqueId] = useState<string>('');
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

  useEffect(() => {
    loadMembers();
    loadRequests();
  }, []);

  async function loadMembers() {
    setLoading(true);
    const { data, error } = await supabase
      .from('entreprise_members')
      .select('id, user_id, role, created_at, full_name, contact, boutique_id')
      .order('created_at', { ascending: true });

    if (error) {
      setError(error.message);
      setMembers([]);
    } else {
      const rows = data ?? [];
      const userIds = rows.map((m) => m.user_id);
      let emailMap: Record<string, string> = {};
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
  }

  async function loadRequests() {
    setRequestsLoading(true);
    const { data, error } = await supabase
      .from('join_requests')
      .select('id, user_email, full_name, contact, requested_role, status, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      setRequests([]);
    } else {
      setRequests((data as JoinRequest[]) ?? []);
    }
    setRequestsLoading(false);
  }

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

  async function handleInvite() {
    if (!inviteEmail.trim()) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const { data, error } = await supabase.rpc('add_team_member', {
        member_email: inviteEmail.trim(),
        member_role: inviteRole,
        member_boutique_id: inviteRole !== 'admin' && inviteBoutiqueId ? inviteBoutiqueId : null,
      });

      if (error) {
        setError(error.message);
      } else {
        setSuccess(`${lang === 'fr' ? 'Membre ajouté' : 'Member added'}: ${inviteEmail.trim()}`);
        setInviteEmail('');
        setInviteRole('commercial');
        setInviteBoutiqueId('');
        setShowInvite(false);
        await loadMembers();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de l\'ajout' : 'Error during addition'));
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
        {activeTab === 'members' && (
          <button
            onClick={() => setShowInvite(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors"
          >
            <UserPlus className="w-4 h-4" /> {lang === 'fr' ? 'Ajouter un membre' : 'Add member'}
          </button>
        )}
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

      {/* Invite modal */}
      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowInvite(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">{lang === 'fr' ? 'Ajouter un membre' : 'Add member'}</h3>
              <button onClick={() => setShowInvite(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-500">
              {lang === 'fr' ? "L'utilisateur doit d'abord créer un compte avec cet email, puis vous pourrez l'ajouter ici." : 'The user must first create an account with this email, then you can add them here.'}
            </p>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{lang === 'fr' ? 'Email du membre' : 'Member email'}</label>
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
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{lang === 'fr' ? 'Rôle' : 'Role'}</label>
              <select
                value={inviteRole}
                onChange={(e) => { setInviteRole(e.target.value); setInviteBoutiqueId(''); }}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white"
              >
                <option value="admin">{ROLE_LABELS.admin}</option>
                <option value="gerant">{ROLE_LABELS.gerant}</option>
                <option value="commercial">{ROLE_LABELS.commercial}</option>
                <option value="collecteur">{ROLE_LABELS.collecteur}</option>
              </select>
            </div>
            {inviteRole !== 'admin' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">{lang === 'fr' ? 'Boutique assignée' : 'Assigned boutique'} *</label>
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
                disabled={submitting || !inviteEmail.trim() || (inviteRole !== 'admin' && !inviteBoutiqueId)}
                className="flex-1 px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                {submitting ? (lang === 'fr' ? 'Ajout…' : 'Adding…') : (lang === 'fr' ? 'Ajouter' : 'Add')}
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
