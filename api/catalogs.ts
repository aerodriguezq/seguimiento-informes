import type { VercelRequest, VercelResponse } from '@vercel/node';
import { canEditModuleRequest } from '../server/admin-auth.js';
import { sendEmail, buildPeticionAssignedEmailHtml } from '../server/google-gmail.js';
import { ensureDriveFolder, uploadDriveFile, extractDriveFolderId } from '../server/google-drive.js';

// fecha_plazo_respuesta siempre se recalcula a partir de fecha_radicacion +
// plazo_respuesta (días calendario) — es un dato derivado, no editable a mano.
function computeFechaPlazo(fechaRadicacion: string | null, plazoRespuesta: number | null): string | null {
  if (!fechaRadicacion || plazoRespuesta === null || !Number.isFinite(plazoRespuesta)) return null;
  const d = new Date(`${fechaRadicacion}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + plazoRespuesta);
  return d.toISOString().slice(0, 10);
}

// Radicado automático: AÑO-EMPRESA-CONSECUTIVO (ej. 2026-CRI-00001). El
// consecutivo reinicia cada año por empresa. Se usa el código corto de la
// empresa (empresas.codigo); si no tiene código configurado, se cae al
// nombre completo en mayúsculas sin espacios, para no dejar el radicado sin
// esa parte.
async function generateRadicado(sql: any, empresaId: number, year: number): Promise<string> {
  const [empresa] = (await sql`SELECT nombre AS name, codigo AS code FROM empresas WHERE empresa_id = ${empresaId}`) as any[];
  const empresaTag = (empresa?.code || empresa?.name || 'GEN').toString().trim().toUpperCase().replace(/\s+/g, '');
  const [{ count }] = (await sql`
    SELECT COUNT(*) AS count FROM peticiones WHERE empresa_id = ${empresaId} AND EXTRACT(YEAR FROM created_at) = ${year}
  `) as any[];
  const consecutive = Number(count) + 1;
  return `${year}-${empresaTag}-${String(consecutive).padStart(5, '0')}`;
}

async function fetchResponsables(sql: any, peticionId: number) {
  const rows = (await sql`
    SELECT c.contacto_id AS id, c.nombre AS name, COALESCE(c.email, '') AS email
    FROM peticion_responsables pr JOIN contactos c ON c.contacto_id = pr.contacto_id
    WHERE pr.peticion_id = ${peticionId}
  `) as any[];
  return rows.map((r) => ({ id: String(r.id), name: r.name, email: r.email }));
}

async function setResponsables(sql: any, peticionId: number, responsableIds: unknown[]) {
  await sql`DELETE FROM peticion_responsables WHERE peticion_id = ${peticionId}`;
  for (const contactId of responsableIds) {
    const id = Number(contactId);
    if (Number.isInteger(id) && id > 0) {
      await sql`INSERT INTO peticion_responsables (peticion_id, contacto_id) VALUES (${peticionId}, ${id}) ON CONFLICT DO NOTHING`;
    }
  }
}

async function fetchPeticionProyectos(sql: any, peticionId: number) {
  const rows = (await sql`
    SELECT p.proyecto_id AS id, p.nombre AS name
    FROM peticion_proyectos pp JOIN proyectos p ON p.proyecto_id = pp.proyecto_id
    WHERE pp.peticion_id = ${peticionId}
  `) as any[];
  return rows.map((r) => ({ id: String(r.id), name: r.name }));
}

async function setPeticionProyectos(sql: any, peticionId: number, proyectoIds: unknown[]) {
  await sql`DELETE FROM peticion_proyectos WHERE peticion_id = ${peticionId}`;
  for (const projectId of proyectoIds) {
    const id = Number(projectId);
    if (Number.isInteger(id) && id > 0) {
      await sql`INSERT INTO peticion_proyectos (peticion_id, proyecto_id) VALUES (${peticionId}, ${id}) ON CONFLICT DO NOTHING`;
    }
  }
}

// Correo de "te asignaron esta petición" — se envía una sola vez a cada
// responsable nuevo (al crear la petición, o al agregarlo después), nunca
// se repite en cada edición posterior (eso ya lo cubren los recordatorios
// escalonados).
async function notifyNewPeticionResponsables(
  sql: any,
  peticion: {
    id: number; radicado: string; asunto: string; peticionario: string; areaConsolida: string;
    plazoRespuesta: number | null; fechaPlazoRespuesta: string | null; correoPersonaAsignada: string | null;
    observaciones?: string | null;
  },
  allResponsables: { id: string; name: string; email: string }[],
  newlyAssignedIds: string[],
) {
  const toNotify = allResponsables.filter((r) => newlyAssignedIds.includes(r.id) && r.email);
  if (toNotify.length === 0) return;

  const accessToken = await getConnectedAccessToken(sql);
  if (!accessToken) return; // Sin cuenta de Google conectada, no se puede notificar -- no es un error fatal.

  const actionUrl = `${(process.env.APP_URL || 'https://seguimiento-informes.vercel.app').replace(/\/$/, '')}/peticiones`;
  const html = buildPeticionAssignedEmailHtml({
    radicado: peticion.radicado,
    asunto: peticion.asunto,
    peticionario: peticion.peticionario,
    areaConsolida: peticion.areaConsolida,
    plazoRespuesta: peticion.plazoRespuesta,
    fechaPlazoRespuesta: peticion.fechaPlazoRespuesta,
    observaciones: peticion.observaciones,
    responsables: allResponsables.map((r) => r.name),
    actionUrl,
  });
  try {
    await sendEmail(accessToken, {
      to: toNotify.map((r) => r.email),
      cc: peticion.correoPersonaAsignada && peticion.correoPersonaAsignada.includes('@') ? [peticion.correoPersonaAsignada] : undefined,
      subject: `[Peticiones] Se te asignó: ${peticion.radicado} — ${peticion.asunto}`,
      body: html,
      html: true,
    });
  } catch (error) {
    console.error('No fue posible enviar el correo de asignación de la petición', peticion.id, error);
  }
}

function readCookie(request: VercelRequest, name: string) {
  const cookies = request.headers.cookie?.split(';').map((c) => c.trim()) ?? [];
  const entry = cookies.find((c) => c.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null;
}

async function isAdminRequest(request: VercelRequest, sql: any): Promise<boolean> {
  const sessionId = readCookie(request, 'app_session');
  if (!sessionId) return false;
  const [row] = await sql`
    SELECT u.es_admin AS "isAdmin"
    FROM app_sesiones s
    JOIN usuarios_autorizados u ON u.email = s.email
    WHERE s.session_id = ${sessionId} AND s.expires_at > NOW() AND u.activo = TRUE
  `;
  return Boolean(row?.isAdmin);
}

async function getConnectedAccessToken(sql: any): Promise<string | null> {
  const session = (await sql`
    SELECT token_json FROM google_drive_sessions WHERE expires_at > NOW() ORDER BY created_at DESC LIMIT 1
  `) as any[];
  if (!session[0]) return null;
  const { getGoogleOAuthClient } = await import('../server/google-oauth.js');
  const client = await getGoogleOAuthClient();
  client.setCredentials(JSON.parse(session[0].token_json));
  const token = await client.getAccessToken();
  if (!token.token) throw new Error('La sesión de Google conectada expiró. Reconéctala desde Fuentes Drive.');
  return token.token;
}

const SWEEP_LABELS: Record<string, string> = {
  deteccion_entregas: 'Detección de entregas por correo',
  recordatorios_alertas: 'Recordatorios de alertas',
  importacion_cronograma: 'Importación de cronograma (Seguimiento)',
};

async function fetchSweepConfig(sql: any) {
  const rows = (await sql`
    SELECT kind, activo AS active, frecuencia_minutos AS "frequencyMinutes",
      ultima_ejecucion AS "lastRunAt", ultimo_exito AS "lastRunSuccess", ultimo_resultado AS "lastRunResult"
    FROM barrido_config ORDER BY kind ASC
  `) as any[];
  return rows.map((row) => ({ ...row, label: SWEEP_LABELS[row.kind] || row.kind }));
}

// Ejecuta el barrido ya mismo llamando al propio endpoint (reports.ts o
// alerts/index.ts) con el mismo secreto que usa el cron, pero forzando la
// ejecución sin importar el throttle configurado.
async function triggerSweep(kind: string) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) throw new Error('CRON_SECRET no está configurado en el servidor.');
  const path =
    kind === 'deteccion_entregas' ? '/api/reports'
    : kind === 'recordatorios_alertas' ? '/api/alerts'
    : kind === 'importacion_cronograma' ? '/api/projects'
    : null;
  if (!path) throw new Error('Barrido no reconocido.');

  const baseUrl = (process.env.APP_URL || 'https://seguimiento-informes.vercel.app').replace(/\/$/, '');
  const res = await fetch(`${baseUrl}${path}?force=true`, {
    headers: { Authorization: `Bearer ${cronSecret}` },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.errors?.[0] || `El barrido respondió con estado ${res.status}.`);
  return body?.data;
}

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  if (request.method !== 'GET' && request.method !== 'POST' && request.method !== 'PATCH' && request.method !== 'DELETE') {
    return response.status(405).json({ data: null, meta: {}, errors: ['Método no permitido.'] });
  }

  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl?.trim()) {
      return response.status(503).json({ data: null, meta: {}, errors: ['DATABASE_URL no está configurada.'] });
    }

    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(databaseUrl);

    if (request.method === 'DELETE') {
      if (request.query.kind === 'peticion') {
        if (!(await canEditModuleRequest(request, sql, 'peticiones'))) {
          return response.status(403).json({ data: null, meta: {}, errors: ['No tienes permiso de edición en Peticiones.'] });
        }
        const peticionId = Number(request.query.id);
        if (!Number.isInteger(peticionId) || peticionId <= 0) {
          return response.status(400).json({ data: null, meta: {}, errors: ['El id de la petición es obligatorio.'] });
        }
        const deleted = await sql`DELETE FROM peticiones WHERE peticion_id = ${peticionId} RETURNING peticion_id AS id`;
        if (!deleted[0]) return response.status(404).json({ data: null, meta: {}, errors: ['Petición no encontrada.'] });
        return response.status(200).json({ data: deleted[0], meta: {}, errors: [] });
      }

      if (request.query.kind === 'authorizedUser') {
        if (!(await isAdminRequest(request, sql))) {
          return response.status(403).json({ data: null, meta: {}, errors: ['Solo un administrador puede eliminar usuarios autorizados.'] });
        }
        const email = typeof request.query.email === 'string' ? request.query.email : '';
        if (!email) return response.status(400).json({ data: null, meta: {}, errors: ['El correo es obligatorio.'] });
        const deletedUser = await sql`DELETE FROM usuarios_autorizados WHERE email = ${email} AND es_admin = FALSE RETURNING email`;
        if (!deletedUser[0]) return response.status(404).json({ data: null, meta: {}, errors: ['Usuario no encontrado o es administrador.'] });
        return response.status(200).json({ data: deletedUser[0], meta: {}, errors: [] });
      }

      if (request.query.kind === 'areaConsolida') {
        const areaId = Number(request.query.id);
        if (!Number.isInteger(areaId) || areaId <= 0) {
          return response.status(400).json({ data: null, meta: {}, errors: ['El id del área es obligatorio.'] });
        }
        const deletedArea = await sql`DELETE FROM areas_consolida WHERE area_id = ${areaId} RETURNING area_id AS id`;
        if (!deletedArea[0]) return response.status(404).json({ data: null, meta: {}, errors: ['Área no encontrada.'] });
        return response.status(200).json({ data: deletedArea[0], meta: {}, errors: [] });
      }

      const stepId = Number(request.query.stepId);
      if (!Number.isInteger(stepId) || stepId <= 0) {
        return response.status(400).json({ data: null, meta: {}, errors: ['El id del paso es obligatorio.'] });
      }

      // informes.paso_actual_id apunta a este paso mientras esté "vigente"
      // (incluso ya completado, como registro histórico) — sin limpiar esa
      // referencia primero, el DELETE choca con la FK. Si hay informes
      // ACTIVOS parados justo en este paso, no se puede borrar (bloquearía
      // su flujo); los ya completados solo lo usan para mostrar el nombre,
      // así que se puede desvincular sin problema.
      const [{ activeCount }] = (await sql`
        SELECT COUNT(*) AS "activeCount" FROM informes WHERE paso_actual_id = ${stepId} AND flujo_completado = FALSE
      `) as any[];
      if (Number(activeCount) > 0) {
        return response.status(409).json({
          data: null, meta: {},
          errors: [`No se puede eliminar este paso: ${activeCount} informe(s) están actualmente en él. Espera a que avancen o complétalos antes de eliminarlo.`],
        });
      }
      await sql`UPDATE informes SET paso_actual_id = NULL WHERE paso_actual_id = ${stepId}`;

      // Alertas históricas (ya desactivadas) que quedaron ligadas a este
      // paso también bloquean el DELETE por su propia FK.
      const oldAlerts = (await sql`SELECT alerta_id AS id FROM alertas WHERE paso_id = ${stepId}`) as any[];
      const oldAlertIds = oldAlerts.map((a: any) => a.id);
      if (oldAlertIds.length > 0) {
        await sql`DELETE FROM alerta_contacto WHERE alerta_id = ANY(${oldAlertIds})`;
        await sql`DELETE FROM alerta_dia WHERE alerta_id = ANY(${oldAlertIds})`;
        await sql`DELETE FROM alertas WHERE alerta_id = ANY(${oldAlertIds})`;
      }

      const deleted = await sql`DELETE FROM tipo_informe_pasos WHERE paso_id = ${stepId} RETURNING paso_id AS id`;
      if (!deleted[0]) return response.status(404).json({ data: null, meta: {}, errors: ['Paso no encontrado.'] });
      return response.status(200).json({ data: deleted[0], meta: {}, errors: [] });
    }

    if (request.method === 'GET' && request.query.kind === 'peticiones') {
      const rows = (await sql`
        SELECT p.peticion_id AS id, p.radicado, p.empresa_id AS "empresaId", COALESCE(e.nombre, '') AS "empresaName",
          TO_CHAR(p.fecha_radicacion, 'YYYY-MM-DD') AS "fechaRadicacion",
          p.peticionario, p.asunto, p.area_consolida AS "areaConsolida", p.correo_persona_asignada AS "correoPersonaAsignada",
          p.areas_intervienen AS "areasIntervienen", p.plazo_respuesta AS "plazoRespuesta",
          TO_CHAR(p.fecha_plazo_respuesta, 'YYYY-MM-DD') AS "fechaPlazoRespuesta",
          TO_CHAR(p.fecha_radicado_respuesta, 'YYYY-MM-DD') AS "fechaRadicadoRespuesta",
          p.observaciones, p.drive_folder_url AS "driveFolderUrl",
          p.documento_peticion_nombre AS "documentoPeticionNombre", p.documento_peticion_drive_url AS "documentoPeticionUrl",
          p.documento_respuesta_nombre AS "documentoRespuestaNombre", p.documento_respuesta_drive_url AS "documentoRespuestaUrl",
          p.created_at AS "createdAt"
        FROM peticiones p LEFT JOIN empresas e ON e.empresa_id = p.empresa_id
        ORDER BY COALESCE(p.fecha_radicacion, p.created_at::date) DESC, p.peticion_id DESC
      `) as any[];
      const responsableRows = (await sql`
        SELECT pr.peticion_id AS "peticionId", c.contacto_id AS id, c.nombre AS name, COALESCE(c.email, '') AS email
        FROM peticion_responsables pr JOIN contactos c ON c.contacto_id = pr.contacto_id
      `) as any[];
      const proyectoRows = (await sql`
        SELECT pp.peticion_id AS "peticionId", pr.proyecto_id AS id, pr.nombre AS name
        FROM peticion_proyectos pp JOIN proyectos pr ON pr.proyecto_id = pp.proyecto_id
      `) as any[];
      const data = rows.map((row) => ({
        ...row,
        responsables: responsableRows.filter((r) => r.peticionId === row.id).map((r) => ({ id: String(r.id), name: r.name, email: r.email })),
        proyectos: proyectoRows.filter((r) => r.peticionId === row.id).map((r) => ({ id: String(r.id), name: r.name })),
      }));
      return response.status(200).json({ data, meta: {}, errors: [] });
    }

    if (request.method === 'GET') {
      const isAdmin = await isAdminRequest(request, sql);
      const authorizedUsers = isAdmin
        ? await sql`SELECT email, nombre AS name, es_admin AS "isAdmin", activo AS active, permisos AS permissions FROM usuarios_autorizados ORDER BY created_at ASC`
        : [];
      const sweeps = isAdmin ? await fetchSweepConfig(sql) : [];
      const [reportTypes, contacts, steps, stepContacts, empresas, areasConsolida, peticionesConfigRows] = await Promise.all([
        sql`
          SELECT tipo_informe_id AS id, COALESCE(codigo, '') AS code, nombre AS name,
            periodicidad AS periodicity, descripcion AS description, activo AS active
          FROM tipos_informe ORDER BY nombre ASC
        `,
        sql`
          SELECT c.contacto_id AS id, c.nombre AS name, COALESCE(c.email, '') AS email,
            COALESCE(r.nombre, '') AS role, COALESCE(e.nombre, '') AS company,
            c.telefono AS phone, c.alarma_activa AS "hasNotificationAlarm", c.activo AS active
          FROM contactos c
          LEFT JOIN roles r ON r.rol_id = c.rol_id
          LEFT JOIN empresas e ON e.empresa_id = c.empresa_id
          ORDER BY c.nombre ASC
        `,
        sql`
          SELECT paso_id AS id, tipo_informe_id AS "typeId", proyecto_id AS "projectId", orden AS "order", nombre AS name,
            asunto_correo AS "emailSubject", es_final AS "isFinal", dia_inicio AS "diaInicio", dia_limite AS "diaLimite",
            palabras_clave AS "palabrasClave"
          FROM tipo_informe_pasos ORDER BY tipo_informe_id ASC, proyecto_id ASC NULLS FIRST, orden ASC
        `,
        sql`SELECT paso_id AS "stepId", contacto_id AS "contactId", es_principal AS "isPrincipal" FROM tipo_informe_paso_contacto`,
        sql`SELECT empresa_id AS id, nombre AS name, COALESCE(codigo, '') AS code FROM empresas ORDER BY nombre ASC`,
        sql`SELECT area_id AS id, nombre AS name FROM areas_consolida ORDER BY nombre ASC`,
        sql`SELECT drive_root_folder_id AS "driveRootFolderId", drive_root_folder_url AS "driveRootFolderUrl" FROM peticiones_config WHERE id = 1`,
      ]);
      const peticionesConfig = (peticionesConfigRows as any[])[0] ?? { driveRootFolderId: null, driveRootFolderUrl: null };

      const reportTypeSteps = (steps as any[]).map((step) => {
        const ownContacts = (stepContacts as any[]).filter((sc) => sc.stepId === step.id);
        const principal = ownContacts.find((sc) => sc.isPrincipal);
        return {
          ...step,
          contactIds: ownContacts.map((sc) => String(sc.contactId)),
          principalContactId: principal ? String(principal.contactId) : null,
        };
      });

      return response.status(200).json({ data: { reportTypes, contacts, reportTypeSteps, authorizedUsers, sweeps, isAdmin, empresas, areasConsolida, peticionesConfig }, meta: {}, errors: [] });
    }

    if (request.method === 'PATCH') {
      const body = request.body ?? {};

      if (body.kind === 'contact') {
        if (!(await canEditModuleRequest(request, sql, 'lists'))) {
          return response.status(403).json({ data: null, meta: {}, errors: ['No tienes permiso de edición en Listas Maestras.'] });
        }
        const contactId = Number(body.contactId);
        if (!Number.isInteger(contactId) || contactId <= 0) {
          return response.status(400).json({ data: null, meta: {}, errors: ['El id del contacto es obligatorio.'] });
        }
        const has = (key: string) => Object.prototype.hasOwnProperty.call(body.data ?? {}, key);
        if (!has('hasNotificationAlarm')) {
          return response.status(400).json({ data: null, meta: {}, errors: ['No hay cambios para guardar.'] });
        }
        const rows = await sql`
          UPDATE contactos SET alarma_activa = ${Boolean(body.data.hasNotificationAlarm)}
          WHERE contacto_id = ${contactId}
          RETURNING contacto_id AS id, alarma_activa AS "hasNotificationAlarm"
        `;
        if (!rows[0]) return response.status(404).json({ data: null, meta: {}, errors: ['Contacto no encontrado.'] });
        return response.status(200).json({ data: rows[0], meta: {}, errors: [] });
      }

      if (body.kind === 'reportTypeStepOrder') {
        const stepId = Number(body.stepId);
        const direction = body.direction;
        if (!Number.isInteger(stepId) || stepId <= 0 || (direction !== 'up' && direction !== 'down')) {
          return response.status(400).json({ data: null, meta: {}, errors: ['El paso y la dirección (up/down) son obligatorios.'] });
        }

        const [current] = (await sql`SELECT paso_id AS id, tipo_informe_id AS "typeId", proyecto_id AS "projectId", orden FROM tipo_informe_pasos WHERE paso_id = ${stepId}`) as any[];
        if (!current) return response.status(404).json({ data: null, meta: {}, errors: ['Paso no encontrado.'] });

        // El vecino se busca dentro del MISMO alcance (plantilla general o
        // flujo propio de un proyecto) -- nunca se cruza un paso de la
        // plantilla con uno de un flujo específico de proyecto.
        const projectScope = current.projectId;
        let neighborRows: any[];
        if (projectScope === null) {
          neighborRows = (
            direction === 'up'
              ? await sql`SELECT paso_id AS id, orden FROM tipo_informe_pasos WHERE tipo_informe_id = ${current.typeId} AND proyecto_id IS NULL AND orden < ${current.orden} ORDER BY orden DESC LIMIT 1`
              : await sql`SELECT paso_id AS id, orden FROM tipo_informe_pasos WHERE tipo_informe_id = ${current.typeId} AND proyecto_id IS NULL AND orden > ${current.orden} ORDER BY orden ASC LIMIT 1`
          ) as any[];
        } else {
          neighborRows = (
            direction === 'up'
              ? await sql`SELECT paso_id AS id, orden FROM tipo_informe_pasos WHERE tipo_informe_id = ${current.typeId} AND proyecto_id = ${projectScope} AND orden < ${current.orden} ORDER BY orden DESC LIMIT 1`
              : await sql`SELECT paso_id AS id, orden FROM tipo_informe_pasos WHERE tipo_informe_id = ${current.typeId} AND proyecto_id = ${projectScope} AND orden > ${current.orden} ORDER BY orden ASC LIMIT 1`
          ) as any[];
        }
        const neighbor = neighborRows[0];

        if (neighbor) {
          // Se intercambia el "orden" con el vecino inmediato pasando por un
          // valor temporal negativo -- la tabla tiene UNIQUE (proyecto_id,
          // tipo_informe_id, orden), así que no se puede pisar directamente
          // el valor del otro en ningún paso intermedio (orden empieza en 1,
          // así que un negativo nunca choca con nada existente).
          await sql`UPDATE tipo_informe_pasos SET orden = -1 * orden WHERE paso_id = ${current.id}`;
          await sql`UPDATE tipo_informe_pasos SET orden = ${current.orden} WHERE paso_id = ${neighbor.id}`;
          await sql`UPDATE tipo_informe_pasos SET orden = ${neighbor.orden} WHERE paso_id = ${current.id}`;
        }

        const stepRows = (
          projectScope === null
            ? await sql`
                SELECT paso_id AS id, tipo_informe_id AS "typeId", proyecto_id AS "projectId", orden AS "order", nombre AS name,
                  asunto_correo AS "emailSubject", es_final AS "isFinal", dia_inicio AS "diaInicio", dia_limite AS "diaLimite",
                  palabras_clave AS "palabrasClave"
                FROM tipo_informe_pasos WHERE tipo_informe_id = ${current.typeId} AND proyecto_id IS NULL ORDER BY orden ASC
              `
            : await sql`
                SELECT paso_id AS id, tipo_informe_id AS "typeId", proyecto_id AS "projectId", orden AS "order", nombre AS name,
                  asunto_correo AS "emailSubject", es_final AS "isFinal", dia_inicio AS "diaInicio", dia_limite AS "diaLimite",
                  palabras_clave AS "palabrasClave"
                FROM tipo_informe_pasos WHERE tipo_informe_id = ${current.typeId} AND proyecto_id = ${projectScope} ORDER BY orden ASC
              `
        ) as any[];
        const stepIds = stepRows.map((s: any) => s.id);
        const contactRows = stepIds.length === 0 ? [] : ((await sql`
          SELECT paso_id AS "stepId", contacto_id AS "contactId" FROM tipo_informe_paso_contacto WHERE paso_id = ANY(${stepIds})
        `) as any[]);
        const data = stepRows.map((s: any) => ({
          ...s,
          contactIds: contactRows.filter((c: any) => c.stepId === s.id).map((c: any) => String(c.contactId)),
        }));
        return response.status(200).json({ data, meta: {}, errors: [] });
      }

      if (body.kind === 'peticion') {
        if (!(await canEditModuleRequest(request, sql, 'peticiones'))) {
          return response.status(403).json({ data: null, meta: {}, errors: ['No tienes permiso de edición en Peticiones.'] });
        }
        const peticionId = Number(body.id);
        if (!Number.isInteger(peticionId) || peticionId <= 0) {
          return response.status(400).json({ data: null, meta: {}, errors: ['El id de la petición es obligatorio.'] });
        }
        const current = await sql`SELECT * FROM peticiones WHERE peticion_id = ${peticionId}`;
        if (!current[0]) return response.status(404).json({ data: null, meta: {}, errors: ['Petición no encontrada.'] });

        const has = (key: string) => Object.prototype.hasOwnProperty.call(body.data ?? {}, key);
        const d = body.data ?? {};
        const nextRadicado = has('radicado') ? String(d.radicado ?? '').trim() : current[0].radicado;
        const nextEmpresaId = has('empresaId') ? (Number.isInteger(Number(d.empresaId)) && Number(d.empresaId) > 0 ? Number(d.empresaId) : null) : current[0].empresa_id;
        const nextFechaRadicacion = has('fechaRadicacion') ? (d.fechaRadicacion || null) : current[0].fecha_radicacion;
        const nextPeticionario = has('peticionario') ? String(d.peticionario ?? '').trim() : current[0].peticionario;
        const nextAsunto = has('asunto') ? String(d.asunto ?? '').trim() : current[0].asunto;
        const nextAreaConsolida = has('areaConsolida') ? String(d.areaConsolida ?? '').trim() : current[0].area_consolida;
        const nextCorreo = has('correoPersonaAsignada') ? String(d.correoPersonaAsignada ?? '').trim() : current[0].correo_persona_asignada;
        const nextAreasIntervienen = has('areasIntervienen') ? String(d.areasIntervienen ?? '').trim() : current[0].areas_intervienen;
        const nextPlazoRespuesta = has('plazoRespuesta') ? (d.plazoRespuesta === null || d.plazoRespuesta === '' ? null : Number(d.plazoRespuesta)) : current[0].plazo_respuesta;
        const nextFechaRadicadoRespuesta = has('fechaRadicadoRespuesta') ? (d.fechaRadicadoRespuesta || null) : current[0].fecha_radicado_respuesta;
        const nextObservaciones = has('observaciones') ? String(d.observaciones ?? '').trim() : current[0].observaciones;
        const nextFechaPlazo = computeFechaPlazo(nextFechaRadicacion, nextPlazoRespuesta);
        // Si el plazo cambió, los recordatorios ya enviados quedan obsoletos.
        const plazoChanged = nextFechaPlazo !== current[0].fecha_plazo_respuesta;

        const rows = (await sql`
          UPDATE peticiones SET
            radicado = ${nextRadicado}, empresa_id = ${nextEmpresaId}, fecha_radicacion = ${nextFechaRadicacion}, peticionario = ${nextPeticionario},
            asunto = ${nextAsunto}, area_consolida = ${nextAreaConsolida}, correo_persona_asignada = ${nextCorreo},
            areas_intervienen = ${nextAreasIntervienen}, plazo_respuesta = ${nextPlazoRespuesta},
            fecha_plazo_respuesta = ${nextFechaPlazo}, fecha_radicado_respuesta = ${nextFechaRadicadoRespuesta},
            observaciones = ${nextObservaciones},
            ultimo_recordatorio_nivel = ${plazoChanged ? null : current[0].ultimo_recordatorio_nivel},
            ultimo_recordatorio_en = ${plazoChanged ? null : current[0].ultimo_recordatorio_en},
            updated_at = NOW()
          WHERE peticion_id = ${peticionId}
          RETURNING peticion_id AS id, radicado, empresa_id AS "empresaId", TO_CHAR(fecha_radicacion, 'YYYY-MM-DD') AS "fechaRadicacion",
            peticionario, asunto, area_consolida AS "areaConsolida", correo_persona_asignada AS "correoPersonaAsignada",
            areas_intervienen AS "areasIntervienen", plazo_respuesta AS "plazoRespuesta",
            TO_CHAR(fecha_plazo_respuesta, 'YYYY-MM-DD') AS "fechaPlazoRespuesta",
            TO_CHAR(fecha_radicado_respuesta, 'YYYY-MM-DD') AS "fechaRadicadoRespuesta",
            observaciones, drive_folder_url AS "driveFolderUrl",
            documento_peticion_nombre AS "documentoPeticionNombre", documento_peticion_drive_url AS "documentoPeticionUrl",
            documento_respuesta_nombre AS "documentoRespuestaNombre", documento_respuesta_drive_url AS "documentoRespuestaUrl",
            created_at AS "createdAt"
        `) as any[];

        let responsables = await fetchResponsables(sql, peticionId);
        if (Array.isArray(body.responsableIds)) {
          const previousIds = responsables.map((r) => r.id);
          const nextIds = body.responsableIds.map(String);
          const newlyAssignedIds = nextIds.filter((id: string) => !previousIds.includes(id));
          await setResponsables(sql, peticionId, nextIds);
          responsables = await fetchResponsables(sql, peticionId);
          if (newlyAssignedIds.length > 0) {
            await notifyNewPeticionResponsables(sql, { ...rows[0], id: peticionId }, responsables, newlyAssignedIds);
          }
        }
        let proyectos = await fetchPeticionProyectos(sql, peticionId);
        if (Array.isArray(body.proyectoIds)) {
          if (body.proyectoIds.length === 0) {
            return response.status(400).json({ data: null, meta: {}, errors: ['Debes asignar al menos un proyecto a la petición.'] });
          }
          await setPeticionProyectos(sql, peticionId, body.proyectoIds.map(String));
          proyectos = await fetchPeticionProyectos(sql, peticionId);
        }
        return response.status(200).json({ data: { ...rows[0], responsables, proyectos }, meta: {}, errors: [] });
      }

      if (body.kind === 'sweepConfig') {
        if (!(await isAdminRequest(request, sql))) {
          return response.status(403).json({ data: null, meta: {}, errors: ['Solo un administrador puede configurar los barridos.'] });
        }
        const sweepKind = String(body.sweepKind ?? '');
        if (!SWEEP_LABELS[sweepKind]) {
          return response.status(400).json({ data: null, meta: {}, errors: ['Barrido no reconocido.'] });
        }
        const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
        const current = await sql`SELECT * FROM barrido_config WHERE kind = ${sweepKind}`;
        if (!current[0]) return response.status(404).json({ data: null, meta: {}, errors: ['Barrido no encontrado.'] });

        const nextActive = has('active') ? Boolean(body.active) : current[0].activo;
        const nextFrequency = has('frequencyMinutes') ? Math.max(5, Number(body.frequencyMinutes) || 0) : current[0].frecuencia_minutos;

        const rows = await sql`
          UPDATE barrido_config
          SET activo = ${nextActive}, frecuencia_minutos = ${nextFrequency}, updated_at = NOW()
          WHERE kind = ${sweepKind}
          RETURNING kind, activo AS active, frecuencia_minutos AS "frequencyMinutes",
            ultima_ejecucion AS "lastRunAt", ultimo_exito AS "lastRunSuccess", ultimo_resultado AS "lastRunResult"
        `;
        return response.status(200).json({ data: { ...rows[0], label: SWEEP_LABELS[sweepKind] }, meta: {}, errors: [] });
      }

      if (body.kind === 'reportTypeStep') {
        if (!(await canEditModuleRequest(request, sql, 'lists'))) {
          return response.status(403).json({ data: null, meta: {}, errors: ['No tienes permiso de edición en Listas Maestras.'] });
        }
        const stepId = Number(body.stepId);
        if (!Number.isInteger(stepId) || stepId <= 0) {
          return response.status(400).json({ data: null, meta: {}, errors: ['El id del paso es obligatorio.'] });
        }
        const current = await sql`SELECT * FROM tipo_informe_pasos WHERE paso_id = ${stepId}`;
        if (!current[0]) return response.status(404).json({ data: null, meta: {}, errors: ['Paso no encontrado.'] });

        const has = (key: string) => Object.prototype.hasOwnProperty.call(body.data ?? {}, key);
        const d = body.data ?? {};
        const nextName = has('name') ? String(d.name ?? '').trim() : current[0].nombre;
        const nextSubject = has('emailSubject') ? String(d.emailSubject ?? '').trim() : current[0].asunto_correo;
        const nextIsFinal = has('isFinal') ? Boolean(d.isFinal) : current[0].es_final;
        const nextDiaInicio = has('diaInicio') ? (d.diaInicio === null || d.diaInicio === '' ? null : Number(d.diaInicio)) : current[0].dia_inicio;
        const nextDiaLimite = has('diaLimite') ? (d.diaLimite === null || d.diaLimite === '' ? null : Number(d.diaLimite)) : current[0].dia_limite;
        const nextPalabrasClave = has('palabrasClave') ? (String(d.palabrasClave ?? '').trim() || null) : current[0].palabras_clave;
        if (!nextName || !nextSubject) {
          return response.status(400).json({ data: null, meta: {}, errors: ['Nombre y asunto de correo son obligatorios.'] });
        }

        const rows = await sql`
          UPDATE tipo_informe_pasos SET nombre = ${nextName}, asunto_correo = ${nextSubject}, es_final = ${nextIsFinal},
            dia_inicio = ${nextDiaInicio}, dia_limite = ${nextDiaLimite}, palabras_clave = ${nextPalabrasClave}
          WHERE paso_id = ${stepId}
          RETURNING paso_id AS id, tipo_informe_id AS "typeId", proyecto_id AS "projectId", orden AS "order", nombre AS name,
            asunto_correo AS "emailSubject", es_final AS "isFinal", dia_inicio AS "diaInicio", dia_limite AS "diaLimite",
            palabras_clave AS "palabrasClave"
        `;

        const hasPrincipal = Object.prototype.hasOwnProperty.call(body, 'principalContactId');
        let principalContactId: string | null;
        if (hasPrincipal) {
          principalContactId = body.principalContactId ? String(body.principalContactId) : null;
        } else {
          const [existingPrincipal] = (await sql`
            SELECT contacto_id AS id FROM tipo_informe_paso_contacto WHERE paso_id = ${stepId} AND es_principal = TRUE
          `) as any[];
          principalContactId = existingPrincipal ? String(existingPrincipal.id) : null;
        }

        let contactIds: string[];
        if (Array.isArray(body.contactIds)) {
          await sql`DELETE FROM tipo_informe_paso_contacto WHERE paso_id = ${stepId}`;
          for (const contactId of body.contactIds) {
            const isPrincipal = String(contactId) === principalContactId;
            await sql`INSERT INTO tipo_informe_paso_contacto (paso_id, contacto_id, es_principal) VALUES (${stepId}, ${contactId}, ${isPrincipal})`;
          }
          contactIds = body.contactIds.map(String);
        } else {
          if (hasPrincipal) {
            await sql`UPDATE tipo_informe_paso_contacto SET es_principal = (contacto_id = ${principalContactId}) WHERE paso_id = ${stepId}`;
          }
          const existingContacts = await sql`SELECT contacto_id AS id FROM tipo_informe_paso_contacto WHERE paso_id = ${stepId}`;
          contactIds = existingContacts.map((c: any) => String(c.id));
        }

        return response.status(200).json({ data: { ...rows[0], contactIds, principalContactId }, meta: {}, errors: [] });
      }

      if (body.kind !== 'authorizedUser') {
        return response.status(400).json({ data: null, meta: {}, errors: ['Catálogo no soportado.'] });
      }
      if (!(await isAdminRequest(request, sql))) {
        return response.status(403).json({ data: null, meta: {}, errors: ['Solo un administrador puede editar usuarios autorizados.'] });
      }

      const email = String(body.email ?? '').trim().toLowerCase();
      if (!email) return response.status(400).json({ data: null, meta: {}, errors: ['El correo es obligatorio.'] });

      const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
      const current = await sql`SELECT * FROM usuarios_autorizados WHERE email = ${email}`;
      if (!current[0]) return response.status(404).json({ data: null, meta: {}, errors: ['Usuario no encontrado.'] });

      const nextName = has('name') ? String(body.name ?? '').trim() || null : current[0].nombre;
      const nextActive = has('active') ? Boolean(body.active) : current[0].activo;
      const nextIsAdmin = has('isAdmin') ? Boolean(body.isAdmin) : current[0].es_admin;
      const nextPermissions = has('permissions') ? JSON.stringify(body.permissions ?? {}) : JSON.stringify(current[0].permisos ?? {});

      let nextEmail = email;
      if (has('newEmail')) {
        nextEmail = String(body.newEmail ?? '').trim().toLowerCase();
        if (!nextEmail || !nextEmail.includes('@')) {
          return response.status(400).json({ data: null, meta: {}, errors: ['El nuevo correo no es válido.'] });
        }
        if (nextEmail !== email) {
          const existing = await sql`SELECT email FROM usuarios_autorizados WHERE email = ${nextEmail}`;
          if (existing[0]) return response.status(409).json({ data: null, meta: {}, errors: ['Ya existe un usuario autorizado con ese correo.'] });
          // Cambiar el correo invalida las sesiones activas de esa cuenta: tendrá que
          // volver a iniciar sesión (con el correo nuevo, si es que ya es el suyo).
          await sql`DELETE FROM app_sesiones WHERE email = ${email}`;
        }
      }

      try {
        const rows = await sql`
          UPDATE usuarios_autorizados
          SET email = ${nextEmail}, nombre = ${nextName}, activo = ${nextActive}, es_admin = ${nextIsAdmin}, permisos = ${nextPermissions}::jsonb
          WHERE email = ${email}
          RETURNING email, nombre AS name, es_admin AS "isAdmin", activo AS active, permisos AS permissions
        `;
        return response.status(200).json({ data: rows[0], meta: {}, errors: [] });
      } catch (error) {
        if ((error as { code?: string })?.code === '23505') {
          return response.status(409).json({ data: null, meta: {}, errors: ['Ya existe un usuario autorizado con ese correo.'] });
        }
        throw error;
      }
    }

    const { kind, data } = request.body ?? {};

    if (kind === 'triggerSweep') {
      if (!(await isAdminRequest(request, sql))) {
        return response.status(403).json({ data: null, meta: {}, errors: ['Solo un administrador puede lanzar un barrido manual.'] });
      }
      const sweepKind = String(data?.sweepKind ?? '');
      if (!SWEEP_LABELS[sweepKind]) {
        return response.status(400).json({ data: null, meta: {}, errors: ['Barrido no reconocido.'] });
      }
      try {
        const result = await triggerSweep(sweepKind);
        const [config] = await fetchSweepConfig(sql).then((rows) => rows.filter((r) => r.kind === sweepKind));
        return response.status(200).json({ data: { result, config }, meta: {}, errors: [] });
      } catch (error) {
        return response.status(502).json({ data: null, meta: {}, errors: [error instanceof Error ? error.message : 'No fue posible lanzar el barrido.'] });
      }
    }

    if (kind === 'testAuthorizedUserEmail') {
      if (!(await isAdminRequest(request, sql))) {
        return response.status(403).json({ data: null, meta: {}, errors: ['Solo un administrador puede enviar correos de prueba.'] });
      }
      const email = String(data?.email ?? '').trim().toLowerCase();
      if (!email || !email.includes('@')) {
        return response.status(400).json({ data: null, meta: {}, errors: ['El correo es obligatorio.'] });
      }
      const [target] = await sql`SELECT nombre AS name FROM usuarios_autorizados WHERE email = ${email}`;
      if (!target) return response.status(404).json({ data: null, meta: {}, errors: ['Ese correo no está en la lista de usuarios autorizados.'] });

      try {
        const accessToken = await getConnectedAccessToken(sql);
        if (!accessToken) {
          return response.status(503).json({ data: null, meta: {}, errors: ['Conecta una cuenta de Google (Fuentes Drive) para poder enviar correos.'] });
        }
        const { sendEmail, buildAccessApprovedEmailHtml } = await import('../server/google-gmail.js');
        const baseUrl = (process.env.APP_URL || 'https://seguimiento-informes.vercel.app').replace(/\/$/, '');
        const html = buildAccessApprovedEmailHtml({ name: target.name, loginUrl: baseUrl });
        await sendEmail(accessToken, {
          to: [email],
          subject: 'Acceso aprobado — Seguimiento de Informes',
          body: html,
          html: true,
        });
        return response.status(200).json({ data: { sent: true, email }, meta: {}, errors: [] });
      } catch (error) {
        return response.status(502).json({ data: null, meta: {}, errors: [error instanceof Error ? error.message : 'No fue posible enviar el correo de prueba.'] });
      }
    }

    if (kind === 'peticion') {
      if (!(await canEditModuleRequest(request, sql, 'peticiones'))) {
        return response.status(403).json({ data: null, meta: {}, errors: ['No tienes permiso de edición en Peticiones.'] });
      }
      const asunto = String(data?.asunto ?? '').trim();
      const empresaId = Number(data?.empresaId);
      const proyectoIds = Array.isArray(request.body?.proyectoIds) ? request.body.proyectoIds.map(String) : [];
      if (!asunto || !Number.isInteger(empresaId) || empresaId <= 0) {
        return response.status(400).json({ data: null, meta: {}, errors: ['El asunto y la empresa son obligatorios.'] });
      }
      if (proyectoIds.length === 0) {
        return response.status(400).json({ data: null, meta: {}, errors: ['Debes asignar al menos un proyecto a la petición.'] });
      }
      const fechaRadicacion = data?.fechaRadicacion || null;
      const plazoRespuesta = data?.plazoRespuesta === null || data?.plazoRespuesta === undefined || data?.plazoRespuesta === '' ? null : Number(data.plazoRespuesta);
      const fechaPlazo = computeFechaPlazo(fechaRadicacion, plazoRespuesta);
      // Año que usa el radicado: el de la fecha de radicación si se dio, si no el de hoy.
      const radicadoYear = fechaRadicacion ? Number(fechaRadicacion.slice(0, 4)) : new Date().getUTCFullYear();
      const radicado = await generateRadicado(sql, empresaId, radicadoYear);

      const rows = (await sql`
        INSERT INTO peticiones (
          radicado, empresa_id, fecha_radicacion, peticionario, asunto, area_consolida,
          correo_persona_asignada, areas_intervienen, plazo_respuesta, fecha_plazo_respuesta, fecha_radicado_respuesta,
          observaciones
        )
        VALUES (
          ${radicado}, ${empresaId}, ${fechaRadicacion}, ${String(data?.peticionario ?? '').trim()}, ${asunto},
          ${String(data?.areaConsolida ?? '').trim()}, ${String(data?.correoPersonaAsignada ?? '').trim()},
          ${String(data?.areasIntervienen ?? '').trim()}, ${plazoRespuesta}, ${fechaPlazo},
          ${data?.fechaRadicadoRespuesta || null}, ${String(data?.observaciones ?? '').trim()}
        )
        RETURNING peticion_id AS id, radicado, empresa_id AS "empresaId", TO_CHAR(fecha_radicacion, 'YYYY-MM-DD') AS "fechaRadicacion",
          peticionario, asunto, area_consolida AS "areaConsolida", correo_persona_asignada AS "correoPersonaAsignada",
          areas_intervienen AS "areasIntervienen", plazo_respuesta AS "plazoRespuesta",
          TO_CHAR(fecha_plazo_respuesta, 'YYYY-MM-DD') AS "fechaPlazoRespuesta",
          TO_CHAR(fecha_radicado_respuesta, 'YYYY-MM-DD') AS "fechaRadicadoRespuesta",
          observaciones, drive_folder_url AS "driveFolderUrl",
          documento_peticion_nombre AS "documentoPeticionNombre", documento_peticion_drive_url AS "documentoPeticionUrl",
          documento_respuesta_nombre AS "documentoRespuestaNombre", documento_respuesta_drive_url AS "documentoRespuestaUrl",
          created_at AS "createdAt"
      `) as any[];
      const peticionId = rows[0].id;
      const initialResponsableIds = Array.isArray(request.body?.responsableIds) ? request.body.responsableIds.map(String) : [];
      if (initialResponsableIds.length > 0) {
        await setResponsables(sql, peticionId, initialResponsableIds);
      }
      await setPeticionProyectos(sql, peticionId, proyectoIds);
      const responsables = await fetchResponsables(sql, peticionId);
      const proyectos = await fetchPeticionProyectos(sql, peticionId);
      await notifyNewPeticionResponsables(sql, { ...rows[0], id: peticionId }, responsables, responsables.map((r) => r.id));
      return response.status(201).json({ data: { ...rows[0], responsables, proyectos }, meta: {}, errors: [] });
    }

    if (kind === 'peticionesConfig') {
      if (!(await isAdminRequest(request, sql))) {
        return response.status(403).json({ data: null, meta: {}, errors: ['Solo un administrador puede configurar la carpeta de Drive de Peticiones.'] });
      }
      const rawUrl = String(data?.driveRootFolderUrl ?? '').trim();
      const folderId = extractDriveFolderId(rawUrl);
      if (!folderId) {
        return response.status(400).json({ data: null, meta: {}, errors: ['Pega un link válido de carpeta de Drive (o su id).'] });
      }
      const rows = await sql`
        INSERT INTO peticiones_config (id, drive_root_folder_id, drive_root_folder_url)
        VALUES (1, ${folderId}, ${rawUrl})
        ON CONFLICT (id) DO UPDATE SET drive_root_folder_id = EXCLUDED.drive_root_folder_id, drive_root_folder_url = EXCLUDED.drive_root_folder_url
        RETURNING drive_root_folder_id AS "driveRootFolderId", drive_root_folder_url AS "driveRootFolderUrl"
      `;
      return response.status(200).json({ data: rows[0], meta: {}, errors: [] });
    }

    if (kind === 'peticionDocument') {
      if (!(await canEditModuleRequest(request, sql, 'peticiones'))) {
        return response.status(403).json({ data: null, meta: {}, errors: ['No tienes permiso de edición en Peticiones.'] });
      }
      const peticionId = Number(data?.peticionId);
      const which = data?.which;
      if (!Number.isInteger(peticionId) || peticionId <= 0 || (which !== 'peticion' && which !== 'respuesta')) {
        return response.status(400).json({ data: null, meta: {}, errors: ['El id de la petición y el tipo de documento (peticion/respuesta) son obligatorios.'] });
      }
      const fileName = String(data?.fileName ?? '').trim();
      const mimeType = String(data?.mimeType ?? '').trim() || 'application/octet-stream';
      const contentBase64 = String(data?.contentBase64 ?? '');
      if (!fileName || !contentBase64) {
        return response.status(400).json({ data: null, meta: {}, errors: ['El archivo es obligatorio.'] });
      }
      // ~4MB de archivo real en base64 (Vercel limita el body a ~4.5MB).
      if (contentBase64.length > 5_800_000) {
        return response.status(413).json({ data: null, meta: {}, errors: ['El archivo es demasiado grande (máx. ~4 MB).'] });
      }

      const [config] = (await sql`SELECT drive_root_folder_id AS "driveRootFolderId" FROM peticiones_config WHERE id = 1`) as any[];
      if (!config?.driveRootFolderId) {
        return response.status(400).json({ data: null, meta: {}, errors: ['Un administrador debe configurar primero la carpeta raíz de Drive para Peticiones.'] });
      }
      const [peticion] = (await sql`SELECT peticion_id AS id, radicado, drive_folder_id AS "driveFolderId" FROM peticiones WHERE peticion_id = ${peticionId}`) as any[];
      if (!peticion) return response.status(404).json({ data: null, meta: {}, errors: ['Petición no encontrada.'] });

      const accessToken = await getConnectedAccessToken(sql);
      if (!accessToken) {
        return response.status(503).json({ data: null, meta: {}, errors: ['Conecta una cuenta de Google (Fuentes Drive) para poder subir documentos.'] });
      }

      try {
        let folderId = peticion.driveFolderId as string | null;
        let folderUrl: string | null = null;
        if (!folderId) {
          const folder = await ensureDriveFolder(accessToken, config.driveRootFolderId, peticion.radicado);
          folderId = folder.id;
          folderUrl = `https://drive.google.com/drive/folders/${folder.id}`;
          await sql`UPDATE peticiones SET drive_folder_id = ${folderId}, drive_folder_url = ${folderUrl} WHERE peticion_id = ${peticionId}`;
        }

        const uploaded = await uploadDriveFile(accessToken, folderId as string, fileName, mimeType, contentBase64);
        const fileUrl = uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`;

        const rows =
          which === 'peticion'
            ? await sql`
                UPDATE peticiones SET documento_peticion_nombre = ${fileName}, documento_peticion_drive_url = ${fileUrl}
                WHERE peticion_id = ${peticionId}
                RETURNING documento_peticion_nombre AS "documentoPeticionNombre", documento_peticion_drive_url AS "documentoPeticionUrl",
                  drive_folder_url AS "driveFolderUrl"
              `
            : await sql`
                UPDATE peticiones SET documento_respuesta_nombre = ${fileName}, documento_respuesta_drive_url = ${fileUrl}
                WHERE peticion_id = ${peticionId}
                RETURNING documento_respuesta_nombre AS "documentoRespuestaNombre", documento_respuesta_drive_url AS "documentoRespuestaUrl",
                  drive_folder_url AS "driveFolderUrl"
              `;
        return response.status(200).json({ data: (rows as any[])[0], meta: {}, errors: [] });
      } catch (error) {
        return response.status(502).json({ data: null, meta: {}, errors: [error instanceof Error ? error.message : 'No fue posible subir el documento a Drive.'] });
      }
    }

    if (kind === 'areaConsolida') {
      const name = String(data?.name ?? '').trim();
      if (!name) {
        return response.status(400).json({ data: null, meta: {}, errors: ['El nombre del área es obligatorio.'] });
      }
      try {
        const rows = await sql`
          INSERT INTO areas_consolida (nombre) VALUES (${name})
          RETURNING area_id AS id, nombre AS name
        `;
        return response.status(201).json({ data: rows[0], meta: {}, errors: [] });
      } catch (error) {
        if ((error as { code?: string })?.code === '23505') {
          return response.status(409).json({ data: null, meta: {}, errors: ['Ya existe un área con ese nombre.'] });
        }
        throw error;
      }
    }

    if (kind === 'reportType') {
      if (!data?.code || !data?.name || !data?.periodicity) {
        return response.status(400).json({ data: null, meta: {}, errors: ['Código, nombre y periodicidad son obligatorios.'] });
      }

      const rows = await sql`
        INSERT INTO tipos_informe (tipo_informe_id, codigo, nombre, periodicidad, descripcion)
        VALUES (
          COALESCE((SELECT MAX(tipo_informe_id) FROM tipos_informe), 0) + 1,
          ${String(data.code).trim().toUpperCase()}, ${String(data.name).trim()},
          ${String(data.periodicity)}, ${String(data.description ?? '').trim()}
        )
        RETURNING tipo_informe_id AS id, codigo AS code, nombre AS name,
          periodicidad AS periodicity, descripcion AS description, activo AS active
      `;
      return response.status(201).json({ data: rows[0], meta: {}, errors: [] });
    }

    if (kind === 'contact') {
      if (!data?.name || !data?.email || !data?.role || !data?.company) {
        return response.status(400).json({ data: null, meta: {}, errors: ['Nombre, correo, cargo y empresa son obligatorios.'] });
      }

      const roleRows = await sql`SELECT rol_id FROM roles WHERE nombre = ${String(data.role).trim()} LIMIT 1`;
      let roleId = roleRows[0]?.rol_id;
      if (!roleId) {
        const createdRole = await sql`
          INSERT INTO roles (rol_id, nombre) VALUES (COALESCE((SELECT MAX(rol_id) FROM roles), 0) + 1, ${String(data.role).trim()})
          RETURNING rol_id
        `;
        roleId = createdRole[0]?.rol_id;
      }

      const companyRows = await sql`SELECT empresa_id FROM empresas WHERE nombre = ${String(data.company).trim()} LIMIT 1`;
      let companyId = companyRows[0]?.empresa_id;
      if (!companyId) {
        const createdCompany = await sql`
          INSERT INTO empresas (empresa_id, nombre) VALUES (COALESCE((SELECT MAX(empresa_id) FROM empresas), 0) + 1, ${String(data.company).trim()})
          RETURNING empresa_id
        `;
        companyId = createdCompany[0]?.empresa_id;
      }

      const rows = await sql`
        INSERT INTO contactos (contacto_id, rol_id, empresa_id, nombre, email, telefono)
        VALUES (
          COALESCE((SELECT MAX(contacto_id) FROM contactos), 0) + 1,
          ${roleId}, ${companyId}, ${String(data.name).trim()}, ${String(data.email).trim()}, ${String(data.phone ?? '').trim()}
        )
        RETURNING contacto_id AS id, nombre AS name, email, telefono AS phone, activo AS active, alarma_activa AS "hasNotificationAlarm"
      `;

      return response.status(201).json({
        data: { ...rows[0], role: String(data.role).trim(), company: String(data.company).trim() },
        meta: {}, errors: [],
      });
    }

    if (kind === 'reportTypeStep') {
      const { typeId, projectId, name, emailSubject, isFinal, contactIds, diaInicio, diaLimite, palabrasClave, principalContactId } = data ?? {};
      if (!typeId || !name || !emailSubject || !Array.isArray(contactIds) || contactIds.length === 0) {
        return response.status(400).json({ data: null, meta: {}, errors: ['Tipo de informe, nombre, asunto de correo y al menos un contacto son obligatorios.'] });
      }
      const parsedDiaInicio = diaInicio === null || diaInicio === undefined || diaInicio === '' ? null : Number(diaInicio);
      const parsedDiaLimite = diaLimite === null || diaLimite === undefined || diaLimite === '' ? null : Number(diaLimite);
      const parsedPalabrasClave = palabrasClave ? String(palabrasClave).trim() || null : null;
      // NULL = plantilla general (aplica a todos los proyectos de este
      // tipo); un id = flujo propio de ese proyecto únicamente.
      const parsedProjectId = projectId === null || projectId === undefined || projectId === '' ? null : Number(projectId);

      const stepRows = (
        parsedProjectId === null
          ? await sql`
              INSERT INTO tipo_informe_pasos (paso_id, tipo_informe_id, proyecto_id, orden, nombre, asunto_correo, es_final, dia_inicio, dia_limite, palabras_clave)
              VALUES (
                COALESCE((SELECT MAX(paso_id) FROM tipo_informe_pasos), 0) + 1,
                ${typeId}, NULL,
                COALESCE((SELECT MAX(orden) FROM tipo_informe_pasos WHERE tipo_informe_id = ${typeId} AND proyecto_id IS NULL), 0) + 1,
                ${String(name).trim()}, ${String(emailSubject).trim()}, ${Boolean(isFinal)}, ${parsedDiaInicio}, ${parsedDiaLimite}, ${parsedPalabrasClave}
              )
              RETURNING paso_id AS id, tipo_informe_id AS "typeId", proyecto_id AS "projectId", orden AS "order", nombre AS name,
                asunto_correo AS "emailSubject", es_final AS "isFinal", dia_inicio AS "diaInicio", dia_limite AS "diaLimite",
                palabras_clave AS "palabrasClave"
            `
          : await sql`
              INSERT INTO tipo_informe_pasos (paso_id, tipo_informe_id, proyecto_id, orden, nombre, asunto_correo, es_final, dia_inicio, dia_limite, palabras_clave)
              VALUES (
                COALESCE((SELECT MAX(paso_id) FROM tipo_informe_pasos), 0) + 1,
                ${typeId}, ${parsedProjectId},
                COALESCE((SELECT MAX(orden) FROM tipo_informe_pasos WHERE tipo_informe_id = ${typeId} AND proyecto_id = ${parsedProjectId}), 0) + 1,
                ${String(name).trim()}, ${String(emailSubject).trim()}, ${Boolean(isFinal)}, ${parsedDiaInicio}, ${parsedDiaLimite}, ${parsedPalabrasClave}
              )
              RETURNING paso_id AS id, tipo_informe_id AS "typeId", proyecto_id AS "projectId", orden AS "order", nombre AS name,
                asunto_correo AS "emailSubject", es_final AS "isFinal", dia_inicio AS "diaInicio", dia_limite AS "diaLimite",
                palabras_clave AS "palabrasClave"
            `
      ) as any[];
      const stepId = stepRows[0].id;

      const parsedPrincipalContactId = principalContactId ? String(principalContactId) : null;
      for (const contactId of contactIds) {
        const isPrincipal = String(contactId) === parsedPrincipalContactId;
        await sql`INSERT INTO tipo_informe_paso_contacto (paso_id, contacto_id, es_principal) VALUES (${stepId}, ${contactId}, ${isPrincipal})`;
      }

      return response.status(201).json({
        data: { ...stepRows[0], contactIds: contactIds.map(String), principalContactId: parsedPrincipalContactId },
        meta: {}, errors: [],
      });
    }

    if (kind === 'authorizedUser') {
      if (!(await isAdminRequest(request, sql))) {
        return response.status(403).json({ data: null, meta: {}, errors: ['Solo un administrador puede agregar usuarios autorizados.'] });
      }
      const email = String(data?.email ?? '').trim().toLowerCase();
      if (!email || !email.includes('@')) {
        return response.status(400).json({ data: null, meta: {}, errors: ['Un correo válido es obligatorio.'] });
      }

      const rows = await sql`
        INSERT INTO usuarios_autorizados (email, nombre, es_admin, activo, permisos)
        VALUES (${email}, ${String(data?.name ?? '').trim() || null}, FALSE, TRUE, '{}'::jsonb)
        ON CONFLICT (email) DO UPDATE SET activo = TRUE
        RETURNING email, nombre AS name, es_admin AS "isAdmin", activo AS active, permisos AS permissions
      `;
      return response.status(201).json({ data: rows[0], meta: {}, errors: [] });
    }

    return response.status(400).json({ data: null, meta: {}, errors: ['Catálogo no soportado.'] });
  } catch (error) {
    console.error('Catalog query failed', error);
    const detail = error instanceof Error ? error.message : String(error);
    return response.status(503).json({ data: null, meta: {}, errors: [`No fue posible guardar o consultar los catálogos: ${detail}`] });
  }
}