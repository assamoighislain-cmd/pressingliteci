import { DepotWithArticles, formatDateShort } from '@/types';

export interface SerialPrinterConfig {
  baudRate: number;
  charWidth: number;
}

export interface SerialLabelData {
  dateDepot: string;
  numero: string;
  clientNom: string;
  dateRetrait: string;
  designation: string;
  pieceIndex: number;
  pieceTotal: number;
}

const DEFAULT_FIELDS = ['date_depot', 'numero', 'client_nom', 'date_retrait', 'piece_number', 'designation'];

let activePort: SerialPort | null = null;

export function isSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

export function isPrinterConnected(): boolean {
  return activePort !== null && activePort.writable !== null;
}

export async function connectSerialPrinter(baudRate: number): Promise<void> {
  if (!isSerialSupported()) {
    throw new Error('Port série non supporté par ce navigateur. Utilisez Chrome ou Edge.');
  }
  const port = await navigator.serial.requestPort();
  await port.open({ baudRate });
  activePort = port;
}

export async function disconnectSerialPrinter(): Promise<void> {
  if (activePort) {
    try { await activePort.close(); } catch { /* ignore */ }
    activePort = null;
  }
}

export function buildSerialLabelData(depot: DepotWithArticles): SerialLabelData[] {
  const labels: SerialLabelData[] = [];
  for (const art of depot.articles ?? []) {
    const totalPieces = Number(art.nb_pieces ?? 1) * Number(art.quantite ?? 1);
    for (let i = 0; i < totalPieces; i++) {
      labels.push({
        dateDepot: formatDateShort(depot.date_depot),
        numero: depot.numero ?? '—',
        clientNom: depot.client?.nom ?? '—',
        dateRetrait: formatDateShort(depot.date_retrait_prevue),
        designation: art.designation,
        pieceIndex: i + 1,
        pieceTotal: totalPieces,
      });
    }
  }
  return labels;
}

function buildLabelBytes(data: SerialLabelData, fields: string[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];

  const addCmd = (...cmd: number[]) => parts.push(new Uint8Array(cmd));
  const addText = (text: string) => parts.push(encoder.encode(text));

  addCmd(0x1b, 0x40);

  const line1: string[] = [];
  if (fields.includes('date_depot')) line1.push(data.dateDepot);
  if (fields.includes('numero')) line1.push(`N°${data.numero}`);
  if (line1.length > 0) {
    addCmd(0x1b, 0x45, 0x01);
    addText(line1.join('  ') + '\n');
    addCmd(0x1b, 0x45, 0x00);
  }

  if (fields.includes('client_nom')) {
    addText(data.clientNom + '\n');
  }

  if (fields.includes('date_retrait')) {
    addText(`Retrait: ${data.dateRetrait}\n`);
  }

  const line4: string[] = [];
  if (fields.includes('designation')) line4.push(data.designation);
  if (fields.includes('piece_number')) line4.push(`${data.pieceIndex}/${data.pieceTotal}`);
  if (line4.length > 0) {
    if (fields.includes('piece_number')) addCmd(0x1b, 0x45, 0x01);
    addText(line4.join('  ') + '\n');
    if (fields.includes('piece_number')) addCmd(0x1b, 0x45, 0x00);
  }

  addCmd(0x1b, 0x64, 0x03);

  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export async function printLabelsViaSerial(
  labels: SerialLabelData[],
  fields: string[],
  config: SerialPrinterConfig,
): Promise<void> {
  if (!activePort || !activePort.writable) {
    await connectSerialPrinter(config.baudRate);
  }

  if (!activePort || !activePort.writable) {
    throw new Error('Impossible de se connecter à l\'imprimante série');
  }

  const writer = activePort.writable.getWriter();
  try {
    for (const label of labels) {
      const bytes = buildLabelBytes(label, fields);
      await writer.write(bytes);
    }
  } finally {
    writer.releaseLock();
  }
}

export async function printTestLabel(config: SerialPrinterConfig): Promise<void> {
  const testLabel: SerialLabelData = {
    dateDepot: 'TEST',
    numero: 'TEST',
    clientNom: 'Client test',
    dateRetrait: 'TEST',
    designation: 'Article test',
    pieceIndex: 1,
    pieceTotal: 1,
  };
  await printLabelsViaSerial([testLabel], DEFAULT_FIELDS, config);
}
