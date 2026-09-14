import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return response.status(405).json({ data: null, meta: {}, errors: ['Método no permitido.'] });
  }

  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl?.trim()) {
      return response.status(503).json({ data: null, meta: {}, errors: ['DATABASE_URL no está configurada.'] });
    }

    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(databaseUrl);

    if (request.method === 'GET') {
      const [reportTypes, contacts] = await Promise.all([
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
      ]);

      return response.status(200).json({ data: { reportTypes, contacts }, meta: {}, errors: [] });
    }

    const { kind, data } = request.body ?? {};
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

    return response.status(400).json({ data: null, meta: {}, errors: ['Catálogo no soportado.'] });
  } catch (error) {
    console.error('Catalog query failed', error);
    return response.status(503).json({ data: null, meta: {}, errors: ['No fue posible guardar o consultar los catálogos.'] });
  }
}