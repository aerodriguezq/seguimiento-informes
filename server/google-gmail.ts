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
  options: { to: string[]; subject: string; body: string },
): Promise<void> {
  const rawMessage = [
    `To: ${options.to.join(', ')}`,
    'Content-Type: text/plain; charset="UTF-8"',
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
