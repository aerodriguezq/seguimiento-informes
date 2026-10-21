import type { VercelRequest, VercelResponse } from '@vercel/node';
import { canEditModuleRequest, isAdminRequest } from '../../server/admin-auth.js';
import { getGoogleOAuthClient } from '../../server/google-oauth.js';
import { getSheetTitleByGid, getSheetGridWithBackgrounds, getSheetValues, listSheetTabs, type SheetCell, type SheetValue, type SheetTab } from '../../server/google-sheets.js';
import { getDriveFileMeta, downloadDriveFileBuffer } from '../../server/google-drive.js';
import { isExcelMimeType, loadExcelWorkbook, findExcelSheetByName, getExcelGridWithBackgrounds, getExcelValues } from '../../server/excel-seguimiento-source.js';
import { parseCronograma } from '../../server/cronograma-parser.js';
import {
  parseGanttMensual,
  extractValorUnitarioPorSubactividad,
  deriveGanttFinanciero,
  extractAvanceGeneralFinanciero,
  type GanttMensualPayload,
} from '../../server/gantt-mensual-parser.js';
import {
  parseReferenciaLineas,
  parseInsumosDetalle,
  parseAbono,
  parseMaterialVegetal,
  parseEntregaInsumos,
  parseEntregaEstimada,
  parseBeneficiariosKpis,
  type PistaAgg,
  type Kpi,
} from '../../server/seguimiento-parsers.js';
import { getSweepGate, recordSweepRun } from '../../server/sweep-config.js';

type SqlClient = ReturnType<typeof import('@neondatabase/serverless').neon>;

async function getConnectedAccessToken(sql: SqlClient): Promise<string | null> {
  const session = (await sql`
    SELECT token_json FROM google_drive_sessions WHERE expires_at > NOW() ORDER BY created_at DESC LIMIT 1
  `) as any[];
  if (!session[0]) return null;
  const client = await getGoogleOAuthClient();
  client.setCredentials(JSON.parse(session[0].token_json));
  const token = await client.getAccessToken();
  if (!token.token) throw new Error('La sesión de Google conectada expiró. Reconéctala desde Fuentes Drive.');
  return token.token;
}

const GOOGLE_SHEETS_MIME = 'application/vnd.google-apps.spreadsheet';

const SEGUIMIENTO_SHEET_NAMES = {
  insumosDetalle: 'Insumos Detalle',
  abono: 'Abono',
  materialVegetal: 'Material Vegetal',
  entregaInsumos: 'Entrega Insumos',
  entregaEstimada: 'Entrega Estimada Manual',
  referenciaLineas: 'Referencia SubActividad-Linea',
  beneficiarios: 'Beneficiarios',
};

// El driver de Neon devuelve columnas NUMERIC como texto (para no perder
// precisión), no como number — hay que convertirlas explícitamente o
// romperán cualquier .toFixed()/aritmética del lado del cliente.
function toNumOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Un proyecto puede tener varias hojas configuradas (mismo formato, ej.
// varios contratos/fases) -- esto lista las disponibles para que el
// frontend muestre un selector, sin traer los datos pesados de cada una.
async function listSeguimientoSheets(sql: SqlClient, projectId: number) {
  return (await sql`
    SELECT seguimiento_id AS "seguimientoId", nombre, spreadsheet_id AS "spreadsheetId",
      cronograma_gid AS "cronogramaGid", ultima_importacion AS "lastImportAt", ultimo_error AS "lastError"
    FROM seguimiento_config WHERE proyecto_id = ${projectId} ORDER BY seguimiento_id ASC
  `) as any[];
}

async function fetchSeguimiento(sql: SqlClient, seguimientoId: number) {
  const [config] = (await sql`
    SELECT seguimiento_id AS "seguimientoId", proyecto_id AS "projectId", nombre, formato,
      spreadsheet_id AS "spreadsheetId", cronograma_gid AS "cronogramaGid",
      ultima_importacion AS "lastImportAt", ultimo_error AS "lastError",
      insumos_columnas_visibles AS "insumosColumnasVisibles", drive_folder_url AS "driveFolderUrl"
    FROM seguimiento_config WHERE seguimiento_id = ${seguimientoId}
  `) as any[];

  const rows = (await sql`
    SELECT fila_id AS id, sub_actividad AS "subActividad", concepto,
      total_toneladas AS "totalToneladas", toneladas_riego_abono AS "toneladasRiegoAbono",
      observaciones, es_resumen AS "isResumen"
    FROM seguimiento_cronograma_filas WHERE seguimiento_id = ${seguimientoId} ORDER BY orden ASC
  `) as any[];

  const referencia = (await sql`
    SELECT sub_actividad AS "subActividad", linea_productiva AS "lineaProductiva"
    FROM seguimiento_referencia_lineas WHERE seguimiento_id = ${seguimientoId}
  `) as any[];
  const lineaBySub: Record<string, string> = {};
  referencia.forEach((r: any) => { lineaBySub[r.subActividad] = r.lineaProductiva; });

  const pistas = ((await sql`
    SELECT linea_productiva AS "lineaProductiva", pista,
      TO_CHAR(fecha_inicio, 'YYYY-MM-DD') AS "fechaInicio", TO_CHAR(fecha_fin, 'YYYY-MM-DD') AS "fechaFin",
      cantidad_total AS "cantidadTotal", cantidad_entregada AS "cantidadEntregada",
      toneladas_total AS "toneladasTotal", hectareas
    FROM seguimiento_linea_pistas WHERE seguimiento_id = ${seguimientoId}
  `) as any[]).map((p: any) => ({
    ...p,
    cantidadTotal: toNumOrNull(p.cantidadTotal) ?? 0,
    cantidadEntregada: toNumOrNull(p.cantidadEntregada) ?? 0,
    toneladasTotal: toNumOrNull(p.toneladasTotal),
    hectareas: toNumOrNull(p.hectareas),
  }));

  const proyeccion = ((await sql`
    SELECT sub_actividad AS "subActividad", TO_CHAR(fecha_inicio, 'YYYY-MM-DD') AS "fechaInicio",
      TO_CHAR(fecha_fin, 'YYYY-MM-DD') AS "fechaFin", dias_entrega AS "diasEntrega",
      beneficiarios_por_dia AS "beneficiariosPorDia", total_toneladas_kit AS "totalToneladasKit"
    FROM seguimiento_proyeccion WHERE seguimiento_id = ${seguimientoId}
  `) as any[]).map((p: any) => ({
    ...p,
    diasEntrega: toNumOrNull(p.diasEntrega),
    beneficiariosPorDia: toNumOrNull(p.beneficiariosPorDia),
    totalToneladasKit: toNumOrNull(p.totalToneladasKit),
  }));
  const proyeccionBySub: Record<string, any> = {};
  proyeccion.forEach((p: any) => { proyeccionBySub[p.subActividad] = p; });

  const kpiRows = (await sql`SELECT tipo, total, avance FROM seguimiento_kpis WHERE seguimiento_id = ${seguimientoId}`) as any[];
  const kpis: Record<string, { total: number; avance: number }> = {};
  kpiRows.forEach((k: any) => { kpis[k.tipo] = { total: toNumOrNull(k.total) ?? 0, avance: toNumOrNull(k.avance) ?? 0 }; });

  return {
    config: config || null,
    kpis,
    rows: rows.map((r: any) => {
      const linea = lineaBySub[r.subActividad] || null;
      const pistasFila = linea ? pistas.filter((p: any) => p.lineaProductiva === linea) : [];
      return {
        ...r,
        totalToneladas: toNumOrNull(r.totalToneladas),
        toneladasRiegoAbono: toNumOrNull(r.toneladasRiegoAbono),
        lineaProductiva: linea,
        pistas: pistasFila,
        proyeccion: proyeccionBySub[r.subActividad] || null,
      };
    }),
  };
}

// Formato "Gantt mensual": Plan/Ejecutado por mes y por subactividad,
// agrupadas por Actividad -- ver parseGanttMensual. GANTT FINANCIERO (si
// existe) solo aporta el Valor Unitario por subactividad; sus montos
// mensuales se derivan multiplicando los del Físico, en vez de leer sus
// propias columnas de mes (son fórmulas que a menudo no cachean el
// resultado cuando da 0).
async function importGanttMensual(
  sql: SqlClient,
  seguimientoId: number,
  fisico: GanttMensualPayload,
  findSiblingValues: (namePattern: string) => Promise<SheetValue[][] | null>,
) {
  const financieroGrid = await findSiblingValues('financiero');
  const valorUnitarioList = financieroGrid ? extractValorUnitarioPorSubactividad(financieroGrid) : null;
  const financiero = valorUnitarioList ? deriveGanttFinanciero(fisico, valorUnitarioList) : null;
  // Avance financiero GENERAL del proyecto (ponderado por plata, no por
  // cantidad de subactividades) -- viene de un bloque resumen aparte de
  // GANTT FINANCIERO, con lo que ya ejecutó/planeó TODO el proyecto, mes a
  // mes acumulado.
  const avanceGeneral = financieroGrid ? extractAvanceGeneralFinanciero(financieroGrid, fisico.meses.length) : null;

  // Limpia tanto el formato clásico (por si esta hoja tenía datos de un
  // vínculo anterior) como el Gantt mensual de una importación previa.
  await sql`DELETE FROM seguimiento_cronograma_filas WHERE seguimiento_id = ${seguimientoId}`;
  await sql`DELETE FROM seguimiento_referencia_lineas WHERE seguimiento_id = ${seguimientoId}`;
  await sql`DELETE FROM seguimiento_linea_pistas WHERE seguimiento_id = ${seguimientoId}`;
  await sql`DELETE FROM seguimiento_proyeccion WHERE seguimiento_id = ${seguimientoId}`;
  await sql`DELETE FROM seguimiento_kpis WHERE seguimiento_id = ${seguimientoId}`;
  await sql`DELETE FROM seguimiento_insumos_detalle WHERE seguimiento_id = ${seguimientoId}`;
  await sql`DELETE FROM seguimiento_gantt_subactividades WHERE seguimiento_id = ${seguimientoId}`;

  const buildRows = (tipo: string, payload: GanttMensualPayload) =>
    payload.subactividades.map((s, i) => ({
      seguimiento_id: seguimientoId,
      tipo,
      orden: i,
      actividad: s.actividad,
      descripcion: s.descripcion,
      sub_actividad: s.subActividad,
      meta: s.meta,
      unidad: s.unidad,
      meses: payload.meses,
      plan_meses: s.plan,
      ejecutado_meses: s.ejecutado,
    }));

  const resumenRow = avanceGeneral
    ? [{
        seguimiento_id: seguimientoId,
        tipo: 'resumen',
        orden: 0,
        actividad: 'Avance financiero general',
        descripcion: '',
        sub_actividad: 'planificado_vs_ejecutado',
        meta: avanceGeneral.totalPlanificado,
        unidad: 'COP',
        meses: fisico.meses,
        plan_meses: avanceGeneral.planificadoAcumulado,
        ejecutado_meses: avanceGeneral.ejecutadoAcumulado,
      }]
    : [];

  const allRows = buildRows('fisico', fisico).concat(financiero ? buildRows('financiero', financiero) : []).concat(resumenRow);
  if (allRows.length > 0) {
    await sql`
      INSERT INTO seguimiento_gantt_subactividades
        (seguimiento_id, tipo, orden, actividad, descripcion, sub_actividad, meta, unidad, meses, plan_meses, ejecutado_meses)
      SELECT r.seguimiento_id, r.tipo, r.orden, r.actividad, r.descripcion, r.sub_actividad, r.meta, r.unidad, r.meses, r.plan_meses, r.ejecutado_meses
      FROM jsonb_to_recordset(${JSON.stringify(allRows)}::jsonb)
        AS r(seguimiento_id integer, tipo text, orden integer, actividad text, descripcion text, sub_actividad text, meta numeric, unidad text, meses jsonb, plan_meses jsonb, ejecutado_meses jsonb)
    `;
  }

  await sql`UPDATE seguimiento_config SET formato = 'gantt_mensual' WHERE seguimiento_id = ${seguimientoId}`;

  return {
    rowsImported: fisico.subactividades.length,
    formato: 'gantt_mensual' as const,
    tieneFinanciero: !!financiero,
  };
}

async function importSeguimiento(sql: SqlClient, seguimientoId: number) {
  const [config] = (await sql`
    SELECT proyecto_id AS "projectId", spreadsheet_id AS "spreadsheetId", cronograma_gid AS "cronogramaGid"
    FROM seguimiento_config WHERE seguimiento_id = ${seguimientoId}
  `) as any[];
  if (!config) throw new Error('Esta hoja de seguimiento ya no existe.');
  if (!config.spreadsheetId) {
    throw new Error('Esta hoja todavía no tiene un archivo vinculado.');
  }
  const projectId = config.projectId;

  const accessToken = await getConnectedAccessToken(sql);
  if (!accessToken) throw new Error('Conecta una cuenta de Google (Fuentes Drive) para poder leer el archivo.');

  // El archivo vinculado puede ser una Hoja de Google nativa (se lee con la
  // API de Sheets, ubicando pestañas por gid/nombre) o un .xlsx subido tal
  // cual a Drive (la API de Sheets lo rechaza -- se descarga y se lee con
  // ExcelJS, ubicando pestañas solo por nombre ya que un .xlsx no tiene gid).
  const fileMeta = await getDriveFileMeta(accessToken, config.spreadsheetId);

  let sheetTitle: string;
  let getCronogramaGridWithBackgrounds: () => Promise<SheetCell[][]>;
  let getValues: (tabName: string) => Promise<SheetValue[][]>;
  // Solo para el formato "Gantt mensual" (ver más abajo): busca una pestaña
  // hermana por coincidencia de nombre (ej. "GANTT FINANCIERO"), sin hacer
  // falta que el usuario la seleccione -- devuelve null si no existe.
  let findSiblingValues: (namePattern: string) => Promise<SheetValue[][] | null>;

  if (fileMeta.mimeType === GOOGLE_SHEETS_MIME) {
    if (!config.cronogramaGid) {
      throw new Error('Esta hoja todavía no tiene seleccionada la pestaña del cronograma. Usa "Cambiar hoja".');
    }
    sheetTitle = await getSheetTitleByGid(accessToken, config.spreadsheetId, config.cronogramaGid);
    getCronogramaGridWithBackgrounds = () => getSheetGridWithBackgrounds(accessToken, config.spreadsheetId, sheetTitle);
    getValues = (tabName) => getSheetValues(accessToken, config.spreadsheetId, tabName);
    findSiblingValues = async (pattern) => {
      const tabs = await listSheetTabs(accessToken, config.spreadsheetId);
      const match = tabs.find((t) => t.name.toLowerCase().includes(pattern));
      return match ? getSheetValues(accessToken, config.spreadsheetId, match.name) : null;
    };
  } else if (isExcelMimeType(fileMeta.mimeType)) {
    const buffer = await downloadDriveFileBuffer(accessToken, config.spreadsheetId);
    const workbook = await loadExcelWorkbook(buffer);
    // Un .xlsx no tiene "gid" -- si el usuario ya eligió una pestaña a mano
    // (con el selector de "Cambiar hoja"), cronograma_gid guarda su NOMBRE.
    // Si no, se intenta detectar una pestaña llamada "Cronograma" por defecto.
    const cronogramaSheet = findExcelSheetByName(workbook, config.cronogramaGid || 'Cronograma');
    sheetTitle = cronogramaSheet.name;
    getCronogramaGridWithBackgrounds = async () => getExcelGridWithBackgrounds(cronogramaSheet);
    getValues = async (tabName) => getExcelValues(findExcelSheetByName(workbook, tabName));
    findSiblingValues = async (pattern) => {
      const match = workbook.worksheets.find((ws) => ws.name.toLowerCase().includes(pattern));
      return match ? getExcelValues(match) : null;
    };
  } else {
    throw new Error(
      `El archivo vinculado ("${fileMeta.name}") no es ni una Hoja de Google ni un Excel (.xlsx) -- vuelve a vincularlo con "Cambiar hoja".`,
    );
  }

  // Formato "Gantt mensual" (ej. San Jacinto: Plan/Ejecutado por mes y por
  // subactividad, agrupadas por Actividad) -- muy distinto del Cronograma
  // por día + Insumos/Abono/etc. de siempre. Se detecta solo, sin que el
  // usuario tenga que elegir el formato a mano: si la pestaña seleccionada
  // calza con esa forma, se usa ese camino completo (incluyendo
  // GANTT FINANCIERO si existe una pestaña hermana) y no se tocan las demás
  // pestañas fijas (Insumos Detalle, Abono, etc.), que en este formato ni
  // siquiera existen.
  const cronogramaValues = await getValues(sheetTitle);
  const ganttFisico = parseGanttMensual(cronogramaValues);
  if (ganttFisico) {
    return await importGanttMensual(sql, seguimientoId, ganttFisico, findSiblingValues);
  }

  const cronogramaGrid = await getCronogramaGridWithBackgrounds();
  const parsedCronograma = parseCronograma(cronogramaGrid);
  if (parsedCronograma.rows.length === 0) {
    throw new Error(
      `La pestaña "${sheetTitle}" no tiene la estructura esperada: no se encontró una fila con encabezado "Sub Actividad" ni columnas de día (1-31). Verifica que sea la pestaña correcta del cronograma con "Cambiar hoja".`,
    );
  }

  const referenciaGrid = await getValues(SEGUIMIENTO_SHEET_NAMES.referenciaLineas);
  const referencia = parseReferenciaLineas(referenciaGrid);

  const insumosGrid = await getValues(SEGUIMIENTO_SHEET_NAMES.insumosDetalle);
  const { compra, entrega, detalle: insumosDetalleRows } = parseInsumosDetalle(insumosGrid);

  const abonoGrid = await getValues(SEGUIMIENTO_SHEET_NAMES.abono);
  const abono = parseAbono(abonoGrid);

  const mvGrid = await getValues(SEGUIMIENTO_SHEET_NAMES.materialVegetal);
  const materialVegetal = parseMaterialVegetal(mvGrid);

  const entregaInsumosGrid = await getValues(SEGUIMIENTO_SHEET_NAMES.entregaInsumos);
  const entregaInsumos = parseEntregaInsumos(entregaInsumosGrid);

  const estimadaGrid = await getValues(SEGUIMIENTO_SHEET_NAMES.entregaEstimada);
  const proyeccion = parseEntregaEstimada(estimadaGrid);

  const beneficiariosGrid = await getValues(SEGUIMIENTO_SHEET_NAMES.beneficiarios);
  const kpis = parseBeneficiariosKpis(beneficiariosGrid);

  // --- Persistencia: se limpia lo de ESTA hoja (no todo el proyecto, otras
  // hojas del mismo proyecto no se tocan) y se reinserta desde cero. ---
  await sql`DELETE FROM seguimiento_cronograma_filas WHERE seguimiento_id = ${seguimientoId}`;
  await sql`DELETE FROM seguimiento_referencia_lineas WHERE seguimiento_id = ${seguimientoId}`;
  await sql`DELETE FROM seguimiento_linea_pistas WHERE seguimiento_id = ${seguimientoId}`;
  await sql`DELETE FROM seguimiento_proyeccion WHERE seguimiento_id = ${seguimientoId}`;
  await sql`DELETE FROM seguimiento_kpis WHERE seguimiento_id = ${seguimientoId}`;
  await sql`DELETE FROM seguimiento_insumos_detalle WHERE seguimiento_id = ${seguimientoId}`;

  let orden = 0;
  for (const row of parsedCronograma.rows) {
    const inserted = await sql`
      INSERT INTO seguimiento_cronograma_filas
        (proyecto_id, seguimiento_id, orden, sub_actividad, concepto, total_toneladas, toneladas_riego_abono, observaciones, es_resumen)
      VALUES (${projectId}, ${seguimientoId}, ${orden}, ${row.subActividad}, ${row.concepto}, ${row.totalToneladas}, ${row.toneladasRiegoAbono}, ${row.observaciones}, ${row.isResumen})
      RETURNING fila_id AS id
    `;
    const filaId = inserted[0].id;
    for (const segment of row.segments) {
      await sql`
        INSERT INTO seguimiento_cronograma_segmentos (fila_id, fecha_inicio, fecha_fin, color)
        VALUES (${filaId}, ${segment.start}, ${segment.end}, ${segment.color})
      `;
    }
    orden++;
  }

  for (const [sub, linea] of Object.entries(referencia)) {
    await sql`
      INSERT INTO seguimiento_referencia_lineas (proyecto_id, seguimiento_id, sub_actividad, linea_productiva)
      VALUES (${projectId}, ${seguimientoId}, ${sub}, ${linea})
    `;
  }

  const insertPista = async (pista: string, byLinea: Record<string, PistaAgg>) => {
    for (const [linea, agg] of Object.entries(byLinea)) {
      await sql`
        INSERT INTO seguimiento_linea_pistas
          (proyecto_id, seguimiento_id, linea_productiva, pista, fecha_inicio, fecha_fin, cantidad_total, cantidad_entregada, toneladas_total, hectareas)
        VALUES (${projectId}, ${seguimientoId}, ${linea}, ${pista}, ${agg.fechaInicio}, ${agg.fechaFin}, ${agg.total}, ${agg.entregado}, ${agg.toneladas}, ${agg.hectareas})
      `;
    }
  };
  await insertPista('proveeduria_compra', compra);
  await insertPista('proveeduria_entrega', entrega);
  await insertPista('entrega_abono', abono);
  await insertPista('entrega_material_vegetal', materialVegetal);
  await insertPista('entrega_insumos', entregaInsumos);

  for (const [sub, p] of Object.entries(proyeccion)) {
    await sql`
      INSERT INTO seguimiento_proyeccion (proyecto_id, seguimiento_id, sub_actividad, fecha_inicio, fecha_fin, dias_entrega, beneficiarios_por_dia, total_toneladas_kit)
      VALUES (${projectId}, ${seguimientoId}, ${sub}, ${p.fechaInicio}, ${p.fechaFin}, ${p.diasEntrega}, ${p.beneficiariosPorDia}, ${p.totalToneladasKit})
    `;
  }

  const kpiEntries: [string, Kpi][] = [['insumo', kpis.insumo], ['abono', kpis.abono], ['material_vegetal', kpis.materialVegetal]];
  for (const [tipo, k] of kpiEntries) {
    await sql`INSERT INTO seguimiento_kpis (proyecto_id, seguimiento_id, tipo, total, avance) VALUES (${projectId}, ${seguimientoId}, ${tipo}, ${k.total}, ${k.avance})`;
  }

  // "Ver insumos": el detalle renglón por renglón, para el panel expandible
  // de cada tarjeta (igual que en el Apps Script original).
  for (const r of insumosDetalleRows) {
    await sql`
      INSERT INTO seguimiento_insumos_detalle
        (proyecto_id, seguimiento_id, linea_productiva, insumo, unidad, componente, proceso, cantidad, beneficiarios, fecha_compra, fecha_entrega, nota_entrega, llego, estado, tanda)
      VALUES (${projectId}, ${seguimientoId}, ${r.linea}, ${r.insumo}, ${r.unidad}, ${r.componente}, ${r.proceso}, ${r.cantidad}, ${r.beneficiarios}, ${r.fechaCompra}, ${r.fechaEntrega}, ${r.notaEntrega}, ${r.llego}, ${r.estado}, ${r.tanda})
    `;
  }

  return {
    rowsImported: parsedCronograma.rows.length,
    lineasDetectadas: Object.keys(referencia).length,
    kpis,
    // Diagnóstico por hoja: cuántas filas de datos trajo cada pestaña y cuántas
    // líneas productivas distintas se lograron mapear de ahí — así, si algo sale
    // en 0, se ve de inmediato cuál pestaña está vacía o mal nombrada, en vez de
    // un "importado con éxito" que esconde el problema.
    detalle: {
      referenciaSubActividadLinea: { filasLeidas: Math.max(referenciaGrid.length - 1, 0), lineasMapeadas: Object.keys(referencia).length },
      insumosDetalle: { filasLeidas: Math.max(insumosGrid.length - 1, 0), lineasConDatos: new Set([...Object.keys(compra), ...Object.keys(entrega)]).size },
      abono: { filasLeidas: Math.max(abonoGrid.length - 1, 0), lineasConDatos: Object.keys(abono).length },
      materialVegetal: { filasLeidas: Math.max(mvGrid.length - 1, 0), lineasConDatos: Object.keys(materialVegetal).length },
      entregaInsumos: { filasLeidas: Math.max(entregaInsumosGrid.length - 1, 0), lineasConDatos: Object.keys(entregaInsumos).length },
      entregaEstimadaManual: { filasLeidas: Math.max(estimadaGrid.length - 1, 0), subActividadesConDatos: Object.keys(proyeccion).length },
      beneficiarios: { filasLeidas: Math.max(beneficiariosGrid.length - 1, 0), kpis },
    },
  };
}

// Barrido periódico: recorre todos los proyectos que tienen una hoja de
// seguimiento vinculada y reimporta cada una, para que Neon quede al día con
// lo que el equipo va cargando en Google Sheets sin depender de que un admin
// entre a darle "Importar" a mano.
async function importAllCronogramas(sql: SqlClient) {
  const configs = (await sql`
    SELECT seguimiento_id AS "seguimientoId" FROM seguimiento_config WHERE spreadsheet_id IS NOT NULL
  `) as any[];
  let imported = 0;
  let failed = 0;
  for (const config of configs) {
    try {
      await importSeguimiento(sql, config.seguimientoId);
      await sql`UPDATE seguimiento_config SET ultima_importacion = NOW(), ultimo_error = NULL WHERE seguimiento_id = ${config.seguimientoId}`;
      imported++;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No fue posible importar el cronograma.';
      await sql`UPDATE seguimiento_config SET ultimo_error = ${message} WHERE seguimiento_id = ${config.seguimientoId}`;
      failed++;
    }
  }
  return { sheetsChecked: configs.length, imported, failed };
}

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  if (request.method !== 'GET' && request.method !== 'POST' && request.method !== 'PATCH' && request.method !== 'DELETE') {
    return response.status(405).json({
      data: null,
      meta: {},
      errors: ['Método no permitido.'],
    });
  }

  try {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl?.trim()) {
      return response.status(503).json({
        data: null,
        meta: {},
        errors: ['DATABASE_URL no está configurada en Vercel.'],
      });
    }

    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(databaseUrl);

    const cronSecret = process.env.CRON_SECRET;
    const isCronRequest = request.method === 'GET' && !!cronSecret && request.headers.authorization === `Bearer ${cronSecret}`;
    if (isCronRequest) {
      const force = request.query.force === 'true' || request.query.force === '1';
      const gate = await getSweepGate(sql, 'importacion_cronograma', force);
      if (!gate.run) {
        return response.status(200).json({ data: { skipped: true, reason: gate.reason }, meta: {}, errors: [] });
      }
      try {
        const result = await importAllCronogramas(sql);
        await recordSweepRun(sql, 'importacion_cronograma', true, result);
        return response.status(200).json({ data: result, meta: {}, errors: [] });
      } catch (error) {
        await recordSweepRun(sql, 'importacion_cronograma', false, { error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    }

    // Tarjetas de % de avance del Dashboard: mismo dato que las 3 tarjetas de
    // Seguimiento, pero sumado entre todos los proyectos que tengan KPIs.
    if (request.method === 'GET' && request.query.seguimiento === 'kpisResumen') {
      const kpiRows = (await sql`
        SELECT tipo, SUM(total) AS total, SUM(avance) AS avance
        FROM seguimiento_kpis GROUP BY tipo
      `) as any[];
      const kpis: Record<string, { total: number; avance: number }> = {};
      kpiRows.forEach((k: any) => { kpis[k.tipo] = { total: toNumOrNull(k.total) ?? 0, avance: toNumOrNull(k.avance) ?? 0 }; });
      return response.status(200).json({ data: kpis, meta: {}, errors: [] });
    }

    // Lista las hojas configuradas para un proyecto (puede haber varias, ej.
    // San Jacinto con una por contrato/fase) -- el frontend arma el selector
    // con esto antes de pedir los datos pesados de ninguna en particular.
    if (request.method === 'GET' && request.query.seguimiento === 'listaHojas') {
      const projectId = Number(request.query.projectId);
      if (!Number.isInteger(projectId) || projectId <= 0) {
        return response.status(400).json({ data: null, meta: {}, errors: ['El id del proyecto es obligatorio.'] });
      }
      const sheets = await listSeguimientoSheets(sql, projectId);
      return response.status(200).json({ data: sheets, meta: { total: sheets.length }, errors: [] });
    }

    // Lista las pestañas del archivo (Hoja de Google o Excel) ya vinculado a
    // una hoja de seguimiento, para que el usuario elija a mano cuál es la
    // del cronograma -- no todas las fuentes la llaman literalmente
    // "Cronograma" (ej. "GANTT Fisico"), así que no basta con adivinar.
    if (request.method === 'GET' && request.query.seguimiento === 'listaPestanas') {
      const seguimientoId = Number(request.query.seguimientoId);
      if (!Number.isInteger(seguimientoId) || seguimientoId <= 0) {
        return response.status(400).json({ data: null, meta: {}, errors: ['El id de la hoja de seguimiento es obligatorio.'] });
      }
      const [config] = (await sql`
        SELECT spreadsheet_id AS "spreadsheetId" FROM seguimiento_config WHERE seguimiento_id = ${seguimientoId}
      `) as any[];
      if (!config?.spreadsheetId) {
        return response.status(400).json({ data: null, meta: {}, errors: ['Esta hoja todavía no tiene un archivo vinculado.'] });
      }
      const accessToken = await getConnectedAccessToken(sql);
      if (!accessToken) {
        return response.status(400).json({ data: null, meta: {}, errors: ['Conecta una cuenta de Google (Fuentes Drive) para poder leer el archivo.'] });
      }
      try {
        const fileMeta = await getDriveFileMeta(accessToken, config.spreadsheetId);
        let tabs: SheetTab[];
        if (fileMeta.mimeType === GOOGLE_SHEETS_MIME) {
          tabs = await listSheetTabs(accessToken, config.spreadsheetId);
        } else if (isExcelMimeType(fileMeta.mimeType)) {
          const buffer = await downloadDriveFileBuffer(accessToken, config.spreadsheetId);
          const workbook = await loadExcelWorkbook(buffer);
          tabs = workbook.worksheets.map((ws) => ({ id: ws.name, name: ws.name }));
        } else {
          return response.status(400).json({
            data: null, meta: {},
            errors: [`El archivo vinculado ("${fileMeta.name}") no es ni una Hoja de Google ni un Excel (.xlsx).`],
          });
        }
        return response.status(200).json({ data: tabs, meta: { total: tabs.length }, errors: [] });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No fue posible listar las pestañas del archivo.';
        return response.status(502).json({ data: null, meta: {}, errors: [message] });
      }
    }

    if (request.method === 'GET' && request.query.seguimiento === 'cronograma') {
      const seguimientoId = Number(request.query.seguimientoId);
      if (!Number.isInteger(seguimientoId) || seguimientoId <= 0) {
        return response.status(400).json({ data: null, meta: {}, errors: ['El id de la hoja de seguimiento es obligatorio.'] });
      }
      const data = await fetchSeguimiento(sql, seguimientoId);
      return response.status(200).json({ data, meta: {}, errors: [] });
    }

    // Datos del formato "Gantt mensual" (ver importGanttMensual) -- se pide
    // aparte de "cronograma" porque solo aplica cuando config.formato es
    // 'gantt_mensual'.
    if (request.method === 'GET' && request.query.seguimiento === 'gantt') {
      const seguimientoId = Number(request.query.seguimientoId);
      if (!Number.isInteger(seguimientoId) || seguimientoId <= 0) {
        return response.status(400).json({ data: null, meta: {}, errors: ['El id de la hoja de seguimiento es obligatorio.'] });
      }
      const rows = (await sql`
        SELECT tipo, orden, actividad, descripcion, sub_actividad AS "subActividad", meta, unidad,
          meses, plan_meses AS "plan", ejecutado_meses AS "ejecutado"
        FROM seguimiento_gantt_subactividades WHERE seguimiento_id = ${seguimientoId} ORDER BY tipo ASC, orden ASC
      `) as any[];
      const toSubactividad = (r: any) => ({
        actividad: r.actividad, descripcion: r.descripcion, subActividad: r.subActividad,
        meta: toNumOrNull(r.meta) ?? 0, unidad: r.unidad,
        plan: (r.plan as number[]).map((v) => toNumOrNull(v) ?? 0),
        ejecutado: (r.ejecutado as number[]).map((v) => toNumOrNull(v) ?? 0),
      });
      const fisicoRows = rows.filter((r) => r.tipo === 'fisico');
      const financieroRows = rows.filter((r) => r.tipo === 'financiero');
      const resumenRow = rows.find((r) => r.tipo === 'resumen');
      const data = {
        meses: (fisicoRows[0]?.meses || financieroRows[0]?.meses || []) as string[],
        fisico: fisicoRows.map(toSubactividad),
        financiero: financieroRows.length > 0 ? financieroRows.map(toSubactividad) : null,
        resumenFinanciero: resumenRow
          ? {
              totalPlanificado: toNumOrNull(resumenRow.meta) ?? 0,
              planificadoAcumulado: (resumenRow.plan as number[]).map((v) => toNumOrNull(v) ?? 0),
              ejecutadoAcumulado: (resumenRow.ejecutado as number[]).map((v) => toNumOrNull(v) ?? 0),
            }
          : null,
      };
      return response.status(200).json({ data, meta: {}, errors: [] });
    }

    // "Ver insumos": bajo demanda por línea, para no traer las ~900 filas de
    // Insumos Detalle en la carga principal de Seguimiento.
    if (request.method === 'GET' && request.query.seguimiento === 'insumos') {
      const seguimientoId = Number(request.query.seguimientoId);
      const linea = typeof request.query.linea === 'string' ? request.query.linea : '';
      if (!Number.isInteger(seguimientoId) || seguimientoId <= 0 || !linea) {
        return response.status(400).json({ data: null, meta: {}, errors: ['El id de la hoja de seguimiento y la línea productiva son obligatorios.'] });
      }
      const insumos = (await sql`
        SELECT insumo, unidad, componente, proceso, cantidad, beneficiarios,
          TO_CHAR(fecha_compra, 'YYYY-MM-DD') AS "fechaCompra", TO_CHAR(fecha_entrega, 'YYYY-MM-DD') AS "fechaEntrega",
          nota_entrega AS "notaEntrega", llego, estado, tanda
        FROM seguimiento_insumos_detalle
        WHERE seguimiento_id = ${seguimientoId} AND linea_productiva = ${linea}
        ORDER BY insumo_id ASC
      `) as any[];
      return response.status(200).json({ data: insumos, meta: { total: insumos.length }, errors: [] });
    }

    // Crea una hoja de seguimiento NUEVA para un proyecto -- un proyecto
    // puede tener varias (ej. una por contrato/fase, todas con el mismo
    // formato). spreadsheetId/cronogramaGid/driveFolderUrl son opcionales
    // acá: se puede crear "en blanco" (solo el nombre) y vincular la hoja
    // de cálculo después con "Cambiar hoja".
    if (request.method === 'POST' && request.body?.kind === 'seguimientoCreateSheet') {
      if (!(await canEditModuleRequest(request, sql, 'seguimiento'))) {
        return response.status(403).json({ data: null, meta: {}, errors: ['No tienes permiso de edición en Seguimiento.'] });
      }
      const projectId = Number(request.body?.projectId);
      if (!Number.isInteger(projectId) || projectId <= 0) {
        return response.status(400).json({ data: null, meta: {}, errors: ['El id del proyecto es obligatorio.'] });
      }
      const nombre = String(request.body?.nombre ?? '').trim() || 'Principal';
      const { spreadsheetId, cronogramaGid, driveFolderUrl } = request.body ?? {};
      const rows = await sql`
        INSERT INTO seguimiento_config (proyecto_id, nombre, spreadsheet_id, cronograma_gid, drive_folder_url)
        VALUES (
          ${projectId}, ${nombre},
          ${spreadsheetId ? String(spreadsheetId).trim() : null}, ${cronogramaGid ? String(cronogramaGid).trim() : null},
          ${driveFolderUrl ? String(driveFolderUrl).trim() : null}
        )
        RETURNING seguimiento_id AS "seguimientoId", nombre, spreadsheet_id AS "spreadsheetId", cronograma_gid AS "cronogramaGid"
      `;
      return response.status(201).json({ data: rows[0], meta: {}, errors: [] });
    }

    if (request.method === 'DELETE' && request.query.seguimiento === 'hoja') {
      if (!(await isAdminRequest(request, sql))) {
        return response.status(403).json({ data: null, meta: {}, errors: ['Solo un administrador puede eliminar una hoja de seguimiento.'] });
      }
      const seguimientoId = Number(request.query.seguimientoId);
      if (!Number.isInteger(seguimientoId) || seguimientoId <= 0) {
        return response.status(400).json({ data: null, meta: {}, errors: ['El id de la hoja de seguimiento es obligatorio.'] });
      }
      const deleted = await sql`DELETE FROM seguimiento_config WHERE seguimiento_id = ${seguimientoId} RETURNING seguimiento_id AS id`;
      if (!deleted[0]) return response.status(404).json({ data: null, meta: {}, errors: ['Esa hoja de seguimiento ya no existe.'] });
      return response.status(200).json({ data: deleted[0], meta: {}, errors: [] });
    }

    if (request.method === 'POST' && request.body?.kind === 'seguimientoInsumosColumnas') {
      if (!(await isAdminRequest(request, sql))) {
        return response.status(403).json({ data: null, meta: {}, errors: ['Solo un administrador puede configurar las columnas visibles.'] });
      }
      const seguimientoId = Number(request.body?.seguimientoId);
      if (!Number.isInteger(seguimientoId) || seguimientoId <= 0) {
        return response.status(400).json({ data: null, meta: {}, errors: ['El id de la hoja de seguimiento es obligatorio.'] });
      }
      const columnas = request.body?.columnas;
      if (columnas !== null && !Array.isArray(columnas)) {
        return response.status(400).json({ data: null, meta: {}, errors: ['El listado de columnas debe ser un arreglo o null.'] });
      }
      const columnasJson = columnas === null ? null : JSON.stringify(columnas.map((c: unknown) => String(c)));
      const rows = await sql`
        UPDATE seguimiento_config SET insumos_columnas_visibles = ${columnasJson}::jsonb
        WHERE seguimiento_id = ${seguimientoId}
        RETURNING insumos_columnas_visibles AS "insumosColumnasVisibles"
      `;
      if (rows.length === 0) {
        return response.status(404).json({ data: null, meta: {}, errors: ['Esa hoja de seguimiento ya no existe.'] });
      }
      return response.status(200).json({ data: rows[0], meta: {}, errors: [] });
    }

    if (request.method === 'POST' && request.body?.kind === 'seguimientoDriveFolder') {
      if (!(await canEditModuleRequest(request, sql, 'seguimiento'))) {
        return response.status(403).json({ data: null, meta: {}, errors: ['No tienes permiso de edición en Seguimiento.'] });
      }
      const seguimientoId = Number(request.body?.seguimientoId);
      if (!Number.isInteger(seguimientoId) || seguimientoId <= 0) {
        return response.status(400).json({ data: null, meta: {}, errors: ['El id de la hoja de seguimiento es obligatorio.'] });
      }
      const driveFolderUrl = String(request.body?.driveFolderUrl ?? '').trim();
      if (!driveFolderUrl) {
        return response.status(400).json({ data: null, meta: {}, errors: ['El link de la carpeta de Drive es obligatorio.'] });
      }
      const rows = await sql`
        UPDATE seguimiento_config SET drive_folder_url = ${driveFolderUrl}
        WHERE seguimiento_id = ${seguimientoId}
        RETURNING drive_folder_url AS "driveFolderUrl"
      `;
      if (rows.length === 0) {
        return response.status(404).json({ data: null, meta: {}, errors: ['Esa hoja de seguimiento ya no existe.'] });
      }
      return response.status(200).json({ data: rows[0], meta: {}, errors: [] });
    }

    if (request.method === 'POST' && (request.body?.kind === 'importCronograma' || request.body?.kind === 'seguimientoConfig')) {
      if (!(await canEditModuleRequest(request, sql, 'seguimiento'))) {
        return response.status(403).json({ data: null, meta: {}, errors: ['No tienes permiso de edición en Seguimiento.'] });
      }
      const seguimientoId = Number(request.body?.seguimientoId);
      if (!Number.isInteger(seguimientoId) || seguimientoId <= 0) {
        return response.status(400).json({ data: null, meta: {}, errors: ['El id de la hoja de seguimiento es obligatorio.'] });
      }

      if (request.body.kind === 'seguimientoConfig') {
        const { spreadsheetId, cronogramaGid } = request.body ?? {};
        if (!spreadsheetId) {
          return response.status(400).json({ data: null, meta: {}, errors: ['El id o link del archivo es obligatorio.'] });
        }
        // El gid solo aplica a Hojas de Google (un .xlsx de Drive no tiene
        // ese concepto -- su pestaña del cronograma se ubica por nombre).
        const rows = await sql`
          UPDATE seguimiento_config SET spreadsheet_id = ${String(spreadsheetId).trim()}, cronograma_gid = ${cronogramaGid ? String(cronogramaGid).trim() : null}
          WHERE seguimiento_id = ${seguimientoId}
          RETURNING spreadsheet_id AS "spreadsheetId", cronograma_gid AS "cronogramaGid"
        `;
        if (rows.length === 0) {
          return response.status(404).json({ data: null, meta: {}, errors: ['Esa hoja de seguimiento ya no existe.'] });
        }
        return response.status(200).json({ data: rows[0], meta: {}, errors: [] });
      }

      try {
        const result = await importSeguimiento(sql, seguimientoId);
        await sql`UPDATE seguimiento_config SET ultima_importacion = NOW(), ultimo_error = NULL WHERE seguimiento_id = ${seguimientoId}`;
        return response.status(200).json({ data: result, meta: {}, errors: [] });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No fue posible importar el seguimiento.';
        await sql`UPDATE seguimiento_config SET ultimo_error = ${message} WHERE seguimiento_id = ${seguimientoId}`;
        return response.status(502).json({ data: null, meta: {}, errors: [message] });
      }
    }

    if (request.method === 'DELETE') {
      const projectId = Number(request.query.id);

      if (!Number.isInteger(projectId) || projectId <= 0) {
        return response.status(400).json({
          data: null,
          meta: {},
          errors: ['El id del proyecto es obligatorio.'],
        });
      }

      const deletedProjects = await sql`
        DELETE FROM proyectos
        WHERE proyecto_id = ${projectId}
        RETURNING proyecto_id AS id
      `;

      if (!deletedProjects[0]) {
        return response.status(404).json({
          data: null,
          meta: {},
          errors: ['Proyecto no encontrado.'],
        });
      }

      return response.status(200).json({
        data: deletedProjects[0],
        meta: {},
        errors: [],
      });
    }

    if (request.method === 'PATCH') {
      const projectId = Number(request.body?.id);
      const hasStartDate = Object.prototype.hasOwnProperty.call(request.body ?? {}, 'startDate');
      const hasEndDate = Object.prototype.hasOwnProperty.call(request.body ?? {}, 'endDate');
      const { startDate, endDate } = request.body ?? {};

      if (!Number.isInteger(projectId) || projectId <= 0) {
        return response.status(400).json({ data: null, meta: {}, errors: ['El id del proyecto es obligatorio.'] });
      }
      if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
        return response.status(400).json({ data: null, meta: {}, errors: ['Fecha de inicio inválida.'] });
      }
      if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        return response.status(400).json({ data: null, meta: {}, errors: ['Fecha de fin inválida.'] });
      }

      const hasAutoAlerts = Object.prototype.hasOwnProperty.call(request.body ?? {}, 'autoAlertsEnabled');

      const currentProjects = await sql`SELECT fecha_inicio, fecha_fin, alertas_automaticas FROM proyectos WHERE proyecto_id = ${projectId}`;
      if (!currentProjects[0]) {
        return response.status(404).json({ data: null, meta: {}, errors: ['Proyecto no encontrado.'] });
      }

      const nextStartDate = hasStartDate ? (startDate || null) : currentProjects[0].fecha_inicio;
      const nextEndDate = hasEndDate ? (endDate || null) : currentProjects[0].fecha_fin;
      const nextAutoAlerts = hasAutoAlerts ? Boolean(request.body.autoAlertsEnabled) : currentProjects[0].alertas_automaticas;

      const updatedProjects = await sql`
        UPDATE proyectos
        SET fecha_inicio = ${nextStartDate}, fecha_fin = ${nextEndDate}, alertas_automaticas = ${nextAutoAlerts}
        WHERE proyecto_id = ${projectId}
        RETURNING proyecto_id AS id, TO_CHAR(fecha_inicio, 'YYYY-MM-DD') AS "startDate", TO_CHAR(fecha_fin, 'YYYY-MM-DD') AS "endDate", alertas_automaticas AS "autoAlertsEnabled"
      `;

      // "Tipos de Informe Aplicables": antes esto solo actualizaba estado
      // local en el navegador y nunca llegaba a la base de datos — se veía
      // "guardado" pero se perdía al recargar. Reemplaza por completo las
      // filas de proyecto_tipo_informe para este proyecto.
      let applicableTypeIds: string[] | undefined;
      if (Object.prototype.hasOwnProperty.call(request.body ?? {}, 'applicableTypeIds')) {
        const rawIds = request.body.applicableTypeIds;
        if (!Array.isArray(rawIds)) {
          return response.status(400).json({ data: null, meta: {}, errors: ['applicableTypeIds debe ser una lista.'] });
        }
        await sql`DELETE FROM proyecto_tipo_informe WHERE proyecto_id = ${projectId}`;
        for (const typeId of rawIds) {
          await sql`INSERT INTO proyecto_tipo_informe (proyecto_id, tipo_informe_id) VALUES (${projectId}, ${typeId})`;
        }
        applicableTypeIds = rawIds.map(String);
      }

      return response.status(200).json({
        data: { ...updatedProjects[0], ...(applicableTypeIds !== undefined ? { applicableTypeIds } : {}) },
        meta: {},
        errors: [],
      });
    }

    if (request.method === 'POST') {
      const { name, bpin, company, startDate, endDate } = request.body ?? {};

      if (
        typeof name !== 'string' ||
        !name.trim() ||
        typeof bpin !== 'string' ||
        !bpin.trim() ||
        typeof company !== 'string' ||
        !company.trim()
      ) {
        return response.status(400).json({
          data: null,
          meta: {},
          errors: ['Nombre, BPIN y empresa son obligatorios.'],
        });
      }

      const existingBpin = await sql`
        SELECT proyecto_id
        FROM proyectos
        WHERE bpin = ${bpin.trim()}
        LIMIT 1
      `;

      if (existingBpin[0]) {
        return response.status(409).json({
          data: null,
          meta: {},
          errors: ['Ya existe un proyecto registrado con este BPIN.'],
        });
      }

      const existingCompanies = await sql`
        SELECT empresa_id
        FROM empresas
        WHERE nombre = ${company.trim()}
        LIMIT 1
      `;

      let companyId = existingCompanies[0]?.empresa_id;

      if (!companyId) {
        const insertedCompanies = await sql`
          INSERT INTO empresas (empresa_id, nombre)
          VALUES (
            COALESCE((SELECT MAX(empresa_id) FROM empresas), 0) + 1,
            ${company.trim()}
          )
          RETURNING empresa_id
        `;
        companyId = insertedCompanies[0]?.empresa_id;
      }

      if (!companyId) {
        throw new Error('No fue posible crear la empresa.');
      }

      const projects = await sql`
        INSERT INTO proyectos (proyecto_id, empresa_id, nombre, bpin, fecha_inicio, fecha_fin)
        VALUES (
          COALESCE((SELECT MAX(proyecto_id) FROM proyectos), 0) + 1,
          ${companyId},
          ${name.trim()},
          ${bpin.trim()},
          ${startDate || null},
          ${endDate || null}
        )
        RETURNING proyecto_id AS id, nombre AS name, bpin, activo AS active, alertas_automaticas AS "autoAlertsEnabled", empresa_id AS company_id, TO_CHAR(fecha_inicio, 'YYYY-MM-DD') AS "startDate", TO_CHAR(fecha_fin, 'YYYY-MM-DD') AS "endDate"
      `;

      const project = projects[0];

      return response.status(201).json({
        data: {
          ...project,
          company_name: company.trim(),
          applicable_type_ids: [],
        },
        meta: {},
        errors: [],
      });
    }

    const projects = await sql`
      SELECT
        p.proyecto_id AS id,
        p.nombre AS name,
        p.bpin,
        p.activo AS active,
        p.alertas_automaticas AS "autoAlertsEnabled",
        TO_CHAR(p.fecha_inicio, 'YYYY-MM-DD') AS "startDate",
        TO_CHAR(p.fecha_fin, 'YYYY-MM-DD') AS "endDate",
        e.empresa_id AS company_id,
        e.nombre AS company_name,
        COALESCE(
          ARRAY_AGG(pti.tipo_informe_id) FILTER (WHERE pti.tipo_informe_id IS NOT NULL),
          ARRAY[]::bigint[]
        ) AS applicable_type_ids
      FROM proyectos p
      LEFT JOIN empresas e ON e.empresa_id = p.empresa_id
      LEFT JOIN proyecto_tipo_informe pti ON pti.proyecto_id = p.proyecto_id
      GROUP BY p.proyecto_id, e.empresa_id, e.nombre
      ORDER BY p.nombre ASC
    `;

    return response.status(200).json({
      data: projects,
      meta: { total: projects.length },
      errors: [],
    });
  } catch (error) {
    console.error('Projects query failed', error);

    if ((error as { code?: string })?.code === '23505') {
      return response.status(409).json({
        data: null,
        meta: {},
        errors: ['Ya existe un proyecto registrado con este BPIN.'],
      });
    }

    return response.status(503).json({
      data: null,
      meta: {},
      errors: ['No fue posible consultar los proyectos.'],
    });
  }
}