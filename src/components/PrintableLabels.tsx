import { useState, useEffect } from 'react';
import { DepotWithArticles, formatDateShort } from '@/types';

export type LabelField = 'date_depot' | 'numero' | 'client_nom' | 'date_retrait' | 'piece_number' | 'designation';

export const ALL_LABEL_FIELDS: LabelField[] = ['date_depot', 'numero', 'client_nom', 'date_retrait', 'piece_number', 'designation'];

export const DEFAULT_LABEL_FIELDS: LabelField[] = ['date_depot', 'numero', 'client_nom', 'date_retrait', 'piece_number', 'designation'];

interface PrintableLabelsProps {
  depot: DepotWithArticles;
  entreprise?: { label_fields?: string[] | null; logo_url?: string | null } | null;
  labelFields?: LabelField[];
}

interface LabelItem {
  designation: string;
  pieceIndex: number;
  pieceTotal: number;
}

export default function PrintableLabels({ depot, entreprise, labelFields }: PrintableLabelsProps) {
  const [logoFailed, setLogoFailed] = useState(false);
  const logoSrc = entreprise?.logo_url?.trim() || null;

  useEffect(() => {
    setLogoFailed(false);
    if (!logoSrc) return;
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.src = logoSrc;
  }, [logoSrc]);

  const fields: LabelField[] = labelFields
    ?? (entreprise?.label_fields as LabelField[] | undefined)
    ?? DEFAULT_LABEL_FIELDS;

  const show = (f: LabelField) => fields.includes(f);

  const labels: LabelItem[] = [];
  for (const art of depot.articles ?? []) {
    const totalPieces = Number(art.nb_pieces ?? 1) * Number(art.quantite ?? 1);
    for (let i = 0; i < totalPieces; i++) {
      labels.push({
        designation: art.designation,
        pieceIndex: i + 1,
        pieceTotal: totalPieces,
      });
    }
  }

  if (labels.length === 0) return null;

  const dateStr = formatDateShort(depot.date_depot);
  const numero = depot.numero ?? '—';
  const clientNom = depot.client?.nom ?? '—';
  const dateRetrait = formatDateShort(depot.date_retrait_prevue);

  return (
    <div className="print-labels">
      {labels.map((label, idx) => (
        <div key={idx} className="label-card">
          {logoSrc && !logoFailed && (
            <img
              src={logoSrc}
              alt=""
              className="label-logo"
              referrerPolicy="no-referrer"
              onError={() => setLogoFailed(true)}
            />
          )}
          {show('date_depot') && <span className="label-date">{dateStr}</span>}
          {show('numero') && <span className="label-numero">{numero}</span>}
          {show('client_nom') && <span className="label-client">{clientNom}</span>}
          {show('date_retrait') && <span className="label-retrait">{dateRetrait}</span>}
          {show('designation') && <span className="label-article">{label.designation}</span>}
          {show('piece_number') && <span className="label-piece">{label.pieceIndex}/{label.pieceTotal}</span>}
        </div>
      ))}
    </div>
  );
}
