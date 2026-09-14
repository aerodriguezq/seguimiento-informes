import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  if (request.method !== 'GET' && request.method !== 'POST') {
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

    if (request.method === 'POST') {
      const { name, bpin, company } = request.body ?? {};

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
        INSERT INTO proyectos (proyecto_id, empresa_id, nombre, bpin)
        VALUES (
          COALESCE((SELECT MAX(proyecto_id) FROM proyectos), 0) + 1,
          ${companyId},
          ${name.trim()},
          ${bpin.trim()}
        )
        RETURNING proyecto_id AS id, nombre AS name, bpin, activo AS active, empresa_id AS company_id
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

    return response.status(503).json({
      data: null,
      meta: {},
      errors: ['No fue posible consultar los proyectos.'],
    });
  }
}