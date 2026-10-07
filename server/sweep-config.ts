type SqlClient = ReturnType<typeof import('@neondatabase/serverless').neon>;

export type SweepKind = 'deteccion_entregas' | 'recordatorios_alertas' | 'importacion_cronograma';

type SweepGate = { run: boolean; reason?: 'disabled' | 'throttled' };

// Colombia es UTC-5 todo el año (sin horario de verano) -- minutos desde
// medianoche hora Colombia, para comparar contra "HH:MM" programadas.
function colombiaMinutesOfDay(date: Date): number {
  return (((date.getUTCHours() - 5 + 24) % 24) * 60 + date.getUTCMinutes());
}

function parseHHMM(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

// El workflow de GitHub Actions llama a este endpoint cada 15 minutos todo
// el día -- esto decide si, a esta hora exacta, hoy le toca correr de
// verdad según las horas programadas por el administrador (en vez de una
// frecuencia relativa a la última ejecución, que no dice a qué hora corre).
export async function getSweepGate(sql: SqlClient, kind: SweepKind, force: boolean): Promise<SweepGate> {
  const [config] = (await sql`
    SELECT activo, frecuencia_minutos AS "frequencyMinutes", ultima_ejecucion AS "lastRunAt",
      horas_programadas AS "scheduledTimes"
    FROM barrido_config WHERE kind = ${kind}
  `) as any[];
  if (!config) return { run: true };
  if (force) return { run: true };
  if (!config.activo) return { run: false, reason: 'disabled' };

  const scheduledTimes: string[] = config.scheduledTimes || [];
  if (scheduledTimes.length > 0) {
    const nowMinutes = colombiaMinutesOfDay(new Date());
    // Ventana de 20 min después de cada hora programada -- el workflow
    // dispara cada 15 min, y GitHub Actions puede retrasar el tick varios
    // minutos bajo carga, así que el margen queda un poco más ancho que el
    // intervalo de sondeo para no perderse la franja.
    const withinSlot = scheduledTimes.some((raw) => {
      const slotMinutes = parseHHMM(raw);
      if (slotMinutes === null) return false;
      const diff = nowMinutes - slotMinutes;
      return diff >= 0 && diff < 20;
    });
    if (!withinSlot) return { run: false, reason: 'throttled' };
    if (config.lastRunAt) {
      // Ya corrió para esta franja -- evita que dos ticks de 15 min
      // consecutivos dentro de la misma ventana disparen el envío dos veces.
      const elapsedMinutes = (Date.now() - new Date(config.lastRunAt).getTime()) / 60000;
      if (elapsedMinutes < 50) return { run: false, reason: 'throttled' };
    }
    return { run: true };
  }

  // Respaldo para barridos sin horas configuradas (ej. importación manual,
  // que no usa este gate en absoluto porque solo se dispara a mano).
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
