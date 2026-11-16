import type { PrintFormat } from '@/components/PrintableReceipt';
import type { DepotWithArticles, Entreprise } from '@/types';
import {
  buildSerialLabelData,
  printLabelsViaSerial,
  connectSerialPrinter,
  isSerialSupported,
  isPrinterConnected,
} from '@/lib/serialPrinter';

const DEFAULT_LABEL_FIELDS = ['date_depot', 'numero', 'client_nom', 'date_retrait', 'piece_number', 'designation'];

export function printLabels() {
  const styleId = 'dynamic-page-size';
  document.getElementById(styleId)?.remove();

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = '@page { size: 100mm auto; margin: 2mm; } @media print { html, body { margin: 0; padding: 0; } }';
  document.head.appendChild(style);

  document.body.classList.add('printing-labels');

  const cleanup = () => {
    document.getElementById(styleId)?.remove();
    document.body.classList.remove('printing-labels');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  setTimeout(cleanup, 5000);

  window.print();
}

export async function printDepotLabels(
  depot: DepotWithArticles,
  entreprise: Entreprise | null,
): Promise<{ error: string | null }> {
  const printerType = entreprise?.label_printer_type ?? 'browser';
  const fields = entreprise?.label_fields ?? DEFAULT_LABEL_FIELDS;

  if (printerType === 'serial') {
    if (!isSerialSupported()) {
      return { error: 'Port série non supporté par ce navigateur. Utilisez Chrome ou Edge.' };
    }
    try {
      const config = entreprise?.label_printer_config ?? { baudRate: 9600 };
      if (!isPrinterConnected()) {
        await connectSerialPrinter(config.baudRate ?? 9600);
      }
      const labels = buildSerialLabelData(depot);
      await printLabelsViaSerial(labels, fields, {
        baudRate: config.baudRate ?? 9600,
        charWidth: config.charWidth ?? 32,
      });
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Erreur impression série' };
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 100));
  printLabels();
  return { error: null };
}

export function printWithFormat(format: PrintFormat) {
  const styleId = 'dynamic-page-size';
  document.getElementById(styleId)?.remove();

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent =
    format === 'a5'
      ? '@page { size: 148mm 210mm; margin: 0; } @media print { html, body { width: 148mm; height: 210mm; overflow: hidden; margin: 0; padding: 0; } }'
      : '@page { size: 80mm auto; margin: 0; }';
  document.head.appendChild(style);

  document.body.classList.add('printing-receipt');

  const cleanup = () => {
    document.getElementById(styleId)?.remove();
    document.body.classList.remove('printing-receipt');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  setTimeout(cleanup, 5000);

  window.print();
}
