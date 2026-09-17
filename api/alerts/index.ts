import type { VercelRequest, VercelResponse } from '@vercel/node';

type SqlClient = ReturnType<typeof import('@neondatabase/serverless').neon>;

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
  const webhookUrl = process.env.APP_SCRIPT_WEBHOOK_URL;
  const sharedSecret = process.env.APP_SCRIPT_SHARED_SECRET;
  if (!webhookUrl || !sharedSecret) {
    return response.status(503).json({ data: null, meta: {}, errors: ['El envío por Google Apps Script no está configurado en Vercel.'] });
  }

  const { alert, recipients } = request.body ?? {};
  const validRecipients = (Array.isArray(recipients) ? recipients : []).filter(
    (recipient: any) => typeof recipient?.email === 'string' && recipient.email.includes('@'),
  );

  if (!alert?.name || validRecipients.length === 0) {
    return response.status(400).json({ data: null, meta: {}, errors: ['La alerta y al menos un destinatario válido son obligatorios.'] });
  }

  try {
    const scriptResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: sharedSecret,
        alert: {
          name: String(alert.name),
          projectName: String(alert.projectName || 'Todos los proyectos'),
          type: String(alert.type || 'Seguimiento'),
          schedule: String(alert.schedule || ''),
        },
        recipients: validRecipients,
      }),
    });
    const scriptPayload = await scriptResponse.json().catch(() => null);

    if (!scriptResponse.ok || scriptPayload?.ok !== true) {
      console.error('Google Apps Script rejected alert', scriptResponse.status, scriptPayload);
      return response.status(502).json({ data: null, meta: {}, errors: ['Google Apps Script no confirmó el envío.'] });
    }

    if (alert.id && /^\d+$/.test(String(alert.id))) {
      await sql`UPDATE alertas SET ultimo_disparo = NOW() WHERE alerta_id = ${Number(alert.id)}`;
    }

    return response.status(200).json({ data: { sent: true, recipientCount: validRecipients.length }, meta: {}, errors: [] });
  } catch (error) {
    console.error('Alert delivery failed', error);
    return response.status(502).json({ data: null, meta: {}, errors: ['No fue posible contactar Google Apps Script.'] });
  }
}

async function handleCronSweep(response: VercelResponse, sql: SqlClient) {
  const webhookUrl = process.env.APP_SCRIPT_WEBHOOK_URL;
  const sharedSecret = process.env.APP_SCRIPT_SHARED_SECRET;
  if (!webhookUrl || !sharedSecret) {
    return response.status(200).json({ data: { evaluated: 0, sent: 0, skipped: 'apps-script-not-configured' }, meta: {}, errors: [] });
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
      SELECT c.email, c.nombre AS name
      FROM alerta_contacto ac
      JOIN contactos c ON c.contacto_id = ac.contacto_id
      WHERE ac.alerta_id = ${alert.id} AND c.email IS NOT NULL AND c.email <> ''
    `) as any[];
    if (recipientRows.length === 0) continue;

    try {
      const scriptResponse = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: sharedSecret,
          alert: { name: alert.name, projectName: alert.projectName, type: alert.type, schedule: alert.schedule },
          recipients: recipientRows.map((r) => ({ email: r.email, name: r.name })),
        }),
      });
      const payload = await scriptResponse.json().catch(() => null);
      if (scriptResponse.ok && payload?.ok === true) {
        await sql`UPDATE alertas SET ultimo_disparo = NOW() WHERE alerta_id = ${alert.id}`;
        sentCount++;
      }
    } catch (error) {
      console.error('Cron alert send failed', alert.id, error);
    }
  }

  return response.status(200).json({ data: { evaluated: dueAlerts.length, sent: sentCount }, meta: {}, errors: [] });
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (!['GET', 'POST', 'PATCH'].includes(request.method || '')) {
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

    if (request.method === 'PATCH') {
      const { alertId, active } = request.body ?? {};
      if (!alertId) return response.status(400).json({ data: null, meta: {}, errors: ['Falta alertId.'] });
      await sql`UPDATE alertas SET activa = ${Boolean(active)}, updated_at = NOW() WHERE alerta_id = ${alertId}`;
      const [alert] = await fetchAlertsByIds(sql, [Number(alertId)]);
      if (!alert) return response.status(404).json({ data: null, meta: {}, errors: ['Alerta no encontrada.'] });
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
