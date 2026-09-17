import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDriveSession } from '../../../server/google-oauth';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    const session = await getDriveSession(request);
    return response.status(200).json({ data: { connected: Boolean(session), email: session?.google_email ?? null }, meta: {}, errors: [] });
  } catch (error) {
    console.error('Google OAuth status failed', error);
    return response.status(503).json({ data: null, meta: {}, errors: ['No fue posible consultar la conexión Google.'] });
  }
}