import type {
  DepotWithArticles,
  DepotAvance,
  Depense,
  DepenseCategory,
  CommissionVersement,
  EcritureComptableRecord,
  SyscohadaJournalCode,
} from '@/types';

// ─── Plan Comptable SYSCOHADA Révisé (adapté aux pressings & blanchisseries) ───

export type SyscohadaAccountNature =
  | 'capitaux'
  | 'immobilisation'
  | 'stock'
  | 'tiers_actif'
  | 'tiers_passif'
  | 'tresorerie'
  | 'charge'
  | 'produit'
  | 'hao';

export interface SyscohadaAccount {
  code: string;
  intitule: string;
  intituleEn: string;
  classe: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  nature: SyscohadaAccountNature;
  sensNormal: 'debit' | 'credit';
  tvaEligible?: boolean;
}

export const SYSCOHADA_CLASS_LABELS: Record<number, { fr: string; en: string }> = {
  1: { fr: 'Classe 1 — Ressources durables', en: 'Class 1 — Long-term resources' },
  2: { fr: 'Classe 2 — Actif immobilisé', en: 'Class 2 — Fixed assets' },
  3: { fr: 'Classe 3 — Stocks', en: 'Class 3 — Inventories' },
  4: { fr: 'Classe 4 — Comptes de tiers', en: 'Class 4 — Third-party accounts' },
  5: { fr: 'Classe 5 — Comptes de trésorerie', en: 'Class 5 — Cash & treasury' },
  6: { fr: 'Classe 6 — Charges des activités ordinaires', en: 'Class 6 — Operating expenses' },
  7: { fr: 'Classe 7 — Produits des activités ordinaires', en: 'Class 7 — Operating revenues' },
  8: { fr: 'Classe 8 — Autres charges & produits (HAO)', en: 'Class 8 — Non-ordinary items (HAO)' },
};

export const SYSCOHADA_JOURNAL_LABELS: Record<SyscohadaJournalCode, { fr: string; en: string }> = {
  VE: { fr: 'Journal des Ventes & Prestations', en: 'Sales & Services Journal' },
  CA: { fr: 'Journal de Caisse', en: 'Cash Journal' },
  BQ: { fr: 'Journal de Banque & Mobile Money', en: 'Bank & Mobile Money Journal' },
  AC: { fr: 'Journal des Achats & Charges', en: 'Purchases & Expenses Journal' },
  OD: { fr: 'Journal des Opérations Diverses', en: 'General / Miscellaneous Journal' },
};

export const SYSCOHADA_PLAN_COMPTABLE: SyscohadaAccount[] = [
  // Classe 1 — Ressources durables
  { code: '1011', intitule: 'Capital social souscrit', intituleEn: 'Subscribed share capital', classe: 1, nature: 'capitaux', sensNormal: 'credit' },
  { code: '1031', intitule: 'Capital personnel (exploitant)', intituleEn: 'Owner equity', classe: 1, nature: 'capitaux', sensNormal: 'credit' },
  { code: '1041', intitule: "Compte de l'exploitant (prélèvements / apports)", intituleEn: 'Owner drawings / contributions', classe: 1, nature: 'capitaux', sensNormal: 'debit' },
  { code: '1111', intitule: 'Réserve légale', intituleEn: 'Legal reserve', classe: 1, nature: 'capitaux', sensNormal: 'credit' },
  { code: '1211', intitule: 'Report à nouveau créditeur', intituleEn: 'Retained earnings (credit)', classe: 1, nature: 'capitaux', sensNormal: 'credit' },
  { code: '1311', intitule: "Résultat net de l'exercice (bénéfice)", intituleEn: 'Net income (profit)', classe: 1, nature: 'capitaux', sensNormal: 'credit' },
  { code: '1391', intitule: "Résultat net de l'exercice (perte)", intituleEn: 'Net income (loss)', classe: 1, nature: 'capitaux', sensNormal: 'debit' },
  { code: '1621', intitule: 'Emprunts et dettes auprès des banques', intituleEn: 'Bank loans & borrowings', classe: 1, nature: 'capitaux', sensNormal: 'credit' },

  // Classe 2 — Actif immobilisé
  { code: '2131', intitule: 'Logiciels et licences informatiques', intituleEn: 'Software & licenses', classe: 2, nature: 'immobilisation', sensNormal: 'debit' },
  { code: '2411', intitule: 'Matériel industriel de pressing (laveuses, séchoirs, presses)', intituleEn: 'Laundry industrial equipment', classe: 2, nature: 'immobilisation', sensNormal: 'debit' },
  { code: '2441', intitule: 'Matériel et mobilier de bureau', intituleEn: 'Office furniture & equipment', classe: 2, nature: 'immobilisation', sensNormal: 'debit' },
  { code: '2444', intitule: 'Matériel informatique et caisse', intituleEn: 'IT & POS hardware', classe: 2, nature: 'immobilisation', sensNormal: 'debit' },
  { code: '2451', intitule: 'Matériel de transport (livraison / collecte)', intituleEn: 'Delivery vehicles', classe: 2, nature: 'immobilisation', sensNormal: 'debit' },
  { code: '2751', intitule: 'Dépôts et cautionnements versés (loyer, CIE, SODECI)', intituleEn: 'Security deposits paid', classe: 2, nature: 'immobilisation', sensNormal: 'debit' },
  { code: '2841', intitule: 'Amortissements du matériel de pressing', intituleEn: 'Accumulated depreciation — equipment', classe: 2, nature: 'immobilisation', sensNormal: 'credit' },

  // Classe 3 — Stocks
  { code: '3311', intitule: 'Stocks de consommables pressing (lessives, solvants, cintres)', intituleEn: 'Laundry consumables inventory', classe: 3, nature: 'stock', sensNormal: 'debit' },
  { code: '3351', intitule: 'Stocks emballages et housses plastiques', intituleEn: 'Packaging & garment covers stock', classe: 3, nature: 'stock', sensNormal: 'debit' },

  // Classe 4 — Comptes de tiers
  { code: '4011', intitule: 'Fournisseurs', intituleEn: 'Suppliers / Accounts payable', classe: 4, nature: 'tiers_passif', sensNormal: 'credit' },
  { code: '4111', intitule: 'Clients', intituleEn: 'Customers / Accounts receivable', classe: 4, nature: 'tiers_actif', sensNormal: 'debit' },
  { code: '4191', intitule: 'Clients, avances et acomptes reçus', intituleEn: 'Customer advances & prepayments', classe: 4, nature: 'tiers_passif', sensNormal: 'credit' },
  { code: '4221', intitule: 'Personnel, rémunérations dues', intituleEn: 'Salaries payable', classe: 4, nature: 'tiers_passif', sensNormal: 'credit' },
  { code: '4311', intitule: 'Organismes sociaux (CNPS / IPRES / CSS)', intituleEn: 'Social security payable', classe: 4, nature: 'tiers_passif', sensNormal: 'credit' },
  { code: '4432', intitule: 'État, TVA facturée sur prestations de services', intituleEn: 'Output VAT on services', classe: 4, nature: 'tiers_passif', sensNormal: 'credit' },
  { code: '4441', intitule: 'État, TVA due ou crédit de TVA', intituleEn: 'Net VAT payable / credit', classe: 4, nature: 'tiers_passif', sensNormal: 'credit' },
  { code: '4452', intitule: 'État, TVA récupérable sur services et charges', intituleEn: 'Input VAT recoverable', classe: 4, nature: 'tiers_actif', sensNormal: 'debit' },
  { code: '4621', intitule: 'Associés, comptes courants', intituleEn: 'Shareholders current accounts', classe: 4, nature: 'tiers_passif', sensNormal: 'credit' },

  // Classe 5 — Comptes de trésorerie
  { code: '5211', intitule: 'Banques locales (virements, chèques, cartes)', intituleEn: 'Local bank accounts', classe: 5, nature: 'tresorerie', sensNormal: 'debit' },
  { code: '5212', intitule: 'Comptes Mobile Money & Monnaie électronique (Wave, OM, MTN, Moov)', intituleEn: 'Mobile Money & e-wallets', classe: 5, nature: 'tresorerie', sensNormal: 'debit' },
  { code: '5711', intitule: 'Caisse siège / boutique (espèces FCFA)', intituleEn: 'Cash on hand (FCFA)', classe: 5, nature: 'tresorerie', sensNormal: 'debit' },
  { code: '5851', intitule: 'Virements de fonds internes', intituleEn: 'Internal cash transfers', classe: 5, nature: 'tresorerie', sensNormal: 'debit' },

  // Classe 6 — Charges des activités ordinaires
  { code: '6042', intitule: 'Achats matières et produits consommables (lessive, détachants, solvants)', intituleEn: 'Consumables & detergents purchases', classe: 6, nature: 'charge', sensNormal: 'debit', tvaEligible: true },
  { code: '6051', intitule: 'Fournitures non stockables — Eau', intituleEn: 'Utilities — Water', classe: 6, nature: 'charge', sensNormal: 'debit', tvaEligible: true },
  { code: '6052', intitule: 'Fournitures non stockables — Électricité', intituleEn: 'Utilities — Electricity', classe: 6, nature: 'charge', sensNormal: 'debit', tvaEligible: true },
  { code: '6053', intitule: 'Autres énergies (carburant, gaz, groupe électrogène)', intituleEn: 'Fuel, gas & generator energy', classe: 6, nature: 'charge', sensNormal: 'debit', tvaEligible: true },
  { code: '6054', intitule: "Fournitures d'entretien et petit outillage", intituleEn: 'Cleaning supplies & small tools', classe: 6, nature: 'charge', sensNormal: 'debit', tvaEligible: true },
  { code: '6055', intitule: 'Fournitures de bureau, tickets et étiquettes', intituleEn: 'Office supplies, receipts & tags', classe: 6, nature: 'charge', sensNormal: 'debit', tvaEligible: true },
  { code: '6081', intitule: 'Achats emballages, housses et cintres', intituleEn: 'Packaging, garment bags & hangers', classe: 6, nature: 'charge', sensNormal: 'debit', tvaEligible: true },
  { code: '6181', intitule: 'Frais de transport, collecte et livraison', intituleEn: 'Transport, pickup & delivery costs', classe: 6, nature: 'charge', sensNormal: 'debit', tvaEligible: true },
  { code: '6222', intitule: 'Locations de bâtiments et loyers boutique', intituleEn: 'Shop rent & premises lease', classe: 6, nature: 'charge', sensNormal: 'debit', tvaEligible: true },
  { code: '6241', intitule: 'Entretien et réparations des machines & locaux', intituleEn: 'Equipment & premises maintenance', classe: 6, nature: 'charge', sensNormal: 'debit', tvaEligible: true },
  { code: '6251', intitule: "Primes d'assurance", intituleEn: 'Insurance premiums', classe: 6, nature: 'charge', sensNormal: 'debit', tvaEligible: false },
  { code: '6271', intitule: 'Publicité, flyers et relations publiques', intituleEn: 'Advertising & marketing', classe: 6, nature: 'charge', sensNormal: 'debit', tvaEligible: true },
  { code: '6281', intitule: 'Frais de télécommunications (téléphone, internet, SMS)', intituleEn: 'Telecom, phone & internet', classe: 6, nature: 'charge', sensNormal: 'debit', tvaEligible: true },
  { code: '6311', intitule: 'Frais bancaires et commissions Mobile Money', intituleEn: 'Bank & Mobile Money fees', classe: 6, nature: 'charge', sensNormal: 'debit', tvaEligible: false },
  { code: '6324', intitule: "Commissions et courtages (Apporteurs d'affaires)", intituleEn: 'Business introducer commissions', classe: 6, nature: 'charge', sensNormal: 'debit', tvaEligible: false },
  { code: '6325', intitule: 'Honoraires (comptable, conseil, juridique)', intituleEn: 'Professional & accounting fees', classe: 6, nature: 'charge', sensNormal: 'debit', tvaEligible: true },
  { code: '6411', intitule: 'Impôts, taxes, patentes et droits municipaux', intituleEn: 'Local taxes & business licenses', classe: 6, nature: 'charge', sensNormal: 'debit', tvaEligible: false },
  { code: '6588', intitule: "Autres charges diverses d'exploitation", intituleEn: 'Miscellaneous operating expenses', classe: 6, nature: 'charge', sensNormal: 'debit', tvaEligible: true },
  { code: '6611', intitule: 'Rémunérations directes du personnel (salaires & primes)', intituleEn: 'Staff salaries & bonuses', classe: 6, nature: 'charge', sensNormal: 'debit', tvaEligible: false },
  { code: '6641', intitule: 'Charges sociales sur rémunérations (CNPS / IPRES)', intituleEn: 'Employer social security charges', classe: 6, nature: 'charge', sensNormal: 'debit', tvaEligible: false },
  { code: '6711', intitule: 'Intérêts des emprunts et frais financiers', intituleEn: 'Loan interest & finance costs', classe: 6, nature: 'charge', sensNormal: 'debit', tvaEligible: false },
  { code: '6813', intitule: "Dotations aux amortissements d'exploitation", intituleEn: 'Operating depreciation expense', classe: 6, nature: 'charge', sensNormal: 'debit', tvaEligible: false },

  // Classe 7 — Produits des activités ordinaires
  { code: '7061', intitule: 'Services vendus — Prestations de pressing et blanchisserie', intituleEn: 'Laundry & dry-cleaning services revenue', classe: 7, nature: 'produit', sensNormal: 'credit' },
  { code: '7069', intitule: 'Rabais, remises et ristournes accordés', intituleEn: 'Discounts & rebates granted', classe: 7, nature: 'produit', sensNormal: 'debit' },
  { code: '7071', intitule: 'Ports et frais accessoires facturés (livraison / collecte)', intituleEn: 'Delivery & pickup fees billed', classe: 7, nature: 'produit', sensNormal: 'credit' },
  { code: '7588', intitule: "Autres produits divers d'exploitation", intituleEn: 'Other miscellaneous operating income', classe: 7, nature: 'produit', sensNormal: 'credit' },
  { code: '7711', intitule: 'Produits financiers et intérêts perçus', intituleEn: 'Financial income & interest', classe: 7, nature: 'produit', sensNormal: 'credit' },

  // Classe 8 — Autres charges & produits (HAO)
  { code: '8311', intitule: 'Charges HAO constatées', intituleEn: 'Non-ordinary expenses (HAO)', classe: 8, nature: 'hao', sensNormal: 'debit' },
  { code: '8411', intitule: 'Produits HAO constatés', intituleEn: 'Non-ordinary income (HAO)', classe: 8, nature: 'hao', sensNormal: 'credit' },
  { code: '8911', intitule: 'Impôts sur les bénéfices de l\'exercice', intituleEn: 'Corporate income tax', classe: 8, nature: 'hao', sensNormal: 'debit' },
];

export const SYSCOHADA_EXPENSE_ACCOUNTS: SyscohadaAccount[] = SYSCOHADA_PLAN_COMPTABLE.filter(
  (a) => a.classe === 6,
);

const ACCOUNT_MAP = new Map<string, SyscohadaAccount>(
  SYSCOHADA_PLAN_COMPTABLE.map((a) => [a.code, a]),
);

export function getSyscohadaAccount(code: string): SyscohadaAccount {
  const clean = code.trim();
  const found = ACCOUNT_MAP.get(clean);
  if (found) return found;
  const firstDigit = Number(clean.charAt(0));
  const classe = (firstDigit >= 1 && firstDigit <= 8 ? firstDigit : 6) as SyscohadaAccount['classe'];
  const sensNormal: 'debit' | 'credit' =
    classe === 1 || classe === 7 ? 'credit' : classe === 4 && clean.startsWith('40') ? 'credit' : 'debit';
  return {
    code: clean,
    intitule: `Compte ${clean}`,
    intituleEn: `Account ${clean}`,
    classe,
    nature: classe === 6 ? 'charge' : classe === 7 ? 'produit' : classe === 5 ? 'tresorerie' : 'tiers_actif',
    sensNormal,
  };
}

function normalizeSearch(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Maps a payment method label to the appropriate SYSCOHADA Class 5 account & journal.
 */
export function resolveTreasuryAccount(modeReglement?: string | null): {
  account: SyscohadaAccount;
  journal: 'CA' | 'BQ';
} {
  const m = normalizeSearch(modeReglement);
  if (
    /wave|orange\s*money|\bom\b|mtn|moov|mobile|flooz|t-?money|djamo|momo|airtel|mpesa|m-pesa|wari|free\s*money/.test(
      m,
    )
  ) {
    return { account: getSyscohadaAccount('5212'), journal: 'BQ' };
  }
  if (/banque|virement|cheque|chq|carte|cb|visa|mastercard|tpe|pos|bank|card|transfer/.test(m)) {
    return { account: getSyscohadaAccount('5211'), journal: 'BQ' };
  }
  return { account: getSyscohadaAccount('5711'), journal: 'CA' };
}

/**
 * Infers the best SYSCOHADA Class 6 account for an expense from its explicit code,
 * its category's mapped code, or intelligent keyword analysis.
 */
export function inferExpenseSyscohadaCode(
  categorie?: string | null,
  libelle?: string | null,
  explicitCode?: string | null,
  categoryMap?: Map<string, string | null | undefined>,
): string {
  if (explicitCode && explicitCode.trim()) return explicitCode.trim();
  if (categorie && categoryMap) {
    const mapped = categoryMap.get(categorie.toLowerCase().trim());
    if (mapped && mapped.trim()) return mapped.trim();
  }

  const text = `${normalizeSearch(categorie)} ${normalizeSearch(libelle)}`;
  if (!text.trim()) return '6588';

  if (/commission|apporteur|courtage|commercial/.test(text)) return '6324';
  if (/salaire|personnel|paie|employe|prime|main\s*d.?oeuvre|remuneration|acompte\s*salaire/.test(text)) return '6611';
  if (/cnps|ipres|css|charge\s*sociale|cotisation\s*sociale/.test(text)) return '6641';
  if (/loyer|location|bail/.test(text)) return '6222';
  if (/electricit|cie\b|senelec|eneo|sbee|ceet|edm|facture\s*courant|courant/.test(text)) return '6052';
  if (/\beau\b|sodeci|sde\b|sen.?eau|onea|regideso|forage/.test(text)) return '6051';
  if (/carburant|essence|gasoil|gazoil|diesel|groupe\s*electrogene|gaz\b|fuel/.test(text)) return '6053';
  if (/detergent|lessive|savon|detachant|solvant|perchlor|assouplissant|javel|amidon|consommable|produit\s*lavage/.test(text)) return '6042';
  if (/housse|cintre|emballage|sachet|sac\s*plastique|film\s*plastique/.test(text)) return '6081';
  if (/ticket|etiquette|papeterie|bureau|stylo|papier|rouleau\s*thermique|encre|cartouche/.test(text)) return '6055';
  if (/entretien|reparation|maintenance|depannage|plombier|electricien|piece\s*rechange|machine|fer\s*a\s*repasser|chaudiere/.test(text)) return '6241';
  if (/transport|livraison|collecte|taxi|moto|course|deplacement|fret/.test(text)) return '6181';
  if (/telephone|internet|wifi|fibre|orange|mtn|moov|credit\s*appel|data|sms|forfait/.test(text)) return '6281';
  if (/pub|publicit|marketing|flyer|affiche|facebook|instagram|boost|sponsor|enseigne/.test(text)) return '6271';
  if (/assurance/.test(text)) return '6251';
  if (/banque|agios|frais\s*bancaire|frais\s*wave|frais\s*retrait|frais\s*mobile/.test(text)) return '6311';
  if (/honoraire|comptable|avocat|notaire|audit|consultant/.test(text)) return '6325';
  if (/impot|taxe|patente|mairie|timbre|dgi|fisc|licence/.test(text)) return '6411';
  if (/nettoyage|balai|serpilliere|outillage/.test(text)) return '6054';
  if (/interet|emprunt|credit\s*bancaire/.test(text)) return '6711';

  return '6588';
}

// ─── Ledger Data Structures ──────────────────────────────────────────────────

export interface SyscohadaJournalLine {
  compte: string;
  intitule: string;
  libelle: string;
  tiers?: string | null;
  debit: number;
  credit: number;
}

export interface SyscohadaJournalEntry {
  id: string;
  date: string;
  journal: SyscohadaJournalCode;
  numeroPiece: string;
  libelle: string;
  source: 'auto_vente' | 'auto_encaissement' | 'auto_depense' | 'auto_commission' | 'manuel';
  manualRecordId?: string;
  lignes: SyscohadaJournalLine[];
  totalDebit: number;
  totalCredit: number;
  isBalanced: boolean;
}

export interface GrandLivreMovement {
  entryId: string;
  date: string;
  journal: SyscohadaJournalCode;
  numeroPiece: string;
  libelle: string;
  tiers?: string | null;
  debit: number;
  credit: number;
  soldeProgressif: number; // debit - credit cumulative
}

export interface GrandLivreAccount {
  compte: string;
  intitule: string;
  classe: number;
  sensNormal: 'debit' | 'credit';
  totalDebit: number;
  totalCredit: number;
  soldeDebiteur: number;
  soldeCrediteur: number;
  mouvements: GrandLivreMovement[];
}

export interface BalanceGeneraleRow {
  compte: string;
  intitule: string;
  classe: number;
  mouvementDebit: number;
  mouvementCredit: number;
  soldeDebiteur: number;
  soldeCrediteur: number;
}

export interface BalanceGenerale {
  rows: BalanceGeneraleRow[];
  totalMouvementDebit: number;
  totalMouvementCredit: number;
  totalSoldeDebiteur: number;
  totalSoldeCrediteur: number;
  isBalanced: boolean;
}

export interface CompteResultatLine {
  ref: string;
  label: string;
  labelEn: string;
  comptes: string;
  montant: number;
  isSubtotal?: boolean;
  isMajor?: boolean;
  sign?: '+' | '-' | '=';
}

export interface CompteResultatSyscohada {
  lines: CompteResultatLine[];
  chiffreAffairesBrut: number;
  remisesAccordees: number;
  chiffreAffairesNet: number; // XB
  consommationsIntermediaires: number; // 60+61+62+63
  valeurAjoutee: number; // XC
  chargesPersonnel: number; // 66
  ebe: number; // XD Excédent Brut d'Exploitation
  impotsTaxes: number; // 64
  autresCharges: number; // 65
  dotationsAmortissements: number; // 68
  autresProduits: number; // 75
  resultatExploitation: number; // XE
  resultatFinancier: number; // XF
  resultatActivitesOrdinaires: number; // XG
  resultatHao: number; // XH
  impotResultat: number; // 89
  resultatNet: number; // XI
}

export interface EtatSmt {
  recettesEncaissees: number;
  depensesDecaissees: number;
  soldeNetTresorerie: number;
  soldeCaisse5711: number;
  soldeBanque5211: number;
  soldeMobileMoney5212: number;
  tvaCollectee4432: number;
  tvaDeductible4452: number;
  tvaNetteAPayer: number;
  creancesClients4111: number;
}

export interface CreanceClientRow {
  depotId: string;
  numero: string;
  dateDepot: string;
  clientNom: string;
  total: number;
  paye: number;
  reste: number;
  joursAnciennete: number;
}

export interface SyscohadaLedgerResult {
  entries: SyscohadaJournalEntry[];
  grandLivre: GrandLivreAccount[];
  balance: BalanceGenerale;
  compteResultat: CompteResultatSyscohada;
  etatSmt: EtatSmt;
  creancesClients: CreanceClientRow[];
  unloggedCommissionsCount: number;
  unloggedCommissionsTotal: number;
}

function roundMoney(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

function splitHtTva(ttc: number, tauxTva: number): { ht: number; tva: number } {
  const safeTtc = roundMoney(ttc);
  if (!tauxTva || tauxTva <= 0) return { ht: safeTtc, tva: 0 };
  const ht = roundMoney(safeTtc / (1 + tauxTva / 100));
  const tva = roundMoney(safeTtc - ht);
  return { ht, tva };
}

export interface BuildSyscohadaInput {
  depots: DepotWithArticles[];
  allAvances: DepotAvance[];
  filteredAvances: DepotAvance[];
  depenses: Depense[];
  categories: DepenseCategory[];
  commissionVersements: CommissionVersement[];
  manualEntries: EcritureComptableRecord[];
  depotMap: Map<string, DepotWithArticles>;
  tauxTva: number;
  lang: 'fr' | 'en';
}

export function buildSyscohadaLedger(input: BuildSyscohadaInput): SyscohadaLedgerResult {
  const {
    depots,
    allAvances,
    filteredAvances,
    depenses,
    categories,
    commissionVersements,
    manualEntries,
    depotMap,
    tauxTva,
  } = input;

  const categoryAccountMap = new Map<string, string | null | undefined>();
  for (const c of categories) {
    categoryAccountMap.set(c.libelle.toLowerCase().trim(), c.compte_syscohada);
  }

  const entries: SyscohadaJournalEntry[] = [];

  // 1. Journal des Ventes & Prestations (VE) + Encaissement initial (CA/BQ)
  for (const d of depots) {
    const totalTtc = roundMoney(Number(d.total ?? 0));
    const piece = d.numero?.trim() || `DEP-${d.id.slice(0, 6).toUpperCase()}`;
    const clientNom = d.client?.nom ?? 'Client comptoir';

    if (totalTtc > 0) {
      const fraisAccessoiresTtc = roundMoney(
        Number(d.frais_livraison ?? 0) + Number(d.frais_collecte ?? 0),
      );
      const remiseTtc = roundMoney(Number(d.montant_remise ?? 0));

      const { ht: totalHt, tva: totalTva } = splitHtTva(totalTtc, tauxTva);
      const { ht: fraisHt } = splitHtTva(Math.min(fraisAccessoiresTtc, totalTtc), tauxTva);
      const { ht: remiseHt } = splitHtTva(remiseTtc, tauxTva);
      const prestationsNetHt = roundMoney(totalHt - fraisHt);
      const prestationsBrutHt = roundMoney(prestationsNetHt + remiseHt);

      const lignes: SyscohadaJournalLine[] = [
        {
          compte: '4111',
          intitule: getSyscohadaAccount('4111').intitule,
          libelle: `Facturation dépôt ${piece}`,
          tiers: clientNom,
          debit: totalTtc,
          credit: 0,
        },
      ];

      if (remiseHt > 0) {
        lignes.push({
          compte: '7069',
          intitule: getSyscohadaAccount('7069').intitule,
          libelle: `Remise accordée ${piece}`,
          tiers: clientNom,
          debit: remiseHt,
          credit: 0,
        });
      }

      if (prestationsBrutHt > 0) {
        lignes.push({
          compte: '7061',
          intitule: getSyscohadaAccount('7061').intitule,
          libelle: `Prestations pressing ${piece}`,
          tiers: clientNom,
          debit: 0,
          credit: prestationsBrutHt,
        });
      }

      if (fraisHt > 0) {
        lignes.push({
          compte: '7071',
          intitule: getSyscohadaAccount('7071').intitule,
          libelle: `Frais livraison / collecte ${piece}`,
          tiers: clientNom,
          debit: 0,
          credit: fraisHt,
        });
      }

      if (totalTva > 0) {
        lignes.push({
          compte: '4432',
          intitule: getSyscohadaAccount('4432').intitule,
          libelle: `TVA facturée (${tauxTva}%) ${piece}`,
          tiers: clientNom,
          debit: 0,
          credit: totalTva,
        });
      }

      // Guard exact rounding balance on 7061
      const sumD = roundMoney(lignes.reduce((s, l) => s + l.debit, 0));
      const sumC = roundMoney(lignes.reduce((s, l) => s + l.credit, 0));
      const diff = roundMoney(sumD - sumC);
      if (Math.abs(diff) > 0 && Math.abs(diff) <= 0.05) {
        const revLine = lignes.find((l) => l.compte === '7061');
        if (revLine) revLine.credit = roundMoney(revLine.credit + diff);
      }

      const finalD = roundMoney(lignes.reduce((s, l) => s + l.debit, 0));
      const finalC = roundMoney(lignes.reduce((s, l) => s + l.credit, 0));

      entries.push({
        id: `ve_${d.id}`,
        date: d.date_depot,
        journal: 'VE',
        numeroPiece: piece,
        libelle: `Facturation dépôt ${piece} — ${clientNom}`,
        source: 'auto_vente',
        lignes,
        totalDebit: finalD,
        totalCredit: finalC,
        isBalanced: Math.abs(finalD - finalC) < 0.01,
      });
    }

    // Initial payment on deposit
    const avanceInit = roundMoney(Number(d.avance_amount ?? 0));
    if (avanceInit > 0) {
      const { account: treso, journal } = resolveTreasuryAccount(d.mode_reglement);
      entries.push({
        id: `enc_init_${d.id}`,
        date: d.date_depot,
        journal,
        numeroPiece: `ENC-${piece}`,
        libelle: `Encaissement initial ${piece} — ${clientNom}${d.mode_reglement ? ` (${d.mode_reglement})` : ''}`,
        source: 'auto_encaissement',
        lignes: [
          {
            compte: treso.code,
            intitule: treso.intitule,
            libelle: `Encaissement ${d.mode_reglement || 'Espèces'}`,
            tiers: clientNom,
            debit: avanceInit,
            credit: 0,
          },
          {
            compte: '4111',
            intitule: getSyscohadaAccount('4111').intitule,
            libelle: `Règlement client ${piece}`,
            tiers: clientNom,
            debit: 0,
            credit: avanceInit,
          },
        ],
        totalDebit: avanceInit,
        totalCredit: avanceInit,
        isBalanced: true,
      });
    }
  }

  // 2. Encaissements complémentaires (depot_avances) -> CA / BQ
  for (const av of filteredAvances) {
    const montant = roundMoney(Number(av.montant ?? 0));
    if (montant <= 0) continue;
    const depot = depotMap.get(av.depot_id);
    const piece = depot?.numero?.trim() || `AV-${av.id.slice(0, 6).toUpperCase()}`;
    const clientNom = depot?.client?.nom ?? 'Client';
    const { account: treso, journal } = resolveTreasuryAccount(av.mode_reglement);

    entries.push({
      id: `enc_av_${av.id}`,
      date: av.date_paiement,
      journal,
      numeroPiece: `REG-${piece}`,
      libelle: `Règlement complémentaire ${piece} — ${clientNom}${av.mode_reglement ? ` (${av.mode_reglement})` : ''}`,
      source: 'auto_encaissement',
      lignes: [
        {
          compte: treso.code,
          intitule: treso.intitule,
          libelle: `Encaissement ${av.mode_reglement || 'Espèces'}`,
          tiers: clientNom,
          debit: montant,
          credit: 0,
        },
        {
          compte: '4111',
          intitule: getSyscohadaAccount('4111').intitule,
          libelle: `Apurement créance ${piece}`,
          tiers: clientNom,
          debit: 0,
          credit: montant,
        },
      ],
      totalDebit: montant,
      totalCredit: montant,
      isBalanced: true,
    });
  }

  // 3. Achats & Charges (depenses) -> AC (charge vs 4011) + CA/BQ (4011 vs trésorerie)
  // Also track commission expenses to avoid double counting commission_versements
  const matchedCommissionSignatures = new Set<string>();

  for (const dep of depenses) {
    const montantTtc = roundMoney(Number(dep.montant ?? 0));
    if (montantTtc <= 0) continue;
    const codeCompte = inferExpenseSyscohadaCode(
      dep.categorie,
      dep.libelle,
      dep.compte_syscohada,
      categoryAccountMap,
    );
    const chargeAccount = getSyscohadaAccount(codeCompte);
    const piece = `DEP-${dep.id.slice(0, 6).toUpperCase()}`;
    const tiers = dep.categorie || 'Fournisseur divers';

    if (codeCompte === '6324' || /commission|apporteur/i.test(`${dep.categorie ?? ''} ${dep.libelle}`)) {
      matchedCommissionSignatures.add(`${dep.date_depense.slice(0, 10)}_${Math.round(montantTtc)}`);
    }

    const applyTva = tauxTva > 0 && Boolean(chargeAccount.tvaEligible);
    const { ht, tva } = applyTva ? splitHtTva(montantTtc, tauxTva) : { ht: montantTtc, tva: 0 };

    const acLines: SyscohadaJournalLine[] = [
      {
        compte: chargeAccount.code,
        intitule: chargeAccount.intitule,
        libelle: dep.libelle,
        tiers,
        debit: ht,
        credit: 0,
      },
    ];
    if (tva > 0) {
      acLines.push({
        compte: '4452',
        intitule: getSyscohadaAccount('4452').intitule,
        libelle: `TVA récupérable (${tauxTva}%) — ${dep.libelle}`,
        tiers,
        debit: tva,
        credit: 0,
      });
    }
    acLines.push({
      compte: '4011',
      intitule: getSyscohadaAccount('4011').intitule,
      libelle: `Charge à régler — ${dep.libelle}`,
      tiers,
      debit: 0,
      credit: montantTtc,
    });

    entries.push({
      id: `ac_${dep.id}`,
      date: dep.date_depense,
      journal: 'AC',
      numeroPiece: piece,
      libelle: `${dep.libelle}${dep.categorie ? ` [${dep.categorie}]` : ''}`,
      source: 'auto_depense',
      lignes: acLines,
      totalDebit: montantTtc,
      totalCredit: montantTtc,
      isBalanced: true,
    });

    // Immediate cash/bank settlement
    const { account: treso, journal } = resolveTreasuryAccount(dep.mode_reglement);
    entries.push({
      id: `dec_${dep.id}`,
      date: dep.date_depense,
      journal,
      numeroPiece: `PAY-${dep.id.slice(0, 6).toUpperCase()}`,
      libelle: `Règlement dépense — ${dep.libelle}${dep.mode_reglement ? ` (${dep.mode_reglement})` : ''}`,
      source: 'auto_depense',
      lignes: [
        {
          compte: '4011',
          intitule: getSyscohadaAccount('4011').intitule,
          libelle: `Solde fournisseur — ${dep.libelle}`,
          tiers,
          debit: montantTtc,
          credit: 0,
        },
        {
          compte: treso.code,
          intitule: treso.intitule,
          libelle: `Décaissement ${dep.mode_reglement || 'Espèces'}`,
          tiers,
          debit: 0,
          credit: montantTtc,
        },
      ],
      totalDebit: montantTtc,
      totalCredit: montantTtc,
      isBalanced: true,
    });
  }

  // 4. Commissions versées aux apporteurs d'affaires non déjà passées en dépenses -> 6324
  let unloggedCommissionsCount = 0;
  let unloggedCommissionsTotal = 0;

  for (const cv of commissionVersements) {
    const montant = roundMoney(Number(cv.montant ?? 0));
    if (montant <= 0) continue;
    const sig = `${cv.date_versement.slice(0, 10)}_${Math.round(montant)}`;
    if (matchedCommissionSignatures.has(sig)) {
      // Already accounted via depenses to prevent double counting
      matchedCommissionSignatures.delete(sig);
      continue;
    }
    unloggedCommissionsCount += 1;
    unloggedCommissionsTotal = roundMoney(unloggedCommissionsTotal + montant);

    const piece = cv.reference?.trim() || `COM-${cv.id.slice(0, 6).toUpperCase()}`;
    const { account: treso, journal } = resolveTreasuryAccount(cv.mode_reglement);

    entries.push({
      id: `com_${cv.id}`,
      date: cv.date_versement,
      journal,
      numeroPiece: piece,
      libelle: `Commission apporteur d'affaire${cv.reference ? ` (${cv.reference})` : ''}`,
      source: 'auto_commission',
      lignes: [
        {
          compte: '6324',
          intitule: getSyscohadaAccount('6324').intitule,
          libelle: "Versement commission apporteur d'affaire",
          tiers: "Apporteur d'affaire",
          debit: montant,
          credit: 0,
        },
        {
          compte: treso.code,
          intitule: treso.intitule,
          libelle: `Règlement commission (${cv.mode_reglement || 'Espèces'})`,
          tiers: "Apporteur d'affaire",
          debit: 0,
          credit: montant,
        },
      ],
      totalDebit: montant,
      totalCredit: montant,
      isBalanced: true,
    });
  }

  // 5. Écritures manuelles (OD / autres journaux)
  for (const rec of manualEntries) {
    const lignes: SyscohadaJournalLine[] = (rec.lignes ?? []).map((l) => {
      const acc = getSyscohadaAccount(l.compte);
      return {
        compte: acc.code,
        intitule: l.intitule || acc.intitule,
        libelle: l.libelle || rec.libelle,
        tiers: l.tiers ?? null,
        debit: roundMoney(Number(l.debit ?? 0)),
        credit: roundMoney(Number(l.credit ?? 0)),
      };
    });
    const totalD = roundMoney(lignes.reduce((s, l) => s + l.debit, 0));
    const totalC = roundMoney(lignes.reduce((s, l) => s + l.credit, 0));
    if (lignes.length === 0 || (totalD === 0 && totalC === 0)) continue;

    entries.push({
      id: `man_${rec.id}`,
      date: rec.date_ecriture,
      journal: rec.journal || 'OD',
      numeroPiece: rec.numero_piece,
      libelle: rec.libelle,
      source: 'manuel',
      manualRecordId: rec.id,
      lignes,
      totalDebit: totalD,
      totalCredit: totalC,
      isBalanced: Math.abs(totalD - totalC) < 0.01,
    });
  }

  // Chronological order (oldest -> newest for running balances in Grand Livre,
  // while UI can display newest first or chronological)
  const chronologicalEntries = [...entries].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  // ─── Grand Livre Général ───────────────────────────────────────────────────
  const glMap = new Map<string, GrandLivreAccount>();

  for (const entry of chronologicalEntries) {
    for (const line of entry.lignes) {
      const acc = getSyscohadaAccount(line.compte);
      let bucket = glMap.get(acc.code);
      if (!bucket) {
        bucket = {
          compte: acc.code,
          intitule: line.intitule || acc.intitule,
          classe: acc.classe,
          sensNormal: acc.sensNormal,
          totalDebit: 0,
          totalCredit: 0,
          soldeDebiteur: 0,
          soldeCrediteur: 0,
          mouvements: [],
        };
        glMap.set(acc.code, bucket);
      }
      bucket.totalDebit = roundMoney(bucket.totalDebit + line.debit);
      bucket.totalCredit = roundMoney(bucket.totalCredit + line.credit);
      const running = roundMoney(bucket.totalDebit - bucket.totalCredit);
      bucket.mouvements.push({
        entryId: entry.id,
        date: entry.date,
        journal: entry.journal,
        numeroPiece: entry.numeroPiece,
        libelle: line.libelle || entry.libelle,
        tiers: line.tiers,
        debit: line.debit,
        credit: line.credit,
        soldeProgressif: running,
      });
    }
  }

  const grandLivre = Array.from(glMap.values())
    .map((acc) => {
      const diff = roundMoney(acc.totalDebit - acc.totalCredit);
      return {
        ...acc,
        soldeDebiteur: diff > 0 ? diff : 0,
        soldeCrediteur: diff < 0 ? Math.abs(diff) : 0,
      };
    })
    .sort((a, b) => a.compte.localeCompare(b.compte));

  // ─── Balance Générale à 6 colonnes ─────────────────────────────────────────
  const balanceRows: BalanceGeneraleRow[] = grandLivre.map((g) => ({
    compte: g.compte,
    intitule: g.intitule,
    classe: g.classe,
    mouvementDebit: g.totalDebit,
    mouvementCredit: g.totalCredit,
    soldeDebiteur: g.soldeDebiteur,
    soldeCrediteur: g.soldeCrediteur,
  }));

  const totalMouvementDebit = roundMoney(balanceRows.reduce((s, r) => s + r.mouvementDebit, 0));
  const totalMouvementCredit = roundMoney(balanceRows.reduce((s, r) => s + r.mouvementCredit, 0));
  const totalSoldeDebiteur = roundMoney(balanceRows.reduce((s, r) => s + r.soldeDebiteur, 0));
  const totalSoldeCrediteur = roundMoney(balanceRows.reduce((s, r) => s + r.soldeCrediteur, 0));

  const balance: BalanceGenerale = {
    rows: balanceRows,
    totalMouvementDebit,
    totalMouvementCredit,
    totalSoldeDebiteur,
    totalSoldeCrediteur,
    isBalanced:
      Math.abs(totalMouvementDebit - totalMouvementCredit) < 0.01 &&
      Math.abs(totalSoldeDebiteur - totalSoldeCrediteur) < 0.01,
  };

  // Helper to sum net balance (credit - debit for products, debit - credit for charges) by account prefix
  const sumNetCredit = (prefixes: string[]): number =>
    roundMoney(
      balanceRows
        .filter((r) => prefixes.some((p) => r.compte.startsWith(p)))
        .reduce((s, r) => s + (r.mouvementCredit - r.mouvementDebit), 0),
    );

  const sumNetDebit = (prefixes: string[]): number =>
    roundMoney(
      balanceRows
        .filter((r) => prefixes.some((p) => r.compte.startsWith(p)))
        .reduce((s, r) => s + (r.mouvementDebit - r.mouvementCredit), 0),
    );

  // ─── Compte de Résultat SYSCOHADA Révisé (SIG) ─────────────────────────────
  const servicesVendus = sumNetCredit(['7061', '7062', '7063', '7064', '7065', '7066', '7067', '7068']);
  const produitsAccessoires = sumNetCredit(['707']);
  const remisesAccordees = sumNetDebit(['7069', '709']);
  const chiffreAffairesBrut = roundMoney(servicesVendus + produitsAccessoires);
  const chiffreAffairesNet = roundMoney(chiffreAffairesBrut - remisesAccordees);

  const achatsConsommables = sumNetDebit(['60']);
  const transports = sumNetDebit(['61']);
  const servicesExterieursA = sumNetDebit(['62']);
  const servicesExterieursB = sumNetDebit(['63']);
  const consommationsIntermediaires = roundMoney(
    achatsConsommables + transports + servicesExterieursA + servicesExterieursB,
  );

  const valeurAjoutee = roundMoney(chiffreAffairesNet - consommationsIntermediaires);
  const chargesPersonnel = sumNetDebit(['66']);
  const ebe = roundMoney(valeurAjoutee - chargesPersonnel);

  const impotsTaxes = sumNetDebit(['64']);
  const autresCharges = sumNetDebit(['65']);
  const dotationsAmortissements = sumNetDebit(['68', '69']);
  const autresProduits = sumNetCredit(['75', '78', '79']);

  const resultatExploitation = roundMoney(
    ebe + autresProduits - impotsTaxes - autresCharges - dotationsAmortissements,
  );

  const produitsFinanciers = sumNetCredit(['77']);
  const chargesFinancieres = sumNetDebit(['67']);
  const resultatFinancier = roundMoney(produitsFinanciers - chargesFinancieres);
  const resultatActivitesOrdinaires = roundMoney(resultatExploitation + resultatFinancier);

  const produitsHao = sumNetCredit(['82', '84', '86', '88']);
  const chargesHao = sumNetDebit(['81', '83', '85']);
  const resultatHao = roundMoney(produitsHao - chargesHao);
  const impotResultat = sumNetDebit(['89']);

  const resultatNet = roundMoney(resultatActivitesOrdinaires + resultatHao - impotResultat);

  const compteResultat: CompteResultatSyscohada = {
    chiffreAffairesBrut,
    remisesAccordees,
    chiffreAffairesNet,
    consommationsIntermediaires,
    valeurAjoutee,
    chargesPersonnel,
    ebe,
    impotsTaxes,
    autresCharges,
    dotationsAmortissements,
    autresProduits,
    resultatExploitation,
    resultatFinancier,
    resultatActivitesOrdinaires,
    resultatHao,
    impotResultat,
    resultatNet,
    lines: [
      { ref: 'TC', label: 'Prestations de services (pressing & blanchisserie)', labelEn: 'Laundry & dry-cleaning services', comptes: '7061', montant: servicesVendus, sign: '+' },
      { ref: 'TD', label: 'Produits accessoires (livraison & collecte)', labelEn: 'Ancillary revenue (delivery & pickup)', comptes: '7071', montant: produitsAccessoires, sign: '+' },
      { ref: 'TE', label: 'Rabais, remises et ristournes accordés', labelEn: 'Discounts & rebates granted', comptes: '7069', montant: -remisesAccordees, sign: '-' },
      { ref: 'XB', label: "CHIFFRE D'AFFAIRES NET (CA)", labelEn: 'NET REVENUE (TURNOVER)', comptes: '70', montant: chiffreAffairesNet, isSubtotal: true, sign: '=' },
      { ref: 'RC', label: 'Achats de matières, produits & fournitures (eau, élec., lessives)', labelEn: 'Consumables, utilities & supplies', comptes: '60', montant: -achatsConsommables, sign: '-' },
      { ref: 'RF', label: 'Transports', labelEn: 'Transport & delivery', comptes: '61', montant: -transports, sign: '-' },
      { ref: 'RG', label: 'Services extérieurs (loyers, entretien, télécom, pub)', labelEn: 'External services (rent, maintenance, telecom)', comptes: '62', montant: -servicesExterieursA, sign: '-' },
      { ref: 'RH', label: "Autres services extérieurs (commissions apporteurs, honoraires, banque)", labelEn: 'Other external services (commissions, fees)', comptes: '63', montant: -servicesExterieursB, sign: '-' },
      { ref: 'XC', label: 'VALEUR AJOUTÉE (VA)', labelEn: 'VALUE ADDED (VA)', comptes: 'XB - 60..63', montant: valeurAjoutee, isSubtotal: true, sign: '=' },
      { ref: 'RK', label: 'Charges de personnel (salaires & charges sociales)', labelEn: 'Staff costs & social charges', comptes: '66', montant: -chargesPersonnel, sign: '-' },
      { ref: 'XD', label: "EXCÉDENT BRUT D'EXPLOITATION (EBE)", labelEn: 'GROSS OPERATING SURPLUS (EBITDA / EBE)', comptes: 'XC - 66', montant: ebe, isSubtotal: true, sign: '=' },
      { ref: 'TJ', label: "Autres produits d'exploitation", labelEn: 'Other operating income', comptes: '75 / 78', montant: autresProduits, sign: '+' },
      { ref: 'RI', label: 'Impôts et taxes', labelEn: 'Taxes & duties', comptes: '64', montant: -impotsTaxes, sign: '-' },
      { ref: 'RJ', label: "Autres charges d'exploitation", labelEn: 'Other operating expenses', comptes: '65', montant: -autresCharges, sign: '-' },
      { ref: 'RL', label: 'Dotations aux amortissements et provisions', labelEn: 'Depreciation & amortization', comptes: '68 / 69', montant: -dotationsAmortissements, sign: '-' },
      { ref: 'XE', label: "RÉSULTAT D'EXPLOITATION (RE)", labelEn: 'OPERATING INCOME (EBIT)', comptes: 'XD + 75 - 64 - 65 - 68', montant: resultatExploitation, isSubtotal: true, sign: '=' },
      { ref: 'XF', label: 'Résultat financier (produits 77 − charges 67)', labelEn: 'Financial result (77 − 67)', comptes: '77 / 67', montant: resultatFinancier, sign: '+' },
      { ref: 'XG', label: 'RÉSULTAT DES ACTIVITÉS ORDINAIRES (RAO)', labelEn: 'ORDINARY ACTIVITIES RESULT', comptes: 'XE + XF', montant: resultatActivitesOrdinaires, isSubtotal: true, sign: '=' },
      { ref: 'XH', label: 'Résultat Hors Activités Ordinaires (HAO)', labelEn: 'Non-ordinary result (HAO)', comptes: '81..88', montant: resultatHao, sign: '+' },
      { ref: 'RS', label: 'Impôts sur le résultat', labelEn: 'Income tax', comptes: '89', montant: -impotResultat, sign: '-' },
      { ref: 'XI', label: "RÉSULTAT NET DE L'EXERCICE", labelEn: 'NET INCOME FOR THE PERIOD', comptes: 'XG + XH - 89', montant: resultatNet, isSubtotal: true, isMajor: true, sign: '=' },
    ],
  };

  // ─── État SMT (Système Minimal de Trésorerie) ──────────────────────────────
  const getAccountDebitFlow = (code: string) =>
    balanceRows.find((r) => r.compte === code)?.mouvementDebit ?? 0;
  const getAccountCreditFlow = (code: string) =>
    balanceRows.find((r) => r.compte === code)?.mouvementCredit ?? 0;

  const soldeCaisse5711 = roundMoney(getAccountDebitFlow('5711') - getAccountCreditFlow('5711'));
  const soldeBanque5211 = roundMoney(getAccountDebitFlow('5211') - getAccountCreditFlow('5211'));
  const soldeMobileMoney5212 = roundMoney(getAccountDebitFlow('5212') - getAccountCreditFlow('5212'));

  const recettesEncaissees = roundMoney(
    getAccountDebitFlow('5711') + getAccountDebitFlow('5211') + getAccountDebitFlow('5212'),
  );
  const depensesDecaissees = roundMoney(
    getAccountCreditFlow('5711') + getAccountCreditFlow('5211') + getAccountCreditFlow('5212'),
  );
  const soldeNetTresorerie = roundMoney(recettesEncaissees - depensesDecaissees);

  const tvaCollectee4432 = sumNetCredit(['4432']);
  const tvaDeductible4452 = sumNetDebit(['4452']);
  const tvaNetteAPayer = roundMoney(tvaCollectee4432 - tvaDeductible4452);
  const creancesClients4111 = Math.max(0, sumNetDebit(['4111']));

  const etatSmt: EtatSmt = {
    recettesEncaissees,
    depensesDecaissees,
    soldeNetTresorerie,
    soldeCaisse5711,
    soldeBanque5211,
    soldeMobileMoney5212,
    tvaCollectee4432,
    tvaDeductible4452,
    tvaNetteAPayer,
    creancesClients4111,
  };

  // ─── Créances Clients (4111) détaillées ────────────────────────────────────
  const avancesByDepot = new Map<string, number>();
  for (const a of allAvances) {
    avancesByDepot.set(a.depot_id, (avancesByDepot.get(a.depot_id) ?? 0) + Number(a.montant ?? 0));
  }
  const nowMs = Date.now();
  const creancesClients: CreanceClientRow[] = [];
  for (const d of depots) {
    const total = roundMoney(Number(d.total ?? 0));
    const paye = roundMoney(Number(d.avance_amount ?? 0) + (avancesByDepot.get(d.id) ?? 0));
    const reste = roundMoney(total - paye);
    if (reste > 0.5) {
      const days = Math.max(
        0,
        Math.floor((nowMs - new Date(d.date_depot).getTime()) / (24 * 60 * 60 * 1000)),
      );
      creancesClients.push({
        depotId: d.id,
        numero: d.numero ?? '—',
        dateDepot: d.date_depot,
        clientNom: d.client?.nom ?? 'Client inconnu',
        total,
        paye,
        reste,
        joursAnciennete: days,
      });
    }
  }
  creancesClients.sort((a, b) => b.reste - a.reste);

  // Return entries newest first for display in Journal tab
  const entriesDesc = [...chronologicalEntries].reverse();

  return {
    entries: entriesDesc,
    grandLivre,
    balance,
    compteResultat,
    etatSmt,
    creancesClients,
    unloggedCommissionsCount,
    unloggedCommissionsTotal,
  };
}
