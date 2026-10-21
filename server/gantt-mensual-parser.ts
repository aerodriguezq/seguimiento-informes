import type { SheetValue } from './google-sheets.js';

// Formato "Gantt Físico-Financiero" (ej. San Jacinto): muy distinto del
// Cronograma por día (1-31) + Insumos/Abono/Material Vegetal de Montes de
// Maria. Acá cada subactividad ocupa 2 filas (Plan y Ejec), agrupadas bajo
// una "Actividad", con una columna por MES (no por día) y una Meta total.
// GANTT FINANCIERO repite la misma estructura con una columna extra "Valor
// Unitario" -- en vez de leer sus columnas de mes (son fórmulas que cruzan
// con GANTT FÍSICO y a menudo no traen el resultado cacheado cuando da 0),
// se usa solo su Valor Unitario y se multiplica por los meses de Físico.

export type GanttSubactividad = {
  actividad: string;
  descripcion: string;
  subActividad: string;
  meta: number;
  unidad: string;
  plan: number[];
  ejecutado: number[];
};
export type GanttMensualPayload = { meses: string[]; subactividades: GanttSubactividad[] };

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

function normalizeHeader(text: SheetValue | undefined): string {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function serialToMonthIso(value: SheetValue | undefined): string | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = EXCEL_EPOCH_MS + Math.round(n) * 86400000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toISOString().slice(0, 7)}-01`;
}

function toNum(value: SheetValue | undefined): number {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

type HeaderInfo = {
  headerRowIdx: number;
  actividadCol: number;
  descripcionCol: number;
  subActividadCol: number;
  metaCol: number;
  unidadCol: number;
  valorUnitarioCol: number;
};

function findHeader(grid: SheetValue[][]): HeaderInfo | null {
  const scanRows = Math.min(grid.length, 10);
  for (let r = 0; r < scanRows; r++) {
    const row = grid[r] || [];
    let actividadCol = -1;
    let subActividadCol = -1;
    let metaCol = -1;
    for (let c = 0; c < row.length; c++) {
      const h = normalizeHeader(row[c]);
      if (h === 'actividad') actividadCol = c;
      else if (h === 'sub actividad') subActividadCol = c;
      else if (h === 'meta') metaCol = c;
    }
    if (actividadCol !== -1 && subActividadCol !== -1 && metaCol !== -1) {
      let descripcionCol = -1;
      let unidadCol = -1;
      let valorUnitarioCol = -1;
      for (let c = 0; c < row.length; c++) {
        const h = normalizeHeader(row[c]);
        if (h === 'descripcion' && descripcionCol === -1) descripcionCol = c;
        else if (h === 'unidad de medida') unidadCol = c;
        else if (h === 'valor unitario') valorUnitarioCol = c;
      }
      return { headerRowIdx: r, actividadCol, descripcionCol, subActividadCol, metaCol, unidadCol, valorUnitarioCol };
    }
  }
  return null;
}

// true si el grid tiene pinta de "Gantt mensual" (Actividad/Sub
// Actividad/Meta + una columna "Plan"/"Ejec" justo antes de Actividad) --
// se usa para decidir si este archivo usa este formato o el Cronograma por
// día de siempre, sin que el usuario tenga que elegirlo a mano.
export function looksLikeGanttMensual(grid: SheetValue[][]): boolean {
  const header = findHeader(grid);
  if (!header) return false;
  const markerCol = header.actividadCol - 1;
  if (markerCol < 0) return false;
  for (let r = header.headerRowIdx + 1; r < Math.min(grid.length, header.headerRowIdx + 20); r++) {
    const marker = normalizeHeader((grid[r] || [])[markerCol]);
    if (marker === 'plan') return true;
  }
  return false;
}

export function parseGanttMensual(grid: SheetValue[][]): GanttMensualPayload | null {
  const header = findHeader(grid);
  if (!header) return null;
  const { headerRowIdx, actividadCol, descripcionCol, subActividadCol, metaCol, unidadCol, valorUnitarioCol } = header;
  const markerCol = actividadCol - 1;
  if (markerCol < 0) return null;

  const lastFixedCol = Math.max(actividadCol, descripcionCol, subActividadCol, metaCol, unidadCol, valorUnitarioCol);
  const headerRow = grid[headerRowIdx] || [];
  const monthCols: { col: number; iso: string }[] = [];
  for (let c = lastFixedCol + 1; c < headerRow.length; c++) {
    const iso = serialToMonthIso(headerRow[c]);
    if (iso) monthCols.push({ col: c, iso });
    else if (monthCols.length > 0) break;
  }
  if (monthCols.length === 0) return null;

  const subactividades: GanttSubactividad[] = [];
  let lastActividad = '';
  let lastDescripcion = '';
  let lastSub = '';
  let lastMeta = 0;
  let lastUnidad = '';

  for (let r = headerRowIdx + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    const marker = normalizeHeader(row[markerCol]);
    if (marker !== 'plan' && !marker.startsWith('ejec')) continue;

    const actividad = String(row[actividadCol] ?? '').trim() || lastActividad;
    const descripcion = descripcionCol !== -1 ? (String(row[descripcionCol] ?? '').trim() || lastDescripcion) : '';
    const subActividad = String(row[subActividadCol] ?? '').trim() || lastSub;
    const metaRaw = row[metaCol];
    const meta = metaRaw !== undefined && metaRaw !== null && metaRaw !== '' ? toNum(metaRaw) : lastMeta;
    const unidad = unidadCol !== -1 ? (String(row[unidadCol] ?? '').trim() || lastUnidad) : '';
    lastActividad = actividad;
    lastDescripcion = descripcion;
    lastSub = subActividad;
    lastMeta = meta;
    lastUnidad = unidad;

    if (marker === 'plan') {
      subactividades.push({
        actividad,
        descripcion,
        subActividad,
        meta,
        unidad,
        plan: monthCols.map((m) => toNum(row[m.col])),
        ejecutado: [],
      });
    } else {
      const current = subactividades[subactividades.length - 1];
      if (current && current.subActividad === subActividad) {
        current.ejecutado = monthCols.map((m) => toNum(row[m.col]));
      }
    }
  }

  return {
    meses: monthCols.map((m) => m.iso),
    subactividades: subactividades.filter((s) => s.ejecutado.length > 0),
  };
}

// GANTT FINANCIERO: solo interesa su "Valor Unitario" por subactividad (sus
// propias columnas de mes son fórmulas sin encabezado de fecha y con el
// resultado cacheado a menudo ausente cuando da 0) -- se calcula el Plan y
// Ejecutado financiero multiplicando los de Físico por este valor.
export function extractValorUnitarioPorSubactividad(grid: SheetValue[][]): Array<{ subActividad: string; valorUnitario: number | null }> | null {
  const header = findHeader(grid);
  if (!header || header.valorUnitarioCol === -1) return null;
  const { headerRowIdx, actividadCol, subActividadCol, valorUnitarioCol } = header;
  const markerCol = actividadCol - 1;
  if (markerCol < 0) return null;

  const out: Array<{ subActividad: string; valorUnitario: number | null }> = [];
  let lastSub = '';
  let lastVu: number | null = null;
  for (let r = headerRowIdx + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    if (normalizeHeader(row[markerCol]) !== 'plan') continue;
    const subActividad = String(row[subActividadCol] ?? '').trim() || lastSub;
    const vuRaw = row[valorUnitarioCol];
    const valorUnitario = vuRaw !== undefined && vuRaw !== null && vuRaw !== '' ? toNum(vuRaw) : lastVu;
    lastSub = subActividad;
    lastVu = valorUnitario;
    out.push({ subActividad, valorUnitario });
  }
  return out;
}

// Deriva el Gantt Financiero a partir del Físico ya parseado + el Valor
// Unitario por fila de GANTT FINANCIERO (emparejados por posición, como
// hacen las propias fórmulas del archivo original, que referencian la
// misma fila de la otra pestaña).
export function deriveGanttFinanciero(
  fisico: GanttMensualPayload,
  valorUnitarioPorFila: Array<{ subActividad: string; valorUnitario: number | null }>,
): GanttMensualPayload {
  const subactividades = fisico.subactividades.map((s, i) => {
    const match = valorUnitarioPorFila[i];
    const vu = match && match.subActividad === s.subActividad ? match.valorUnitario : null;
    const factor = vu ?? 0;
    return {
      actividad: s.actividad,
      descripcion: s.descripcion,
      subActividad: s.subActividad,
      meta: s.meta * factor,
      unidad: 'COP',
      plan: s.plan.map((v) => v * factor),
      ejecutado: s.ejecutado.map((v) => v * factor),
    };
  });
  return { meses: fisico.meses, subactividades };
}
