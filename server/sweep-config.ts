type SqlClient = ReturnType<typeof import('@neondatabase/serverless').neon>;

export type SweepKind = 'deteccion_entregas' | 'recordatorios_alertas' | 'importacion_cronograma';

type SweepGate = { run: boolean; reason?: 'disabled' | 'throttled' };

// Colombia es UTC-5 todo el año (sin horario de verano) -- minutos desde
// medianoche hora Colombia, para comparar contra "HH:MM" programadas.
function colombiaMinutesOfDay(date: Date): number {
  return (((date.getUTCHours() - 5 + 24) % 24) * 60 + date.getUTCMinutes());
}

// Fecha calendario en Colombia (no en UTC) -- restar 5h antes de tomar la
// fecha evita que una franja de la tarde/noche (ej. 18:00 Colombia, que ya
// es el día siguiente en UTC desde las 19:00 Colombia) quede mal comparada.
function colombiaDateString(date: Date): string {
  return new Date(date.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
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
    const now = new Date();
    const nowMinutes = colombiaMinutesOfDay(now);
    // Ventana de 20 min después de cada hora programada -- el workflow
    // dispara cada 15 min, y GitHub Actions puede retrasar el tick varios
    // minutos bajo carga, así que el margen queda un poco más ancho que el
    // intervalo de sondeo para no perderse la franja.
    const matchingSlotMinutes = scheduledTimes
      .map(parseHHMM)
      .find((slotMinutes): slotMinutes is number => slotMinutes !== null && nowMinutes - slotMinutes >= 0 && nowMinutes - slotMinutes < 20);
    if (matchingSlotMinutes === undefined) return { run: false, reason: 'throttled' };

    if (config.lastRunAt) {
      // Dedup por FRANJA, no por "hace cuánto corrió por última vez": un
      // "Ejecutar ahora" manual (force) no debe bloquear la siguiente franja
      // programada real -- solo evita repetir la MISMA franja si dos ticks
      // de 15 min caen dentro de su ventana de 20 min.
      const lastRun = new Date(config.lastRunAt);
      const lastRunMinutes = colombiaMinutesOfDay(lastRun);
      const sameDay = colombiaDateString(lastRun) === colombiaDateString(now);
      const alreadyServedThisSlot = sameDay && lastRunMinutes - matchingSlotMinutes >= 0 && lastRunMinutes - matchingSlotMinutes < 20;
      if (alreadyServedThisSlot) return { run: false, reason: 'throttled' };
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
