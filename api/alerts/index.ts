import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDriveAccessToken } from '../../server/google-drive.js';
import { sendEmail } from '../../server/google-gmail.js';

type SqlClient = ReturnType<typeof import('@neondatabase/serverless').neon>;

async function getConnectedAccessToken(sql: SqlClient): Promise<string | null> {
  const session = (await sql`
    SELECT token_json FROM google_drive_sessions WHERE expires_at > NOW() ORDER BY created_at DESC LIMIT 1
  `) as any[];
  if (!session[0]) return null;
  return getDriveAccessToken(session[0].token_json);
}

function buildAlertEmailBody(alert: { name: string; projectName?: string; type?: string; schedule?: string }) {
  return [
    'Se activó una alerta de seguimiento.',
    '',
    `Alerta: ${alert.name}`,
    `Proyecto: ${alert.projectName || 'Todos los proyectos'}`,
    `Tipo: ${alert.type || 'Seguimiento'}`,
    `Programación: ${alert.schedule || ''}`,
    '',
    'Este mensaje fue enviado automáticamente desde Seguimiento de Informes.',
  ].join('\n');
}

async function fetchAlertsByIds(sql: SqlClient, ids: number[]) {
  if (ids.length === 0) return [];

  const alertRows = (await sql`
    SELECT
      a.alerta_id AS id,
      a.proyecto_id AS "projectId",
      p.nombre AS "projectName",
      a.nombre AS name,
      a.frecuencia AS schedule,
      COALESCE(a.hora_texto, '') AS time,
      a.tipo AS type,
      a.activa AS active,
      a.informe_id AS "reportId",
      a.paso_id AS "stepId",
      a.ultimo_disparo AS "lastFiredAt"
    FROM alertas a
    LEFT JOIN proyectos p ON p.proyecto_id = a.proyecto_id
    WHERE a.alerta_id = ANY(${ids})
    ORDER BY a.created_at DESC
  `) as any[];

  const recipientRows = (await sql`
    SELECT alerta_id AS "alertId", contacto_id AS "contactId"
    FROM alerta_contacto
    WHERE alerta_id = ANY(${ids})
  `) as any[];

  return alertRows.map((alert) => ({
    ...alert,
    recipientIds: recipientRows.filter((r) => r.alertId === alert.id).map((r: any) => String(r.contactId)),
    nextExecution: alert.lastFiredAt ? `Último disparo: ${new Date(alert.lastFiredAt).toLocaleString('es-CO')}` : 'Pendiente primer disparo',
  }));
}

async function handleSend(request: VercelRequest, response: VercelResponse, sql: SqlClient) {
  const { alert, recipients } = request.body ?? {};
  const validRecipients = (Array.isArray(recipients) ? recipients : []).filter(
    (recipient: any) => typeof recipient?.email === 'string' && recipient.email.includes('@'),
  );

  if (!alert?.name || validRecipients.length === 0) {
    return response.status(400).json({ data: null, meta: {}, errors: ['La alerta y al menos un destinatario válido son obligatorios.'] });
  }

  const accessToken = await getConnectedAccessToken(sql);
  if (!accessToken) {
    return response.status(503).json({ data: null, meta: {}, errors: ['Conecta una cuenta de Google (Fuentes Drive) para poder enviar correos.'] });
  }

  try {
    await sendEmail(accessToken, {
      to: validRecipients.map((r: any) => r.email),
      subject: `[Seguimiento] ${alert.name}`,
      body: buildAlertEmailBody(alert),
    });

    if (alert.id && /^\d+$/.test(String(alert.id))) {
      await sql`UPDATE alertas SET ultimo_disparo = NOW() WHERE alerta_id = ${Number(alert.id)}`;
    }

    return response.status(200).json({ data: { sent: true, recipientCount: validRecipients.length }, meta: {}, errors: [] });
  } catch (error) {
    console.error('Alert delivery failed', error);
    return response.status(502).json({ data: null, meta: {}, errors: [error instanceof Error ? error.message : 'No fue posible enviar el correo.'] });
  }
}

async function handleCronSweep(response: VercelResponse, sql: SqlClient) {
  const accessToken = await getConnectedAccessToken(sql);
  if (!accessToken) {
    return response.status(200).json({ data: { evaluated: 0, sent: 0, skipped: 'no-connected-google-account' }, meta: {}, errors: [] });
  }

  const dueAlerts = (await sql`
    SELECT a.alerta_id AS id, a.nombre AS name, a.frecuencia AS schedule, a.tipo AS type,
           COALESCE(p.nombre, 'Todos los proyectos') AS "projectName"
    FROM alertas a
    LEFT JOIN proyectos p ON p.proyecto_id = a.proyecto_id
    WHERE a.activa = TRUE AND (a.ultimo_disparo IS NULL OR a.ultimo_disparo < NOW() - INTERVAL '1 day')
  `) as any[];

  let sentCount = 0;
  for (const alert of dueAlerts) {
    const recipientRows = (await sql`
      SELECT c.email FROM alerta_contacto ac
      JOIN contactos c ON c.contacto_id = ac.contacto_id
      WHERE ac.alerta_id = ${alert.id} AND c.email IS NOT NULL AND c.email <> ''
    `) as any[];
    if (recipientRows.length === 0) continue;

    try {
      await sendEmail(accessToken, {
        to: recipientRows.map((r: any) => r.email),
        subject: `[Seguimiento] ${alert.name}`,
        body: buildAlertEmailBody(alert),
      });
      await sql`UPDATE alertas SET ultimo_disparo = NOW() WHERE alerta_id = ${alert.id}`;
      sentCount++;
    } catch (error) {
      console.error('Cron alert send failed', alert.id, error);
    }
  }

  return response.status(200).json({ data: { evaluated: dueAlerts.length, sent: sentCount }, meta: {}, errors: [] });
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(request.method || '')) {
    return response.status(405).json({ data: null, meta: {}, errors: ['Método no permitido.'] });
  }

  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl?.trim()) {
      return response.status(503).json({ data: null, meta: {}, errors: ['DATABASE_URL no está configurada en Vercel.'] });
    }
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(databaseUrl);

    const cronSecret = process.env.CRON_SECRET;
    const isCronRequest = request.method === 'GET' && !!cronSecret && request.headers.authorization === `Bearer ${cronSecret}`;
    if (isCronRequest) {
      return handleCronSweep(response, sql);
    }

    if (request.method === 'GET') {
      const idRows = (await sql`SELECT alerta_id AS id FROM alertas`) as any[];
      const alerts = await fetchAlertsByIds(sql, idRows.map((r) => r.id));
      return response.status(200).json({ data: alerts, meta: { total: alerts.length }, errors: [] });
    }

    if (request.method === 'DELETE') {
      const alertId = Number(request.query.alertId);
      if (!Number.isInteger(alertId) || alertId <= 0) {
        return response.status(400).json({ data: null, meta: {}, errors: ['El id de la alerta es obligatorio.'] });
      }
      await sql`DELETE FROM alerta_contacto WHERE alerta_id = ${alertId}`;
      await sql`DELETE FROM alerta_dia WHERE alerta_id = ${alertId}`;
      const deleted = await sql`DELETE FROM alertas WHERE alerta_id = ${alertId} RETURNING alerta_id AS id`;
      if (!deleted[0]) return response.status(404).json({ data: null, meta: {}, errors: ['Alerta no encontrada.'] });
      return response.status(200).json({ data: deleted[0], meta: {}, errors: [] });
    }

    if (request.method === 'PATCH') {
      const body = request.body ?? {};
      const alertId = Number(body.alertId);
      if (!Number.isInteger(alertId) || alertId <= 0) {
        return response.status(400).json({ data: null, meta: {}, errors: ['Falta alertId.'] });
      }

      const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
      const current = await fetchAlertsByIds(sql, [alertId]);
      if (!current[0]) return response.status(404).json({ data: null, meta: {}, errors: ['Alerta no encontrada.'] });

      const nextName = has('name') ? body.name : current[0].name;
      const nextSchedule = has('schedule') ? body.schedule : current[0].schedule;
      const nextTime = has('time') ? body.time : current[0].time;
      const nextType = has('type') ? body.type : current[0].type;
      const nextProjectId = has('projectId') ? (body.projectId || null) : current[0].projectId;
      const nextActive = has('active') ? Boolean(body.active) : current[0].active;

      await sql`
        UPDATE alertas
        SET nombre = ${nextName}, frecuencia = ${nextSchedule}, hora_texto = ${nextTime},
            tipo = ${nextType}, proyecto_id = ${nextProjectId}, activa = ${nextActive}, updated_at = NOW()
        WHERE alerta_id = ${alertId}
      `;

      if (has('recipientIds') && Array.isArray(body.recipientIds)) {
        await sql`DELETE FROM alerta_contacto WHERE alerta_id = ${alertId}`;
        for (const contactId of body.recipientIds) {
          await sql`INSERT INTO alerta_contacto (alerta_id, contacto_id) VALUES (${alertId}, ${contactId})`;
        }
      }

      const [alert] = await fetchAlertsByIds(sql, [alertId]);
      return response.status(200).json({ data: alert, meta: {}, errors: [] });
    }

    // POST
    if (request.body?.action === 'send') {
      return handleSend(request, response, sql);
    }

    const { projectId, name, schedule, time, type, recipientIds } = request.body ?? {};
    if (!name || !Array.isArray(recipientIds) || recipientIds.length === 0) {
      return response.status(400).json({ data: null, meta: {}, errors: ['Nombre y al menos un destinatario son obligatorios.'] });
    }

    const inserted = await sql`
      INSERT INTO alertas (alerta_id, proyecto_id, nombre, frecuencia, hora_texto, tipo, activa, created_at, updated_at)
      VALUES (
        COALESCE((SELECT MAX(alerta_id) FROM alertas), 0) + 1,
        ${projectId || null}, ${name}, ${schedule || ''}, ${time || ''}, ${type || 'Seguimiento'}, TRUE, NOW(), NOW()
      )
      RETURNING alerta_id AS id
    `;
    const alertId = inserted[0].id;

    for (const contactId of recipientIds) {
      await sql`INSERT INTO alerta_contacto (alerta_id, contacto_id) VALUES (${alertId}, ${contactId})`;
    }

    const [alert] = await fetchAlertsByIds(sql, [alertId]);
    return response.status(201).json({ data: alert, meta: {}, errors: [] });
  } catch (error) {
    console.error('Alerts query failed', error);
    return response.status(503).json({ data: null, meta: {}, errors: ['No fue posible consultar o guardar las alertas.'] });
  }
}
