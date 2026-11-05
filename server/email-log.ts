type SqlClient = ReturnType<typeof import('@neondatabase/serverless').neon>;

export type EmailLogKind =
  | 'manual'
  | 'recordatorio_paso'
  | 'recordatorio_general'
  | 'peticion_recordatorio'
  | 'peticion_asignacion'
  | 'devolucion_paso'
  | 'aviso_revision'
  | 'prueba';

// Deja un rastro de cada correo que el sistema intenta enviar (haya salido
// bien o mal) -- se llama justo después de sendEmail() en cada punto de
// envío, nunca dentro de sendEmail() mismo, para no acoplar ese helper
// "puro" (sin DB) a la base de datos.
export async function logEmailSend(sql: SqlClient, entry: {
  to: string[];
  cc?: string[];
  subject: string;
  kind: EmailLogKind;
  reportId?: number | null;
  alertId?: number | null;
  peticionId?: number | null;
  success: boolean;
  errorMessage?: string | null;
  // Id que Gmail devuelve al aceptar el envío, y si la verificación
  // posterior (pedirle ese mensaje de vuelta) lo confirmó o no -- null
  // cuando no aplica (ej. el envío falló antes de llegar a Gmail).
  gmailMessageId?: string | null;
  confirmed?: boolean | null;
}): Promise<void> {
  try {
    await sql`
      INSERT INTO correo_log (destinatarios, copia, asunto, tipo, informe_id, alerta_id, peticion_id, exito, error_mensaje, gmail_message_id, confirmado)
      VALUES (
        ${entry.to}, ${entry.cc ?? null}, ${entry.subject}, ${entry.kind},
        ${entry.reportId ?? null}, ${entry.alertId ?? null}, ${entry.peticionId ?? null},
        ${entry.success}, ${entry.errorMessage ?? null}, ${entry.gmailMessageId ?? null}, ${entry.confirmed ?? null}
      )
    `;
  } catch (error) {
    // Un fallo al registrar el historial no debe tumbar el envío real.
    console.error('No fue posible registrar el historial de correo', error);
  }
}
