// Estados posibles de un paso de flujo (informe_pasos_instancia.estado),
// compartidos entre el detalle del informe y el listado general.
export const STAGE_LABEL: Record<string, string> = {
  PENDIENTE: 'Pendiente',
  ALERTA_GENERADA: 'Alerta generada',
  RECIBIDA_A_TIEMPO: 'Recibida a tiempo',
  RECIBIDA_TARDE: 'Recibida tarde',
  NO_RECIBIDA: 'No recibida',
  EN_REVISION: 'En revisión',
};

export const STAGE_COLOR: Record<string, string> = {
  PENDIENTE: 'bg-slate-100 text-slate-600',
  ALERTA_GENERADA: 'bg-amber-50 text-amber-800 border border-amber-200',
  RECIBIDA_A_TIEMPO: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
  RECIBIDA_TARDE: 'bg-orange-50 text-orange-800 border border-orange-200',
  NO_RECIBIDA: 'bg-rose-50 text-rose-700 border border-rose-200',
  EN_REVISION: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
};

// PENDIENTE/ALERTA_GENERADA son estados "abiertos" -- el barrido de alertas
// recién los pasa a NO_RECIBIDA en su próxima corrida (cada 15 min), así que
// una etapa puede estar genuinamente vencida y seguir mostrando el color
// neutro/amarillo por un rato. Esto calcula el color real a mostrar
// comparando la fecha límite contra hoy, sin esperar a que corra el barrido
// ni inventar un estado nuevo (la etiqueta sigue siendo la real).
const OPEN_STAGE_STATUSES = new Set(['PENDIENTE', 'ALERTA_GENERADA']);

export function getStageColorClass(stage: { status: string; dueDate?: string | null }): string {
  if (OPEN_STAGE_STATUSES.has(stage.status) && stage.dueDate) {
    const todayIso = new Date().toISOString().slice(0, 10);
    if (stage.dueDate < todayIso) return STAGE_COLOR.NO_RECIBIDA;
  }
  return STAGE_COLOR[stage.status] || 'bg-slate-100 text-slate-600';
}
