type SqlClient = ReturnType<typeof import('@neondatabase/serverless').neon>;

export type SweepKind = 'deteccion_entregas' | 'recordatorios_alertas';

type SweepGate = { run: boolean; reason?: 'disabled' | 'throttled' };

// Decide si un barrido debe ejecutarse de verdad o saltarse, según la
// configuración que el administrador dejó en barrido_config: activo/inactivo
// y cada cuánto (en minutos) debe volver a correr desde la última vez.
export async function getSweepGate(sql: SqlClient, kind: SweepKind, force: boolean): Promise<SweepGate> {
  const [config] = (await sql`
    SELECT activo, frecuencia_minutos AS "frequencyMinutes", ultima_ejecucion AS "lastRunAt"
    FROM barrido_config WHERE kind = ${kind}
  `) as any[];
  if (!config) return { run: true };
  if (force) return { run: true };
  if (!config.activo) return { run: false, reason: 'disabled' };
  if (!config.lastRunAt) return { run: true };

  const elapsedMinutes = (Date.now() - new Date(config.lastRunAt).getTime()) / 60000;
  if (elapsedMinutes < config.frequencyMinutes) return { run: false, reason: 'throttled' };
  return { run: true };
}

export async function recordSweepRun(sql: SqlClient, kind: SweepKind, success: boolean, result: unknown) {
  await sql`
    UPDATE barrido_config
    SET ultima_ejecucion = NOW(), ultimo_exito = ${success}, ultimo_resultado = ${JSON.stringify(result)}::jsonb, updated_at = NOW()
    WHERE kind = ${kind}
  `;
}
