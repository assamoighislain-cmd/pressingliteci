import { useState, useEffect, useMemo, useCallback } from 'react';
import { useI18n } from '@/lib/i18n';
import { db } from '@/lib/db';
import { useAuth } from '@/lib/auth';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import {
  DepotWithArticles,
  DepotAvance,
  ModeReglementRow,
  Depense,
  DepenseCategory,
  CommissionVersement,
  EcritureComptableRecord,
  Entreprise,
  SyscohadaJournalCode,
  formatPrice,
  formatDateShort,
  getModeReglementLabel,
  mergeBoutiqueHeaderIntoEntreprise,
} from '@/types';
import {
  buildSyscohadaLedger,
  SYSCOHADA_PLAN_COMPTABLE,
  SYSCOHADA_CLASS_LABELS,
  SYSCOHADA_JOURNAL_LABELS,
} from '@/lib/syscohada';
import type { SyscohadaPdfStatement } from '@/lib/syscohadaExport';
import {
  Calculator,
  TrendingUp,
  TrendingDown,
  Wallet,
  CheckCircle2,
  CreditCard,
  CalendarDays,
  Filter,
  ChevronDown,
  ChevronRight,
  PieChart,
  ArrowDownCircle,
  ArrowUpCircle,
  Scale,
  Printer,
  FileSpreadsheet,
  FileText,
  BookOpen,
  Layers,
  ListChecks,
  Plus,
  Trash2,
  Search,
  Landmark,
  Smartphone,
  Banknote,
  AlertCircle,
  Settings2,
} from 'lucide-react';
import { PrintableReport, printReport, type ReportData } from '@/components/PrintableReport';
import SyscohadaOdModal from '@/components/SyscohadaOdModal';

type PeriodFilter = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'all' | 'custom';
type ComptaTab = 'synthese' | 'resultat' | 'balance' | 'grand_livre' | 'journal' | 'plan';

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

function getWeekStart(d: Date): Date {
  const r = startOfDay(d);
  const day = r.getDay();
  const diff = day === 0 ? 6 : day - 1;
  r.setDate(r.getDate() - diff);
  return r;
}

function getMonthStart(d: Date): Date {
  const r = startOfDay(d);
  r.setDate(1);
  return r;
}

function getQuarterStart(d: Date): Date {
  const r = startOfDay(d);
  const qMonth = Math.floor(r.getMonth() / 3) * 3;
  r.setMonth(qMonth, 1);
  return r;
}

function getYearStart(d: Date): Date {
  const r = startOfDay(d);
  r.setMonth(0, 1);
  return r;
}

export default function Comptabilite() {
  const { t, lang } = useI18n();
  const { role, currentBoutique } = useAuth();

  const isCommercialOnly = role === 'commercial';
  const canWriteAccounting =
    !role || role === 'admin' || role === 'gerant' || role === 'comptable';

  const [depots, setDepots] = useState<DepotWithArticles[]>([]);
  const [avances, setAvances] = useState<DepotAvance[]>([]);
  const [depenses, setDepenses] = useState<Depense[]>([]);
  const [categories, setCategories] = useState<DepenseCategory[]>([]);
  const [commissions, setCommissions] = useState<CommissionVersement[]>([]);
  const [manualEntries, setManualEntries] = useState<EcritureComptableRecord[]>([]);
  const [modes, setModes] = useState<ModeReglementRow[]>([]);
  const [entreprise, setEntreprise] = useState<Entreprise | null>(null);
  const [loading, setLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<ComptaTab>('synthese');
  const [period, setPeriod] = useState<PeriodFilter>(isCommercialOnly ? 'today' : 'month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());

  // Fiscal regime & VAT settings (SMT 0% default, or Normal with configurable VAT)
  const [regimeFiscal, setRegimeFiscal] = useState<'SMT' | 'NORMAL'>('SMT');
  const [tauxTva, setTauxTva] = useState<number>(0);
  const [showFiscalConfig, setShowFiscalConfig] = useState(false);
  const [savingFiscal, setSavingFiscal] = useState(false);

  // Filters for Balance, Grand Livre, Journal, Plan Comptable
  const [balanceClassFilter, setBalanceClassFilter] = useState<number | 'all'>('all');
  const [balanceSearch, setBalanceSearch] = useState('');
  const [glSearch, setGlSearch] = useState('');
  const [journalFilter, setJournalFilter] = useState<SyscohadaJournalCode | 'ALL'>('ALL');
  const [journalSearch, setJournalSearch] = useState('');
  const [planClassFilter, setPlanClassFilter] = useState<number | 'all'>('all');
  const [planSearch, setPlanSearch] = useState('');

  // Manual OD modal & feedback
  const [showOdModal, setShowOdModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  const loadComptabilite = useCallback(async () => {
    const [
      depotsData,
      avancesData,
      depensesData,
      categoriesData,
      modesData,
      entData,
      commissionsRes,
      manualRes,
    ] = await Promise.all([
      db.getAllDepotsWithClient(),
      db.getAllAvances(),
      db.getAllDepenses(),
      db.getAllDepenseCategories(),
      db.getModesReglement(),
      db.getEntreprise(),
      db.getCommissionVersements(),
      db.getEcrituresComptables(),
    ]);

    setDepots(depotsData);
    setAvances(avancesData);
    setDepenses(depensesData);
    setCategories(categoriesData);
    setModes(modesData);
    setEntreprise(entData);
    setCommissions(commissionsRes.data ?? []);
    setManualEntries(manualRes.data ?? []);

    // Hydrate fiscal settings from entreprise or localStorage fallback
    const localFiscalKey = `syscohada_fiscal_${entData?.id ?? 'default'}`;
    let savedRegime: 'SMT' | 'NORMAL' = entData?.regime_fiscal === 'NORMAL' ? 'NORMAL' : 'SMT';
    let savedTva = typeof entData?.taux_tva === 'number' && Number.isFinite(entData.taux_tva) ? entData.taux_tva : 0;
    try {
      const raw = localStorage.getItem(localFiscalKey);
      if (raw && !entData?.regime_fiscal) {
        const parsed = JSON.parse(raw);
        if (parsed.regime === 'NORMAL' || parsed.regime === 'SMT') savedRegime = parsed.regime;
        if (typeof parsed.tva === 'number') savedTva = parsed.tva;
      }
    } catch {
      // Ignore
    }
    setRegimeFiscal(savedRegime);
    setTauxTva(savedRegime === 'SMT' ? 0 : savedTva);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadComptabilite();
  }, [loadComptabilite]);

  useRealtimeSync(
    [
      'depots',
      'depot_avances',
      'depenses',
      'depense_categories',
      'commission_versements',
      'ecritures_comptables',
      'clients',
      'modes_reglement',
      'entreprise',
    ],
    loadComptabilite,
  );

  const effectiveEntreprise = useMemo(
    () => mergeBoutiqueHeaderIntoEntreprise(entreprise, currentBoutique),
    [entreprise, currentBoutique],
  );

  const depotMap = useMemo(() => {
    const m = new Map<string, DepotWithArticles>();
    for (const d of depots) m.set(d.id, d);
    return m;
  }, [depots]);

  const { startDate, endDate, periodLabel } = useMemo(() => {
    const now = new Date();
    if (period === 'today') {
      return { startDate: startOfDay(now), endDate: endOfDay(now), periodLabel: t('compta.today') };
    }
    if (period === 'week') {
      return { startDate: getWeekStart(now), endDate: endOfDay(now), periodLabel: t('compta.thisWeek') };
    }
    if (period === 'month') {
      return { startDate: getMonthStart(now), endDate: endOfDay(now), periodLabel: t('compta.thisMonth') };
    }
    if (period === 'quarter') {
      return { startDate: getQuarterStart(now), endDate: endOfDay(now), periodLabel: t('compta.thisQuarter') };
    }
    if (period === 'year') {
      return { startDate: getYearStart(now), endDate: endOfDay(now), periodLabel: `${t('compta.thisYear')} ${now.getFullYear()}` };
    }
    if (period === 'custom' && customStart && customEnd) {
      return {
        startDate: startOfDay(new Date(customStart)),
        endDate: endOfDay(new Date(customEnd)),
        periodLabel: `${formatDateShort(customStart)} - ${formatDateShort(customEnd)}`,
      };
    }
    return { startDate: null, endDate: null, periodLabel: t('compta.allPeriods') };
  }, [period, customStart, customEnd, t]);

  const filteredDepots = useMemo(() => {
    if (!startDate || !endDate) return depots;
    return depots.filter((d) => {
      const dt = new Date(d.date_depot);
      return dt >= startDate && dt <= endDate;
    });
  }, [depots, startDate, endDate]);

  const filteredAvances = useMemo(() => {
    if (!startDate || !endDate) return avances;
    return avances.filter((a) => {
      const dt = new Date(a.date_paiement);
      return dt >= startDate && dt <= endDate;
    });
  }, [avances, startDate, endDate]);

  const filteredDepenses = useMemo(() => {
    if (!startDate || !endDate) return depenses;
    return depenses.filter((d) => {
      const dt = new Date(d.date_depense);
      return dt >= startDate && dt <= endDate;
    });
  }, [depenses, startDate, endDate]);

  const filteredCommissions = useMemo(() => {
    if (!startDate || !endDate) return commissions;
    return commissions.filter((c) => {
      const dt = new Date(c.date_versement);
      return dt >= startDate && dt <= endDate;
    });
  }, [commissions, startDate, endDate]);

  const filteredManualEntries = useMemo(() => {
    if (!startDate || !endDate) return manualEntries;
    return manualEntries.filter((e) => {
      const dt = new Date(e.date_ecriture);
      return dt >= startDate && dt <= endDate;
    });
  }, [manualEntries, startDate, endDate]);

  // ─── SYSCOHADA Ledger Computation ──────────────────────────────────────────
  const activeTvaRate = regimeFiscal === 'NORMAL' ? tauxTva : 0;
  const regimeLabel =
    regimeFiscal === 'NORMAL'
      ? `Système Normal — TVA ${activeTvaRate}%`
      : 'SMT — Sans TVA (0%)';

  const ledger = useMemo(
    () =>
      buildSyscohadaLedger({
        depots: filteredDepots,
        allAvances: avances,
        filteredAvances,
        depenses: filteredDepenses,
        categories,
        commissionVersements: filteredCommissions,
        manualEntries: filteredManualEntries,
        depotMap,
        tauxTva: activeTvaRate,
        lang,
      }),
    [
      filteredDepots,
      avances,
      filteredAvances,
      filteredDepenses,
      categories,
      filteredCommissions,
      filteredManualEntries,
      depotMap,
      activeTvaRate,
      lang,
    ],
  );

  // Operational summary metrics (preserved for continuity & commercial view)
  const caTheorique = useMemo(
    () => filteredDepots.reduce((sum, d) => sum + Number(d.total), 0),
    [filteredDepots],
  );
  const encaisseInitial = useMemo(
    () =>
      filteredDepots
        .filter((d) => d.avance_amount && Number(d.avance_amount) > 0)
        .reduce((sum, d) => sum + Number(d.avance_amount), 0),
    [filteredDepots],
  );
  const encaisseAvances = useMemo(
    () => filteredAvances.reduce((sum, a) => sum + Number(a.montant), 0),
    [filteredAvances],
  );
  const totalEncaisse = encaisseInitial + encaisseAvances;
  const resteEncaisser = Math.max(0, caTheorique - totalEncaisse);

  const depotsRegles = useMemo(
    () =>
      filteredDepots.filter((d) => {
        const av = avances
          .filter((a) => a.depot_id === d.id)
          .reduce((s, a) => s + Number(a.montant), 0);
        const totalPaye = Number(d.avance_amount ?? 0) + av;
        return totalPaye >= Number(d.total);
      }),
    [filteredDepots, avances],
  );
  const depotsEnCours = filteredDepots.length - depotsRegles.length;

  // Payment mode distribution
  const parMode = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of filteredDepots) {
      if (d.avance_amount && Number(d.avance_amount) > 0) {
        const key = d.mode_reglement ?? t('compta.notSpecified');
        map.set(key, (map.get(key) ?? 0) + Number(d.avance_amount));
      }
    }
    for (const a of filteredAvances) {
      const key = a.mode_reglement ?? t('compta.notSpecified');
      map.set(key, (map.get(key) ?? 0) + Number(a.montant));
    }
    return Array.from(map.entries())
      .map(([key, montant]) => ({
        label: getModeReglementLabel(key === t('compta.notSpecified') ? null : key, modes),
        montant,
        pct: totalEncaisse > 0 ? (montant / totalEncaisse) * 100 : 0,
      }))
      .sort((a, b) => b.montant - a.montant);
  }, [filteredDepots, filteredAvances, modes, totalEncaisse, t]);

  // Daily collection detail groups
  const groups = useMemo(() => {
    interface DayEntry {
      date: string;
      numero: string;
      clientNom: string;
      modeLabel: string;
      montant: number;
      type: 'depot' | 'avance';
    }
    const entries: DayEntry[] = [];
    for (const d of filteredDepots) {
      if (d.avance_amount && Number(d.avance_amount) > 0) {
        entries.push({
          date: d.date_depot,
          numero: d.numero ?? '—',
          clientNom: d.client?.nom ?? t('compta.unknownClient'),
          modeLabel: d.mode_reglement
            ? getModeReglementLabel(d.mode_reglement, modes)
            : t('compta.initialAdvance'),
          montant: Number(d.avance_amount),
          type: 'depot',
        });
      }
    }
    for (const a of filteredAvances) {
      const depot = depotMap.get(a.depot_id);
      entries.push({
        date: a.date_paiement,
        numero: depot?.numero ?? '—',
        clientNom: depot?.client?.nom ?? t('compta.unknownClient'),
        modeLabel: a.mode_reglement
          ? getModeReglementLabel(a.mode_reglement, modes)
          : t('compta.extraAdvance'),
        montant: Number(a.montant),
        type: 'avance',
      });
    }
    entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const groupMap = new Map<string, DayEntry[]>();
    for (const e of entries) {
      const key = formatDateShort(e.date);
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(e);
    }
    const sortedKeys = Array.from(groupMap.keys()).sort((a, b) => b.localeCompare(a));
    return sortedKeys.map((key) => {
      const items = groupMap.get(key)!;
      const total = items.reduce((sum, e) => sum + e.montant, 0);
      return { label: key, items, total };
    });
  }, [filteredDepots, filteredAvances, depotMap, modes, t]);

  useEffect(() => {
    if (groups.length > 0 && expandedGroups.size === 0) {
      setExpandedGroups(new Set([groups[0].label]));
    }
  }, [groups, expandedGroups.size]);

  function toggleGroup(label: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function toggleAccount(code: string) {
    setExpandedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 4000);
  }

  async function handleSaveFiscalSettings() {
    if (!canWriteAccounting) return;
    const cleanTva = regimeFiscal === 'SMT' ? 0 : Math.max(0, Math.min(35, Number(tauxTva) || 0));
    setTauxTva(cleanTva);
    setSavingFiscal(true);
    try {
      const localFiscalKey = `syscohada_fiscal_${entreprise?.id ?? 'default'}`;
      try {
        localStorage.setItem(localFiscalKey, JSON.stringify({ regime: regimeFiscal, tva: cleanTva }));
      } catch {
        // Ignore
      }
      if (entreprise?.id) {
        await db.updateEntrepriseFiscalSettings(entreprise.id, regimeFiscal, cleanTva);
      }
      setShowFiscalConfig(false);
      showToast(
        lang === 'fr'
          ? `Régime fiscal mis à jour : ${regimeFiscal === 'NORMAL' ? `Système Normal (TVA ${cleanTva}%)` : 'SMT (0% TVA)'}`
          : `Tax regime updated: ${regimeFiscal === 'NORMAL' ? `Normal System (VAT ${cleanTva}%)` : 'SMT (0% VAT)'}`,
      );
    } finally {
      setSavingFiscal(false);
    }
  }

  async function handleDeleteManualEntry(recordId: string) {
    if (!canWriteAccounting) return;
    if (
      !confirm(
        lang === 'fr'
          ? 'Supprimer définitivement cette écriture comptable ?'
          : 'Permanently delete this manual journal entry?',
      )
    ) {
      return;
    }
    const err = await db.deleteEcritureComptable(recordId);
    if (err) {
      showToast(err);
      return;
    }
    await loadComptabilite();
    showToast(lang === 'fr' ? 'Écriture comptable supprimée.' : 'Journal entry deleted.');
  }

  async function handlePdfExport(statement: SyscohadaPdfStatement) {
    setExportingPdf(true);
    try {
      const { exportSyscohadaPdf } = await import('@/lib/syscohadaExport');
      await exportSyscohadaPdf({
        statement,
        ledger,
        entreprise: effectiveEntreprise,
        periodLabel,
        regimeLabel,
        filteredJournalEntries: statement === 'journal' ? filteredJournalEntries : undefined,
        journalFilterLabel:
          journalFilter === 'ALL'
            ? lang === 'fr'
              ? 'Journal Général (Tous les journaux)'
              : 'General Journal (All journals)'
            : `${journalFilter} - ${lang === 'fr' ? SYSCOHADA_JOURNAL_LABELS[journalFilter].fr : SYSCOHADA_JOURNAL_LABELS[journalFilter].en}`,
      });
    } finally {
      setExportingPdf(false);
    }
  }

  async function handleExcelExport() {
    const { exportSyscohadaExcel } = await import('@/lib/syscohadaExport');
    exportSyscohadaExcel({
      ledger,
      entreprise: effectiveEntreprise,
      periodLabel,
      regimeLabel,
    });
  }

  // Filtered views for tabs
  const filteredBalanceRows = useMemo(() => {
    const q = balanceSearch.trim().toLowerCase();
    return ledger.balance.rows.filter((r) => {
      if (balanceClassFilter !== 'all' && r.classe !== balanceClassFilter) return false;
      if (q && !r.compte.toLowerCase().includes(q) && !r.intitule.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [ledger.balance.rows, balanceClassFilter, balanceSearch]);

  const filteredGrandLivre = useMemo(() => {
    const q = glSearch.trim().toLowerCase();
    if (!q) return ledger.grandLivre;
    return ledger.grandLivre.filter(
      (a) =>
        a.compte.toLowerCase().includes(q) ||
        a.intitule.toLowerCase().includes(q) ||
        a.mouvements.some(
          (m) =>
            m.libelle.toLowerCase().includes(q) ||
            m.numeroPiece.toLowerCase().includes(q) ||
            (m.tiers ?? '').toLowerCase().includes(q),
        ),
    );
  }, [ledger.grandLivre, glSearch]);

  const filteredJournalEntries = useMemo(() => {
    const q = journalSearch.trim().toLowerCase();
    return ledger.entries.filter((e) => {
      if (journalFilter !== 'ALL' && e.journal !== journalFilter) return false;
      if (!q) return true;
      return (
        e.numeroPiece.toLowerCase().includes(q) ||
        e.libelle.toLowerCase().includes(q) ||
        e.lignes.some(
          (l) =>
            l.compte.toLowerCase().includes(q) ||
            l.intitule.toLowerCase().includes(q) ||
            (l.tiers ?? '').toLowerCase().includes(q),
        )
      );
    });
  }, [ledger.entries, journalFilter, journalSearch]);

  const filteredPlanAccounts = useMemo(() => {
    const q = planSearch.trim().toLowerCase();
    return SYSCOHADA_PLAN_COMPTABLE.filter((a) => {
      if (planClassFilter !== 'all' && a.classe !== planClassFilter) return false;
      if (!q) return true;
      return (
        a.code.toLowerCase().includes(q) ||
        a.intitule.toLowerCase().includes(q) ||
        a.intituleEn.toLowerCase().includes(q)
      );
    });
  }, [planClassFilter, planSearch]);

  const journalTotals = useMemo(() => {
    const td = filteredJournalEntries.reduce((s, e) => s + e.totalDebit, 0);
    const tc = filteredJournalEntries.reduce((s, e) => s + e.totalCredit, 0);
    return { totalDebit: td, totalCredit: tc };
  }, [filteredJournalEntries]);

  // Dynamic PrintableReport data matching active tab (always includes company logo via PrintableReport!)
  const reportData: ReportData = useMemo(() => {
    if (activeTab === 'resultat') {
      return {
        title: lang === 'fr' ? 'Compte de Résultat SYSCOHADA' : 'SYSCOHADA Income Statement',
        subtitle: regimeLabel,
        periodLabel,
        entreprise,
        columns: [
          { key: 'ref', label: 'Réf', align: 'left', width: '10%', render: (r) => String(r.ref ?? '') },
          { key: 'label', label: lang === 'fr' ? 'Rubriques (SIG)' : 'Line item', align: 'left', render: (r) => String(r.label ?? '') },
          { key: 'comptes', label: lang === 'fr' ? 'Comptes' : 'Accounts', align: 'left', width: '18%', render: (r) => String(r.comptes ?? '') },
          { key: 'montant', label: 'Montant (FCFA)', align: 'right', width: '22%', render: (r) => formatPrice(Number(r.montant ?? 0)) },
        ],
        rows: ledger.compteResultat.lines.map((l) => ({
          ref: l.ref,
          label: lang === 'fr' ? l.label : l.labelEn,
          comptes: l.comptes,
          montant: l.montant,
        })),
        summaryRows: [
          { label: 'Chiffre d’affaires net (XB)', value: formatPrice(ledger.compteResultat.chiffreAffairesNet) },
          { label: 'Valeur Ajoutée (XC)', value: formatPrice(ledger.compteResultat.valeurAjoutee) },
          { label: 'EBE (XD)', value: formatPrice(ledger.compteResultat.ebe) },
          { label: 'Résultat Net (XI)', value: formatPrice(ledger.compteResultat.resultatNet), highlight: true },
        ],
      };
    }

    if (activeTab === 'balance') {
      return {
        title: lang === 'fr' ? 'Balance Générale des Comptes (SYSCOHADA)' : 'SYSCOHADA General Trial Balance',
        subtitle: regimeLabel,
        periodLabel,
        entreprise,
        columns: [
          { key: 'compte', label: 'Compte', align: 'left', width: '10%', render: (r) => String(r.compte ?? '') },
          { key: 'intitule', label: 'Intitulé', align: 'left', render: (r) => String(r.intitule ?? '') },
          { key: 'md', label: 'Mvt Débit', align: 'right', width: '14%', render: (r) => (Number(r.md) ? formatPrice(Number(r.md)) : '—') },
          { key: 'mc', label: 'Mvt Crédit', align: 'right', width: '14%', render: (r) => (Number(r.mc) ? formatPrice(Number(r.mc)) : '—') },
          { key: 'sd', label: 'Solde Déb.', align: 'right', width: '14%', render: (r) => (Number(r.sd) ? formatPrice(Number(r.sd)) : '—') },
          { key: 'sc', label: 'Solde Créd.', align: 'right', width: '14%', render: (r) => (Number(r.sc) ? formatPrice(Number(r.sc)) : '—') },
        ],
        rows: filteredBalanceRows.map((r) => ({
          compte: r.compte,
          intitule: r.intitule,
          md: r.mouvementDebit,
          mc: r.mouvementCredit,
          sd: r.soldeDebiteur,
          sc: r.soldeCrediteur,
        })),
        summaryRows: [
          { label: 'Total Mouvements Débit / Crédit', value: `${formatPrice(ledger.balance.totalMouvementDebit)} / ${formatPrice(ledger.balance.totalMouvementCredit)}` },
          { label: 'Total Soldes Débiteurs / Créditeurs', value: `${formatPrice(ledger.balance.totalSoldeDebiteur)} / ${formatPrice(ledger.balance.totalSoldeCrediteur)}`, highlight: true },
        ],
      };
    }

    if (activeTab === 'journal') {
      return {
        title: lang === 'fr' ? 'Journal Comptable SYSCOHADA' : 'SYSCOHADA Accounting Journal',
        subtitle: journalFilter === 'ALL' ? 'Journal Général' : `${journalFilter} — ${SYSCOHADA_JOURNAL_LABELS[journalFilter].fr}`,
        periodLabel,
        entreprise,
        columns: [
          { key: 'date', label: 'Date', align: 'left', width: '11%', render: (r) => formatDateShort(String(r.date ?? '')) },
          { key: 'jrn', label: 'Jrn', align: 'center', width: '6%', render: (r) => String(r.jrn ?? '') },
          { key: 'piece', label: 'Pièce', align: 'left', width: '13%', render: (r) => String(r.piece ?? '') },
          { key: 'compte', label: 'Compte', align: 'left', width: '9%', render: (r) => String(r.compte ?? '') },
          { key: 'libelle', label: 'Libellé', align: 'left', render: (r) => String(r.libelle ?? '') },
          { key: 'debit', label: 'Débit', align: 'right', width: '13%', render: (r) => (Number(r.debit) ? formatPrice(Number(r.debit)) : '') },
          { key: 'credit', label: 'Crédit', align: 'right', width: '13%', render: (r) => (Number(r.credit) ? formatPrice(Number(r.credit)) : '') },
        ],
        rows: filteredJournalEntries.flatMap((e) =>
          e.lignes.map((l) => ({
            date: e.date,
            jrn: e.journal,
            piece: e.numeroPiece,
            compte: l.compte,
            libelle: `${l.intitule} — ${l.libelle}`,
            debit: l.debit,
            credit: l.credit,
          })),
        ),
        summaryRows: [
          { label: 'Total Débit', value: formatPrice(journalTotals.totalDebit) },
          { label: 'Total Crédit', value: formatPrice(journalTotals.totalCredit), highlight: true },
        ],
      };
    }

    // Default: Synthèse & Encaissements
    return {
      title: lang === 'fr' ? 'Synthèse Comptable SYSCOHADA' : 'SYSCOHADA Accounting Summary',
      subtitle: regimeLabel,
      periodLabel,
      entreprise,
      columns: [
        { key: 'date', label: 'Date', align: 'left', render: (r) => formatDateShort(r.date as string) ?? '—' },
        { key: 'numero', label: lang === 'fr' ? 'N° Dépôt' : 'Deposit No.', align: 'left', render: (r) => String(r.numero ?? '—') },
        { key: 'client', label: 'Client', align: 'left', render: (r) => String(r.client ?? '') },
        { key: 'mode', label: 'Mode', align: 'left', render: (r) => String(r.mode ?? '') },
        { key: 'type', label: 'Type', align: 'center', render: (r) => String(r.type === 'depot' ? 'Dépôt' : 'Avance') },
        { key: 'montant', label: 'Montant', align: 'right', render: (r) => formatPrice(Number(r.montant ?? 0)) },
      ],
      rows: groups.flatMap((g) =>
        g.items.map((e) => ({
          date: e.date,
          numero: e.numero,
          client: e.clientNom,
          mode: e.modeLabel,
          type: e.type,
          montant: e.montant,
        })),
      ),
      summaryRows: [
        { label: "Chiffre d'affaires net (70)", value: formatPrice(ledger.compteResultat.chiffreAffairesNet) },
        { label: 'Recettes encaissées (SMT)', value: formatPrice(ledger.etatSmt.recettesEncaissees) },
        { label: 'Créances clients (4111)', value: formatPrice(ledger.etatSmt.creancesClients4111) },
        { label: 'Dépenses décaissées (SMT)', value: formatPrice(ledger.etatSmt.depensesDecaissees) },
        { label: 'Solde net de trésorerie (SMT)', value: formatPrice(ledger.etatSmt.soldeNetTresorerie) },
        { label: "Résultat net de l'exercice (XI)", value: formatPrice(ledger.compteResultat.resultatNet), highlight: true },
      ],
    };
  }, [
    activeTab,
    lang,
    regimeLabel,
    periodLabel,
    entreprise,
    ledger,
    filteredBalanceRows,
    filteredJournalEntries,
    journalFilter,
    journalTotals,
    groups,
  ]);

  const filterButtons: { id: PeriodFilter; label: string }[] = isCommercialOnly
    ? [{ id: 'today', label: t('compta.today') }]
    : [
        { id: 'today', label: t('compta.today') },
        { id: 'week', label: t('compta.thisWeek') },
        { id: 'month', label: t('compta.thisMonth') },
        { id: 'quarter', label: t('compta.thisQuarter') },
        { id: 'year', label: t('compta.thisYear') },
        { id: 'all', label: t('compta.all') },
        { id: 'custom', label: t('compta.custom') },
      ];

  const tabs: { id: ComptaTab; label: string; icon: typeof Calculator }[] = [
    { id: 'synthese', label: t('compta.tabSynthese'), icon: Calculator },
    { id: 'resultat', label: t('compta.tabResultat'), icon: TrendingUp },
    { id: 'balance', label: t('compta.tabBalance'), icon: Scale },
    { id: 'grand_livre', label: t('compta.tabGrandLivre'), icon: BookOpen },
    { id: 'journal', label: t('compta.tabJournal'), icon: ListChecks },
    { id: 'plan', label: t('compta.tabPlan'), icon: Layers },
  ];

  const maxModeMontant = parMode.length > 0 ? Math.max(...parMode.map((m) => m.montant)) : 0;

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Top Bar Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">{t('compta.title')}</h2>
            {!isCommercialOnly && (
              <span className="text-xs font-mono font-medium text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">
                {regimeFiscal === 'NORMAL' ? `SYSCOHADA · TVA ${activeTvaRate}%` : 'SYSCOHADA · SMT'}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-0.5">{t('compta.subtitle')}</p>
        </div>

        {!isCommercialOnly && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {canWriteAccounting && (
              <button
                type="button"
                onClick={() => setShowFiscalConfig((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
              >
                <Settings2 className="w-3.5 h-3.5" />
                {lang === 'fr' ? 'Régime / TVA' : 'Tax / VAT'}
              </button>
            )}
            <button
              type="button"
              onClick={handleExcelExport}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              Excel SYSCOHADA
            </button>
            <button
              type="button"
              onClick={() => printReport()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" />
              {lang === 'fr' ? 'Imprimer' : 'Print'}
            </button>
          </div>
        )}
      </div>

      {/* Toast message */}
      {toast && (
        <div className="flex items-center justify-between px-4 py-2.5 rounded-lg border border-emerald-200 bg-emerald-50 text-xs font-medium text-emerald-800">
          <span>{toast}</span>
          <button type="button" onClick={() => setToast(null)} className="text-emerald-700 hover:underline">
            OK
          </button>
        </div>
      )}

      {/* Fiscal Regime & VAT Settings Panel */}
      {!isCommercialOnly && showFiscalConfig && canWriteAccounting && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {lang === 'fr' ? 'Système comptable SYSCOHADA' : 'SYSCOHADA System'}
              </label>
              <select
                value={regimeFiscal}
                onChange={(e) => {
                  const next = e.target.value as 'SMT' | 'NORMAL';
                  setRegimeFiscal(next);
                  if (next === 'NORMAL' && tauxTva === 0) setTauxTva(18);
                  if (next === 'SMT') setTauxTva(0);
                }}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                <option value="SMT">
                  {lang === 'fr'
                    ? 'SMT — Système Minimal de Trésorerie (Forfait / Non assujetti TVA)'
                    : 'SMT — Cash Basis System (No VAT)'}
                </option>
                <option value="NORMAL">
                  {lang === 'fr'
                    ? 'Système Normal — Assujetti à la TVA (4432 / 4452)'
                    : 'Normal System — VAT Registered (4432 / 4452)'}
                </option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {lang === 'fr' ? 'Taux de TVA applicable (%)' : 'Applicable VAT rate (%)'}
              </label>
              <input
                type="number"
                min={0}
                max={35}
                step="0.5"
                disabled={regimeFiscal === 'SMT'}
                value={regimeFiscal === 'SMT' ? 0 : tauxTva}
                onChange={(e) => setTauxTva(parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono tabular-nums disabled:bg-slate-50 disabled:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowFiscalConfig(false)}
              className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              disabled={savingFiscal}
              onClick={handleSaveFiscalSettings}
              className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-50"
            >
              {savingFiscal ? '...' : t('common.save')}
            </button>
          </div>
        </div>
      )}

      {/* Period Filters + Main SYSCOHADA Tabs */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {filterButtons.map((btn) => (
              <button
                key={btn.id}
                type="button"
                onClick={() => setPeriod(btn.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  period === btn.id
                    ? 'bg-slate-900 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>

          {!isCommercialOnly && (
            <div className="flex items-center gap-2 text-xs text-slate-500 tabular-nums">
              {ledger.balance.isBalanced ? (
                <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {lang === 'fr' ? 'Balance équilibrée (D = C)' : 'Balanced ledger (D = C)'}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-red-600 font-medium">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {lang === 'fr' ? 'Écart détecté' : 'Imbalance detected'}
                </span>
              )}
              <span>·</span>
              <span>
                {ledger.entries.length} {lang === 'fr' ? 'écriture(s)' : 'entry(ies)'}
              </span>
            </div>
          )}
        </div>

        {/* Custom date range */}
        {period === 'custom' && (
          <div className="flex flex-wrap gap-3 items-center bg-white rounded-xl border border-slate-200 p-3.5">
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500 font-medium">{t('compta.from')}</label>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500 font-medium">{t('compta.to')}</label>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
          </div>
        )}

        {/* SYSCOHADA Segmented Navigation Tabs (hidden for commercial-only role) */}
        {!isCommercialOnly && (
          <div className="flex overflow-x-auto gap-1 border-b border-slate-200">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 -mb-px ${
                    isActive
                      ? 'border-slate-900 text-slate-900'
                      : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-400">
          {t('compta.loading')}
        </div>
      ) : (
        <>
          {/* ═══════════════ TAB 1: SYNTHÈSE & SMT ═══════════════ */}
          {(activeTab === 'synthese' || isCommercialOnly) && (
            <div className="space-y-5">
              {/* Primary KPI Strip */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-slate-500">
                      {lang === 'fr' ? "CA Net Facturé (70)" : 'Net Billed Revenue (70)'}
                    </span>
                    <TrendingUp className="w-4 h-4 text-slate-400" />
                  </div>
                  <p className="text-lg font-bold text-slate-900 font-mono tabular-nums">
                    {formatPrice(ledger.compteResultat.chiffreAffairesNet)}
                  </p>
                  <p className="text-xs text-slate-400 mt-1 tabular-nums">
                    {t('compta.depositCount', { count: filteredDepots.length })}
                    {activeTvaRate > 0 ? ` · HT` : ''}
                  </p>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-slate-500">
                      {lang === 'fr' ? 'Recettes Encaissées (Cl. 5)' : 'Cash Collected (Cl. 5)'}
                    </span>
                    <ArrowDownCircle className="w-4 h-4 text-emerald-600" />
                  </div>
                  <p className="text-lg font-bold text-emerald-700 font-mono tabular-nums">
                    {formatPrice(totalEncaisse)}
                  </p>
                  <p className="text-xs text-slate-400 mt-1 tabular-nums">
                    {depotsRegles.length}/{filteredDepots.length}{' '}
                    {lang === 'fr' ? 'soldés' : 'settled'}
                  </p>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-slate-500">
                      {lang === 'fr' ? 'Charges & Dépenses (Cl. 6)' : 'Operating Expenses (Cl. 6)'}
                    </span>
                    <TrendingDown className="w-4 h-4 text-rose-600" />
                  </div>
                  <p className="text-lg font-bold text-rose-600 font-mono tabular-nums">
                    {formatPrice(
                      ledger.compteResultat.consommationsIntermediaires +
                        ledger.compteResultat.chargesPersonnel +
                        ledger.compteResultat.impotsTaxes +
                        ledger.compteResultat.autresCharges +
                        ledger.compteResultat.dotationsAmortissements,
                    )}
                  </p>
                  <p className="text-xs text-slate-400 mt-1 tabular-nums">
                    {t('compta.expenseCount', { count: filteredDepenses.length })}
                    {ledger.unloggedCommissionsCount > 0
                      ? ` + ${ledger.unloggedCommissionsCount} comm.`
                      : ''}
                  </p>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-slate-500">
                      {lang === 'fr' ? "Résultat Net SYSCOHADA (XI)" : 'SYSCOHADA Net Income (XI)'}
                    </span>
                    <Scale
                      className={`w-4 h-4 ${
                        ledger.compteResultat.resultatNet >= 0 ? 'text-emerald-600' : 'text-red-600'
                      }`}
                    />
                  </div>
                  <p
                    className={`text-lg font-bold font-mono tabular-nums ${
                      ledger.compteResultat.resultatNet >= 0 ? 'text-emerald-700' : 'text-red-600'
                    }`}
                  >
                    {formatPrice(ledger.compteResultat.resultatNet)}
                  </p>
                  <p className="text-xs text-slate-400 mt-1 tabular-nums">
                    {lang === 'fr' ? 'Solde trésorerie SMT :' : 'SMT cash balance:'}{' '}
                    <span className="font-mono text-slate-600">
                      {formatPrice(ledger.etatSmt.soldeNetTresorerie)}
                    </span>
                  </p>
                </div>
              </div>

              {/* SYSCOHADA Treasury Accounts (Classe 5) & Receivables (4111) + VAT (if applicable) */}
              {!isCommercialOnly && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center gap-2 text-xs text-slate-500 font-medium mb-1">
                      <Banknote className="w-3.5 h-3.5 text-slate-400" />
                      <span className="font-mono text-slate-700">5711</span>
                      <span>{lang === 'fr' ? 'Caisse Espèces' : 'Cash'}</span>
                    </div>
                    <p
                      className={`text-base font-bold font-mono tabular-nums ${
                        ledger.etatSmt.soldeCaisse5711 >= 0 ? 'text-slate-900' : 'text-red-600'
                      }`}
                    >
                      {formatPrice(ledger.etatSmt.soldeCaisse5711)}
                    </p>
                  </div>

                  <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center gap-2 text-xs text-slate-500 font-medium mb-1">
                      <Smartphone className="w-3.5 h-3.5 text-slate-400" />
                      <span className="font-mono text-slate-700">5212</span>
                      <span>Mobile Money</span>
                    </div>
                    <p
                      className={`text-base font-bold font-mono tabular-nums ${
                        ledger.etatSmt.soldeMobileMoney5212 >= 0 ? 'text-slate-900' : 'text-red-600'
                      }`}
                    >
                      {formatPrice(ledger.etatSmt.soldeMobileMoney5212)}
                    </p>
                  </div>

                  <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center gap-2 text-xs text-slate-500 font-medium mb-1">
                      <Landmark className="w-3.5 h-3.5 text-slate-400" />
                      <span className="font-mono text-slate-700">5211</span>
                      <span>{lang === 'fr' ? 'Banques Locales' : 'Local Banks'}</span>
                    </div>
                    <p
                      className={`text-base font-bold font-mono tabular-nums ${
                        ledger.etatSmt.soldeBanque5211 >= 0 ? 'text-slate-900' : 'text-red-600'
                      }`}
                    >
                      {formatPrice(ledger.etatSmt.soldeBanque5211)}
                    </p>
                  </div>

                  <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center gap-2 text-xs text-slate-500 font-medium mb-1">
                      <ArrowUpCircle className="w-3.5 h-3.5 text-amber-600" />
                      <span className="font-mono text-slate-700">4111</span>
                      <span>{lang === 'fr' ? 'Créances Clients' : 'Receivables'}</span>
                    </div>
                    <p className="text-base font-bold font-mono tabular-nums text-amber-700">
                      {formatPrice(resteEncaisser)}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {t('compta.notSettled', { count: depotsEnCours })}
                    </p>
                  </div>
                </div>
              )}

              {/* VAT summary strip when Système Normal with TVA > 0 */}
              {!isCommercialOnly && activeTvaRate > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 p-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                  <div className="flex items-center justify-between sm:block">
                    <span className="text-slate-500">
                      <span className="font-mono text-slate-700">4432</span> · TVA collectée ({activeTvaRate}%)
                    </span>
                    <p className="font-mono font-semibold text-sm text-slate-900 tabular-nums sm:mt-0.5">
                      {formatPrice(ledger.etatSmt.tvaCollectee4432)}
                    </p>
                  </div>
                  <div className="flex items-center justify-between sm:block">
                    <span className="text-slate-500">
                      <span className="font-mono text-slate-700">4452</span> · TVA récupérable sur charges
                    </span>
                    <p className="font-mono font-semibold text-sm text-slate-900 tabular-nums sm:mt-0.5">
                      {formatPrice(ledger.etatSmt.tvaDeductible4452)}
                    </p>
                  </div>
                  <div className="flex items-center justify-between sm:block">
                    <span className="text-slate-500">
                      <span className="font-mono text-slate-700">4441</span> ·{' '}
                      {ledger.etatSmt.tvaNetteAPayer >= 0 ? 'TVA nette à reverser' : 'Crédit de TVA'}
                    </span>
                    <p className="font-mono font-bold text-sm text-slate-900 tabular-nums sm:mt-0.5">
                      {formatPrice(Math.abs(ledger.etatSmt.tvaNetteAPayer))}
                    </p>
                  </div>
                </div>
              )}

              {/* Recovery rate + Payment mode distribution */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {caTheorique > 0 && (
                  <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-semibold text-slate-900">{t('compta.recoveryRate')}</p>
                        <p className="text-sm font-bold font-mono tabular-nums text-slate-900">
                          {Math.round((totalEncaisse / caTheorique) * 100)}%
                        </p>
                      </div>
                      <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-slate-900 transition-all duration-500"
                          style={{ width: `${Math.min(100, (totalEncaisse / caTheorique) * 100)}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between mt-2 text-xs text-slate-500 font-mono tabular-nums">
                        <span>
                          {formatPrice(totalEncaisse)} {t('compta.encaisse')}
                        </span>
                        <span>
                          {formatPrice(caTheorique)} {t('compta.total')}
                        </span>
                      </div>
                    </div>

                    {!isCommercialOnly && (
                      <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <span className="text-slate-400">VA (XC)</span>
                          <p className="font-mono font-semibold text-slate-900 tabular-nums mt-0.5">
                            {formatPrice(ledger.compteResultat.valeurAjoutee)}
                          </p>
                        </div>
                        <div>
                          <span className="text-slate-400">EBE (XD)</span>
                          <p className="font-mono font-semibold text-slate-900 tabular-nums mt-0.5">
                            {formatPrice(ledger.compteResultat.ebe)}
                          </p>
                        </div>
                        <div>
                          <span className="text-slate-400">RE (XE)</span>
                          <p className="font-mono font-semibold text-slate-900 tabular-nums mt-0.5">
                            {formatPrice(ledger.compteResultat.resultatExploitation)}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {parMode.length > 0 && (
                  <div className="bg-white rounded-xl border border-slate-200 p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <PieChart className="w-4 h-4 text-slate-500" />
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{t('compta.byPaymentMode')}</p>
                        <p className="text-xs text-slate-400">{t('compta.distribution')}</p>
                      </div>
                    </div>
                    <div className="space-y-3">
                      {parMode.map((m) => (
                        <div key={m.label}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <CreditCard className="w-3.5 h-3.5 text-slate-400" />
                              <span className="text-xs font-medium text-slate-700">{m.label}</span>
                            </div>
                            <div className="flex items-center gap-2 font-mono tabular-nums">
                              <span className="text-xs font-semibold text-slate-900">
                                {formatPrice(m.montant)}
                              </span>
                              <span className="text-[11px] text-slate-400 w-9 text-right">
                                {Math.round(m.pct)}%
                              </span>
                            </div>
                          </div>
                          <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-slate-700 transition-all duration-500"
                              style={{
                                width: `${maxModeMontant > 0 ? (m.montant / maxModeMontant) * 100 : 0}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Outstanding Receivables (4111) Aging Preview */}
              {!isCommercialOnly && ledger.creancesClients.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">
                        {lang === 'fr'
                          ? 'Suivi des Créances Clients — Compte 4111'
                          : 'Customer Receivables Aging — Account 4111'}
                      </h3>
                      <p className="text-xs text-slate-400">
                        {ledger.creancesClients.length}{' '}
                        {lang === 'fr' ? 'facture(s) non soldée(s) sur la période' : 'unsettled invoice(s) in period'}
                      </p>
                    </div>
                    <span className="text-sm font-bold font-mono tabular-nums text-amber-700">
                      {formatPrice(ledger.creancesClients.reduce((s, c) => s + c.reste, 0))}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold">
                          <th className="text-left px-4 py-2.5">N° Dépôt</th>
                          <th className="text-left px-4 py-2.5">Date</th>
                          <th className="text-left px-4 py-2.5">Client</th>
                          <th className="text-right px-4 py-2.5">Total</th>
                          <th className="text-right px-4 py-2.5">Encaissé</th>
                          <th className="text-right px-4 py-2.5">Reste dû (4111)</th>
                          <th className="text-right px-4 py-2.5">Ancienneté</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {ledger.creancesClients.slice(0, 12).map((c) => (
                          <tr key={c.depotId} className="hover:bg-slate-50/70">
                            <td className="px-4 py-2.5 font-mono font-medium text-slate-900">{c.numero}</td>
                            <td className="px-4 py-2.5 text-slate-500 font-mono tabular-nums">
                              {formatDateShort(c.dateDepot)}
                            </td>
                            <td className="px-4 py-2.5 text-slate-800">{c.clientNom}</td>
                            <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-600">
                              {formatPrice(c.total)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono tabular-nums text-emerald-700">
                              {formatPrice(c.paye)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono tabular-nums font-semibold text-amber-700">
                              {formatPrice(c.reste)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-500">
                              {c.joursAnciennete} j
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Daily collections detail */}
              {groups.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-200 text-center py-12">
                  <Filter className="w-8 h-8 text-slate-300 mx-auto mb-2.5" />
                  <p className="text-sm text-slate-400">
                    {t('compta.noData', { period: periodLabel.toLowerCase() })}
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-2">
                      <Wallet className="w-4 h-4 text-slate-400" />
                      <h3 className="text-sm font-semibold text-slate-800">
                        {t('compta.encaissementsDetail')}
                      </h3>
                    </div>
                    {isCommercialOnly && (
                      <button
                        type="button"
                        onClick={() => printReport()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200 transition-colors"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        {lang === 'fr' ? 'Imprimer' : 'Print'}
                      </button>
                    )}
                  </div>
                  {groups.map((group) => {
                    const isExpanded = expandedGroups.has(group.label);
                    return (
                      <div
                        key={group.label}
                        className="bg-white rounded-xl border border-slate-200 overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() => toggleGroup(group.label)}
                          className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-slate-50 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <CalendarDays className="w-4 h-4 text-slate-400 shrink-0" />
                            <div className="text-left">
                              <p className="text-sm font-semibold text-slate-900">{group.label}</p>
                              <p className="text-xs text-slate-400">
                                {t('compta.encaissementCount', { count: group.items.length })}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <p className="text-sm font-semibold font-mono tabular-nums text-emerald-700 whitespace-nowrap">
                              {formatPrice(group.total)}
                            </p>
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-slate-400" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-slate-400" />
                            )}
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="divide-y divide-slate-100 border-t border-slate-100">
                            {group.items.map((entry, idx) => (
                              <div
                                key={`${entry.numero}-${idx}`}
                                className="px-4 py-2.5 flex items-center justify-between hover:bg-slate-50/50 text-xs"
                              >
                                <div className="min-w-0">
                                  <p className="font-medium text-slate-900 truncate">
                                    <span className="font-mono text-slate-600">{entry.numero}</span> —{' '}
                                    {entry.clientNom}
                                  </p>
                                  <p className="text-slate-400 mt-0.5">{entry.modeLabel}</p>
                                </div>
                                <span className="font-semibold font-mono tabular-nums text-emerald-700 whitespace-nowrap ml-3">
                                  {formatPrice(entry.montant)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ═══════════════ TAB 2: COMPTE DE RÉSULTAT SYSCOHADA (SIG) ═══════════════ */}
          {!isCommercialOnly && activeTab === 'resultat' && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    {lang === 'fr'
                      ? 'Compte de Résultat — Soldes Intermédiaires de Gestion (SYSCOHADA Révisé)'
                      : 'Income Statement — Intermediate Management Balances (SYSCOHADA)'}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {periodLabel} · {regimeLabel}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={exportingPdf}
                  onClick={() => handlePdfExport('compte_resultat')}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  <FileText className="w-3.5 h-3.5 text-rose-600" />
                  {exportingPdf ? '...' : lang === 'fr' ? 'Exporter PDF' : 'Export PDF'}
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      <th className="text-left px-4 py-3 w-16">Réf</th>
                      <th className="text-left px-4 py-3">
                        {lang === 'fr' ? 'Libellés / Rubriques' : 'Line Items'}
                      </th>
                      <th className="text-left px-4 py-3 w-36">
                        {lang === 'fr' ? 'Comptes' : 'Accounts'}
                      </th>
                      <th className="text-right px-4 py-3 w-40">
                        {lang === 'fr' ? 'Montant (FCFA)' : 'Amount (FCFA)'}
                      </th>
                      <th className="text-right px-4 py-3 w-20">% CA</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ledger.compteResultat.lines.map((line) => {
                      const caRef = ledger.compteResultat.chiffreAffairesNet;
                      const pct =
                        caRef > 0 ? `${Math.round((Math.abs(line.montant) / caRef) * 100)}%` : '—';
                      return (
                        <tr
                          key={line.ref}
                          className={
                            line.isMajor
                              ? 'bg-slate-900 text-white font-bold'
                              : line.isSubtotal
                              ? 'bg-slate-50 font-semibold text-slate-900'
                              : 'hover:bg-slate-50/60 text-slate-700'
                          }
                        >
                          <td
                            className={`px-4 py-2.5 font-mono text-xs ${
                              line.isMajor ? 'text-slate-300' : 'text-slate-500'
                            }`}
                          >
                            {line.ref}
                          </td>
                          <td className="px-4 py-2.5 text-xs sm:text-sm">
                            {lang === 'fr' ? line.label : line.labelEn}
                          </td>
                          <td
                            className={`px-4 py-2.5 font-mono text-xs ${
                              line.isMajor ? 'text-slate-300' : 'text-slate-400'
                            }`}
                          >
                            {line.comptes}
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right font-mono tabular-nums text-xs sm:text-sm ${
                              line.isMajor
                                ? line.montant >= 0
                                  ? 'text-emerald-300'
                                  : 'text-rose-300'
                                : line.montant < 0
                                ? 'text-rose-600'
                                : 'text-slate-900'
                            }`}
                          >
                            {formatPrice(line.montant)}
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right font-mono tabular-nums text-xs ${
                              line.isMajor ? 'text-slate-300' : 'text-slate-400'
                            }`}
                          >
                            {pct}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ═══════════════ TAB 3: BALANCE GÉNÉRALE (6 COLONNES) ═══════════════ */}
          {!isCommercialOnly && activeTab === 'balance' && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    {lang === 'fr'
                      ? 'Balance Générale des Comptes à 6 colonnes'
                      : '6-Column General Trial Balance'}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {filteredBalanceRows.length} {lang === 'fr' ? 'compte(s) mouvementé(s)' : 'active account(s)'} · {periodLabel}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={balanceSearch}
                      onChange={(e) => setBalanceSearch(e.target.value)}
                      placeholder={lang === 'fr' ? 'Filtrer compte...' : 'Filter account...'}
                      className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs w-44 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>
                  <select
                    value={balanceClassFilter}
                    onChange={(e) =>
                      setBalanceClassFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))
                    }
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
                  >
                    <option value="all">{lang === 'fr' ? 'Toutes classes (1–8)' : 'All classes (1–8)'}</option>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((cl) => (
                      <option key={cl} value={cl}>
                        {lang === 'fr' ? `Classe ${cl}` : `Class ${cl}`}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={exportingPdf}
                    onClick={() => handlePdfExport('balance')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    <FileText className="w-3.5 h-3.5 text-rose-600" />
                    PDF
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wide">
                      <th className="text-left px-4 py-3 w-20">Compte</th>
                      <th className="text-left px-4 py-3">Intitulé</th>
                      <th className="text-right px-4 py-3 w-32">Mvt Débit</th>
                      <th className="text-right px-4 py-3 w-32">Mvt Crédit</th>
                      <th className="text-right px-4 py-3 w-32">Solde Débiteur</th>
                      <th className="text-right px-4 py-3 w-32">Solde Créditeur</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredBalanceRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                          {lang === 'fr'
                            ? 'Aucun mouvement comptable sur cette période.'
                            : 'No accounting movements for this period.'}
                        </td>
                      </tr>
                    ) : (
                      filteredBalanceRows.map((row) => (
                        <tr key={row.compte} className="hover:bg-slate-50/70">
                          <td className="px-4 py-2.5 font-mono font-semibold text-slate-900">
                            {row.compte}
                          </td>
                          <td className="px-4 py-2.5 text-slate-700">{row.intitule}</td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-700">
                            {row.mouvementDebit > 0 ? formatPrice(row.mouvementDebit) : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-700">
                            {row.mouvementCredit > 0 ? formatPrice(row.mouvementCredit) : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums font-medium text-slate-900">
                            {row.soldeDebiteur > 0 ? formatPrice(row.soldeDebiteur) : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums font-medium text-slate-900">
                            {row.soldeCrediteur > 0 ? formatPrice(row.soldeCrediteur) : '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {filteredBalanceRows.length > 0 && (
                    <tfoot>
                      <tr className="bg-slate-900 text-white font-semibold">
                        <td colSpan={2} className="px-4 py-3 text-xs uppercase tracking-wide">
                          {balanceClassFilter === 'all' && !balanceSearch
                            ? lang === 'fr'
                              ? 'Totaux Généraux (Contrôle Débit = Crédit)'
                              : 'Grand Totals (Debit = Credit Check)'
                            : lang === 'fr'
                            ? 'Sous-total filtré'
                            : 'Filtered Subtotal'}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">
                          {formatPrice(filteredBalanceRows.reduce((s, r) => s + r.mouvementDebit, 0))}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">
                          {formatPrice(filteredBalanceRows.reduce((s, r) => s + r.mouvementCredit, 0))}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">
                          {formatPrice(filteredBalanceRows.reduce((s, r) => s + r.soldeDebiteur, 0))}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">
                          {formatPrice(filteredBalanceRows.reduce((s, r) => s + r.soldeCrediteur, 0))}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}

          {/* ═══════════════ TAB 4: GRAND LIVRE GÉNÉRAL ═══════════════ */}
          {!isCommercialOnly && activeTab === 'grand_livre' && (
            <div className="space-y-3">
              <div className="bg-white rounded-xl border border-slate-200 px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    {lang === 'fr' ? 'Grand Livre Général' : 'General Ledger'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {filteredGrandLivre.length} {lang === 'fr' ? 'compte(s) ouvert(s)' : 'active account(s)'} · {periodLabel}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={glSearch}
                      onChange={(e) => setGlSearch(e.target.value)}
                      placeholder={lang === 'fr' ? 'Compte, pièce, tiers...' : 'Account, ref, party...'}
                      className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs w-52 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={exportingPdf}
                    onClick={() => handlePdfExport('grand_livre')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    <FileText className="w-3.5 h-3.5 text-rose-600" />
                    PDF
                  </button>
                </div>
              </div>

              {filteredGrandLivre.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-200 py-10 text-center text-sm text-slate-400">
                  {lang === 'fr' ? 'Aucun compte trouvé.' : 'No accounts found.'}
                </div>
              ) : (
                filteredGrandLivre.map((acc) => {
                  const isOpen = expandedAccounts.has(acc.compte);
                  return (
                    <div
                      key={acc.compte}
                      className="bg-white rounded-xl border border-slate-200 overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => toggleAccount(acc.compte)}
                        className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0 text-left">
                          {isOpen ? (
                            <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                          )}
                          <span className="font-mono text-xs font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded shrink-0">
                            {acc.compte}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900 truncate">{acc.intitule}</p>
                            <p className="text-[11px] text-slate-400">
                              {acc.mouvements.length}{' '}
                              {lang === 'fr' ? 'mouvement(s)' : 'movement(s)'} · D:{' '}
                              <span className="font-mono">{formatPrice(acc.totalDebit)}</span> · C:{' '}
                              <span className="font-mono">{formatPrice(acc.totalCredit)}</span>
                            </p>
                          </div>
                        </div>

                        <div className="text-right shrink-0 font-mono tabular-nums">
                          {acc.soldeDebiteur > 0 ? (
                            <p className="text-xs font-bold text-slate-900">
                              SD {formatPrice(acc.soldeDebiteur)}
                            </p>
                          ) : acc.soldeCrediteur > 0 ? (
                            <p className="text-xs font-bold text-emerald-700">
                              SC {formatPrice(acc.soldeCrediteur)}
                            </p>
                          ) : (
                            <p className="text-xs font-medium text-slate-400">Soldé (0)</p>
                          )}
                        </div>
                      </button>

                      {isOpen && (
                        <div className="border-t border-slate-200 overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold">
                                <th className="text-left px-4 py-2 w-24">Date</th>
                                <th className="text-center px-2 py-2 w-12">Jrn</th>
                                <th className="text-left px-3 py-2 w-28">N° Pièce</th>
                                <th className="text-left px-3 py-2">Libellé / Tiers</th>
                                <th className="text-right px-3 py-2 w-28">Débit</th>
                                <th className="text-right px-3 py-2 w-28">Crédit</th>
                                <th className="text-right px-4 py-2 w-32">Solde (D−C)</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {acc.mouvements.map((m, i) => (
                                <tr key={`${m.entryId}_${i}`} className="hover:bg-slate-50/60">
                                  <td className="px-4 py-2 font-mono tabular-nums text-slate-500">
                                    {formatDateShort(m.date)}
                                  </td>
                                  <td className="px-2 py-2 text-center font-mono font-semibold text-slate-700">
                                    {m.journal}
                                  </td>
                                  <td className="px-3 py-2 font-mono text-slate-700">{m.numeroPiece}</td>
                                  <td className="px-3 py-2 text-slate-800">
                                    {m.libelle}
                                    {m.tiers ? (
                                      <span className="text-slate-400"> · {m.tiers}</span>
                                    ) : null}
                                  </td>
                                  <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-900">
                                    {m.debit > 0 ? formatPrice(m.debit) : ''}
                                  </td>
                                  <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-900">
                                    {m.credit > 0 ? formatPrice(m.credit) : ''}
                                  </td>
                                  <td className="px-4 py-2 text-right font-mono tabular-nums font-medium text-slate-700">
                                    {formatPrice(m.soldeProgressif)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* ═══════════════ TAB 5: JOURNAL GÉNÉRAL & AUXILIAIRES ═══════════════ */}
          {!isCommercialOnly && activeTab === 'journal' && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    {lang === 'fr' ? 'Journal Général & Journaux Auxiliaires' : 'General & Auxiliary Journals'}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {filteredJournalEntries.length}{' '}
                    {lang === 'fr' ? 'écriture(s) en partie double' : 'double-entry posting(s)'} · {periodLabel}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={journalSearch}
                      onChange={(e) => setJournalSearch(e.target.value)}
                      placeholder={lang === 'fr' ? 'Pièce, compte, libellé...' : 'Ref, account, label...'}
                      className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs w-48 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={exportingPdf}
                    onClick={() => handlePdfExport('journal')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    <FileText className="w-3.5 h-3.5 text-rose-600" />
                    PDF
                  </button>
                  {canWriteAccounting && (
                    <button
                      type="button"
                      onClick={() => setShowOdModal(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {lang === 'fr' ? 'Nouvelle écriture OD' : 'New OD Entry'}
                    </button>
                  )}
                </div>
              </div>

              {/* Auxiliary journal filter bar */}
              <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap gap-1.5">
                {(['ALL', 'VE', 'CA', 'BQ', 'AC', 'OD'] as const).map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setJournalFilter(code)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      journalFilter === code
                        ? 'bg-slate-900 text-white'
                        : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {code === 'ALL'
                      ? lang === 'fr'
                        ? 'Tous les journaux'
                        : 'All journals'
                      : `${code} · ${
                          code === 'VE'
                            ? 'Ventes'
                            : code === 'CA'
                            ? 'Caisse'
                            : code === 'BQ'
                            ? 'Banque / Mobile'
                            : code === 'AC'
                            ? 'Achats / Charges'
                            : 'Op. Diverses'
                        }`}
                  </button>
                ))}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wide">
                      <th className="text-left px-4 py-2.5 w-24">Date</th>
                      <th className="text-center px-2 py-2.5 w-12">Jrn</th>
                      <th className="text-left px-3 py-2.5 w-28">N° Pièce</th>
                      <th className="text-left px-3 py-2.5 w-20">Compte</th>
                      <th className="text-left px-3 py-2.5">Intitulé & Libellé</th>
                      <th className="text-right px-3 py-2.5 w-28">Débit</th>
                      <th className="text-right px-4 py-2.5 w-28">Crédit</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredJournalEntries.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                          {lang === 'fr'
                            ? 'Aucune écriture comptable pour ce filtre.'
                            : 'No journal entries for this filter.'}
                        </td>
                      </tr>
                    ) : (
                      filteredJournalEntries.map((entry) =>
                        entry.lignes.map((l, idx) => (
                          <tr
                            key={`${entry.id}_${idx}`}
                            className={`${
                              idx === entry.lignes.length - 1
                                ? 'border-b border-slate-200'
                                : 'border-b border-slate-50'
                            } hover:bg-slate-50/70`}
                          >
                            <td className="px-4 py-2 font-mono tabular-nums text-slate-500">
                              {idx === 0 ? formatDateShort(entry.date) : ''}
                            </td>
                            <td className="px-2 py-2 text-center font-mono font-semibold text-slate-700">
                              {idx === 0 ? entry.journal : ''}
                            </td>
                            <td className="px-3 py-2 font-mono text-slate-700">
                              {idx === 0 ? entry.numeroPiece : ''}
                            </td>
                            <td className="px-3 py-2 font-mono font-semibold text-slate-900">
                              {l.compte}
                            </td>
                            <td className={`px-3 py-2 text-slate-800 ${l.credit > 0 ? 'pl-7' : ''}`}>
                              <span className="font-medium text-slate-900">{l.intitule}</span>
                              <span className="text-slate-400"> — {l.libelle}</span>
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-900">
                              {l.debit > 0 ? formatPrice(l.debit) : ''}
                            </td>
                            <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-900">
                              {l.credit > 0 ? formatPrice(l.credit) : ''}
                            </td>
                            <td className="px-2 py-2 text-right">
                              {idx === 0 && entry.source === 'manuel' && entry.manualRecordId && canWriteAccounting && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteManualEntry(entry.manualRecordId!)}
                                  className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                  title={lang === 'fr' ? 'Supprimer cette écriture OD' : 'Delete manual entry'}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </td>
                          </tr>
                        )),
                      )
                    )}
                  </tbody>
                  {filteredJournalEntries.length > 0 && (
                    <tfoot>
                      <tr className="bg-slate-900 text-white font-semibold">
                        <td colSpan={5} className="px-4 py-3 text-xs uppercase tracking-wide">
                          {lang === 'fr' ? 'Totaux Journal (Débit = Crédit)' : 'Journal Totals (Debit = Credit)'}
                        </td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums">
                          {formatPrice(journalTotals.totalDebit)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">
                          {formatPrice(journalTotals.totalCredit)}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}

          {/* ═══════════════ TAB 6: PLAN COMPTABLE SYSCOHADA ═══════════════ */}
          {!isCommercialOnly && activeTab === 'plan' && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    {lang === 'fr'
                      ? 'Plan Comptable SYSCOHADA Révisé — Référentiel Pressing'
                      : 'Revised SYSCOHADA Chart of Accounts — Laundry Reference'}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {filteredPlanAccounts.length} {lang === 'fr' ? 'comptes officiels OHADA (Classes 1 à 8)' : 'official OHADA accounts (Classes 1–8)'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={planSearch}
                      onChange={(e) => setPlanSearch(e.target.value)}
                      placeholder={lang === 'fr' ? 'Code ou intitulé...' : 'Code or name...'}
                      className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs w-48 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>
                  <select
                    value={planClassFilter}
                    onChange={(e) =>
                      setPlanClassFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))
                    }
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
                  >
                    <option value="all">{lang === 'fr' ? 'Toutes les classes' : 'All classes'}</option>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((cl) => (
                      <option key={cl} value={cl}>
                        {lang === 'fr' ? SYSCOHADA_CLASS_LABELS[cl].fr : SYSCOHADA_CLASS_LABELS[cl].en}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wide">
                      <th className="text-left px-4 py-2.5 w-24">N° Compte</th>
                      <th className="text-left px-4 py-2.5">Intitulé SYSCOHADA</th>
                      <th className="text-left px-4 py-2.5 w-52">Classe</th>
                      <th className="text-center px-4 py-2.5 w-28">Sens normal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredPlanAccounts.map((acc) => (
                      <tr key={acc.code} className="hover:bg-slate-50/70">
                        <td className="px-4 py-2.5 font-mono font-bold text-slate-900">{acc.code}</td>
                        <td className="px-4 py-2.5 text-slate-800">
                          {lang === 'fr' ? acc.intitule : acc.intituleEn}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500">
                          {lang === 'fr'
                            ? SYSCOHADA_CLASS_LABELS[acc.classe].fr
                            : SYSCOHADA_CLASS_LABELS[acc.classe].en}
                        </td>
                        <td className="px-4 py-2.5 text-center font-mono text-slate-600">
                          {acc.sensNormal === 'debit'
                            ? lang === 'fr'
                              ? 'Débiteur'
                              : 'Debit'
                            : lang === 'fr'
                            ? 'Créditeur'
                            : 'Credit'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Manual OD Entry Modal */}
      {showOdModal && canWriteAccounting && (
        <SyscohadaOdModal
          lang={lang}
          onClose={() => setShowOdModal(false)}
          onSaved={async (storedLocally) => {
            setShowOdModal(false);
            await loadComptabilite();
            showToast(
              storedLocally
                ? lang === 'fr'
                  ? 'Écriture enregistrée localement (exécutez la migration SQL pour la synchroniser sur tous vos appareils).'
                  : 'Entry saved locally (run SQL migration to sync across devices).'
                : lang === 'fr'
                ? 'Écriture comptable enregistrée et équilibrée.'
                : 'Balanced accounting entry saved.',
            );
          }}
        />
      )}

      <PrintableReport data={reportData} />
    </div>
  );
}
