import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'GET' && request.method !== 'PUT') {
    return response.status(405).json({ data: null, meta: {}, errors: ['Método no permitido.'] });
  }

  try {
    const expectedToken = process.env.APP_SCRIPT_SHARED_SECRET;
    const receivedToken = request.headers.authorization?.replace(/^Bearer\s+/i, '') || request.query.token;
    if (expectedToken && receivedToken && receivedToken !== expectedToken) {
      return response.status(401).json({ data: null, meta: {}, errors: ['No autorizado.'] });
    }
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl?.trim()) return response.status(503).json({ data: null, meta: {}, errors: ['DATABASE_URL no está configurada.'] });
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(databaseUrl);

    if (request.method === 'PUT') {
      const { sourceUrl, destinationUrl } = request.body ?? {};
      if (!isDriveFolderUrl(sourceUrl) || !isDriveFolderUrl(destinationUrl)) {
        return response.status(400).json({ data: null, meta: {}, errors: ['Ambos enlaces deben ser URLs válidas de carpetas de Google Drive.'] });
      }
      const rows = await sql`
        INSERT INTO drive_links (config_id, source_url, destination_url, updated_at)
        VALUES (1, ${sourceUrl.trim()}, ${destinationUrl.trim()}, NOW())
        ON CONFLICT (config_id) DO UPDATE SET source_url = EXCLUDED.source_url, destination_url = EXCLUDED.destination_url, updated_at = NOW()
        RETURNING source_url AS "sourceUrl", destination_url AS "destinationUrl", updated_at AS "updatedAt"
      `;
      return response.status(200).json({ data: rows[0], meta: {}, errors: [] });
    }

    const rows = await sql`SELECT source_url AS "sourceUrl", destination_url AS "destinationUrl", updated_at AS "updatedAt" FROM drive_links WHERE config_id = 1`;
    return response.status(200).json({ data: rows[0] || { sourceUrl: '', destinationUrl: '' }, meta: {}, errors: [] });
  } catch (error) {
    console.error('Drive links query failed', error);
    return response.status(503).json({ data: null, meta: {}, errors: ['No fue posible consultar o guardar los enlaces de Drive.'] });
  }
}

function isDriveFolderUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/[\w-]+/.test(value.trim());
}