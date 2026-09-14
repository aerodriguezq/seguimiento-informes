import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from '../server/db';

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
    const result = await sql`SELECT NOW() AS connected_at`;

    return response.status(200).json({
      data: {
        database: 'neon',
        connectedAt: result[0]?.connected_at ?? null,
      },
      meta: {},
      errors: [],
    });
  } catch (error) {
    console.error('Neon health check failed', error);

    return response.status(503).json({
      data: null,
      meta: {},
      errors: ['No fue posible conectar con la base de datos.'],
    });
  }
}