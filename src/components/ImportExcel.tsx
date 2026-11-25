import { useState, useRef, useCallback } from 'react';
import { useI18n } from '@/lib/i18n';
import * as XLSX from 'xlsx';
import { Upload, FileSpreadsheet, Check, X, AlertCircle, Loader2 } from 'lucide-react';

export interface ImportColumn {
  key: string;
  label: string;
  required: boolean;
  type?: 'number' | 'string';
  aliases?: string[];
}

export type ImportProgressFn = (current: number, total: number) => void;

export interface ImportConfig {
  entityType: 'clients' | 'articles' | 'traitements' | 'depots';
  columns: ImportColumn[];
  onImport: (rows: Record<string, string | number | null>[], onProgress?: ImportProgressFn) => Promise<{ success: number; errors: string[] }>;
}

interface ParsedRow {
  rowIndex: number;
  data: Record<string, string | number | null>;
  valid: boolean;
  errors: string[];
}

export default function ImportExcel({ config }: { config: ImportConfig }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: number; errors: string[] } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fr = lang === 'fr';

  const handleFile = useCallback((file: File) => {
    setParseError(null);
    setImportResult(null);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!sheet) {
          setParseError(fr ? 'Aucune feuille trouvée dans le fichier.' : 'No sheet found in the file.');
          return;
        }

        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
        if (raw.length === 0) {
          setParseError(fr ? 'Le fichier est vide.' : 'The file is empty.');
          return;
        }

        const firstRow = raw[0];
        const headers = Object.keys(firstRow);
        const headerMap = new Map<string, string>();
        for (const col of config.columns) {
          const candidates = [col.label, ...(col.aliases ?? [])].map((s) => s.trim().toLowerCase());
          // Try exact match first
          let match = headers.find((h) => candidates.includes(h.trim().toLowerCase()));
          // Fall back to partial match (header contains candidate or candidate contains header)
          if (!match) {
            match = headers.find((h) => {
              const hl = h.trim().toLowerCase();
              return candidates.some((c) => hl.includes(c) || c.includes(hl));
            });
          }
          if (match) headerMap.set(col.key, match);
        }

        const rows: ParsedRow[] = raw.map((rawRow, idx) => {
          const rowData: Record<string, string | number | null> = {};
          const rowErrors: string[] = [];

          for (const col of config.columns) {
            const header = headerMap.get(col.key);
            let val: string | number | null = null;
            if (header) {
              const cellVal = rawRow[header];
              if (cellVal != null && cellVal !== '') {
                if (col.type === 'number') {
                  const num = typeof cellVal === 'number' ? cellVal : parseFloat(String(cellVal).replace(/\s/g, '').replace(',', '.'));
                  val = isNaN(num) ? null : num;
                } else {
                  val = String(cellVal).trim();
                }
              }
            }
            rowData[col.key] = val;

            if (col.required && (val == null || val === '')) {
              rowErrors.push(fr ? `${col.label} manquant` : `Missing ${col.label}`);
            }
          }

          return { rowIndex: idx + 2, data: rowData, valid: rowErrors.length === 0, errors: rowErrors };
        });

        setParsedRows(rows);
      } catch {
        setParseError(fr ? 'Impossible de lire le fichier. Vérifiez le format.' : 'Could not read the file. Check the format.');
      }
    };
    reader.readAsArrayBuffer(file);
  }, [config, fr]);

  async function handleImport() {
    const validRows = parsedRows.filter((r) => r.valid).map((r) => r.data);
    if (validRows.length === 0) return;

    setImporting(true);
    setProgress({ current: 0, total: validRows.length });
    try {
      const result = await config.onImport(validRows, (current, total) => {
        setProgress({ current, total });
      });
      setImportResult(result);
      if (result.errors.length === 0) {
        setParsedRows([]);
        setFileName('');
      }
    } catch {
      setImportResult({ success: 0, errors: [fr ? 'Erreur lors de l\'import' : 'Import error'] });
    } finally {
      setImporting(false);
    }
  }

  function reset() {
    setOpen(false);
    setParsedRows([]);
    setFileName('');
    setImportResult(null);
    setParseError(null);
    setProgress(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  const validCount = parsedRows.filter((r) => r.valid).length;
  const invalidCount = parsedRows.length - validCount;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-50 text-emerald-700 text-sm font-medium hover:bg-emerald-100 transition-colors flex-shrink-0"
      >
        <Upload className="w-4 h-4" /> <span className="hidden sm:inline">{fr ? 'Importer Excel' : 'Import Excel'}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" onClick={() => { if (!importing) reset(); }}>
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                  <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">{fr ? 'Importer depuis Excel' : 'Import from Excel'}</h3>
                  <p className="text-xs text-slate-400">
                    {config.columns.filter((c) => c.required).map((c) => c.label).join('*, *')}{config.columns.some((c) => c.required) ? '*' : ''}
                  </p>
                </div>
              </div>
              <button onClick={reset} disabled={importing} className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-4 overflow-y-auto flex-1 space-y-4">
              {importResult ? (
                <div className="space-y-3">
                  <div className={`rounded-xl p-4 ${importResult.success > 0 ? 'bg-emerald-50 border border-emerald-100' : 'bg-red-50 border border-red-100'}`}>
                    <div className="flex items-center gap-2">
                      {importResult.success > 0 ? <Check className="w-5 h-5 text-emerald-600" /> : <AlertCircle className="w-5 h-5 text-red-500" />}
                      <p className="text-sm font-semibold text-slate-900">
                        {fr ? `${importResult.success} ligne(s) importée(s)` : `${importResult.success} row(s) imported`}
                      </p>
                    </div>
                    {importResult.errors.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {importResult.errors.slice(0, 50).map((e, i) => (
                          <li key={i} className="text-xs text-red-600 flex items-start gap-1">
                            <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" /> {e}
                          </li>
                        ))}
                        {importResult.errors.length > 50 && (
                          <li className="text-xs text-red-500 font-medium pt-1">
                            {fr
                              ? `… et ${importResult.errors.length - 50} autre(s) erreur(s)`
                              : `… and ${importResult.errors.length - 50} more error(s)`}
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                  <button onClick={reset} className="w-full py-2.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 transition-colors">
                    {fr ? 'Fermer' : 'Close'}
                  </button>
                </div>
              ) : parsedRows.length === 0 ? (
                <>
                  <div
                    onClick={() => fileRef.current?.click()}
                    className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center cursor-pointer hover:border-emerald-300 hover:bg-emerald-50/30 transition-all"
                  >
                    <Upload className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                    <p className="text-sm font-medium text-slate-600">
                      {fr ? 'Cliquez pour sélectionner un fichier' : 'Click to select a file'}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">.xlsx, .xls, .csv</p>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFile(file);
                      }}
                    />
                  </div>

                  {parseError && (
                    <div className="rounded-lg bg-red-50 border border-red-100 p-3 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-red-600">{parseError}</p>
                    </div>
                  )}

                  <div className="rounded-lg bg-slate-50 border border-slate-100 p-4">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                      {fr ? 'Colonnes attendues' : 'Expected columns'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {config.columns.map((col) => (
                        <span key={col.key} className="text-xs px-2 py-1 rounded-md bg-white border border-slate-200 text-slate-600">
                          {col.label}{col.required ? ' *' : ''}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-slate-400 mt-2">
                      {fr ? '* Champs obligatoires. Les en-têtes peuvent être en français ou anglais.' : '* Required fields. Headers can be in French or English.'}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                      <span className="text-sm font-medium text-slate-700">{fileName}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-emerald-600 font-medium">{validCount} {fr ? 'valides' : 'valid'}</span>
                      {invalidCount > 0 && <span className="text-red-500 font-medium">{invalidCount} {fr ? 'erreurs' : 'errors'}</span>}
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-slate-100">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100">
                          <th className="px-3 py-2 text-left text-xs font-medium text-slate-400">#</th>
                          {config.columns.map((col) => (
                            <th key={col.key} className="px-3 py-2 text-left text-xs font-medium text-slate-400">{col.label}</th>
                          ))}
                          <th className="px-3 py-2 text-left text-xs font-medium text-slate-400">{fr ? 'Statut' : 'Status'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {parsedRows.slice(0, 50).map((row) => (
                          <tr key={row.rowIndex} className={row.valid ? '' : 'bg-red-50/40'}>
                            <td className="px-3 py-2 text-xs text-slate-400">{row.rowIndex}</td>
                            {config.columns.map((col) => (
                              <td key={col.key} className="px-3 py-2 text-xs text-slate-600">
                                {row.data[col.key] ?? '—'}
                              </td>
                            ))}
                            <td className="px-3 py-2">
                              {row.valid ? (
                                <span className="text-xs text-emerald-600 flex items-center gap-1"><Check className="w-3 h-3" /> OK</span>
                              ) : (
                                <span className="text-xs text-red-500" title={row.errors.join(', ')}>
                                  {row.errors[0]}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {parsedRows.length > 50 && (
                    <p className="text-xs text-slate-400 text-center">
                      {fr ? `50 lignes affichées sur ${parsedRows.length}` : `50 rows shown of ${parsedRows.length}`}
                    </p>
                  )}
                </>
              )}
            </div>

            {parsedRows.length > 0 && !importResult && (
              <div className="px-6 py-4 border-t border-slate-100 space-y-3">
                {importing && progress && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500 font-medium">
                        {fr ? 'Importation en cours…' : 'Importing…'} {progress.current}/{progress.total}
                      </span>
                      <span className="text-emerald-600 font-semibold">
                        {progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all duration-300 ease-out"
                        style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3">
                  <button
                    onClick={() => { setParsedRows([]); setFileName(''); if (fileRef.current) fileRef.current.value = ''; }}
                    disabled={importing}
                    className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {fr ? 'Changer de fichier' : 'Change file'}
                  </button>
                  <button
                    onClick={handleImport}
                    disabled={importing || validCount === 0}
                    className="flex items-center gap-2 px-5 py-2 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {fr ? `Importer ${validCount} ligne(s)` : `Import ${validCount} row(s)`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
