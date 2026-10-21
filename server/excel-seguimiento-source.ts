import ExcelJS from 'exceljs';
import type { SheetCell, SheetValue } from './google-sheets.js';

// Un archivo .xlsx subido tal cual a Drive (sin convertir a Hoja de Google)
// no se puede leer con la API de Sheets -- Google la rechaza con "This
// operation is not supported for this document". Este módulo lee ese mismo
// archivo directamente (ExcelJS) y produce las mismas formas de datos
// (SheetCell[][] / SheetValue[][]) que ya consumen cronograma-parser.ts y
// seguimiento-parsers.ts, para que el resto del pipeline de importación no
// tenga que saber de dónde vinieron los datos.

export const EXCEL_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

export function isExcelMimeType(mimeType: string | null | undefined): boolean {
  return !!mimeType && EXCEL_MIME_TYPES.has(mimeType);
}

export async function loadExcelWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook;
}

function normalizeSheetName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Un archivo Excel no tiene el concepto de "gid" de Google Sheets -- cada
// pestaña se ubica por nombre, igual que ya se hace con las demás pestañas
// fijas (Insumos Detalle, Abono, etc.) en SEGUIMIENTO_SHEET_NAMES.
export function findExcelSheetByName(workbook: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const target = normalizeSheetName(name);
  const exact = workbook.worksheets.find((ws) => normalizeSheetName(ws.name) === target);
  if (exact) return exact;
  const partial = workbook.worksheets.find((ws) => normalizeSheetName(ws.name).indexOf(target) !== -1);
  if (!partial) {
    throw new Error(`No se encontró la pestaña "${name}" en el archivo de Excel. Revisa que exista una pestaña con ese nombre.`);
  }
  return partial;
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MAX_COLS = 100;

function unwrapFormula(value: unknown): unknown {
  if (value && typeof value === 'object' && 'result' in (value as Record<string, unknown>)) {
    return (value as { result: unknown }).result;
  }
  return value;
}

// Texto "como lo vería Sheets" (formattedValue): fechas en dd/mm/yyyy (lo que
// espera la regex de Observaciones en cronograma-parser.ts) y números con
// coma decimal sin separador de miles (lo que espera parseNumber ahí mismo).
function cellDisplayText(cell: ExcelJS.Cell): string {
  const value = unwrapFormula(cell.value);
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    const dd = String(value.getUTCDate()).padStart(2, '0');
    const mm = String(value.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = value.getUTCFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }
  if (typeof value === 'number') return String(value).replace('.', ',');
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'object') {
    const anyValue = value as { richText?: Array<{ text?: string }>; text?: string };
    if (Array.isArray(anyValue.richText)) return anyValue.richText.map((t) => t.text || '').join('');
    if (anyValue.text !== undefined) return String(anyValue.text);
    return '';
  }
  return String(value).trim();
}

// Valor "como lo vería Sheets" con UNFORMATTED_VALUE: fechas como número de
// serie (mismo epoch que serialToIso en seguimiento-parsers.ts) y números
// planos -- lo que ya esperan parseDate/parseNum ahí mismo.
function cellRawValue(cell: ExcelJS.Cell): SheetValue {
  const value = unwrapFormula(cell.value);
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    const serial = (value.getTime() - EXCEL_EPOCH_MS) / 86400000;
    return Math.round(serial * 1e6) / 1e6;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'object') {
    const anyValue = value as { richText?: Array<{ text?: string }>; text?: string };
    if (Array.isArray(anyValue.richText)) return anyValue.richText.map((t) => t.text || '').join('');
    if (anyValue.text !== undefined) return String(anyValue.text);
    return '';
  }
  return String(value);
}

function fillBackgroundHex(cell: ExcelJS.Cell): string | null {
  const fill = cell.fill as ExcelJS.FillPattern | undefined;
  const argb = fill && fill.type === 'pattern' ? fill.fgColor?.argb : undefined;
  if (!argb || argb.length < 6) return '#ffffff';
  const hex = argb.length === 8 ? argb.slice(2) : argb;
  return `#${hex.toLowerCase()}`;
}

export function getExcelGridWithBackgrounds(sheet: ExcelJS.Worksheet, maxRows = 200): SheetCell[][] {
  const rowCount = Math.min(sheet.rowCount, maxRows);
  const colCount = Math.min(Math.max(sheet.columnCount, 1), MAX_COLS);
  const grid: SheetCell[][] = [];
  for (let r = 1; r <= rowCount; r++) {
    const row = sheet.getRow(r);
    const cells: SheetCell[] = [];
    for (let c = 1; c <= colCount; c++) {
      const cell = row.getCell(c);
      cells.push({ text: cellDisplayText(cell), backgroundColor: fillBackgroundHex(cell) });
    }
    grid.push(cells);
  }
  return grid;
}

export function getExcelValues(sheet: ExcelJS.Worksheet, maxRows = 1500): SheetValue[][] {
  const rowCount = Math.min(sheet.rowCount, maxRows);
  const colCount = Math.min(Math.max(sheet.columnCount, 1), MAX_COLS);
  const grid: SheetValue[][] = [];
  for (let r = 1; r <= rowCount; r++) {
    const row = sheet.getRow(r);
    const cells: SheetValue[] = [];
    for (let c = 1; c <= colCount; c++) {
      cells.push(cellRawValue(row.getCell(c)));
    }
    grid.push(cells);
  }
  return grid;
}
