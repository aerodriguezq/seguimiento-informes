import type { SheetCell } from './google-sheets.js';

export type CronogramaSegment = { start: string; end: string; color: string };
export type CronogramaRow = {
  subActividad: string;
  concepto: string;
  totalToneladas: number | null;
  toneladasRiegoAbono: number | null;
  observaciones: string;
  segments: CronogramaSegment[];
  isResumen: boolean;
};
export type CronogramaPayload = { days: string[]; rows: CronogramaRow[] };

function normalizeHeader(text: string): string {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isSubActividadHeader(text: string): boolean {
  return normalizeHeader(text).replace(/\s+/g, '') === 'subactividad';
}

function normalizeCode(text: string): string {
  return String(text || '').replace(/ /g, ' ').trim();
}

function parseNumber(text: string): number | null {
  const cleaned = String(text || '').replace(/\./g, '').replace(',', '.').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Puerto directo de readCronograma_() del Apps Script original: identifica la fila de
// encabezado buscando "Sub Actividad", ubica las columnas fijas (Concepto, Total
// Toneladas, Riego/Abono, Observaciones), toma como columnas de día las que a la
// derecha tienen un número de 1 a 31, y agrupa el color de fondo de cada celda de
// día en "segmentos" (rango de fechas con ese mismo color).
export function parseCronograma(grid: SheetCell[][], maxDataRows = 150): CronogramaPayload {
  let headerRowIdx = -1;
  let subCol = -1;
  const scanRows = Math.min(grid.length, 10);
  for (let r = 0; r < scanRows && headerRowIdx === -1; r++) {
    const row = grid[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (isSubActividadHeader(row[c]?.text || '')) {
        headerRowIdx = r;
        subCol = c;
        break;
      }
    }
  }
  if (headerRowIdx === -1) return { days: [], rows: [] };

  const headerRow = grid[headerRowIdx] || [];
  let conceptoCol = -1;
  let totalTonCol = -1;
  let riegoAbonoCol = -1;
  let obsCol = -1;
  for (let c = 0; c < headerRow.length; c++) {
    const h = normalizeHeader(headerRow[c]?.text || '');
    if (h === 'concepto') conceptoCol = c;
    else if (h.indexOf('total toneladas') !== -1) totalTonCol = c;
    else if (h.indexOf('riego') !== -1 && h.indexOf('abono') !== -1) riegoAbonoCol = c;
    else if (h.indexOf('observaciones') !== -1) obsCol = c;
  }

  const scanFrom = Math.max(subCol, conceptoCol, totalTonCol, riegoAbonoCol, obsCol) + 1;
  const dayCols: { col: number; day: number }[] = [];
  for (let c = scanFrom; c < headerRow.length; c++) {
    const n = Number(headerRow[c]?.text);
    if (Number.isInteger(n) && n >= 1 && n <= 31) dayCols.push({ col: c, day: n });
  }
  if (!dayCols.length) return { days: [], rows: [] };

  const dataRows = grid.slice(headerRowIdx + 1, headerRowIdx + 1 + maxDataRows);

  let startMonth: number | null = null;
  let startYear: number | null = null;
  const dateRe = /(\d{1,2})\/(\d{1,2})\/(\d{4})/;
  if (obsCol !== -1) {
    for (const row of dataRows) {
      const m = dateRe.exec(String(row[obsCol]?.text || ''));
      if (m) {
        startMonth = parseInt(m[2], 10);
        startYear = parseInt(m[3], 10);
        break;
      }
    }
  }
  if (startMonth === null) {
    const now = new Date();
    startMonth = now.getMonth() + 1;
    startYear = now.getFullYear();
  }

  let curMonth = startMonth as number;
  let curYear = startYear as number;
  let prevDay = -1;
  const days = dayCols.map((d) => {
    if (d.day < prevDay) {
      curMonth++;
      if (curMonth > 12) {
        curMonth = 1;
        curYear++;
      }
    }
    prevDay = d.day;
    const iso = `${curYear}-${String(curMonth).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
    return { col: d.col, date: iso };
  });

  const rows: CronogramaRow[] = [];
  let blankStreak = 0;
  for (const row of dataRows) {
    const subActividad = normalizeCode(row[subCol]?.text || '');
    const concepto = conceptoCol !== -1 ? String(row[conceptoCol]?.text || '').trim() : '';
    if (!subActividad && !concepto) {
      blankStreak++;
      if (blankStreak >= 2) break;
      continue;
    }
    blankStreak = 0;

    const segments: CronogramaSegment[] = [];
    let curColor: string | null = null;
    let segStart: string | null = null;
    for (let j = 0; j < days.length; j++) {
      const cell = row[days[j].col];
      const color = cell?.backgroundColor || '#ffffff';
      const isFilled = color.toLowerCase() !== '#ffffff';
      if (isFilled && color === curColor) {
        // continúa el segmento
      } else {
        if (curColor) segments.push({ start: segStart as string, end: days[j - 1].date, color: curColor });
        if (isFilled) {
          curColor = color;
          segStart = days[j].date;
        } else {
          curColor = null;
          segStart = null;
        }
      }
    }
    if (curColor) segments.push({ start: segStart as string, end: days[days.length - 1].date, color: curColor });

    rows.push({
      subActividad,
      concepto,
      totalToneladas: totalTonCol !== -1 ? parseNumber(row[totalTonCol]?.text || '') : null,
      toneladasRiegoAbono: riegoAbonoCol !== -1 ? parseNumber(row[riegoAbonoCol]?.text || '') : null,
      observaciones: obsCol !== -1 ? String(row[obsCol]?.text || '').trim() : '',
      segments,
      isResumen: !subActividad,
    });
  }

  return { days: days.map((d) => d.date), rows };
}
