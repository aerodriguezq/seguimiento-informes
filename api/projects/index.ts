import type { VercelRequest, VercelResponse } from '@vercel/node';
import { canEditModuleRequest } from '../../server/admin-auth.js';
import { getGoogleOAuthClient } from '../../server/google-oauth.js';
import { getSheetTitleByGid, getSheetGridWithBackgrounds, getSheetValues } from '../../server/google-sheets.js';
import { parseCronograma } from '../../server/cronograma-parser.js';
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

async function fetchSeguimiento(sql: SqlClient, projectId: number) {
  const [config] = (await sql`
    SELECT spreadsheet_id AS "spreadsheetId", cronograma_gid AS "cronogramaGid",
      ultima_importacion AS "lastImportAt", ultimo_error AS "lastError"
    FROM seguimiento_config WHERE proyecto_id = ${projectId}
  `) as any[];

  const rows = (await sql`
    SELECT fila_id AS id, sub_actividad AS "subActividad", concepto,
      total_toneladas AS "totalToneladas", toneladas_riego_abono AS "toneladasRiegoAbono",
      observaciones, es_resumen AS "isResumen"
    FROM seguimiento_cronograma_filas WHERE proyecto_id = ${projectId} ORDER BY orden ASC
  `) as any[];

  const referencia = (await sql`
    SELECT sub_actividad AS "subActividad", linea_productiva AS "lineaProductiva"
    FROM seguimiento_referencia_lineas WHERE proyecto_id = ${projectId}
  `) as any[];
  const lineaBySub: Record<string, string> = {};
  referencia.forEach((r: any) => { lineaBySub[r.subActividad] = r.lineaProductiva; });

  const pistas = ((await sql`
    SELECT linea_productiva AS "lineaProductiva", pista,
      TO_CHAR(fecha_inicio, 'YYYY-MM-DD') AS "fechaInicio", TO_CHAR(fecha_fin, 'YYYY-MM-DD') AS "fechaFin",
      cantidad_total AS "cantidadTotal", cantidad_entregada AS "cantidadEntregada",
      toneladas_total AS "toneladasTotal", hectareas
    FROM seguimiento_linea_pistas WHERE proyecto_id = ${projectId}
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
    FROM seguimiento_proyeccion WHERE proyecto_id = ${projectId}
  `) as any[]).map((p: any) => ({
    ...p,
    diasEntrega: toNumOrNull(p.diasEntrega),
    beneficiariosPorDia: toNumOrNull(p.beneficiariosPorDia),
    totalToneladasKit: toNumOrNull(p.totalToneladasKit),
  }));
  const proyeccionBySub: Record<string, any> = {};
  proyeccion.forEach((p: any) => { proyeccionBySub[p.subActividad] = p; });

  const kpiRows = (await sql`SELECT tipo, total, avance FROM seguimiento_kpis WHERE proyecto_id = ${projectId}`) as any[];
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

async function importSeguimiento(sql: SqlClient, projectId: number) {
  const [config] = (await sql`
    SELECT spreadsheet_id AS "spreadsheetId", cronograma_gid AS "cronogramaGid"
    FROM seguimiento_config WHERE proyecto_id = ${projectId}
  `) as any[];
  if (!config) throw new Error('Este proyecto no tiene configurada una hoja de cálculo de seguimiento.');

  const accessToken = await getConnectedAccessToken(sql);
  if (!accessToken) throw new Error('Conecta una cuenta de Google (Fuentes Drive) para poder leer la hoja de cálculo.');

  const sheetTitle = await getSheetTitleByGid(accessToken, config.spreadsheetId, config.cronogramaGid);
  const cronogramaGrid = await getSheetGridWithBackgrounds(accessToken, config.spreadsheetId, sheetTitle);
  const parsedCronograma = parseCronograma(cronogramaGrid);
  if (parsedCronograma.rows.length === 0) {
    throw new Error(
      `La pestaña "${sheetTitle}" (gid ${config.cronogramaGid}) no tiene la estructura esperada: no se encontró una fila con encabezado "Sub Actividad" ni columnas de día (1-31). Verifica que sea la pestaña correcta del cronograma con "Cambiar hoja".`,
    );
  }

  const referenciaGrid = await getSheetValues(accessToken, config.spreadsheetId, SEGUIMIENTO_SHEET_NAMES.referenciaLineas);
  const referencia = parseReferenciaLineas(referenciaGrid);

  const insumosGrid = await getSheetValues(accessToken, config.spreadsheetId, SEGUIMIENTO_SHEET_NAMES.insumosDetalle);
  const { compra, entrega } = parseInsumosDetalle(insumosGrid);

  const abonoGrid = await getSheetValues(accessToken, config.spreadsheetId, SEGUIMIENTO_SHEET_NAMES.abono);
  const abono = parseAbono(abonoGrid);

  const mvGrid = await getSheetValues(accessToken, config.spreadsheetId, SEGUIMIENTO_SHEET_NAMES.materialVegetal);
  const materialVegetal = parseMaterialVegetal(mvGrid);

  const entregaInsumosGrid = await getSheetValues(accessToken, config.spreadsheetId, SEGUIMIENTO_SHEET_NAMES.entregaInsumos);
  const entregaInsumos = parseEntregaInsumos(entregaInsumosGrid);

  const estimadaGrid = await getSheetValues(accessToken, config.spreadsheetId, SEGUIMIENTO_SHEET_NAMES.entregaEstimada);
  const proyeccion = parseEntregaEstimada(estimadaGrid);

  const beneficiariosGrid = await getSheetValues(accessToken, config.spreadsheetId, SEGUIMIENTO_SHEET_NAMES.beneficiarios);
  const kpis = parseBeneficiariosKpis(beneficiariosGrid);

  // --- Persistencia: se limpia todo lo del proyecto y se reinserta desde cero. ---
  await sql`DELETE FROM seguimiento_cronograma_filas WHERE proyecto_id = ${projectId}`;
  await sql`DELETE FROM seguimiento_referencia_lineas WHERE proyecto_id = ${projectId}`;
  await sql`DELETE FROM seguimiento_linea_pistas WHERE proyecto_id = ${projectId}`;
  await sql`DELETE FROM seguimiento_proyeccion WHERE proyecto_id = ${projectId}`;
  await sql`DELETE FROM seguimiento_kpis WHERE proyecto_id = ${projectId}`;

  let orden = 0;
  for (const row of parsedCronograma.rows) {
    const inserted = await sql`
      INSERT INTO seguimiento_cronograma_filas
        (proyecto_id, orden, sub_actividad, concepto, total_toneladas, toneladas_riego_abono, observaciones, es_resumen)
      VALUES (${projectId}, ${orden}, ${row.subActividad}, ${row.concepto}, ${row.totalToneladas}, ${row.toneladasRiegoAbono}, ${row.observaciones}, ${row.isResumen})
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
      INSERT INTO seguimiento_referencia_lineas (proyecto_id, sub_actividad, linea_productiva)
      VALUES (${projectId}, ${sub}, ${linea})
    `;
  }

  const insertPista = async (pista: string, byLinea: Record<string, PistaAgg>) => {
    for (const [linea, agg] of Object.entries(byLinea)) {
      await sql`
        INSERT INTO seguimiento_linea_pistas
          (proyecto_id, linea_productiva, pista, fecha_inicio, fecha_fin, cantidad_total, cantidad_entregada, toneladas_total, hectareas)
        VALUES (${projectId}, ${linea}, ${pista}, ${agg.fechaInicio}, ${agg.fechaFin}, ${agg.total}, ${agg.entregado}, ${agg.toneladas}, ${agg.hectareas})
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
      INSERT INTO seguimiento_proyeccion (proyecto_id, sub_actividad, fecha_inicio, fecha_fin, dias_entrega, beneficiarios_por_dia, total_toneladas_kit)
      VALUES (${projectId}, ${sub}, ${p.fechaInicio}, ${p.fechaFin}, ${p.diasEntrega}, ${p.beneficiariosPorDia}, ${p.totalToneladasKit})
    `;
  }

  const kpiEntries: [string, Kpi][] = [['insumo', kpis.insumo], ['abono', kpis.abono], ['material_vegetal', kpis.materialVegetal]];
  for (const [tipo, k] of kpiEntries) {
    await sql`INSERT INTO seguimiento_kpis (proyecto_id, tipo, total, avance) VALUES (${projectId}, ${tipo}, ${k.total}, ${k.avance})`;
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
  const configs = (await sql`SELECT proyecto_id AS "projectId" FROM seguimiento_config`) as any[];
  let imported = 0;
  let failed = 0;
  for (const config of configs) {
    try {
      await importSeguimiento(sql, config.projectId);
      await sql`UPDATE seguimiento_config SET ultima_importacion = NOW(), ultimo_error = NULL WHERE proyecto_id = ${config.projectId}`;
      imported++;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No fue posible importar el cronograma.';
      await sql`UPDATE seguimiento_config SET ultimo_error = ${message} WHERE proyecto_id = ${config.projectId}`;
      failed++;
    }
  }
  return { projectsChecked: configs.length, imported, failed };
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

    if (request.method === 'GET' && request.query.seguimiento === 'cronograma') {
      const projectId = Number(request.query.projectId);
      if (!Number.isInteger(projectId) || projectId <= 0) {
        return response.status(400).json({ data: null, meta: {}, errors: ['El id del proyecto es obligatorio.'] });
      }
      const data = await fetchSeguimiento(sql, projectId);
      return response.status(200).json({ data, meta: {}, errors: [] });
    }

    if (request.method === 'POST' && (request.body?.kind === 'importCronograma' || request.body?.kind === 'seguimientoConfig')) {
      if (!(await canEditModuleRequest(request, sql, 'seguimiento'))) {
        return response.status(403).json({ data: null, meta: {}, errors: ['No tienes permiso de edición en Seguimiento.'] });
      }
      const projectId = Number(request.body?.projectId);
      if (!Number.isInteger(projectId) || projectId <= 0) {
        return response.status(400).json({ data: null, meta: {}, errors: ['El id del proyecto es obligatorio.'] });
      }

      if (request.body.kind === 'seguimientoConfig') {
        const { spreadsheetId, cronogramaGid } = request.body ?? {};
        if (!spreadsheetId || !cronogramaGid) {
          return response.status(400).json({ data: null, meta: {}, errors: ['El id de la hoja y el gid de la pestaña son obligatorios.'] });
        }
        const rows = await sql`
          INSERT INTO seguimiento_config (proyecto_id, spreadsheet_id, cronograma_gid)
          VALUES (${projectId}, ${String(spreadsheetId).trim()}, ${String(cronogramaGid).trim()})
          ON CONFLICT (proyecto_id) DO UPDATE SET spreadsheet_id = EXCLUDED.spreadsheet_id, cronograma_gid = EXCLUDED.cronograma_gid
          RETURNING spreadsheet_id AS "spreadsheetId", cronograma_gid AS "cronogramaGid"
        `;
        return response.status(200).json({ data: rows[0], meta: {}, errors: [] });
      }

      try {
        const result = await importSeguimiento(sql, projectId);
        await sql`UPDATE seguimiento_config SET ultima_importacion = NOW(), ultimo_error = NULL WHERE proyecto_id = ${projectId}`;
        return response.status(200).json({ data: result, meta: {}, errors: [] });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No fue posible importar el seguimiento.';
        await sql`UPDATE seguimiento_config SET ultimo_error = ${message} WHERE proyecto_id = ${projectId}`;
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

      const currentProjects = await sql`SELECT fecha_inicio, fecha_fin FROM proyectos WHERE proyecto_id = ${projectId}`;
      if (!currentProjects[0]) {
        return response.status(404).json({ data: null, meta: {}, errors: ['Proyecto no encontrado.'] });
      }

      const nextStartDate = hasStartDate ? (startDate || null) : currentProjects[0].fecha_inicio;
      const nextEndDate = hasEndDate ? (endDate || null) : currentProjects[0].fecha_fin;

      const updatedProjects = await sql`
        UPDATE proyectos
        SET fecha_inicio = ${nextStartDate}, fecha_fin = ${nextEndDate}
        WHERE proyecto_id = ${projectId}
        RETURNING proyecto_id AS id, TO_CHAR(fecha_inicio, 'YYYY-MM-DD') AS "startDate", TO_CHAR(fecha_fin, 'YYYY-MM-DD') AS "endDate"
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
        RETURNING proyecto_id AS id, nombre AS name, bpin, activo AS active, empresa_id AS company_id, TO_CHAR(fecha_inicio, 'YYYY-MM-DD') AS "startDate", TO_CHAR(fecha_fin, 'YYYY-MM-DD') AS "endDate"
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