import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { useOfflineStatus } from '@/hooks/useOfflineStatus';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { notifyRealtimeMutation } from '@/lib/realtimeSync';
import { buildWhatsAppUrl } from '@/types';
import { Building2, UserPlus, Crown, Loader2, X, Check, Shield, Mail, Users, ChevronDown, ChevronRight, Trash2, UserCog, Pencil, Phone, User, KeyRound, Calendar, Plus, Ban, Copy, TrendingUp, AlertTriangle, Clock, BarChart3, UserCheck, Search, Filter, ArrowUpDown, MapPin, Navigation, Activity, ShoppingBag, Package, Store, DollarSign, ArrowDownUp, MessageCircle, Send, ExternalLink } from 'lucide-react';

type WhatsAppTemplateType = 'approval' | 'licence' | 'reminder' | 'custom';

interface Member {
  id: string;
  user_id: string;
  role: string;
  email: string;
  full_name: string | null;
  contact: string | null;
}

interface Licence {
  id: string;
  entreprise_id: number;
  cle_licence: string;
  date_debut: string;
  date_fin: string;
  statut: 'active' | 'expired' | 'revoked' | 'demo';
  type_licence: 'demo' | 'annuelle';
  created_at: string;
  prix?: number | null;
}

interface EntrepriseRow {
  id: number;
  nom: string;
  user_id: string;
  email: string;
  statut: 'active' | 'demo' | 'suspended' | 'pending';
  members: Member[];
  licences: Licence[];
  created_at?: string;
  latitude?: number | null;
  longitude?: number | null;
  adresse?: string | null;
  ville?: string | null;
  telephone?: string | null;
}

interface UsageStats {
  entreprise_id: number;
  ent_nom: string;
  ent_statut: string;
  total_clients: number;
  total_depots: number;
  depots_commande: number;
  depots_en_cours: number;
  depots_collecte: number;
  depots_retire: number;
  total_articles: number;
  total_boutiques: number;
  total_revenue: number;
  last_activity: string;
}

interface JoinRequest {
  id: string;
  tenant_id: string;
  user_id: string;
  user_email: string;
  full_name: string | null;
  contact: string | null;
  requested_role: string;
  status: string;
  created_at: string;
  entreprise_nom: string;
}

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-amber-100 text-amber-700 border-amber-200',
  gerant: 'bg-sky-100 text-sky-700 border-sky-200',
  commercial: 'bg-slate-100 text-slate-600 border-slate-200',
};

const ROLE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  admin: Crown,
  gerant: Shield,
  commercial: UserCog,
};

export default function SuperAdminPage() {
  const { isSuperAdmin } = useAuth();
  const { t, lang } = useI18n();
  const { isOnline } = useOfflineStatus();

  const ROLE_LABELS: Record<string, string> = {
    admin: lang === 'fr' ? 'Administrateur' : 'Administrator',
    gerant: lang === 'fr' ? 'Gérant' : 'Manager',
    commercial: lang === 'fr' ? 'Commercial' : 'Sales',
  };
  const [entreprises, setEntreprises] = useState<EntrepriseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showCreateEntreprise, setShowCreateEntreprise] = useState(false);
  const [showAddMember, setShowAddMember] = useState<number | null>(null);
  const [adminEmail, setAdminEmail] = useState('');
  const [entrepriseNom, setEntrepriseNom] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRole, setMemberRole] = useState('commercial');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editMember, setEditMember] = useState<Member | null>(null);
  const [editFullName, setEditFullName] = useState('');
  const [editContact, setEditContact] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [showLicenceModal, setShowLicenceModal] = useState<number | null>(null);
  const [licenceStart, setLicenceStart] = useState('');
  const [licenceEnd, setLicenceEnd] = useState('');
  const [generatingLicence, setGeneratingLicence] = useState(false);
  const [licencePrix, setLicencePrix] = useState('100000');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [editLicence, setEditLicence] = useState<Licence | null>(null);
  const [editLicenceStart, setEditLicenceStart] = useState('');
  const [editLicenceEnd, setEditLicenceEnd] = useState('');
  const [editLicencePrix, setEditLicencePrix] = useState('');
  const [editLicenceStatut, setEditLicenceStatut] = useState<'active' | 'expired' | 'revoked' | 'demo'>('active');
  const [savingLicenceEdit, setSavingLicenceEdit] = useState(false);
  const [activeTab, setActiveTab] = useState<'entreprises' | 'licences' | 'join_requests' | 'usage'>('entreprises');
  const [usageStats, setUsageStats] = useState<UsageStats[]>([]);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageSortBy, setUsageSortBy] = useState<'depots' | 'revenue' | 'clients' | 'articles' | 'activity' | 'name'>('depots');
  const [licenceFilter, setLicenceFilter] = useState<'all' | 'active' | 'expiring' | 'expired' | 'revoked' | 'demo'>('all');
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statutFilter, setStatutFilter] = useState<'all' | 'active' | 'demo' | 'suspended' | 'pending'>('all');
  const [licenceFilterEnt, setLicenceFilterEnt] = useState<'all' | 'with_active' | 'expiring' | 'expired' | 'no_licence'>('all');
  const [sortBy, setSortBy] = useState<'name' | 'name_desc' | 'members' | 'licence_end'>('name');

  // WhatsApp composer & approved companies broadcast state
  const [whatsAppTarget, setWhatsAppTarget] = useState<EntrepriseRow | null>(null);
  const [whatsAppPhone, setWhatsAppPhone] = useState('');
  const [whatsAppTemplate, setWhatsAppTemplate] = useState<WhatsAppTemplateType>('approval');
  const [whatsAppMessage, setWhatsAppMessage] = useState('');
  const [whatsAppJustApproved, setWhatsAppJustApproved] = useState(false);
  const [savingPhone, setSavingPhone] = useState(false);
  const [showApprovedWhatsAppModal, setShowApprovedWhatsAppModal] = useState(false);
  const [broadcastSearch, setBroadcastSearch] = useState('');
  const [broadcastTemplate, setBroadcastTemplate] = useState<WhatsAppTemplateType>('approval');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [sentWhatsAppIds, setSentWhatsAppIds] = useState<number[]>([]);
  const [inlinePhones, setInlinePhones] = useState<Record<number, string>>({});

  const allLicences = entreprises.flatMap((e) =>
    e.licences.map((lic) => ({ ...lic, entrepriseNom: e.nom, entrepriseEmail: e.email }))
  );

  const now = new Date();
  const in30Days = new Date();
  in30Days.setDate(in30Days.getDate() + 30);

  const activeLicences = allLicences.filter((l) => l.statut === 'active');
  const expiringLicences = activeLicences.filter((l) => new Date(l.date_fin) <= in30Days && new Date(l.date_fin) >= now);
  const expiredLicences = allLicences.filter((l) => l.statut === 'expired' || (l.statut === 'active' && new Date(l.date_fin) < now));
  const annualLicences = allLicences.filter((l) => l.type_licence === 'annuelle');
  const demoLicences = allLicences.filter((l) => l.type_licence === 'demo');
  const revokedLicences = allLicences.filter((l) => l.statut === 'revoked');

  const entreprisesWithoutActiveLicence = entreprises.filter((e) =>
    !e.licences.some((l) => l.statut === 'active' && new Date(l.date_fin) >= now)
  );

  const filteredEntreprises = (() => {
    const q = searchQuery.trim().toLowerCase();
    let list = entreprises.filter((e) => {
      if (q) {
        const inName = e.nom.toLowerCase().includes(q);
        const inEmail = e.email.toLowerCase().includes(q);
        const inPhone = (e.telephone ?? '').toLowerCase().includes(q);
        const inMembers = e.members.some((m) => (m.full_name?.toLowerCase().includes(q) || m.email.toLowerCase().includes(q) || (m.contact ?? '').toLowerCase().includes(q)));
        if (!inName && !inEmail && !inPhone && !inMembers) return false;
      }
      if (statutFilter !== 'all' && e.statut !== statutFilter) return false;
      if (licenceFilterEnt === 'with_active' && !e.licences.some((l) => l.statut === 'active' && new Date(l.date_fin) >= now)) return false;
      if (licenceFilterEnt === 'expiring' && !e.licences.some((l) => l.statut === 'active' && new Date(l.date_fin) <= in30Days && new Date(l.date_fin) >= now)) return false;
      if (licenceFilterEnt === 'expired' && !e.licences.some((l) => l.statut === 'expired' || (l.statut === 'active' && new Date(l.date_fin) < now))) return false;
      if (licenceFilterEnt === 'no_licence' && e.licences.some((l) => l.statut === 'active' && new Date(l.date_fin) >= now)) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sortBy === 'name') return a.nom.localeCompare(b.nom);
      if (sortBy === 'name_desc') return b.nom.localeCompare(a.nom);
      if (sortBy === 'members') return b.members.length - a.members.length;
      if (sortBy === 'licence_end') {
        const aEnd = a.licences.filter((l) => l.statut === 'active').map((l) => new Date(l.date_fin).getTime()).sort()[0] ?? Infinity;
        const bEnd = b.licences.filter((l) => l.statut === 'active').map((l) => new Date(l.date_fin).getTime()).sort()[0] ?? Infinity;
        return aEnd - bEnd;
      }
      return 0;
    });
    return list;
  })();

  const filteredLicences = licenceFilter === 'all' ? allLicences
    : licenceFilter === 'active' ? activeLicences.filter((l) => new Date(l.date_fin) >= now)
    : licenceFilter === 'expiring' ? expiringLicences
    : licenceFilter === 'expired' ? expiredLicences
    : licenceFilter === 'revoked' ? revokedLicences
    : demoLicences;

  useEffect(() => {
    if (isSuperAdmin) {
      loadEntreprises();
      loadJoinRequests();
    }
  }, [isSuperAdmin]);

  useRealtimeSync(['entreprise', 'licences', 'join_requests', 'entreprise_members'], () => {
    if (!isSuperAdmin || !isOnline) return;
    void loadEntreprises(true);
    void loadJoinRequests();
  });

  useEffect(() => {
    if (isSuperAdmin && activeTab === 'usage' && usageStats.length === 0) {
      loadUsageStats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin, activeTab]);

  async function loadUsageStats() {
    setUsageLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_entreprise_usage_stats');
      if (rpcError) {
        setError(rpcError.message);
        setUsageStats([]);
      } else {
        setUsageStats((data as UsageStats[]) ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors du chargement des statistiques' : 'Error loading usage stats'));
    } finally {
      setUsageLoading(false);
    }
  }

  async function loadJoinRequests() {
    const { data, error } = await supabase
      .from('join_requests')
      .select('id, tenant_id, user_id, user_email, full_name, contact, requested_role, status, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      setJoinRequests([]);
      return;
    }

    const requests = data ?? [];
    const tenantIds = [...new Set(requests.map((r: { tenant_id: string }) => r.tenant_id))];
    const tenantMap: Record<string, string> = {};
    if (tenantIds.length > 0) {
      const { data: entrepisesData } = await supabase
        .from('entreprise')
        .select('user_id, nom')
        .in('user_id', tenantIds);
      for (const e of (entrepisesData as { user_id: string; nom: string }[]) ?? []) {
        tenantMap[e.user_id] = e.nom;
      }
    }

    setJoinRequests(
      requests.map((r: { id: string; tenant_id: string; user_id: string; user_email: string; full_name: string | null; contact: string | null; requested_role: string; status: string; created_at: string }) => ({
        ...r,
        entreprise_nom: tenantMap[r.tenant_id] ?? '—',
      })),
    );
  }

  async function loadEntreprises(silent = false) {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    const { data, error } = await supabase.from('entreprise').select('*').order('nom');
    if (error) {
      if (!silent) {
        setError(error.message);
        setEntreprises([]);
        setLoading(false);
      }
      return;
    }

    const rows = data ?? [];
    const enriched: EntrepriseRow[] = await Promise.all(
      rows.map(async (e) => {
        const { data: membersData } = await supabase
          .from('entreprise_members')
          .select('id, user_id, role, full_name, contact')
          .eq('tenant_id', e.user_id)
          .order('created_at', { ascending: true });

        const memberRows = membersData ?? [];
        const userIds = memberRows.map((m: { user_id: string }) => m.user_id);
        let emailMap: Record<string, string> = {};
        if (userIds.length > 0) {
          const { data: emailData } = await supabase.rpc('get_member_emails', { user_ids: userIds });
          for (const em of (emailData as { user_id: string; email: string }[]) ?? []) {
            emailMap[em.user_id] = em.email;
          }
        }

        const members: Member[] = memberRows.map((m: { id: string; user_id: string; role: string; full_name: string | null; contact: string | null }) => ({
          id: m.id,
          user_id: m.user_id,
          role: m.role,
          full_name: m.full_name,
          contact: m.contact,
          email: emailMap[m.user_id] ?? '—',
        }));

        // Load licences for this entreprise
        const { data: licencesData } = await supabase
          .from('licences')
          .select('*')
          .eq('entreprise_id', e.id)
          .order('created_at', { ascending: false });

        return { ...e, email: emailMap[e.user_id] ?? '—', members, licences: (licencesData as Licence[]) ?? [] };
      }),
    );

    setEntreprises(enriched);
    if (!silent) setLoading(false);
  }

  async function handleCreateEntreprise() {
    if (!isOnline) return;
    if (!adminEmail.trim() || !entrepriseNom.trim()) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const { error } = await supabase.rpc('create_entreprise_admin', {
        admin_email: adminEmail.trim(),
        entreprise_nom: entrepriseNom.trim(),
      });

      if (error) {
        setError(error.message);
      } else {
        setSuccess(`${lang === 'fr' ? 'Entreprise créée' : 'Company created'}: ${entrepriseNom.trim()} ${lang === 'fr' ? 'avec' : 'with'} ${adminEmail.trim()} ${lang === 'fr' ? 'comme administrateur' : 'as administrator'}`);
        setAdminEmail('');
        setEntrepriseNom('');
        setShowCreateEntreprise(false);
        await loadEntreprises();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de la création' : 'Error during creation'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddMember(tenantId: string, entrepriseNom: string) {
    if (!isOnline) return;
    if (!memberEmail.trim()) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const { error } = await supabase.rpc('add_member_to_entreprise', {
        member_email: memberEmail.trim(),
        target_tenant_id: tenantId,
        member_role: memberRole,
      });

      if (error) {
        setError(error.message);
      } else {
        setSuccess(`${memberEmail.trim()} ${lang === 'fr' ? 'ajouté à' : 'added to'} ${entrepriseNom} ${lang === 'fr' ? 'en tant que' : 'as'} ${ROLE_LABELS[memberRole]}`);
        setMemberEmail('');
        setMemberRole('commercial');
        setShowAddMember(null);
        await loadEntreprises();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de l\'ajout' : 'Error during addition'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteEntreprise(entrepriseId: number, nom: string) {
    if (!isOnline) return;
    if (!window.confirm(lang === 'fr' ? `Supprimer définitivement l'entreprise « ${nom} » et TOUTES ses données (clients, dépôts, articles, membres) ? Cette action est irréversible.` : `Permanently delete company "${nom}" and ALL its data (clients, deposits, items, members)? This action is irreversible.`)) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const { error } = await supabase.rpc('delete_entreprise', { entreprise_id: entrepriseId });

      if (error) {
        setError(error.message);
      } else {
        setSuccess(lang === 'fr' ? `Entreprise « ${nom} » supprimée avec toutes ses données` : `Company "${nom}" deleted with all its data`);
        setExpandedId(null);
        await loadEntreprises();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de la suppression' : 'Error during deletion'));
    } finally {
      setSubmitting(false);
    }
  }

  function getEntreprisePhone(e: EntrepriseRow): string {
    if (e.telephone?.trim()) return e.telephone.trim();
    const adminMember = e.members.find((m) => m.role === 'admin' && m.contact?.trim());
    if (adminMember?.contact) return adminMember.contact.trim();
    const anyMember = e.members.find((m) => m.contact?.trim());
    if (anyMember?.contact) return anyMember.contact.trim();
    return '';
  }

  function buildEntrepriseWhatsAppMessage(
    e: EntrepriseRow,
    template: WhatsAppTemplateType,
    specificLicence?: Licence,
  ): string {
    const appUrl = window.location.origin;
    const activeLic =
      specificLicence ??
      e.licences.find((l) => l.statut === 'active' || l.statut === 'demo') ??
      e.licences[0];

    if (lang === 'fr') {
      const header = `*PressingLite*\nTel: +225 01 02 20 20 62\nEmail: contact@pressinglite.com\n`;
      if (template === 'approval') {
        return `${header}\nBonjour *${e.nom}*,\n\nVotre entreprise a été *approuvée et activée* par l'administrateur sur *PressingLite*.\n\nVous pouvez dès maintenant vous connecter à votre espace :\nLien : ${appUrl}\nCompte : ${e.email}\n\nBonne utilisation de PressingLite !`;
      }
      if (template === 'licence') {
        const licLines = activeLic
          ? `\nClé de licence : *${activeLic.cle_licence}*\nType : ${activeLic.type_licence === 'demo' ? 'Démo' : 'Annuelle'}\nValidité : du ${activeLic.date_debut} au *${activeLic.date_fin}*`
          : '';
        return `${header}\nBonjour *${e.nom}*,\n\nVoici les informations de votre licence d'exploitation *PressingLite* :${licLines}\n\nAccès plateforme : ${appUrl}\nMerci de votre confiance !`;
      }
      if (template === 'reminder') {
        const endStr = activeLic ? ` le *${activeLic.date_fin}*` : ' prochainement';
        return `${header}\nBonjour *${e.nom}*,\n\nNous vous rappelons que votre licence *PressingLite* arrive à échéance${endStr}.\n\nContactez-nous pour procéder au renouvellement et conserver un accès continu à vos données.\n\nLien : ${appUrl}`;
      }
      return `${header}\nBonjour *${e.nom}*,\n\n`;
    } else {
      const header = `*PressingLite*\nTel: +225 01 02 20 20 62\nEmail: contact@pressinglite.com\n`;
      if (template === 'approval') {
        return `${header}\nHello *${e.nom}*,\n\nYour company has been *approved and activated* by the Super Administrator on *PressingLite*.\n\nYou can now sign in to your workspace:\nURL: ${appUrl}\nAccount: ${e.email}\n\nWelcome to PressingLite!`;
      }
      if (template === 'licence') {
        const licLines = activeLic
          ? `\nLicense Key: *${activeLic.cle_licence}*\nType: ${activeLic.type_licence === 'demo' ? 'Demo' : 'Annual'}\nValidity: ${activeLic.date_debut} to *${activeLic.date_fin}*`
          : '';
        return `${header}\nHello *${e.nom}*,\n\nHere are your *PressingLite* license details:${licLines}\n\nWorkspace URL: ${appUrl}\nThank you for choosing PressingLite!`;
      }
      if (template === 'reminder') {
        const endStr = activeLic ? ` on *${activeLic.date_fin}*` : ' soon';
        return `${header}\nHello *${e.nom}*,\n\nThis is a friendly reminder that your *PressingLite* license expires${endStr}.\n\nPlease contact us to renew and maintain uninterrupted access.\n\nURL: ${appUrl}`;
      }
      return `${header}\nHello *${e.nom}*,\n\n`;
    }
  }

  function getDefaultBroadcastTemplate(template: WhatsAppTemplateType): string {
    const appUrl = window.location.origin;
    if (lang === 'fr') {
      const header = `*PressingLite*\nTel: +225 01 02 20 20 62\nEmail: contact@pressinglite.com\n`;
      if (template === 'approval') {
        return `${header}\nBonjour *{nom}*,\n\nVotre entreprise est approuvée et active sur *PressingLite*.\nVous pouvez vous connecter sur ${appUrl} avec votre compte ({email}).\n\nNotre équipe reste à votre écoute !`;
      }
      if (template === 'reminder') {
        return `${header}\nBonjour *{nom}*,\n\nPensez à vérifier la validité de votre licence *PressingLite* afin d'assurer la continuité de votre activité.\n\nAccès : ${appUrl}`;
      }
      return `${header}\nBonjour *{nom}*,\n\nInformation importante concernant votre espace *PressingLite* (${appUrl}) :\n`;
    } else {
      const header = `*PressingLite*\nTel: +225 01 02 20 20 62\nEmail: contact@pressinglite.com\n`;
      if (template === 'approval') {
        return `${header}\nHello *{nom}*,\n\nYour company is approved and active on *PressingLite*.\nYou can sign in at ${appUrl} using your account ({email}).\n\nOur team is available if you need assistance!`;
      }
      if (template === 'reminder') {
        return `${header}\nHello *{nom}*,\n\nPlease check your *PressingLite* license validity to ensure uninterrupted service.\n\nAccess: ${appUrl}`;
      }
      return `${header}\nHello *{nom}*,\n\nImportant update regarding your *PressingLite* workspace (${appUrl}):\n`;
    }
  }

  function openWhatsAppModal(
    e: EntrepriseRow,
    template: WhatsAppTemplateType = 'approval',
    options?: { justApproved?: boolean; licence?: Licence; overridePhone?: string },
  ) {
    const resolvedPhone = options?.overridePhone ?? getEntreprisePhone(e);
    setWhatsAppTarget(e);
    setWhatsAppPhone(resolvedPhone);
    setWhatsAppTemplate(template);
    setWhatsAppMessage(buildEntrepriseWhatsAppMessage(e, template, options?.licence));
    setWhatsAppJustApproved(Boolean(options?.justApproved));
  }

  function openApprovedBroadcastModal() {
    setBroadcastTemplate('approval');
    setBroadcastMessage(getDefaultBroadcastTemplate('approval'));
    setBroadcastSearch('');
    setShowApprovedWhatsAppModal(true);
  }

  async function handleSaveEntreprisePhone(entrepriseId: number, phoneValue: string) {
    if (!isOnline || !phoneValue.trim()) return;
    setSavingPhone(true);
    setError(null);
    try {
      const trimmed = phoneValue.trim();
      const { error: updErr } = await supabase
        .from('entreprise')
        .update({ telephone: trimmed })
        .eq('id', entrepriseId);
      if (updErr) {
        setError(updErr.message);
      } else {
        notifyRealtimeMutation('entreprise', true);
        setEntreprises((prev) =>
          prev.map((ent) => (ent.id === entrepriseId ? { ...ent, telephone: trimmed } : ent)),
        );
        setWhatsAppTarget((prev) => (prev && prev.id === entrepriseId ? { ...prev, telephone: trimmed } : prev));
        setSuccess(lang === 'fr' ? 'Numéro WhatsApp enregistré pour cette entreprise' : 'WhatsApp number saved for this company');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de la sauvegarde du numéro' : 'Error saving phone number'));
    } finally {
      setSavingPhone(false);
    }
  }

  async function handleChangeEntrepriseStatut(entrepriseId: number, newStatut: string) {
    if (!isOnline) return;
    setError(null);
    setSuccess(null);
    const prevEnt = entreprises.find((e) => e.id === entrepriseId);
    try {
      const { error } = await supabase
        .from('entreprise')
        .update({ statut: newStatut })
        .eq('id', entrepriseId);
      if (error) {
        setError(error.message);
      } else {
        notifyRealtimeMutation('entreprise', true);
        const updatedStatut = newStatut as EntrepriseRow['statut'];
        setEntreprises((prev) =>
          prev.map((e) => (e.id === entrepriseId ? { ...e, statut: updatedStatut } : e)),
        );
        setSuccess(lang === 'fr' ? 'Statut de l\'entreprise mis à jour' : 'Company status updated');
        if (prevEnt && prevEnt.statut === 'pending' && (updatedStatut === 'active' || updatedStatut === 'demo')) {
          openWhatsAppModal({ ...prevEnt, statut: updatedStatut }, 'approval', { justApproved: true });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors du changement de statut' : 'Error during status change'));
    }
  }

  async function handleValidateEntreprise(entrepriseId: number, nom: string) {
    if (!isOnline) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const { error } = await supabase
        .from('entreprise')
        .update({ statut: 'active' })
        .eq('id', entrepriseId);
      if (error) {
        setError(error.message);
      } else {
        notifyRealtimeMutation('entreprise', true);
        setSuccess(lang === 'fr' ? `« ${nom} » validée et activée` : `"${nom}" validated and activated`);
        const targetEnt = entreprises.find((e) => e.id === entrepriseId);
        setEntreprises((prev) =>
          prev.map((e) => (e.id === entrepriseId ? { ...e, statut: 'active' } : e)),
        );
        if (targetEnt) {
          openWhatsAppModal({ ...targetEnt, statut: 'active' }, 'approval', { justApproved: true });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de la validation' : 'Error during validation'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemoveMember(memberId: string, tenantId: string) {
    if (!isOnline) return;
    if (!window.confirm(lang === 'fr' ? 'Retirer ce membre de l\'entreprise ?' : 'Remove this member from the company?')) return;
    setError(null);
    try {
      const { error } = await supabase
        .from('entreprise_members')
        .delete()
        .eq('id', memberId);

      if (error) {
        setError(error.message);
      } else {
        setSuccess(lang === 'fr' ? 'Membre retiré' : 'Member removed');
        await loadEntreprises();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors du retrait' : 'Error during removal'));
    }
  }

  async function handleChangeRole(memberId: string, newRole: string) {
    if (!isOnline) return;
    setError(null);
    try {
      const { error } = await supabase
        .from('entreprise_members')
        .update({ role: newRole })
        .eq('id', memberId);
      if (error) {
        setError(error.message);
      } else {
        setEntreprises((prev) =>
          prev.map((e) => ({
            ...e,
            members: e.members.map((m) => (m.id === memberId ? { ...m, role: newRole } : m)),
          })),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors du changement de rôle' : 'Error during role change'));
    }
  }

  function openEditModal(m: Member) {
    setEditMember(m);
    setEditFullName(m.full_name ?? '');
    setEditContact(m.contact ?? '');
    setEditEmail(m.email);
  }

  async function handleSaveEdit() {
    if (!isOnline) return;
    if (!editMember) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const { error } = await supabase
        .from('entreprise_members')
        .update({ full_name: editFullName.trim() || null, contact: editContact.trim() || null })
        .eq('id', editMember.id);

      if (error) {
        setError(error.message);
      } else {
        setSuccess(lang === 'fr' ? 'Profil mis à jour' : 'Profile updated');
        setEditMember(null);
        await loadEntreprises();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de l\'enregistrement' : 'Error during saving'));
    } finally {
      setSubmitting(false);
    }
  }

  function openLicenceModal(entrepriseId: number) {
    const today = new Date().toISOString().slice(0, 10);
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    setLicenceStart(today);
    setLicenceEnd(nextYear.toISOString().slice(0, 10));
    setLicencePrix('100000');
    setShowLicenceModal(entrepriseId);
  }

  async function handleGenerateLicence(entrepriseId: number) {
    if (!isOnline) return;
    setGeneratingLicence(true);
    setError(null);
    setSuccess(null);

    try {
      const { error } = await supabase.rpc('generate_licence', {
        p_entreprise_id: entrepriseId,
        p_date_debut: licenceStart,
        p_date_fin: licenceEnd,
        p_prix: parseFloat(licencePrix) || 0,
      });

      if (error) {
        setError(error.message);
      } else {
        notifyRealtimeMutation('licences', true);
        setSuccess(lang === 'fr' ? 'Licence générée avec succès' : 'License generated successfully');
        setShowLicenceModal(null);
        await loadEntreprises(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de la génération' : 'Error during generation'));
    } finally {
      setGeneratingLicence(false);
    }
  }

  async function handleRevokeLicence(licenceId: string) {
    if (!isOnline) return;
    if (!window.confirm(lang === 'fr' ? "Révoquer cette licence ? L'entreprise perdra l'accès." : 'Revoke this license? The company will lose access.')) return;
    setError(null);
    try {
      const { error } = await supabase.rpc('revoke_licence', { p_licence_id: licenceId });
      if (error) {
        setError(error.message);
      } else {
        notifyRealtimeMutation('licences', true);
        setSuccess(lang === 'fr' ? 'Licence révoquée' : 'License revoked');
        await loadEntreprises(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de la révocation' : 'Error during revocation'));
    }
  }

  function openEditLicenceModal(lic: Licence) {
    setEditLicence(lic);
    setEditLicenceStart(lic.date_debut);
    setEditLicenceEnd(lic.date_fin);
    setEditLicencePrix(lic.prix != null ? String(lic.prix) : '');
    setEditLicenceStatut(lic.statut);
  }

  async function handleSaveLicenceEdit() {
    if (!isOnline) return;
    if (!editLicence) return;
    setSavingLicenceEdit(true);
    setError(null);
    setSuccess(null);

    try {
      const updates: Record<string, unknown> = {
        date_debut: editLicenceStart,
        date_fin: editLicenceEnd,
        statut: editLicenceStatut,
      };
      if (editLicencePrix.trim() !== '') {
        updates.prix = parseFloat(editLicencePrix) || 0;
      }

      const { error } = await supabase
        .from('licences')
        .update(updates)
        .eq('id', editLicence.id);

      if (error) {
        setError(error.message);
      } else {
        notifyRealtimeMutation('licences', true);
        setSuccess(lang === 'fr' ? 'Licence modifiée avec succès' : 'License updated successfully');
        setEditLicence(null);
        await loadEntreprises(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de la modification' : 'Error during update'));
    } finally {
      setSavingLicenceEdit(false);
    }
  }

  async function handleDeleteLicence(licenceId: string) {
    if (!isOnline) return;
    if (!window.confirm(lang === 'fr' ? 'Supprimer définitivement cette licence ?' : 'Permanently delete this license?')) return;
    setError(null);
    try {
      const { error } = await supabase.from('licences').delete().eq('id', licenceId);
      if (error) {
        setError(error.message);
      } else {
        notifyRealtimeMutation('licences', true);
        setSuccess(lang === 'fr' ? 'Licence supprimée' : 'License deleted');
        await loadEntreprises(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de la suppression' : 'Error during deletion'));
    }
  }

  async function handleApproveJoinRequest(requestId: string) {
    if (!isOnline) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const { error } = await supabase.rpc('super_admin_approve_join_request', { p_request_id: requestId });
      if (error) {
        setError(error.message);
      } else {
        setSuccess(lang === 'fr' ? 'Demande approuvée — utilisateur ajouté à l\'entreprise' : 'Request approved — user added to company');
        await loadJoinRequests();
        await loadEntreprises();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors de l\'approbation' : 'Error during approval'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRejectJoinRequest(requestId: string) {
    if (!isOnline) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const { error } = await supabase.rpc('super_admin_reject_join_request', { p_request_id: requestId });
      if (error) {
        setError(error.message);
      } else {
        setSuccess(lang === 'fr' ? 'Demande rejetée' : 'Request rejected');
        await loadJoinRequests();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === 'fr' ? 'Erreur lors du rejet' : 'Error during rejection'));
    } finally {
      setSubmitting(false);
    }
  }

  function copyLicenceKey(key: string) {
    navigator.clipboard.writeText(key);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  function getLicenceStatusBadge(statut: string) {
    switch (statut) {
      case 'active':
        return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'demo':
        return 'bg-sky-100 text-sky-700 border-sky-200';
      case 'expired':
        return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'revoked':
        return 'bg-red-100 text-red-700 border-red-200';
      default:
        return 'bg-slate-100 text-slate-600 border-slate-200';
    }
  }

  function getLicenceStatusLabel(statut: string) {
    switch (statut) {
      case 'active': return 'Active';
      case 'demo': return lang === 'fr' ? 'Démo' : 'Demo';
      case 'expired': return lang === 'fr' ? 'Expirée' : 'Expired';
      case 'revoked': return lang === 'fr' ? 'Révoquée' : 'Revoked';
      default: return statut;
    }
  }

  if (!isSuperAdmin) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-8 text-center">
          <Shield className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-slate-900">{lang === 'fr' ? 'Accès restreint' : 'Restricted access'}</h2>
          <p className="text-sm text-slate-500 mt-1">
            {lang === 'fr' ? 'Cette page est réservée au super-administrateur de la plateforme.' : 'This page is reserved for the platform super-administrator.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {!isOnline && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-800">
              {lang === 'fr' ? 'Hors ligne — actions administratives désactivées' : 'Offline — admin actions disabled'}
            </p>
            <p className="text-xs text-red-600 mt-0.5">
              {lang === 'fr'
                ? "Vous êtes hors ligne. Les actions (approuver, suspendre, générer une licence, etc.) ne seront pas enregistrées. Reconnectez-vous avant de continuer."
                : 'You are offline. Actions (approve, suspend, generate licence, etc.) will not be saved. Reconnect before continuing.'}
            </p>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{lang === 'fr' ? 'Super Administration' : 'Super Administration'}</h2>
          <p className="text-sm text-slate-500 mt-1">
            {lang === 'fr' ? 'Gérez les entreprises, leurs administrateurs et leurs utilisateurs.' : 'Manage companies, their administrators and their users.'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={openApprovedBroadcastModal}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors shadow-sm"
          >
            <MessageCircle className="w-4 h-4" />
            {lang === 'fr' ? 'WhatsApp entreprises approuvées' : 'WhatsApp approved companies'}
            <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-full bg-white/20 text-xs font-semibold">
              {entreprises.filter((e) => e.statut === 'active' || e.statut === 'demo').length}
            </span>
          </button>
          <button
            onClick={() => setShowCreateEntreprise(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors"
          >
            <Building2 className="w-4 h-4" /> {lang === 'fr' ? 'Créer une entreprise' : 'Create company'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
        <button
          onClick={() => setActiveTab('entreprises')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all ${activeTab === 'entreprises' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <Building2 className="w-4 h-4" /> {lang === 'fr' ? 'Entreprises' : 'Companies'} <span className="text-xs text-slate-400">({entreprises.length})</span>
          {entreprises.some((e) => e.statut === 'pending') && (
            <span className="text-xs font-bold text-amber-600">
              ({entreprises.filter((e) => e.statut === 'pending').length} {lang === 'fr' ? 'à valider' : 'pending'})
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('licences')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all ${activeTab === 'licences' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <BarChart3 className="w-4 h-4" /> {lang === 'fr' ? 'Ventes licences' : 'License sales'} <span className="text-xs text-slate-400">({allLicences.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('join_requests')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all ${activeTab === 'join_requests' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <UserCheck className="w-4 h-4" /> {lang === 'fr' ? "Demandes" : 'Requests'} {joinRequests.length > 0 && <span className="text-xs font-bold text-amber-600">({joinRequests.length})</span>}
        </button>
        <button
          onClick={() => setActiveTab('usage')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all ${activeTab === 'usage' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <Activity className="w-4 h-4" /> {lang === 'fr' ? 'Utilisation' : 'Usage'}
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

      {/* Create entreprise modal */}
      {showCreateEntreprise && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowCreateEntreprise(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">{lang === 'fr' ? 'Créer une entreprise' : 'Create company'}</h3>
              <button onClick={() => setShowCreateEntreprise(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-500">
              {lang === 'fr' ? "L'utilisateur doit d'abord créer un compte avec cet email, puis vous pourrez le désigner comme administrateur de la nouvelle entreprise." : 'The user must first create an account with this email, then you can designate them as administrator of the new company.'}
            </p>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{lang === 'fr' ? "Email de l'administrateur" : 'Administrator email'}</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  placeholder="admin@exemple.com"
                  className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('auth.companyName')}</label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={entrepriseNom}
                  onChange={(e) => setEntrepriseNom(e.target.value)}
                  placeholder="Ex: Pressing du Centre"
                  className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowCreateEntreprise(false)}
                className="px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleCreateEntreprise}
                disabled={submitting || !adminEmail.trim() || !entrepriseNom.trim()}
                className="flex-1 px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crown className="w-4 h-4" />}
                {submitting ? (lang === 'fr' ? 'Création…' : 'Creating…') : (lang === 'fr' ? 'Créer' : 'Create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add member modal */}
      {showAddMember !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowAddMember(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">{lang === 'fr' ? 'Ajouter un utilisateur' : 'Add user'}</h3>
              <button onClick={() => setShowAddMember(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-500">
              {entreprises.find((e) => e.id === showAddMember)?.nom} — {lang === 'fr' ? "L'utilisateur doit d'abord créer un compte avec cet email." : 'The user must first create an account with this email.'}
            </p>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{lang === 'fr' ? "Email de l'utilisateur" : 'User email'}</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="email"
                  value={memberEmail}
                  onChange={(e) => setMemberEmail(e.target.value)}
                  placeholder="utilisateur@exemple.com"
                  className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{lang === 'fr' ? 'Rôle' : 'Role'}</label>
              <select
                value={memberRole}
                onChange={(e) => setMemberRole(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white"
              >
                <option value="admin">{ROLE_LABELS.admin}</option>
                <option value="gerant">{ROLE_LABELS.gerant}</option>
                <option value="commercial">{ROLE_LABELS.commercial}</option>
              </select>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowAddMember(null)}
                className="px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => {
                  const ent = entreprises.find((e) => e.id === showAddMember);
                  if (ent) handleAddMember(ent.user_id, ent.nom);
                }}
                disabled={submitting || !memberEmail.trim()}
                className="flex-1 px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                {submitting ? (lang === 'fr' ? 'Ajout…' : 'Adding…') : (lang === 'fr' ? 'Ajouter' : 'Add')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit member modal */}
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
                <input type="email" value={editEmail} disabled className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm bg-slate-50 text-slate-400" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{lang === 'fr' ? 'Nom et prénoms' : 'Full name'}</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input type="text" value={editFullName} onChange={(e) => setEditFullName(e.target.value)} placeholder={lang === 'fr' ? 'Jean Dupont' : 'John Doe'} className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{lang === 'fr' ? 'Contact' : 'Contact'}</label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input type="tel" value={editContact} onChange={(e) => setEditContact(e.target.value)} placeholder="+225 07 00 00 00" className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent" />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setEditMember(null)} className="px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors">{t('common.cancel')}</button>
              <button onClick={handleSaveEdit} disabled={submitting} className="flex-1 px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {submitting ? (lang === 'fr' ? 'Enregistrement…' : 'Saving…') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Licence sales dashboard */}
      {activeTab === 'licences' && (
        <div className="space-y-4">
          {/* KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <button onClick={() => setLicenceFilter('all')} className={`text-left p-4 rounded-xl border transition-all ${licenceFilter === 'all' ? 'border-sky-300 bg-sky-50 ring-1 ring-sky-200' : 'border-slate-100 bg-white hover:border-slate-200'}`}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center"><BarChart3 className="w-4 h-4 text-sky-600" /></div>
              </div>
              <p className="text-2xl font-bold text-slate-900">{allLicences.length}</p>
              <p className="text-xs text-slate-500 mt-0.5">{lang === 'fr' ? 'Total licences' : 'Total licenses'}</p>
            </button>
            <button onClick={() => setLicenceFilter('active')} className={`text-left p-4 rounded-xl border transition-all ${licenceFilter === 'active' ? 'border-emerald-300 bg-emerald-50 ring-1 ring-emerald-200' : 'border-slate-100 bg-white hover:border-slate-200'}`}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center"><TrendingUp className="w-4 h-4 text-emerald-600" /></div>
              </div>
              <p className="text-2xl font-bold text-emerald-600">{activeLicences.filter((l) => new Date(l.date_fin) >= now).length}</p>
              <p className="text-xs text-slate-500 mt-0.5">{lang === 'fr' ? 'Actives' : 'Active'}</p>
            </button>
            <button onClick={() => setLicenceFilter('expiring')} className={`text-left p-4 rounded-xl border transition-all ${licenceFilter === 'expiring' ? 'border-amber-300 bg-amber-50 ring-1 ring-amber-200' : 'border-slate-100 bg-white hover:border-slate-200'}`}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center"><AlertTriangle className="w-4 h-4 text-amber-600" /></div>
              </div>
              <p className="text-2xl font-bold text-amber-600">{expiringLicences.length}</p>
              <p className="text-xs text-slate-500 mt-0.5">{lang === 'fr' ? 'Expirent < 30j' : 'Expiring < 30d'}</p>
            </button>
            <button onClick={() => setLicenceFilter('expired')} className={`text-left p-4 rounded-xl border transition-all ${licenceFilter === 'expired' ? 'border-red-300 bg-red-50 ring-1 ring-red-200' : 'border-slate-100 bg-white hover:border-slate-200'}`}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center"><Clock className="w-4 h-4 text-red-600" /></div>
              </div>
              <p className="text-2xl font-bold text-red-600">{expiredLicences.length}</p>
              <p className="text-xs text-slate-500 mt-0.5">{lang === 'fr' ? 'Expirées' : 'Expired'}</p>
            </button>
            <button onClick={() => setLicenceFilter('demo')} className={`text-left p-4 rounded-xl border transition-all ${licenceFilter === 'demo' ? 'border-sky-300 bg-sky-50 ring-1 ring-sky-200' : 'border-slate-100 bg-white hover:border-slate-200'}`}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center"><Shield className="w-4 h-4 text-slate-500" /></div>
              </div>
              <p className="text-2xl font-bold text-slate-900">{demoLicences.length}</p>
              <p className="text-xs text-slate-500 mt-0.5">{lang === 'fr' ? 'Démo' : 'Demo'}</p>
            </button>
            <button onClick={() => setLicenceFilter('revoked')} className={`text-left p-4 rounded-xl border transition-all ${licenceFilter === 'revoked' ? 'border-red-300 bg-red-50 ring-1 ring-red-200' : 'border-slate-100 bg-white hover:border-slate-200'}`}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center"><Ban className="w-4 h-4 text-red-600" /></div>
              </div>
              <p className="text-2xl font-bold text-red-600">{revokedLicences.length}</p>
              <p className="text-xs text-slate-500 mt-0.5">{lang === 'fr' ? 'Révoquées' : 'Revoked'}</p>
            </button>
          </div>

          {/* Secondary stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="flex items-center gap-3 bg-white rounded-xl border border-slate-100 p-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0"><TrendingUp className="w-4 h-4 text-emerald-600" /></div>
              <div>
                <p className="text-lg font-bold text-emerald-600">{allLicences.reduce((sum, l) => sum + (Number(l.prix) || 0), 0).toLocaleString('fr-FR')}</p>
                <p className="text-xs text-slate-500">{lang === 'fr' ? 'CA total (FCFA)' : 'Total rev. (FCFA)'}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-white rounded-xl border border-slate-100 p-3">
              <div className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center flex-shrink-0"><KeyRound className="w-4 h-4 text-sky-600" /></div>
              <div>
                <p className="text-lg font-bold text-slate-900">{annualLicences.length}</p>
                <p className="text-xs text-slate-500">{lang === 'fr' ? 'Annuelles' : 'Annual'}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-white rounded-xl border border-slate-100 p-3">
              <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0"><AlertTriangle className="w-4 h-4 text-red-500" /></div>
              <div>
                <p className="text-lg font-bold text-red-600">{entreprisesWithoutActiveLicence.length}</p>
                <p className="text-xs text-slate-500">{lang === 'fr' ? 'Sans licence' : 'No license'}</p>
              </div>
            </div>
          </div>

          {/* Entreprises without active licence */}
          {entreprisesWithoutActiveLicence.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-red-500" />
                <p className="text-sm font-semibold text-red-700">
                  {lang === 'fr' ? 'Entreprises sans licence active' : 'Companies without active license'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {entreprisesWithoutActiveLicence.map((e) => (
                  <span key={e.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-lg border border-red-200 text-xs font-medium text-red-700">
                    <Building2 className="w-3 h-3" /> {e.nom}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Filtered licence list */}
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700">
                {licenceFilter === 'all' ? (lang === 'fr' ? 'Toutes les licences' : 'All licenses')
                  : licenceFilter === 'active' ? (lang === 'fr' ? 'Licences actives' : 'Active licenses')
                  : licenceFilter === 'expiring' ? (lang === 'fr' ? 'Expirent bientôt' : 'Expiring soon')
                  : licenceFilter === 'expired' ? (lang === 'fr' ? 'Licences expirées' : 'Expired licenses')
                  : licenceFilter === 'revoked' ? (lang === 'fr' ? 'Licences révoquées' : 'Revoked licenses')
                  : (lang === 'fr' ? 'Licences démo' : 'Demo licenses')}
                {' '}({filteredLicences.length})
              </p>
              {licenceFilter !== 'all' && (
                <button onClick={() => setLicenceFilter('all')} className="text-xs text-sky-600 hover:text-sky-700 font-medium">
                  {lang === 'fr' ? 'Voir tout' : 'See all'}
                </button>
              )}
            </div>
            {filteredLicences.length === 0 ? (
              <div className="py-8 text-center">
                <KeyRound className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-400">{lang === 'fr' ? 'Aucune licence dans cette catégorie.' : 'No licenses in this category.'}</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filteredLicences.map((lic) => {
                  const daysLeft = Math.ceil((new Date(lic.date_fin).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                  return (
                    <div key={lic.id} className="flex items-center justify-between p-4 hover:bg-slate-50/50 transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${getLicenceStatusBadge(daysLeft < 0 ? 'expired' : lic.statut)}`}>
                          <KeyRound className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-slate-900">{lic.entrepriseNom}</p>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${getLicenceStatusBadge(daysLeft < 0 ? 'expired' : lic.statut)}`}>
                              {daysLeft < 0 ? (lang === 'fr' ? 'Expirée' : 'Expired') : getLicenceStatusLabel(lic.statut)}
                            </span>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${lic.type_licence === 'demo' ? 'bg-slate-100 text-slate-600 border-slate-200' : 'bg-sky-100 text-sky-700 border-sky-200'}`}>
                              {lic.type_licence === 'demo' ? 'Demo' : (lang === 'fr' ? 'Annuelle' : 'Annual')}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mt-1 flex-wrap">
                            <span className="flex items-center gap-1 text-xs text-slate-400">
                              <Calendar className="w-3 h-3" />
                              {lic.date_debut} → {lic.date_fin}
                            </span>
                            {lic.statut === 'active' && daysLeft >= 0 && (
                              <span className={`text-xs font-medium ${daysLeft <= 30 ? 'text-amber-600' : daysLeft <= 60 ? 'text-sky-600' : 'text-emerald-600'}`}>
                                {daysLeft} {lang === 'fr' ? 'jours restants' : 'days left'}
                              </span>
                            )}
                            <code className="text-xs font-mono text-slate-400">{lic.cle_licence}</code>
                            {lic.prix != null && (
                              <span className="text-xs font-semibold text-slate-600">{Number(lic.prix).toLocaleString('fr-FR')} FCFA</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                        <button
                          onClick={() => openEditLicenceModal(lic)}
                          className="p-2 rounded-lg text-slate-300 hover:text-sky-600 hover:bg-sky-50 transition-colors"
                          title={lang === 'fr' ? 'Modifier' : 'Edit'}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        {lic.statut === 'active' && (
                          <button
                            onClick={() => handleRevokeLicence(lic.id)}
                            className="p-2 rounded-lg text-slate-300 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                            title={lang === 'fr' ? 'Révoquer' : 'Revoke'}
                          >
                            <Ban className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteLicence(lic.id)}
                          className="p-2 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                          title={lang === 'fr' ? 'Supprimer' : 'Delete'}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'join_requests' && (
        <div className="space-y-4">
          {joinRequests.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-12 text-center">
              <UserCheck className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-400">{lang === 'fr' ? 'Aucune demande en attente.' : 'No pending requests.'}</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100">
                <p className="text-sm font-semibold text-slate-700">
                  {lang === 'fr' ? 'Demandes d\'adhésion en attente' : 'Pending join requests'} ({joinRequests.length})
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {lang === 'fr' ? 'Ces utilisateurs se sont inscrits avec un nom d\'entreprise existant.' : 'These users signed up with an existing company name.'}
                </p>
              </div>
              <div className="divide-y divide-slate-100">
                {joinRequests.map((req) => (
                  <div key={req.id} className="flex items-center justify-between p-4 hover:bg-slate-50/50 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                        <User className="w-5 h-5 text-amber-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">{req.full_name || req.user_email}</p>
                        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                          {req.full_name && <span className="flex items-center gap-1 text-xs text-slate-500"><Mail className="w-3 h-3" />{req.user_email}</span>}
                          {req.contact && <span className="flex items-center gap-1 text-xs text-slate-400"><Phone className="w-3 h-3" />{req.contact}</span>}
                          <span className="flex items-center gap-1 text-xs text-slate-500">
                            <Building2 className="w-3 h-3" />{req.entreprise_nom}
                          </span>
                          <span className="text-xs text-slate-400">
                            {new Date(req.created_at).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US')}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleApproveJoinRequest(req.id)}
                        disabled={submitting}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500 text-white text-xs font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        {lang === 'fr' ? 'Approuver' : 'Approve'}
                      </button>
                      <button
                        onClick={() => handleRejectJoinRequest(req.id)}
                        disabled={submitting}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 text-red-600 text-xs font-medium hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <X className="w-3.5 h-3.5" />
                        {lang === 'fr' ? 'Rejeter' : 'Reject'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'usage' && (
        <UsageTab stats={usageStats} loading={usageLoading} sortBy={usageSortBy} setSortBy={setUsageSortBy} lang={lang} />
      )}

      {activeTab === 'entreprises' && <>
      {/* Pending validation banner */}
      {(() => {
        const pending = entreprises.filter((e) => e.statut === 'pending');
        if (pending.length === 0) return null;
        return (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                <Clock className="w-4 h-4 text-amber-600" />
              </div>
              <p className="text-sm font-semibold text-amber-800">
                {lang === 'fr'
                  ? `${pending.length} entreprise${pending.length > 1 ? 's' : ''} en attente de validation`
                  : `${pending.length} compan${pending.length > 1 ? 'ies' : 'y'} pending validation`}
              </p>
            </div>
            <div className="space-y-2">
              {pending.map((e) => {
                const hasGps = e.latitude != null && e.longitude != null;
                const mapUrl = hasGps
                  ? `https://www.openstreetmap.org/export/embed.html?bbox=${e.longitude! - 0.01},${e.latitude! - 0.008},${e.longitude! + 0.01},${e.latitude! + 0.008}&layer=mapnik&marker=${e.latitude},${e.longitude}`
                  : null;
                const gmapsUrl = hasGps
                  ? `https://www.google.com/maps?q=${e.latitude},${e.longitude}`
                  : null;
                return (
                <div key={e.id} className="bg-white rounded-lg border border-amber-100 p-3 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                        <Building2 className="w-4 h-4 text-amber-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">{e.nom}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="flex items-center gap-1 text-xs text-slate-500 truncate"><Crown className="w-3 h-3 text-amber-500 flex-shrink-0" />{e.email}</span>
                          <span className="flex items-center gap-1 text-xs text-slate-400 flex-shrink-0"><Users className="w-3 h-3" />{e.members.length}</span>
                          {e.created_at && (
                            <span className="text-xs text-slate-400 flex-shrink-0">{new Date(e.created_at).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US')}</span>
                          )}
                          {hasGps && (
                            <span className="flex items-center gap-1 text-xs text-sky-600 font-medium flex-shrink-0">
                              <MapPin className="w-3 h-3" />
                              {e.latitude!.toFixed(4)}, {e.longitude!.toFixed(4)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 sm:ml-2">
                      <button
                        onClick={() => handleValidateEntreprise(e.id, e.nom)}
                        disabled={submitting}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500 text-white text-xs font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        {lang === 'fr' ? 'Valider & notifier' : 'Validate & notify'}
                      </button>
                      <button
                        type="button"
                        onClick={() => openWhatsAppModal(e, 'approval')}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-500 text-white text-xs font-medium hover:bg-green-600 transition-colors"
                        title={lang === 'fr' ? 'Envoyer un message WhatsApp' : 'Send WhatsApp message'}
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        WhatsApp
                      </button>
                      <button
                        onClick={() => handleDeleteEntreprise(e.id, e.nom)}
                        disabled={submitting}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 text-red-600 text-xs font-medium hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <X className="w-3.5 h-3.5" />
                        {lang === 'fr' ? 'Refuser' : 'Reject'}
                      </button>
                    </div>
                  </div>
                  {mapUrl && (
                    <div className="space-y-1.5">
                      <iframe
                        src={mapUrl}
                        className="w-full h-48 rounded-lg border border-slate-200"
                        title={`Map — ${e.nom}`}
                        loading="lazy"
                      />
                      {gmapsUrl && (
                        <a
                          href={gmapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs text-sky-600 hover:text-sky-700 font-medium"
                        >
                          <Navigation className="w-3.5 h-3.5" />
                          {lang === 'fr' ? 'Voir sur Google Maps' : 'View on Google Maps'}
                        </a>
                      )}
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Search & filter bar */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-3 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={lang === 'fr' ? 'Rechercher par nom, email ou membre…' : 'Search by name, email or member…'}
              className="w-full pl-10 pr-9 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              <select
                value={statutFilter}
                onChange={(e) => setStatutFilter(e.target.value as 'all' | 'active' | 'demo' | 'suspended')}
                className="pl-9 pr-8 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white"
              >
                <option value="all">{lang === 'fr' ? 'Tous statuts' : 'All statuses'}</option>
                <option value="pending">{lang === 'fr' ? 'En attente' : 'Pending'}</option>
                <option value="active">{lang === 'fr' ? 'Actives' : 'Active'}</option>
                <option value="demo">{lang === 'fr' ? 'Démo' : 'Demo'}</option>
                <option value="suspended">{lang === 'fr' ? 'Suspendues' : 'Suspended'}</option>
              </select>
            </div>
            <select
              value={licenceFilterEnt}
              onChange={(e) => setLicenceFilterEnt(e.target.value as 'all' | 'with_active' | 'expiring' | 'expired' | 'no_licence')}
              className="px-3 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white"
            >
              <option value="all">{lang === 'fr' ? 'Toutes licences' : 'All licenses'}</option>
              <option value="with_active">{lang === 'fr' ? 'Licence active' : 'Active license'}</option>
              <option value="expiring">{lang === 'fr' ? 'Expirent < 30j' : 'Expiring < 30d'}</option>
              <option value="expired">{lang === 'fr' ? 'Licence expirée' : 'Expired license'}</option>
              <option value="no_licence">{lang === 'fr' ? 'Sans licence' : 'No license'}</option>
            </select>
            <div className="relative">
              <ArrowUpDown className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'name' | 'name_desc' | 'members' | 'licence_end')}
                className="pl-9 pr-8 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white"
              >
                <option value="name">{lang === 'fr' ? 'Nom A→Z' : 'Name A→Z'}</option>
                <option value="name_desc">{lang === 'fr' ? 'Nom Z→A' : 'Name Z→A'}</option>
                <option value="members">{lang === 'fr' ? 'Plus de membres' : 'Most members'}</option>
                <option value="licence_end">{lang === 'fr' ? 'Licence fin proche' : 'License ending soon'}</option>
              </select>
            </div>
          </div>
        </div>
        {(searchQuery || statutFilter !== 'all' || licenceFilterEnt !== 'all') && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              {filteredEntreprises.length} / {entreprises.length} {lang === 'fr' ? 'entreprises' : 'companies'}
            </p>
            <button
              onClick={() => { setSearchQuery(''); setStatutFilter('all'); setLicenceFilterEnt('all'); }}
              className="text-xs text-sky-600 hover:text-sky-700 font-medium"
            >
              {lang === 'fr' ? 'Réinitialiser' : 'Reset'}
            </button>
          </div>
        )}
      </div>

      {/* Entreprises list */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-sky-500 animate-spin" />
          </div>
        ) : entreprises.length === 0 ? (
          <div className="py-12 text-center">
            <Building2 className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-400">{lang === 'fr' ? 'Aucune entreprise pour le moment.' : 'No company yet.'}</p>
          </div>
        ) : filteredEntreprises.length === 0 ? (
          <div className="py-12 text-center">
            <Search className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-400">{lang === 'fr' ? 'Aucune entreprise ne correspond à votre recherche.' : 'No company matches your search.'}</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredEntreprises.map((e) => {
              const isExpanded = expandedId === e.id;
              return (
                <div key={e.id}>
                  {/* Entreprise header row */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : e.id)}
                    className="w-full flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 hover:bg-slate-50/50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-sky-50 flex items-center justify-center flex-shrink-0">
                        <Building2 className="w-5 h-5 text-sky-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">{e.nom}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="flex items-center gap-1 text-xs text-slate-500 truncate">
                            <Crown className="w-3 h-3 text-amber-500 flex-shrink-0" />
                            {e.email}
                          </span>
                          <span className="flex items-center gap-1 text-xs text-slate-400 flex-shrink-0">
                            <Users className="w-3 h-3" />
                            {e.members.length} {lang === 'fr' ? `membre${e.members.length > 1 ? 's' : ''}` : `member${e.members.length > 1 ? 's' : ''}`}
                          </span>
                          {getEntreprisePhone(e) && (
                            <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium flex-shrink-0">
                              <Phone className="w-3 h-3" />
                              {getEntreprisePhone(e)}
                            </span>
                          )}
                          {e.latitude != null && e.longitude != null && (
                            <span className="flex items-center gap-0.5 text-xs text-sky-500 font-medium flex-shrink-0">
                              <MapPin className="w-3 h-3" />GPS
                            </span>
                          )}
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border flex-shrink-0 ${e.statut === 'pending' ? 'bg-amber-100 text-amber-700 border-amber-200' : e.statut === 'demo' ? 'bg-sky-100 text-sky-700 border-sky-200' : e.statut === 'suspended' ? 'bg-red-100 text-red-700 border-red-200' : 'bg-emerald-100 text-emerald-700 border-emerald-200'}`}>
                            {e.statut === 'pending' ? (lang === 'fr' ? 'En attente' : 'Pending') : e.statut === 'demo' ? (lang === 'fr' ? 'Démo' : 'Demo') : e.statut === 'suspended' ? (lang === 'fr' ? 'Suspendue' : 'Suspended') : (lang === 'fr' ? 'Active' : 'Active')}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 self-end sm:self-auto">
                      <select
                        onClick={(ev) => ev.stopPropagation()}
                        value={e.statut}
                        onChange={(ev) => handleChangeEntrepriseStatut(e.id, ev.target.value)}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white"
                      >
                        <option value="pending">{lang === 'fr' ? 'En attente' : 'Pending'}</option>
                        <option value="active">{lang === 'fr' ? 'Active' : 'Active'}</option>
                        <option value="demo">{lang === 'fr' ? 'Démo' : 'Demo'}</option>
                        <option value="suspended">{lang === 'fr' ? 'Suspendue' : 'Suspended'}</option>
                      </select>
                      {e.statut === 'pending' && (
                        <button
                          onClick={(ev) => {
                            ev.stopPropagation();
                            handleValidateEntreprise(e.id, e.nom);
                          }}
                          disabled={submitting}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title={lang === 'fr' ? 'Valider et notifier via WhatsApp' : 'Validate and notify via WhatsApp'}
                        >
                          <Check className="w-3.5 h-3.5" />
                          {lang === 'fr' ? 'Valider' : 'Validate'}
                        </button>
                      )}
                      {(e.statut === 'active' || e.statut === 'demo' || e.statut === 'pending') && (
                        <button
                          type="button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            openWhatsAppModal(e, 'approval');
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500 text-white text-xs font-medium hover:bg-green-600 transition-colors"
                          title={lang === 'fr' ? 'Envoyer un message WhatsApp à cette entreprise' : 'Send WhatsApp message to this company'}
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          WhatsApp
                        </button>
                      )}
                      <button
                        onClick={(ev) => {
                          ev.stopPropagation();
                          handleDeleteEntreprise(e.id, e.nom);
                        }}
                        disabled={submitting}
                        className="p-2 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                        title={lang === 'fr' ? "Supprimer l'entreprise" : 'Delete company'}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      {isExpanded ? (
                        <ChevronDown className="w-5 h-5 text-slate-400" />
                      ) : (
                        <ChevronRight className="w-5 h-5 text-slate-400" />
                      )}
                    </div>
                  </button>

                  {/* Expanded members list */}
                  {isExpanded && (
                    <div className="bg-slate-50/30 border-t border-slate-100 px-4 py-3 space-y-2">
                      {e.members.map((m) => {
                        const RoleIcon = ROLE_ICONS[m.role] ?? UserCog;
                        return (
                          <div key={m.id} className="bg-white rounded-lg border border-slate-100 p-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${ROLE_COLORS[m.role] ?? ROLE_COLORS.commercial}`}>
                                <RoleIcon className="w-4 h-4" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-slate-900 truncate">{m.full_name || m.email}</p>
                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                  {m.full_name && <span className="flex items-center gap-1 text-xs text-slate-500 truncate"><Mail className="w-3 h-3 flex-shrink-0" />{m.email}</span>}
                                  {m.contact && <span className="flex items-center gap-1 text-xs text-slate-400 flex-shrink-0"><Phone className="w-3 h-3" />{m.contact}</span>}
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border flex-shrink-0 ${ROLE_COLORS[m.role] ?? ROLE_COLORS.commercial}`}>{ROLE_LABELS[m.role] ?? m.role}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                {m.contact && (
                                  <button
                                    type="button"
                                    onClick={() => openWhatsAppModal(e, 'approval', { overridePhone: m.contact! })}
                                    className="p-2 rounded-lg text-green-600 hover:bg-green-50 transition-colors"
                                    title={lang === 'fr' ? 'Contacter sur WhatsApp' : 'Contact via WhatsApp'}
                                  >
                                    <MessageCircle className="w-4 h-4" />
                                  </button>
                                )}
                                <button
                                  onClick={() => openEditModal(m)}
                                  className="p-2 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors"
                                  title={lang === 'fr' ? 'Modifier le profil' : 'Edit profile'}
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleRemoveMember(m.id, e.user_id)}
                                  className="p-2 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                                  title={lang === 'fr' ? 'Retirer' : 'Remove'}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 mt-2 pl-11">
                              <select
                                value={m.role}
                                onChange={(ev) => handleChangeRole(m.id, ev.target.value)}
                                className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white"
                              >
                                <option value="admin">{ROLE_LABELS.admin}</option>
                                <option value="gerant">{ROLE_LABELS.gerant}</option>
                                <option value="commercial">{ROLE_LABELS.commercial}</option>
                              </select>
                            </div>
                          </div>
                        );
                      })}
                      <button
                        onClick={() => {
                          setShowAddMember(e.id);
                          setMemberEmail('');
                          setMemberRole('commercial');
                        }}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-slate-300 text-sm font-medium text-sky-600 hover:bg-sky-50 hover:border-sky-300 transition-colors"
                      >
                        <UserPlus className="w-4 h-4" />
                        {lang === 'fr' ? 'Ajouter un utilisateur' : 'Add user'}
                      </button>

                      {/* GPS location section */}
                      {e.latitude != null && e.longitude != null && (() => {
                        const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${e.longitude! - 0.01},${e.latitude! - 0.008},${e.longitude! + 0.01},${e.latitude! + 0.008}&layer=mapnik&marker=${e.latitude},${e.longitude}`;
                        const gmapsUrl = `https://www.google.com/maps?q=${e.latitude},${e.longitude}`;
                        return (
                          <div className="mt-3 pt-3 border-t border-slate-200">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <MapPin className="w-4 h-4 text-sky-600" />
                                <p className="text-sm font-semibold text-slate-700">{lang === 'fr' ? 'Position GPS' : 'GPS location'}</p>
                              </div>
                              <a
                                href={gmapsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs text-sky-600 hover:text-sky-700 font-medium"
                              >
                                <Navigation className="w-3.5 h-3.5" />
                                {lang === 'fr' ? 'Google Maps' : 'Google Maps'}
                              </a>
                            </div>
                            <iframe
                              src={mapUrl}
                              className="w-full h-48 rounded-lg border border-slate-200"
                              title={`Map — ${e.nom}`}
                              loading="lazy"
                            />
                          </div>
                        );
                      })()}

                      {/* Licences section */}
                      <div className="mt-3 pt-3 border-t border-slate-200">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <KeyRound className="w-4 h-4 text-sky-600" />
                            <p className="text-sm font-semibold text-slate-700">{lang === 'fr' ? "Licences d'exploitation" : 'Licenses'}</p>
                            <span className="text-xs text-slate-400">({e.licences.length})</span>
                          </div>
                          <button
                            onClick={() => openLicenceModal(e.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 text-white text-xs font-medium hover:bg-sky-600 transition-colors"
                          >
                            <Plus className="w-3.5 h-3.5" /> {lang === 'fr' ? 'Générer' : 'Generate'}
                          </button>
                        </div>

                        {e.licences.length === 0 ? (
                          <p className="text-xs text-slate-400 py-2 text-center bg-white rounded-lg border border-slate-100">
                            {lang === 'fr' ? 'Aucune licence. Cliquez sur « Générer » pour en créer une.' : 'No license. Click "Generate" to create one.'}
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {e.licences.map((lic) => (
                              <div key={lic.id} className="flex items-center justify-between bg-white rounded-lg border border-slate-100 p-3">
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${getLicenceStatusBadge(lic.statut)}`}>
                                    <KeyRound className="w-4 h-4" />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <code className="text-xs font-mono font-semibold text-slate-900 truncate">{lic.cle_licence}</code>
                                      <button
                                        onClick={() => copyLicenceKey(lic.cle_licence)}
                                        className="p-1 rounded text-slate-300 hover:text-sky-600 hover:bg-sky-50 transition-colors flex-shrink-0"
                                        title={lang === 'fr' ? 'Copier' : 'Copy'}
                                      >
                                        {copiedKey === lic.cle_licence ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                                      </button>
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                      <span className="flex items-center gap-1 text-xs text-slate-400">
                                        <Calendar className="w-3 h-3" />
                                        {lic.date_debut} → {lic.date_fin}
                                      </span>
                                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${getLicenceStatusBadge(lic.statut)}`}>
                                        {getLicenceStatusLabel(lic.statut)}
                                      </span>
                                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${lic.type_licence === 'demo' ? 'bg-sky-100 text-sky-700 border-sky-200' : 'bg-violet-100 text-violet-700 border-violet-200'}`}>
                                        {lic.type_licence === 'demo' ? (lang === 'fr' ? 'Démo 30j' : 'Demo 30d') : (lang === 'fr' ? 'Annuelle' : 'Annual')}
                                      </span>
                                    </div>
                                    {lic.prix != null && (
                                      <p className="text-xs font-semibold text-emerald-600 mt-1">{Number(lic.prix).toLocaleString('fr-FR')} FCFA</p>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                                  <button
                                    type="button"
                                    onClick={() => openWhatsAppModal(e, 'licence', { licence: lic })}
                                    className="p-2 rounded-lg text-green-600 hover:bg-green-50 transition-colors"
                                    title={lang === 'fr' ? 'Envoyer cette licence par WhatsApp' : 'Send this license via WhatsApp'}
                                  >
                                    <MessageCircle className="w-4 h-4" />
                                  </button>
                                  {lic.statut === 'active' && (
                                    <button
                                      onClick={() => handleRevokeLicence(lic.id)}
                                      className="p-2 rounded-lg text-slate-300 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                                      title={lang === 'fr' ? 'Révoquer' : 'Revoke'}
                                    >
                                      <Ban className="w-4 h-4" />
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handleDeleteLicence(lic.id)}
                                    className="p-2 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                                    title={lang === 'fr' ? 'Supprimer' : 'Delete'}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      </>}

      {/* Generate licence modal */}
      {showLicenceModal !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowLicenceModal(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">{lang === 'fr' ? 'Générer une licence' : 'Generate a license'}</h3>
              <button onClick={() => setShowLicenceModal(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-500">
              {entreprises.find((e) => e.id === showLicenceModal)?.nom} — {lang === 'fr' ? 'Une clé de licence unique sera générée automatiquement.' : 'A unique license key will be generated automatically.'}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">{lang === 'fr' ? 'Date de début' : 'Start date'}</label>
                <input
                  type="date"
                  value={licenceStart}
                  onChange={(e) => setLicenceStart(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">{lang === 'fr' ? 'Date de fin' : 'End date'}</label>
                <input
                  type="date"
                  value={licenceEnd}
                  onChange={(e) => setLicenceEnd(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{lang === 'fr' ? 'Prix (FCFA)' : 'Price (FCFA)'}</label>
              <input
                type="number"
                value={licencePrix}
                onChange={(e) => setLicencePrix(e.target.value)}
                min="0"
                step="1000"
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
              />
              <p className="text-xs text-slate-400 mt-1">{lang === 'fr' ? 'Par défaut : 100 000 FCFA pour les licences annuelles' : 'Default: 100,000 FCFA for annual licenses'}</p>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowLicenceModal(null)}
                className="px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => handleGenerateLicence(showLicenceModal)}
                disabled={generatingLicence || !licenceStart || !licenceEnd}
                className="flex-1 px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {generatingLicence ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                {generatingLicence ? (lang === 'fr' ? 'Génération…' : 'Generating…') : (lang === 'fr' ? 'Générer la licence' : 'Generate license')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit licence modal */}
      {editLicence && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setEditLicence(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">{lang === 'fr' ? 'Modifier la licence' : 'Edit license'}</h3>
              <button onClick={() => setEditLicence(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex items-center gap-2 bg-slate-50 rounded-lg p-3">
              <KeyRound className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <code className="text-xs font-mono font-semibold text-slate-700 truncate">{editLicence.cle_licence}</code>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">{lang === 'fr' ? 'Date de début' : 'Start date'}</label>
                <input
                  type="date"
                  value={editLicenceStart}
                  onChange={(e) => setEditLicenceStart(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">{lang === 'fr' ? 'Date de fin' : 'End date'}</label>
                <input
                  type="date"
                  value={editLicenceEnd}
                  onChange={(e) => setEditLicenceEnd(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{lang === 'fr' ? 'Statut' : 'Status'}</label>
              <select
                value={editLicenceStatut}
                onChange={(e) => setEditLicenceStatut(e.target.value as 'active' | 'expired' | 'revoked' | 'demo')}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white"
              >
                <option value="active">{lang === 'fr' ? 'Active' : 'Active'}</option>
                <option value="demo">{lang === 'fr' ? 'Démo' : 'Demo'}</option>
                <option value="expired">{lang === 'fr' ? 'Expirée' : 'Expired'}</option>
                <option value="revoked">{lang === 'fr' ? 'Révoquée' : 'Revoked'}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{lang === 'fr' ? 'Prix (FCFA)' : 'Price (FCFA)'}</label>
              <input
                type="number"
                value={editLicencePrix}
                onChange={(e) => setEditLicencePrix(e.target.value)}
                min="0"
                step="1000"
                placeholder="0"
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setEditLicence(null)}
                className="px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSaveLicenceEdit}
                disabled={savingLicenceEdit || !editLicenceStart || !editLicenceEnd}
                className="flex-1 px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {savingLicenceEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {savingLicenceEdit ? (lang === 'fr' ? 'Enregistrement…' : 'Saving…') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Individual WhatsApp Composer Modal (auto-opened after company approval or on click) */}
      {whatsAppTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6 overflow-y-auto">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={() => {
              setWhatsAppTarget(null);
              setWhatsAppJustApproved(false);
            }}
          />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-4 my-auto">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
                  <MessageCircle className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    {lang === 'fr' ? `Message WhatsApp — ${whatsAppTarget.nom}` : `WhatsApp Message — ${whatsAppTarget.nom}`}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {whatsAppTarget.email}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setWhatsAppTarget(null);
                  setWhatsAppJustApproved(false);
                }}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {whatsAppJustApproved && (
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 flex items-center gap-2.5">
                <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <p className="text-xs font-medium text-emerald-800">
                  {lang === 'fr'
                    ? `« ${whatsAppTarget.nom} » est maintenant approuvée ! Envoyez-lui sa confirmation d'activation sur WhatsApp.`
                    : `"${whatsAppTarget.nom}" is now approved! Send them their activation confirmation on WhatsApp.`}
                </p>
              </div>
            )}

            {/* Recipient phone input + member contact chips */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                {lang === 'fr' ? 'Numéro WhatsApp du destinataire' : 'Recipient WhatsApp number'}
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="tel"
                    value={whatsAppPhone}
                    onChange={(e) => setWhatsAppPhone(e.target.value)}
                    placeholder={lang === 'fr' ? 'Ex: +225 07 00 00 00 00' : 'e.g. +225 07 00 00 00 00'}
                    className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>
                {whatsAppPhone.trim() && whatsAppPhone.trim() !== (whatsAppTarget.telephone ?? '').trim() && (
                  <button
                    type="button"
                    onClick={() => handleSaveEntreprisePhone(whatsAppTarget.id, whatsAppPhone)}
                    disabled={savingPhone || !isOnline}
                    className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 flex items-center gap-1.5 flex-shrink-0"
                    title={lang === 'fr' ? "Enregistrer ce numéro sur la fiche de l'entreprise" : 'Save this phone number to company profile'}
                  >
                    {savingPhone ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 text-emerald-600" />}
                    {lang === 'fr' ? 'Mémoriser' : 'Save'}
                  </button>
                )}
              </div>
              {!whatsAppPhone.trim() && (
                <p className="text-xs text-amber-600">
                  {lang === 'fr'
                    ? "Aucun numéro enregistré pour cette entreprise. Saisissez le numéro WhatsApp ci-dessus (avec indicatif, ex: +225...)."
                    : 'No phone number on file for this company. Enter the WhatsApp number above (with country code, e.g. +225...).'}
                </p>
              )}
              {(() => {
                const contacts = [
                  ...(whatsAppTarget.telephone?.trim()
                    ? [{ label: lang === 'fr' ? 'Entreprise' : 'Company', phone: whatsAppTarget.telephone.trim() }]
                    : []),
                  ...whatsAppTarget.members
                    .filter((m) => m.contact?.trim())
                    .map((m) => ({
                      label: m.full_name || ROLE_LABELS[m.role] || m.email,
                      phone: m.contact!.trim(),
                    })),
                ];
                if (contacts.length <= 1) return null;
                return (
                  <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                    <span className="text-[11px] text-slate-400">
                      {lang === 'fr' ? 'Contacts disponibles :' : 'Available contacts:'}
                    </span>
                    {contacts.map((c, idx) => (
                      <button
                        key={`${c.phone}-${idx}`}
                        type="button"
                        onClick={() => setWhatsAppPhone(c.phone)}
                        className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                          whatsAppPhone.trim() === c.phone
                            ? 'bg-green-50 border-green-300 text-green-700 font-medium'
                            : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {c.label}: {c.phone}
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>

            {/* Template selector */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                {lang === 'fr' ? 'Modèle de message' : 'Message template'}
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {([
                  { id: 'approval', labelFr: 'Approbation', labelEn: 'Approval' },
                  { id: 'licence', labelFr: 'Licence', labelEn: 'License' },
                  { id: 'reminder', labelFr: 'Rappel fin', labelEn: 'Renewal' },
                  { id: 'custom', labelFr: 'Personnalisé', labelEn: 'Custom' },
                ] as { id: WhatsAppTemplateType; labelFr: string; labelEn: string }[]).map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => {
                      setWhatsAppTemplate(tpl.id);
                      setWhatsAppMessage(buildEntrepriseWhatsAppMessage(whatsAppTarget, tpl.id));
                    }}
                    className={`px-2.5 py-2 rounded-lg text-xs font-medium border transition-colors ${
                      whatsAppTemplate === tpl.id
                        ? 'bg-green-50 border-green-300 text-green-700'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {lang === 'fr' ? tpl.labelFr : tpl.labelEn}
                  </button>
                ))}
              </div>
            </div>

            {/* Editable message body */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                {lang === 'fr' ? 'Contenu du message' : 'Message content'}
              </label>
              <textarea
                rows={7}
                value={whatsAppMessage}
                onChange={(e) => setWhatsAppMessage(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent resize-y"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setWhatsAppTarget(null);
                  setWhatsAppJustApproved(false);
                }}
                className="px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                {t('common.cancel')}
              </button>
              {whatsAppPhone.replace(/[^\d]/g, '').length >= 8 && whatsAppMessage.trim() ? (
                <a
                  href={buildWhatsAppUrl(whatsAppPhone, whatsAppMessage)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    setSentWhatsAppIds((prev) => (prev.includes(whatsAppTarget.id) ? prev : [...prev, whatsAppTarget.id]));
                    setWhatsAppTarget(null);
                    setWhatsAppJustApproved(false);
                  }}
                  className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 transition-colors shadow-sm"
                >
                  <Send className="w-4 h-4" />
                  {lang === 'fr' ? 'Envoyer sur WhatsApp' : 'Send on WhatsApp'}
                  <ExternalLink className="w-3.5 h-3.5 opacity-80" />
                </a>
              ) : (
                <button
                  type="button"
                  disabled
                  className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-slate-200 text-slate-400 text-sm font-semibold cursor-not-allowed"
                >
                  <Send className="w-4 h-4" />
                  {lang === 'fr' ? 'Envoyer sur WhatsApp' : 'Send on WhatsApp'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Approved Companies WhatsApp Directory / Broadcast Modal */}
      {showApprovedWhatsAppModal && (() => {
        const approvedList = entreprises.filter((e) => {
          if (e.statut !== 'active' && e.statut !== 'demo') return false;
          if (!broadcastSearch.trim()) return true;
          const q = broadcastSearch.trim().toLowerCase();
          return (
            e.nom.toLowerCase().includes(q) ||
            e.email.toLowerCase().includes(q) ||
            getEntreprisePhone(e).toLowerCase().includes(q)
          );
        });

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6 overflow-y-auto">
            <div
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm"
              onClick={() => setShowApprovedWhatsAppModal(false)}
            />
            <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 space-y-4 my-auto max-h-[90vh] flex flex-col">
              <div className="flex items-start justify-between gap-3 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
                    <MessageCircle className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">
                      {lang === 'fr' ? 'WhatsApp — Entreprises approuvées' : 'WhatsApp — Approved Companies'}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {lang === 'fr'
                        ? 'Personnalisez le message (variables {nom} et {email}) puis cliquez sur Envoyer pour chaque entreprise approuvée.'
                        : 'Customize the message ({nom} and {email} placeholders) then click Send for each approved company.'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowApprovedWhatsAppModal(false)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Template pills + message editor */}
              <div className="space-y-2 flex-shrink-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {([
                    { id: 'approval', labelFr: 'Confirmation approbation', labelEn: 'Approval confirmation' },
                    { id: 'reminder', labelFr: 'Rappel licence', labelEn: 'License reminder' },
                    { id: 'custom', labelFr: 'Annonce générale', labelEn: 'General announcement' },
                  ] as { id: WhatsAppTemplateType; labelFr: string; labelEn: string }[]).map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => {
                        setBroadcastTemplate(tpl.id);
                        setBroadcastMessage(getDefaultBroadcastTemplate(tpl.id));
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        broadcastTemplate === tpl.id
                          ? 'bg-green-50 border-green-300 text-green-700'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {lang === 'fr' ? tpl.labelFr : tpl.labelEn}
                    </button>
                  ))}
                </div>
                <textarea
                  rows={4}
                  value={broadcastMessage}
                  onChange={(e) => setBroadcastMessage(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent resize-y"
                />
              </div>

              {/* Search bar */}
              <div className="relative flex-shrink-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={broadcastSearch}
                  onChange={(e) => setBroadcastSearch(e.target.value)}
                  placeholder={lang === 'fr' ? 'Filtrer les entreprises approuvées…' : 'Filter approved companies…'}
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
              </div>

              {/* Approved companies list */}
              <div className="overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-xl flex-1 min-h-[180px]">
                {approvedList.length === 0 ? (
                  <div className="py-10 text-center text-sm text-slate-400">
                    {lang === 'fr' ? 'Aucune entreprise approuvée trouvée.' : 'No approved company found.'}
                  </div>
                ) : (
                  approvedList.map((e) => {
                    const defaultPhone = getEntreprisePhone(e);
                    const currentPhone = inlinePhones[e.id] !== undefined ? inlinePhones[e.id] : defaultPhone;
                    const validDigits = currentPhone.replace(/[^\d]/g, '').length >= 8;
                    const personalizedMsg = broadcastMessage
                      .replace(/\{nom\}/g, e.nom)
                      .replace(/\{email\}/g, e.email);
                    const wasSent = sentWhatsAppIds.includes(e.id);

                    return (
                      <div key={e.id} className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 hover:bg-slate-50/60">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-slate-900 truncate">{e.nom}</p>
                            <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium border ${e.statut === 'demo' ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                              {e.statut === 'demo' ? (lang === 'fr' ? 'Démo' : 'Demo') : 'Active'}
                            </span>
                            {wasSent && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-100 text-green-700 text-[11px] font-semibold">
                                <Check className="w-3 h-3" /> {lang === 'fr' ? 'Envoyé' : 'Sent'}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 truncate">{e.email}</p>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          <input
                            type="tel"
                            value={currentPhone}
                            onChange={(ev) => setInlinePhones((prev) => ({ ...prev, [e.id]: ev.target.value }))}
                            placeholder="+225 07..."
                            className="w-36 sm:w-40 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
                          />
                          {currentPhone.trim() && currentPhone.trim() !== (e.telephone ?? '').trim() && (
                            <button
                              type="button"
                              onClick={() => handleSaveEntreprisePhone(e.id, currentPhone)}
                              disabled={savingPhone || !isOnline}
                              className="p-1.5 rounded-lg border border-slate-200 text-emerald-600 hover:bg-emerald-50 transition-colors"
                              title={lang === 'fr' ? 'Mémoriser ce numéro' : 'Save phone'}
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {validDigits && personalizedMsg.trim() ? (
                            <a
                              href={buildWhatsAppUrl(currentPhone, personalizedMsg)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => setSentWhatsAppIds((prev) => (prev.includes(e.id) ? prev : [...prev, e.id]))}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs font-medium hover:bg-green-700 transition-colors"
                            >
                              <Send className="w-3.5 h-3.5" />
                              {lang === 'fr' ? 'Envoyer' : 'Send'}
                            </a>
                          ) : (
                            <button
                              type="button"
                              disabled
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-400 text-xs font-medium cursor-not-allowed"
                            >
                              <Send className="w-3.5 h-3.5" />
                              {lang === 'fr' ? 'Numéro requis' : 'Phone needed'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="flex items-center justify-between pt-1 flex-shrink-0">
                <span className="text-xs text-slate-400">
                  {sentWhatsAppIds.length > 0
                    ? (lang === 'fr' ? `${sentWhatsAppIds.length} message(s) ouvert(s) sur WhatsApp` : `${sentWhatsAppIds.length} message(s) opened in WhatsApp`)
                    : ''}
                </span>
                <button
                  type="button"
                  onClick={() => setShowApprovedWhatsAppModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors"
                >
                  {lang === 'fr' ? 'Fermer' : 'Close'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function UsageTab({
  stats,
  loading,
  sortBy,
  setSortBy,
  lang,
}: {
  stats: UsageStats[];
  loading: boolean;
  sortBy: 'depots' | 'revenue' | 'clients' | 'articles' | 'activity' | 'name';
  setSortBy: (v: 'depots' | 'revenue' | 'clients' | 'articles' | 'activity' | 'name') => void;
  lang: 'fr' | 'en';
}) {
  const fr = lang === 'fr';

  const sorted = [...stats].sort((a, b) => {
    switch (sortBy) {
      case 'depots': return b.total_depots - a.total_depots;
      case 'revenue': return Number(b.total_revenue) - Number(a.total_revenue);
      case 'clients': return b.total_clients - a.total_clients;
      case 'articles': return b.total_articles - a.total_articles;
      case 'activity': return new Date(b.last_activity).getTime() - new Date(a.last_activity).getTime();
      case 'name': return a.ent_nom.localeCompare(b.ent_nom);
    }
  });

  const totals = {
    depots: stats.reduce((s, e) => s + e.total_depots, 0),
    revenue: stats.reduce((s, e) => s + Number(e.total_revenue), 0),
    clients: stats.reduce((s, e) => s + e.total_clients, 0),
    articles: stats.reduce((s, e) => s + e.total_articles, 0),
    boutiques: stats.reduce((s, e) => s + e.total_boutiques, 0),
    commande: stats.reduce((s, e) => s + e.depots_commande, 0),
    enCours: stats.reduce((s, e) => s + e.depots_en_cours, 0),
    collecte: stats.reduce((s, e) => s + e.depots_collecte, 0),
    retire: stats.reduce((s, e) => s + e.depots_retire, 0),
  };

  const idleCompanies = stats.filter((e) => e.total_depots === 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-sky-500 animate-spin" />
      </div>
    );
  }

  if (stats.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-12 text-center">
        <Activity className="w-10 h-10 text-slate-300 mx-auto mb-2" />
        <p className="text-sm text-slate-400">{fr ? 'Aucune donnée d\'utilisation disponible.' : 'No usage data available.'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="p-4 rounded-xl border border-slate-100 bg-white">
          <div className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center mb-2"><ShoppingBag className="w-4 h-4 text-sky-600" /></div>
          <p className="text-2xl font-bold text-slate-900">{totals.depots.toLocaleString('fr-FR')}</p>
          <p className="text-xs text-slate-500 mt-0.5">{fr ? 'Dépôts' : 'Deposits'}</p>
        </div>
        <div className="p-4 rounded-xl border border-slate-100 bg-white">
          <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center mb-2"><DollarSign className="w-4 h-4 text-emerald-600" /></div>
          <p className="text-2xl font-bold text-emerald-600">{Number(totals.revenue).toLocaleString('fr-FR')}</p>
          <p className="text-xs text-slate-500 mt-0.5">{fr ? 'CA total (FCFA)' : 'Total rev. (FCFA)'}</p>
        </div>
        <div className="p-4 rounded-xl border border-slate-100 bg-white">
          <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center mb-2"><Users className="w-4 h-4 text-violet-600" /></div>
          <p className="text-2xl font-bold text-slate-900">{totals.clients.toLocaleString('fr-FR')}</p>
          <p className="text-xs text-slate-500 mt-0.5">{fr ? 'Clients' : 'Clients'}</p>
        </div>
        <div className="p-4 rounded-xl border border-slate-100 bg-white">
          <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center mb-2"><Package className="w-4 h-4 text-amber-600" /></div>
          <p className="text-2xl font-bold text-slate-900">{totals.articles.toLocaleString('fr-FR')}</p>
          <p className="text-xs text-slate-500 mt-0.5">{fr ? 'Articles' : 'Items'}</p>
        </div>
        <div className="p-4 rounded-xl border border-slate-100 bg-white">
          <div className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center mb-2"><Store className="w-4 h-4 text-sky-600" /></div>
          <p className="text-2xl font-bold text-slate-900">{totals.boutiques}</p>
          <p className="text-xs text-slate-500 mt-0.5">{fr ? 'Boutiques' : 'Shops'}</p>
        </div>
      </div>

      {/* Status breakdown */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
        <p className="text-sm font-semibold text-slate-700 mb-3">{fr ? 'Répartition des dépôts par statut' : 'Deposit status breakdown'}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-sky-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-bold text-slate-900">{totals.commande}</p>
              <p className="text-xs text-slate-500">{fr ? 'Commandes' : 'Orders'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-amber-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-bold text-slate-900">{totals.enCours}</p>
              <p className="text-xs text-slate-500">{fr ? 'En traitement' : 'Processing'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-violet-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-bold text-slate-900">{totals.collecte}</p>
              <p className="text-xs text-slate-500">{fr ? 'Collectés' : 'Collected'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-emerald-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-bold text-slate-900">{totals.retire}</p>
              <p className="text-xs text-slate-500">{fr ? 'Retirés' : 'Picked up'}</p>
            </div>
          </div>
        </div>
        {(totals.depots > 0) && (
          <div className="mt-3 h-2 rounded-full bg-slate-100 overflow-hidden flex">
            <div className="bg-sky-400" style={{ width: `${(totals.commande / totals.depots) * 100}%` }} />
            <div className="bg-amber-400" style={{ width: `${(totals.enCours / totals.depots) * 100}%` }} />
            <div className="bg-violet-400" style={{ width: `${(totals.collecte / totals.depots) * 100}%` }} />
            <div className="bg-emerald-400" style={{ width: `${(totals.retire / totals.depots) * 100}%` }} />
          </div>
        )}
      </div>

      {/* Sort selector */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm font-semibold text-slate-700">
          {fr ? 'Utilisation par entreprise' : 'Usage by company'} <span className="text-slate-400 font-normal">({stats.length})</span>
        </p>
        <div className="flex items-center gap-2">
          <ArrowDownUp className="w-3.5 h-3.5 text-slate-400" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'depots' | 'revenue' | 'clients' | 'articles' | 'activity' | 'name')}
            className="px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white"
          >
            <option value="depots">{fr ? 'Plus de dépôts' : 'Most deposits'}</option>
            <option value="revenue">{fr ? 'Plus grand CA' : 'Highest revenue'}</option>
            <option value="clients">{fr ? 'Plus de clients' : 'Most clients'}</option>
            <option value="articles">{fr ? 'Plus d\'articles' : 'Most items'}</option>
            <option value="activity">{fr ? 'Activité récente' : 'Recent activity'}</option>
            <option value="name">{fr ? 'Nom A→Z' : 'Name A→Z'}</option>
          </select>
        </div>
      </div>

      {/* Usage table — desktop */}
      <div className="hidden sm:block bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
              <th className="px-4 py-3">{fr ? 'Entreprise' : 'Company'}</th>
              <th className="px-3 py-3 text-right">{fr ? 'Dépôts' : 'Deposits'}</th>
              <th className="px-3 py-3 text-right">{fr ? 'Clients' : 'Clients'}</th>
              <th className="px-3 py-3 text-right">{fr ? 'Articles' : 'Items'}</th>
              <th className="px-3 py-3 text-right">{fr ? 'Boutiques' : 'Shops'}</th>
              <th className="px-3 py-3 text-right">CA (FCFA)</th>
              <th className="px-4 py-3 text-right">{fr ? 'Dernière activité' : 'Last activity'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {sorted.map((e) => {
              const daysSince = Math.floor((Date.now() - new Date(e.last_activity).getTime()) / 86400000);
              const isActive = daysSince <= 7;
              return (
                <tr key={e.entreprise_id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-sky-400 flex-shrink-0" />
                      <span className="font-medium text-slate-900 truncate">{e.ent_nom}</span>
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border flex-shrink-0 ${e.ent_statut === 'active' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : e.ent_statut === 'demo' ? 'bg-sky-50 text-sky-600 border-sky-200' : e.ent_statut === 'suspended' ? 'bg-red-50 text-red-600 border-red-200' : 'bg-amber-50 text-amber-600 border-amber-200'}`}>
                        {e.ent_statut === 'pending' ? (fr ? 'Attente' : 'Pending') : e.ent_statut === 'demo' ? (fr ? 'Démo' : 'Demo') : e.ent_statut === 'suspended' ? (fr ? 'Susp.' : 'Susp.') : (fr ? 'Active' : 'Active')}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right font-medium text-slate-700">{e.total_depots.toLocaleString('fr-FR')}</td>
                  <td className="px-3 py-3 text-right text-slate-600">{e.total_clients.toLocaleString('fr-FR')}</td>
                  <td className="px-3 py-3 text-right text-slate-600">{e.total_articles}</td>
                  <td className="px-3 py-3 text-right text-slate-600">{e.total_boutiques}</td>
                  <td className="px-3 py-3 text-right font-medium text-emerald-600">{Number(e.total_revenue).toLocaleString('fr-FR')}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`text-xs ${isActive ? 'text-emerald-600 font-medium' : daysSince <= 30 ? 'text-slate-500' : 'text-slate-400'}`}>
                      {daysSince === 0 ? (fr ? "Aujourd'hui" : 'Today') : daysSince === 1 ? (fr ? 'Hier' : 'Yesterday') : daysSince < 30 ? (fr ? `Il y a ${daysSince} j` : `${daysSince}d ago`) : daysSince < 365 ? (fr ? `Il y a ${Math.floor(daysSince / 30)} mois` : `${Math.floor(daysSince / 30)}mo ago`) : new Date(e.last_activity).toLocaleDateString(fr ? 'fr-FR' : 'en-US')}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Usage cards — mobile */}
      <div className="sm:hidden space-y-2">
        {sorted.map((e) => {
          const daysSince = Math.floor((Date.now() - new Date(e.last_activity).getTime()) / 86400000);
          return (
            <div key={e.entreprise_id} className="bg-white rounded-xl border border-slate-100 shadow-sm p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Building2 className="w-4 h-4 text-sky-400 flex-shrink-0" />
                  <span className="text-sm font-semibold text-slate-900 truncate">{e.ent_nom}</span>
                </div>
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border flex-shrink-0 ${e.ent_statut === 'active' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : e.ent_statut === 'demo' ? 'bg-sky-50 text-sky-600 border-sky-200' : e.ent_statut === 'suspended' ? 'bg-red-50 text-red-600 border-red-200' : 'bg-amber-50 text-amber-600 border-amber-200'}`}>
                  {e.ent_statut === 'pending' ? (fr ? 'Attente' : 'Pending') : e.ent_statut === 'demo' ? (fr ? 'Démo' : 'Demo') : e.ent_statut === 'suspended' ? (fr ? 'Susp.' : 'Susp.') : (fr ? 'Active' : 'Active')}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="bg-slate-50 rounded-lg py-1.5">
                  <p className="text-sm font-bold text-slate-900">{e.total_depots}</p>
                  <p className="text-[10px] text-slate-500">{fr ? 'Dépôts' : 'Deposits'}</p>
                </div>
                <div className="bg-slate-50 rounded-lg py-1.5">
                  <p className="text-sm font-bold text-slate-900">{e.total_clients}</p>
                  <p className="text-[10px] text-slate-500">{fr ? 'Clients' : 'Clients'}</p>
                </div>
                <div className="bg-slate-50 rounded-lg py-1.5">
                  <p className="text-sm font-bold text-slate-900">{e.total_articles}</p>
                  <p className="text-[10px] text-slate-500">{fr ? 'Articles' : 'Items'}</p>
                </div>
                <div className="bg-slate-50 rounded-lg py-1.5">
                  <p className="text-sm font-bold text-emerald-600">{Number(e.total_revenue).toLocaleString('fr-FR', { notation: 'compact', maximumFractionDigits: 1 })}</p>
                  <p className="text-[10px] text-slate-500">CA</p>
                </div>
              </div>
              <p className="text-xs text-slate-400">
                {daysSince === 0 ? (fr ? "Actif aujourd'hui" : 'Active today') : daysSince === 1 ? (fr ? 'Actif hier' : 'Active yesterday') : daysSince < 30 ? (fr ? `Actif il y a ${daysSince} j` : `Active ${daysSince}d ago`) : daysSince < 365 ? (fr ? `Actif il y a ${Math.floor(daysSince / 30)} mois` : `Active ${Math.floor(daysSince / 30)}mo ago`) : (fr ? 'Inactif' : 'Inactive')}
              </p>
            </div>
          );
        })}
      </div>

      {/* Idle companies summary */}
      {idleCompanies.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <p className="text-sm font-semibold text-amber-800">
              {fr ? `${idleCompanies.length} entreprise${idleCompanies.length > 1 ? 's' : ''} sans activité` : `${idleCompanies.length} compan${idleCompanies.length > 1 ? 'ies' : 'y'} with no activity`}
            </p>
          </div>
          <p className="text-xs text-amber-700">
            {fr ? 'Aucun dépôt enregistré. ' : 'No deposits recorded. '}
            {idleCompanies.slice(0, 5).map((e) => e.ent_nom).join(', ')}
            {idleCompanies.length > 5 && ` ${fr ? 'et' : 'and'} ${idleCompanies.length - 5} ${fr ? 'autres' : 'more'}`}
          </p>
        </div>
      )}
    </div>
  );
}