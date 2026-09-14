import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  if (request.method !== 'GET') {
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