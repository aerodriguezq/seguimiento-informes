import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  CalendarRange,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Search,
  X,
  RotateCcw,
  CalendarClock,
  Layers,
  AlertTriangle,
  CheckCircle2,
  Clock,
  TrendingDown,
  TrendingUp,
  BarChart2,
  Coins,
  Info,
  Lock,
} from 'lucide-react';

export type GanttSubactividad = {
  actividad: string;
  descripcion: string;
  subActividad: string;
  meta: number;
  unidad: string;
  plan: number[];
  ejecutado: number[];
};
type ResumenFinanciero = { totalPlanificado: number; planificadoAcumulado: number[]; ejecutadoAcumulado: number[] };
export type GanttData = { meses: string[]; fisico: GanttSubactividad[]; financiero: GanttSubactividad[] | null; resumenFinanciero: ResumenFinanciero | null };

export type Estado = 'cumplida' | 'adelantada' | 'al_dia' | 'atrasada' | 'inicia_este_mes' | 'aun_no_inicia';
export type Bucket = 'atrasada' | 'al_dia' | 'por_iniciar';

export const ESTADO_META: Record<Estado, { label: string; color: string; bg: string; bucket: Bucket }> = {
  cumplida: { label: 'Cumplida', color: '#64748b', bg: '#f1f5f9', bucket: 'al_dia' },
  adelantada: { label: 'Adelantada', color: '#2563eb', bg: '#eff6ff', bucket: 'al_dia' },
  al_dia: { label: 'Al día', color: '#059669', bg: '#ecfdf5', bucket: 'al_dia' },
  atrasada: { label: 'Atrasada', color: '#dc2626', bg: '#fef2f2', bucket: 'atrasada' },
  inicia_este_mes: { label: 'Inicia este mes', color: '#0f5c8c', bg: '#e6f0f7', bucket: 'por_iniciar' },
  aun_no_inicia: { label: 'Aún no inicia', color: '#94a3b8', bg: '#f8fafc', bucket: 'por_iniciar' },
};
const BUCKET_META: Record<Bucket, { label: string; dot: string }> = {
  atrasada: { label: 'Atrasadas', dot: 'bg-rose-500' },
  al_dia: { label: 'Al día', dot: 'bg-emerald-500' },
  por_iniciar: { label: 'Por iniciar', dot: 'bg-slate-400' },
};

const ACCENT = '#0f5c8c';
const ACCENT_LIGHT = '#e6f0f7';
const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export function monthLabel(iso: string): string {
  const [, m] = iso.split('-');
  return MESES_CORTO[Number(m) - 1] || iso;
}
export function monthLabelLong(iso: string): string {
  const [y, m] = iso.split('-');
  return `${monthLabel(iso)} ${y}`;
}

function sumRange(arr: number[], end: number): number {
  return arr.slice(0, Math.max(end, 0)).reduce((a, b) => a + b, 0);
}
function sumAll(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

export function computeMonthPosition(meses: string[]): { currentIdx: number; closedCount: number } {
  if (meses.length === 0) return { currentIdx: 0, closedCount: 0 };
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  let currentIdx = meses.findIndex((m) => m >= todayIso);
  if (currentIdx === -1) currentIdx = meses.length - 1;
  return { currentIdx, closedCount: currentIdx };
}

export function computeEstado(s: GanttSubactividad, closedCount: number, currentIdx: number): Estado {
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
  return `${fmtNum(v)}${unidad && unidad !== '%' ? ` ${unidad}` : unidad === '%' ? '%' : ''}`;
}
function fmtPct(ejec: number, meta: number): string {
  if (meta <= 0) return '0%';
  return `${Math.round((ejec / meta) * 100)}%`;
}
function pct(ejec: number, meta: number): number {
  if (meta <= 0) return 0;
  return (ejec / meta) * 100;
}
function fmtCOPCompact(v: number): string {
  return v.toLocaleString('es-CO', { style: 'currency', currency: 'COP', notation: 'compact', maximumFractionDigits: 1 });
}

// Agrupa el eje de meses (ISO "YYYY-MM...") por año consecutivo para el
// encabezado de la matriz -- a diferencia del mockup de origen (que traía
// "2026: 6 meses / 2027: 12 meses" fijo para un solo proyecto), esto se
// calcula del array real de meses de CADA hoja, sea cual sea su rango.
function groupMonthsByYear(meses: string[]): { year: string; months: string[] }[] {
  const groups: { year: string; months: string[] }[] = [];
  meses.forEach((m) => {
    const year = m.slice(0, 4);
    const last = groups[groups.length - 1];
    if (last && last.year === year) last.months.push(m);
    else groups.push({ year, months: [m] });
  });
  return groups;
}

// Contador animado (ease-out) para los números grandes de las tarjetas KPI.
const AnimatedNumber: React.FC<{ value: number; duration?: number }> = ({ value, duration = 700 }) => {
  const [displayValue, setDisplayValue] = useState(0);
  useEffect(() => {
    let startTimestamp: number | null = null;
    let raf = 0;
    const step = (timestamp: number) => {
      if (startTimestamp === null) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.round(eased * value));
      if (progress < 1) raf = window.requestAnimationFrame(step);
      else setDisplayValue(value);
    };
    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{displayValue}</>;
};

type KpiCardDef = {
  id: string;
  label: string;
  sublabel: string;
  display: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  iconBg: string;
  tone: 'neutral' | 'danger' | 'success';
  bucket: Bucket | 'todos' | null;
  progressPercent: number;
};

const KpiCards: React.FC<{
  closedCount: number;
  totalMeses: number;
  mesesCerradosPct: number;
  resumen: { total: number; actividades: number; atrasadas: number; alDia: number; porIniciar: number };
  estadoFiltro: Bucket | 'Todos';
  onFilterByBucket: (b: Bucket | 'Todos') => void;
}> = ({ closedCount, totalMeses, mesesCerradosPct, resumen, estadoFiltro, onFilterByBucket }) => {
  const cards: KpiCardDef[] = [
    {
      id: 'meses',
      label: 'Meses cerrados',
      sublabel: `${mesesCerradosPct}% del tiempo transcurrido`,
      display: (
        <>
          <AnimatedNumber value={closedCount} />
          <span className="text-base text-slate-400 font-normal"> / {totalMeses}</span>
        </>
      ),
      icon: CalendarClock,
      iconColor: 'text-blue-600',
      iconBg: 'bg-blue-50',
      tone: 'neutral',
      bucket: null,
      progressPercent: totalMeses > 0 ? (closedCount / totalMeses) * 100 : 0,
    },
    {
      id: 'subactividades',
      label: 'Subactividades',
      sublabel: `en ${resumen.actividades} actividades`,
      display: <AnimatedNumber value={resumen.total} />,
      icon: Layers,
      iconColor: 'text-slate-700',
      iconBg: 'bg-slate-100',
      tone: 'neutral',
      bucket: 'todos',
      progressPercent: 100,
    },
    {
      id: 'atrasadas',
      label: 'Atrasadas frente al plan',
      sublabel: 'requieren atención',
      display: <AnimatedNumber value={resumen.atrasadas} />,
      icon: AlertTriangle,
      iconColor: 'text-rose-600',
      iconBg: 'bg-rose-50',
      tone: 'danger',
      bucket: 'atrasada',
      progressPercent: resumen.total > 0 ? (resumen.atrasadas / resumen.total) * 100 : 0,
    },
    {
      id: 'al_dia',
      label: 'Al día o cumplidas',
      sublabel: 'adelantadas o en curso normal',
      display: <AnimatedNumber value={resumen.alDia} />,
      icon: CheckCircle2,
      iconColor: 'text-emerald-600',
      iconBg: 'bg-emerald-50',
      tone: 'success',
      bucket: 'al_dia',
      progressPercent: resumen.total > 0 ? (resumen.alDia / resumen.total) * 100 : 0,
    },
    {
      id: 'por_iniciar',
      label: 'Por iniciar',
      sublabel: 'programadas a futuro',
      display: <AnimatedNumber value={resumen.porIniciar} />,
      icon: Clock,
      iconColor: 'text-slate-500',
      iconBg: 'bg-slate-100',
      tone: 'neutral',
      bucket: 'por_iniciar',
      progressPercent: resumen.total > 0 ? (resumen.porIniciar / resumen.total) * 100 : 0,
    },
  ];

  return (
    <div className="px-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
      {cards.map((card, idx) => {
        const Icon = card.icon;
        const isClickable = card.bucket !== null;
        const isSelected = isClickable && (card.bucket === 'todos' ? estadoFiltro === 'Todos' : estadoFiltro === card.bucket);
        return (
          <motion.div
            key={card.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: idx * 0.05, ease: [0.16, 1, 0.3, 1] }}
            onClick={() => {
              if (!isClickable) return;
              onFilterByBucket(card.bucket === 'todos' ? 'Todos' : (card.bucket as Bucket));
            }}
            className={`rounded-lg p-3 border transition-all ${
              isSelected ? 'border-sky-400 ring-2 ring-sky-400/20' : 'border-slate-200 hover:border-slate-300'
            } ${isClickable ? 'cursor-pointer' : ''}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400 line-clamp-1">{card.label}</span>
              <div className={`w-6 h-6 rounded-md ${card.iconBg} flex items-center justify-center shrink-0`}>
                <Icon className={`w-3.5 h-3.5 ${card.iconColor}`} />
              </div>
            </div>
            <p className={`mt-1.5 text-xl font-extrabold tabular-nums ${card.tone === 'danger' ? 'text-rose-600' : 'text-slate-900'}`}>
              {card.display}
            </p>
            <p className="text-[10.5px] text-slate-500 mt-0.5">{card.sublabel}</p>
            <div className="mt-1.5 w-full bg-slate-100 rounded-full h-1 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  card.tone === 'danger' ? 'bg-rose-500' : card.tone === 'success' ? 'bg-emerald-500' : 'bg-sky-600'
                }`}
                style={{ width: `${Math.min(card.progressPercent, 100)}%` }}
              />
            </div>
          </motion.div>
        );
      })}
    </div>
  );
};

const ModeSwitch: React.FC<{ tipo: 'fisico' | 'financiero'; onChange: (t: 'fisico' | 'financiero') => void }> = ({ tipo, onChange }) => (
  <div className="bg-slate-100 p-1 rounded-lg border border-slate-200 flex items-center shrink-0">
    {(['fisico', 'financiero'] as const).map((t) => (
      <button
        key={t}
        type="button"
        onClick={() => onChange(t)}
        className={`relative px-3 py-1.5 text-[11px] font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
          tipo === t ? 'text-white' : 'text-slate-600 hover:text-slate-900'
        }`}
      >
        {tipo === t && (
          <motion.div
            layoutId="ganttModeIndicator"
            className="absolute inset-0 rounded-md -z-0"
            style={{ background: ACCENT }}
            transition={{ type: 'spring', stiffness: 450, damping: 35 }}
          />
        )}
        <span className="relative z-10 flex items-center gap-1.5">
          {t === 'fisico' ? <BarChart2 className="h-3 w-3" /> : <Coins className="h-3 w-3" />}
          {t === 'fisico' ? 'Físico' : 'Financiero'}
        </span>
      </button>
    ))}
  </div>
);

const FiltersBar: React.FC<{
  actividades: string[];
  actividadFiltro: string;
  onActividadFiltro: (a: string) => void;
  estadoFiltro: Bucket | 'Todos';
  onEstadoFiltro: (b: Bucket | 'Todos') => void;
  search: string;
  onSearch: (q: string) => void;
  filteredCount: number;
  totalCount: number;
}> = ({ actividades, actividadFiltro, onActividadFiltro, estadoFiltro, onEstadoFiltro, search, onSearch, filteredCount, totalCount }) => {
  const isFiltered = actividadFiltro !== 'Todas' || estadoFiltro !== 'Todos' || search.trim().length > 0;
  return (
    <div className="mx-4 rounded-lg border border-slate-200 p-3 space-y-2.5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mr-0.5">Actividad</span>
          <div className="flex items-center gap-1 bg-slate-100/80 p-0.5 rounded-lg flex-wrap">
            {['Todas', ...actividades].map((a) => {
              const isActive = actividadFiltro === a;
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => onActividadFiltro(a)}
                  className={`relative px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap ${
                    isActive ? 'text-white' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="ganttActividadIndicator"
                      className="absolute inset-0 bg-slate-900 rounded-md -z-0"
                      transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                    />
                  )}
                  <span className="relative z-10">{a === 'Contrapartida' ? a : a.replace('Actividad ', '')}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mr-0.5">Estado</span>
          <div className="flex items-center gap-1 bg-slate-100/80 p-0.5 rounded-lg">
            {(['Todos', 'atrasada', 'al_dia', 'por_iniciar'] as const).map((b) => {
              const isActive = estadoFiltro === b;
              return (
                <button
                  key={b}
                  type="button"
                  onClick={() => onEstadoFiltro(b)}
                  className={`relative px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
                    isActive ? 'text-white' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="ganttEstadoIndicator"
                      className="absolute inset-0 rounded-md -z-0"
                      style={{ background: ACCENT }}
                      transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-1.5">
                    {b !== 'Todos' && !isActive && <span className={`w-1.5 h-1.5 rounded-full ${BUCKET_META[b].dot}`} />}
                    {b === 'Todos' ? 'Todos' : BUCKET_META[b].label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-slate-100">
        <div className="relative w-full sm:w-72">
          <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Buscar por actividad o subactividad..."
            className="w-full pl-8 pr-7 py-1.5 text-[11px] border border-slate-200 rounded-lg outline-none focus:border-teal-600"
          />
          {search && (
            <button type="button" onClick={() => onSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2.5 text-[11px] text-slate-500 shrink-0">
          <span>
            Mostrando <b className="text-slate-800 tabular-nums">{filteredCount}</b> de <b className="text-slate-800 tabular-nums">{totalCount}</b> subactividades
          </span>
          {isFiltered && (
            <button
              type="button"
              onClick={() => {
                onActividadFiltro('Todas');
                onEstadoFiltro('Todos');
                onSearch('');
              }}
              className="inline-flex items-center gap-1 font-semibold hover:underline"
              style={{ color: ACCENT }}
            >
              <RotateCcw className="h-2.5 w-2.5" />
              Limpiar filtros
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const STATUS_BADGE: Record<Bucket, { label: string; Icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  atrasada: { label: 'Atrasada', Icon: AlertTriangle, cls: 'text-rose-700 bg-rose-50 border-rose-200' },
  al_dia: { label: 'Al día', Icon: CheckCircle2, cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  por_iniciar: { label: 'Por iniciar', Icon: Clock, cls: 'text-slate-600 bg-slate-100 border-slate-200' },
};

const COL1_W = 260;
const COL2_W = 84;
const COL3_W = 140;
const COL4_W = 92;

type TooltipState = { sub: GanttSubactividad; monthIdx: number; x: number; y: number };

const GanttMatrix: React.FC<{
  grupos: { actividad: string; descripcion: string; subactividades: GanttSubactividad[] }[];
  meses: string[];
  closedCount: number;
  currentIdx: number;
  collapsed: Set<string>;
  onToggleCollapsed: (actividad: string) => void;
  onSelectSub: (s: GanttSubactividad) => void;
}> = ({ grupos, meses, closedCount, currentIdx, collapsed, onToggleCollapsed, onSelectSub }) => {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const yearGroups = useMemo(() => groupMonthsByYear(meses), [meses]);

  return (
    <div className="relative mx-4 rounded-xl border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto overflow-y-auto max-h-[640px]">
        <table className="w-full text-left border-collapse" style={{ minWidth: COL1_W + COL2_W + COL3_W + COL4_W + meses.length * 56 }}>
          <thead className="sticky top-0 z-20 bg-slate-50 text-[11px] font-semibold text-slate-600 shadow-xs">
            <tr className="border-b border-slate-200 text-[10.5px] uppercase tracking-wide text-slate-400">
              <th className="sticky left-0 z-30 bg-slate-50 px-3 py-1 border-r border-slate-200" style={{ width: COL1_W, minWidth: COL1_W }}>
                Estructura del proyecto
              </th>
              <th className="sticky z-30 bg-slate-50 px-2 py-1 border-r border-slate-200" style={{ left: COL1_W, width: COL2_W, minWidth: COL2_W }} />
              <th className="sticky z-30 bg-slate-50 px-2 py-1 border-r border-slate-200" style={{ left: COL1_W + COL2_W, width: COL3_W, minWidth: COL3_W }} />
              <th
                className="sticky z-30 bg-slate-50 px-2 py-1 border-r border-slate-200 shadow-[4px_0_6px_-2px_rgba(0,0,0,0.05)]"
                style={{ left: COL1_W + COL2_W + COL3_W, width: COL4_W, minWidth: COL4_W }}
              />
              {yearGroups.map((g) => (
                <th key={g.year} colSpan={g.months.length} className="text-center py-1 border-r border-slate-200 font-bold text-slate-600">
                  {g.year} · {g.months.length} {g.months.length === 1 ? 'mes' : 'meses'}
                </th>
              ))}
            </tr>
            <tr className="border-b border-slate-200">
              <th className="sticky left-0 z-30 bg-slate-50 px-3 py-2 border-r border-slate-200" style={{ width: COL1_W, minWidth: COL1_W }}>
                Actividades y subactividades
              </th>
              <th
                className="sticky z-30 bg-slate-50 px-2 py-2 text-right border-r border-slate-200"
                style={{ left: COL1_W, width: COL2_W, minWidth: COL2_W }}
              >
                Meta
              </th>
              <th
                className="sticky z-30 bg-slate-50 px-2 py-2 text-center border-r border-slate-200"
                style={{ left: COL1_W + COL2_W, width: COL3_W, minWidth: COL3_W }}
              >
                Plan vs real
              </th>
              <th
                className="sticky z-30 bg-slate-50 px-2 py-2 text-center border-r border-slate-200 shadow-[4px_0_6px_-2px_rgba(0,0,0,0.05)]"
                style={{ left: COL1_W + COL2_W + COL3_W, width: COL4_W, minWidth: COL4_W }}
              >
                Situación
              </th>
              {meses.map((m, i) => (
                <th
                  key={m}
                  className={`px-1.5 py-2 text-center font-mono w-[56px] min-w-[56px] border-r border-slate-200/70 ${
                    i === currentIdx ? 'bg-sky-100/70 text-sky-950 font-bold' : i < closedCount ? 'bg-slate-100/60 text-slate-500' : 'text-slate-500'
                  }`}
                >
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="flex items-center gap-0.5">
                      {i < closedCount && <Lock className="w-2.5 h-2.5 text-slate-400" />}
                      {monthLabel(m)}
                    </span>
                    <span className="text-[8.5px] font-normal text-slate-400">{i === currentIdx ? 'Actual' : `M${i + 1}`}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {grupos.map((g) => {
              const isCollapsed = collapsed.has(g.actividad);
              const atrasadasEnGrupo = g.subactividades.filter((s) => ESTADO_META[computeEstado(s, closedCount, currentIdx)].bucket === 'atrasada').length;
              return (
                <React.Fragment key={g.actividad}>
                  <tr className="bg-slate-50/80 hover:bg-slate-100/70 transition-colors">
                    <td className="sticky left-0 z-10 bg-slate-50/95 px-2 py-2 border-r border-slate-200" style={{ width: COL1_W, minWidth: COL1_W }}>
                      <button type="button" onClick={() => onToggleCollapsed(g.actividad)} className="flex items-center gap-1.5 text-left w-full">
                        {isCollapsed ? <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                        <span className="text-[12.5px] font-bold text-slate-900 truncate" title={g.actividad}>
                          {g.actividad}
                        </span>
                      </button>
                    </td>
                    <td className="sticky z-10 bg-slate-50/95 px-2 py-2 border-r border-slate-200" style={{ left: COL1_W, width: COL2_W, minWidth: COL2_W }} />
                    <td
                      className="sticky z-10 bg-slate-50/95 px-2 py-2 text-center text-[10.5px] text-slate-500 border-r border-slate-200"
                      style={{ left: COL1_W + COL2_W, width: COL3_W, minWidth: COL3_W }}
                    >
                      {g.subactividades.length} subactividades
                    </td>
                    <td
                      className="sticky z-10 bg-slate-50/95 px-2 py-2 text-center border-r border-slate-200 shadow-[4px_0_6px_-2px_rgba(0,0,0,0.05)]"
                      style={{ left: COL1_W + COL2_W + COL3_W, width: COL4_W, minWidth: COL4_W }}
                    >
                      {atrasadasEnGrupo > 0 ? (
                        <span className="inline-flex items-center gap-1 text-[9.5px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded px-1 py-0.5">
                          <AlertTriangle className="w-2.5 h-2.5" />
                          {atrasadasEnGrupo}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[9.5px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1 py-0.5">
                          <CheckCircle2 className="w-2.5 h-2.5" />
                          OK
                        </span>
                      )}
                    </td>
                    {meses.map((m, i) => (
                      <td key={m} className={`border-r border-slate-200/50 ${i === currentIdx ? 'bg-sky-50/40' : ''}`} />
                    ))}
                  </tr>

                  {!isCollapsed &&
                    g.subactividades.map((s) => {
                      const estado = computeEstado(s, closedCount, currentIdx);
                      const bucket = ESTADO_META[estado].bucket;
                      const ejecCum = sumRange(s.ejecutado, closedCount);
                      const planCum = sumRange(s.plan, closedCount);
                      const pctReal = pct(ejecCum, s.meta);
                      const pctPlan = pct(planCum, s.meta);
                      const maxVal = Math.max(1, ...s.plan, ...s.ejecutado);
                      const key = `${s.actividad}||${s.subActividad}`;
                      return (
                        <tr key={key} onClick={() => onSelectSub(s)} className="hover:bg-sky-50/40 cursor-pointer transition-colors group">
                          <td className="sticky left-0 z-10 bg-white group-hover:bg-sky-50/40 px-2 py-2 border-r border-slate-200" style={{ width: COL1_W, minWidth: COL1_W }}>
                            <p className="pl-5 text-[12px] text-slate-800 font-medium leading-snug line-clamp-2" title={s.subActividad}>
                              {s.subActividad}
                            </p>
                          </td>
                          <td
                            className="sticky z-10 bg-white group-hover:bg-sky-50/40 px-2 py-2 text-right font-mono text-[10.5px] text-slate-700 border-r border-slate-200"
                            style={{ left: COL1_W, width: COL2_W, minWidth: COL2_W }}
                          >
                            {fmtValor(s.meta, s.unidad)}
                          </td>
                          <td
                            className="sticky z-10 bg-white group-hover:bg-sky-50/40 px-2 py-2 border-r border-slate-200"
                            style={{ left: COL1_W + COL2_W, width: COL3_W, minWidth: COL3_W }}
                          >
                            <div className="flex items-center justify-between text-[9.5px] font-mono tabular-nums mb-1">
                              <span className="text-slate-500">R: {fmtPct(ejecCum, s.meta)}</span>
                              <span className="text-slate-400">P: {fmtPct(planCum, s.meta)}</span>
                            </div>
                            <div className="relative w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                              <div className="absolute top-0 bottom-0 bg-slate-300 rounded-full opacity-60" style={{ width: `${Math.min(pctPlan, 100)}%` }} />
                              <div
                                className={`h-full rounded-full relative z-10 ${bucket === 'atrasada' ? 'bg-rose-500' : bucket === 'al_dia' ? 'bg-emerald-500' : 'bg-slate-400'}`}
                                style={{ width: `${Math.min(pctReal, 100)}%` }}
                              />
                            </div>
                          </td>
                          <td
                            className="sticky z-10 bg-white group-hover:bg-sky-50/40 px-1.5 py-2 text-center border-r border-slate-200 shadow-[4px_0_6px_-2px_rgba(0,0,0,0.05)]"
                            style={{ left: COL1_W + COL2_W + COL3_W, width: COL4_W, minWidth: COL4_W }}
                          >
                            {(() => {
                              const badge = STATUS_BADGE[bucket];
                              return (
                                <span className={`inline-flex items-center gap-1 text-[9.5px] font-semibold border rounded px-1 py-0.5 ${badge.cls}`}>
                                  <badge.Icon className="w-2.5 h-2.5" />
                                  {badge.label}
                                </span>
                              );
                            })()}
                          </td>
                          {s.plan.map((planVal, i) => {
                            const ejecVal = s.ejecutado[i] ?? 0;
                            const hasPlan = planVal > 0;
                            const hasEjec = ejecVal > 0;
                            const planH = hasPlan ? Math.max(3, Math.round((planVal / maxVal) * 13)) : 0;
                            const ejecH = hasEjec ? Math.max(3, Math.round((ejecVal / maxVal) * 13)) : 0;
                            return (
                              <td
                                key={i}
                                onMouseEnter={(e) => {
                                  if (!hasPlan && !hasEjec) return;
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setTooltip({ sub: s, monthIdx: i, x: rect.left + rect.width / 2, y: rect.top });
                                }}
                                onMouseLeave={() => setTooltip(null)}
                                className={`px-1 py-1.5 border-r border-slate-200/50 ${i === currentIdx ? 'bg-sky-50/50' : i < closedCount ? 'bg-slate-50/40' : ''}`}
                              >
                                {hasPlan || hasEjec ? (
                                  <div className="flex items-end justify-center gap-0.5" style={{ height: 14 }}>
                                    <div className="w-1.5 rounded-sm bg-slate-300" style={{ height: planH }} />
                                    <div className={`w-1.5 rounded-sm ${ejecVal >= planVal ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{ height: ejecH }} />
                                  </div>
                                ) : (
                                  <span className="text-[9px] text-slate-200 select-none block text-center">-</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none -translate-x-1/2 -translate-y-full mb-2 bg-slate-900 text-white rounded-lg p-2.5 text-[11px] shadow-xl max-w-xs"
          style={{ left: tooltip.x, top: tooltip.y - 6 }}
        >
          <p className="font-semibold text-sky-400 border-b border-slate-700 pb-1 mb-1">
            {tooltip.sub.subActividad} · {monthLabelLong(meses[tooltip.monthIdx])}
          </p>
          <div className="grid grid-cols-2 gap-2 tabular-nums">
            <div>
              <span className="text-slate-400 block text-[9px] uppercase">Plan</span>
              <span className="text-white font-semibold">{fmtValor(tooltip.sub.plan[tooltip.monthIdx] ?? 0, tooltip.sub.unidad)}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[9px] uppercase">Ejecutado</span>
              <span className="font-semibold text-emerald-400">{fmtValor(tooltip.sub.ejecutado[tooltip.monthIdx] ?? 0, tooltip.sub.unidad)}</span>
            </div>
          </div>
        </div>
      )}

      <div className="bg-slate-50 border-t border-slate-200 px-3 py-2 flex flex-wrap items-center justify-between gap-2.5 text-[10.5px] text-slate-500">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-2 rounded-sm bg-slate-300" />
            Plan
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-2 rounded-sm bg-emerald-500" />
            Ejecutado al día
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-2 rounded-sm bg-rose-500" />
            Ejecutado con retraso
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-sky-200 border border-sky-400" />
            Mes actual
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Info className="w-3 h-3" />
          <span>Clic en una fila para ver el detalle</span>
        </div>
      </div>
    </div>
  );
};

const SubactivityDetailModal: React.FC<{
  sub: GanttSubactividad | null;
  meses: string[];
  closedCount: number;
  currentIdx: number;
  onClose: () => void;
}> = ({ sub, meses, closedCount, currentIdx, onClose }) => {
  const [tab, setTab] = useState<'cronograma' | 'desviacion'>('cronograma');

  useEffect(() => {
    setTab('cronograma');
  }, [sub]);

  if (!sub) return null;

  const estado = computeEstado(sub, closedCount, currentIdx);
  const estadoMeta = ESTADO_META[estado];
  const bucket = estadoMeta.bucket;
  const ejecCum = sumRange(sub.ejecutado, closedCount);
  const planCum = sumRange(sub.plan, closedCount);
  const pctReal = pct(ejecCum, sub.meta);
  const pctPlan = pct(planCum, sub.meta);
  const desviacion = Math.round((pctReal - pctPlan) * 10) / 10;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs"
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="relative bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden flex flex-col max-h-[88vh] z-10"
        >
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/80 flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-mono text-slate-500">{sub.actividad}</p>
              <h3 className="text-sm sm:text-base font-bold text-slate-900 leading-snug mt-0.5">{sub.subActividad}</h3>
            </div>
            <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3.5 bg-slate-100/60 border-b border-slate-200 text-xs">
            <div className="bg-white p-2.5 rounded-lg border border-slate-200/80">
              <span className="text-[9.5px] text-slate-400 uppercase font-semibold block">Meta</span>
              <span className="text-sm font-extrabold text-slate-900 font-mono">{fmtValor(sub.meta, sub.unidad)}</span>
            </div>
            <div className="bg-white p-2.5 rounded-lg border border-slate-200/80">
              <span className="text-[9.5px] text-slate-400 uppercase font-semibold block">Avance acumulado</span>
              <div className="flex items-baseline gap-1">
                <span className="text-sm font-extrabold text-slate-900 font-mono">{pctReal.toFixed(0)}%</span>
                <span className="text-[10px] text-slate-400 font-mono">/ plan {pctPlan.toFixed(0)}%</span>
              </div>
            </div>
            <div className="bg-white p-2.5 rounded-lg border border-slate-200/80">
              <span className="text-[9.5px] text-slate-400 uppercase font-semibold block">Situación</span>
              <span className="inline-flex items-center gap-1 text-[10.5px] font-bold rounded px-1.5 py-0.5 mt-0.5" style={{ color: estadoMeta.color, background: estadoMeta.bg }}>
                {estadoMeta.label}
              </span>
            </div>
            <div className="bg-white p-2.5 rounded-lg border border-slate-200/80">
              <span className="text-[9.5px] text-slate-400 uppercase font-semibold block">Desviación</span>
              <span className={`text-sm font-extrabold font-mono ${desviacion < 0 ? 'text-rose-600' : desviacion > 0 ? 'text-emerald-600' : 'text-slate-900'}`}>
                {desviacion > 0 ? '+' : ''}
                {desviacion.toFixed(1)}%
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1 px-5 pt-2.5 border-b border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => setTab('cronograma')}
              className={`pb-2 px-2.5 text-xs font-semibold border-b-2 transition-colors ${tab === 'cronograma' ? 'text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
              style={tab === 'cronograma' ? { borderColor: ACCENT } : {}}
            >
              Cronograma mensual
            </button>
            <button
              type="button"
              onClick={() => setTab('desviacion')}
              className={`pb-2 px-2.5 text-xs font-semibold border-b-2 transition-colors ${tab === 'desviacion' ? 'text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
              style={tab === 'desviacion' ? { borderColor: ACCENT } : {}}
            >
              Desviación
            </button>
          </div>

          <div className="p-5 overflow-y-auto flex-1">
            {tab === 'cronograma' && (
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200 text-[10.5px]">
                    <tr>
                      <th className="py-2 px-3">Mes</th>
                      <th className="py-2 px-3 text-center">Estado</th>
                      <th className="py-2 px-3 text-right">Plan</th>
                      <th className="py-2 px-3 text-right">Ejecutado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono">
                    {meses.map((m, i) => {
                      const planVal = sub.plan[i] ?? 0;
                      const ejecVal = sub.ejecutado[i] ?? 0;
                      const isCurrent = i === currentIdx;
                      const hasValues = planVal > 0 || ejecVal > 0;
                      return (
                        <tr key={m} className={isCurrent ? 'bg-sky-50/70 font-semibold' : !hasValues ? 'text-slate-400' : 'text-slate-700'}>
                          <td className="py-1.5 px-3 flex items-center gap-1.5">
                            {i < closedCount && <Lock className="w-2.5 h-2.5 text-slate-400" />}
                            {monthLabelLong(m)}
                          </td>
                          <td className="py-1.5 px-3 text-center text-[9.5px]">
                            {isCurrent ? (
                              <span className="bg-sky-200 text-sky-900 px-1.5 py-0.5 rounded font-bold">Actual</span>
                            ) : i < closedCount ? (
                              <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">Cerrado</span>
                            ) : (
                              <span className="text-slate-300">Pendiente</span>
                            )}
                          </td>
                          <td className="py-1.5 px-3 text-right tabular-nums">{planVal > 0 ? fmtValor(planVal, sub.unidad) : '-'}</td>
                          <td className={`py-1.5 px-3 text-right tabular-nums font-semibold ${ejecVal > 0 ? (ejecVal >= planVal ? 'text-emerald-600' : 'text-rose-600') : ''}`}>
                            {ejecVal > 0 ? fmtValor(ejecVal, sub.unidad) : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {tab === 'desviacion' && (
              <div
                className={`p-4 rounded-xl border text-xs leading-relaxed ${
                  bucket === 'atrasada' ? 'bg-rose-50/60 border-rose-200 text-rose-950' : bucket === 'al_dia' ? 'bg-emerald-50/60 border-emerald-200 text-emerald-950' : 'bg-slate-50 border-slate-200 text-slate-900'
                }`}
              >
                <h4 className="font-bold flex items-center gap-2 mb-1.5">
                  {bucket === 'atrasada' ? (
                    <>
                      <AlertTriangle className="w-4 h-4 text-rose-600" />
                      Desviación negativa frente al plan
                    </>
                  ) : bucket === 'al_dia' ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      En cronograma normal
                    </>
                  ) : (
                    <>
                      <Clock className="w-4 h-4 text-slate-500" />
                      Aún no inicia
                    </>
                  )}
                </h4>
                <p>
                  Acumulado ejecutado de {fmtValor(ejecCum, sub.unidad)} ({pctReal.toFixed(0)}%) frente a un plan de {fmtValor(planCum, sub.unidad)} ({pctPlan.toFixed(0)}%) hasta{' '}
                  {closedCount > 0 ? monthLabelLong(meses[closedCount - 1]) : 'el inicio del proyecto'}.{' '}
                  {desviacion < 0
                    ? `Brecha de ${Math.abs(desviacion).toFixed(1)} puntos porcentuales por debajo de lo programado.`
                    : desviacion > 0
                    ? `${desviacion.toFixed(1)} puntos porcentuales por encima de lo programado.`
                    : 'Ejecución exactamente en línea con lo programado.'}
                </p>
              </div>
            )}
          </div>

          <div className="p-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-end">
            <button type="button" onClick={onClose} className="px-3.5 py-1.5 text-xs font-bold text-white rounded-lg" style={{ background: '#1e293b' }}>
              Cerrar
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export const SeguimientoGanttMensual: React.FC<{ seguimientoId: number; lastImportAt: string | null }> = ({ seguimientoId, lastImportAt }) => {
  const [data, setData] = useState<GanttData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tipo, setTipo] = useState<'fisico' | 'financiero'>('fisico');
  const [actividadFiltro, setActividadFiltro] = useState<string>('Todas');
  const [estadoFiltro, setEstadoFiltro] = useState<Bucket | 'Todos'>('Todos');
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showAvancePorMes, setShowAvancePorMes] = useState(false);
  const [selectedSub, setSelectedSub] = useState<GanttSubactividad | null>(null);

  useEffect(() => {
    setIsLoading(true);
    setData(null);
    setActividadFiltro('Todas');
    setEstadoFiltro('Todos');
    setSearch('');
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
      if (!seen.has(s.actividad)) {
        seen.add(s.actividad);
        list.push(s.actividad);
      }
    });
    return list;
  }, [data]);

  const estadoPorSub = useMemo(() => {
    const map = new Map<string, Estado>();
    activeList.forEach((s) => map.set(s.actividad + '||' + s.subActividad, computeEstado(s, closedCount, currentIdx)));
    return map;
  }, [activeList, closedCount, currentIdx]);

  const resumen = useMemo(() => {
    let atrasadas = 0,
      alDia = 0,
      porIniciar = 0;
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
    const q = search.trim().toLowerCase();
    const byActividad = new Map<string, { actividad: string; descripcion: string; subactividades: GanttSubactividad[] }>();
    activeList.forEach((s) => {
      if (actividadFiltro !== 'Todas' && s.actividad !== actividadFiltro) return;
      const estado = estadoPorSub.get(s.actividad + '||' + s.subActividad);
      const bucket = estado ? ESTADO_META[estado].bucket : null;
      if (estadoFiltro !== 'Todos' && bucket !== estadoFiltro) return;
      if (q && !s.subActividad.toLowerCase().includes(q) && !s.actividad.toLowerCase().includes(q)) return;
      if (!byActividad.has(s.actividad)) byActividad.set(s.actividad, { actividad: s.actividad, descripcion: s.descripcion, subactividades: [] });
      byActividad.get(s.actividad)!.subactividades.push(s);
    });
    return Array.from(byActividad.values());
  }, [activeList, actividadFiltro, estadoFiltro, estadoPorSub, search]);

  const filteredCount = useMemo(() => grupos.reduce((acc, g) => acc + g.subactividades.length, 0), [grupos]);

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
      <div className="p-4 flex flex-wrap items-start justify-between gap-3 border-b border-slate-200/80">
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
          {data.financiero && <ModeSwitch tipo={tipo} onChange={setTipo} />}
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sky-50/80 border border-sky-200/80 text-[11px] text-sky-900 font-medium">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-sky-600" />
            </span>
            <span className="font-mono tabular-nums">
              Hoy: {monthLabelLong(meses[currentIdx])} · mes {currentIdx + 1} de {meses.length}
            </span>
          </span>
        </div>
      </div>

      <KpiCards
        closedCount={closedCount}
        totalMeses={meses.length}
        mesesCerradosPct={mesesCerradosPct}
        resumen={resumen}
        estadoFiltro={estadoFiltro}
        onFilterByBucket={setEstadoFiltro}
      />

      {tipo === 'financiero' && data.resumenFinanciero && (
        <div className="mx-4 mt-3 rounded-lg border border-slate-200 p-3.5" style={{ background: ACCENT_LIGHT }}>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: ACCENT }}>
            Avance financiero general del proyecto
          </p>
          <p className="text-[10.5px] text-slate-500 mt-0.5">
            Acumulado a {monthLabelLong(meses[closedCount > 0 ? closedCount - 1 : 0])} (último mes cerrado), sobre un presupuesto total de {fmtCOPCompact(data.resumenFinanciero.totalPlanificado)}.
          </p>
          <div className="mt-2.5 grid grid-cols-2 gap-3">
            {(() => {
              const idx = Math.max(closedCount - 1, 0);
              const ejec = data.resumenFinanciero!.ejecutadoAcumulado[idx] ?? 0;
              const plan = data.resumenFinanciero!.planificadoAcumulado[idx] ?? 0;
              const total = data.resumenFinanciero!.totalPlanificado;
              const pctEjec = total > 0 ? (ejec / total) * 100 : 0;
              const pctPlan = total > 0 ? (plan / total) * 100 : 0;
              return (
                <>
                  <div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-[11px] font-semibold text-slate-600">Ejecutado</span>
                      <span className="text-[11px] font-bold text-slate-800">
                        {pctEjec.toFixed(1)}% · {fmtCOPCompact(ejec)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-white/70 overflow-hidden mt-1">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(pctEjec, 100)}%`, background: '#34a06a' }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-[11px] font-semibold text-slate-600">Planificado</span>
                      <span className="text-[11px] font-bold text-slate-800">
                        {pctPlan.toFixed(1)}% · {fmtCOPCompact(plan)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-white/70 overflow-hidden mt-1">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(pctPlan, 100)}%`, background: ACCENT }} />
                    </div>
                  </div>
                </>
              );
            })()}
          </div>

          <button type="button" onClick={() => setShowAvancePorMes((v) => !v)} className="mt-2.5 inline-flex items-center gap-1 text-[10.5px] font-semibold" style={{ color: ACCENT }}>
            {showAvancePorMes ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {showAvancePorMes ? 'Ocultar detalle mes a mes' : 'Ver detalle mes a mes'}
          </button>

          {showAvancePorMes && (
            <div className="mt-2 overflow-x-auto">
              <table className="text-[10.5px] border-collapse" style={{ minWidth: meses.length * 56 }}>
                <thead>
                  <tr>
                    <th className="text-left font-semibold text-slate-500 pr-2 pb-1 sticky left-0" style={{ background: ACCENT_LIGHT }} />
                    {meses.map((m, i) => (
                      <th key={m} className="text-right font-semibold pb-1 px-1.5" style={i === closedCount - 1 ? { color: ACCENT } : { color: '#94a3b8' }}>
                        {monthLabel(m)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      { label: 'Planificado %', arr: data.resumenFinanciero.planificadoAcumulado, color: ACCENT },
                      { label: 'Ejecutado %', arr: data.resumenFinanciero.ejecutadoAcumulado, color: '#34a06a' },
                    ] as const
                  ).map((fila) => (
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

      <div className="mt-3">
        <FiltersBar
          actividades={actividades}
          actividadFiltro={actividadFiltro}
          onActividadFiltro={setActividadFiltro}
          estadoFiltro={estadoFiltro}
          onEstadoFiltro={setEstadoFiltro}
          search={search}
          onSearch={setSearch}
          filteredCount={filteredCount}
          totalCount={activeList.length}
        />
      </div>

      <div className="mt-3 mb-4">
        {grupos.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-8">No hay subactividades con ese filtro.</p>
        ) : (
          <GanttMatrix
            grupos={grupos}
            meses={meses}
            closedCount={closedCount}
            currentIdx={currentIdx}
            collapsed={collapsed}
            onToggleCollapsed={toggleCollapsed}
            onSelectSub={setSelectedSub}
          />
        )}
      </div>

      <p className="px-4 pb-4 text-[10.5px] text-slate-400">
        Fuente: hoja GANTT {tipo === 'financiero' ? 'FINANCIERO' : 'FÍSICO'}
        {lastImportAt ? `, importado el ${new Date(lastImportAt).toLocaleString('es-CO')}` : ''}. El estado compara lo ejecutado con lo programado hasta el último mes cerrado.
      </p>

      <SubactivityDetailModal sub={selectedSub} meses={meses} closedCount={closedCount} currentIdx={currentIdx} onClose={() => setSelectedSub(null)} />
    </div>
  );
};
