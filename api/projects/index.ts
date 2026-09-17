import type { VercelRequest, VercelResponse } from '@vercel/node';

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

      const updatedProjects = await sql`
        UPDATE proyectos
        SET fecha_inicio = ${startDate || null}, fecha_fin = ${endDate || null}
        WHERE proyecto_id = ${projectId}
        RETURNING proyecto_id AS id, fecha_inicio AS "startDate", fecha_fin AS "endDate"
      `;

      if (!updatedProjects[0]) {
        return response.status(404).json({ data: null, meta: {}, errors: ['Proyecto no encontrado.'] });
      }

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
        RETURNING proyecto_id AS id, nombre AS name, bpin, activo AS active, empresa_id AS company_id, fecha_inicio AS "startDate", fecha_fin AS "endDate"
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
        p.fecha_inicio AS "startDate",
        p.fecha_fin AS "endDate",
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