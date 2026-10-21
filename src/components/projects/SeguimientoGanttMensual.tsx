import React, { useEffect, useMemo, useState } from 'react';
import { CalendarRange, ChevronDown, ChevronUp } from 'lucide-react';

type GanttSubactividad = {
  actividad: string;
  descripcion: string;
  subActividad: string;
  meta: number;
  unidad: string;
  plan: number[];
  ejecutado: number[];
};
type ResumenFinanciero = { totalPlanificado: number; planificadoAcumulado: number[]; ejecutadoAcumulado: number[] };
type GanttData = { meses: string[]; fisico: GanttSubactividad[]; financiero: GanttSubactividad[] | null; resumenFinanciero: ResumenFinanciero | null };

type Estado = 'cumplida' | 'adelantada' | 'al_dia' | 'atrasada' | 'inicia_este_mes' | 'aun_no_inicia';
type Bucket = 'atrasada' | 'al_dia' | 'por_iniciar';

const ESTADO_META: Record<Estado, { label: string; color: string; bg: string; bucket: Bucket }> = {
  cumplida: { label: 'Cumplida', color: '#64748b', bg: '#f1f5f9', bucket: 'al_dia' },
  adelantada: { label: 'Adelantada', color: '#2563eb', bg: '#eff6ff', bucket: 'al_dia' },
  al_dia: { label: 'Al día', color: '#059669', bg: '#ecfdf5', bucket: 'al_dia' },
  atrasada: { label: 'Atrasada', color: '#dc2626', bg: '#fef2f2', bucket: 'atrasada' },
  inicia_este_mes: { label: 'Inicia este mes', color: '#0f5c8c', bg: '#e6f0f7', bucket: 'por_iniciar' },
  aun_no_inicia: { label: 'Aún no inicia', color: '#94a3b8', bg: '#f8fafc', bucket: 'por_iniciar' },
};
const BUCKET_META: Record<Bucket, { label: string }> = {
  atrasada: { label: 'Atrasadas' },
  al_dia: { label: 'Al día' },
  por_iniciar: { label: 'Por iniciar' },
};

const ACCENT = '#0f5c8c';
const ACCENT_LIGHT = '#e6f0f7';
const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function monthLabel(iso: string): string {
  const [, m] = iso.split('-');
  return MESES_CORTO[Number(m) - 1] || iso;
}
function monthLabelLong(iso: string): string {
  const [y, m] = iso.split('-');
  return `${monthLabel(iso)} ${y}`;
}

function sumRange(arr: number[], end: number): number {
  return arr.slice(0, Math.max(end, 0)).reduce((a, b) => a + b, 0);
}
function sumAll(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

function computeMonthPosition(meses: string[]): { currentIdx: number; closedCount: number } {
  if (meses.length === 0) return { currentIdx: 0, closedCount: 0 };
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  let currentIdx = meses.findIndex((m) => m >= todayIso);
  if (currentIdx === -1) currentIdx = meses.length - 1;
  return { currentIdx, closedCount: currentIdx };
}

function computeEstado(s: GanttSubactividad, closedCount: number, currentIdx: number): Estado {
  const ejecTotal = sumAll(s.ejecutado);
  if (s.meta > 0 && ejecTotal >= s.meta) return 'cumplida';
  const planCum = sumRange(s.plan, closedCount);
  const ejecCum = sumRange(s.ejecutado, closedCount);
  if (ejecCum > planCum) return 'adelantada';
  if (ejecCum === planCum) {
    if (planCum === 0) return (s.plan[currentIdx] ?? 0) > 0 ? 'inicia_este_mes' : 'aun_no_inicia';
    return 'al_dia';
  }
  return 'atrasada';
}

function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const rounded = Math.round(v * 100) / 100;
  return rounded.toLocaleString('es-CO', { maximumFractionDigits: 2 });
}
function fmtValor(v: number, unidad: string): string {
  if (unidad === 'COP') {
    return v.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  }
  return fmtNum(v);
}
function fmtPct(ejec: number, meta: number): string {
  if (meta <= 0) return '0%';
  return `${Math.round((ejec / meta) * 100)}%`;
}
function fmtCOPCompact(v: number): string {
  return v.toLocaleString('es-CO', { style: 'currency', currency: 'COP', notation: 'compact', maximumFractionDigits: 1 });
}

const MonthBars: React.FC<{ meses: string[]; plan: number[]; ejecutado: number[]; currentIdx: number }> = ({ meses, plan, ejecutado, currentIdx }) => {
  const maxVal = Math.max(1, ...plan, ...ejecutado);
  return (
    <div className="mt-2">
      <div className="flex">
        {meses.map((m, i) => (
          <div
            key={m}
            className="flex-1 text-center text-[9.5px] shrink-0"
            style={i === currentIdx ? { color: ACCENT, fontWeight: 700 } : { color: '#94a3b8' }}
            title={monthLabelLong(m)}
          >
            {monthLabel(m)}
          </div>
        ))}
      </div>
      {[{ data: plan, color: ACCENT, track: '#eef2f7' }, { data: ejecutado, color: '#34a06a', track: '#eef2f7' }].map((row, rowIdx) => (
        <div key={rowIdx} className="flex items-end gap-px mt-1" style={{ height: 14 }}>
          {row.data.map((v, i) => {
            const h = v > 0 ? Math.max(3, Math.round((v / maxVal) * 14)) : 0;
            return (
              <div key={i} className="flex-1 flex items-end justify-center shrink-0" style={{ height: 14, background: i === currentIdx ? '#fef9ee' : undefined }}>
                <div
                  style={{
                    width: '70%',
                    height: h,
                    background: v > 0 ? row.color : 'transparent',
                    opacity: v > 0 ? 1 : 0,
                    borderRadius: 1,
                  }}
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};

const SubactividadRow: React.FC<{ s: GanttSubactividad; meses: string[]; closedCount: number; currentIdx: number }> = ({ s, meses, closedCount, currentIdx }) => {
  const estado = computeEstado(s, closedCount, currentIdx);
  const meta = ESTADO_META[estado];
  const ejecTotal = sumAll(s.ejecutado);
  return (
    <div className="px-4 py-3 border-t border-slate-100 first:border-t-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-[12.5px] font-semibold text-slate-800">{s.subActividad}</span>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ color: meta.color, background: meta.bg }}>
          {meta.label}
        </span>
        <span className="text-[10.5px] text-slate-400">Meta: {fmtValor(s.meta, s.unidad)} {s.unidad !== 'COP' ? s.unidad : ''}</span>
      </div>
      <MonthBars meses={meses} plan={s.plan} ejecutado={s.ejecutado} currentIdx={currentIdx} />
      <p className="mt-1.5 text-[12px]">
        <span className="font-bold text-slate-800">{fmtPct(ejecTotal, s.meta)}</span>
        <span className="text-slate-400"> · {fmtValor(ejecTotal, s.unidad)} de {fmtValor(s.meta, s.unidad)}</span>
      </p>
    </div>
  );
};

export const SeguimientoGanttMensual: React.FC<{ seguimientoId: number; lastImportAt: string | null }> = ({ seguimientoId, lastImportAt }) => {
  const [data, setData] = useState<GanttData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tipo, setTipo] = useState<'fisico' | 'financiero'>('fisico');
  const [actividadFiltro, setActividadFiltro] = useState<string>('Todas');
  const [estadoFiltro, setEstadoFiltro] = useState<Bucket | 'Todos'>('Todos');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showAvancePorMes, setShowAvancePorMes] = useState(false);

  useEffect(() => {
    setIsLoading(true);
    setData(null);
    setActividadFiltro('Todas');
    setEstadoFiltro('Todos');
    fetch(`/api/projects?seguimiento=gantt&seguimientoId=${seguimientoId}`)
      .then((res) => res.json())
      .then((payload) => setData(payload.data))
      .finally(() => setIsLoading(false));
  }, [seguimientoId]);

  const activeList = tipo === 'financiero' && data?.financiero ? data.financiero : data?.fisico ?? [];
  const { currentIdx, closedCount } = useMemo(() => computeMonthPosition(data?.meses ?? []), [data?.meses]);

  const actividades = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    (data?.fisico ?? []).forEach((s) => {
      if (!seen.has(s.actividad)) { seen.add(s.actividad); list.push(s.actividad); }
    });
    return list;
  }, [data]);

  const estadoPorSub = useMemo(() => {
    const map = new Map<string, Estado>();
    activeList.forEach((s) => map.set(s.actividad + '||' + s.subActividad, computeEstado(s, closedCount, currentIdx)));
    return map;
  }, [activeList, closedCount, currentIdx]);

  const resumen = useMemo(() => {
    let atrasadas = 0, alDia = 0, porIniciar = 0;
    activeList.forEach((s) => {
      const estado = estadoPorSub.get(s.actividad + '||' + s.subActividad);
      const bucket = estado ? ESTADO_META[estado].bucket : null;
      if (bucket === 'atrasada') atrasadas++;
      else if (bucket === 'al_dia') alDia++;
      else if (bucket === 'por_iniciar') porIniciar++;
    });
    return { atrasadas, alDia, porIniciar, total: activeList.length, actividades: actividades.length };
  }, [activeList, estadoPorSub, actividades]);

  const grupos = useMemo(() => {
    const byActividad = new Map<string, { actividad: string; descripcion: string; subactividades: GanttSubactividad[] }>();
    activeList.forEach((s) => {
      if (actividadFiltro !== 'Todas' && s.actividad !== actividadFiltro) return;
      const estado = estadoPorSub.get(s.actividad + '||' + s.subActividad);
      const bucket = estado ? ESTADO_META[estado].bucket : null;
      if (estadoFiltro !== 'Todos' && bucket !== estadoFiltro) return;
      if (!byActividad.has(s.actividad)) byActividad.set(s.actividad, { actividad: s.actividad, descripcion: s.descripcion, subactividades: [] });
      byActividad.get(s.actividad)!.subactividades.push(s);
    });
    return Array.from(byActividad.values());
  }, [activeList, actividadFiltro, estadoFiltro, estadoPorSub]);

  const toggleCollapsed = (actividad: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(actividad)) next.delete(actividad);
      else next.add(actividad);
      return next;
    });
  };

  if (isLoading) {
    return <div className="p-6 text-center text-xs text-slate-400">Cargando Gantt...</div>;
  }
  if (!data || data.fisico.length === 0) {
    return <div className="p-6 text-center text-xs text-slate-400">Sin datos importados todavía.</div>;
  }

  const meses = data.meses;
  const mesesCerradosPct = meses.length > 0 ? Math.round((closedCount / meses.length) * 100) : 0;

  return (
    <div>
      <div className="p-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg shrink-0" style={{ background: ACCENT_LIGHT, color: ACCENT }}>
            <CalendarRange className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">Gantt {tipo === 'financiero' ? 'Financiero' : 'Físico'}</h3>
            <p className="text-[11px] text-slate-500">
              Plan y ejecución de cada actividad del proyecto, mes a mes, de {monthLabelLong(meses[0])} a {monthLabelLong(meses[meses.length - 1])}.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {data.financiero && (
            <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-[11px] font-semibold">
              {(['fisico', 'financiero'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTipo(t)}
                  className="px-2.5 py-1.5"
                  style={tipo === t ? { background: ACCENT, color: '#fff' } : { color: '#475569', background: '#fff' }}
                >
                  {t === 'fisico' ? 'Físico' : 'Financiero'}
                </button>
              ))}
            </div>
          )}
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold border" style={{ borderColor: ACCENT, color: ACCENT }}>
            Hoy: {monthLabelLong(meses[currentIdx])} · mes {currentIdx + 1} de {meses.length}
          </span>
        </div>
      </div>

      <div className="px-4 grid grid-cols-2 sm:grid-cols-5 gap-2.5">
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="text-xl font-bold text-slate-900 tabular-nums">{closedCount} / {meses.length}</p>
          <p className="text-[10.5px] text-slate-500 mt-0.5">meses cerrados ({mesesCerradosPct}% del tiempo)</p>
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="text-xl font-bold text-slate-900 tabular-nums">{resumen.total}</p>
          <p className="text-[10.5px] text-slate-500 mt-0.5">subactividades en {resumen.actividades} actividades</p>
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="text-xl font-bold tabular-nums" style={{ color: ESTADO_META.atrasada.color }}>{resumen.atrasadas}</p>
          <p className="text-[10.5px] text-slate-500 mt-0.5">atrasadas frente al plan</p>
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="text-xl font-bold text-slate-900 tabular-nums">{resumen.alDia}</p>
          <p className="text-[10.5px] text-slate-500 mt-0.5">al día, adelantadas o cumplidas</p>
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="text-xl font-bold text-slate-900 tabular-nums">{resumen.porIniciar}</p>
          <p className="text-[10.5px] text-slate-500 mt-0.5">por iniciar</p>
        </div>
      </div>

      {tipo === 'financiero' && data.resumenFinanciero && (
        <div className="mx-4 mt-3 rounded-lg border border-slate-200 p-3.5" style={{ background: ACCENT_LIGHT }}>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: ACCENT }}>Avance financiero general del proyecto</p>
          <p className="text-[10.5px] text-slate-500 mt-0.5">
            Acumulado a {monthLabelLong(meses[closedCount > 0 ? closedCount - 1 : 0])} (último mes cerrado), sobre un presupuesto total de {fmtCOPCompact(data.resumenFinanciero.totalPlanificado)}.
          </p>
          <div className="mt-2.5 grid grid-cols-2 gap-3">
            {(() => {
              const idx = Math.max(closedCount - 1, 0);
              const ejec = data.resumenFinanciero.ejecutadoAcumulado[idx] ?? 0;
              const plan = data.resumenFinanciero.planificadoAcumulado[idx] ?? 0;
              const total = data.resumenFinanciero.totalPlanificado;
              const pctEjec = total > 0 ? (ejec / total) * 100 : 0;
              const pctPlan = total > 0 ? (plan / total) * 100 : 0;
              return (
                <>
                  <div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-[11px] font-semibold text-slate-600">Ejecutado</span>
                      <span className="text-[11px] font-bold text-slate-800">{pctEjec.toFixed(1)}% · {fmtCOPCompact(ejec)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/70 overflow-hidden mt-1">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(pctEjec, 100)}%`, background: '#34a06a' }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-[11px] font-semibold text-slate-600">Planificado</span>
                      <span className="text-[11px] font-bold text-slate-800">{pctPlan.toFixed(1)}% · {fmtCOPCompact(plan)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/70 overflow-hidden mt-1">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(pctPlan, 100)}%`, background: ACCENT }} />
                    </div>
                  </div>
                </>
              );
            })()}
          </div>

          <button
            type="button"
            onClick={() => setShowAvancePorMes((v) => !v)}
            className="mt-2.5 inline-flex items-center gap-1 text-[10.5px] font-semibold"
            style={{ color: ACCENT }}
          >
            {showAvancePorMes ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {showAvancePorMes ? 'Ocultar detalle mes a mes' : 'Ver detalle mes a mes'}
          </button>

          {showAvancePorMes && (
            <div className="mt-2 overflow-x-auto">
              <table className="text-[10.5px] border-collapse" style={{ minWidth: meses.length * 56 }}>
                <thead>
                  <tr>
                    <th className="text-left font-semibold text-slate-500 pr-2 pb-1 sticky left-0" style={{ background: ACCENT_LIGHT }}></th>
                    {meses.map((m, i) => (
                      <th
                        key={m}
                        className="text-right font-semibold pb-1 px-1.5"
                        style={i === closedCount - 1 ? { color: ACCENT } : { color: '#94a3b8' }}
                      >
                        {monthLabel(m)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {([
                    { label: 'Planificado %', arr: data.resumenFinanciero.planificadoAcumulado, color: ACCENT },
                    { label: 'Ejecutado %', arr: data.resumenFinanciero.ejecutadoAcumulado, color: '#34a06a' },
                  ] as const).map((fila) => (
                    <tr key={fila.label} className="border-t" style={{ borderColor: '#d6e3ec' }}>
                      <td className="text-left font-semibold py-1 pr-2 whitespace-nowrap sticky left-0" style={{ color: fila.color, background: ACCENT_LIGHT }}>
                        {fila.label}
                      </td>
                      {fila.arr.map((v, i) => (
                        <td key={i} className="text-right tabular-nums py-1 px-1.5" style={i === closedCount - 1 ? { fontWeight: 700, color: '#1e293b' } : { color: '#475569' }}>
                          {data.resumenFinanciero!.totalPlanificado > 0 ? `${((v / data.resumenFinanciero!.totalPlanificado) * 100).toFixed(1)}%` : '0%'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="px-4 mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Actividad</span>
          {['Todas', ...actividades].map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setActividadFiltro(a)}
              className="px-2 py-0.5 rounded-full text-[11px] font-semibold border"
              style={actividadFiltro === a ? { background: ACCENT, color: '#fff', borderColor: ACCENT } : { color: '#475569', borderColor: '#e1e5ea' }}
            >
              {a === 'Contrapartida' ? a : a.replace('Actividad ', '')}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Estado</span>
          {(['Todos', 'atrasada', 'al_dia', 'por_iniciar'] as const).map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setEstadoFiltro(b)}
              className="px-2 py-0.5 rounded-full text-[11px] font-semibold border"
              style={estadoFiltro === b ? { background: ACCENT, color: '#fff', borderColor: ACCENT } : { color: '#475569', borderColor: '#e1e5ea' }}
            >
              {b === 'Todos' ? 'Todos' : BUCKET_META[b].label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 mt-3 flex items-center gap-4 text-[10.5px] text-slate-500">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-2 rounded-sm" style={{ background: ACCENT }} />Plan (cantidad programada en el mes)</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-2 rounded-sm" style={{ background: '#34a06a' }} />Ejecutado</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-2 rounded-sm" style={{ background: '#fef9ee', border: '1px solid #f0d9a0' }} />Mes actual</span>
      </div>

      <div className="p-4 space-y-3">
        {grupos.length === 0 && <p className="text-xs text-slate-400 text-center py-6">No hay subactividades con ese filtro.</p>}
        {grupos.map((g) => {
          const isCollapsed = collapsed.has(g.actividad);
          return (
            <div key={g.actividad} className="rounded-xl border border-slate-200 overflow-hidden">
              <button
                type="button"
                onClick={() => toggleCollapsed(g.actividad)}
                className="w-full flex items-start gap-2 px-4 py-3 text-left hover:bg-slate-50"
              >
                {isCollapsed ? <ChevronDown className="h-4 w-4 mt-0.5 text-slate-400 shrink-0" /> : <ChevronUp className="h-4 w-4 mt-0.5 text-slate-400 shrink-0" />}
                <div>
                  <p className="text-[13px] font-bold text-slate-900">{g.actividad}</p>
                  {g.descripcion && g.descripcion !== g.actividad && <p className="text-[11px] text-slate-500 mt-0.5">{g.descripcion}</p>}
                </div>
              </button>
              {!isCollapsed && g.subactividades.map((s) => (
                <SubactividadRow key={s.subActividad} s={s} meses={meses} closedCount={closedCount} currentIdx={currentIdx} />
              ))}
            </div>
          );
        })}
      </div>

      <p className="px-4 pb-4 text-[10.5px] text-slate-400">
        Fuente: hoja GANTT {tipo === 'financiero' ? 'FINANCIERO' : 'FÍSICO'}
        {lastImportAt ? `, importado el ${new Date(lastImportAt).toLocaleString('es-CO')}` : ''}. El estado compara lo ejecutado con lo programado hasta el último mes cerrado.
      </p>
    </div>
  );
};
