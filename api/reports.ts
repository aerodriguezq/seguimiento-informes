import type { VercelRequest, VercelResponse } from '@vercel/node';

type SqlClient = ReturnType<typeof import('@neondatabase/serverless').neon>;

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
      i.created_at AS "createdAt"
    FROM informes i
    JOIN proyectos p ON p.proyecto_id = i.proyecto_id
    JOIN tipos_informe ti ON ti.tipo_informe_id = i.tipo_informe_id
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
    SELECT adjunto_id AS id, informe_id AS "reportId", nombre AS name, tamano AS size, subido_por AS "uploadedBy", subido_en AS "uploadedAt"
    FROM informe_adjuntos
    WHERE informe_id = ANY(${ids})
    ORDER BY subido_en ASC
  `) as any[];

  return reportRows.map((report: any) => {
    const contacts = contactRows.filter((c: any) => c.reportId === report.id);
    const primary = contacts.find((c: any) => c.isPrimary);
    return {
      ...report,
      contactIds: contacts.map((c: any) => String(c.contactId)),
      primaryContactId: primary ? String(primary.contactId) : (contacts[0] ? String(contacts[0].contactId) : ''),
      history: historyRows.filter((h: any) => h.reportId === report.id),
      attachments: attachmentRows.filter((a: any) => a.reportId === report.id),
      alertRulesCount: 0,
    };
  });
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

      const insertedReports = await sql`
        INSERT INTO informes (informe_id, proyecto_id, tipo_informe_id, estado, mes_nombre, anio, fecha, observaciones, created_at, updated_at)
        VALUES (
          COALESCE((SELECT MAX(informe_id) FROM informes), 0) + 1,
          ${projectId}, ${typeId}, ${status}, ${month}, ${year}, ${dueDate},
          ${observations || 'Apertura de informe para seguimiento del cronograma contractual.'},
          NOW(), NOW()
        )
        RETURNING informe_id AS id
      `;
      const reportId = insertedReports[0].id;

      await sql`
        UPDATE informes SET consecutivo = ${`INF-${year}-${String(reportId).padStart(3, '0')}`}
        WHERE informe_id = ${reportId}
      `;

      for (const contactId of contactIds) {
        await sql`
          INSERT INTO informe_contacto (informe_id, contacto_id, es_principal)
          VALUES (${reportId}, ${contactId}, ${contactId === (primaryContactId || contactIds[0])})
        `;
      }

      await sql`
        INSERT INTO seguimiento_informe (seguimiento_id, informe_id, estado, fecha_evento, usuario_nombre, comentario)
        VALUES (
          COALESCE((SELECT MAX(seguimiento_id) FROM seguimiento_informe), 0) + 1,
          ${reportId}, ${status}, NOW(), ${userName || 'Usuario'},
          ${observations || 'Creación inicial del informe.'}
        )
      `;

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
    } else if (action === 'attachment') {
      const { attachment, userName } = request.body ?? {};
      if (!attachment?.name) return response.status(400).json({ data: null, meta: {}, errors: ['Falta el archivo a adjuntar.'] });

      await sql`
        INSERT INTO informe_adjuntos (adjunto_id, informe_id, nombre, tamano, subido_por, subido_en)
        VALUES (
          COALESCE((SELECT MAX(adjunto_id) FROM informe_adjuntos), 0) + 1,
          ${reportId}, ${attachment.name}, ${attachment.size || ''}, ${userName || attachment.uploadedBy || 'Usuario'}, NOW()
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
