import { useState, useEffect } from 'react';
import { db } from '@/lib/db';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import {
  formatPrice,
  formatDateShort,
  getModeReglementLabel,
  mergeBoutiqueHeaderIntoEntreprise,
  ModeReglement,
  ModeReglementRow,
  Entreprise,
  Boutique,
} from '@/types';
import QRCodeImage from '@/components/QRCodeImage';

export type PrintFormat = 'a5' | 'ticket';

export interface ReceiptData {
  numero: string;
  clientNom: string;
  clientTel: string | null;
  portalCode?: string | null;
  dateDepot: string;
  dateRetraitPrevue: string | null;
  traitement: string;
  coefficient: number;
  modeReglement: ModeReglement | null;
  avanceAmount: number | null;
  total: number;
  totalAvantRemise?: number;
  tauxRemise?: number;
  montantRemise?: number;
  modeReglementRemise?: number;
  modeReglementTauxRemise?: number;
  notes: string | null;
  reglements?: { montant: number; modeReglement: string | null; datePaiement: string }[];
  articles: {
    designation: string;
    quantite: number;
    nb_pieces: number;
    prix_unitaire: number;
    prix_total: number;
    couleur: string | null;
    signe_particulier: string | null;
    griffe: string | null;
  }[];
}

function computeReceiptTotalPaye(data: ReceiptData): number {
  if (data.modeReglement === 'PAYER_DEPOT' || data.modeReglement === 'SOLDE') {
    return data.total;
  }
  if (data.reglements && data.reglements.length > 0) {
    return data.reglements.reduce((sum, r) => sum + Number(r.montant || 0), 0);
  }
  return data.avanceAmount ?? 0;
}

function formatReceiptPaymentModes(data: ReceiptData, modesReglement: ModeReglementRow[]): string {
  if (data.reglements && data.reglements.length > 0) {
    const uniqueLabels = Array.from(
      new Set(
        data.reglements
          .map((r) => (r.modeReglement ? getModeReglementLabel(r.modeReglement, modesReglement) : ''))
          .filter((lbl) => lbl && lbl !== '—'),
      ),
    );
    if (uniqueLabels.length > 0) return uniqueLabels.join(' + ');
  }
  return getModeReglementLabel(data.modeReglement, modesReglement);
}

function TicketReceipt({
  data,
  entreprise,
  modesReglement,
}: {
  data: ReceiptData;
  entreprise: Entreprise | null;
  modesReglement: ModeReglementRow[];
}) {
  const { t, lang } = useI18n();
  const footerMessage = entreprise?.message_pied?.trim() || null;

  const totalPaye = computeReceiptTotalPaye(data);
  const reste = Math.max(0, data.total - totalPaye);
  const totalPieces = data.articles.reduce((sum, a) => sum + a.nb_pieces * a.quantite, 0);

  const dashed = <hr className="ticket-sep" />;
  const double = <hr className="ticket-sep-double" />;

  return (
    <div>
      {/* ── Header: Business info ── */}
      <div className="receipt-header">
        <p className="receipt-title">{entreprise?.nom ?? ''}</p>
        {entreprise?.telephone && (
          <p style={{ fontSize: '17px', fontWeight: 800, margin: 0 }}>
            {lang === 'fr' ? 'Tel' : 'Tel'}: {entreprise.telephone}
          </p>
        )}
        {(entreprise?.adresse || entreprise?.ville) && (
          <p style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>
            {[entreprise?.adresse, entreprise?.ville].filter(Boolean).join(', ')}
          </p>
        )}
        {entreprise?.email && (
          <p style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>{entreprise.email}</p>
        )}
        {entreprise?.slogan && (
          <p style={{ fontSize: '16px', fontWeight: 700, margin: 0, fontStyle: 'italic' }}>{entreprise.slogan}</p>
        )}
      </div>

      {double}

      {/* ── Invoice number ── */}
      <div style={{ textAlign: 'center', fontWeight: 900, fontSize: '20px', letterSpacing: '0.5px' }}>
        {lang === 'fr' ? 'FACTURE' : 'INVOICE'} N° {data.numero}
      </div>

      {dashed}

      {/* ── Client info ── */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 900 }}>{data.clientNom}</span>
          {data.clientTel && <span style={{ fontWeight: 700 }}>{data.clientTel}</span>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px', fontWeight: 700 }}>
          <span>{lang === 'fr' ? 'Depot' : 'Date'}: {formatDateShort(data.dateDepot)}</span>
          <span>{data.traitement}</span>
        </div>
        {data.dateRetraitPrevue && (
          <div style={{ fontSize: '16px', fontWeight: 700 }}>
            {t('retrait.retraitPrevu')}: <span style={{ fontWeight: 900 }}>{formatDateShort(data.dateRetraitPrevue)}</span>
          </div>
        )}
      </div>

      {dashed}

      {/* ── Articles ── */}
      <table>
        <thead>
          <tr style={{ borderBottom: '1px solid #000' }}>
            <th style={{ textAlign: 'left', fontWeight: 900 }}>{t('retrait.articles')}</th>
            <th style={{ textAlign: 'center', fontWeight: 900, width: '24px' }}>Qté</th>
            <th style={{ textAlign: 'right', fontWeight: 900, width: '55px' }}>{lang === 'fr' ? 'Montant' : 'Amount'}</th>
          </tr>
        </thead>
        <tbody>
          {data.articles.map((art, i) => {
            const details = [art.couleur, art.signe_particulier, art.griffe].filter(Boolean);
            return (
              <tr key={i} style={{ borderBottom: '1px dashed rgba(0,0,0,0.3)' }}>
                <td style={{ paddingTop: '1px', paddingBottom: '1px', verticalAlign: 'top' }}>
                  <div>{art.designation}</div>
                  {details.length > 0 && (
                    <div style={{ fontSize: '14px', fontStyle: 'italic', fontWeight: 600 }}>
                      {details.join(' / ')}
                    </div>
                  )}
                </td>
                <td style={{ textAlign: 'center', verticalAlign: 'top', paddingTop: '1px' }}>
                  {art.quantite}
                </td>
                <td style={{ textAlign: 'right', verticalAlign: 'top', whiteSpace: 'nowrap', paddingTop: '1px' }}>
                  {formatPrice(art.prix_total)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '1px solid #000' }}>
            <td style={{ textAlign: 'right', fontWeight: 700, paddingTop: '2px' }} colSpan={2}>
              {lang === 'fr' ? 'Total pièces' : 'Total items'}
            </td>
            <td style={{ textAlign: 'center', fontWeight: 900, paddingTop: '2px' }}>{totalPieces}</td>
          </tr>
        </tfoot>
      </table>

      {double}

      {/* ── Totals ── */}
      <div>
        {data.tauxRemise != null && data.tauxRemise > 0 && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px', fontWeight: 700, marginBottom: '2mm' }}>
              <span>{t('depot.subtotal')}</span>
              <span>{formatPrice(data.totalAvantRemise ?? 0)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px', fontWeight: 700, marginBottom: '2mm' }}>
              <span>{t('depot.discount', { rate: data.tauxRemise })}</span>
              <span>-{formatPrice(data.montantRemise ?? 0)}</span>
            </div>
          </>
        )}
        {data.modeReglementRemise != null && data.modeReglementRemise > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px', fontWeight: 700, marginBottom: '2mm' }}>
            <span>{lang === 'fr' ? `Remise ${data.modeReglementTauxRemise}%` : `Discount ${data.modeReglementTauxRemise}%`}</span>
            <span>-{formatPrice(data.modeReglementRemise)}</span>
          </div>
        )}

        <div className="ticket-total-row" style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2mm' }}>
          <span>TOTAL</span>
          <span>{formatPrice(data.total)}</span>
        </div>

        {dashed}

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px', fontWeight: 700, marginBottom: '2mm' }}>
          <span>{t('retrait.payment')}</span>
          <span style={{ fontWeight: 900 }}>{formatReceiptPaymentModes(data, modesReglement)}</span>
        </div>

        {data.reglements && data.reglements.length > 0 && (
          <>
            {data.reglements.map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px', fontWeight: 700, marginBottom: '2mm' }}>
                <span>
                  {formatDateShort(r.datePaiement)} {r.modeReglement ? getModeReglementLabel(r.modeReglement, modesReglement) : ''}
                </span>
                <span style={{ fontWeight: 900 }}>{formatPrice(r.montant)}</span>
              </div>
            ))}
          </>
        )}

        {dashed}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '18px', fontWeight: 900, marginTop: '2mm' }}>
          <span>{lang === 'fr' ? 'PAYÉ' : 'PAID'}</span>
          <span>{formatPrice(totalPaye)}</span>
        </div>

        {reste > 0 && (
          <>
            {dashed}
            <div className="ticket-reste-row" style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2mm' }}>
              <span>{t('retrait.remaining')}</span>
              <span>{formatPrice(reste)}</span>
            </div>
          </>
        )}
      </div>

      {double}

      {/* ── QR Code ── */}
      <div style={{ textAlign: 'center', margin: '2mm 0' }}>
        <QRCodeImage value={data.numero} size={70} />
      </div>

      {/* ── Footer ── */}
      <div style={{ textAlign: 'center', fontSize: '15px', fontWeight: 700, lineHeight: '1.35' }}>
        {footerMessage ? (
          <p style={{ margin: 0 }}>{footerMessage.replace(/\n/g, ' ')}</p>
        ) : (
          <p style={{ margin: 0 }}>{lang === 'fr' ? 'Merci de votre confiance' : 'Thank you for your trust'}</p>
        )}
        <p style={{ margin: '2px 0 0', fontSize: '14px', fontWeight: 700 }}>
          {lang === 'fr' ? 'Conservez ce ticket pour le retrait' : 'Keep this ticket for pickup'}
        </p>
      </div>

      {/* ── Notes ── */}
      {data.notes && (
        <>
          {dashed}
          <div style={{ fontSize: '15px', fontWeight: 700 }}>
            <span style={{ fontWeight: 900 }}>{t('retrait.notes')}:</span> {data.notes}
          </div>
        </>
      )}

      {/* Bottom spacing for thermal cutter */}
      <div style={{ height: '6mm' }} />
    </div>
  );
}

function A5Receipt({
  data,
  entreprise,
  modesReglement,
}: {
  data: ReceiptData;
  entreprise: Entreprise | null;
  modesReglement: ModeReglementRow[];
}) {
  const { t, lang } = useI18n();
  const footerMessage = entreprise?.message_pied?.trim() || null;

  const totalPaye = computeReceiptTotalPaye(data);
  const reste = Math.max(0, data.total - totalPaye);

  return (
    <div className="a5-inner">
      {/* Header */}
      <div className="receipt-header border-b border-dashed border-slate-300 pb-1 mb-1">
        <p className="receipt-title font-bold">{entreprise?.nom ?? ''}</p>
        {entreprise?.telephone && (
          <p className="text-[1em] text-slate-700 font-semibold">{lang === 'fr' ? 'Tél' : 'Tel'}: {entreprise.telephone}</p>
        )}
        {(entreprise?.adresse || entreprise?.ville) && (
          <p className="text-[1em] text-slate-700 font-semibold">
            {[entreprise?.adresse, entreprise?.ville].filter(Boolean).join(', ')}
          </p>
        )}
        {entreprise?.email && (
          <p className="text-[0.95em] text-slate-700 font-medium">{entreprise.email}</p>
        )}
        {entreprise?.slogan && (
          <p className="text-[1em] text-slate-700 font-semibold">{entreprise.slogan}</p>
        )}
        <p className="text-[1em] text-slate-800 font-bold">{lang === 'fr' ? 'Facture' : 'Invoice'}</p>
        <p className="text-[1em] font-bold mt-0.5">{lang === 'fr' ? 'N°' : 'No.'} {data.numero}</p>
      </div>

      {/* Client + dates */}
      <div className="space-y-0 mb-1 text-[1em]">
        <div className="flex justify-between items-baseline">
          <span className="font-bold">{data.clientNom}</span>
          {data.clientTel && <span className="text-slate-700 font-semibold">{data.clientTel}</span>}
        </div>
        <div className="flex justify-between">
          <span className="text-slate-700 font-semibold">{lang === 'fr' ? 'Déposé le:' : 'Deposited on:'} <span className="font-semibold text-slate-900">{formatDateShort(data.dateDepot)}</span></span>
          <span className="text-slate-700 font-semibold">{t('retrait.retraitPrevu')}: <span className="font-bold text-slate-900">{data.dateRetraitPrevue ? formatDateShort(data.dateRetraitPrevue) : '—'}</span></span>
        </div>
        <div>
          <span className="font-bold">{t('retrait.treatment')}: {data.traitement || '—'}</span>
        </div>
      </div>

      {/* Articles table */}
      <table className="w-full text-[1em] border-collapse mb-1">
        <thead>
          <tr className="border-b border-slate-400">
            <th className="text-left py-0.5 font-bold">{t('retrait.articles')}</th>
            <th className="text-center py-0.5 font-bold">Qté</th>
            <th className="text-right py-0.5 font-bold">PU</th>
            <th className="text-right py-0.5 font-bold">{lang === 'fr' ? 'Montant' : 'Amount'}</th>
          </tr>
        </thead>
        <tbody>
          {data.articles.map((art, i) => {
            const details = [art.couleur, art.signe_particulier, art.griffe].filter(Boolean);
            return (
              <tr key={i} className="border-b border-dashed border-slate-200">
                <td className="py-px align-top">
                  <span>{art.designation}</span>
                  {details.length > 0 && (
                    <span className="text-[0.95em] text-slate-600 italic font-medium"> ({details.join(' / ')})</span>
                  )}
                </td>
                <td className="py-px text-center align-top">{art.quantite}</td>
                <td className="py-px text-right align-top whitespace-nowrap">{formatPrice(art.prix_unitaire)}</td>
                <td className="py-px text-right align-top whitespace-nowrap">{formatPrice(art.prix_total)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-400">
            <td className="py-0.5 font-bold text-right" colSpan={3}>{lang === 'fr' ? 'Total pièces' : 'Total items'}</td>
            <td className="py-0.5 text-center font-bold">{data.articles.reduce((sum, a) => sum + a.nb_pieces * a.quantite, 0)}</td>
          </tr>
        </tfoot>
      </table>

      {/* Totals */}
      <div className="space-y-0 text-[1em] border-t border-slate-400 pt-1 mb-1">
        {data.tauxRemise != null && data.tauxRemise > 0 && (
          <div className="flex justify-between">
            <span className="text-slate-700 font-semibold">{t('depot.subtotal')}</span>
            <span className="text-slate-700 font-semibold">{formatPrice(data.totalAvantRemise ?? 0)}</span>
          </div>
        )}
        {data.tauxRemise != null && data.tauxRemise > 0 && (
          <div className="flex justify-between">
            <span className="text-slate-700 font-semibold">{t('depot.discount', { rate: data.tauxRemise })}</span>
            <span className="text-emerald-700 font-bold">-{formatPrice(data.montantRemise ?? 0)}</span>
          </div>
        )}
        {data.modeReglementRemise != null && data.modeReglementRemise > 0 && (
          <div className="flex justify-between">
            <span className="text-amber-700 font-semibold">{lang === 'fr' ? `Remise ${data.modeReglementTauxRemise}%` : `Discount ${data.modeReglementTauxRemise}%`}</span>
            <span className="text-amber-700 font-bold">-{formatPrice(data.modeReglementRemise)}</span>
          </div>
        )}
        <div className="flex justify-between font-bold">
          <span className="font-bold">{t('depot.total')}</span>
          <span className="font-bold">{formatPrice(data.total)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-700 font-semibold">{t('retrait.payment')}:</span>
          <span className="font-semibold">{formatReceiptPaymentModes(data, modesReglement)}</span>
        </div>
        {data.reglements && data.reglements.length > 0 && (
          <div className="mt-0.5 space-y-0">
            {data.reglements.map((r, i) => (
              <div key={i} className="flex justify-between text-[1em]">
                <span className="text-slate-700 font-medium">
                  {formatDateShort(r.datePaiement)} · {r.modeReglement ? getModeReglementLabel(r.modeReglement, modesReglement) : '—'}
                </span>
                <span className="text-emerald-700 font-bold">{formatPrice(r.montant)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-between font-bold border-t border-slate-400 pt-0.5 mt-0.5">
          <span className="font-bold">{lang === 'fr' ? 'PAYÉ' : 'PAID'}</span>
          <span className="font-bold text-emerald-700">{formatPrice(totalPaye)}</span>
        </div>
        {reste > 0 && (
          <div className="flex justify-between font-bold text-red-700">
            <span className="text-red-700 font-bold">{t('retrait.remaining')}:</span>
            <span className="font-bold">{formatPrice(reste)}</span>
          </div>
        )}
      </div>

      {/* QR Code */}
      <div className="flex justify-center my-2">
        <QRCodeImage value={data.numero} size={70} />
      </div>

      {/* Footer message */}
      <div className="text-center text-[0.85em] text-slate-700 font-medium border-t border-dashed border-slate-400 pt-0.5 mt-1">
        {footerMessage ? (
          <p>{footerMessage.replace(/\n/g, ' ')}</p>
        ) : (
          <p>{lang === 'fr' ? 'Merci de votre confiance — Conservez cette facture pour le retrait' : 'Thank you for your trust — Keep this invoice for pickup'}</p>
        )}
      </div>

      {/* Notes */}
      {data.notes && (
        <div className="border-t border-dashed border-slate-400 pt-0.5 mb-1 text-[1em] mt-1">
          <p className="text-slate-700 font-medium">{t('retrait.notes')}: {data.notes}</p>
        </div>
      )}
    </div>
  );
}

export default function PrintableReceipt({
  data,
  format,
  modesReglement = [],
  entreprise: entrepriseProp,
  boutique: boutiqueProp,
}: {
  data: ReceiptData;
  format: PrintFormat;
  modesReglement?: ModeReglementRow[];
  entreprise?: Entreprise | null;
  boutique?: Boutique | null;
}) {
  const { currentBoutique } = useAuth();
  const [entrepriseState, setEntrepriseState] = useState<Entreprise | null>(null);

  useEffect(() => {
    if (entrepriseProp) {
      setEntrepriseState(entrepriseProp);
      return;
    }
    (async () => {
      setEntrepriseState(await db.getEntreprise());
    })();
  }, [entrepriseProp]);

  const rawEntreprise = entrepriseProp ?? entrepriseState;
  const activeBoutique = boutiqueProp !== undefined ? boutiqueProp : currentBoutique;
  const effectiveEntreprise = mergeBoutiqueHeaderIntoEntreprise(rawEntreprise, activeBoutique);
  const isTicket = format === 'ticket';
  const formatClass = isTicket ? 'print-format-ticket' : 'print-format-a5';

  return (
    <div className="print-receipt">
      <div className={formatClass}>
        {isTicket ? (
          <TicketReceipt data={data} entreprise={effectiveEntreprise} modesReglement={modesReglement} />
        ) : (
          <A5Receipt data={data} entreprise={effectiveEntreprise} modesReglement={modesReglement} />
        )}
      </div>
    </div>
  );
}
