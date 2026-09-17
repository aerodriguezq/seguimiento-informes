import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDriveAccessToken } from '../server/google-drive.js';
import { findDeliveryEmail } from '../server/google-gmail.js';

type SqlClient = ReturnType<typeof import('@neondatabase/serverless').neon>;

const MONTHS_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function nextMonthYear(monthName: string, year: number) {
  const idx = MONTHS_ES.indexOf(monthName);
  if (idx === -1) return { month: monthName, year: year + 1 };
  const nextIdx = (idx + 1) % 12;
  return { month: MONTHS_ES[nextIdx], year: idx === 11 ? year + 1 : year };
}

function addOneMonth(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}

// Compone el asunto real esperado a partir de la base configurada en el
// paso más el número de secuencia del informe (01, 02, 03...), ej.
// "Entrega Mensual Informe de Ejecución 02".
function composeStepEmailSubject(baseSubject: string, sequenceNumber: number | null): string {
  if (sequenceNumber == null) return baseSubject;
  return `${baseSubject} ${String(sequenceNumber).padStart(2, '0')}`;
}

async function fetchReportsByIds(sql: SqlClient, ids: number[]) {
  if (ids.length === 0) return [];

  const reportRows = (await sql`
    SELECT
      i.informe_id AS id,
      i.proyecto_id AS "projectId",
      p.nombre AS "projectName",
      p.bpin AS "projectBpin",
      i.tipo_informe_id AS "typeId",
      ti.nombre AS "typeName",
      i.mes_nombre AS month,
      i.anio AS year,
      TO_CHAR(i.fecha, 'YYYY-MM-DD') AS "dueDate",
      i.estado AS status,
      i.consecutivo AS consecutive,
      i.observaciones AS observations,
      i.created_at AS "createdAt",
      i.flujo_completado AS "isWorkflowCompleted",
      i.numero_secuencia AS "sequenceNumber",
      wp.paso_id AS "currentStepId",
      wp.nombre AS "currentStepName",
      wp.es_final AS "currentStepIsFinal",
      wp.asunto_correo AS "currentStepEmailSubjectBase"
    FROM informes i
    JOIN proyectos p ON p.proyecto_id = i.proyecto_id
    JOIN tipos_informe ti ON ti.tipo_informe_id = i.tipo_informe_id
    LEFT JOIN tipo_informe_pasos wp ON wp.paso_id = i.paso_actual_id
    WHERE i.informe_id = ANY(${ids})
    ORDER BY i.created_at DESC
  `) as any[];

  const contactRows = (await sql`
    SELECT informe_id AS "reportId", contacto_id AS "contactId", es_principal AS "isPrimary"
    FROM informe_contacto
    WHERE informe_id = ANY(${ids})
  `) as any[];

  const historyRows = (await sql`
    SELECT informe_id AS "reportId", estado AS status, fecha_evento AS date, usuario_nombre AS "userName", comentario AS comment
    FROM seguimiento_informe
    WHERE informe_id = ANY(${ids})
    ORDER BY fecha_evento ASC
  `) as any[];

  const attachmentRows = (await sql`
    SELECT adjunto_id AS id, informe_id AS "reportId", nombre AS name, drive_url AS "driveUrl", subido_por AS "uploadedBy", subido_en AS "uploadedAt"
    FROM informe_adjuntos
    WHERE informe_id = ANY(${ids})
    ORDER BY subido_en ASC
  `) as any[];

  const stepAlertRows = (await sql`
    SELECT alerta_id AS id, informe_id AS "reportId", nombre AS name, activa AS active
    FROM alertas
    WHERE informe_id = ANY(${ids})
  `) as any[];

  return reportRows.map((report: any) => {
    const contacts = contactRows.filter((c: any) => c.reportId === report.id);
    const primary = contacts.find((c: any) => c.isPrimary);
    const stepAlerts = stepAlertRows.filter((a: any) => a.reportId === report.id);
    return {
      ...report,
      contactIds: contacts.map((c: any) => String(c.contactId)),
      primaryContactId: primary ? String(primary.contactId) : (contacts[0] ? String(contacts[0].contactId) : ''),
      history: historyRows.filter((h: any) => h.reportId === report.id),
      attachments: attachmentRows.filter((a: any) => a.reportId === report.id),
      alertRulesCount: stepAlerts.filter((a: any) => a.active).length,
      currentStepEmailSubject: report.currentStepEmailSubjectBase
        ? composeStepEmailSubject(report.currentStepEmailSubjectBase, report.sequenceNumber)
        : null,
    };
  });
}

async function createStepAlert(sql: SqlClient, reportId: number, projectId: number, stepId: number, stepName: string) {
  const stepContacts = (await sql`SELECT contacto_id AS "contactId" FROM tipo_informe_paso_contacto WHERE paso_id = ${stepId}`) as any[];
  if (stepContacts.length === 0) return;

  const insertedAlerts = await sql`
    INSERT INTO alertas (alerta_id, proyecto_id, informe_id, paso_id, nombre, frecuencia, tipo, activa, created_at, updated_at)
    VALUES (
      COALESCE((SELECT MAX(alerta_id) FROM alertas), 0) + 1,
      ${projectId}, ${reportId}, ${stepId}, ${`Recordatorio: ${stepName}`}, 'Diario hasta la entrega', 'Seguimiento', TRUE, NOW(), NOW()
    )
    RETURNING alerta_id AS id
  `;
  const alertId = insertedAlerts[0].id;
  for (const contact of stepContacts) {
    await sql`INSERT INTO alerta_contacto (alerta_id, contacto_id) VALUES (${alertId}, ${contact.contactId})`;
  }
}

// Crea la alerta del primer paso configurado para el tipo de informe (si existe)
// y deja el informe apuntando a ese paso. Sin pasos configurados, no hace nada.
async function seedFirstWorkflowStep(sql: SqlClient, reportId: number, typeId: number, projectId: number) {
  const [firstStep] = (await sql`
    SELECT paso_id AS id, nombre AS name
    FROM tipo_informe_pasos
    WHERE tipo_informe_id = ${typeId}
    ORDER BY orden ASC
    LIMIT 1
  `) as any[];
  if (!firstStep) return;

  await sql`UPDATE informes SET paso_actual_id = ${firstStep.id} WHERE informe_id = ${reportId}`;
  await createStepAlert(sql, reportId, projectId, firstStep.id, firstStep.name);
}

type CreateReportInput = {
  projectId: number;
  typeId: number;
  month: string;
  year: number;
  dueDate: string;
  status: string;
  contactIds: (string | number)[];
  primaryContactId?: string | number;
  observations?: string;
  userName?: string;
};

async function createReportRow(sql: SqlClient, input: CreateReportInput): Promise<number> {
  const insertedReports = await sql`
    INSERT INTO informes (informe_id, proyecto_id, tipo_informe_id, estado, mes_nombre, anio, fecha, observaciones, created_at, updated_at)
    VALUES (
      COALESCE((SELECT MAX(informe_id) FROM informes), 0) + 1,
      ${input.projectId}, ${input.typeId}, ${input.status}, ${input.month}, ${input.year}, ${input.dueDate},
      ${input.observations || 'Apertura de informe para seguimiento del cronograma contractual.'},
      NOW(), NOW()
    )
    RETURNING informe_id AS id
  `;
  const reportId = insertedReports[0].id;

  const [typeRow] = (await sql`SELECT codigo FROM tipos_informe WHERE tipo_informe_id = ${input.typeId}`) as any[];
  const typeCode = typeRow?.codigo || 'INF';
  const [{ count }] = (await sql`
    SELECT COUNT(*) AS count FROM informes WHERE tipo_informe_id = ${input.typeId} AND anio = ${input.year}
  `) as any[];
  const consecutive = `${typeCode}-${input.year}-${String(count).padStart(3, '0')}`;

  const [{ seqCount }] = (await sql`
    SELECT COUNT(*) AS "seqCount" FROM informes WHERE tipo_informe_id = ${input.typeId} AND proyecto_id = ${input.projectId}
  `) as any[];

  await sql`UPDATE informes SET consecutivo = ${consecutive}, numero_secuencia = ${Number(seqCount)} WHERE informe_id = ${reportId}`;

  const primaryContactId = input.primaryContactId || input.contactIds[0];
  for (const contactId of input.contactIds) {
    await sql`
      INSERT INTO informe_contacto (informe_id, contacto_id, es_principal)
      VALUES (${reportId}, ${contactId}, ${contactId === primaryContactId})
    `;
  }

  await sql`
    INSERT INTO seguimiento_informe (seguimiento_id, informe_id, estado, fecha_evento, usuario_nombre, comentario)
    VALUES (
      COALESCE((SELECT MAX(seguimiento_id) FROM seguimiento_informe), 0) + 1,
      ${reportId}, ${input.status}, NOW(), ${input.userName || 'Usuario'},
      ${input.observations || 'Creación inicial del informe.'}
    )
  `;

  await seedFirstWorkflowStep(sql, reportId, input.typeId, input.projectId);
  return reportId;
}

// Fase E: si el tipo de informe es mensual y el proyecto sigue vigente en la
// fecha del próximo período, programa automáticamente el informe del mes
// siguiente con los mismos responsables, reiniciando el flujo en el paso 1.
async function maybeScheduleNextMonth(sql: SqlClient, reportId: number) {
  const [report] = (await sql`
    SELECT i.proyecto_id AS "projectId", i.tipo_informe_id AS "typeId", i.mes_nombre AS month, i.anio AS year,
           TO_CHAR(i.fecha, 'YYYY-MM-DD') AS "dueDate", ti.periodicidad AS periodicity,
           TO_CHAR(p.fecha_fin, 'YYYY-MM-DD') AS "projectEndDate"
    FROM informes i
    JOIN tipos_informe ti ON ti.tipo_informe_id = i.tipo_informe_id
    JOIN proyectos p ON p.proyecto_id = i.proyecto_id
    WHERE i.informe_id = ${reportId}
  `) as any[];
  if (!report || report.periodicity !== 'Mensual') return;

  const { month: nextMonth, year: nextYear } = nextMonthYear(report.month, report.year);
  const nextDueDate = addOneMonth(report.dueDate);
  if (report.projectEndDate && nextDueDate > report.projectEndDate) return;

  const contactRows = (await sql`
    SELECT contacto_id AS "contactId", es_principal AS "isPrimary" FROM informe_contacto WHERE informe_id = ${reportId}
  `) as any[];
  if (contactRows.length === 0) return;

  await createReportRow(sql, {
    projectId: report.projectId,
    typeId: report.typeId,
    month: nextMonth,
    year: nextYear,
    dueDate: nextDueDate,
    status: 'Pendientes Evidencias',
    contactIds: contactRows.map((c: any) => c.contactId),
    primaryContactId: contactRows.find((c: any) => c.isPrimary)?.contactId,
    observations: `Continuación automática de ${report.month} ${report.year}.`,
    userName: 'Sistema (generación automática)',
  });
}

// Núcleo compartido entre el avance manual (PATCH advance_step) y la
// detección automática por correo (Fase D / barrido cron).
class NoWorkflowStepError extends Error {}

async function advanceReportStep(sql: SqlClient, reportId: number): Promise<void> {
  const [current] = (await sql`
    SELECT i.proyecto_id AS "projectId", i.tipo_informe_id AS "typeId", i.paso_actual_id AS "currentStepId",
           p.orden AS "currentOrder", p.es_final AS "isFinal"
    FROM informes i
    LEFT JOIN tipo_informe_pasos p ON p.paso_id = i.paso_actual_id
    WHERE i.informe_id = ${reportId}
  `) as any[];

  if (!current?.currentStepId) {
    throw new NoWorkflowStepError('Este informe no tiene un flujo de pasos configurado.');
  }

  await sql`UPDATE alertas SET activa = FALSE, updated_at = NOW() WHERE informe_id = ${reportId} AND paso_id = ${current.currentStepId}`;

  if (current.isFinal) {
    await sql`UPDATE informes SET flujo_completado = TRUE, estado = 'Enviado', updated_at = NOW() WHERE informe_id = ${reportId}`;
    await maybeScheduleNextMonth(sql, reportId);
    return;
  }

  const [nextStep] = (await sql`
    SELECT paso_id AS id, nombre AS name
    FROM tipo_informe_pasos
    WHERE tipo_informe_id = ${current.typeId} AND orden > ${current.currentOrder}
    ORDER BY orden ASC
    LIMIT 1
  `) as any[];

  if (nextStep) {
    await sql`UPDATE informes SET paso_actual_id = ${nextStep.id}, updated_at = NOW() WHERE informe_id = ${reportId}`;
    await createStepAlert(sql, reportId, current.projectId, nextStep.id, nextStep.name);
  } else {
    await sql`UPDATE informes SET flujo_completado = TRUE, estado = 'Enviado', updated_at = NOW() WHERE informe_id = ${reportId}`;
    await maybeScheduleNextMonth(sql, reportId);
  }
}

// Fase D: revisa cada informe con un paso pendiente y busca en la cuenta de
// Google conectada un correo entrante con el asunto esperado de ese paso,
// de alguno de sus contactos responsables. Si aparece, avanza el flujo.
async function runDeliveryDetectionSweep(response: VercelResponse, sql: SqlClient) {
  const session = await sql`
    SELECT session_id, token_json FROM google_drive_sessions WHERE expires_at > NOW() ORDER BY created_at DESC LIMIT 1
  `;
  if (!session[0]) {
    return response.status(200).json({ data: { checked: 0, advanced: 0, skipped: 'no-connected-google-account' }, meta: {}, errors: [] });
  }

  let accessToken: string;
  try {
    accessToken = await getDriveAccessToken(session[0].token_json);
  } catch (error) {
    console.error('Delivery sweep: no fue posible obtener el token de acceso', error);
    return response.status(200).json({ data: { checked: 0, advanced: 0, skipped: 'token-error' }, meta: {}, errors: [] });
  }

  const pendingSteps = (await sql`
    SELECT i.informe_id AS "reportId", wp.paso_id AS "stepId", wp.asunto_correo AS "emailSubjectBase",
           i.numero_secuencia AS "sequenceNumber", i.updated_at AS "stepStartedAt"
    FROM informes i
    JOIN tipo_informe_pasos wp ON wp.paso_id = i.paso_actual_id
    WHERE i.flujo_completado = FALSE AND i.paso_actual_id IS NOT NULL
  `) as any[];

  let advanced = 0;
  for (const step of pendingSteps) {
    const expectedSubject = composeStepEmailSubject(step.emailSubjectBase, step.sequenceNumber);
    const contactRows = (await sql`
      SELECT c.email FROM tipo_informe_paso_contacto tpc
      JOIN contactos c ON c.contacto_id = tpc.contacto_id
      WHERE tpc.paso_id = ${step.stepId} AND c.email IS NOT NULL AND c.email <> ''
    `) as any[];

    try {
      const match = await findDeliveryEmail(
        accessToken,
        expectedSubject,
        contactRows.map((c: any) => c.email),
        new Date(step.stepStartedAt),
      );
      if (match.found) {
        if (match.driveUrl) {
          await sql`
            INSERT INTO informe_adjuntos (adjunto_id, informe_id, nombre, drive_url, subido_por, subido_en)
            VALUES (
              COALESCE((SELECT MAX(adjunto_id) FROM informe_adjuntos), 0) + 1,
              ${step.reportId}, ${`Evidencia recibida por correo (${expectedSubject})`}, ${match.driveUrl},
              ${match.fromEmail || 'Detección automática'}, NOW()
            )
          `;
        }
        await advanceReportStep(sql, step.reportId);
        advanced++;
      }
    } catch (error) {
      console.error('Delivery sweep failed for report', step.reportId, error);
    }
  }

  return response.status(200).json({ data: { checked: pendingSteps.length, advanced }, meta: {}, errors: [] });
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'GET' && request.method !== 'POST' && request.method !== 'PATCH') {
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
      return runDeliveryDetectionSweep(response, sql);
    }

    if (request.method === 'GET') {
      const idRows = await sql`SELECT informe_id AS id FROM informes`;
      const reports = await fetchReportsByIds(sql, idRows.map((r: any) => r.id));
      reports.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return response.status(200).json({ data: reports, meta: { total: reports.length }, errors: [] });
    }

    if (request.method === 'POST') {
      const { projectId, typeId, month, year, dueDate, status, contactIds, primaryContactId, observations, userName } = request.body ?? {};

      if (
        !projectId || !typeId || !month || !year || !dueDate || !status ||
        !Array.isArray(contactIds) || contactIds.length === 0
      ) {
        return response.status(400).json({ data: null, meta: {}, errors: ['Faltan campos obligatorios para crear el informe.'] });
      }

      const reportId = await createReportRow(sql, {
        projectId, typeId, month, year, dueDate, status, contactIds, primaryContactId, observations, userName,
      });

      const [report] = await fetchReportsByIds(sql, [reportId]);
      return response.status(201).json({ data: report, meta: {}, errors: [] });
    }

    // PATCH
    const { action, reportId } = request.body ?? {};
    if (!reportId) {
      return response.status(400).json({ data: null, meta: {}, errors: ['Falta reportId.'] });
    }

    if (action === 'status') {
      const { status, comment, userName } = request.body ?? {};
      if (!status) return response.status(400).json({ data: null, meta: {}, errors: ['Falta el nuevo estado.'] });

      await sql`UPDATE informes SET estado = ${status}, updated_at = NOW() WHERE informe_id = ${reportId}`;
      await sql`
        INSERT INTO seguimiento_informe (seguimiento_id, informe_id, estado, fecha_evento, usuario_nombre, comentario)
        VALUES (
          COALESCE((SELECT MAX(seguimiento_id) FROM seguimiento_informe), 0) + 1,
          ${reportId}, ${status}, NOW(), ${userName || 'Usuario'}, ${comment || ''}
        )
      `;
    } else if (action === 'advance_step') {
      try {
        await advanceReportStep(sql, reportId);
      } catch (error) {
        if (error instanceof NoWorkflowStepError) {
          return response.status(400).json({ data: null, meta: {}, errors: [error.message] });
        }
        throw error;
      }
    } else if (action === 'attachment') {
      const { attachment, userName } = request.body ?? {};
      if (!attachment?.name || !attachment?.driveUrl) {
        return response.status(400).json({ data: null, meta: {}, errors: ['Nombre y link de Google Drive son obligatorios.'] });
      }
      if (!/^https:\/\/(drive|docs)\.google\.com\//.test(attachment.driveUrl)) {
        return response.status(400).json({ data: null, meta: {}, errors: ['El link debe ser de Google Drive o Docs.'] });
      }

      await sql`
        INSERT INTO informe_adjuntos (adjunto_id, informe_id, nombre, drive_url, subido_por, subido_en)
        VALUES (
          COALESCE((SELECT MAX(adjunto_id) FROM informe_adjuntos), 0) + 1,
          ${reportId}, ${attachment.name}, ${attachment.driveUrl}, ${userName || attachment.uploadedBy || 'Usuario'}, NOW()
        )
      `;
    } else {
      return response.status(400).json({ data: null, meta: {}, errors: ['Acción no reconocida.'] });
    }

    const [report] = await fetchReportsByIds(sql, [reportId]);
    if (!report) return response.status(404).json({ data: null, meta: {}, errors: ['Informe no encontrado.'] });
    return response.status(200).json({ data: report, meta: {}, errors: [] });
  } catch (error) {
    console.error('Reports query failed', error);
    return response.status(503).json({ data: null, meta: {}, errors: ['No fue posible consultar o guardar los informes.'] });
  }
}
