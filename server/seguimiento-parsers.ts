import type { SheetValue } from './google-sheets.js';

type Grid = SheetValue[][];

function normalizeHeader(text: SheetValue | undefined): string {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function findExact(headers: string[], name: string): number {
  const target = normalizeHeader(name);
  return headers.findIndex((h) => normalizeHeader(h) === target);
}

function findContains(headers: string[], ...terms: string[]): number {
  const normTerms = terms.map((t) => normalizeHeader(t));
  return headers.findIndex((h) => {
    const nh = normalizeHeader(h);
    return normTerms.every((t) => nh.indexOf(t) !== -1);
  });
}

// Como findExact, pero si no hay match exacto reintenta comparando sin NINGÚN
// espacio (no solo colapsando espacios repetidos) — la hoja real tiene
// "Subactividad" (una palabra) en unas pestañas y "Sub Actividad" (dos
// palabras) en otras, y esto tolera esa variación sin dejar de exigir match
// exacto cuando el nombre coincide tal cual.
function findExactFlexible(headers: string[], name: string): number {
  const exact = findExact(headers, name);
  if (exact !== -1) return exact;
  const target = normalizeHeader(name).replace(/\s+/g, '');
  return headers.findIndex((h) => normalizeHeader(h).replace(/\s+/g, '') === target);
}

// Los números de serie de fecha de Sheets/Excel cuentan días desde el
// 30-dic-1899 — así llegan las fechas con valueRenderOption=UNFORMATTED_VALUE,
// igual que SpreadsheetApp las entrega como Date en Apps Script.
function serialToIso(serial: number): string {
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function parseDate(value: SheetValue | undefined): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return serialToIso(value);
  const t = String(value).trim();
  if (!t) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

export function parseNum(value: SheetValue | undefined): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return value;
  const n = Number(String(value).replace(/\./g, '').replace(',', '.').trim());
  return Number.isFinite(n) ? n : null;
}

function isFilled(value: SheetValue | undefined): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function withHeaders(grid: Grid) {
  const headerRow = (grid[0] || []).map((h) => String(h ?? ''));
  const rows = grid.slice(1);
  return { headerRow, rows };
}

export type PistaAgg = {
  fechaInicio: string | null;
  fechaFin: string | null;
  total: number;
  entregado: number;
  toneladas: number | null;
  hectareas: number | null;
};

function emptyAgg(): PistaAgg {
  return { fechaInicio: null, fechaFin: null, total: 0, entregado: 0, toneladas: null, hectareas: null };
}

function extendRange(agg: PistaAgg, iso: string | null) {
  if (!iso) return;
  if (!agg.fechaInicio || iso < agg.fechaInicio) agg.fechaInicio = iso;
  if (!agg.fechaFin || iso > agg.fechaFin) agg.fechaFin = iso;
}

// Referencia SubActividad-Linea: qué Línea Productiva le corresponde a cada
// código de Subactividad — la llave que cruza el Cronograma con Abono,
// Material Vegetal, Entrega Insumos e Insumos Detalle.
export function parseReferenciaLineas(grid: Grid): Record<string, string> {
  const { headerRow, rows } = withHeaders(grid);
  const subCol = findExactFlexible(headerRow, 'Sub Actividad');
  const lineaCol = findExact(headerRow, 'Línea Productiva');
  if (subCol === -1 || lineaCol === -1) {
    throw new Error('No se encontraron las columnas "Sub Actividad" y "Línea Productiva" en la pestaña Referencia SubActividad-Linea.');
  }
  const map: Record<string, string> = {};
  for (const row of rows) {
    const sub = String(row[subCol] ?? '').trim();
    const linea = String(row[lineaCol] ?? '').trim();
    if (sub && linea) map[sub] = linea;
  }
  return map;
}

// Insumos Detalle: un renglón por insumo entregado. Alimenta la pista
// "Proveeduría" (dos segmentos: Compra y Entrega) de cada Línea Productiva.
export function parseInsumosDetalle(grid: Grid): { compra: Record<string, PistaAgg>; entrega: Record<string, PistaAgg> } {
  const { headerRow, rows } = withHeaders(grid);
  const lineaCol = findExact(headerRow, 'Linea productiva');
  const compraCol = findExact(headerRow, 'Fecha de compra');
  const entregaCol = findExact(headerRow, 'Fecha de entrega');
  const llegoCol = findExact(headerRow, 'Llego');
  if (lineaCol === -1) throw new Error('No se encontró la columna "Linea productiva" en la pestaña Insumos Detalle.');

  const compra: Record<string, PistaAgg> = {};
  const entrega: Record<string, PistaAgg> = {};
  for (const row of rows) {
    const linea = String(row[lineaCol] ?? '').trim();
    if (!linea) continue;
    if (!compra[linea]) compra[linea] = emptyAgg();
    if (!entrega[linea]) entrega[linea] = emptyAgg();
    compra[linea].total++;
    entrega[linea].total++;
    const llegado = llegoCol !== -1 && /^s(i|í)$/i.test(String(row[llegoCol] ?? '').trim());
    if (llegado) {
      compra[linea].entregado++;
      entrega[linea].entregado++;
    }
    extendRange(compra[linea], compraCol !== -1 ? parseDate(row[compraCol]) : null);
    extendRange(entrega[linea], entregaCol !== -1 ? parseDate(row[entregaCol]) : null);
  }
  return { compra, entrega };
}

// Abono: un renglón por beneficiario. Entregado = fila con la fecha
// programada llena (sin depender de ninguna columna de "Estado").
export function parseAbono(grid: Grid): Record<string, PistaAgg> {
  const { headerRow, rows } = withHeaders(grid);
  const lineaCol = findContains(headerRow, 'linea productiva');
  let fechaCol = findExact(headerRow, 'Fecha Programada de entrega de Abono');
  if (fechaCol === -1) fechaCol = findContains(headerRow, 'fecha programada', 'entrega');
  const kgCol = findExact(headerRow, 'ABONO ORGANICO (KG)');
  const haCol = findContains(headerRow, 'area asignada');
  if (lineaCol === -1) throw new Error('No se encontró la columna "Línea Productiva Asignada" en la pestaña Abono.');

  const byLinea: Record<string, PistaAgg> = {};
  for (const row of rows) {
    const linea = String(row[lineaCol] ?? '').trim();
    if (!linea) continue;
    if (!byLinea[linea]) byLinea[linea] = emptyAgg();
    const agg = byLinea[linea];
    agg.total++;
    const iso = fechaCol !== -1 ? parseDate(row[fechaCol]) : null;
    if (iso) {
      agg.entregado++;
      extendRange(agg, iso);
    }
    const kg = kgCol !== -1 ? parseNum(row[kgCol]) : null;
    if (kg !== null) agg.toneladas = (agg.toneladas ?? 0) + kg / 1000;
    const ha = haCol !== -1 ? parseNum(row[haCol]) : null;
    if (ha !== null) agg.hectareas = (agg.hectareas ?? 0) + ha;
  }
  return byLinea;
}

// Material Vegetal: mismo patrón que Abono, pero para el material de siembra.
export function parseMaterialVegetal(grid: Grid): Record<string, PistaAgg> {
  const { headerRow, rows } = withHeaders(grid);
  const lineaCol = findContains(headerRow, 'linea productiva');
  const fechaCol = findExact(headerRow, 'Fecha Programada de entrega de Material Vegetal');
  const kgCol = findExact(headerRow, 'Cantidad Kg./Beneficiario');
  if (lineaCol === -1) throw new Error('No se encontró la columna "Línea Productiva Asignada" en la pestaña Material Vegetal.');

  const byLinea: Record<string, PistaAgg> = {};
  for (const row of rows) {
    const linea = String(row[lineaCol] ?? '').trim();
    if (!linea) continue;
    if (!byLinea[linea]) byLinea[linea] = emptyAgg();
    const agg = byLinea[linea];
    agg.total++;
    const iso = fechaCol !== -1 ? parseDate(row[fechaCol]) : null;
    if (iso) {
      agg.entregado++;
      extendRange(agg, iso);
    }
    const kg = kgCol !== -1 ? parseNum(row[kgCol]) : null;
    if (kg !== null) agg.toneladas = (agg.toneladas ?? 0) + kg / 1000;
  }
  return byLinea;
}

// Entrega Insumos: dato REAL de entrega (no confundir con la proyección de
// Entrega Estimada Manual).
export function parseEntregaInsumos(grid: Grid): Record<string, PistaAgg> {
  const { headerRow, rows } = withHeaders(grid);
  const lineaCol = findContains(headerRow, 'linea productiva');
  // "Fecha Sugerida Entrega" es el nombre original esperado; la hoja actual
  // usa "Fecha de entrega" (fecha real) — se prueban ambos por si el nombre
  // vuelve a cambiar.
  let fechaCol = findExact(headerRow, 'Fecha Sugerida Entrega');
  if (fechaCol === -1) fechaCol = findExact(headerRow, 'Fecha de entrega');
  const kgCol = findExact(headerRow, 'Cantidad Insumos Kg./Beneficiario');
  if (lineaCol === -1) throw new Error('No se encontró una columna de línea productiva en la pestaña Entrega Insumos.');

  const byLinea: Record<string, PistaAgg> = {};
  for (const row of rows) {
    const linea = String(row[lineaCol] ?? '').trim();
    if (!linea) continue;
    if (!byLinea[linea]) byLinea[linea] = emptyAgg();
    const agg = byLinea[linea];
    agg.total++;
    const iso = fechaCol !== -1 ? parseDate(row[fechaCol]) : null;
    if (iso) {
      agg.entregado++;
      extendRange(agg, iso);
    }
    const kg = kgCol !== -1 ? parseNum(row[kgCol]) : null;
    if (kg !== null) agg.toneladas = (agg.toneladas ?? 0) + kg / 1000;
  }
  return byLinea;
}

export type Proyeccion = {
  fechaInicio: string | null;
  fechaFin: string | null;
  diasEntrega: number | null;
  beneficiariosPorDia: number | null;
  totalToneladasKit: number | null;
};

// Entrega Estimada Manual: una fila por Subactividad (planeación a mano, el
// sistema nunca escribe aquí). Alimenta la pista "Proyección Entrega de Insumos".
export function parseEntregaEstimada(grid: Grid): Record<string, Proyeccion> {
  const { headerRow, rows } = withHeaders(grid);
  const subCol = findExactFlexible(headerRow, 'Sub Actividad');
  const inicioCol = findExact(headerRow, 'Fecha Inicio Entrega');
  const finCol = findExact(headerRow, 'Fecha Fin Entrega Estimada');
  const diasCol = findExact(headerRow, 'Días de entrega');
  const benefDiaCol = findExact(headerRow, 'Beneficiarios x día');
  const kitCol = findExact(headerRow, 'Total toneladas kit');
  if (subCol === -1) throw new Error('No se encontró la columna "Sub Actividad" en la pestaña Entrega Estimada Manual.');

  const bySub: Record<string, Proyeccion> = {};
  for (const row of rows) {
    const sub = String(row[subCol] ?? '').trim();
    if (!sub) continue;
    bySub[sub] = {
      fechaInicio: inicioCol !== -1 ? parseDate(row[inicioCol]) : null,
      fechaFin: finCol !== -1 ? parseDate(row[finCol]) : null,
      diasEntrega: diasCol !== -1 ? parseNum(row[diasCol]) : null,
      beneficiariosPorDia: benefDiaCol !== -1 ? parseNum(row[benefDiaCol]) : null,
      totalToneladasKit: kitCol !== -1 ? parseNum(row[kitCol]) : null,
    };
  }
  return bySub;
}

export type Kpi = { total: number; avance: number };

// Beneficiarios: única fuente de las 3 tarjetas de % de arriba. Solo se leen
// agregados (conteos) — nunca cédula, celular ni nombre.
export function parseBeneficiariosKpis(grid: Grid): { insumo: Kpi; abono: Kpi; materialVegetal: Kpi } {
  const { headerRow, rows } = withHeaders(grid);
  const abonoCol = findExact(headerRow, 'ABONO');
  const cantidadAbonoCol = findExact(headerRow, 'Cantidad Abono (Bultos)');
  const mvCol = findExact(headerRow, 'Material Vegetal');
  const insumoCol = findExact(headerRow, 'Entrega Insumos');
  if (abonoCol === -1 && mvCol === -1 && insumoCol === -1) {
    throw new Error('No se encontraron las columnas ABONO, Material Vegetal o Entrega Insumos en la pestaña Beneficiarios.');
  }

  let insumoTotal = 0;
  let insumoAvance = 0;
  let abonoTotal = 0;
  let abonoAvance = 0;
  let mvTotal = 0;
  let mvAvance = 0;

  for (const row of rows) {
    const hasAnyData = row.some((v) => v !== undefined && v !== null && String(v).trim() !== '');
    if (!hasAnyData) continue;

    if (insumoCol !== -1) {
      insumoTotal++;
      if (isFilled(row[insumoCol])) insumoAvance++;
    }
    if (mvCol !== -1) {
      mvTotal++;
      if (isFilled(row[mvCol])) mvAvance++;
    }
    if (abonoCol !== -1) {
      const cantidadAbono = cantidadAbonoCol !== -1 ? parseNum(row[cantidadAbonoCol]) : null;
      const excluido = cantidadAbonoCol !== -1 && (cantidadAbono === null || cantidadAbono === 0);
      if (!excluido) {
        abonoTotal++;
        if (isFilled(row[abonoCol])) abonoAvance++;
      }
    }
  }

  return {
    insumo: { total: insumoTotal, avance: insumoAvance },
    abono: { total: abonoTotal, avance: abonoAvance },
    materialVegetal: { total: mvTotal, avance: mvAvance },
  };
}
