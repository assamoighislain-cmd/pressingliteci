import { jsPDF } from 'jspdf';
import type { Entreprise } from '@/types';
import type { Lang } from '@/lib/i18n';
import {
  getPresentationModules,
  getRoleMatrix,
  getTechnicalSpecs,
  getUserGuideChapters,
  getWorkflowSteps,
} from '@/lib/userGuideContent';

const PAGE_W = 210; // A4 width in mm
const PAGE_H = 297; // A4 height in mm
const MARGIN_X = 18;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const TOP_Y = 24;
const BOTTOM_LIMIT = PAGE_H - 22;

const COLORS = {
  ink: [15, 23, 42] as [number, number, number], // slate-900
  body: [51, 65, 85] as [number, number, number], // slate-700
  muted: [100, 116, 139] as [number, number, number], // slate-500
  hairline: [226, 232, 240] as [number, number, number], // slate-200
  surface: [248, 250, 252] as [number, number, number], // slate-50
  skyTint: [240, 249, 255] as [number, number, number], // sky-50
  skyBorder: [186, 230, 253] as [number, number, number], // sky-200
  accent: [2, 132, 199] as [number, number, number], // sky-600
  accentDark: [12, 74, 110] as [number, number, number], // sky-900
  white: [255, 255, 255] as [number, number, number],
};

/**
 * Normalizes characters outside jsPDF's built-in WinAnsi Helvetica glyph table
 * while preserving all French accented characters (é, è, ê, à, ç, ù, ô, î, «, »).
 */
function sanitizePdfText(raw: string): string {
  return raw
    .replace(/\u2019|\u2018/g, "'")
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u2013|\u2014/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u0153/g, 'oe')
    .replace(/\u0152/g, 'OE')
    .replace(/\u2192/g, '->')
    .replace(/\u2194/g, '<->')
    .replace(/\u00a0|\u202f/g, ' ')
    .replace(/\u2022/g, '-')
    .replace(/\u2713|\u2714/g, 'OK');
}

function slugifyFilename(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'PressingLite';
}

function formatDocDate(lang: Lang): string {
  try {
    return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-US', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

interface PdfLogoAsset {
  dataUrl: string;
  aspect: number;
}

/**
 * Loads an external or data-URI logo image into a normalized PNG data URL
 * suitable for jsPDF, with a short timeout and silent fallback on CORS/network errors.
 */
function loadPdfLogo(url?: string | null): Promise<PdfLogoAsset | null> {
  const cleanUrl = url?.trim();
  if (!cleanUrl || typeof window === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val: PdfLogoAsset | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(val);
    };
    const timer = window.setTimeout(() => finish(null), 3500);
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
        const maxDim = 512;
        const scale = Math.min(1, maxDim / Math.max(w, h));
        const cw = Math.max(1, Math.round(w * scale));
        const ch = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          finish(null);
          return;
        }
        ctx.drawImage(img, 0, 0, cw, ch);
        const dataUrl = canvas.toDataURL('image/png');
        finish({ dataUrl, aspect: w / h });
      } catch {
        finish(null);
      }
    };
    img.onerror = () => finish(null);
    img.src = cleanUrl;
  });
}

class EditorialPdfBuilder {
  doc: jsPDF;
  y = TOP_Y;
  headerTitle: string;
  footerLeft: string;
  lang: Lang;

  constructor(headerTitle: string, footerLeft: string, lang: Lang) {
    this.doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    this.headerTitle = sanitizePdfText(headerTitle);
    this.footerLeft = sanitizePdfText(footerLeft);
    this.lang = lang;
  }

  addNewPage() {
    this.doc.addPage();
    this.y = TOP_Y;
  }

  ensureSpace(neededMm: number) {
    if (this.y + neededMm > BOTTOM_LIMIT) {
      this.addNewPage();
    }
  }

  drawSectionKicker(kicker: string, title: string, subtitle?: string) {
    this.ensureSpace(24);
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(8.5);
    this.doc.setTextColor(...COLORS.accent);
    this.doc.text(sanitizePdfText(kicker), MARGIN_X, this.y);
    this.y += 5.5;

    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(15.5);
    this.doc.setTextColor(...COLORS.ink);
    const titleLines = this.doc.splitTextToSize(sanitizePdfText(title), CONTENT_W);
    this.doc.text(titleLines, MARGIN_X, this.y);
    this.y += titleLines.length * 6.5;

    if (subtitle) {
      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(10);
      this.doc.setTextColor(...COLORS.muted);
      const subLines = this.doc.splitTextToSize(sanitizePdfText(subtitle), CONTENT_W);
      this.doc.text(subLines, MARGIN_X, this.y);
      this.y += subLines.length * 4.8 + 1;
    }

    this.doc.setDrawColor(...COLORS.hairline);
    this.doc.setLineWidth(0.4);
    this.doc.line(MARGIN_X, this.y + 1, PAGE_W - MARGIN_X, this.y + 1);
    this.y += 6.5;
  }

  drawSubHeading(text: string) {
    this.ensureSpace(14);
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(11);
    this.doc.setTextColor(...COLORS.ink);
    const lines = this.doc.splitTextToSize(sanitizePdfText(text), CONTENT_W);
    this.doc.text(lines, MARGIN_X, this.y);
    this.y += lines.length * 5.2 + 2;
  }

  drawParagraph(text: string, fontSize = 9.8, color: [number, number, number] = COLORS.body) {
    const clean = sanitizePdfText(text);
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(fontSize);
    this.doc.setTextColor(...color);
    const lines = this.doc.splitTextToSize(clean, CONTENT_W);
    const lineH = fontSize * 0.48;
    this.ensureSpace(lines.length * lineH + 3);
    this.doc.text(lines, MARGIN_X, this.y);
    this.y += lines.length * lineH + 3.2;
  }

  drawNumberedSteps(steps: string[]) {
    const numColW = 8;
    const textW = CONTENT_W - numColW;
    for (let i = 0; i < steps.length; i++) {
      const clean = sanitizePdfText(steps[i]);
      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(9.5);
      const lines = this.doc.splitTextToSize(clean, textW);
      const blockH = Math.max(5.5, lines.length * 4.6) + 2.2;
      this.ensureSpace(blockH);

      // Clean numeric index circle
      this.doc.setFillColor(...COLORS.skyTint);
      this.doc.setDrawColor(...COLORS.skyBorder);
      this.doc.setLineWidth(0.25);
      this.doc.circle(MARGIN_X + 2.6, this.y - 1.1, 2.5, 'FD');

      this.doc.setFont('helvetica', 'bold');
      this.doc.setFontSize(8);
      this.doc.setTextColor(...COLORS.accentDark);
      this.doc.text(String(i + 1), MARGIN_X + 2.6, this.y - 0.1, { align: 'center' });

      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(9.5);
      this.doc.setTextColor(...COLORS.body);
      this.doc.text(lines, MARGIN_X + numColW, this.y);
      this.y += blockH;
    }
    this.y += 1.5;
  }

  drawBullets(items: string[]) {
    const bulletIndent = 5.5;
    const textW = CONTENT_W - bulletIndent;
    for (const item of items) {
      const clean = sanitizePdfText(item);
      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(9.5);
      const lines = this.doc.splitTextToSize(clean, textW);
      const blockH = lines.length * 4.6 + 2;
      this.ensureSpace(blockH);

      this.doc.setFillColor(...COLORS.accent);
      this.doc.circle(MARGIN_X + 1.8, this.y - 1.1, 0.8, 'F');

      this.doc.setTextColor(...COLORS.body);
      this.doc.text(lines, MARGIN_X + bulletIndent, this.y);
      this.y += blockH;
    }
    this.y += 1.5;
  }

  drawTipBox(label: string, text: string) {
    const cleanText = sanitizePdfText(text);
    const cleanLabel = sanitizePdfText(label);
    const padX = 4.5;
    const padY = 4;
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(9);
    const lines = this.doc.splitTextToSize(cleanText, CONTENT_W - padX * 2);
    const boxH = padY * 2 + 4.5 + lines.length * 4.4;
    this.ensureSpace(boxH + 4);

    this.doc.setFillColor(...COLORS.skyTint);
    this.doc.setDrawColor(...COLORS.skyBorder);
    this.doc.setLineWidth(0.35);
    this.doc.roundedRect(MARGIN_X, this.y, CONTENT_W, boxH, 2.2, 2.2, 'FD');

    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(8.5);
    this.doc.setTextColor(...COLORS.accentDark);
    this.doc.text(cleanLabel, MARGIN_X + padX, this.y + padY + 2.8);

    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(9);
    this.doc.setTextColor(...COLORS.body);
    this.doc.text(lines, MARGIN_X + padX, this.y + padY + 7.6);

    this.y += boxH + 5;
  }

  drawKeyValueTable(rows: Array<[string, string]>) {
    const labelW = 54;
    const valW = CONTENT_W - labelW - 6;
    for (let i = 0; i < rows.length; i++) {
      const [label, value] = rows[i];
      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(9.2);
      const valLines = this.doc.splitTextToSize(sanitizePdfText(value), valW);
      const rowH = Math.max(6.5, valLines.length * 4.5 + 2.4);
      this.ensureSpace(rowH);

      if (i % 2 === 0) {
        this.doc.setFillColor(...COLORS.surface);
        this.doc.rect(MARGIN_X, this.y - 4.2, CONTENT_W, rowH, 'F');
      }

      this.doc.setFont('helvetica', 'bold');
      this.doc.setFontSize(9);
      this.doc.setTextColor(...COLORS.ink);
      this.doc.text(sanitizePdfText(label), MARGIN_X + 2.5, this.y);

      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(9.2);
      this.doc.setTextColor(...COLORS.body);
      this.doc.text(valLines, MARGIN_X + labelW + 3, this.y);

      this.doc.setDrawColor(...COLORS.hairline);
      this.doc.setLineWidth(0.2);
      this.doc.line(MARGIN_X, this.y - 4.2 + rowH, PAGE_W - MARGIN_X, this.y - 4.2 + rowH);

      this.y += rowH;
    }
    this.y += 4;
  }

  applyRunningHeadersAndFooters(skipPages: number[] = [1], logo: PdfLogoAsset | null = null) {
    const totalPages = this.doc.getNumberOfPages();
    const skipSet = new Set(skipPages);
    for (let p = 1; p <= totalPages; p++) {
      if (skipSet.has(p)) continue;
      this.doc.setPage(p);

      // Running header
      let headerTextX = MARGIN_X;
      if (logo) {
        const maxH = 5.5;
        const maxW = 14;
        let drawW = maxH * logo.aspect;
        let drawH = maxH;
        if (drawW > maxW) {
          drawW = maxW;
          drawH = drawW / logo.aspect;
        }
        const drawY = 12 - drawH / 2;
        try {
          this.doc.addImage(logo.dataUrl, 'PNG', MARGIN_X, drawY, drawW, drawH);
          headerTextX = MARGIN_X + drawW + 2.5;
        } catch {
          headerTextX = MARGIN_X;
        }
      }
      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(8);
      this.doc.setTextColor(...COLORS.muted);
      this.doc.text(this.headerTitle, headerTextX, 13.5);
      this.doc.setDrawColor(...COLORS.hairline);
      this.doc.setLineWidth(0.25);
      this.doc.line(MARGIN_X, 16, PAGE_W - MARGIN_X, 16);

      // Running footer
      this.doc.line(MARGIN_X, PAGE_H - 15.5, PAGE_W - MARGIN_X, PAGE_H - 15.5);
      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(8);
      this.doc.setTextColor(...COLORS.muted);
      this.doc.text(this.footerLeft, MARGIN_X, PAGE_H - 10.5);
      this.doc.text(
        `Page ${p} / ${totalPages}`,
        PAGE_W - MARGIN_X,
        PAGE_H - 10.5,
        { align: 'right' },
      );
    }
  }
}

function drawCoverPage(
  builder: EditorialPdfBuilder,
  opts: {
    companyName: string;
    subtitle: string;
    docTitle: string;
    docDescription: string;
    entreprise: Entreprise | null;
    logo: PdfLogoAsset | null;
    highlights: string[];
    lang: Lang;
  },
) {
  const { doc } = builder;
  const year = new Date().getFullYear();

  // Deep editorial navy header block (clean top third)
  doc.setFillColor(...COLORS.ink);
  doc.rect(0, 0, PAGE_W, 112, 'F');

  // Subtle sky hairline rule at bottom of header block
  doc.setFillColor(...COLORS.accent);
  doc.rect(0, 112, PAGE_W, 2.5, 'F');

  // Brand emblem or company logo
  let brandTextX = MARGIN_X + 18;
  let renderedLogo = false;
  if (opts.logo) {
    const boxH = 15;
    const pad = 1.6;
    const innerH = boxH - pad * 2;
    const maxInnerW = 24;
    let drawW = innerH * opts.logo.aspect;
    let drawH = innerH;
    if (drawW > maxInnerW) {
      drawW = maxInnerW;
      drawH = drawW / opts.logo.aspect;
    }
    const boxW = Math.max(15, drawW + pad * 2);
    const boxY = 23;
    try {
      doc.setFillColor(...COLORS.white);
      doc.roundedRect(MARGIN_X, boxY, boxW, boxH, 2.5, 2.5, 'F');
      doc.addImage(
        opts.logo.dataUrl,
        'PNG',
        MARGIN_X + (boxW - drawW) / 2,
        boxY + (boxH - drawH) / 2,
        drawW,
        drawH,
      );
      brandTextX = MARGIN_X + boxW + 5;
      renderedLogo = true;
    } catch {
      renderedLogo = false;
    }
  }
  if (!renderedLogo) {
    doc.setFillColor(...COLORS.accent);
    doc.roundedRect(MARGIN_X, 24, 13, 13, 2.5, 2.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...COLORS.white);
    doc.text('P', MARGIN_X + 6.5, 32.8, { align: 'center' });
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...COLORS.white);
  doc.text(sanitizePdfText(opts.companyName), brandTextX, 30);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(186, 230, 253);
  doc.text(sanitizePdfText(opts.subtitle), brandTextX, 35.8);

  // Main Cover Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.setTextColor(...COLORS.white);
  const titleLines = doc.splitTextToSize(sanitizePdfText(opts.docTitle), CONTENT_W);
  doc.text(titleLines, MARGIN_X, 62);

  // Cover Description
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11.5);
  doc.setTextColor(203, 213, 225);
  const descLines = doc.splitTextToSize(sanitizePdfText(opts.docDescription), CONTENT_W);
  doc.text(descLines, MARGIN_X, 62 + titleLines.length * 11 + 4);

  // Body section below cover band
  let y = 132;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...COLORS.accent);
  doc.text(
    sanitizePdfText(opts.lang === 'fr' ? 'CE QUE COUVRE CE DOCUMENT' : 'WHAT THIS DOCUMENT COVERS'),
    MARGIN_X,
    y,
  );
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(...COLORS.ink);
  for (const item of opts.highlights) {
    const lines = doc.splitTextToSize(sanitizePdfText(item), CONTENT_W - 8);
    doc.setFillColor(...COLORS.accent);
    doc.circle(MARGIN_X + 2, y - 1.2, 1.1, 'F');
    doc.text(lines, MARGIN_X + 7, y);
    y += lines.length * 5.4 + 3.2;
  }

  // Company & Edition Metadata Box at bottom of cover
  const cardY = PAGE_H - 68;
  doc.setFillColor(...COLORS.surface);
  doc.setDrawColor(...COLORS.hairline);
  doc.setLineWidth(0.35);
  doc.roundedRect(MARGIN_X, cardY, CONTENT_W, 38, 2.5, 2.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...COLORS.ink);
  doc.text(sanitizePdfText(opts.companyName), MARGIN_X + 6, cardY + 10);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.muted);
  const contactParts = [
    opts.entreprise?.telephone
      ? `${opts.lang === 'fr' ? 'Tél' : 'Tel'}: ${opts.entreprise.telephone}`
      : null,
    [opts.entreprise?.adresse, opts.entreprise?.ville].filter(Boolean).join(', ') || null,
  ].filter(Boolean);
  if (contactParts.length > 0) {
    doc.text(sanitizePdfText(contactParts.join('  |  ')), MARGIN_X + 6, cardY + 16.5);
  }
  doc.text(
    sanitizePdfText(
      `${opts.lang === 'fr' ? 'Édition mise à jour le' : 'Updated edition'}: ${formatDocDate(opts.lang)}`,
    ),
    MARGIN_X + 6,
    cardY + 23.5,
  );
  doc.text(
    sanitizePdfText(`© ${year} AGASOFT  |  Support : 225 010 220 2062`),
    MARGIN_X + 6,
    cardY + 30.5,
  );
}

/**
 * Generates and immediately downloads the complete, multi-page A4 User Guide PDF.
 */
export async function downloadUserGuidePdf(entreprise: Entreprise | null, lang: Lang): Promise<void> {
  const companyName = entreprise?.nom?.trim() || 'PressingLite';
  const chapters = getUserGuideChapters(lang);
  const roles = getRoleMatrix(lang);
  const specs = getTechnicalSpecs(lang);
  const logo = await loadPdfLogo(entreprise?.logo_url);

  const headerTitle =
    lang === 'fr'
      ? `${companyName} — Guide d'utilisation`
      : `${companyName} — User Guide`;
  const footerLeft = `© ${new Date().getFullYear()} AGASOFT · Support : 225 010 220 2062`;

  const builder = new EditorialPdfBuilder(headerTitle, footerLeft, lang);

  // Page 1: Cover
  drawCoverPage(builder, {
    companyName,
    subtitle:
      lang === 'fr'
        ? 'Logiciel de gestion de pressing & blanchisserie'
        : 'Dry cleaning & laundry management software',
    docTitle:
      lang === 'fr' ? "Guide d'utilisation complet" : 'Complete User Guide',
    docDescription:
      lang === 'fr'
        ? "Manuel opérationnel pas à pas pour les équipes de comptoir, gérants, administrateurs, collecteurs et apporteurs d'affaire."
        : 'Step-by-step operational manual for front-desk staff, managers, administrators, drivers, and referral partners.',
    entreprise,
    logo,
    highlights:
      lang === 'fr'
        ? [
            'Prise en main, installation PWA (mobile & PC) et paramétrage multi-boutiques',
            'Enregistrement rapide des dépôts, recherche 4 000+ clients, reçus A5/80 mm, étiquettes et WhatsApp',
            'Retraits partiels ou totaux, modification du type de traitement, planning et inventaire atelier',
            "Gestion des apporteurs d'affaire, liaison multi-clients sur durée en jours et Portail Apporteur d'affaire par code",
            'Portail Client QR Code, tournées collecte/livraison Google Maps, comptabilité et mode hors-ligne',
          ]
        : [
            'Onboarding, PWA installation (mobile & desktop), and multi-store configuration',
            'Fast deposit intake, 4,000+ client instant search, A5/80 mm receipts, labels, and WhatsApp',
            'Partial/full pickups, editing treatment type on validated deposits, schedule, and inventory',
            'Referral partners, multi-client day-bounded commissions, payouts, and Partner Portal',
            'Client QR Portal, Google Maps pickup/delivery runs, accounting, and offline mode',
          ],
    lang,
  });

  // Page 2: Reserve Table of Contents page (filled once chapter start pages are known)
  builder.addNewPage();
  const tocPageNumber = builder.doc.getNumberOfPages();

  // Pages 3+: Render every chapter and record its exact starting page
  const chapterPages: Array<{ number: string; title: string; subtitle: string; page: number }> = [];

  for (const chapter of chapters) {
    builder.addNewPage();
    chapterPages.push({
      number: chapter.number,
      title: chapter.title,
      subtitle: chapter.subtitle,
      page: builder.doc.getNumberOfPages(),
    });

    builder.drawSectionKicker(
      lang === 'fr' ? `CHAPITRE ${chapter.number}` : `CHAPTER ${chapter.number}`,
      chapter.title,
      chapter.subtitle,
    );
    builder.drawParagraph(chapter.summary, 10, COLORS.ink);

    for (const section of chapter.sections) {
      builder.drawSubHeading(section.heading);
      if (section.intro) {
        builder.drawParagraph(section.intro);
      }
      if (section.steps && section.steps.length > 0) {
        builder.drawNumberedSteps(section.steps);
      }
      if (section.bullets && section.bullets.length > 0) {
        builder.drawBullets(section.bullets);
      }
      if (section.tip) {
        builder.drawTipBox(
          lang === 'fr' ? 'Astuce pratique' : 'Practical tip',
          section.tip,
        );
      }
    }

    // Append role permissions matrix inside Chapter 09 (Team & Roles)
    if (chapter.number === '09') {
      builder.drawSubHeading(
        lang === 'fr' ? 'Synthèse des rôles et autorisations' : 'Roles & permissions summary',
      );
      builder.drawKeyValueTable(
        roles.map((r) => [`${r.role} (${r.scope})`, r.keyActions]),
      );
    }

    // Append technical specifications reference inside Chapter 10
    if (chapter.number === '10') {
      builder.drawSubHeading(
        lang === 'fr' ? 'Fiche technique de référence' : 'Technical reference sheet',
      );
      builder.drawKeyValueTable(specs);
    }
  }

  // Go back to Page 2 and render the exact Table of Contents
  builder.doc.setPage(tocPageNumber);
  builder.y = TOP_Y;
  builder.drawSectionKicker(
    lang === 'fr' ? 'SOMMAIRE' : 'TABLE OF CONTENTS',
    lang === 'fr' ? 'Plan du guide d\'utilisation' : 'User Guide Outline',
    lang === 'fr'
      ? '10 chapitres opérationnels couvrant l\'ensemble des modules du logiciel.'
      : '10 operational chapters covering every module of the software.',
  );

  for (const item of chapterPages) {
    const rowH = 14;
    const y = builder.y;
    builder.doc.setFont('helvetica', 'bold');
    builder.doc.setFontSize(10);
    builder.doc.setTextColor(...COLORS.accent);
    builder.doc.text(item.number, MARGIN_X, y);

    builder.doc.setFont('helvetica', 'bold');
    builder.doc.setFontSize(10.5);
    builder.doc.setTextColor(...COLORS.ink);
    builder.doc.text(sanitizePdfText(item.title), MARGIN_X + 10, y);

    builder.doc.setFont('helvetica', 'bold');
    builder.doc.setFontSize(9.5);
    builder.doc.setTextColor(...COLORS.muted);
    builder.doc.text(`p. ${item.page}`, PAGE_W - MARGIN_X, y, { align: 'right' });

    builder.doc.setFont('helvetica', 'normal');
    builder.doc.setFontSize(8.8);
    builder.doc.setTextColor(...COLORS.muted);
    builder.doc.text(sanitizePdfText(item.subtitle), MARGIN_X + 10, y + 4.8);

    builder.doc.setDrawColor(...COLORS.hairline);
    builder.doc.setLineWidth(0.2);
    builder.doc.line(MARGIN_X, y + 8.5, PAGE_W - MARGIN_X, y + 8.5);
    builder.y += rowH;
  }

  builder.applyRunningHeadersAndFooters([1], logo);

  const slug = slugifyFilename(companyName);
  const fileName =
    lang === 'fr'
      ? `Guide-Utilisation-${slug}.pdf`
      : `User-Guide-${slug}.pdf`;
  builder.doc.save(fileName);
}

/**
 * Generates and downloads an executive A4 Software Presentation PDF brochure.
 */
export async function downloadPresentationPdf(entreprise: Entreprise | null, lang: Lang): Promise<void> {
  const companyName = entreprise?.nom?.trim() || 'PressingLite';
  const modules = getPresentationModules(lang);
  const steps = getWorkflowSteps(lang);
  const roles = getRoleMatrix(lang);
  const specs = getTechnicalSpecs(lang);
  const logo = await loadPdfLogo(entreprise?.logo_url);

  const headerTitle =
    lang === 'fr'
      ? `${companyName} — Présentation du logiciel`
      : `${companyName} — Software Presentation`;
  const footerLeft = `© ${new Date().getFullYear()} AGASOFT · Contact : 225 010 220 2062`;

  const builder = new EditorialPdfBuilder(headerTitle, footerLeft, lang);

  // Page 1: Cover
  drawCoverPage(builder, {
    companyName,
    subtitle:
      lang === 'fr'
        ? 'Présentation officielle de la solution'
        : 'Official product overview',
    docTitle:
      lang === 'fr'
        ? 'Gestion complète de pressing & blanchisserie'
        : 'Complete Dry Cleaning & Laundry Management',
    docDescription:
      lang === 'fr'
        ? "Une plateforme moderne en ligne et hors-ligne pour piloter vos dépôts, retraits, clients, apporteurs d'affaire, tournées de livraison et finances."
        : 'A modern online and offline platform to run your deposits, pickups, customers, referral partners, delivery routes, and finances.',
    entreprise,
    logo,
    highlights:
      lang === 'fr'
        ? [
            'Comptoir ultra-rapide : recherche instantanée sur 4 000+ clients et reçus A5 / ticket 80 mm / WhatsApp',
            "Apporteurs d'affaire & commissions automatiques sur clients liés + Portail Apporteur d'affaire par code",
            'Portail Client QR Code + Collecte & Livraison géolocalisées sur Google Maps',
            'Comptabilité, dépenses, consommables, multi-boutiques et mode hors-ligne garanti',
          ]
        : [
            'High-speed counter: instant 4,000+ client search and A5 / 80 mm / WhatsApp receipts',
            'Referral partners & automated commissions on linked clients + Partner Portal',
            'Client QR Portal + geolocated Google Maps pickup & delivery runs',
            'Accounting, expenses, consumables, multi-store management, and offline-first reliability',
          ],
    lang,
  });

  // Page 2+: Modules overview
  builder.addNewPage();
  builder.drawSectionKicker(
    lang === 'fr' ? 'MODULES CLÉS' : 'CORE MODULES',
    lang === 'fr' ? 'Fonctionnalités principales' : 'Key capabilities',
    lang === 'fr'
      ? 'Chaque module répond aux besoins concrets d\'un pressing moderne, du comptoir à la direction.'
      : 'Every module addresses the daily realities of a modern pressing business, from counter to management.',
  );

  for (let i = 0; i < modules.length; i++) {
    const mod = modules[i];
    builder.ensureSpace(28);
    builder.drawSubHeading(`${String(i + 1).padStart(2, '0')}. ${mod.title} (${mod.category})`);
    builder.drawParagraph(mod.summary, 9.4, COLORS.body);
    builder.drawBullets(mod.highlights);
  }

  // Workflow & Roles
  builder.addNewPage();
  builder.drawSectionKicker(
    lang === 'fr' ? 'MÉTHODE DE TRAVAIL' : 'WORKFLOW',
    lang === 'fr' ? 'Déploiement en 4 étapes' : '4-step operational workflow',
  );
  builder.drawNumberedSteps(steps.map((s) => `${s.title} : ${s.description}`));

  builder.y += 4;
  builder.drawSectionKicker(
    lang === 'fr' ? 'ORGANISATION' : 'TEAM STRUCTURE',
    lang === 'fr' ? 'Rôles & responsabilités' : 'Roles & permissions',
  );
  builder.drawKeyValueTable(roles.map((r) => [`${r.role} (${r.scope})`, r.keyActions]));

  builder.y += 4;
  builder.drawSectionKicker(
    lang === 'fr' ? 'ARCHITECTURE' : 'ARCHITECTURE',
    lang === 'fr' ? 'Caractéristiques techniques' : 'Technical specifications',
  );
  builder.drawKeyValueTable(specs);

  builder.applyRunningHeadersAndFooters([1], logo);

  const slug = slugifyFilename(companyName);
  const fileName =
    lang === 'fr'
      ? `Presentation-Logiciel-${slug}.pdf`
      : `Software-Presentation-${slug}.pdf`;
  builder.doc.save(fileName);
}
