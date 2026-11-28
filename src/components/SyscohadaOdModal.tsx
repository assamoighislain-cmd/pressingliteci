import { useState, useMemo } from 'react';
import { X, Plus, Trash2, CheckCircle2, AlertCircle, Scale, Sparkles } from 'lucide-react';
import { db } from '@/lib/db';
import {
  SYSCOHADA_PLAN_COMPTABLE,
  SYSCOHADA_JOURNAL_LABELS,
  getSyscohadaAccount,
} from '@/lib/syscohada';
import { formatPrice, type SyscohadaJournalCode, type SyscohadaLigneInput } from '@/types';

interface LineDraft {
  id: string;
  compte: string;
  libelle: string;
  debit: string;
  credit: string;
}

interface QuickTemplate {
  id: string;
  labelFr: string;
  labelEn: string;
  journal: SyscohadaJournalCode;
  libelle: string;
  debitCode: string;
  creditCode: string;
}

const OD_TEMPLATES: QuickTemplate[] = [
  {
    id: 'apport_capital',
    labelFr: 'Apport en capital',
    labelEn: 'Capital contribution',
    journal: 'OD',
    libelle: 'Apport en capital (exploitant / associés)',
    debitCode: '5711',
    creditCode: '1011',
  },
  {
    id: 'achat_materiel',
    labelFr: 'Achat matériel pressing',
    labelEn: 'Equipment purchase',
    journal: 'OD',
    libelle: 'Acquisition matériel de pressing (immobilisation)',
    debitCode: '2411',
    creditCode: '5211',
  },
  {
    id: 'amortissement',
    labelFr: 'Dotation amortissement',
    labelEn: 'Depreciation entry',
    journal: 'OD',
    libelle: 'Dotation aux amortissements du matériel',
    debitCode: '6813',
    creditCode: '2841',
  },
  {
    id: 'virement_interne',
    labelFr: 'Versement caisse -> banque',
    labelEn: 'Cash to bank deposit',
    journal: 'BQ',
    libelle: 'Versement espèces en banque',
    debitCode: '5211',
    creditCode: '5711',
  },
  {
    id: 'prelevement',
    labelFr: 'Prélèvement exploitant',
    labelEn: 'Owner drawing',
    journal: 'OD',
    libelle: "Prélèvement personnel de l'exploitant",
    debitCode: '1041',
    creditCode: '5711',
  },
  {
    id: 'compte_courant',
    labelFr: 'Apport compte courant associé',
    labelEn: 'Shareholder loan advance',
    journal: 'OD',
    libelle: 'Apport en compte courant associé',
    debitCode: '5211',
    creditCode: '4621',
  },
];

function makeLine(compte = '5711', libelle = '', debit = '', credit = ''): LineDraft {
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    compte,
    libelle,
    debit,
    credit,
  };
}

export default function SyscohadaOdModal({
  lang,
  onClose,
  onSaved,
}: {
  lang: 'fr' | 'en';
  onClose: () => void;
  onSaved: (storedLocally: boolean) => void;
}) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [journal, setJournal] = useState<SyscohadaJournalCode>('OD');
  const [numeroPiece, setNumeroPiece] = useState(() => `OD-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}`);
  const [libelle, setLibelle] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([
    makeLine('2411', '', '', ''),
    makeLine('5711', '', '', ''),
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { totalDebit, totalCredit, diff, isBalanced } = useMemo(() => {
    const td = Math.round(lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0) * 100) / 100;
    const tc = Math.round(lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0) * 100) / 100;
    const d = Math.round((td - tc) * 100) / 100;
    return {
      totalDebit: td,
      totalCredit: tc,
      diff: d,
      isBalanced: td > 0 && Math.abs(d) < 0.01,
    };
  }, [lines]);

  function applyTemplate(tpl: QuickTemplate) {
    setJournal(tpl.journal);
    setLibelle(tpl.libelle);
    setLines([
      makeLine(tpl.debitCode, tpl.libelle, '', ''),
      makeLine(tpl.creditCode, tpl.libelle, '', ''),
    ]);
    setError(null);
  }

  function updateLine(id: string, patch: Partial<LineDraft>) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const next = { ...l, ...patch };
        if (patch.debit && parseFloat(patch.debit) > 0) next.credit = '';
        if (patch.credit && parseFloat(patch.credit) > 0) next.debit = '';
        return next;
      }),
    );
  }

  function autoBalanceLastLine() {
    if (lines.length < 2 || Math.abs(diff) < 0.01) return;
    setLines((prev) => {
      const next = [...prev];
      const last = { ...next[next.length - 1] };
      if (diff > 0) {
        const curC = parseFloat(last.credit) || 0;
        last.credit = String(Math.round((curC + diff) * 100) / 100);
        last.debit = '';
      } else {
        const curD = parseFloat(last.debit) || 0;
        last.debit = String(Math.round((curD + Math.abs(diff)) * 100) / 100);
        last.credit = '';
      }
      next[next.length - 1] = last;
      return next;
    });
  }

  async function handleSubmit() {
    setError(null);
    if (!libelle.trim()) {
      setError(lang === 'fr' ? 'Veuillez saisir le libellé de l’écriture.' : 'Please enter the journal entry description.');
      return;
    }
    if (!numeroPiece.trim()) {
      setError(lang === 'fr' ? 'Veuillez saisir un numéro de pièce justificative.' : 'Please enter a voucher / reference number.');
      return;
    }

    const cleanLines: SyscohadaLigneInput[] = [];
    for (const l of lines) {
      const d = Math.round((parseFloat(l.debit) || 0) * 100) / 100;
      const c = Math.round((parseFloat(l.credit) || 0) * 100) / 100;
      if (d <= 0 && c <= 0) continue;
      const acc = getSyscohadaAccount(l.compte);
      cleanLines.push({
        compte: acc.code,
        intitule: acc.intitule,
        libelle: l.libelle.trim() || libelle.trim(),
        debit: d,
        credit: c,
      });
    }

    if (cleanLines.length < 2) {
      setError(lang === 'fr' ? 'Une écriture en partie double requiert au moins 2 lignes mouvementées.' : 'A double-entry posting requires at least 2 lines.');
      return;
    }

    if (!isBalanced) {
      setError(lang === 'fr' ? 'Écriture déséquilibrée : le Total Débit doit être strictement égal au Total Crédit.' : 'Unbalanced entry: Total Debit must equal Total Credit.');
      return;
    }

    setSaving(true);
    try {
      const res = await db.insertEcritureComptable({
        date_ecriture: new Date(`${date}T12:00:00`).toISOString(),
        journal,
        numero_piece: numeroPiece.trim(),
        libelle: libelle.trim(),
        lignes: cleanLines,
        notes: notes.trim() || null,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      onSaved(Boolean(res.storedLocally));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-3xl my-8 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2.5">
            <Scale className="w-5 h-5 text-slate-800" />
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                {lang === 'fr' ? 'Nouvelle écriture comptable (SYSCOHADA)' : 'New Accounting Entry (SYSCOHADA)'}
              </h3>
              <p className="text-xs text-slate-500">
                {lang === 'fr' ? 'Saisie en partie double équilibrée (Débit = Crédit)' : 'Balanced double-entry posting (Debit = Credit)'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[78vh] overflow-y-auto">
          {/* Quick templates */}
          <div>
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 mb-2">
              <Sparkles className="w-3.5 h-3.5 text-slate-500" />
              <span>{lang === 'fr' ? 'Modèles SYSCOHADA rapides :' : 'Quick SYSCOHADA templates:'}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {OD_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => applyTemplate(tpl)}
                  className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 hover:border-slate-300 transition-colors"
                >
                  {lang === 'fr' ? tpl.labelFr : tpl.labelEn}
                </button>
              ))}
            </div>
          </div>

          {/* Entry metadata */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {lang === 'fr' ? 'Date' : 'Date'} *
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {lang === 'fr' ? 'Journal auxiliaire' : 'Journal'} *
              </label>
              <select
                value={journal}
                onChange={(e) => setJournal(e.target.value as SyscohadaJournalCode)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                {(Object.keys(SYSCOHADA_JOURNAL_LABELS) as SyscohadaJournalCode[]).map((code) => (
                  <option key={code} value={code}>
                    {code} — {lang === 'fr' ? SYSCOHADA_JOURNAL_LABELS[code].fr : SYSCOHADA_JOURNAL_LABELS[code].en}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {lang === 'fr' ? 'N° Pièce justificative' : 'Voucher Ref.'} *
              </label>
              <input
                type="text"
                value={numeroPiece}
                onChange={(e) => setNumeroPiece(e.target.value)}
                placeholder="OD-2026-001"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              {lang === 'fr' ? 'Libellé général de l’opération' : 'Entry description'} *
            </label>
            <input
              type="text"
              value={libelle}
              onChange={(e) => setLibelle(e.target.value)}
              placeholder={lang === 'fr' ? 'Ex: Acquisition laveuse industrielle 25kg' : 'Ex: Purchase industrial washer'}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>

          {/* Lines */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <div className="col-span-5">{lang === 'fr' ? 'Compte SYSCOHADA' : 'SYSCOHADA Account'}</div>
              <div className="col-span-3">{lang === 'fr' ? 'Libellé ligne' : 'Line label'}</div>
              <div className="col-span-2 text-right">{lang === 'fr' ? 'Débit' : 'Debit'}</div>
              <div className="col-span-2 text-right">{lang === 'fr' ? 'Crédit' : 'Credit'}</div>
            </div>
            <div className="divide-y divide-slate-100">
              {lines.map((line) => (
                <div key={line.id} className="grid grid-cols-12 gap-2 p-2.5 items-center">
                  <div className="col-span-5">
                    <select
                      value={line.compte}
                      onChange={(e) => updateLine(line.id, { compte: e.target.value })}
                      className="w-full px-2 py-1.5 rounded-md border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
                    >
                      {SYSCOHADA_PLAN_COMPTABLE.map((acc) => (
                        <option key={acc.code} value={acc.code}>
                          {acc.code} — {lang === 'fr' ? acc.intitule : acc.intituleEn}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-3">
                    <input
                      type="text"
                      value={line.libelle}
                      onChange={(e) => updateLine(line.id, { libelle: e.target.value })}
                      placeholder={libelle || (lang === 'fr' ? 'Libellé...' : 'Label...')}
                      className="w-full px-2 py-1.5 rounded-md border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>
                  <div className="col-span-2">
                    <input
                      type="number"
                      min={0}
                      step="100"
                      value={line.debit}
                      onChange={(e) => updateLine(line.id, { debit: e.target.value })}
                      placeholder="0"
                      className="w-full px-2 py-1.5 rounded-md border border-slate-200 text-xs text-right font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>
                  <div className="col-span-2 flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      step="100"
                      value={line.credit}
                      onChange={(e) => updateLine(line.id, { credit: e.target.value })}
                      placeholder="0"
                      className="w-full px-2 py-1.5 rounded-md border border-slate-200 text-xs text-right font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                    {lines.length > 2 && (
                      <button
                        type="button"
                        onClick={() => setLines((prev) => prev.filter((x) => x.id !== line.id))}
                        className="p-1 text-slate-400 hover:text-red-600 transition-colors shrink-0"
                        title={lang === 'fr' ? 'Supprimer la ligne' : 'Remove line'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-3 py-2.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setLines((prev) => [...prev, makeLine('5711', '', '', '')])}
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-950"
              >
                <Plus className="w-3.5 h-3.5" />
                {lang === 'fr' ? 'Ajouter une ligne' : 'Add line'}
              </button>

              <div className="flex items-center gap-4 text-xs tabular-nums">
                <span>
                  {lang === 'fr' ? 'Débit :' : 'Debit:'}{' '}
                  <strong className="font-mono text-slate-900">{formatPrice(totalDebit)}</strong>
                </span>
                <span>
                  {lang === 'fr' ? 'Crédit :' : 'Credit:'}{' '}
                  <strong className="font-mono text-slate-900">{formatPrice(totalCredit)}</strong>
                </span>
                {isBalanced ? (
                  <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {lang === 'fr' ? 'Équilibrée' : 'Balanced'}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={autoBalanceLastLine}
                    className="inline-flex items-center gap-1 text-amber-700 hover:text-amber-900 font-medium underline underline-offset-2"
                  >
                    <AlertCircle className="w-3.5 h-3.5" />
                    {lang === 'fr' ? `Écart ${formatPrice(Math.abs(diff))} (équilibrer)` : `Diff ${formatPrice(Math.abs(diff))} (balance)`}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              {lang === 'fr' ? 'Notes / Référence justificative (optionnel)' : 'Notes / Supporting reference (optional)'}
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={lang === 'fr' ? 'Facture fournisseur, bordereau bancaire...' : 'Invoice no., bank slip...'}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3.5 py-2.5 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
          >
            {lang === 'fr' ? 'Annuler' : 'Cancel'}
          </button>
          <button
            type="button"
            disabled={saving || !isBalanced}
            onClick={handleSubmit}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving
              ? (lang === 'fr' ? 'Enregistrement...' : 'Saving...')
              : (lang === 'fr' ? 'Valider l’écriture' : 'Post entry')}
          </button>
        </div>
      </div>
    </div>
  );
}
