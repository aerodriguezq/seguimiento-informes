import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDriveAccessToken } from '../server/google-drive.js';
import { findDeliveryEmail } from '../server/google-gmail.js';
import { getSweepGate, recordSweepRun } from '../server/sweep-config.js';
import { isAdminRequest, canEditModuleRequest } from '../server/admin-auth.js';

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

// Convierte un "día del mes" configurado (ej. 6, 8, 31) en una fecha real,
// recortándolo al último día real de ese mes (Regla 10: meses de 28-31
// días no deben romper el cálculo). No conoce festivos — eso queda para
// una fase futura si se necesita un calendario de festivos configurable.
function dateFromDayOfMonth(year: number, monthName: string, day: number): string | null {
  const idx = MONTHS_ES.indexOf(monthName);
  if (idx === -1) return null;
  const daysInMonth = new Date(Date.UTC(year, idx + 1, 0)).getUTCDate();
  const clampedDay = Math.min(Math.max(Math.trunc(day), 1), daysInMonth);
  return new Date(Date.UTC(year, idx, clampedDay)).toISOString().slice(0, 10);
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
      i.revisor_nombre AS "revisorNombre",
      TO_CHAR(i.fecha_entrega_real, 'YYYY-MM-DD') AS "fechaEntregaReal",
      TO_CHAR(i.fecha_revision, 'YYYY-MM-DD') AS "fechaRevision",
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

  // Fase 1 del motor de etapas: fechas calculadas + estado por paso (no
  // solo el paso actual), para poder ver la cadena completa de un informe.
  const stageInstanceRows = (await sql`
    SELECT ipi.informe_id AS "reportId", ipi.paso_id AS "stepId", wp.nombre AS "stepName", wp.orden AS "order",
      TO_CHAR(ipi.fecha_inicio, 'YYYY-MM-DD') AS "startDate", TO_CHAR(ipi.fecha_limite, 'YYYY-MM-DD') AS "dueDate",
      ipi.estado_etapa AS status, ipi.fecha_recepcion_real AS "receivedAt", ipi.correo_remitente AS "fromEmail"
    FROM informe_pasos_instancia ipi
    JOIN tipo_informe_pasos wp ON wp.paso_id = ipi.paso_id
    WHERE ipi.informe_id = ANY(${ids})
    ORDER BY wp.orden ASC
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
      stageInstances: stageInstanceRows.filter((s: any) => s.reportId === report.id),
    };
  });
}

// Calcula y guarda la fecha de inicio/límite de una etapa concreta de un
// informe (tabla informe_pasos_instancia). El primer paso usa su día de
// inicio configurado; los siguientes reciben su fecha de inicio real desde
// afuera (dynamicStartDate: el momento en que se detectó/confirmó la etapa
// anterior), no un día fijo — así una entrega temprana adelanta la
// siguiente etapa sin tocar su fecha límite configurada (Regla del
// requerimiento: "si la entrega se recibe antes, la siguiente etapa se
// activa de inmediato").
async function upsertStepInstance(
  sql: SqlClient,
  reportId: number,
  stepId: number,
  year: number,
  monthName: string,
  dynamicStartDate?: string,
) {
  const [step] = (await sql`
    SELECT orden, dia_inicio AS "diaInicio", dia_limite AS "diaLimite" FROM tipo_informe_pasos WHERE paso_id = ${stepId}
  `) as any[];
  if (!step) return;

  // El informe de un período (ej. Septiembre) se entrega el mes SIGUIENTE
  // (Octubre) -- todos los días configurados por paso (día de inicio, día
  // límite) son días de ese mes siguiente, no del mes del período, igual
  // que la fecha límite general del informe (computeReportDueDate).
  const { month: targetMonth, year: targetYear } = nextMonthYear(monthName, year);
  const fechaLimite = step.diaLimite ? dateFromDayOfMonth(targetYear, targetMonth, step.diaLimite) : null;
  const fechaInicio = dynamicStartDate ?? (step.orden === 1 && step.diaInicio ? dateFromDayOfMonth(targetYear, targetMonth, step.diaInicio) : null);

  await sql`
    INSERT INTO informe_pasos_instancia (informe_id, paso_id, fecha_inicio, fecha_limite, estado_etapa)
    VALUES (${reportId}, ${stepId}, ${fechaInicio}, ${fechaLimite}, 'ALERTA_GENERADA')
    ON CONFLICT (informe_id, paso_id) DO UPDATE SET
      fecha_inicio = EXCLUDED.fecha_inicio, fecha_limite = EXCLUDED.fecha_limite, updated_at = NOW()
  `;
}

// Cierra la etapa actual como recibida (a tiempo o tarde, comparando contra
// su propia fecha límite) y conserva la fecha REAL del evento -- la del
// correo cuando viene de la detección automática, o "ahora" cuando es un
// avance manual -- nunca se pierde ni se sobrescribe con la hora del
// barrido (Regla 4 del requerimiento).
async function finalizeStepInstance(
  sql: SqlClient,
  reportId: number,
  stepId: number,
  delivery: { receivedAt: Date; messageId?: string | null; fromEmail?: string | null },
) {
  const [instance] = (await sql`
    SELECT TO_CHAR(fecha_limite, 'YYYY-MM-DD') AS "dueDate" FROM informe_pasos_instancia WHERE informe_id = ${reportId} AND paso_id = ${stepId}
  `) as any[];
  const receivedIso = delivery.receivedAt.toISOString();
  const receivedDateOnly = receivedIso.slice(0, 10);
  const estado = instance?.dueDate ? (receivedDateOnly <= instance.dueDate ? 'RECIBIDA_A_TIEMPO' : 'RECIBIDA_TARDE') : 'RECIBIDA_A_TIEMPO';

  await sql`
    INSERT INTO informe_pasos_instancia (informe_id, paso_id, estado_etapa, fecha_recepcion_real, correo_gmail_id, correo_remitente)
    VALUES (${reportId}, ${stepId}, ${estado}, ${receivedIso}, ${delivery.messageId ?? null}, ${delivery.fromEmail ?? null})
    ON CONFLICT (informe_id, paso_id) DO UPDATE SET
      estado_etapa = EXCLUDED.estado_etapa, fecha_recepcion_real = EXCLUDED.fecha_recepcion_real,
      correo_gmail_id = EXCLUDED.correo_gmail_id, correo_remitente = EXCLUDED.correo_remitente, updated_at = NOW()
  `;
}

async function createStepAlert(
  sql: SqlClient,
  reportId: number,
  projectId: number,
  stepId: number,
  stepName: string,
  year: number,
  monthName: string,
  dynamicStartDate?: string,
) {
  await upsertStepInstance(sql, reportId, stepId, year, monthName, dynamicStartDate);

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

// Un proyecto puede tener su propio flujo completo para un tipo de informe
// (proyecto_id específico) en vez de usar la plantilla general
// (proyecto_id = NULL). Devuelve cuál de los dos aplica para ese proyecto.
async function resolveStepsScope(sql: SqlClient, typeId: number, projectId: number): Promise<number | null> {
  const [row] = (await sql`
    SELECT 1 AS found FROM tipo_informe_pasos WHERE tipo_informe_id = ${typeId} AND proyecto_id = ${projectId} LIMIT 1
  `) as any[];
  return row ? projectId : null;
}

// La "Fecha límite" general del informe (no la de cada etapa) se calcula
// con el día límite del PASO FINAL del flujo, aplicado al mes siguiente al
// período reportado -- ej. el informe de Septiembre, con el paso final
// configurado a día límite 10, vence el 10 de Octubre. Sin un paso final
// con día límite configurado, devuelve null (el llamador decide el
// respaldo, para no romper tipos de informe sin flujo configurado todavía).
async function computeReportDueDate(sql: SqlClient, typeId: number, projectId: number, month: string, year: number): Promise<string | null> {
  const scope = await resolveStepsScope(sql, typeId, projectId);
  const finalStepRows = (
    scope === null
      ? await sql`SELECT dia_limite AS "diaLimite" FROM tipo_informe_pasos WHERE tipo_informe_id = ${typeId} AND proyecto_id IS NULL AND es_final = TRUE ORDER BY orden DESC LIMIT 1`
      : await sql`SELECT dia_limite AS "diaLimite" FROM tipo_informe_pasos WHERE tipo_informe_id = ${typeId} AND proyecto_id = ${scope} AND es_final = TRUE ORDER BY orden DESC LIMIT 1`
  ) as any[];
  const diaLimite = finalStepRows[0]?.diaLimite;
  if (!diaLimite) return null;
  const { month: nextMonth, year: nextYear } = nextMonthYear(month, year);
  return dateFromDayOfMonth(nextYear, nextMonth, diaLimite);
}

// Responsables del informe = unión de los contactos configurados en TODOS
// los pasos del flujo de ese tipo de informe (mismo alcance que
// computeReportDueDate: flujo propio del proyecto si existe, si no la
// plantilla general) -- ya no se eligen a mano al crear el informe.
async function computeReportResponsables(
  sql: SqlClient,
  typeId: number,
  projectId: number,
): Promise<{ contactIds: string[]; primaryContactId: string | null }> {
  const scope = await resolveStepsScope(sql, typeId, projectId);
  const stepRows = (
    scope === null
      ? await sql`SELECT paso_id AS id, orden FROM tipo_informe_pasos WHERE tipo_informe_id = ${typeId} AND proyecto_id IS NULL ORDER BY orden ASC`
      : await sql`SELECT paso_id AS id, orden FROM tipo_informe_pasos WHERE tipo_informe_id = ${typeId} AND proyecto_id = ${scope} ORDER BY orden ASC`
  ) as any[];
  const stepIds = stepRows.map((s: any) => s.id);
  if (stepIds.length === 0) return { contactIds: [], primaryContactId: null };

  const contactRows = (await sql`
    SELECT paso_id AS "stepId", contacto_id AS id, es_principal AS "esPrincipal"
    FROM tipo_informe_paso_contacto WHERE paso_id = ANY(${stepIds})
  `) as any[];
  const contactIds = Array.from(new Set(contactRows.map((c: any) => String(c.id))));

  // El principal es el contacto marcado como tal en el paso de menor orden
  // que tenga uno marcado (normalmente el paso 1) -- así siempre hay un
  // único principal aunque varios pasos marquen contactos distintos.
  const orderByStepId = new Map(stepRows.map((s: any) => [s.id, s.orden]));
  const principalRows = contactRows
    .filter((c: any) => c.esPrincipal)
    .sort((a: any, b: any) => (orderByStepId.get(a.stepId) ?? 0) - (orderByStepId.get(b.stepId) ?? 0));
  const primaryContactId = principalRows[0] ? String(principalRows[0].id) : null;

  return { contactIds, primaryContactId };
}

// Crea la alerta del primer paso configurado para el tipo de informe (si existe)
// y deja el informe apuntando a ese paso. Sin pasos configurados, no hace nada.
async function seedFirstWorkflowStep(sql: SqlClient, reportId: number, typeId: number, projectId: number, year: number, monthName: string) {
  const scope = await resolveStepsScope(sql, typeId, projectId);
  const firstStepRows = (
    scope === null
      ? await sql`SELECT paso_id AS id, nombre AS name FROM tipo_informe_pasos WHERE tipo_informe_id = ${typeId} AND proyecto_id IS NULL ORDER BY orden ASC LIMIT 1`
      : await sql`SELECT paso_id AS id, nombre AS name FROM tipo_informe_pasos WHERE tipo_informe_id = ${typeId} AND proyecto_id = ${scope} ORDER BY orden ASC LIMIT 1`
  ) as any[];
  const [firstStep] = firstStepRows;
  if (!firstStep) return;

  await sql`UPDATE informes SET paso_actual_id = ${firstStep.id} WHERE informe_id = ${reportId}`;
  await createStepAlert(sql, reportId, projectId, firstStep.id, firstStep.name, year, monthName);
}

type CreateReportInput = {
  projectId: number;
  typeId: number;
  month: string;
  year: number;
  dueDate?: string;
  status: string;
  contactIds?: (string | number)[];
  primaryContactId?: string | number;
  observations?: string;
  userName?: string;
};

async function createReportRow(sql: SqlClient, input: CreateReportInput): Promise<number> {
  // La fecha límite general se calcula sola a partir del paso final del
  // flujo (ver computeReportDueDate) -- lo que venga del cliente solo se
  // usa de respaldo si ese tipo de informe todavía no tiene un paso final
  // con día límite configurado.
  const computedDueDate = await computeReportDueDate(sql, Number(input.typeId), Number(input.projectId), input.month, input.year);
  const dueDate = computedDueDate ?? input.dueDate;
  if (!dueDate) {
    throw new Error('Configura el día límite del paso final del flujo para este tipo de informe en Listas Maestras antes de crear el informe.');
  }

  // Los responsables ya no se eligen a mano: se toman de los contactos
  // configurados en los pasos del flujo (mismo alcance que usa el motor de
  // etapas) -- lo que venga del cliente solo se usa de respaldo. El
  // principal es el que se marcó como tal en el paso (normalmente el 1).
  let contactIds: (string | number)[];
  let computedPrimaryContactId: string | null = null;
  if (input.contactIds?.length) {
    contactIds = input.contactIds;
  } else {
    const computed = await computeReportResponsables(sql, Number(input.typeId), Number(input.projectId));
    contactIds = computed.contactIds;
    computedPrimaryContactId = computed.primaryContactId;
  }

  const insertedReports = await sql`
    INSERT INTO informes (informe_id, proyecto_id, tipo_informe_id, estado, mes_nombre, anio, fecha, observaciones, created_at, updated_at)
    VALUES (
      COALESCE((SELECT MAX(informe_id) FROM informes), 0) + 1,
      ${input.projectId}, ${input.typeId}, ${input.status}, ${input.month}, ${input.year}, ${dueDate},
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

  const primaryContactId = input.primaryContactId || computedPrimaryContactId || contactIds[0];
  for (const contactId of contactIds) {
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

  await seedFirstWorkflowStep(sql, reportId, input.typeId, input.projectId, input.year, input.month);
  return reportId;
}

const VALID_REPORT_STATUSES = ['Pendientes Evidencias', 'Informe en Elaboración', 'Entregado a Of. Proyectos', 'Enviado'];

type BulkImportRowResult = { row: number; status: 'created' | 'error'; message?: string; consecutive?: string };

// Carga masiva de informes YA ocurridos (histórico anterior a usar el
// sistema): a diferencia de createReportRow, NO calcula la fecha límite
// sola ni siembra el primer paso del flujo (no tiene sentido generar
// alertas en vivo para algo que ya pasó) -- toma la fecha límite real tal
// cual viene en la fila, y solo registra el informe y sus responsables
// (si se dieron) para que quede en el historial y los reportes.
async function bulkImportReports(sql: SqlClient, rows: unknown[]): Promise<{ created: number; errors: number; results: BulkImportRowResult[] }> {
  const results: BulkImportRowResult[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = (rows[i] ?? {}) as Record<string, unknown>;
    const rowNum = i + 2; // fila 1 del Excel es el encabezado
    try {
      const bpin = String(r.bpin ?? r.BPIN ?? '').trim();
      const projectName = String(r.projectName ?? r.Proyecto ?? '').trim();
      const typeCode = String(r.typeCode ?? r['Código Tipo Informe'] ?? r.codigoTipo ?? '').trim().toUpperCase();
      const month = String(r.month ?? r.Mes ?? '').trim();
      const yearRaw = r.year ?? r['Año'] ?? r.Ano;
      const year = Number(yearRaw);
      const dueDate = String(r.dueDate ?? r['Fecha Límite'] ?? r.fechaLimite ?? '').trim();
      const statusRaw = String(r.status ?? r.Estado ?? '').trim();
      const status = VALID_REPORT_STATUSES.includes(statusRaw) ? statusRaw : 'Enviado';
      const observations = String(r.observations ?? r.Observaciones ?? '').trim();
      const responsableEmails = String(r.responsables ?? r.Responsables ?? '')
        .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
      // Consecutivo real ya usado antes de tener el sistema (ej. en los
      // documentos entregados) -- si se da, se respeta tal cual para dar
      // continuidad con la numeración histórica; si no, se calcula solo
      // como con "Nuevo Informe".
      const consecutivoOverride = String(r.consecutivo ?? r.Consecutivo ?? '').trim();
      // Seguimiento histórico adicional: quién revisó y las fechas REALES
      // (no la fecha límite contractual) de entrega y revisión.
      const revisorNombre = String(r.revisor ?? r.Revisor ?? r['Responsable Revisión'] ?? '').trim();
      const fechaEntregaReal = String(r.fechaEntregaReal ?? r['Fecha Entrega'] ?? '').trim();
      const fechaRevision = String(r.fechaRevision ?? r['Fecha Revisión'] ?? '').trim();
      // Periodo Inicio/Fin no tienen columna propia en la base -- se
      // anexan al texto de observaciones para no perder el dato.
      const periodoInicio = String(r.periodoInicio ?? r['Periodo Inicio'] ?? '').trim();
      const periodoFin = String(r.periodoFin ?? r['Periodo Fin'] ?? '').trim();
      const enlaceInforme = String(r.enlaceInforme ?? r['Enlace Informe'] ?? '').trim();
      const enlaceEvidencias = String(r.enlaceEvidencias ?? r['Enlace Evidencias'] ?? '').trim();

      if ((!bpin && !projectName) || !typeCode || !month || !year || !dueDate) {
        throw new Error('Faltan campos obligatorios (BPIN o Proyecto, código de tipo, mes, año o fecha límite).');
      }
      if (!MONTHS_ES.includes(month)) {
        throw new Error(`"${month}" no es un mes válido (ej. Septiembre).`);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
        throw new Error('La fecha límite debe tener formato AAAA-MM-DD.');
      }
      if (fechaEntregaReal && !/^\d{4}-\d{2}-\d{2}$/.test(fechaEntregaReal)) {
        throw new Error('La fecha de entrega debe tener formato AAAA-MM-DD.');
      }
      if (fechaRevision && !/^\d{4}-\d{2}-\d{2}$/.test(fechaRevision)) {
        throw new Error('La fecha de revisión debe tener formato AAAA-MM-DD.');
      }

      const periodoNote = periodoInicio || periodoFin ? `Periodo: ${periodoInicio || '—'} a ${periodoFin || '—'}.` : '';
      const fullObservations = [periodoNote, observations].filter(Boolean).join(' ');

      let project: { id: number } | undefined;
      if (bpin) {
        [project] = (await sql`SELECT proyecto_id AS id FROM proyectos WHERE bpin = ${bpin}`) as any[];
      }
      if (!project && projectName) {
        [project] = (await sql`SELECT proyecto_id AS id FROM proyectos WHERE LOWER(nombre) = LOWER(${projectName})`) as any[];
      }
      if (!project) throw new Error(`No se encontró el proyecto (BPIN "${bpin || '—'}" / nombre "${projectName || '—'}").`);

      const [type] = (await sql`SELECT tipo_informe_id AS id, codigo FROM tipos_informe WHERE UPPER(codigo) = ${typeCode}`) as any[];
      if (!type) throw new Error(`No existe un tipo de informe con código "${typeCode}".`);

      const insertedReports = await sql`
        INSERT INTO informes (
          informe_id, proyecto_id, tipo_informe_id, estado, mes_nombre, anio, fecha, observaciones, flujo_completado,
          revisor_nombre, fecha_entrega_real, fecha_revision, created_at, updated_at
        )
        VALUES (
          COALESCE((SELECT MAX(informe_id) FROM informes), 0) + 1,
          ${project.id}, ${type.id}, ${status}, ${month}, ${year}, ${dueDate},
          ${fullObservations || 'Informe histórico cargado masivamente.'}, ${status === 'Enviado'},
          ${revisorNombre || null}, ${fechaEntregaReal || null}, ${fechaRevision || null},
          NOW(), NOW()
        )
        RETURNING informe_id AS id
      `;
      const reportId = insertedReports[0].id;

      // Enlaces de documentos -- se guardan como adjuntos del informe
      // (misma tabla que usa la pestaña "Evidencias"), solo si son un
      // link real de Drive/Docs; si no, se ignoran en vez de tumbar la fila.
      const isDriveLink = (url: string) => /^https:\/\/(drive|docs)\.google\.com\//.test(url);
      if (enlaceInforme && isDriveLink(enlaceInforme)) {
        await sql`
          INSERT INTO informe_adjuntos (adjunto_id, informe_id, nombre, drive_url, subido_por, subido_en)
          VALUES (COALESCE((SELECT MAX(adjunto_id) FROM informe_adjuntos), 0) + 1, ${reportId}, 'Informe', ${enlaceInforme}, 'Carga masiva', NOW())
        `;
      }
      if (enlaceEvidencias && isDriveLink(enlaceEvidencias)) {
        await sql`
          INSERT INTO informe_adjuntos (adjunto_id, informe_id, nombre, drive_url, subido_por, subido_en)
          VALUES (COALESCE((SELECT MAX(adjunto_id) FROM informe_adjuntos), 0) + 1, ${reportId}, 'Evidencias', ${enlaceEvidencias}, 'Carga masiva', NOW())
        `;
      }

      const typeCodeForConsecutive = type.codigo || 'INF';
      const [{ count }] = (await sql`SELECT COUNT(*) AS count FROM informes WHERE tipo_informe_id = ${type.id} AND anio = ${year}`) as any[];
      const consecutive = consecutivoOverride || `${typeCodeForConsecutive}-${year}-${String(count).padStart(3, '0')}`;
      const [{ seqCount }] = (await sql`SELECT COUNT(*) AS "seqCount" FROM informes WHERE tipo_informe_id = ${type.id} AND proyecto_id = ${project.id}`) as any[];
      try {
        await sql`UPDATE informes SET consecutivo = ${consecutive}, numero_secuencia = ${Number(seqCount)} WHERE informe_id = ${reportId}`;
      } catch (updateError) {
        if ((updateError as { code?: string })?.code === '23505') {
          throw new Error(`El consecutivo "${consecutive}" ya está usado por otro informe.`);
        }
        throw updateError;
      }

      if (responsableEmails.length > 0) {
        const contactRows = (await sql`SELECT contacto_id AS id FROM contactos WHERE LOWER(email) = ANY(${responsableEmails})`) as any[];
        for (let c = 0; c < contactRows.length; c++) {
          await sql`INSERT INTO informe_contacto (informe_id, contacto_id, es_principal) VALUES (${reportId}, ${contactRows[c].id}, ${c === 0})`;
        }
      }

      await sql`
        INSERT INTO seguimiento_informe (seguimiento_id, informe_id, estado, fecha_evento, usuario_nombre, comentario)
        VALUES (
          COALESCE((SELECT MAX(seguimiento_id) FROM seguimiento_informe), 0) + 1,
          ${reportId}, ${status}, NOW(), 'Carga masiva', 'Informe histórico importado masivamente.'
        )
      `;

      results.push({ row: rowNum, status: 'created', consecutive });
    } catch (error) {
      results.push({ row: rowNum, status: 'error', message: error instanceof Error ? error.message : 'Error desconocido.' });
    }
  }

  return {
    created: results.filter((r) => r.status === 'created').length,
    errors: results.filter((r) => r.status === 'error').length,
    results,
  };
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
  const nextDueDate = (await computeReportDueDate(sql, report.typeId, report.projectId, nextMonth, nextYear)) ?? addOneMonth(report.dueDate);
  if (report.projectEndDate && nextDueDate > report.projectEndDate) return;

  // Los responsables ya no se copian del informe anterior -- se toman
  // frescos de los pasos del flujo configurados HOY (createReportRow los
  // calcula solos), para que un cambio de responsables en Listas Maestras
  // se refleje en el siguiente informe generado automáticamente.
  await createReportRow(sql, {
    projectId: report.projectId,
    typeId: report.typeId,
    month: nextMonth,
    year: nextYear,
    status: 'Pendientes Evidencias',
    observations: `Continuación automática de ${report.month} ${report.year}.`,
    userName: 'Sistema (generación automática)',
  });
}

// Núcleo compartido entre el avance manual (PATCH advance_step) y la
// detección automática por correo (Fase D / barrido cron).
class NoWorkflowStepError extends Error {}

async function advanceReportStep(
  sql: SqlClient,
  reportId: number,
  delivery?: { receivedAt: Date; messageId?: string | null; fromEmail?: string | null },
): Promise<void> {
  const [current] = (await sql`
    SELECT i.proyecto_id AS "projectId", i.tipo_informe_id AS "typeId", i.paso_actual_id AS "currentStepId",
           i.mes_nombre AS "monthName", i.anio AS "year",
           p.orden AS "currentOrder", p.es_final AS "isFinal", p.proyecto_id AS "stepScope"
    FROM informes i
    LEFT JOIN tipo_informe_pasos p ON p.paso_id = i.paso_actual_id
    WHERE i.informe_id = ${reportId}
  `) as any[];

  if (!current?.currentStepId) {
    throw new NoWorkflowStepError('Este informe no tiene un flujo de pasos configurado.');
  }

  const resolvedDelivery = delivery ?? { receivedAt: new Date() };

  await sql`UPDATE alertas SET activa = FALSE, updated_at = NOW() WHERE informe_id = ${reportId} AND paso_id = ${current.currentStepId}`;
  await finalizeStepInstance(sql, reportId, current.currentStepId, resolvedDelivery);

  if (current.isFinal) {
    await sql`UPDATE informes SET flujo_completado = TRUE, estado = 'Enviado', updated_at = NOW() WHERE informe_id = ${reportId}`;
    await maybeScheduleNextMonth(sql, reportId);
    return;
  }

  // El siguiente paso se busca dentro del MISMO alcance (plantilla general o
  // flujo propio del proyecto) en el que ya está el paso actual -- no se
  // vuelve a resolver, para no mezclar pasos de la plantilla con pasos
  // propios del proyecto a mitad de flujo.
  const nextStepRows = (
    current.stepScope === null
      ? await sql`SELECT paso_id AS id, nombre AS name FROM tipo_informe_pasos WHERE tipo_informe_id = ${current.typeId} AND proyecto_id IS NULL AND orden > ${current.currentOrder} ORDER BY orden ASC LIMIT 1`
      : await sql`SELECT paso_id AS id, nombre AS name FROM tipo_informe_pasos WHERE tipo_informe_id = ${current.typeId} AND proyecto_id = ${current.stepScope} AND orden > ${current.currentOrder} ORDER BY orden ASC LIMIT 1`
  ) as any[];
  const [nextStep] = nextStepRows;

  if (nextStep) {
    await sql`UPDATE informes SET paso_actual_id = ${nextStep.id}, updated_at = NOW() WHERE informe_id = ${reportId}`;
    const dynamicStartDate = resolvedDelivery.receivedAt.toISOString().slice(0, 10);
    await createStepAlert(sql, reportId, current.projectId, nextStep.id, nextStep.name, current.year, current.monthName, dynamicStartDate);
  } else {
    await sql`UPDATE informes SET flujo_completado = TRUE, estado = 'Enviado', updated_at = NOW() WHERE informe_id = ${reportId}`;
    await maybeScheduleNextMonth(sql, reportId);
  }
}

// Fase D: revisa cada informe con un paso pendiente y busca en la cuenta de
// Google conectada un correo entrante con el asunto esperado de ese paso,
// de alguno de sus contactos responsables. Si aparece, avanza el flujo.
const RECEIVED_STATES = ['RECIBIDA_A_TIEMPO', 'RECIBIDA_TARDE'];
// EN_REVISION cuenta como "abierta" (no completada, no necesariamente
// vencida): un correo ambiguo detectado por Fase 4 debe seguir viéndose en
// pendientes/general hasta que alguien lo resuelva a mano, no desaparecer
// de los indicadores.
const OPEN_STATES = ['PENDIENTE', 'ALERTA_GENERADA', 'EN_REVISION'];

// Fase 3: agrega informe_pasos_instancia + alertas en los indicadores del
// dashboard (sección 9 del requerimiento) — generales, por responsable, por
// etapa y temporales. No inventa datos nuevos, solo cuenta lo que Fase 1/2
// ya calculan y guardan.
async function fetchStagesDashboard(sql: SqlClient) {
  const [general] = (await sql`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE i.flujo_completado = TRUE) AS completados,
      COUNT(*) FILTER (WHERE i.flujo_completado = FALSE) AS pendientes,
      COUNT(*) FILTER (WHERE i.flujo_completado = FALSE AND COALESCE(ipi.fecha_limite, i.fecha) < CURRENT_DATE) AS vencidos
    FROM informes i
    LEFT JOIN informe_pasos_instancia ipi ON ipi.informe_id = i.informe_id AND ipi.paso_id = i.paso_actual_id
  `) as any[];

  const [entregas] = (await sql`
    SELECT
      COUNT(*) FILTER (WHERE estado_etapa = ANY(${RECEIVED_STATES})) AS "entregasRecibidas",
      COUNT(*) FILTER (WHERE estado_etapa = ANY(${OPEN_STATES})) AS "entregasPendientes",
      COUNT(*) FILTER (WHERE estado_etapa = 'RECIBIDA_TARDE') AS "entregasTardias",
      COUNT(*) FILTER (WHERE estado_etapa IN ('NO_RECIBIDA', 'EN_REVISION')) AS "procesosEnRiesgo"
    FROM informe_pasos_instancia
  `) as any[];

  const [{ alertasActivas }] = (await sql`SELECT COUNT(*) AS "alertasActivas" FROM alertas WHERE activa = TRUE`) as any[];

  const porResponsable = (await sql`
    SELECT c.contacto_id AS id, c.nombre AS name,
      COUNT(*) AS "totalAsignaciones",
      COUNT(*) FILTER (WHERE ipi.estado_etapa = ANY(${RECEIVED_STATES})) AS completadas,
      COUNT(*) FILTER (WHERE ipi.estado_etapa = ANY(${OPEN_STATES})) AS pendientes,
      COUNT(*) FILTER (WHERE ipi.estado_etapa = 'NO_RECIBIDA') AS vencidas
    FROM informe_pasos_instancia ipi
    JOIN tipo_informe_paso_contacto tpc ON tpc.paso_id = ipi.paso_id
    JOIN contactos c ON c.contacto_id = tpc.contacto_id
    GROUP BY c.contacto_id, c.nombre
    ORDER BY c.nombre ASC
  `) as any[];

  const porEtapa = (await sql`
    SELECT ti.nombre AS "typeName", wp.orden AS "order", wp.nombre AS "stepName",
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE ipi.estado_etapa = ANY(${RECEIVED_STATES})) AS completadas,
      COUNT(*) FILTER (WHERE ipi.estado_etapa = ANY(${OPEN_STATES})) AS pendientes,
      COUNT(*) FILTER (WHERE ipi.estado_etapa = 'NO_RECIBIDA') AS vencidas
    FROM informe_pasos_instancia ipi
    JOIN tipo_informe_pasos wp ON wp.paso_id = ipi.paso_id
    JOIN tipos_informe ti ON ti.tipo_informe_id = wp.tipo_informe_id
    GROUP BY ti.nombre, wp.orden, wp.nombre
    ORDER BY ti.nombre ASC, wp.orden ASC
  `) as any[];

  const [temporal] = (await sql`
    SELECT
      COUNT(*) FILTER (WHERE fecha_limite = CURRENT_DATE AND estado_etapa = ANY(${OPEN_STATES})) AS "entregasHoy",
      COUNT(*) FILTER (WHERE fecha_limite > CURRENT_DATE AND fecha_limite <= CURRENT_DATE + 7 AND estado_etapa = ANY(${OPEN_STATES})) AS "entregasProximas",
      COUNT(*) FILTER (WHERE estado_etapa = 'NO_RECIBIDA' OR (fecha_limite < CURRENT_DATE AND estado_etapa = ANY(${OPEN_STATES}))) AS "entregasVencidas",
      COUNT(*) FILTER (WHERE fecha_limite - CURRENT_DATE BETWEEN 3 AND 5 AND estado_etapa = ANY(${OPEN_STATES})) AS "alertasProximas",
      COUNT(*) FILTER (WHERE fecha_limite - CURRENT_DATE <= 2 AND estado_etapa IN ('PENDIENTE', 'ALERTA_GENERADA', 'NO_RECIBIDA')) AS "alertasCriticas"
    FROM informe_pasos_instancia
  `) as any[];

  const toNum = (v: unknown) => Number(v) || 0;
  return {
    general: {
      totalInformes: toNum(general.total),
      completados: toNum(general.completados),
      pendientes: toNum(general.pendientes),
      vencidos: toNum(general.vencidos),
      entregasRecibidas: toNum(entregas.entregasRecibidas),
      entregasPendientes: toNum(entregas.entregasPendientes),
      entregasTardias: toNum(entregas.entregasTardias),
      alertasActivas: toNum(alertasActivas),
      procesosEnRiesgo: toNum(entregas.procesosEnRiesgo),
    },
    porResponsable: porResponsable.map((r: any) => {
      const total = toNum(r.totalAsignaciones);
      const completadas = toNum(r.completadas);
      return {
        id: String(r.id),
        name: r.name,
        totalAsignaciones: total,
        completadas,
        pendientes: toNum(r.pendientes),
        vencidas: toNum(r.vencidas),
        cumplimiento: total > 0 ? Math.round((completadas / total) * 100) : 0,
      };
    }),
    porEtapa: porEtapa.map((e: any) => ({
      typeName: e.typeName,
      order: toNum(e.order),
      stepName: e.stepName,
      total: toNum(e.total),
      completadas: toNum(e.completadas),
      pendientes: toNum(e.pendientes),
      vencidas: toNum(e.vencidas),
    })),
    temporal: {
      entregasHoy: toNum(temporal.entregasHoy),
      entregasProximas: toNum(temporal.entregasProximas),
      entregasVencidas: toNum(temporal.entregasVencidas),
      alertasProximas: toNum(temporal.alertasProximas),
      alertasCriticas: toNum(temporal.alertasCriticas),
    },
  };
}

async function runDeliveryDetectionSweep(sql: SqlClient): Promise<{ checked: number; advanced: number; flaggedForReview: number; skipped?: string }> {
  const session = await sql`
    SELECT session_id, token_json FROM google_drive_sessions WHERE expires_at > NOW() ORDER BY created_at DESC LIMIT 1
  `;
  if (!session[0]) {
    return { checked: 0, advanced: 0, flaggedForReview: 0, skipped: 'no-connected-google-account' };
  }

  let accessToken: string;
  try {
    accessToken = await getDriveAccessToken(session[0].token_json);
  } catch (error) {
    console.error('Delivery sweep: no fue posible obtener el token de acceso', error);
    return { checked: 0, advanced: 0, flaggedForReview: 0, skipped: 'token-error' };
  }

  // Los pasos ya marcados EN_REVISION (correo ambiguo detectado en una
  // corrida anterior) se excluyen: sin esto, cada corrida del barrido
  // volvería a encontrar el mismo correo ambiguo y duplicaría la nota en
  // el historial (Regla 6/7). Quedan así hasta que alguien los resuelva a
  // mano (confirmar entrega avanza el paso y limpia el estado).
  const pendingSteps = (await sql`
    SELECT i.informe_id AS "reportId", wp.paso_id AS "stepId", wp.asunto_correo AS "emailSubjectBase",
           wp.palabras_clave AS "keywordsRaw",
           i.numero_secuencia AS "sequenceNumber", i.updated_at AS "stepStartedAt"
    FROM informes i
    JOIN tipo_informe_pasos wp ON wp.paso_id = i.paso_actual_id
    LEFT JOIN informe_pasos_instancia ipi ON ipi.informe_id = i.informe_id AND ipi.paso_id = i.paso_actual_id
    WHERE i.flujo_completado = FALSE AND i.paso_actual_id IS NOT NULL
      AND (ipi.estado_etapa IS NULL OR ipi.estado_etapa <> 'EN_REVISION')
  `) as any[];

  let advanced = 0;
  let flaggedForReview = 0;
  for (const step of pendingSteps) {
    const expectedSubject = composeStepEmailSubject(step.emailSubjectBase, step.sequenceNumber);
    const keywords: string[] = step.keywordsRaw ? String(step.keywordsRaw).split(',').map((k: string) => k.trim()).filter(Boolean) : [];
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
        keywords,
      );
      if (!match.found) continue;

      // Regla 9: si hay varios correos coincidentes no se puede saber cuál
      // es el correcto -- se marca la etapa para revisión manual y NO se
      // avanza el flujo solo, para evitar un falso positivo.
      if (match.ambiguous) {
        await sql`
          UPDATE informe_pasos_instancia SET estado_etapa = 'EN_REVISION', updated_at = NOW()
          WHERE informe_id = ${step.reportId} AND paso_id = ${step.stepId}
        `;
        await sql`
          INSERT INTO seguimiento_informe (seguimiento_id, informe_id, estado, fecha_evento, usuario_nombre, comentario)
          VALUES (
            COALESCE((SELECT MAX(seguimiento_id) FROM seguimiento_informe), 0) + 1,
            ${step.reportId}, 'En revisión', NOW(), 'Sistema (detección automática)',
            ${`Se encontraron ${match.matchCount} correos coincidentes con el asunto "${expectedSubject}" -- requiere revisión manual antes de avanzar.`}
          )
        `;
        flaggedForReview++;
        continue;
      }

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
      await advanceReportStep(sql, step.reportId, {
        receivedAt: match.receivedAt ? new Date(match.receivedAt) : new Date(),
        messageId: match.messageId,
        fromEmail: match.fromEmail,
      });
      advanced++;
    } catch (error) {
      console.error('Delivery sweep failed for report', step.reportId, error);
    }
  }

  return { checked: pendingSteps.length, advanced, flaggedForReview };
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'GET' && request.method !== 'POST' && request.method !== 'PATCH' && request.method !== 'DELETE') {
    return response.status(405).json({ data: null, meta: {}, errors: ['Método no permitido.'] });
  }

  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl?.trim()) {
      return response.status(503).json({ data: null, meta: {}, errors: ['DATABASE_URL no está configurada en Vercel.'] });
    }
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(databaseUrl);

    if (request.method === 'DELETE') {
      if (!(await isAdminRequest(request, sql))) {
        return response.status(403).json({ data: null, meta: {}, errors: ['Solo un administrador puede eliminar informes.'] });
      }
      const reportId = Number(request.query.reportId);
      if (!Number.isInteger(reportId) || reportId <= 0) {
        return response.status(400).json({ data: null, meta: {}, errors: ['El id del informe es obligatorio.'] });
      }
      // Sin ON DELETE CASCADE en informe_contacto/seguimiento_informe ni en
      // alerta_contacto/alerta_dia (que referencian a las alertas del paso
      // actual, que sí cascadean desde informes) — hay que limpiar a mano en
      // el orden correcto o la FK bloquea el borrado.
      const linkedAlerts = (await sql`SELECT alerta_id AS id FROM alertas WHERE informe_id = ${reportId}`) as any[];
      const alertIds = linkedAlerts.map((a: any) => a.id);
      if (alertIds.length > 0) {
        await sql`DELETE FROM alerta_contacto WHERE alerta_id = ANY(${alertIds})`;
        await sql`DELETE FROM alerta_dia WHERE alerta_id = ANY(${alertIds})`;
        await sql`DELETE FROM alertas WHERE alerta_id = ANY(${alertIds})`;
      }
      await sql`DELETE FROM informe_contacto WHERE informe_id = ${reportId}`;
      await sql`DELETE FROM seguimiento_informe WHERE informe_id = ${reportId}`;
      const deleted = await sql`DELETE FROM informes WHERE informe_id = ${reportId} RETURNING informe_id AS id`;
      if (!deleted[0]) return response.status(404).json({ data: null, meta: {}, errors: ['Informe no encontrado.'] });
      return response.status(200).json({ data: deleted[0], meta: {}, errors: [] });
    }

    const cronSecret = process.env.CRON_SECRET;
    const isCronRequest = request.method === 'GET' && !!cronSecret && request.headers.authorization === `Bearer ${cronSecret}`;
    if (isCronRequest) {
      const force = request.query.force === 'true' || request.query.force === '1';
      const gate = await getSweepGate(sql, 'deteccion_entregas', force);
      if (!gate.run) {
        return response.status(200).json({ data: { skipped: true, reason: gate.reason }, meta: {}, errors: [] });
      }
      try {
        const result = await runDeliveryDetectionSweep(sql);
        await recordSweepRun(sql, 'deteccion_entregas', true, result);
        return response.status(200).json({ data: result, meta: {}, errors: [] });
      } catch (error) {
        await recordSweepRun(sql, 'deteccion_entregas', false, { error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    }

    // Fase 3 del motor de etapas: indicadores consolidados (generales, por
    // responsable, por etapa y temporales) para el dashboard, calculados
    // sobre informe_pasos_instancia -- no reinterpreta nada, solo agrega
    // lo que ya escriben Fase 1/2.
    if (request.method === 'GET' && request.query.view === 'stagesDashboard') {
      const data = await fetchStagesDashboard(sql);
      return response.status(200).json({ data, meta: {}, errors: [] });
    }

    if (request.method === 'GET') {
      const idRows = await sql`SELECT informe_id AS id FROM informes`;
      const reports = await fetchReportsByIds(sql, idRows.map((r: any) => r.id));
      reports.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return response.status(200).json({ data: reports, meta: { total: reports.length }, errors: [] });
    }

    if (request.method === 'POST' && request.body?.action === 'bulkImportReports') {
      if (!(await canEditModuleRequest(request, sql, 'reports'))) {
        return response.status(403).json({ data: null, meta: {}, errors: ['No tienes permiso de edición en Informes.'] });
      }
      const rows = Array.isArray(request.body?.rows) ? request.body.rows : [];
      if (rows.length === 0) {
        return response.status(400).json({ data: null, meta: {}, errors: ['No se recibieron filas para importar.'] });
      }
      if (rows.length > 500) {
        return response.status(400).json({ data: null, meta: {}, errors: ['Máximo 500 filas por carga -- divide el archivo en lotes más pequeños.'] });
      }
      const result = await bulkImportReports(sql, rows);
      return response.status(200).json({ data: result, meta: {}, errors: [] });
    }

    if (request.method === 'POST') {
      const { projectId, typeId, month, year, status, observations, userName } = request.body ?? {};

      if (!projectId || !typeId || !month || !year || !status) {
        return response.status(400).json({ data: null, meta: {}, errors: ['Faltan campos obligatorios para crear el informe.'] });
      }

      let reportId: number;
      try {
        reportId = await createReportRow(sql, { projectId, typeId, month, year, status, observations, userName });
      } catch (error) {
        return response.status(400).json({ data: null, meta: {}, errors: [error instanceof Error ? error.message : 'No fue posible crear el informe.'] });
      }

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
    } else if (action === 'edit') {
      // Campos editables después de creado: mes, fecha límite, responsables y
      // observaciones. Año, tipo y proyecto se dejan fijos a propósito — de
      // ellos depende el consecutivo y el número de secuencia ya asignados;
      // si están mal, es más seguro borrar el informe y crear uno nuevo.
      const { month, dueDate, contactIds, primaryContactId, observations, userName } = request.body ?? {};
      const has = (key: string) => Object.prototype.hasOwnProperty.call(request.body ?? {}, key);

      if (has('month') && !month) {
        return response.status(400).json({ data: null, meta: {}, errors: ['El mes no puede quedar vacío.'] });
      }
      if (has('dueDate') && !dueDate) {
        return response.status(400).json({ data: null, meta: {}, errors: ['La fecha límite no puede quedar vacía.'] });
      }
      if (has('contactIds') && (!Array.isArray(contactIds) || contactIds.length === 0)) {
        return response.status(400).json({ data: null, meta: {}, errors: ['Debe haber al menos un responsable.'] });
      }

      const current = (await sql`
        SELECT mes_nombre, fecha, observaciones, anio, tipo_informe_id AS "typeId", proyecto_id AS "projectId"
        FROM informes WHERE informe_id = ${reportId}
      `) as any[];
      if (!current[0]) return response.status(404).json({ data: null, meta: {}, errors: ['Informe no encontrado.'] });

      const nextMonth = has('month') ? month : current[0].mes_nombre;
      // Si cambia el mes y no se manda una fecha límite explícita, se
      // recalcula sola a partir del paso final del flujo (ver
      // computeReportDueDate) -- una fecha explícita del cliente sigue
      // ganando, para no quitarle al admin la posibilidad de corregirla a
      // mano en casos puntuales.
      const recomputedDueDate = has('month') && !has('dueDate')
        ? await computeReportDueDate(sql, current[0].typeId, current[0].projectId, nextMonth, current[0].anio)
        : null;
      const nextDueDate = has('dueDate') ? dueDate : (recomputedDueDate ?? current[0].fecha);
      const nextObservations = has('observations') ? observations : current[0].observaciones;

      await sql`
        UPDATE informes SET mes_nombre = ${nextMonth}, fecha = ${nextDueDate}, observaciones = ${nextObservations}, updated_at = NOW()
        WHERE informe_id = ${reportId}
      `;

      if (has('contactIds')) {
        const nextPrimary = primaryContactId || contactIds[0];
        await sql`DELETE FROM informe_contacto WHERE informe_id = ${reportId}`;
        for (const contactId of contactIds) {
          await sql`
            INSERT INTO informe_contacto (informe_id, contacto_id, es_principal)
            VALUES (${reportId}, ${contactId}, ${contactId === nextPrimary})
          `;
        }
      }

      await sql`
        INSERT INTO seguimiento_informe (seguimiento_id, informe_id, estado, fecha_evento, usuario_nombre, comentario)
        VALUES (
          COALESCE((SELECT MAX(seguimiento_id) FROM seguimiento_informe), 0) + 1,
          ${reportId}, (SELECT estado FROM informes WHERE informe_id = ${reportId}), NOW(), ${userName || 'Usuario'}, 'Informe editado.'
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
    } else if (action === 'edit_stage') {
      // Las fechas de una etapa normalmente se calculan solas (día
      // configurado en Listas Maestras, o la fecha real de la entrega
      // anterior) -- esto permite a un administrador corregirlas a mano
      // cuando quedaron mal (ej. se generaron antes de ajustar el día
      // límite del paso, o la instancia quedó desfasada).
      if (!(await isAdminRequest(request, sql))) {
        return response.status(403).json({ data: null, meta: {}, errors: ['Solo un administrador puede editar las fechas de una etapa.'] });
      }
      const { stepId, startDate, dueDate } = request.body ?? {};
      const stepIdNum = Number(stepId);
      if (!Number.isInteger(stepIdNum) || stepIdNum <= 0) {
        return response.status(400).json({ data: null, meta: {}, errors: ['Falta el id del paso.'] });
      }
      const hasField = (key: string) => Object.prototype.hasOwnProperty.call(request.body ?? {}, key);
      const currentStage = (await sql`
        SELECT fecha_inicio, fecha_limite FROM informe_pasos_instancia WHERE informe_id = ${reportId} AND paso_id = ${stepIdNum}
      `) as any[];
      if (!currentStage[0]) {
        return response.status(404).json({ data: null, meta: {}, errors: ['Esta etapa todavía no tiene una instancia generada para este informe.'] });
      }
      const nextStart = hasField('startDate') ? (startDate || null) : currentStage[0].fecha_inicio;
      const nextDue = hasField('dueDate') ? (dueDate || null) : currentStage[0].fecha_limite;
      await sql`
        UPDATE informe_pasos_instancia SET fecha_inicio = ${nextStart}, fecha_limite = ${nextDue}, updated_at = NOW()
        WHERE informe_id = ${reportId} AND paso_id = ${stepIdNum}
      `;
    } else if (action === 'setCurrentStep') {
      // Reemplaza el viejo "cambiar estado manualmente" (que movía un estado
      // administrativo genérico de 4 valores, desconectado del flujo real):
      // esto mueve el informe a cualquier paso configurado de su propio
      // flujo -- para corregir un salto mal hecho o retroceder un paso.
      if (!(await isAdminRequest(request, sql))) {
        return response.status(403).json({ data: null, meta: {}, errors: ['Solo un administrador puede cambiar el paso actual manualmente.'] });
      }
      const { stepId, comment, userName } = request.body ?? {};
      const stepIdNum = Number(stepId);
      if (!Number.isInteger(stepIdNum) || stepIdNum <= 0) {
        return response.status(400).json({ data: null, meta: {}, errors: ['Falta el paso.'] });
      }

      const [report] = (await sql`
        SELECT proyecto_id AS "projectId", tipo_informe_id AS "typeId", mes_nombre AS "monthName", anio AS "year"
        FROM informes WHERE informe_id = ${reportId}
      `) as any[];
      if (!report) return response.status(404).json({ data: null, meta: {}, errors: ['Informe no encontrado.'] });

      const [step] = (await sql`
        SELECT paso_id AS id, nombre AS name, proyecto_id AS "projectId"
        FROM tipo_informe_pasos WHERE paso_id = ${stepIdNum} AND tipo_informe_id = ${report.typeId}
      `) as any[];
      if (!step) {
        return response.status(400).json({ data: null, meta: {}, errors: ['Ese paso no pertenece al tipo de informe de este registro.'] });
      }
      if (step.projectId !== null && Number(step.projectId) !== Number(report.projectId)) {
        return response.status(400).json({ data: null, meta: {}, errors: ['Ese paso pertenece al flujo propio de otro proyecto.'] });
      }

      await sql`UPDATE alertas SET activa = FALSE, updated_at = NOW() WHERE informe_id = ${reportId}`;
      await sql`UPDATE informes SET paso_actual_id = ${stepIdNum}, flujo_completado = FALSE, updated_at = NOW() WHERE informe_id = ${reportId}`;
      await createStepAlert(sql, reportId, report.projectId, stepIdNum, step.name, report.year, report.monthName);

      await sql`
        INSERT INTO seguimiento_informe (seguimiento_id, informe_id, estado, fecha_evento, usuario_nombre, comentario)
        VALUES (
          COALESCE((SELECT MAX(seguimiento_id) FROM seguimiento_informe), 0) + 1,
          ${reportId}, (SELECT estado FROM informes WHERE informe_id = ${reportId}), NOW(), ${userName || 'Usuario'},
          ${`Cambio manual de paso a: "${step.name}".${comment ? ` ${comment}` : ''}`}
        )
      `;
    } else if (action === 'setPrimaryContact') {
      const { contactId } = request.body ?? {};
      const contactIdNum = Number(contactId);
      if (!Number.isInteger(contactIdNum) || contactIdNum <= 0) {
        return response.status(400).json({ data: null, meta: {}, errors: ['Falta el id del contacto.'] });
      }
      const assigned = (await sql`
        SELECT contacto_id FROM informe_contacto WHERE informe_id = ${reportId} AND contacto_id = ${contactIdNum}
      `) as any[];
      if (!assigned[0]) {
        return response.status(400).json({ data: null, meta: {}, errors: ['Ese contacto no está entre los responsables de este informe.'] });
      }
      await sql`UPDATE informe_contacto SET es_principal = (contacto_id = ${contactIdNum}) WHERE informe_id = ${reportId}`;
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
