import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'POST') {
    return response.status(405).json({ data: null, meta: {}, errors: ['Método no permitido.'] });
  }

  const webhookUrl = process.env.APP_SCRIPT_WEBHOOK_URL;
  const sharedSecret = process.env.APP_SCRIPT_SHARED_SECRET;

  if (!webhookUrl || !sharedSecret) {
    return response.status(503).json({
      data: null,
      meta: {},
      errors: ['Configura APP_SCRIPT_WEBHOOK_URL y APP_SCRIPT_SHARED_SECRET en Vercel.'],
    });
  }

  try {
    const jobId = typeof request.body?.jobId === 'string' ? request.body.jobId : crypto.randomUUID();
    const scriptResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'copy-drive', token: sharedSecret, jobId }),
    });
    const payload = await scriptResponse.json().catch(() => null);

    if (!scriptResponse.ok || payload?.ok !== true) {
      console.error('Google Apps Script copy failed', scriptResponse.status, payload);
      return response.status(502).json({
        data: null,
        meta: {},
        errors: [
          payload?.error
            ? `Apps Script: ${payload.error}`
            : 'Apps Script no confirmó la copia de la carpeta.',
        ],
      });
    }

    return response.status(200).json({ data: { ...payload.result, jobId }, meta: {}, errors: [] });
  } catch (error) {
    console.error('Drive copy request failed', error);
    return response.status(502).json({
      data: null,
      meta: {},
      errors: ['No fue posible contactar Apps Script.'],
    });
  }
}