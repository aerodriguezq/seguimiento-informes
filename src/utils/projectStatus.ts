export type ModificatorioTipo = 'Adición' | 'Prórroga' | 'Suspensión' | string;

export interface Modificatorio {
  id: string;
  proyectoId: string;
  numero: string;
  tipo: ModificatorioTipo;
  fechaInicial: string | null;
  fechaFinal: string | null;
  valorInicial: number | null;
  valorActual: number | null;
  titulo: string | null;
  nota: string | null;
}

export type ProjectEstado = 'Suspendido' | 'Por iniciar' | 'Finalizado' | 'En ejecución';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Una suspensión está activa si ya empezó y (no tiene fecha final todavía,
// o la fecha final sigue siendo hoy o después).
export function findActiveSuspension(modificatorios: Modificatorio[], today = todayIso()): Modificatorio | null {
  return (
    modificatorios.find(
      (m) =>
        m.tipo === 'Suspensión' &&
        m.fechaInicial !== null &&
        m.fechaInicial <= today &&
        (m.fechaFinal === null || m.fechaFinal >= today),
    ) ?? null
  );
}

// La prórroga más reciente extiende la fecha fin "real" del contrato --
// usado tanto para el Estado como para contar cuántos informes se esperan.
export function effectiveEndDate(project: { endDate: string }, modificatorios: Modificatorio[]): string | null {
  const prorrogaDates = modificatorios
    .filter((m) => m.tipo === 'Prórroga' && m.fechaFinal)
    .map((m) => m.fechaFinal as string);
  const dates = [project.endDate, ...prorrogaDates].filter(Boolean);
  if (dates.length === 0) return null;
  return dates.reduce((max, d) => (d > max ? d : max));
}

export function computeProjectEstado(
  project: { startDate: string; endDate: string },
  modificatorios: Modificatorio[],
  today = todayIso(),
): ProjectEstado {
  if (findActiveSuspension(modificatorios, today)) return 'Suspendido';
  if (project.startDate && today < project.startDate) return 'Por iniciar';
  const endDate = effectiveEndDate(project, modificatorios);
  if (endDate && today > endDate) return 'Finalizado';
  return 'En ejecución';
}

export function isProjectSuspended(modificatorios: Modificatorio[], today = todayIso()): boolean {
  return findActiveSuspension(modificatorios, today) !== null;
}

// Cuántos meses de informe se esperan en total, desde el inicio hasta la
// fecha fin efectiva (con prórrogas) -- base para "vamos en el informe N de T".
export function expectedReportMonths(project: { startDate: string; endDate: string }, modificatorios: Modificatorio[]): number | null {
  const end = effectiveEndDate(project, modificatorios);
  if (!project.startDate || !end) return null;
  const start = new Date(`${project.startDate}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(endDate.getTime()) || endDate < start) return null;
  const months =
    (endDate.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (endDate.getUTCMonth() - start.getUTCMonth()) +
    1;
  return Math.max(months, 1);
}

export const ESTADO_META: Record<ProjectEstado, { label: string; color: string; bg: string; border: string }> = {
  Suspendido: { label: 'Suspendido', color: '#be123c', bg: '#fff1f2', border: '#fecdd3' },
  'Por iniciar': { label: 'Por iniciar', color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
  Finalizado: { label: 'Finalizado', color: '#475569', bg: '#f1f5f9', border: '#e2e8f0' },
  'En ejecución': { label: 'En ejecución', color: '#047857', bg: '#ecfdf5', border: '#a7f3d0' },
};
