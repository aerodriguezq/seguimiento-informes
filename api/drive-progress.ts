import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'GET') return response.status(405).json({ data: null, meta: {}, errors: ['Método no permitido.'] });
  const webhookUrl = process.env.APP_SCRIPT_WEBHOOK_URL;
  const sharedSecret = process.env.APP_SCRIPT_SHARED_SECRET;
  const jobId = typeof request.query.jobId === 'string' ? request.query.jobId : '';
  if (!webhookUrl || !sharedSecret || !jobId) return response.status(400).json({ data: null, meta: {}, errors: ['Faltan configuración o jobId.'] });

  try {
    const scriptResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'drive-progress', token: sharedSecret, jobId }),
    });
    const payload = await scriptResponse.json().catch(() => null);
    if (!scriptResponse.ok || payload?.ok !== true) return response.status(502).json({ data: null, meta: {}, errors: [payload?.error || 'No fue posible consultar el progreso.'] });
    return response.status(200).json({ data: payload.progress, meta: {}, errors: [] });
  } catch (error) {
    console.error('Drive progress request failed', error);
    return response.status(502).json({ data: null, meta: {}, errors: ['No fue posible consultar el progreso.'] });
  }
}