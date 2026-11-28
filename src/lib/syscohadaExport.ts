import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import type { Entreprise } from '@/types';
import { formatDateShort } from '@/types';
import type {
  SyscohadaLedgerResult,
  SyscohadaJournalEntry,
} from '@/lib/syscohada';

const MARGIN_X = 14;
const COLORS = {
  ink: [15, 23, 42] as [number, number, number],
  body: [51, 65, 85] as [number, number, number],
  muted: [100, 116, 139] as [number, number, number],
  line: [226, 232, 240] as [number, number, number],
  tint: [248, 250, 252] as [number, number, number],
  accent: [15, 23, 42] as [number, number, number],
  highlightBg: [241, 245, 249] as [number, number, number],
  positive: [22, 163, 74] as [number, number, number],
  negative: [220, 38, 38] as [number, number, number],
};

function sanitize(raw: string): string {
  return String(raw ?? '')
    .replace(/\u2019|\u2018/g, "'")
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u2013|\u2014/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u0153/g, 'oe')
    .replace(/\u0152/g, 'OE')
    .replace(/\u00a0|\u202f/g, ' ')
    .replace(/\u2212/g, '-');
}

function fmtAmount(n: number): string {
  if (!Number.isFinite(n) || Math.abs(n) < 0.005) return '0';
  const rounded = Math.round(n);
  const absStr = Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return rounded < 0 ? `-${absStr}` : absStr;
}

function slug(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 36) || 'PressingLite'
  );
}

interface PdfLogoAsset {
  dataUrl: string;
  aspect: number;
}

function loadPdfLogo(url?: string | null): Promise<PdfLogoAsset | null> {
  const cleanUrl = url?.trim();
  if (!cleanUrl || typeof window === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: PdfLogoAsset | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(v);
    };
    const timer = window.setTimeout(() => finish(null), 3000);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (!w || !h) {
          finish(null);
          return;
        }
        const scale = Math.min(1, 400 / Math.max(w, h));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          finish(null);
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        finish({ dataUrl: canvas.toDataURL('image/png'), aspect: w / h });
      } catch {
        finish(null);
      }
    };
    img.onerror = () => finish(null);
    img.src = cleanUrl;
  });
}

interface PdfHeaderOpts {
  doc: jsPDF;
  title: string;
  subtitle: string;
  periodLabel: string;
  entreprise: Entreprise | null;
  logo: PdfLogoAsset | null;
  regimeLabel: string;
}

function drawHeader(opts: PdfHeaderOpts): number {
  const { doc, title, subtitle, periodLabel, entreprise, logo, regimeLabel } = opts;
  const pageW = doc.internal.pageSize.getWidth();
  let leftX = MARGIN_X;

  if (logo) {
    const maxH = 14;
    const maxW = 24;
    let drawW = maxH * logo.aspect;
    let drawH = maxH;
    if (drawW > maxW) {
      drawW = maxW;
      drawH = maxW / logo.aspect;
    }
    try {
      doc.addImage(logo.dataUrl, 'PNG', MARGIN_X, 11, drawW, drawH);
      leftX = MARGIN_X + drawW + 4;
    } catch {
      // ignore image draw errors
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...COLORS.ink);
  doc.text(sanitize(entreprise?.nom || 'PressingLite'), leftX, 15.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.muted);
  const subParts = [
    entreprise?.adresse,
    entreprise?.ville,
    entreprise?.telephone ? `Tel: ${entreprise.telephone}` : null,
  ].filter(Boolean);
  if (subParts.length > 0) {
    doc.text(sanitize(subParts.join(' - ')), leftX, 20);
  }
  doc.text(sanitize(`Referentiel : SYSCOHADA Revise (${regimeLabel}) - Devise : FCFA (XOF)`), leftX, 24);

  // Right title block
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...COLORS.ink);
  doc.text(sanitize(title), pageW - MARGIN_X, 15.5, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...COLORS.body);
  doc.text(sanitize(subtitle), pageW - MARGIN_X, 20, { align: 'right' });

  doc.setFontSize(8);
  doc.setTextColor(...COLORS.muted);
  doc.text(
    sanitize(`Periode : ${periodLabel}  |  Edite le ${new Date().toLocaleDateString('fr-FR')}`),
    pageW - MARGIN_X,
    24,
    { align: 'right' },
  );

  doc.setDrawColor(...COLORS.ink);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_X, 27.5, pageW - MARGIN_X, 27.5);
  return 33;
}

function drawPageFooters(doc: jsPDF, entreprise: Entreprise | null, docTitle: string) {
  const total = doc.getNumberOfPages();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setDrawColor(...COLORS.line);
    doc.setLineWidth(0.2);
    doc.line(MARGIN_X, pageH - 13, pageW - MARGIN_X, pageH - 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...COLORS.muted);
    doc.text(
      sanitize(`${entreprise?.nom || 'PressingLite'} - ${docTitle} (SYSCOHADA Revise)`),
      MARGIN_X,
      pageH - 8.5,
    );
    doc.text(`Page ${i} / ${total}`, pageW - MARGIN_X, pageH - 8.5, { align: 'right' });
  }
}

export type SyscohadaPdfStatement =
  | 'compte_resultat'
  | 'balance'
  | 'grand_livre'
  | 'journal';

export async function exportSyscohadaPdf(params: {
  statement: SyscohadaPdfStatement;
  ledger: SyscohadaLedgerResult;
  entreprise: Entreprise | null;
  periodLabel: string;
  regimeLabel: string;
  filteredJournalEntries?: SyscohadaJournalEntry[];
  journalFilterLabel?: string;
}): Promise<void> {
  const {
    statement,
    ledger,
    entreprise,
    periodLabel,
    regimeLabel,
    filteredJournalEntries,
    journalFilterLabel,
  } = params;

  const isLandscape = statement === 'balance' || statement === 'journal';
  const doc = new jsPDF({
    unit: 'mm',
    format: 'a4',
    orientation: isLandscape ? 'landscape' : 'portrait',
  });
  const logo = await loadPdfLogo(entreprise?.logo_url);
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const bottomLimit = pageH - 18;
  const contentW = pageW - MARGIN_X * 2;

  const titleMap: Record<SyscohadaPdfStatement, { title: string; subtitle: string; slugPart: string }> = {
    compte_resultat: {
      title: 'COMPTE DE RESULTAT (SYSCOHADA)',
      subtitle: 'Soldes Intermediaires de Gestion (SIG)',
      slugPart: 'Compte-de-Resultat-SYSCOHADA',
    },
    balance: {
      title: 'BALANCE GENERALE DES COMPTES',
      subtitle: 'Balance a 6 colonnes - Controle Debit = Credit',
      slugPart: 'Balance-Generale-SYSCOHADA',
    },
    grand_livre: {
      title: 'GRAND LIVRE GENERAL',
      subtitle: 'Detail des mouvements et soldes par compte',
      slugPart: 'Grand-Livre-SYSCOHADA',
    },
    journal: {
      title: 'JOURNAL COMPTABLE SYSCOHADA',
      subtitle: journalFilterLabel || 'Journal General (Partie double)',
      slugPart: 'Journal-SYSCOHADA',
    },
  };

  const meta = titleMap[statement];
  let y = drawHeader({
    doc,
    title: meta.title,
    subtitle: meta.subtitle,
    periodLabel,
    entreprise,
    logo,
    regimeLabel,
  });

  const ensureSpace = (needed: number, redrawTableHeader?: () => void) => {
    if (y + needed > bottomLimit) {
      doc.addPage();
      y = drawHeader({
        doc,
        title: meta.title,
        subtitle: meta.subtitle,
        periodLabel,
        entreprise,
        logo,
        regimeLabel,
      });
      redrawTableHeader?.();
    }
  };

  // ── 1. Compte de Résultat ──
  if (statement === 'compte_resultat') {
    const drawCRHeader = () => {
      doc.setFillColor(...COLORS.ink);
      doc.rect(MARGIN_X, y, contentW, 7.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(255, 255, 255);
      doc.text('REF', MARGIN_X + 2, y + 5);
      doc.text('RUBRIQUES (SYSCOHADA REVISE)', MARGIN_X + 16, y + 5);
      doc.text('COMPTES', MARGIN_X + 122, y + 5);
      doc.text('MONTANT (FCFA)', pageW - MARGIN_X - 2, y + 5, { align: 'right' });
      y += 7.5;
    };

    drawCRHeader();

    for (const line of ledger.compteResultat.lines) {
      ensureSpace(8, drawCRHeader);
      const rowH = line.isMajor ? 8.5 : 7;
      if (line.isMajor) {
        doc.setFillColor(226, 232, 240);
        doc.rect(MARGIN_X, y, contentW, rowH, 'F');
      } else if (line.isSubtotal) {
        doc.setFillColor(...COLORS.highlightBg);
        doc.rect(MARGIN_X, y, contentW, rowH, 'F');
      }

      doc.setFont('helvetica', line.isSubtotal || line.isMajor ? 'bold' : 'normal');
      doc.setFontSize(line.isMajor ? 9 : 8.2);
      doc.setTextColor(...COLORS.ink);
      doc.text(sanitize(line.ref), MARGIN_X + 2, y + 4.8);
      doc.text(sanitize(line.label), MARGIN_X + 16, y + 4.8);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...COLORS.muted);
      doc.text(sanitize(line.comptes), MARGIN_X + 122, y + 4.8);

      doc.setFont('helvetica', line.isSubtotal || line.isMajor ? 'bold' : 'normal');
      doc.setFontSize(line.isMajor ? 9 : 8.2);
      if (line.isMajor) {
        doc.setTextColor(...(line.montant >= 0 ? COLORS.positive : COLORS.negative));
      } else {
        doc.setTextColor(...COLORS.ink);
      }
      doc.text(fmtAmount(line.montant), pageW - MARGIN_X - 2, y + 4.8, { align: 'right' });

      doc.setDrawColor(...COLORS.line);
      doc.setLineWidth(0.15);
      doc.line(MARGIN_X, y + rowH, pageW - MARGIN_X, y + rowH);
      y += rowH;
    }

    // SMT Treasury Summary box below Compte de Résultat
    y += 6;
    ensureSpace(34);
    doc.setFillColor(...COLORS.tint);
    doc.setDrawColor(...COLORS.line);
    doc.rect(MARGIN_X, y, contentW, 28, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...COLORS.ink);
    doc.text('SYNTHESE DE TRESORERIE (SMT) & CREANCES', MARGIN_X + 4, y + 6);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.body);
    const smt = ledger.etatSmt;
    doc.text(`Recettes encaissees : ${fmtAmount(smt.recettesEncaissees)} FCFA`, MARGIN_X + 4, y + 12.5);
    doc.text(`Depenses decaissees : ${fmtAmount(smt.depensesDecaissees)} FCFA`, MARGIN_X + 4, y + 18);
    doc.setFont('helvetica', 'bold');
    doc.text(`Solde net de tresorerie : ${fmtAmount(smt.soldeNetTresorerie)} FCFA`, MARGIN_X + 4, y + 23.5);

    doc.setFont('helvetica', 'normal');
    doc.text(`Caisse (5711) : ${fmtAmount(smt.soldeCaisse5711)} FCFA`, MARGIN_X + contentW / 2, y + 12.5);
    doc.text(`Banques (5211) : ${fmtAmount(smt.soldeBanque5211)} FCFA  |  Mobile Money (5212) : ${fmtAmount(smt.soldeMobileMoney5212)} FCFA`, MARGIN_X + contentW / 2, y + 18);
    doc.text(`Creances clients (4111) : ${fmtAmount(smt.creancesClients4111)} FCFA`, MARGIN_X + contentW / 2, y + 23.5);
  }

  // ── 2. Balance Générale à 6 colonnes ──
  if (statement === 'balance') {
    const colX = {
      compte: MARGIN_X + 2,
      intitule: MARGIN_X + 24,
      mvtD: MARGIN_X + 145,
      mvtC: MARGIN_X + 182,
      solD: MARGIN_X + 220,
      solC: pageW - MARGIN_X - 2,
    };

    const drawBalHeader = () => {
      doc.setFillColor(...COLORS.ink);
      doc.rect(MARGIN_X, y, contentW, 8, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(255, 255, 255);
      doc.text('COMPTE', colX.compte, y + 5.2);
      doc.text('INTITULE DU COMPTE', colX.intitule, y + 5.2);
      doc.text('MVT DEBIT', colX.mvtD, y + 5.2, { align: 'right' });
      doc.text('MVT CREDIT', colX.mvtC, y + 5.2, { align: 'right' });
      doc.text('SOLDE DEBITEUR', colX.solD, y + 5.2, { align: 'right' });
      doc.text('SOLDE CREDITEUR', colX.solC, y + 5.2, { align: 'right' });
      y += 8;
    };

    drawBalHeader();

    for (const row of ledger.balance.rows) {
      ensureSpace(7, drawBalHeader);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...COLORS.ink);
      doc.text(sanitize(row.compte), colX.compte, y + 4.6);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...COLORS.body);
      doc.text(sanitize(row.intitule).slice(0, 62), colX.intitule, y + 4.6);
      doc.text(row.mouvementDebit ? fmtAmount(row.mouvementDebit) : '-', colX.mvtD, y + 4.6, { align: 'right' });
      doc.text(row.mouvementCredit ? fmtAmount(row.mouvementCredit) : '-', colX.mvtC, y + 4.6, { align: 'right' });
      doc.text(row.soldeDebiteur ? fmtAmount(row.soldeDebiteur) : '-', colX.solD, y + 4.6, { align: 'right' });
      doc.text(row.soldeCrediteur ? fmtAmount(row.soldeCrediteur) : '-', colX.solC, y + 4.6, { align: 'right' });

      doc.setDrawColor(...COLORS.line);
      doc.setLineWidth(0.12);
      doc.line(MARGIN_X, y + 6.5, pageW - MARGIN_X, y + 6.5);
      y += 6.5;
    }

    ensureSpace(10, drawBalHeader);
    doc.setFillColor(...COLORS.highlightBg);
    doc.rect(MARGIN_X, y, contentW, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...COLORS.ink);
    doc.text('TOTAUX GENERAUX (EQUILIBRE)', colX.intitule, y + 5.4);
    doc.text(fmtAmount(ledger.balance.totalMouvementDebit), colX.mvtD, y + 5.4, { align: 'right' });
    doc.text(fmtAmount(ledger.balance.totalMouvementCredit), colX.mvtC, y + 5.4, { align: 'right' });
    doc.text(fmtAmount(ledger.balance.totalSoldeDebiteur), colX.solD, y + 5.4, { align: 'right' });
    doc.text(fmtAmount(ledger.balance.totalSoldeCrediteur), colX.solC, y + 5.4, { align: 'right' });
  }

  // ── 3. Grand Livre Général ──
  if (statement === 'grand_livre') {
    for (const acc of ledger.grandLivre) {
      ensureSpace(18);
      doc.setFillColor(...COLORS.highlightBg);
      doc.rect(MARGIN_X, y, contentW, 7, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(...COLORS.ink);
      doc.text(sanitize(`${acc.compte} - ${acc.intitule}`), MARGIN_X + 2, y + 4.8);
      const soldeTxt =
        acc.soldeDebiteur > 0
          ? `Solde Debiteur : ${fmtAmount(acc.soldeDebiteur)}`
          : acc.soldeCrediteur > 0
          ? `Solde Crediteur : ${fmtAmount(acc.soldeCrediteur)}`
          : 'Solde : 0';
      doc.text(soldeTxt, pageW - MARGIN_X - 2, y + 4.8, { align: 'right' });
      y += 7;

      const drawAccHeader = () => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.2);
        doc.setTextColor(...COLORS.muted);
        doc.text('DATE', MARGIN_X + 2, y + 4);
        doc.text('JRN', MARGIN_X + 22, y + 4);
        doc.text('PIECE', MARGIN_X + 33, y + 4);
        doc.text('LIBELLE', MARGIN_X + 56, y + 4);
        doc.text('DEBIT', MARGIN_X + 148, y + 4, { align: 'right' });
        doc.text('CREDIT', pageW - MARGIN_X - 2, y + 4, { align: 'right' });
        doc.setDrawColor(...COLORS.line);
        doc.line(MARGIN_X, y + 5.5, pageW - MARGIN_X, y + 5.5);
        y += 5.5;
      };

      drawAccHeader();

      for (const m of acc.mouvements) {
        ensureSpace(6, drawAccHeader);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...COLORS.body);
        doc.text(formatDateShort(m.date), MARGIN_X + 2, y + 4);
        doc.text(m.journal, MARGIN_X + 22, y + 4);
        doc.text(sanitize(m.numeroPiece).slice(0, 14), MARGIN_X + 33, y + 4);
        doc.text(sanitize(m.libelle).slice(0, 44), MARGIN_X + 56, y + 4);
        doc.text(m.debit ? fmtAmount(m.debit) : '', MARGIN_X + 148, y + 4, { align: 'right' });
        doc.text(m.credit ? fmtAmount(m.credit) : '', pageW - MARGIN_X - 2, y + 4, { align: 'right' });
        y += 5.2;
      }

      ensureSpace(7);
      doc.setDrawColor(...COLORS.line);
      doc.line(MARGIN_X, y, pageW - MARGIN_X, y);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...COLORS.ink);
      doc.text(`Total compte ${acc.compte}`, MARGIN_X + 56, y + 4.2);
      doc.text(fmtAmount(acc.totalDebit), MARGIN_X + 148, y + 4.2, { align: 'right' });
      doc.text(fmtAmount(acc.totalCredit), pageW - MARGIN_X - 2, y + 4.2, { align: 'right' });
      y += 9;
    }
  }

  // ── 4. Journal Général / Auxiliaire ──
  if (statement === 'journal') {
    const entries = filteredJournalEntries ?? ledger.entries;
    const drawJrnHeader = () => {
      doc.setFillColor(...COLORS.ink);
      doc.rect(MARGIN_X, y, contentW, 7.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.8);
      doc.setTextColor(255, 255, 255);
      doc.text('DATE', MARGIN_X + 2, y + 5);
      doc.text('JRN', MARGIN_X + 24, y + 5);
      doc.text('N° PIECE', MARGIN_X + 36, y + 5);
      doc.text('COMPTE', MARGIN_X + 66, y + 5);
      doc.text('INTITULE & LIBELLE', MARGIN_X + 86, y + 5);
      doc.text('DEBIT', MARGIN_X + 232, y + 5, { align: 'right' });
      doc.text('CREDIT', pageW - MARGIN_X - 2, y + 5, { align: 'right' });
      y += 7.5;
    };

    drawJrnHeader();
    let totD = 0;
    let totC = 0;

    for (const entry of entries) {
      for (let i = 0; i < entry.lignes.length; i++) {
        const l = entry.lignes[i];
        ensureSpace(6.2, drawJrnHeader);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.6);
        doc.setTextColor(...COLORS.body);
        if (i === 0) {
          doc.text(formatDateShort(entry.date), MARGIN_X + 2, y + 4.2);
          doc.setFont('helvetica', 'bold');
          doc.text(entry.journal, MARGIN_X + 24, y + 4.2);
          doc.setFont('helvetica', 'normal');
          doc.text(sanitize(entry.numeroPiece).slice(0, 16), MARGIN_X + 36, y + 4.2);
        }
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...COLORS.ink);
        doc.text(l.compte, MARGIN_X + 66, y + 4.2);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...COLORS.body);
        doc.text(sanitize(`${l.intitule} - ${l.libelle}`).slice(0, 74), MARGIN_X + 86, y + 4.2);
        doc.text(l.debit ? fmtAmount(l.debit) : '', MARGIN_X + 232, y + 4.2, { align: 'right' });
        doc.text(l.credit ? fmtAmount(l.credit) : '', pageW - MARGIN_X - 2, y + 4.2, { align: 'right' });
        totD += l.debit;
        totC += l.credit;
        y += 5.4;
      }
      doc.setDrawColor(...COLORS.line);
      doc.setLineWidth(0.1);
      doc.line(MARGIN_X, y, pageW - MARGIN_X, y);
    }

    ensureSpace(9, drawJrnHeader);
    doc.setFillColor(...COLORS.highlightBg);
    doc.rect(MARGIN_X, y, contentW, 7.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.setTextColor(...COLORS.ink);
    doc.text('TOTAUX JOURNAL (DEBIT = CREDIT)', MARGIN_X + 86, y + 5);
    doc.text(fmtAmount(totD), MARGIN_X + 232, y + 5, { align: 'right' });
    doc.text(fmtAmount(totC), pageW - MARGIN_X - 2, y + 5, { align: 'right' });
  }

  drawPageFooters(doc, entreprise, meta.title);
  const dateStamp = new Date().toISOString().slice(0, 10);
  doc.save(`${slug(entreprise?.nom || 'PressingLite')}_${meta.slugPart}_${dateStamp}.pdf`);
}

/**
 * Exports the complete SYSCOHADA accounting package as a multi-sheet Excel workbook (.xlsx).
 */
export function exportSyscohadaExcel(params: {
  ledger: SyscohadaLedgerResult;
  entreprise: Entreprise | null;
  periodLabel: string;
  regimeLabel: string;
}): void {
  const { ledger, entreprise, periodLabel, regimeLabel } = params;
  const wb = XLSX.utils.book_new();

  // Sheet 1: Compte de Résultat (SIG)
  const crRows = [
    [entreprise?.nom || 'PressingLite', '', 'COMPTE DE RÉSULTAT SYSCOHADA RÉVISÉ', ''],
    ['Période', periodLabel, 'Régime', regimeLabel],
    [],
    ['Réf', 'Rubrique', 'Comptes', 'Montant (FCFA)'],
    ...ledger.compteResultat.lines.map((l) => [l.ref, l.label, l.comptes, Math.round(l.montant)]),
  ];
  const wsCR = XLSX.utils.aoa_to_sheet(crRows);
  wsCR['!cols'] = [{ wch: 8 }, { wch: 52 }, { wch: 16 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsCR, 'Compte de Resultat');

  // Sheet 2: Balance Générale 6 colonnes
  const balRows = [
    ['BALANCE GÉNÉRALE DES COMPTES (6 COLONNES)', '', '', '', '', ''],
    ['Entreprise', entreprise?.nom || '', 'Période', periodLabel, '', ''],
    [],
    ['Compte', 'Intitulé', 'Mvt Débit', 'Mvt Crédit', 'Solde Débiteur', 'Solde Créditeur'],
    ...ledger.balance.rows.map((r) => [
      r.compte,
      r.intitule,
      Math.round(r.mouvementDebit),
      Math.round(r.mouvementCredit),
      Math.round(r.soldeDebiteur),
      Math.round(r.soldeCrediteur),
    ]),
    [
      'TOTAL',
      'TOTAUX GÉNÉRAUX',
      Math.round(ledger.balance.totalMouvementDebit),
      Math.round(ledger.balance.totalMouvementCredit),
      Math.round(ledger.balance.totalSoldeDebiteur),
      Math.round(ledger.balance.totalSoldeCrediteur),
    ],
  ];
  const wsBal = XLSX.utils.aoa_to_sheet(balRows);
  wsBal['!cols'] = [{ wch: 12 }, { wch: 46 }, { wch: 15 }, { wch: 15 }, { wch: 16 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsBal, 'Balance Generale');

  // Sheet 3: Grand Livre
  const glRows: (string | number)[][] = [
    ['Compte', 'Intitulé Compte', 'Date', 'Journal', 'N° Pièce', 'Libellé', 'Tiers', 'Débit', 'Crédit', 'Solde Progressif'],
  ];
  for (const acc of ledger.grandLivre) {
    for (const m of acc.mouvements) {
      glRows.push([
        acc.compte,
        acc.intitule,
        formatDateShort(m.date),
        m.journal,
        m.numeroPiece,
        m.libelle,
        m.tiers || '',
        Math.round(m.debit),
        Math.round(m.credit),
        Math.round(m.soldeProgressif),
      ]);
    }
  }
  const wsGL = XLSX.utils.aoa_to_sheet(glRows);
  wsGL['!cols'] = [
    { wch: 10 },
    { wch: 36 },
    { wch: 12 },
    { wch: 8 },
    { wch: 16 },
    { wch: 42 },
    { wch: 24 },
    { wch: 14 },
    { wch: 14 },
    { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(wb, wsGL, 'Grand Livre');

  // Sheet 4: Journal Général
  const jrnRows: (string | number)[][] = [
    ['Date', 'Journal', 'N° Pièce', 'Compte', 'Intitulé', 'Libellé', 'Tiers', 'Débit', 'Crédit'],
  ];
  for (const e of ledger.entries) {
    for (const l of e.lignes) {
      jrnRows.push([
        formatDateShort(e.date),
        e.journal,
        e.numeroPiece,
        l.compte,
        l.intitule,
        l.libelle,
        l.tiers || '',
        Math.round(l.debit),
        Math.round(l.credit),
      ]);
    }
  }
  const wsJrn = XLSX.utils.aoa_to_sheet(jrnRows);
  wsJrn['!cols'] = [
    { wch: 12 },
    { wch: 8 },
    { wch: 16 },
    { wch: 10 },
    { wch: 36 },
    { wch: 42 },
    { wch: 24 },
    { wch: 14 },
    { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, wsJrn, 'Journal General');

  // Sheet 5: SMT & Créances Clients
  const smt = ledger.etatSmt;
  const smtRows: (string | number)[][] = [
    ['ÉTAT DE TRÉSORERIE (SMT) & CRÉANCES CLIENTS (4111)', '', '', ''],
    ['Recettes encaissées', Math.round(smt.recettesEncaissees), 'Caisse (5711)', Math.round(smt.soldeCaisse5711)],
    ['Dépenses décaissées', Math.round(smt.depensesDecaissees), 'Banques (5211)', Math.round(smt.soldeBanque5211)],
    ['Solde net de trésorerie', Math.round(smt.soldeNetTresorerie), 'Mobile Money (5212)', Math.round(smt.soldeMobileMoney5212)],
    ['TVA Collectée (4432)', Math.round(smt.tvaCollectee4432), 'TVA Déductible (4452)', Math.round(smt.tvaDeductible4452)],
    ['TVA Nette à payer', Math.round(smt.tvaNetteAPayer), 'Créances Clients (4111)', Math.round(smt.creancesClients4111)],
    [],
    ['N° Dépôt', 'Date', 'Client', 'Total', 'Payé', 'Reste dû', 'Ancienneté (jours)'],
    ...ledger.creancesClients.map((c) => [
      c.numero,
      formatDateShort(c.dateDepot),
      c.clientNom,
      Math.round(c.total),
      Math.round(c.paye),
      Math.round(c.reste),
      c.joursAnciennete,
    ]),
  ];
  const wsSmt = XLSX.utils.aoa_to_sheet(smtRows);
  wsSmt['!cols'] = [{ wch: 24 }, { wch: 16 }, { wch: 28 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsSmt, 'Tresorerie SMT & Creances');

  const dateStamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${slug(entreprise?.nom || 'PressingLite')}_Comptabilite-SYSCOHADA_${dateStamp}.xlsx`);
}
