// Búsqueda de correos entrantes para detectar la entrega de un paso del
// flujo de trabajo (Fase D). Usa el mismo token de la cuenta conectada que
// ya se usa para copiar carpetas de Drive (requiere el scope gmail.readonly).

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
    if (response.status === 401 || response.status === 403) {
      throw new Error('La cuenta conectada no tiene permiso para leer Gmail. Reconéctala desde Fuentes Drive.');
    }
    throw new Error(`Gmail respondió ${response.status}.`);
  }

  const payload = await response.json();
  return Array.isArray(payload.messages) && payload.messages.length > 0;
}
