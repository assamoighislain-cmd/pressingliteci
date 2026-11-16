export type TraitementCode = string;

export type ModeReglement = string;

export interface ModeReglementRow {
  id: number;
  designation: string;
  taux_remise: number;
  created_at: string;
}

export type DepotStatut = 'COMMANDE' | 'EN_COURS' | 'RETIRE' | 'COLLECTE';

export interface Client {
  id: string;
  code: string | null;
  nom: string;
  telephone: string | null;
  taux_remise: number | null;
  condition_remise: number | null;
  portal_code?: string | null;
  date_naissance: string | null;
  source?: string | null;
  created_at: string;
}

export interface TypeTraitement {
  id: string;
  code: string;
  libelle: string;
  coefficient: number;
  nb_jours: number;
  created_at: string;
}

export interface ArticleCatalog {
  id: string;
  code: string | null;
  designation: string;
  prix_unitaire: number;
  nb_pieces: number;
  created_at: string;
}

export interface ArticleVariant {
  id: string;
  article_id: string;
  designation: string;
  prix_traitement: number;
  created_at: string;
}

export interface Entreprise {
  id: string;
  nom: string;
  adresse: string | null;
  ville: string | null;
  telephone: string | null;
  email: string | null;
  logo_url: string | null;
  slogan: string | null;
  message_pied: string | null;
  user_id?: string | null;
  statut?: string | null;
  pickup_days: string[] | null;
  phone_prefix: string | null;
  hist_filters_commercial: string[] | null;
  hist_filters_gerant: string[] | null;
  fidelite_points_per_unit: number;
  fidelite_redeem_threshold: number;
  fidelite_redeem_value: number;
  dashboard_visible_roles: string[] | null;
  delivery_base_fee: number;
  delivery_price_per_km: number;
  delivery_latitude: number | null;
  delivery_longitude: number | null;
  label_fields: string[] | null;
  label_printer_type?: string | null;
  label_printer_config?: { baudRate?: number; charWidth?: number } | null;
  label_printer_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Depot {
  id: string;
  numero: string | null;
  client_id: string;
  statut: DepotStatut;
  mode_reglement: ModeReglement | null;
  avance_amount: number | null;
  total: number;
  traitement: TraitementCode;
  coefficient: number;
  type_traitement_id: string | null;
  date_depot: string;
  date_retrait_prevue: string | null;
  date_retrait: string | null;
  notes: string | null;
  taux_remise: number | null;
  montant_remise: number | null;
  pickup_requested: boolean | null;
  pickup_address: string | null;
  pickup_latitude: number | null;
  pickup_longitude: number | null;
  pickup_day: string | null;
  delivery_requested: boolean | null;
  delivery_address: string | null;
  delivery_latitude: number | null;
  delivery_longitude: number | null;
  delivery_day: string | null;
  frais_livraison: number;
  frais_collecte: number;
  collected_at: string | null;
  ready_for_delivery?: boolean | null;
  created_at: string;
}

export interface DepotArticle {
  id: string;
  depot_id: string;
  designation: string;
  prix_unitaire: number;
  prix_traitement: number;
  quantite: number;
  nb_pieces: number;
  prix_total: number;
  couleur: string | null;
  signe_particulier: string | null;
  griffe: string | null;
  date_retrait: string | null;
  created_at: string;
}

export interface DepotAvance {
  id: string;
  depot_id: string;
  montant: number;
  mode_reglement: string | null;
  date_paiement: string;
  created_at: string;
}

export interface Depense {
  id: string;
  date_depense: string;
  libelle: string;
  categorie: string | null;
  montant: number;
  mode_reglement: string | null;
  notes: string | null;
  user_id?: string | null;
  created_at: string;
}

export interface DepenseCategory {
  id: string;
  libelle: string;
  user_id?: string | null;
  created_at: string;
}

export interface Licence {
  id: string;
  entreprise_id: number;
  cle_licence: string;
  date_debut: string;
  date_fin: string;
  statut: 'active' | 'expired' | 'revoked';
  type_licence: 'demo' | 'annuelle';
  created_by?: string | null;
  created_at: string;
}

export interface Boutique {
  id: string;
  tenant_id: string;
  nom: string;
  adresse: string | null;
  ville: string | null;
  telephone: string | null;
  is_default: boolean;
  slug: string | null;
  created_at: string;
  updated_at: string;
}

export interface FidelitePoints {
  id: string;
  client_id: string;
  total_points: number;
  tenant_id: string;
  boutique_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface FideliteHistory {
  id: string;
  client_id: string;
  depot_id: string | null;
  points: number;
  motif: string;
  tenant_id: string;
  boutique_id: string | null;
  created_at: string;
}

export interface DepotWithClient extends Depot {
  clients?: Pick<Client, 'nom' | 'telephone' | 'portal_code'> | null;
}

export interface DepotWithArticles extends Depot {
  articles: DepotArticle[];
  client?: Pick<Client, 'nom' | 'telephone' | 'portal_code'> | null;
  clients?: Pick<Client, 'nom' | 'telephone' | 'portal_code'> | null;
}

export interface Consommable {
  id: string;
  tenant_id: string;
  boutique_id: string | null;
  nom: string;
  unite: string;
  quantite: number;
  seuil_alerte: number;
  prix_unitaire: number;
  fournisseur: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConsommableMouvement {
  id: string;
  consommable_id: string;
  tenant_id: string;
  boutique_id: string | null;
  type_mouvement: 'entree' | 'sortie';
  quantite: number;
  motif: string | null;
  date_mouvement: string;
  created_at: string;
}

export interface BonReduction {
  id: string;
  code: string;
  type_remise: 'pourcentage' | 'montant_fixe';
  valeur: number;
  date_debut: string;
  date_fin: string | null;
  usage_max: number | null;
  usage_count: number;
  actif: boolean;
  description: string | null;
  tenant_id: string;
  created_at: string;
}

export type RelanceCanal = 'whatsapp' | 'telephone' | 'sms' | 'autre';

export interface Relance {
  id: string;
  client_id: string;
  canal: RelanceCanal;
  note: string | null;
  date_relance: string;
  created_at: string;
}

export interface RelanceWithClient extends Relance {
  client_nom: string;
  client_telephone: string | null;
}

export function getModeReglementLabel(mode: ModeReglement | null, modes: ModeReglementRow[] = []): string {
  if (!mode) return 'Non réglé';
  const found = modes.find((m) => m.designation === mode);
  return found?.designation ?? mode;
}

export function getTraitementLabel(
  code: TraitementCode,
  types: TypeTraitement[],
): string {
  return types.find((t) => t.libelle === code)?.libelle ?? code;
}

export function getTraitementLabelById(
  id: string | null,
  types: TypeTraitement[],
  fallback?: string,
): string {
  if (id) {
    const found = types.find((t) => t.id === id)?.libelle;
    if (found) return found;
  }
  if (fallback && fallback.trim()) return fallback;
  return '—';
}

export function getCoefficient(
  code: TraitementCode,
  types: TypeTraitement[],
): number {
  return types.find((t) => t.libelle === code)?.coefficient ?? 1.0;
}

export function getCoefficientById(
  id: string | null,
  types: TypeTraitement[],
): number {
  if (!id) return 1.0;
  return types.find((t) => t.id === id)?.coefficient ?? 1.0;
}

export function getNbJours(
  code: TraitementCode,
  types: TypeTraitement[],
): number {
  return types.find((t) => t.libelle === code)?.nb_jours ?? 1;
}

export function getNbJoursById(
  id: string | null,
  types: TypeTraitement[],
): number {
  if (!id) return 1;
  return types.find((t) => t.id === id)?.nb_jours ?? 1;
}

export function computeDateRetraitPrevue(
  dateDepot: Date,
  codes: TraitementCode[],
  types: TypeTraitement[],
): Date {
  const maxJours = codes.length === 0
    ? 1
    : Math.max(...codes.map((c) => getNbJours(c, types)));
  const result = new Date(dateDepot);
  result.setDate(result.getDate() + maxJours);
  result.setHours(18, 0, 0, 0);
  return result;
}

export function computeDateRetraitPrevueById(
  dateDepot: Date,
  typeTraitementId: string | null,
  types: TypeTraitement[],
): Date {
  const nbJours = getNbJoursById(typeTraitementId, types);
  const result = new Date(dateDepot);
  result.setDate(result.getDate() + nbJours);
  result.setHours(18, 0, 0, 0);
  return result;
}

export function formatPrice(value: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'XOF' }).format(value);
}

export function applyPhonePrefix(raw: string, prefix: string | null | undefined): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith('+')) return trimmed;
  const digits = trimmed.replace(/[\s\-().]/g, '');
  if (/^\d{6,}$/.test(digits) && prefix) {
    return `${prefix} ${trimmed}`;
  }
  return trimmed;
}

export function formatDate(dateString: string | null): string {
  if (!dateString) return '—';
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function formatDateShort(dateString: string | null): string {
  if (!dateString) return '—';
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

export function formatEntrepriseHeader(ent: {
  nom?: string | null;
  telephone?: string | null;
  adresse?: string | null;
  ville?: string | null;
  email?: string | null;
  slogan?: string | null;
}): string[] {
  const lignes: string[] = [];
  if (ent.nom) lignes.push(`*${ent.nom}*`);
  if (ent.telephone) lignes.push(`Tel: ${ent.telephone}`);
  const adresse = [ent.adresse, ent.ville].filter(Boolean).join(', ');
  if (adresse) lignes.push(`Adresse: ${adresse}`);
  if (ent.email) lignes.push(`Email: ${ent.email}`);
  if (ent.slogan) lignes.push(`_${ent.slogan}_`);
  return lignes;
}

export function buildWhatsAppMessage(data: {
  entrepriseNom?: string;
  entrepriseTelephone?: string | null;
  entrepriseAdresse?: string | null;
  entrepriseVille?: string | null;
  entrepriseEmail?: string | null;
  entrepriseSlogan?: string | null;
  entrepriseId?: string | number | null;
  numero: string | null;
  clientNom: string;
  dateDepot: string;
  dateRetraitPrevue: string | null;
  traitement: string;
  coefficient: number;
  total: number;
  totalAvantRemise?: number;
  tauxRemise?: number;
  montantRemise?: number;
  modeReglementRemise?: number;
  modeReglementTauxRemise?: number;
  articles: { designation: string; quantite: number; nb_pieces: number; prix_total: number; couleur: string | null; signe_particulier: string | null; griffe: string | null }[];
  reste?: number;
  notes?: string | null;
  portalCode?: string | null;
}): string {
  const lignes: string[] = [];
  const header = formatEntrepriseHeader({
    nom: data.entrepriseNom,
    telephone: data.entrepriseTelephone,
    adresse: data.entrepriseAdresse,
    ville: data.entrepriseVille,
    email: data.entrepriseEmail,
    slogan: data.entrepriseSlogan,
  });
  if (header.length > 0) {
    lignes.push(...header);
    lignes.push('');
  }
  lignes.push(`Facture N° ${data.numero}`);
  lignes.push('');
  lignes.push(`Client: ${data.clientNom}`);
  lignes.push(`Déposé le: ${formatDateShort(data.dateDepot)}`);
  if (data.dateRetraitPrevue) lignes.push(`Retrait prévu: ${formatDateShort(data.dateRetraitPrevue)}`);
  lignes.push(`Traitement: ${data.traitement} (x${data.coefficient})`);
  lignes.push('');
  lignes.push('*Articles:*');
  for (const art of data.articles) {
    let ligne = `• ${art.designation} (${art.nb_pieces * art.quantite} pcs) - ${formatPrice(art.prix_total)}`;
    const details = [art.couleur, art.signe_particulier, art.griffe].filter((d) => d && d !== 'AUCUN');
    if (details.length > 0) ligne += `\n  _${details.join(' · ')}_`;
    lignes.push(ligne);
  }
  lignes.push('');
  if (data.tauxRemise && data.tauxRemise > 0) {
    lignes.push(`Sous-total: ${formatPrice(data.totalAvantRemise ?? 0)}`);
    lignes.push(`Remise (${data.tauxRemise}%): -${formatPrice(data.montantRemise ?? 0)}`);
  }
  if (data.modeReglementRemise && data.modeReglementRemise > 0) {
    lignes.push(`Remise règlement (${data.modeReglementTauxRemise}%): -${formatPrice(data.modeReglementRemise)}`);
  }
  lignes.push(`*TOTAL: ${formatPrice(data.total)}*`);
  if (data.reste && data.reste > 0) {
    lignes.push(`Reste à payer: ${formatPrice(data.reste)}`);
  }
  if (data.notes) {
    lignes.push('');
    lignes.push(`Notes: ${data.notes}`);
  }
  lignes.push('');
  lignes.push('Merci de votre confiance!');
  if (data.entrepriseId) {
    const portalUrl = `${window.location.origin}/#/portal/${data.entrepriseId}`;
    lignes.push('');
    lignes.push(`Suivez vos commandes en ligne: ${portalUrl}`);
    if (data.portalCode) {
      lignes.push(`Votre code client: ${data.portalCode}`);
    }
  }
  return lignes.join('\n');
}

export function buildWhatsAppUrl(phone: string, message: string): string {
  const cleanPhone = phone.replace(/[^\d+]/g, '');
  let normalizedPhone = cleanPhone.startsWith('+') ? cleanPhone.slice(1) : cleanPhone;
  if (normalizedPhone.startsWith('00')) {
    normalizedPhone = normalizedPhone.slice(2);
  }
  // Normalize 10-digit local Côte d'Ivoire numbers (01, 05, 07, 21, 25, 27) by prepending 225
  if (/^(01|05|07|21|25|27)\d{8}$/.test(normalizedPhone)) {
    normalizedPhone = `225${normalizedPhone}`;
  }
  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;
}

