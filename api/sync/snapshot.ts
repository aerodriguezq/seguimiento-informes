import type { VercelRequest, VercelResponse } from '@vercel/node';

const syncTables = [
  'empresas',
  'proyectos',
  'tipos_informe',
  'proyecto_tipo_informe',
  'roles',
  'contactos',
  'estados',
  'meses',
  'informes',
  'informe_contacto',
  'alertas',
  'alerta_dia',
  'alerta_contacto',
  'alertas_config',
  'reglas_entrega',
  'seguimiento_informe',
  'correcciones',
  'resumen_correcciones',
] as const;

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  if (request.method !== 'GET') {
    return response.status(405).json({ data: null, meta: {}, errors: ['Método no permitido.'] });
  }

  const expectedToken = process.env.APP_SCRIPT_SHARED_SECRET;
  const receivedToken = request.headers.authorization?.replace(/^Bearer\s+/i, '')
    || request.query.token;

  if (!expectedToken || receivedToken !== expectedToken) {
    return response.status(401).json({ data: null, meta: {}, errors: ['No autorizado.'] });
  }

  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl?.trim()) {
      return response.status(503).json({ data: null, meta: {}, errors: ['DATABASE_URL no está configurada.'] });
    }

    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(databaseUrl);
    const tables = await Promise.all(
      syncTables.map(async (table) => {
        const rows = await sql.query(`SELECT * FROM ${table}`);
        return { name: table, rows };
      }),
    );

    return response.status(200).json({
      data: { generatedAt: new Date().toISOString(), tables },
      meta: { tableCount: tables.length },
      errors: [],
    });
  } catch (error) {
    console.error('Database snapshot failed', error);
    return response.status(503).json({
      data: null,
      meta: {},
      errors: ['No fue posible generar el snapshot de Neon.'],
    });
  }
}