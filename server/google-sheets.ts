// La notación A1 de Sheets exige comillas simples alrededor del nombre de la
// pestaña cuando tiene espacios u otros caracteres especiales (p.ej. el guion
// de "Referencia SubActividad-Linea") — sin esto, la API puede responder con
// "Unable to parse range" para esos nombres.
function quoteSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

async function sheetsRequest<T>(accessToken: string, path: string): Promise<T> {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Google Sheets respondió ${response.status}.`);
  }
  return payload as T;
}

// Encuentra el título real de una pestaña a partir de su gid (Apps Script identifica
// las pestañas por gid en la URL, pero la API de Sheets necesita el título para leerla).
export async function getSheetTitleByGid(accessToken: string, spreadsheetId: string, gid: string | number): Promise<string> {
  const payload = await sheetsRequest<{ sheets: Array<{ properties: { sheetId: number; title: string } }> }>(
    accessToken,
    `${spreadsheetId}?fields=sheets.properties`,
  );
  const sheet = (payload.sheets || []).find((s) => String(s.properties.sheetId) === String(gid));
  if (!sheet) throw new Error(`No se encontró ninguna pestaña con gid ${gid} en esa hoja de cálculo.`);
  return sheet.properties.title;
}

export type SheetCell = { text: string; backgroundColor: string | null };

// Trae valores formateados + color de fondo de cada celda (necesario porque el
// cronograma original marca los rangos de entrega coloreando celdas, no con texto).
export async function getSheetGridWithBackgrounds(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string,
  maxRows = 200,
): Promise<SheetCell[][]> {
  const range = `${quoteSheetTitle(sheetTitle)}!A1:BZ${maxRows}`;
  const fields = 'sheets.data.rowData.values(formattedValue,effectiveFormat.backgroundColor)';
  const payload = await sheetsRequest<{
    sheets: Array<{ data: Array<{ rowData?: Array<{ values?: Array<{ formattedValue?: string; effectiveFormat?: { backgroundColor?: { red?: number; green?: number; blue?: number } } }> }> }> }>;
  }>(accessToken, `${spreadsheetId}?ranges=${encodeURIComponent(range)}&fields=${encodeURIComponent(fields)}`);

  const rowData = payload.sheets?.[0]?.data?.[0]?.rowData || [];
  return rowData.map((row) =>
    (row.values || []).map((cell) => ({
      text: cell.formattedValue || '',
      backgroundColor: rgbToHex(cell.effectiveFormat?.backgroundColor),
    })),
  );
}

export type SheetValue = string | number | boolean;

// Lectura simple de valores (sin formato/colores) para las hojas de datos
// tabulares (Insumos Detalle, Abono, Material Vegetal, etc.) — más liviana
// que getSheetGridWithBackgrounds, que solo hace falta para el Cronograma.
// Se pide UNFORMATTED_VALUE (no texto formateado) para que las fechas y
// números lleguen como los devuelve SpreadsheetApp en Apps Script (números
// de serie / números planos), evitando parsear formato regional de texto.
export async function getSheetValues(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string,
  maxRows = 1500,
): Promise<SheetValue[][]> {
  const range = `${quoteSheetTitle(sheetTitle)}!A1:BZ${maxRows}`;
  const payload = await sheetsRequest<{ values?: SheetValue[][] }>(
    accessToken,
    `${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`,
  );
  return payload.values || [];
}

function rgbToHex(color?: { red?: number; green?: number; blue?: number }): string | null {
  if (!color) return '#ffffff';
  const toByte = (v: number | undefined) => Math.round((v ?? 0) * 255).toString(16).padStart(2, '0');
  return `#${toByte(color.red)}${toByte(color.green)}${toByte(color.blue)}`;
}
