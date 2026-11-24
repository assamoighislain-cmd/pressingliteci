import { useAuth } from '@/lib/auth';
import { mergeBoutiqueHeaderIntoEntreprise, type Entreprise } from '@/types';

export interface ReportColumn {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  width?: string;
  render: (row: Record<string, unknown>) => string;
}

export interface ReportData {
  title: string;
  subtitle?: string;
  entreprise: Entreprise | null;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  summaryRows?: { label: string; value: string; highlight?: boolean }[];
  periodLabel?: string;
}

const ROWS_PER_PAGE = 25;

export function PrintableReport({ data }: { data: ReportData }) {
  const { currentBoutique } = useAuth();
  const { title, subtitle, entreprise: rawEntreprise, columns, rows, summaryRows, periodLabel } = data;
  const entreprise = mergeBoutiqueHeaderIntoEntreprise(rawEntreprise, currentBoutique);
  const totalPages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));

  const pages: Record<string, unknown>[][] = [];
  for (let i = 0; i < rows.length; i += ROWS_PER_PAGE) {
    pages.push(rows.slice(i, i + ROWS_PER_PAGE));
  }
  if (pages.length === 0) pages.push([]);

  return (
    <div className="print-report-container">
      {pages.map((pageRows, pageIdx) => (
        <div key={pageIdx} className="print-report-page">
          {/* Header */}
          <div className="print-report-header">
            {entreprise && (
              <div className="print-report-business">
                <p className="print-report-business-name">{entreprise.nom}</p>
                {entreprise.telephone && <p>Tél: {entreprise.telephone}</p>}
                {(entreprise.adresse || entreprise.ville) && (
                  <p>{[entreprise.adresse, entreprise.ville].filter(Boolean).join(', ')}</p>
                )}
                {entreprise.slogan && <p className="print-report-slogan">{entreprise.slogan}</p>}
              </div>
            )}
            <div className="print-report-title-block">
              <h1 className="print-report-title">{title}</h1>
              {subtitle && <p className="print-report-subtitle">{subtitle}</p>}
              {periodLabel && <p className="print-report-period">{periodLabel}</p>}
              <p className="print-report-date">
                {new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>

          <hr className="print-report-sep" />

          {/* Table */}
          <table className="print-report-table">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    style={{
                      textAlign: col.align ?? 'left',
                      width: col.width,
                    }}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} style={{ textAlign: 'center', padding: '8mm', color: '#999' }}>
                    Aucune donnée
                  </td>
                </tr>
              ) : (
                pageRows.map((row, rowIdx) => (
                  <tr key={rowIdx}>
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        style={{ textAlign: col.align ?? 'left' }}
                      >
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {/* Summary */}
          {summaryRows && summaryRows.length > 0 && pageIdx === pages.length - 1 && (
            <div className="print-report-summary">
              {summaryRows.map((s, i) => (
                <div
                  key={i}
                  className={`print-report-summary-row ${s.highlight ? 'print-report-summary-highlight' : ''}`}
                >
                  <span>{s.label}</span>
                  <span>{s.value}</span>
                </div>
              ))}
            </div>
          )}

          {/* Footer with pagination */}
          <div className="print-report-footer">
            <span>
              {entreprise?.nom ?? ''} — {title}
            </span>
            <span>
              Page {pageIdx + 1} / {totalPages}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function printReport() {
  const styleId = 'dynamic-page-size';
  document.getElementById(styleId)?.remove();

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent =
    '@page { size: A4; margin: 10mm; } @media print { html, body { margin: 0; padding: 0; } }';
  document.head.appendChild(style);

  document.body.classList.add('printing-report');

  const cleanup = () => {
    document.getElementById(styleId)?.remove();
    document.body.classList.remove('printing-report');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  setTimeout(cleanup, 5000);

  window.print();
}
