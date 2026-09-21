import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isAdminRequest } from '../../server/admin-auth.js';
import { getGoogleOAuthClient } from '../../server/google-oauth.js';
import { getSheetTitleByGid, getSheetGridWithBackgrounds } from '../../server/google-sheets.js';
import { parseCronograma } from '../../server/cronograma-parser.js';
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

async function fetchCronograma(sql: SqlClient, projectId: number) {
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

  const rowIds = rows.map((r: any) => r.id);
  const segments = rowIds.length
    ? ((await sql`
        SELECT fila_id AS "rowId", TO_CHAR(fecha_inicio, 'YYYY-MM-DD') AS start, TO_CHAR(fecha_fin, 'YYYY-MM-DD') AS "end", color
        FROM seguimiento_cronograma_segmentos WHERE fila_id = ANY(${rowIds}) ORDER BY fecha_inicio ASC
      `) as any[])
    : [];

  const days = Array.from(new Set(segments.flatMap((s: any) => [s.start, s.end]))).sort();

  return {
    config: config || null,
    days,
    rows: rows.map((r: any) => ({ ...r, segments: segments.filter((s: any) => s.rowId === r.id) })),
  };
}

async function importCronograma(sql: SqlClient, projectId: number) {
  const [config] = (await sql`
    SELECT spreadsheet_id AS "spreadsheetId", cronograma_gid AS "cronogramaGid"
    FROM seguimiento_config WHERE proyecto_id = ${projectId}
  `) as any[];
  if (!config) throw new Error('Este proyecto no tiene configurada una hoja de cálculo de seguimiento.');

  const accessToken = await getConnectedAccessToken(sql);
  if (!accessToken) throw new Error('Conecta una cuenta de Google (Fuentes Drive) para poder leer la hoja de cálculo.');

  const sheetTitle = await getSheetTitleByGid(accessToken, config.spreadsheetId, config.cronogramaGid);
  const grid = await getSheetGridWithBackgrounds(accessToken, config.spreadsheetId, sheetTitle);
  const parsed = parseCronograma(grid);

  await sql`DELETE FROM seguimiento_cronograma_filas WHERE proyecto_id = ${projectId}`;
  let orden = 0;
  for (const row of parsed.rows) {
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

  return { rowsImported: parsed.rows.length, daysDetected: parsed.days.length };
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
      await importCronograma(sql, config.projectId);
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
      const data = await fetchCronograma(sql, projectId);
      return response.status(200).json({ data, meta: {}, errors: [] });
    }

    if (request.method === 'POST' && (request.body?.kind === 'importCronograma' || request.body?.kind === 'seguimientoConfig')) {
      if (!(await isAdminRequest(request, sql))) {
        return response.status(403).json({ data: null, meta: {}, errors: ['Solo un administrador puede gestionar el seguimiento.'] });
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
        const result = await importCronograma(sql, projectId);
        await sql`UPDATE seguimiento_config SET ultima_importacion = NOW(), ultimo_error = NULL WHERE proyecto_id = ${projectId}`;
        return response.status(200).json({ data: result, meta: {}, errors: [] });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No fue posible importar el cronograma.';
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

      return response.status(200).json({ data: updatedProjects[0], meta: {}, errors: [] });
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