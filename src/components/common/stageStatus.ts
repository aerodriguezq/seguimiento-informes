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
