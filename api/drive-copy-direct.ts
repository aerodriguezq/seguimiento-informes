import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDriveSession } from '../server/google-oauth.js';
import { getDriveAccessToken, copyDriveTree, DriveCopyCancelledError } from '../server/google-drive.js';

function folderIdFromUrl(value: unknown) {
  if (typeof value !== 'string') return null;
  return value.match(/\/folders\/([\w-]+)/)?.[1] ?? null;
}

// Deja más margen para carpetas grandes con reintentos por límite de tasa de Drive.
export const config = { maxDuration: 60 };

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'POST') return response.status(405).json({ data: null, meta: {}, errors: ['Método no permitido.'] });

  let cancelled = false;
  request.on('close', () => {
    if (!response.writableEnded) cancelled = true;
  });

  try {
    const session = await getDriveSession(request);
    if (!session) return response.status(401).json({ data: null, meta: {}, errors: ['Conecta Google Drive antes de copiar.'] });

    const sourceId = folderIdFromUrl(request.body?.sourceUrl);
    const destinationId = folderIdFromUrl(request.body?.destinationUrl);
    if (!sourceId || !destinationId) return response.status(400).json({ data: null, meta: {}, errors: ['Los enlaces de origen y destino no son carpetas Drive válidas.'] });

    const accessToken = await getDriveAccessToken(session.token_json);
    const result = await copyDriveTree(accessToken, sourceId, destinationId, () => cancelled);
    return response.status(200).json({ data: result, meta: {}, errors: [] });
  } catch (error) {
    if (error instanceof DriveCopyCancelledError) {
      console.log('Direct Drive copy cancelled by client');
      return;
    }
    console.error('Direct Drive copy failed', error);
    return response.status(502).json({ data: null, meta: {}, errors: [error instanceof Error ? error.message : 'No fue posible copiar la carpeta desde Google Drive.'] });
  }
}
