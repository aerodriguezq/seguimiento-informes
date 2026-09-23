import type { VercelRequest, VercelResponse } from '@vercel/node';

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

      const stepId = Number(request.query.stepId);
      if (!Number.isInteger(stepId) || stepId <= 0) {
        return response.status(400).json({ data: null, meta: {}, errors: ['El id del paso es obligatorio.'] });
      }
      const deleted = await sql`DELETE FROM tipo_informe_pasos WHERE paso_id = ${stepId} RETURNING paso_id AS id`;
      if (!deleted[0]) return response.status(404).json({ data: null, meta: {}, errors: ['Paso no encontrado.'] });
      return response.status(200).json({ data: deleted[0], meta: {}, errors: [] });
    }

    if (request.method === 'GET') {
      const isAdmin = await isAdminRequest(request, sql);
      const authorizedUsers = isAdmin
        ? await sql`SELECT email, nombre AS name, es_admin AS "isAdmin", activo AS active, permisos AS permissions FROM usuarios_autorizados ORDER BY created_at ASC`
        : [];
      const sweeps = isAdmin ? await fetchSweepConfig(sql) : [];
      const [reportTypes, contacts, steps, stepContacts] = await Promise.all([
        sql`
          SELECT tipo_informe_id AS id, COALESCE(codigo, '') AS code, nombre AS name,
            periodicidad AS periodicity, descripcion AS description, activo AS active
          FROM tipos_informe ORDER BY nombre ASC
        `,
        sql`
          SELECT c.contacto_id AS id, c.nombre AS name, COALESCE(c.email, '') AS email,
            COALESCE(r.nombre, '') AS role, COALESCE(e.nombre, '') AS company,
            c.telefono AS phone, TRUE AS has_notification_alarm, c.activo AS active
          FROM contactos c
          LEFT JOIN roles r ON r.rol_id = c.rol_id
          LEFT JOIN empresas e ON e.empresa_id = c.empresa_id
          ORDER BY c.nombre ASC
        `,
        sql`
          SELECT paso_id AS id, tipo_informe_id AS "typeId", orden AS "order", nombre AS name,
            asunto_correo AS "emailSubject", es_final AS "isFinal"
          FROM tipo_informe_pasos ORDER BY tipo_informe_id ASC, orden ASC
        `,
        sql`SELECT paso_id AS "stepId", contacto_id AS "contactId" FROM tipo_informe_paso_contacto`,
      ]);

      const reportTypeSteps = (steps as any[]).map((step) => ({
        ...step,
        contactIds: (stepContacts as any[]).filter((sc) => sc.stepId === step.id).map((sc) => String(sc.contactId)),
      }));

      return response.status(200).json({ data: { reportTypes, contacts, reportTypeSteps, authorizedUsers, sweeps, isAdmin }, meta: {}, errors: [] });
    }

    if (request.method === 'PATCH') {
      const body = request.body ?? {};

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
        RETURNING contacto_id AS id, nombre AS name, email, telefono AS phone, activo AS active
      `;

      return response.status(201).json({
        data: { ...rows[0], role: String(data.role).trim(), company: String(data.company).trim(), hasNotificationAlarm: true },
        meta: {}, errors: [],
      });
    }

    if (kind === 'reportTypeStep') {
      const { typeId, name, emailSubject, isFinal, contactIds } = data ?? {};
      if (!typeId || !name || !emailSubject || !Array.isArray(contactIds) || contactIds.length === 0) {
        return response.status(400).json({ data: null, meta: {}, errors: ['Tipo de informe, nombre, asunto de correo y al menos un contacto son obligatorios.'] });
      }

      const stepRows = await sql`
        INSERT INTO tipo_informe_pasos (paso_id, tipo_informe_id, orden, nombre, asunto_correo, es_final)
        VALUES (
          COALESCE((SELECT MAX(paso_id) FROM tipo_informe_pasos), 0) + 1,
          ${typeId},
          COALESCE((SELECT MAX(orden) FROM tipo_informe_pasos WHERE tipo_informe_id = ${typeId}), 0) + 1,
          ${String(name).trim()}, ${String(emailSubject).trim()}, ${Boolean(isFinal)}
        )
        RETURNING paso_id AS id, tipo_informe_id AS "typeId", orden AS "order", nombre AS name,
          asunto_correo AS "emailSubject", es_final AS "isFinal"
      `;
      const stepId = stepRows[0].id;

      for (const contactId of contactIds) {
        await sql`INSERT INTO tipo_informe_paso_contacto (paso_id, contacto_id) VALUES (${stepId}, ${contactId})`;
      }

      return response.status(201).json({
        data: { ...stepRows[0], contactIds: contactIds.map(String) },
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
    return response.status(503).json({ data: null, meta: {}, errors: ['No fue posible guardar o consultar los catálogos.'] });
  }
}