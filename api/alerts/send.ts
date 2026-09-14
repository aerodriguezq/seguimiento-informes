import type { VercelRequest, VercelResponse } from '@vercel/node';

interface AlertRecipient {
  email: string;
  name?: string;
}

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  if (request.method !== 'POST') {
    return response.status(405).json({ data: null, meta: {}, errors: ['Método no permitido.'] });
  }

  const webhookUrl = process.env.APP_SCRIPT_WEBHOOK_URL;
  const sharedSecret = process.env.APP_SCRIPT_SHARED_SECRET;

  if (!webhookUrl || !sharedSecret) {
    return response.status(503).json({
      data: null,
      meta: {},
      errors: ['El envío por Google Apps Script no está configurado en Vercel.'],
    });
  }

  const { alert, recipients } = request.body ?? {};
  const validRecipients = (Array.isArray(recipients) ? recipients : []).filter(
    (recipient: AlertRecipient) => typeof recipient?.email === 'string' && recipient.email.includes('@'),
  );

  if (!alert?.name || validRecipients.length === 0) {
    return response.status(400).json({
      data: null,
      meta: {},
      errors: ['La alerta y al menos un destinatario válido son obligatorios.'],
    });
  }

  try {
    const scriptResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: sharedSecret,
        alert: {
          name: String(alert.name),
          projectName: String(alert.projectName || 'Todos los proyectos'),
          type: String(alert.type || 'Seguimiento'),
          schedule: String(alert.schedule || ''),
        },
        recipients: validRecipients,
      }),
    });

    const scriptPayload = await scriptResponse.json().catch(() => null);

    if (!scriptResponse.ok || scriptPayload?.ok !== true) {
      console.error('Google Apps Script rejected alert', scriptResponse.status, scriptPayload);
      return response.status(502).json({
        data: null,
        meta: {},
        errors: ['Google Apps Script no confirmó el envío.'],
      });
    }

    return response.status(200).json({
      data: { sent: true, recipientCount: validRecipients.length },
      meta: {},
      errors: [],
    });
  } catch (error) {
    console.error('Alert delivery failed', error);
    return response.status(502).json({
      data: null,
      meta: {},
      errors: ['No fue posible contactar Google Apps Script.'],
    });
  }
}