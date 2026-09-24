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

// Valida que año/mes/día formen una fecha real (rechaza día 0, 31 de
// febrero, etc.) antes de dejarla salir — un valor así llega intacto hasta
// el INSERT y Postgres lo rechaza con un error críptico ("date/time field
// value out of range"), tumbando toda la importación por una sola celda mala.
function normalizeDateParts(yearStr: string, monthStr: string, dayStr: string): string | null {
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseDate(value: SheetValue | undefined): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return serialToIso(value);
  const t = String(value).trim();
  if (!t) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return normalizeDateParts(m[1], m[2], m[3]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (m) return normalizeDateParts(m[3], m[2], m[1]);
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

// "Avance"/"entregado" solo cuenta lo que YA pasó — una fecha futura en estas
// columnas es una entrega PROGRAMADA, no una entrega real todavía.
function getTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
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
export type InsumoDetalleRow = {
  linea: string;
  insumo: string;
  unidad: string;
  componente: string;
  proceso: string;
  cantidad: number | null;
  beneficiarios: number | null;
  fechaCompra: string | null;
  fechaEntrega: string | null;
  notaEntrega: string;
  llego: string;
  estado: string;
  tanda: string;
};

export function parseInsumosDetalle(grid: Grid): { compra: Record<string, PistaAgg>; entrega: Record<string, PistaAgg>; detalle: InsumoDetalleRow[] } {
  const { headerRow, rows } = withHeaders(grid);
  const lineaCol = findExact(headerRow, 'Linea productiva');
  const compraCol = findExact(headerRow, 'Fecha de compra');
  const entregaCol = findExact(headerRow, 'Fecha de entrega');
  const llegoCol = findExact(headerRow, 'Llego');
  const insumoCol = findExact(headerRow, 'Insumo');
  const unidadCol = findExact(headerRow, 'Unidad');
  const componenteCol = findExact(headerRow, 'Componente');
  const procesoCol = findExact(headerRow, 'Proceso');
  const cantidadCol = findExact(headerRow, 'Cantidad');
  const beneficiariosCol = findExact(headerRow, 'Beneficiarios');
  const notaCol = findExact(headerRow, 'Nota de entrega');
  const estadoCol = findExact(headerRow, 'Estado');
  const tandaCol = findExact(headerRow, 'Tanda');
  if (lineaCol === -1) throw new Error('No se encontró la columna "Linea productiva" en la pestaña Insumos Detalle.');

  const get = (row: SheetValue[], col: number) => (col !== -1 ? String(row[col] ?? '').trim() : '');

  const compra: Record<string, PistaAgg> = {};
  const entrega: Record<string, PistaAgg> = {};
  const detalle: InsumoDetalleRow[] = [];
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
    const fechaCompra = compraCol !== -1 ? parseDate(row[compraCol]) : null;
    const fechaEntrega = entregaCol !== -1 ? parseDate(row[entregaCol]) : null;
    extendRange(compra[linea], fechaCompra);
    extendRange(entrega[linea], fechaEntrega);

    detalle.push({
      linea,
      insumo: get(row, insumoCol),
      unidad: get(row, unidadCol),
      componente: get(row, componenteCol),
      proceso: get(row, procesoCol),
      cantidad: cantidadCol !== -1 ? parseNum(row[cantidadCol]) : null,
      beneficiarios: beneficiariosCol !== -1 ? parseNum(row[beneficiariosCol]) : null,
      fechaCompra,
      fechaEntrega,
      notaEntrega: get(row, notaCol),
      llego: get(row, llegoCol),
      estado: get(row, estadoCol),
      tanda: get(row, tandaCol),
    });
  }
  return { compra, entrega, detalle };
}

// Abono: un renglón por beneficiario. Entregado = fila con "Fecha Final"
// llena (fecha real de cierre; reemplaza a la fecha programada que se usaba
// antes).
export function parseAbono(grid: Grid): Record<string, PistaAgg> {
  const { headerRow, rows } = withHeaders(grid);
  const lineaCol = findContains(headerRow, 'linea productiva');
  let fechaCol = findExact(headerRow, 'Fecha Final');
  if (fechaCol === -1) fechaCol = findExact(headerRow, 'Fecha Programada de entrega de Abono');
  if (fechaCol === -1) fechaCol = findContains(headerRow, 'fecha programada', 'entrega');
  const kgCol = findExact(headerRow, 'ABONO ORGANICO (KG)');
  const haCol = findContains(headerRow, 'area asignada');
  if (lineaCol === -1) throw new Error('No se encontró la columna "Línea Productiva Asignada" en la pestaña Abono.');

  const todayIso = getTodayIso();
  const byLinea: Record<string, PistaAgg> = {};
  for (const row of rows) {
    const linea = String(row[lineaCol] ?? '').trim();
    if (!linea) continue;
    if (!byLinea[linea]) byLinea[linea] = emptyAgg();
    const agg = byLinea[linea];
    agg.total++;
    const iso = fechaCol !== -1 ? parseDate(row[fechaCol]) : null;
    if (iso) {
      if (iso <= todayIso) agg.entregado++;
      extendRange(agg, iso);
    }
    const kg = kgCol !== -1 ? parseNum(row[kgCol]) : null;
    if (kg !== null) agg.toneladas = (agg.toneladas ?? 0) + kg / 1000;
    const ha = haCol !== -1 ? parseNum(row[haCol]) : null;
    if (ha !== null) agg.hectareas = (agg.hectareas ?? 0) + ha;
  }
  return byLinea;
}

// Material Vegetal: mismo patrón que Abono ("Fecha Final" reemplaza a la
// fecha programada), pero para el material de siembra.
export function parseMaterialVegetal(grid: Grid): Record<string, PistaAgg> {
  const { headerRow, rows } = withHeaders(grid);
  const lineaCol = findContains(headerRow, 'linea productiva');
  let fechaCol = findExact(headerRow, 'Fecha Final');
  if (fechaCol === -1) fechaCol = findExact(headerRow, 'Fecha Programada de entrega de Material Vegetal');
  const kgCol = findExact(headerRow, 'Cantidad Kg./Beneficiario');
  if (lineaCol === -1) throw new Error('No se encontró la columna "Línea Productiva Asignada" en la pestaña Material Vegetal.');

  const todayIso = getTodayIso();
  const byLinea: Record<string, PistaAgg> = {};
  for (const row of rows) {
    const linea = String(row[lineaCol] ?? '').trim();
    if (!linea) continue;
    if (!byLinea[linea]) byLinea[linea] = emptyAgg();
    const agg = byLinea[linea];
    agg.total++;
    const iso = fechaCol !== -1 ? parseDate(row[fechaCol]) : null;
    if (iso) {
      if (iso <= todayIso) agg.entregado++;
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
  // "Fechas Final" es la fecha real de cierre y reemplaza a las fechas
  // programadas/sugeridas que se usaban antes.
  let fechaCol = findExact(headerRow, 'Fechas Final');
  if (fechaCol === -1) fechaCol = findExact(headerRow, 'Fecha Final');
  if (fechaCol === -1) fechaCol = findExact(headerRow, 'Fecha Sugerida Entrega');
  if (fechaCol === -1) fechaCol = findExact(headerRow, 'Fecha de entrega');
  const kgCol = findExact(headerRow, 'Cantidad Insumos Kg./Beneficiario');
  if (lineaCol === -1) throw new Error('No se encontró una columna de línea productiva en la pestaña Entrega Insumos.');

  const todayIso = getTodayIso();
  const byLinea: Record<string, PistaAgg> = {};
  for (const row of rows) {
    const linea = String(row[lineaCol] ?? '').trim();
    if (!linea) continue;
    if (!byLinea[linea]) byLinea[linea] = emptyAgg();
    const agg = byLinea[linea];
    agg.total++;
    const iso = fechaCol !== -1 ? parseDate(row[fechaCol]) : null;
    if (iso) {
      if (iso <= todayIso) agg.entregado++;
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

type BeneficiariosGroupKey = 'abono' | 'materialVegetal' | 'insumo';

// Beneficiarios: única fuente de las 3 tarjetas de % de arriba. Solo se leen
// agregados (conteos) — nunca cédula, celular ni nombre.
//
// La hoja ahora agrupa las columnas en 2 filas de encabezado: una fila con
// los títulos fusionados "Abono Organico" / "Material Vegetal" / "Entrega
// Insumos", y debajo la fila real de subcolumnas ("Ultima Fecha", "Fecha
// anterior", "Fecha final", "Cantidad ..."). "Fecha final" es la fecha real
// de cierre y reemplaza a la fecha "programada" que se usaba antes.
export function parseBeneficiariosKpis(grid: Grid): { insumo: Kpi; abono: Kpi; materialVegetal: Kpi } {
  const grouped = detectBeneficiariosGroupHeader(grid);
  if (grouped) return parseBeneficiariosKpisGrouped(grid, grouped);
  return parseBeneficiariosKpisFlat(grid);
}

function detectBeneficiariosGroupHeader(grid: Grid): { groupRowIdx: number; groups: { key: BeneficiariosGroupKey; col: number }[] } | null {
  const scanRows = Math.min(grid.length, 6);
  for (let r = 0; r < scanRows; r++) {
    const row = grid[r] || [];
    const groups: { key: BeneficiariosGroupKey; col: number }[] = [];
    for (let c = 0; c < row.length; c++) {
      const h = normalizeHeader(row[c]);
      if (!h) continue;
      if (h.indexOf('abono') !== -1 && !groups.some((g) => g.key === 'abono')) groups.push({ key: 'abono', col: c });
      else if (h.indexOf('material vegetal') !== -1 && !groups.some((g) => g.key === 'materialVegetal')) groups.push({ key: 'materialVegetal', col: c });
      else if (h.indexOf('entrega insumos') !== -1 && !groups.some((g) => g.key === 'insumo')) groups.push({ key: 'insumo', col: c });
    }
    if (groups.length >= 2 && grid[r + 1]) {
      groups.sort((a, b) => a.col - b.col);
      return { groupRowIdx: r, groups };
    }
  }
  return null;
}

function parseBeneficiariosKpisGrouped(
  grid: Grid,
  { groupRowIdx, groups }: { groupRowIdx: number; groups: { key: BeneficiariosGroupKey; col: number }[] },
): { insumo: Kpi; abono: Kpi; materialVegetal: Kpi } {
  const subHeaderRow = (grid[groupRowIdx + 1] || []).map((h) => (h === undefined || h === null ? '' : String(h)));
  const rows = grid.slice(groupRowIdx + 2);
  const spanEnd = (idx: number) => (idx + 1 < groups.length ? groups[idx + 1].col : subHeaderRow.length);

  const findInSpan = (start: number, end: number, name: string) => {
    for (let c = start; c < end; c++) {
      if (normalizeHeader(subHeaderRow[c]) === normalizeHeader(name)) return c;
    }
    return -1;
  };
  const findContainsInSpan = (start: number, end: number, term: string) => {
    for (let c = start; c < end; c++) {
      if (normalizeHeader(subHeaderRow[c]).indexOf(normalizeHeader(term)) !== -1) return c;
    }
    return -1;
  };

  const cols: Partial<Record<BeneficiariosGroupKey, { fechaFinal: number; cantidad: number }>> = {};
  groups.forEach((g, idx) => {
    const end = spanEnd(idx);
    cols[g.key] = {
      fechaFinal: findInSpan(g.col, end, 'Fecha final'),
      cantidad: findContainsInSpan(g.col, end, 'cantidad'),
    };
  });

  const todayIso = getTodayIso();
  const entregadoAFecha = (value: SheetValue | undefined): boolean => {
    if (!isFilled(value)) return false;
    const iso = parseDate(value);
    return iso === null ? true : iso <= todayIso;
  };

  let insumoTotal = 0;
  let insumoAvance = 0;
  let abonoTotal = 0;
  let abonoAvance = 0;
  let mvTotal = 0;
  let mvAvance = 0;

  for (const row of rows) {
    const hasAnyData = row.some((v) => v !== undefined && v !== null && String(v).trim() !== '');
    if (!hasAnyData) continue;

    if (cols.insumo) {
      insumoTotal++;
      if (cols.insumo.fechaFinal !== -1 && entregadoAFecha(row[cols.insumo.fechaFinal])) insumoAvance++;
    }
    if (cols.materialVegetal) {
      mvTotal++;
      if (cols.materialVegetal.fechaFinal !== -1 && entregadoAFecha(row[cols.materialVegetal.fechaFinal])) mvAvance++;
    }
    if (cols.abono) {
      const cantidadAbono = cols.abono.cantidad !== -1 ? parseNum(row[cols.abono.cantidad]) : null;
      const excluido = cols.abono.cantidad !== -1 && (cantidadAbono === null || cantidadAbono === 0);
      if (!excluido) {
        abonoTotal++;
        if (cols.abono.fechaFinal !== -1 && entregadoAFecha(row[cols.abono.fechaFinal])) abonoAvance++;
      }
    }
  }

  return {
    insumo: { total: insumoTotal, avance: insumoAvance },
    abono: { total: abonoTotal, avance: abonoAvance },
    materialVegetal: { total: mvTotal, avance: mvAvance },
  };
}

// Estructura anterior (una sola fila de encabezados planos: ABONO, Material
// Vegetal, Entrega Insumos), conservada como respaldo por si la hoja vuelve
// a ese formato.
function parseBeneficiariosKpisFlat(grid: Grid): { insumo: Kpi; abono: Kpi; materialVegetal: Kpi } {
  const { headerRow, rows } = withHeaders(grid);
  const abonoCol = findExact(headerRow, 'ABONO');
  const cantidadAbonoCol = findExact(headerRow, 'Cantidad Abono (Bultos)');
  const mvCol = findExact(headerRow, 'Material Vegetal');
  const insumoCol = findExact(headerRow, 'Entrega Insumos');
  if (abonoCol === -1 && mvCol === -1 && insumoCol === -1) {
    throw new Error('No se encontraron las columnas ABONO, Material Vegetal o Entrega Insumos en la pestaña Beneficiarios.');
  }

  const todayIso = getTodayIso();
  const entregadoAFecha = (value: SheetValue | undefined): boolean => {
    if (!isFilled(value)) return false;
    const iso = parseDate(value);
    return iso === null ? true : iso <= todayIso;
  };

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
      if (entregadoAFecha(row[insumoCol])) insumoAvance++;
    }
    if (mvCol !== -1) {
      mvTotal++;
      if (entregadoAFecha(row[mvCol])) mvAvance++;
    }
    if (abonoCol !== -1) {
      const cantidadAbono = cantidadAbonoCol !== -1 ? parseNum(row[cantidadAbonoCol]) : null;
      const excluido = cantidadAbonoCol !== -1 && (cantidadAbono === null || cantidadAbono === 0);
      if (!excluido) {
        abonoTotal++;
        if (entregadoAFecha(row[abonoCol])) abonoAvance++;
      }
    }
  }

  return {
    insumo: { total: insumoTotal, avance: insumoAvance },
    abono: { total: abonoTotal, avance: abonoAvance },
    materialVegetal: { total: mvTotal, avance: mvAvance },
  };
}
