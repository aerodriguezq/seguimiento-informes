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
  options: { to: string[]; cc?: string[]; subject: string; body: string; html?: boolean },
): Promise<void> {
  const rawMessage = [
    `To: ${options.to.join(', ')}`,
    ...(options.cc && options.cc.length > 0 ? [`Cc: ${options.cc.join(', ')}`] : []),
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
// Vencido (días negativos) = un nivel MÁS severo que "rojo": ya no es "se
// vence pronto", es un incumplimiento real -- por eso lleva su propio color
// (rojo oscuro/casi negro) y encabezado, no solo el mismo rojo más intenso.
function urgencyColors(daysRemaining: number | null): UrgencyColors {
  if (daysRemaining === null) return { bg: '#1e3a8a', accent: '#93c5fd' };
  if (daysRemaining < 0) return { bg: '#450a0a', accent: '#fca5a5' };
  if (daysRemaining <= 1) return { bg: '#b91c1c', accent: '#fecaca' };
  if (daysRemaining <= 3) return { bg: '#b45309', accent: '#fde68a' };
  return { bg: '#15803d', accent: '#bbf7d0' };
}

export function buildAlertEmailHtml(options: {
  alertType: string;
  projectName: string;
  bpin: string | null;
  daysRemaining: number | null;
  dueDate: string | null;
  expectedSubject?: string | null;
  expectedFromEmails?: string[];
}): string {
  const { bg, accent } = urgencyColors(options.daysRemaining);
  const isBreach = options.daysRemaining !== null && options.daysRemaining < 0;
  const headerEmoji = isBreach ? '🚨' : '🛡️';
  const headerTitle = isBreach ? 'INCUMPLIMIENTO — Entrega vencida' : 'Aviso: Recordatorio de Entrega';
  const escape = (value: string) => String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string));

  const plazoLine = (() => {
    if (options.daysRemaining === null || !options.dueDate) return 'Sin fecha límite asociada.';
    if (options.daysRemaining < 0) return `Venció hace ${Math.abs(options.daysRemaining)} día(s) (fecha límite: ${options.dueDate})`;
    if (options.daysRemaining === 0) return `Vence hoy (fecha límite: ${options.dueDate})`;
    return `Quedan ${options.daysRemaining} día(s) para la fecha límite de entrega (${options.dueDate})`;
  })();

  return `<div style="max-width: 480px; margin: 20px auto; background-color: #ffffff; border: 1px solid #dce4ec; border-radius: 8px; font-family: Arial, sans-serif; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
  <div style="background-color: ${bg}; color: #ffffff; padding: 20px; text-align: center;">
    <div style="font-size: 24px; margin-bottom: 5px;">${headerEmoji}</div>
    <h2 style="margin: 0; font-size: 18px; font-weight: bold; color: #ffffff;">${headerTitle}</h2>
    <p style="margin: 5px 0 0 0; font-size: 16px; font-weight: 600; color: ${accent};">${escape(options.alertType.toUpperCase())}</p>
  </div>

  <div style="padding: 20px; background-color: #f8fafc;">
    <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #334155;">
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px 0; font-weight: bold; width: 45%;">🏢 Proyecto:</td>
        <td style="padding: 10px 0;">${escape(options.projectName)}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px 0; font-weight: bold;">🔢 BPIN:</td>
        <td style="padding: 10px 0;">${escape(options.bpin || 'No disponible')}</td>
      </tr>
      <tr>
        <td style="padding: 10px 0; font-weight: bold;">⏳ Plazo:</td>
        <td style="padding: 10px 0;">${escape(plazoLine)}</td>
      </tr>
    </table>
  </div>

  ${options.expectedSubject ? `<div style="padding: 16px 20px; background-color: #eff6ff; border-top: 1px solid #e2e8f0;">
    <p style="margin: 0 0 8px 0; font-size: 12.5px; font-weight: bold; color: #1e3a8a;">📧 Para que el sistema detecte tu entrega automáticamente:</p>
    <p style="margin: 0 0 4px 0; font-size: 12.5px; color: #334155;">Envía el correo con el documento adjunto usando este <strong>asunto exacto</strong>:</p>
    <p style="margin: 0 0 8px 0; font-size: 13px; font-weight: bold; color: #1e3a8a; background-color: #ffffff; border: 1px dashed #93c5fd; border-radius: 4px; padding: 8px 10px;">${escape(options.expectedSubject)}</p>
    ${options.expectedFromEmails && options.expectedFromEmails.length > 0 ? `<p style="margin: 0; font-size: 11.5px; color: #64748b;">Debe enviarse desde: <strong>${escape(options.expectedFromEmails.join(', '))}</strong></p>` : ''}
  </div>` : ''}

  <div style="padding: 15px 20px; background-color: #ffffff; text-align: center; border-top: 1px solid #e2e8f0;">
    <p style="font-size: 11px; color: #64748b; margin: 0;">Este mensaje fue enviado automáticamente desde <strong>Seguimiento de Informes</strong>.</p>
  </div>
</div>`;
}

// Correo de prueba que un admin dispara desde Usuarios para confirmar que el
// correo de una persona autorizada está bien escrito y le llega de verdad.
export function buildAccessApprovedEmailHtml(options: { name: string | null; loginUrl: string }): string {
  const escape = (value: string) => String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string));
  const greeting = options.name ? `Hola ${escape(options.name)},` : 'Hola,';

  return `<div style="max-width: 480px; margin: 20px auto; background-color: #ffffff; border: 1px solid #dce4ec; border-radius: 8px; font-family: Arial, sans-serif; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
  <div style="background-color: #15803d; color: #ffffff; padding: 20px; text-align: center;">
    <div style="font-size: 24px; margin-bottom: 5px;">✅</div>
    <h2 style="margin: 0; font-size: 18px; font-weight: bold; color: #ffffff;">Acceso aprobado</h2>
    <p style="margin: 5px 0 0 0; font-size: 14px; color: #bbf7d0;">Seguimiento de Informes</p>
  </div>

  <div style="padding: 20px; background-color: #f8fafc; font-size: 14px; color: #334155; line-height: 1.5;">
    <p style="margin: 0 0 12px 0;">${greeting}</p>
    <p style="margin: 0;">Tu cuenta de Google ya está autorizada para entrar a la plataforma de Seguimiento de Informes. Este es un correo de prueba para confirmar que tu dirección está bien escrita y te llegan las notificaciones.</p>
  </div>

  <div style="padding: 15px 20px; background-color: #ffffff; text-align: center; border-top: 1px solid #e2e8f0;">
    <a href="${escape(options.loginUrl)}" style="display: inline-block; background-color: #15803d; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 13px;">Ingresar a la plataforma</a>
    <p style="font-size: 11px; color: #64748b; margin: 12px 0 0 0;">Si no esperabas este correo, puedes ignorarlo.</p>
  </div>
</div>`;
}

const PETICION_LEVEL_COLORS: Record<'verde' | 'amarillo' | 'rojo', UrgencyColors & { label: string; emoji: string }> = {
  verde: { bg: '#15803d', accent: '#bbf7d0', label: 'Recordatorio', emoji: '🟢' },
  amarillo: { bg: '#b45309', accent: '#fde68a', label: 'Alerta de vencimiento próximo', emoji: '🟡' },
  rojo: { bg: '#b91c1c', accent: '#fecaca', label: 'Alerta urgente', emoji: '🔴' },
};
// Una vez realmente vencido (no solo "por vencer"), el rojo se queda corto
// -- se usa un tono más severo y un rótulo de incumplimiento en vez de
// "alerta urgente" repetido día tras día.
const PETICION_BREACH_COLORS: UrgencyColors & { label: string; emoji: string } = {
  bg: '#450a0a', accent: '#fca5a5', label: 'INCUMPLIMIENTO — Plazo vencido', emoji: '🚨',
};

// Recordatorio de una Petición: verde a los 5 días de plazo, amarillo a los
// 3, rojo desde 2 días en adelante (incluido vencido) — el rojo siempre
// incluye toda la información de la petición, no solo el resumen.
export function buildPeticionReminderEmailHtml(options: {
  level: 'verde' | 'amarillo' | 'rojo';
  radicado: string;
  asunto: string;
  peticionario: string;
  areaConsolida: string;
  daysRemaining: number | null;
  fechaPlazoRespuesta: string | null;
  observaciones?: string | null;
  actionUrl: string;
}): string {
  const isBreach = options.daysRemaining !== null && options.daysRemaining < 0;
  const { bg, accent, label, emoji } = isBreach ? PETICION_BREACH_COLORS : PETICION_LEVEL_COLORS[options.level];
  const escape = (value: string) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string));
  const daysText =
    options.daysRemaining === null ? ''
    : options.daysRemaining < 0 ? `Vencido hace ${Math.abs(options.daysRemaining)} día(s)`
    : options.daysRemaining === 0 ? 'Vence hoy'
    : `Quedan ${options.daysRemaining} día(s)`;

  return `<div style="max-width: 480px; margin: 20px auto; background-color: #ffffff; border: 1px solid #dce4ec; border-radius: 8px; font-family: Arial, sans-serif; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
  <div style="background-color: ${bg}; color: #ffffff; padding: 20px; text-align: center;">
    <div style="font-size: 24px; margin-bottom: 5px;">${emoji}</div>
    <h2 style="margin: 0; font-size: 18px; font-weight: bold; color: #ffffff;">${label}</h2>
    <p style="margin: 5px 0 0 0; font-size: 16px; font-weight: 600; color: ${accent};">${escape(daysText)}</p>
  </div>

  <div style="padding: 20px; background-color: #f8fafc;">
    <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #334155;">
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px 0; font-weight: bold; width: 45%;">📄 Radicado:</td>
        <td style="padding: 10px 0;">${escape(options.radicado)}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px 0; font-weight: bold;">✉️ Asunto:</td>
        <td style="padding: 10px 0;">${escape(options.asunto)}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px 0; font-weight: bold;">🙋 Peticionario:</td>
        <td style="padding: 10px 0;">${escape(options.peticionario)}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px 0; font-weight: bold;">🏢 Área consolida:</td>
        <td style="padding: 10px 0;">${escape(options.areaConsolida)}</td>
      </tr>
      <tr${options.observaciones ? ' style="border-bottom: 1px solid #e2e8f0;"' : ''}>
        <td style="padding: 10px 0; font-weight: bold;">📅 Fecha plazo respuesta:</td>
        <td style="padding: 10px 0;">${escape(options.fechaPlazoRespuesta || 'Sin definir')}</td>
      </tr>
      ${options.observaciones ? `<tr>
        <td style="padding: 10px 0; font-weight: bold; vertical-align: top;">📝 Observaciones:</td>
        <td style="padding: 10px 0; white-space: pre-wrap;">${escape(options.observaciones)}</td>
      </tr>` : ''}
    </table>
  </div>

  <div style="padding: 15px 20px; background-color: #ffffff; text-align: center; border-top: 1px solid #e2e8f0;">
    <p style="font-size: 11px; color: #64748b; margin: 0 0 12px 0;">Este mensaje fue enviado automáticamente desde <strong>Seguimiento de Informes</strong>.</p>
    <a href="${escape(options.actionUrl)}" style="display: inline-block; background-color: ${bg}; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 13px;">Revisar Ahora</a>
  </div>
</div>`;
}

// Notificación de asignación: se envía una sola vez, apenas se crea la
// petición o se agrega a alguien como responsable — distinta de los
// recordatorios por urgencia (tono neutro/informativo, no de alerta).
export function buildPeticionAssignedEmailHtml(options: {
  radicado: string;
  asunto: string;
  peticionario: string;
  areaConsolida: string;
  plazoRespuesta: number | null;
  fechaPlazoRespuesta: string | null;
  observaciones?: string | null;
  responsables: string[];
  actionUrl: string;
}): string {
  const escape = (value: string) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string));
  const bg = '#1e3a8a';
  const accent = '#bfdbfe';

  return `<div style="max-width: 480px; margin: 20px auto; background-color: #ffffff; border: 1px solid #dce4ec; border-radius: 8px; font-family: Arial, sans-serif; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
  <div style="background-color: ${bg}; color: #ffffff; padding: 20px; text-align: center;">
    <div style="font-size: 24px; margin-bottom: 5px;">📥</div>
    <h2 style="margin: 0; font-size: 18px; font-weight: bold; color: #ffffff;">Nueva petición asignada</h2>
    <p style="margin: 5px 0 0 0; font-size: 16px; font-weight: 600; color: ${accent};">${escape(options.radicado)}</p>
  </div>

  <div style="padding: 20px; background-color: #f8fafc;">
    <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #334155;">
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px 0; font-weight: bold; width: 45%;">✉️ Asunto:</td>
        <td style="padding: 10px 0;">${escape(options.asunto)}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px 0; font-weight: bold;">🙋 Peticionario:</td>
        <td style="padding: 10px 0;">${escape(options.peticionario)}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px 0; font-weight: bold;">🏢 Área consolida:</td>
        <td style="padding: 10px 0;">${escape(options.areaConsolida)}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px 0; font-weight: bold;">⏱️ Plazo de respuesta:</td>
        <td style="padding: 10px 0;">${options.plazoRespuesta !== null ? `${options.plazoRespuesta} día(s)` : 'Sin definir'}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px 0; font-weight: bold;">📅 Fecha plazo respuesta:</td>
        <td style="padding: 10px 0;">${escape(options.fechaPlazoRespuesta || 'Sin definir')}</td>
      </tr>
      <tr${options.observaciones ? ' style="border-bottom: 1px solid #e2e8f0;"' : ''}>
        <td style="padding: 10px 0; font-weight: bold;">👥 Responsables:</td>
        <td style="padding: 10px 0;">${escape(options.responsables.join(', ') || 'Sin asignar')}</td>
      </tr>
      ${options.observaciones ? `<tr>
        <td style="padding: 10px 0; font-weight: bold; vertical-align: top;">📝 Observaciones:</td>
        <td style="padding: 10px 0; white-space: pre-wrap;">${escape(options.observaciones)}</td>
      </tr>` : ''}
    </table>
  </div>

  <div style="padding: 15px 20px; background-color: #ffffff; text-align: center; border-top: 1px solid #e2e8f0;">
    <p style="font-size: 11px; color: #64748b; margin: 0 0 12px 0;">Recibirás recordatorios automáticos a medida que se acerque el plazo. Este mensaje fue enviado desde <strong>Seguimiento de Informes</strong>.</p>
    <a href="${escape(options.actionUrl)}" style="display: inline-block; background-color: ${bg}; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 13px;">Ver petición</a>
  </div>
</div>`;
}

const DRIVE_URL_PATTERN = /https:\/\/(?:drive|docs)\.google\.com\/[^\s"'<>)\]]+/;

function fromBase64Url(value: string) {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

function extractPlainText(payload: any): string {
  if (!payload) return '';
  if (payload.body?.data) return fromBase64Url(payload.body.data);
  if (Array.isArray(payload.parts)) {
    const textPart = payload.parts.find((p: any) => p.mimeType === 'text/plain') || payload.parts[0];
    return payload.parts.map((p: any) => extractPlainText(p)).join('\n') || extractPlainText(textPart);
  }
  return '';
}

export type DeliveryEmailMatch = {
  found: boolean;
  driveUrl: string | null;
  fromEmail: string | null;
  messageId: string | null;
  // Fecha real del correo (según Gmail), no la hora en que corrió el
  // barrido — así la trazabilidad conserva el momento real de la entrega.
  receivedAt: string | null;
  // Si Gmail devolvió más de un correo coincidente en la ventana buscada,
  // no hay forma confiable de saber cuál es el correcto: se marca ambiguo
  // para que quien llama NO asuma automáticamente que es válido (Regla 9:
  // "si existe una inconsistencia, marcarla para revisión").
  ambiguous: boolean;
  matchCount: number;
};

// Busca un correo entrante con el asunto esperado de alguno de los
// contactos responsables (y, opcionalmente, palabras clave adicionales
// configuradas para ese paso). Si lo encuentra, también intenta extraer un
// link de Google Drive/Docs del cuerpo del mensaje para adjuntarlo como
// evidencia.
export async function findDeliveryEmail(
  accessToken: string,
  subject: string,
  fromEmails: string[],
  afterDate: Date,
  keywords: string[] = [],
): Promise<DeliveryEmailMatch> {
  const afterSeconds = Math.floor(afterDate.getTime() / 1000);
  const senderQuery = fromEmails.length > 0 ? `(${fromEmails.map((email) => `from:${email}`).join(' OR ')})` : '';
  const keywordTerms = keywords.map((k) => k.trim()).filter(Boolean).map((k) => (k.includes(' ') ? `"${k}"` : k));
  const query = [`subject:"${subject}"`, senderQuery, `after:${afterSeconds}`, ...keywordTerms].filter(Boolean).join(' ');

  // Se piden hasta 5 para poder detectar ambigüedad (varios correos
  // coincidentes), no solo el primero.
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=5`;
  const listResponse = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!listResponse.ok) {
    const payload = await listResponse.json().catch(() => null);
    const detail = payload?.error?.message || payload?.error?.status || JSON.stringify(payload);
    throw new Error(`Gmail respondió ${listResponse.status} al buscar correos: ${detail}`);
  }

  const listPayload = await listResponse.json();
  const matches = listPayload.messages ?? [];
  const matchCount = matches.length;
  const messageId = matches[0]?.id;
  if (!messageId) return { found: false, driveUrl: null, fromEmail: null, messageId: null, receivedAt: null, ambiguous: false, matchCount: 0 };
  const ambiguous = matchCount > 1;

  const detailUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`;
  const detailResponse = await fetch(detailUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!detailResponse.ok) return { found: true, driveUrl: null, fromEmail: null, messageId, receivedAt: null, ambiguous, matchCount };

  const detail = await detailResponse.json();
  const fromHeader = detail.payload?.headers?.find((h: any) => h.name === 'From')?.value || '';
  const fromEmail = fromHeader.match(/<([^>]+)>/)?.[1] || fromHeader || null;
  const bodyText = extractPlainText(detail.payload);
  const driveUrl = bodyText.match(DRIVE_URL_PATTERN)?.[0] || null;
  // internalDate es la hora real en que Gmail recibió el mensaje (ms desde
  // epoch), independiente de cuándo corra el barrido.
  const receivedAt = detail.internalDate ? new Date(Number(detail.internalDate)).toISOString() : null;

  return { found: true, driveUrl, fromEmail, messageId, receivedAt, ambiguous, matchCount };
}
