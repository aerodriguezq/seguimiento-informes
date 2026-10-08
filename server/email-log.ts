type SqlClient = ReturnType<typeof import('@neondatabase/serverless').neon>;

export type EmailLogKind =
  | 'manual'
  | 'recordatorio_paso'
  | 'recordatorio_general'
  | 'peticion_recordatorio'
  | 'peticion_asignacion'
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
}): Promise<void> {
  try {
    await sql`
      INSERT INTO correo_log (destinatarios, copia, asunto, tipo, informe_id, alerta_id, peticion_id, exito, error_mensaje)
      VALUES (
        ${entry.to}, ${entry.cc ?? null}, ${entry.subject}, ${entry.kind},
        ${entry.reportId ?? null}, ${entry.alertId ?? null}, ${entry.peticionId ?? null},
        ${entry.success}, ${entry.errorMessage ?? null}
      )
    `;
  } catch (error) {
    // Un fallo al registrar el historial no debe tumbar el envío real.
    console.error('No fue posible registrar el historial de correo', error);
  }
}
