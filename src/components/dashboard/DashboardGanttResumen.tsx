import React, { useEffect, useMemo, useState } from 'react';
import { CalendarRange, ArrowUpRight } from 'lucide-react';
import {
  GanttData,
  ESTADO_META,
  computeMonthPosition,
  computeEstado,
  monthLabelLong,
} from '../projects/SeguimientoGanttMensual';

type SheetSummary = { seguimientoId: number; nombre: string };

const ACCENT = '#0f5c8c';
const ACCENT_LIGHT = '#e6f0f7';

// Resumen liviano del Gantt Físico de la hoja principal del proyecto activo,
// para que el estado del cronograma se vea de entrada en el Dashboard
// General sin tener que entrar al detalle del proyecto -- misma lógica de
// cálculo que SeguimientoGanttMensual, solo que condensada a la franja de
// KPIs (sin filtros ni el listado de subactividades).
export const DashboardGanttResumen: React.FC<{ projectId: string; onOpenSeguimiento: () => void }> = ({ projectId, onOpenSeguimiento }) => {
  const [sheet, setSheet] = useState<SheetSummary | null>(null);
  const [data, setData] = useState<GanttData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!projectId) { setSheet(null); setData(null); setIsLoading(false); return; }
    let cancelled = false;
    setIsLoading(true);
    setData(null);
    fetch(`/api/projects?seguimiento=listaHojas&projectId=${encodeURIComponent(projectId)}`)
      .then((res) => res.json())
      .then((payload) => {
        if (cancelled) return;
        const primera = (payload.data || [])[0] || null;
        setSheet(primera ? { seguimientoId: primera.seguimientoId, nombre: primera.nombre } : null);
        if (!primera) setIsLoading(false);
      })
      .catch(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    if (!sheet) return;
    let cancelled = false;
    fetch(`/api/projects?seguimiento=gantt&seguimientoId=${sheet.seguimientoId}`)
      .then((res) => res.json())
      .then((payload) => { if (!cancelled) setData(payload.data); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [sheet]);

  const { currentIdx, closedCount } = useMemo(() => computeMonthPosition(data?.meses ?? []), [data?.meses]);

  const resumen = useMemo(() => {
    const lista = data?.fisico ?? [];
    let atrasadas = 0, alDia = 0, porIniciar = 0;
    const actividades = new Set<string>();
    lista.forEach((s) => {
      actividades.add(s.actividad);
      const bucket = ESTADO_META[computeEstado(s, closedCount, currentIdx)].bucket;
      if (bucket === 'atrasada') atrasadas++;
      else if (bucket === 'al_dia') alDia++;
      else porIniciar++;
    });
    return { atrasadas, alDia, porIniciar, total: lista.length, actividades: actividades.size };
  }, [data, closedCount, currentIdx]);

  if (isLoading || !data || data.fisico.length === 0) return null;

  const meses = data.meses;
  const mesesCerradosPct = meses.length > 0 ? Math.round((closedCount / meses.length) * 100) : 0;

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_10px_24px_rgba(20,32,43,0.045)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg shrink-0" style={{ background: ACCENT_LIGHT, color: ACCENT }}>
            <CalendarRange className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: ACCENT }}>Gantt Físico</p>
            <h3 className="text-sm font-bold text-slate-950">{sheet?.nombre || 'Cronograma del proyecto'}</h3>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold border" style={{ borderColor: ACCENT, color: ACCENT }}>
            Hoy: {monthLabelLong(meses[currentIdx])} · mes {currentIdx + 1} de {meses.length}
          </span>
          <button type="button" onClick={onOpenSeguimiento} className="inline-flex items-center gap-1 text-xs font-bold text-indigo-700 hover:text-indigo-900">
            Ver Seguimiento <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5 p-4 sm:grid-cols-5">
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="text-xl font-bold text-slate-900 tabular-nums">{closedCount} / {meses.length}</p>
          <p className="mt-0.5 text-[10.5px] text-slate-500">meses cerrados ({mesesCerradosPct}% del tiempo)</p>
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="text-xl font-bold text-slate-900 tabular-nums">{resumen.total}</p>
          <p className="mt-0.5 text-[10.5px] text-slate-500">subactividades en {resumen.actividades} actividades</p>
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="text-xl font-bold tabular-nums" style={{ color: ESTADO_META.atrasada.color }}>{resumen.atrasadas}</p>
          <p className="mt-0.5 text-[10.5px] text-slate-500">atrasadas frente al plan</p>
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="text-xl font-bold text-slate-900 tabular-nums">{resumen.alDia}</p>
          <p className="mt-0.5 text-[10.5px] text-slate-500">al día, adelantadas o cumplidas</p>
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="text-xl font-bold text-slate-900 tabular-nums">{resumen.porIniciar}</p>
          <p className="mt-0.5 text-[10.5px] text-slate-500">por iniciar</p>
        </div>
      </div>
    </section>
  );
};
