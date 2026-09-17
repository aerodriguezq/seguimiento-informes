// Envío y búsqueda de correos usando la cuenta de Google conectada
// directamente vía la API de Gmail, sin pasar por Apps Script (cuyo
// despliegue como app web puede estar restringido por políticas del
// Workspace del usuario). Requiere los scopes gmail.send y gmail.readonly.

function toBase64Url(value: string) {
  return Buffer.from(value, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function sendEmail(
  accessToken: string,
  options: { to: string[]; subject: string; body: string; html?: boolean },
): Promise<void> {
  const rawMessage = [
    `To: ${options.to.join(', ')}`,
    `Content-Type: text/${options.html ? 'html' : 'plain'}; charset="UTF-8"`,
    'MIME-Version: 1.0',
    `Subject: =?UTF-8?B?${Buffer.from(options.subject, 'utf-8').toString('base64')}?=`,
    '',
    options.body,
  ].join('\r\n');

  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: toBase64Url(rawMessage) }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const detail = payload?.error?.message || payload?.error?.status || JSON.stringify(payload);
    throw new Error(`Gmail respondió ${response.status} al enviar el correo: ${detail}`);
  }
}

type UrgencyColors = { bg: string; accent: string };

// 1 día o menos (incluye vencido) = rojo, 2-3 días = amarillo, 4+ días = verde.
// Sin fecha límite conocida (alerta sin informe vinculado) = azul neutro.
function urgencyColors(daysRemaining: number | null): UrgencyColors {
  if (daysRemaining === null) return { bg: '#1e3a8a', accent: '#93c5fd' };
  if (daysRemaining <= 1) return { bg: '#b91c1c', accent: '#fecaca' };
  if (daysRemaining <= 3) return { bg: '#b45309', accent: '#fde68a' };
  return { bg: '#15803d', accent: '#bbf7d0' };
}

export function buildAlertEmailHtml(options: {
  subtitle: string;
  projectName: string;
  type: string;
  schedule: string;
  daysRemaining: number | null;
  actionUrl: string;
}): string {
  const { bg, accent } = urgencyColors(options.daysRemaining);
  const escape = (value: string) => String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string));

  return `<div style="max-width: 480px; margin: 20px auto; background-color: #ffffff; border: 1px solid #dce4ec; border-radius: 8px; font-family: Arial, sans-serif; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
  <div style="background-color: ${bg}; color: #ffffff; padding: 20px; text-align: center;">
    <div style="font-size: 24px; margin-bottom: 5px;">🛡️</div>
    <h2 style="margin: 0; font-size: 18px; font-weight: bold; color: #ffffff;">Aviso: Recordatorio de Entrega</h2>
    <p style="margin: 5px 0 0 0; font-size: 16px; font-weight: 600; color: ${accent};">${escape(options.subtitle)}</p>
  </div>

  <div style="padding: 20px; background-color: #f8fafc;">
    <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #334155;">
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px 0; font-weight: bold; width: 45%;">🏢 Proyecto:</td>
        <td style="padding: 10px 0;">${escape(options.projectName)}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px 0; font-weight: bold;">📈 Tipo:</td>
        <td style="padding: 10px 0;">${escape(options.type)}</td>
      </tr>
      <tr>
        <td style="padding: 10px 0; font-weight: bold;">📅 Programación:</td>
        <td style="padding: 10px 0;">${escape(options.schedule)}</td>
      </tr>
    </table>
  </div>

  <div style="padding: 15px 20px; background-color: #ffffff; text-align: center; border-top: 1px solid #e2e8f0;">
    <p style="font-size: 11px; color: #64748b; margin: 0 0 12px 0;">Este mensaje fue enviado automáticamente desde <strong>Seguimiento de Informes</strong>.</p>
    <a href="${escape(options.actionUrl)}" style="display: inline-block; background-color: ${bg}; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 13px;">Revisar Ahora</a>
  </div>
</div>`;
}

export async function findDeliveryEmail(
  accessToken: string,
  subject: string,
  fromEmails: string[],
  afterDate: Date,
): Promise<boolean> {
  const afterSeconds = Math.floor(afterDate.getTime() / 1000);
  const senderQuery = fromEmails.length > 0 ? `(${fromEmails.map((email) => `from:${email}`).join(' OR ')})` : '';
  const query = [`subject:"${subject}"`, senderQuery, `after:${afterSeconds}`].filter(Boolean).join(' ');

  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=1`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const detail = payload?.error?.message || payload?.error?.status || JSON.stringify(payload);
    throw new Error(`Gmail respondió ${response.status} al buscar correos: ${detail}`);
  }

  const payload = await response.json();
  return Array.isArray(payload.messages) && payload.messages.length > 0;
}
