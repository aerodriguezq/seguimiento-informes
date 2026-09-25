import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDriveAccessToken } from '../../server/google-drive.js';
import { sendEmail, buildAlertEmailHtml, buildPeticionReminderEmailHtml } from '../../server/google-gmail.js';
import { getSweepGate, recordSweepRun } from '../../server/sweep-config.js';
import { canEditModuleRequest } from '../../server/admin-auth.js';

type SqlClient = ReturnType<typeof import('@neondatabase/serverless').neon>;

async function getConnectedAccessToken(sql: SqlClient): Promise<string | null> {
  const session = (await sql`
    SELECT token_json FROM google_drive_sessions WHERE expires_at > NOW() ORDER BY created_at DESC LIMIT 1
  `) as any[];
  if (!session[0]) return null;
  return getDriveAccessToken(session[0].token_json);
}

// Busca el tipo de informe y calcula los días restantes hasta la fecha
// límite del informe vinculado a la alerta (si la alerta viene de un paso
// de flujo). Sin informe vinculado, no hay urgencia que calcular.
async function resolveReportContext(sql: SqlClient, reportId: unknown) {
  const id = Number(reportId);
  if (!Number.isInteger(id) || id <= 0) return { typeName: null as string | null, daysRemaining: null as number | null };

  const [row] = (await sql`
    SELECT ti.nombre AS "typeName", i.fecha AS "dueDate"
    FROM informes i
    JOIN tipos_informe ti ON ti.tipo_informe_id = i.tipo_informe_id
    WHERE i.informe_id = ${id}
  `) as any[];
  if (!row) return { typeName: null, daysRemaining: null };

  const due = new Date(row.dueDate);
  due.setUTCHours(0, 0, 0, 0);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const daysRemaining = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return { typeName: row.typeName as string | null, daysRemaining };
}

async function buildAlertEmail(sql: SqlClient, alert: { name: string; projectName?: string; type?: string; schedule?: string; reportId?: unknown }) {
  const context = await resolveReportContext(sql, alert.reportId);
  const actionUrl = `${(process.env.APP_URL || 'https://seguimiento-informes.vercel.app').replace(/\/$/, '')}/reports`;
  return buildAlertEmailHtml({
    subtitle: context.typeName || alert.type || 'Seguimiento',
    projectName: alert.projectName || 'Todos los proyectos',
    type: alert.type || 'Seguimiento',
    schedule: alert.schedule || '',
    daysRemaining: context.daysRemaining,
    actionUrl,
  });
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
    const html = await buildAlertEmail(sql, alert);
    await sendEmail(accessToken, {
      to: validRecipients.map((r: any) => r.email),
      subject: `[Seguimiento] ${alert.name}`,
      body: html,
      html: true,
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

type PeticionNivel = 'verde' | 'amarillo' | 'rojo';
const PETICION_NIVEL_RANK: Record<PeticionNivel, number> = { verde: 1, amarillo: 2, rojo: 3 };

// Umbrales fijos: 5 días antes = verde, 3 días = amarillo, 2 días en
// adelante (incluye vencido) = rojo. El resto de los días no dispara nada.
function peticionLevelForDays(days: number): PeticionNivel | null {
  if (days <= 2) return 'rojo';
  if (days === 3) return 'amarillo';
  if (days === 5) return 'verde';
  return null;
}

async function sendPeticionReminder(
  sql: SqlClient,
  accessToken: string,
  peticion: {
    id: number;
    radicado: string;
    asunto: string;
    peticionario: string;
    areaConsolida: string;
    fechaPlazoRespuesta: string | null;
    correoPersonaAsignada: string | null;
  },
  level: PeticionNivel,
  daysRemaining: number | null,
): Promise<boolean> {
  // Los responsables (Contactos asignados) reciben el correo principal; el
  // "correo adicional" libre va solo en copia (CC), nunca como único
  // destinatario salvo que no haya ningún responsable asignado.
  const recipientRows = (await sql`
    SELECT c.email FROM peticion_responsables pr
    JOIN contactos c ON c.contacto_id = pr.contacto_id
    WHERE pr.peticion_id = ${peticion.id} AND c.email IS NOT NULL AND c.email <> ''
  `) as any[];
  const toEmails = recipientRows.map((r: any) => r.email as string);
  const hasCc = !!peticion.correoPersonaAsignada && peticion.correoPersonaAsignada.includes('@');

  let finalTo = toEmails;
  let finalCc: string[] | undefined;
  if (toEmails.length > 0) {
    finalCc = hasCc ? [peticion.correoPersonaAsignada as string] : undefined;
  } else if (hasCc) {
    finalTo = [peticion.correoPersonaAsignada as string];
  }
  if (finalTo.length === 0) return false;

  const actionUrl = `${(process.env.APP_URL || 'https://seguimiento-informes.vercel.app').replace(/\/$/, '')}/peticiones`;
  const html = buildPeticionReminderEmailHtml({
    level,
    radicado: peticion.radicado,
    asunto: peticion.asunto,
    peticionario: peticion.peticionario,
    areaConsolida: peticion.areaConsolida,
    daysRemaining,
    fechaPlazoRespuesta: peticion.fechaPlazoRespuesta,
    actionUrl,
  });
  await sendEmail(accessToken, {
    to: finalTo,
    cc: finalCc,
    subject: `[Peticiones · ${level.toUpperCase()}] ${peticion.radicado} — ${peticion.asunto}`,
    body: html,
    html: true,
  });
  return true;
}

async function handlePeticionesReminders(sql: SqlClient, accessToken: string): Promise<{ evaluated: number; sent: number }> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const rows = (await sql`
    SELECT peticion_id AS id, radicado, asunto, peticionario, area_consolida AS "areaConsolida",
      correo_persona_asignada AS "correoPersonaAsignada",
      TO_CHAR(fecha_plazo_respuesta, 'YYYY-MM-DD') AS "fechaPlazoRespuesta",
      ultimo_recordatorio_nivel AS "ultimoNivel", TO_CHAR(ultimo_recordatorio_en, 'YYYY-MM-DD') AS "ultimoEn"
    FROM peticiones
    WHERE fecha_radicado_respuesta IS NULL AND fecha_plazo_respuesta IS NOT NULL
  `) as any[];

  let sentCount = 0;
  for (const p of rows) {
    const due = new Date(`${p.fechaPlazoRespuesta}T00:00:00Z`);
    const today = new Date(`${todayIso}T00:00:00Z`);
    const days = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const level = peticionLevelForDays(days);
    if (!level) continue;

    const oldRank = p.ultimoNivel ? PETICION_NIVEL_RANK[p.ultimoNivel as PeticionNivel] ?? 0 : 0;
    const shouldSend = PETICION_NIVEL_RANK[level] > oldRank || (level === 'rojo' && p.ultimoEn !== todayIso);
    if (!shouldSend) continue;

    try {
      const sent = await sendPeticionReminder(sql, accessToken, p, level, days);
      if (sent) {
        await sql`UPDATE peticiones SET ultimo_recordatorio_nivel = ${level}, ultimo_recordatorio_en = ${todayIso} WHERE peticion_id = ${p.id}`;
        sentCount++;
      }
    } catch (error) {
      console.error('Petición reminder send failed', p.id, error);
    }
  }

  return { evaluated: rows.length, sent: sentCount };
}

async function handleCronSweep(sql: SqlClient): Promise<{ evaluated: number; sent: number; skipped?: string }> {
  const accessToken = await getConnectedAccessToken(sql);
  if (!accessToken) {
    return { evaluated: 0, sent: 0, skipped: 'no-connected-google-account' };
  }

  const dueAlerts = (await sql`
    SELECT a.alerta_id AS id, a.nombre AS name, a.frecuencia AS schedule, a.tipo AS type,
           a.informe_id AS "reportId",
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
      const html = await buildAlertEmail(sql, alert);
      await sendEmail(accessToken, {
        to: recipientRows.map((r: any) => r.email),
        subject: `[Seguimiento] ${alert.name}`,
        body: html,
        html: true,
      });
      await sql`UPDATE alertas SET ultimo_disparo = NOW() WHERE alerta_id = ${alert.id}`;
      sentCount++;
    } catch (error) {
      console.error('Cron alert send failed', alert.id, error);
    }
  }

  const peticionesResult = await handlePeticionesReminders(sql, accessToken);

  return {
    evaluated: dueAlerts.length + peticionesResult.evaluated,
    sent: sentCount + peticionesResult.sent,
  };
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
      const force = request.query.force === 'true' || request.query.force === '1';
      const gate = await getSweepGate(sql, 'recordatorios_alertas', force);
      if (!gate.run) {
        return response.status(200).json({ data: { skipped: true, reason: gate.reason }, meta: {}, errors: [] });
      }
      try {
        const result = await handleCronSweep(sql);
        await recordSweepRun(sql, 'recordatorios_alertas', true, result);
        return response.status(200).json({ data: result, meta: {}, errors: [] });
      } catch (error) {
        await recordSweepRun(sql, 'recordatorios_alertas', false, { error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
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

    if (request.body?.action === 'sendPeticionReminder') {
      if (!(await canEditModuleRequest(request, sql, 'peticiones'))) {
        return response.status(403).json({ data: null, meta: {}, errors: ['No tienes permiso de edición en Peticiones.'] });
      }
      const peticionId = Number(request.body?.peticionId);
      if (!Number.isInteger(peticionId) || peticionId <= 0) {
        return response.status(400).json({ data: null, meta: {}, errors: ['El id de la petición es obligatorio.'] });
      }
      const [p] = (await sql`
        SELECT peticion_id AS id, radicado, asunto, peticionario, area_consolida AS "areaConsolida",
          correo_persona_asignada AS "correoPersonaAsignada",
          TO_CHAR(fecha_plazo_respuesta, 'YYYY-MM-DD') AS "fechaPlazoRespuesta"
        FROM peticiones WHERE peticion_id = ${peticionId}
      `) as any[];
      if (!p) return response.status(404).json({ data: null, meta: {}, errors: ['Petición no encontrada.'] });

      const accessToken = await getConnectedAccessToken(sql);
      if (!accessToken) {
        return response.status(503).json({ data: null, meta: {}, errors: ['Conecta una cuenta de Google (Fuentes Drive) para poder enviar correos.'] });
      }

      let daysRemaining: number | null = null;
      let level: 'verde' | 'amarillo' | 'rojo' = 'amarillo';
      if (p.fechaPlazoRespuesta) {
        const due = new Date(`${p.fechaPlazoRespuesta}T00:00:00Z`);
        const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
        daysRemaining = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        level = daysRemaining <= 2 ? 'rojo' : daysRemaining <= 4 ? 'amarillo' : 'verde';
      }

      try {
        const sent = await sendPeticionReminder(sql, accessToken, p, level, daysRemaining);
        if (!sent) {
          return response.status(400).json({ data: null, meta: {}, errors: ['Esta petición no tiene responsables ni correo asignado con un email válido.'] });
        }
        const todayIso = new Date().toISOString().slice(0, 10);
        await sql`UPDATE peticiones SET ultimo_recordatorio_nivel = ${level}, ultimo_recordatorio_en = ${todayIso} WHERE peticion_id = ${peticionId}`;
        return response.status(200).json({ data: { sent: true, level }, meta: {}, errors: [] });
      } catch (error) {
        return response.status(502).json({ data: null, meta: {}, errors: [error instanceof Error ? error.message : 'No fue posible enviar el recordatorio.'] });
      }
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
