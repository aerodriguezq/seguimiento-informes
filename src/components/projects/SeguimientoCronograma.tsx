import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarRange, RefreshCw, AlertTriangle, Settings, Save, Search } from 'lucide-react';

function extractSheetIds(input: string): { spreadsheetId: string; gid: string } | null {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) {
    const gidMatch = trimmed.match(/[?#&]gid=(\d+)/);
    return { spreadsheetId: urlMatch[1], gid: gidMatch ? gidMatch[1] : '0' };
  }
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) return { spreadsheetId: trimmed, gid: '0' };
  return null;
}

type Pista = {
  lineaProductiva: string;
  pista: string;
  fechaInicio: string | null;
  fechaFin: string | null;
  cantidadTotal: number;
  cantidadEntregada: number;
  toneladasTotal: number | null;
  hectareas: number | null;
};
type Proyeccion = {
  fechaInicio: string | null;
  fechaFin: string | null;
  diasEntrega: number | null;
  beneficiariosPorDia: number | null;
  totalToneladasKit: number | null;
};
type SeguimientoRow = {
  id: number;
  subActividad: string;
  concepto: string;
  totalToneladas: number | null;
  isResumen: boolean;
  lineaProductiva: string | null;
  pistas: Pista[];
  proyeccion: Proyeccion | null;
};
type Kpi = { total: number; avance: number };
type SeguimientoData = {
  config: { spreadsheetId: string; cronogramaGid: string; lastImportAt: string | null; lastError: string | null } | null;
  kpis: Record<string, Kpi>;
  rows: SeguimientoRow[];
};

type LogEntry = { time: string; message: string; tone: 'info' | 'success' | 'error' };

// Paleta calcada del dashboard original (reference/Juan/appscript/Index.html).
const ACCENT = '#0f5c8c';
const ACCENT_LIGHT = '#e6f0f7';
const BORDER = '#e1e5ea';
const MUTED = '#6b7280';

const KPI_META: { key: string; label: string; icon: string; color: string; bg: string }[] = [
  { key: 'insumo', label: 'Insumo', icon: '📦', color: '#2563eb', bg: '#eff6ff' },
  { key: 'abono', label: 'Abono', icon: '🌱', color: '#10b981', bg: '#ecfdf5' },
  { key: 'material_vegetal', label: 'Material Vegetal', icon: '🌿', color: '#d97706', bg: '#fffbeb' },
];

// Mismos colores que .tl-seg.tl-* en el original: compra (azul oscuro, texto blanco), entrega
// (azul claro), entrega de insumos real (verde claro); abono, material vegetal y la proyección
// comparten el mismo amarillo — ahí el original distingue por el texto de la fila, no por color.
const PISTA_META: Record<string, { label: string; color: string; darkText: boolean }> = {
  proveeduria_compra: { label: 'Compra', color: ACCENT, darkText: false },
  proveeduria_entrega: { label: 'Entrega', color: '#a9c9e8', darkText: true },
  entrega_insumos: { label: 'Entrega de Insumos', color: '#a3d9a5', darkText: true },
  entrega_abono: { label: 'Entrega Abono', color: '#f5d76e', darkText: true },
  entrega_material_vegetal: { label: 'Entrega Material Vegetal', color: '#f5d76e', darkText: true },
};
const PROYECCION_META = { label: 'Proyección Entrega de Insumos', color: '#f5d76e', darkText: true };

const FILTERS: { key: string; label: string }[] = [
  { key: 'proveeduria', label: 'Proveeduría' },
  { key: 'proyeccion', label: 'Proyección Entrega de Insumos' },
  { key: 'entrega_insumos', label: 'Entrega de Insumos' },
  { key: 'entrega_abono', label: 'Entrega Abono' },
  { key: 'entrega_material_vegetal', label: 'Entrega Material Vegetal' },
];

// Ancho fijo en px de cada día en la línea de tiempo — igual que DAY_W en el original, para que
// el "rayado" diagonal de cada tramo (una franja por día) se vea igual.
const DAY_W = 26;
const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayIndexOf(days: string[], iso: string): number {
  return days.indexOf(iso);
}

// El eje de días es COMPARTIDO por todas las tarjetas (igual que buildTimelineShared en el
// original): se calcula una sola vez, desde la fecha más temprana hasta la más tardía de TODO el
// proyecto, y cada fila solo posiciona sus propios tramos sobre ese mismo eje.
function buildSharedDays(rows: SeguimientoRow[]): string[] {
  const dates: string[] = [];
  rows.forEach((r) => {
    r.pistas.forEach((p) => {
      if (p.fechaInicio) dates.push(p.fechaInicio);
      if (p.fechaFin) dates.push(p.fechaFin);
    });
    if (r.proyeccion?.fechaInicio) dates.push(r.proyeccion.fechaInicio);
    if (r.proyeccion?.fechaFin) dates.push(r.proyeccion.fechaFin);
  });
  if (dates.length === 0) return [];
  const min = dates.reduce((a, b) => (a < b ? a : b));
  const max = dates.reduce((a, b) => (a > b ? a : b));
  const days: string[] = [];
  let cursor = min;
  // Tope de seguridad: no más de ~6 años de eje, por si algún dato viene corrupto.
  let guard = 0;
  while (cursor <= max && guard < 2200) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
    guard++;
  }
  return days;
}

function fmtTon(v: number | null): string {
  const n = Number(v);
  return v === null || !Number.isFinite(n) ? '' : `${n.toFixed(1)} t`;
}

export const SeguimientoCronograma: React.FC<{ projectId: string; isAdmin: boolean; standalone?: boolean }> = ({
  projectId,
  isAdmin,
  standalone = false,
}) => {
  const [data, setData] = useState<SeguimientoData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [isEditingConfig, setIsEditingConfig] = useState(false);
  const [sheetInput, setSheetInput] = useState('');
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set(FILTERS.map((f) => f.key)));

  const pushLog = (message: string, tone: LogEntry['tone']) => {
    const time = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLog((prev) => [{ time, message, tone }, ...prev].slice(0, 5));
  };

  const fetchData = async () => {
    try {
      const res = await fetch(`/api/projects?seguimiento=cronograma&projectId=${encodeURIComponent(projectId)}`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.errors?.[0] || 'No fue posible cargar el seguimiento.');
      setData(payload.data);
    } catch (err) {
      pushLog(err instanceof Error ? err.message : 'No fue posible cargar el seguimiento.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setIsLoading(true);
    setData(null);
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const handleImport = async () => {
    setIsImporting(true);
    pushLog('Leyendo la hoja de cálculo conectada (Cronograma, Insumos, Abono, Material Vegetal, Beneficiarios...)...', 'info');
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'importCronograma', projectId: Number(projectId) }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.errors?.[0] || 'No fue posible importar el seguimiento.');
      pushLog(`Importado: ${payload.data.rowsImported} fila(s), ${payload.data.lineasDetectadas} línea(s) productiva(s).`, 'success');
      await fetchData();
    } catch (err) {
      pushLog(err instanceof Error ? err.message : 'No fue posible importar el seguimiento.', 'error');
    } finally {
      setIsImporting(false);
    }
  };

  const handleSaveConfig = async () => {
    const ids = extractSheetIds(sheetInput);
    if (!ids) {
      pushLog('Pega el link completo de la hoja de cálculo (o solo su ID).', 'error');
      return;
    }
    setIsSavingConfig(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'seguimientoConfig', projectId: Number(projectId), spreadsheetId: ids.spreadsheetId, cronogramaGid: ids.gid }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.errors?.[0] || 'No fue posible guardar la hoja de cálculo.');
      pushLog('Hoja de cálculo configurada. Ahora puedes importar.', 'success');
      setIsEditingConfig(false);
      setSheetInput('');
      await fetchData();
    } catch (err) {
      pushLog(err instanceof Error ? err.message : 'No fue posible guardar la hoja de cálculo.', 'error');
    } finally {
      setIsSavingConfig(false);
    }
  };

  const toggleFilter = (key: string) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const filteredRows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.rows;
    return data.rows.filter((r) => r.subActividad.toLowerCase().includes(q) || r.concepto.toLowerCase().includes(q));
  }, [data, search]);

  const sharedDays = useMemo(() => (data ? buildSharedDays(data.rows) : []), [data]);

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 text-center text-xs text-slate-400">
        Cargando seguimiento...
      </div>
    );
  }

  // Sin configuración: dentro del Detalle de Proyecto no molestamos a quien no es admin con
  // nada; en la página dedicada de Seguimiento sí decimos algo, para no dejarla en blanco.
  if (!data?.config) {
    if (!isAdmin) {
      if (!standalone) return null;
      return (
        <div className="py-10 text-center text-xs text-slate-400 border-2 border-dashed border-slate-200 rounded-xl">
          Este proyecto no tiene un cronograma de Seguimiento configurado todavía.
        </div>
      );
    }
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg shrink-0" style={{ background: ACCENT_LIGHT, color: ACCENT }}>
            <CalendarRange className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Cronograma de Entregas · Consolidado de Insumos</h3>
            <p className="text-[11px] text-slate-500">Este proyecto no tiene una hoja de cálculo vinculada todavía.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-64">
            <label htmlFor="seguimiento-sheet-link-new" className="block text-[11px] font-semibold text-slate-700 mb-1">
              Link de Google Sheets (pestaña del cronograma)
            </label>
            <input
              id="seguimiento-sheet-link-new"
              type="text"
              value={sheetInput}
              onChange={(e) => setSheetInput(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/.../edit?gid=..."
              className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-teal-600"
            />
          </div>
          <button
            type="button"
            onClick={handleSaveConfig}
            disabled={isSavingConfig || !sheetInput.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-lg disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {isSavingConfig ? 'Guardando...' : 'Vincular hoja'}
          </button>
        </div>
        {log.length > 0 && (
          <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 space-y-1 font-mono text-[10.5px]">
            {log.map((entry, idx) => (
              <p key={idx} className={entry.tone === 'error' ? 'text-rose-600' : entry.tone === 'success' ? 'text-emerald-700' : 'text-slate-500'}>
                {entry.message}
              </p>
            ))}
          </div>
        )}
      </div>
    );
  }

  const hasData = data.rows.length > 0;

  return (
    <div id="project-seguimiento-cronograma" className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg shrink-0" style={{ background: ACCENT_LIGHT, color: ACCENT }}>
            <CalendarRange className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Cronograma de Entregas · Consolidado de Insumos</h3>
            <p className="text-[11px] text-slate-500">
              {data.config.lastImportAt
                ? `Última importación: ${new Date(data.config.lastImportAt).toLocaleString('es-CO')}`
                : 'Aún no se ha importado desde Google Sheets.'}
            </p>
          </div>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsEditingConfig((v) => !v)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50 rounded-lg"
            >
              <Settings className="h-3.5 w-3.5" />
              Cambiar hoja
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={isImporting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white rounded-lg disabled:opacity-50"
              style={{ background: ACCENT }}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isImporting ? 'animate-spin' : ''}`} />
              {isImporting ? 'Importando...' : 'Importar desde Google Sheets'}
            </button>
          </div>
        )}
      </div>

      {isAdmin && isEditingConfig && (
        <div className="mx-4 mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 border border-slate-100 p-3">
          <div className="flex-1 min-w-64">
            <label htmlFor="seguimiento-sheet-link-edit" className="block text-[11px] font-semibold text-slate-700 mb-1">
              Nuevo link de Google Sheets (pestaña del cronograma)
            </label>
            <input
              id="seguimiento-sheet-link-edit"
              type="text"
              value={sheetInput}
              onChange={(e) => setSheetInput(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/.../edit?gid=..."
              className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-teal-600"
            />
            <p className="mt-1 text-[10.5px] text-slate-500 font-mono">
              Actual: {data.config.spreadsheetId} · gid {data.config.cronogramaGid}
            </p>
          </div>
          <button
            type="button"
            onClick={handleSaveConfig}
            disabled={isSavingConfig || !sheetInput.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-lg disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {isSavingConfig ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      )}

      {data.config.lastError && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg bg-rose-50 border border-rose-100 px-3 py-2 text-xs text-rose-700">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{data.config.lastError}</span>
        </div>
      )}

      {isAdmin && log.length > 0 && (
        <div className="mx-4 mt-3 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 space-y-1 font-mono text-[10.5px] max-h-24 overflow-y-auto">
          {log.map((entry, idx) => (
            <p key={idx} className={entry.tone === 'error' ? 'text-rose-600' : entry.tone === 'success' ? 'text-emerald-700' : 'text-slate-500'}>
              <span className="text-slate-400">[{entry.time}]</span> {entry.message}
            </p>
          ))}
        </div>
      )}

      {!hasData ? (
        <div className="p-4">
          <div className="py-8 text-center text-xs text-slate-400 border-2 border-dashed border-slate-200 rounded-xl">
            Sin datos importados todavía. {isAdmin ? 'Usa "Importar desde Google Sheets" para traer el seguimiento.' : ''}
          </div>
        </div>
      ) : (
        <>
          {/* Tarjetas de % de avance */}
          <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {KPI_META.map((meta) => {
              const kpi = data.kpis[meta.key];
              const kpiTotal = Number(kpi?.total);
              const kpiAvance = Number(kpi?.avance);
              if (!kpi || !Number.isFinite(kpiTotal) || kpiTotal === 0) return null;
              const pct = Math.round((kpiAvance / kpiTotal) * 1000) / 10;
              return (
                <div key={meta.key} className="rounded-xl p-4" style={{ borderTop: `4px solid ${meta.color}`, boxShadow: '0 1px 2px rgba(15,23,42,0.06)' }}>
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>{meta.label}</span>
                    <span className="rounded-lg px-2 py-1 text-sm leading-none" style={{ background: meta.bg, color: meta.color }}>{meta.icon}</span>
                  </div>
                  <p className="text-[26px] font-extrabold text-slate-800 leading-none">{pct.toFixed(1)}%</p>
                  <p className="text-[11px] mt-0.5" style={{ color: MUTED }}>Porcentaje de avance general</p>
                  <div className="mt-3.5">
                    <div className="flex items-center justify-between text-[11px] mb-1" style={{ color: '#4b5563' }}>
                      <span>Beneficiarios</span>
                      <b className="text-slate-800">{kpi.avance} / {kpi.total}</b>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, background: meta.color }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Filtros + búsqueda */}
          <div className="px-4 pb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {FILTERS.map((f) => (
              <label key={f.key} className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={activeFilters.has(f.key)}
                  onChange={() => toggleFilter(f.key)}
                  className="rounded"
                  style={{ accentColor: ACCENT }}
                />
                {f.label}
              </label>
            ))}
            <div className="relative ml-auto w-full sm:w-56">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por sub actividad o concepto..."
                className="w-full pl-7 pr-2 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-teal-600"
              />
            </div>
          </div>

          <div className="p-4 pt-0 space-y-2.5">
            {filteredRows.map((row) => (
              <SeguimientoRowCard key={row.id} row={row} activeFilters={activeFilters} days={sharedDays} />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

type Segment = { start: string; end: string; segLabel: string; color: string; darkText: boolean };
type Track = { key: string; label: string; segments: Segment[]; badge: string };

const SeguimientoRowCard: React.FC<{ row: SeguimientoRow; activeFilters: Set<string>; days: string[] }> = ({ row, activeFilters, days }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [monthLabel, setMonthLabel] = useState('');

  const tracks: Track[] = [];

  if (activeFilters.has('proveeduria')) {
    const compra = row.pistas.find((p) => p.pista === 'proveeduria_compra');
    const entrega = row.pistas.find((p) => p.pista === 'proveeduria_entrega');
    if ((compra && compra.fechaInicio) || (entrega && entrega.fechaInicio)) {
      const segments: Segment[] = [];
      if (compra?.fechaInicio && compra.fechaFin) {
        segments.push({ start: compra.fechaInicio, end: compra.fechaFin, segLabel: 'Compra', color: PISTA_META.proveeduria_compra.color, darkText: false });
      }
      if (entrega?.fechaInicio && entrega.fechaFin) {
        segments.push({ start: entrega.fechaInicio, end: entrega.fechaFin, segLabel: 'Entrega', color: PISTA_META.proveeduria_entrega.color, darkText: true });
      }
      const total = entrega?.cantidadTotal ?? compra?.cantidadTotal ?? 0;
      const entregado = entrega?.cantidadEntregada ?? compra?.cantidadEntregada ?? 0;
      tracks.push({ key: 'proveeduria', label: 'Proveeduría', segments, badge: `${total}/${entregado} insumos` });
    }
  }

  if (activeFilters.has('proyeccion') && row.proyeccion?.fechaInicio && row.proyeccion.fechaFin) {
    const p = row.proyeccion;
    tracks.push({
      key: 'proyeccion',
      label: PROYECCION_META.label,
      segments: [{ start: p.fechaInicio as string, end: p.fechaFin as string, segLabel: 'Entrega insumos', color: PROYECCION_META.color, darkText: PROYECCION_META.darkText }],
      badge: p.beneficiariosPorDia ? `${p.beneficiariosPorDia} benef./día` : '',
    });
  }

  const SEG_LABELS: Record<string, string> = {
    entrega_insumos: 'Entrega insumos programada',
    entrega_abono: 'Abono programado',
    entrega_material_vegetal: 'Material Vegetal programado',
  };
  (['entrega_insumos', 'entrega_abono', 'entrega_material_vegetal'] as const).forEach((key) => {
    if (!activeFilters.has(key)) return;
    const pista = row.pistas.find((p) => p.pista === key);
    if (!pista || !pista.fechaInicio || !pista.fechaFin) return;
    const meta = PISTA_META[key];
    const badgeParts: string[] = [];
    const toneladas = Number(pista.toneladasTotal);
    if (pista.toneladasTotal !== null && Number.isFinite(toneladas)) badgeParts.push(`${toneladas.toFixed(1)}t`);
    badgeParts.push(`${pista.cantidadEntregada}/${pista.cantidadTotal}`);
    tracks.push({
      key,
      label: meta.label,
      segments: [{ start: pista.fechaInicio, end: pista.fechaFin, segLabel: SEG_LABELS[key], color: meta.color, darkText: meta.darkText }],
      badge: badgeParts.join(' · '),
    });
  });

  const hasTimeline = tracks.length > 0 && days.length > 0;
  const totalW = days.length * DAY_W;
  const todayIso = new Date().toISOString().slice(0, 10);
  const todayIdx = dayIndexOf(days, todayIso);

  const updateMonthLabel = () => {
    const el = scrollRef.current;
    if (!el || days.length === 0) return;
    const idx = Math.min(days.length - 1, Math.max(0, Math.round((el.scrollLeft + el.clientWidth / 2) / DAY_W)));
    const iso = days[idx];
    const m = parseInt(iso.slice(5, 7), 10) - 1;
    setMonthLabel(`${MESES_ES[m]} ${iso.slice(0, 4)}`);
  };

  useEffect(() => {
    if (!hasTimeline) return;
    const el = scrollRef.current;
    if (!el) return;
    if (todayIdx !== -1) {
      el.scrollLeft = Math.max(0, todayIdx * DAY_W - el.clientWidth / 2);
    }
    updateMonthLabel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasTimeline, row.id]);

  const scrollByMonth = (dir: 1 | -1) => {
    scrollRef.current?.scrollBy({ left: dir * 30 * DAY_W, behavior: 'auto' });
    window.setTimeout(updateMonthLabel, 0);
  };

  // Franjas de fin de semana + líneas divisorias de mes — se calculan una vez por tarjeta (el eje
  // "days" ya es compartido entre todas, así que el patrón visual es idéntico fila a fila).
  const dayTicks = useMemo(() => {
    if (!hasTimeline) return { dayCells: [] as React.ReactNode[], weekendBands: [] as React.ReactNode[], monthLines: [] as React.ReactNode[] };
    const dayCells: React.ReactNode[] = [];
    const weekendBands: React.ReactNode[] = [];
    const monthLines: React.ReactNode[] = [];
    days.forEach((iso, i) => {
      const d = new Date(`${iso}T00:00:00`);
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      const isMonthStart = i === 0 || days[i].slice(0, 7) !== days[i - 1].slice(0, 7);
      dayCells.push(
        <div key={iso} className="absolute top-0 text-center leading-[15px]" style={{ left: i * DAY_W, width: DAY_W, fontSize: 9.5, color: isWeekend ? '#1f2937' : MUTED, fontWeight: isWeekend ? 600 : 400 }}>
          {d.getDate()}
        </div>,
      );
      if (isWeekend) {
        weekendBands.push(<div key={iso} className="absolute top-0 bottom-0" style={{ left: i * DAY_W, width: DAY_W, background: 'rgba(15,23,42,0.05)' }} />);
      }
      if (isMonthStart && i > 0) {
        monthLines.push(<div key={iso} className="absolute top-0 bottom-0" style={{ left: i * DAY_W, width: 1, background: 'rgba(15,23,42,0.18)' }} />);
      }
    });
    return { dayCells, weekendBands, monthLines };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.length]);

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}`, background: row.isResumen ? '#fafbfc' : '#fff' }}>
      <div className="flex flex-wrap items-baseline gap-2.5 px-4 py-3">
        {row.subActividad && (
          <span className="shrink-0 font-mono text-[12px] px-2 py-0.5 rounded-md" style={{ background: ACCENT_LIGHT, color: ACCENT }}>{row.subActividad}</span>
        )}
        <p className={`text-[13.5px] flex-1 min-w-[180px] ${row.isResumen ? 'font-bold text-slate-800' : 'text-slate-800'}`} title={row.concepto}>
          {row.concepto}
        </p>
        {row.lineaProductiva && (
          <span className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-md" style={{ background: '#ecfdf5', color: '#047857' }}>{row.lineaProductiva}</span>
        )}
        {row.totalToneladas !== null && (
          <span className="shrink-0 text-xs" style={{ color: MUTED }}>{fmtTon(row.totalToneladas)} riego/abono</span>
        )}
      </div>

      {!hasTimeline ? (
        <p className="px-4 pb-3 text-[11px] italic" style={{ color: MUTED }}>Sin fechas registradas para esta actividad.</p>
      ) : (
        <div className="px-4 pb-3">
          <div className="flex items-center gap-2 mb-1">
            <button type="button" onClick={() => scrollByMonth(-1)} className="h-[22px] w-[22px] rounded-md text-[13px] leading-none" style={{ border: `1px solid ${BORDER}`, color: ACCENT }} title="Mes anterior">‹</button>
            <div className="text-xs font-bold capitalize" style={{ minWidth: 90, color: '#1f2937' }}>{monthLabel}</div>
            <button type="button" onClick={() => scrollByMonth(1)} className="h-[22px] w-[22px] rounded-md text-[13px] leading-none" style={{ border: `1px solid ${BORDER}`, color: ACCENT }} title="Mes siguiente">›</button>
          </div>

          <div className="flex items-start gap-1.5">
            <div className="shrink-0 space-y-0" style={{ width: 170 }}>
              <div style={{ height: 17 }} />
              {tracks.map((track) => (
                <div key={track.key} className="flex flex-col justify-center pr-1.5" style={{ height: 30, borderBottom: '1px solid rgba(15,23,42,0.06)' }}>
                  <p className="text-[8px] font-bold uppercase truncate" style={{ color: MUTED, letterSpacing: '0.01em' }}>{track.label}</p>
                  {track.badge && <p className="text-[7.5px] font-semibold truncate mt-px" style={{ color: ACCENT }}>{track.badge}</p>}
                </div>
              ))}
            </div>

            <div ref={scrollRef} onScroll={updateMonthLabel} className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden rounded-md">
              <div style={{ position: 'relative', width: totalW }}>
                <div style={{ position: 'relative', height: 15, marginBottom: 2 }}>{dayTicks.dayCells}</div>
                <div style={{ position: 'relative', width: totalW, background: '#f7f8f9', borderRadius: 4 }}>
                  {dayTicks.weekendBands}
                  {dayTicks.monthLines}
                  {todayIdx !== -1 && <div className="absolute top-0 bottom-0" style={{ left: todayIdx * DAY_W, width: 2, background: '#dc2626', zIndex: 3 }} title="Hoy" />}
                  {tracks.map((track) => (
                    <div key={track.key} style={{ position: 'relative', height: 30, margin: '1px 0', borderBottom: '1px solid rgba(15,23,42,0.06)' }}>
                      {track.segments.map((seg, idx) => {
                        const s = dayIndexOf(days, seg.start);
                        const e = dayIndexOf(days, seg.end);
                        if (s === -1 || e === -1) return null;
                        const left = s * DAY_W;
                        const width = (e - s + 1) * DAY_W;
                        return (
                          <div
                            key={idx}
                            className="absolute rounded"
                            style={{
                              top: 2, bottom: 2, left, width,
                              backgroundColor: seg.color,
                              boxShadow: '0 0 0 1px rgba(0,0,0,0.06)',
                              backgroundImage: 'repeating-linear-gradient(to right, rgba(0,0,0,0.16) 0, rgba(0,0,0,0.16) 1px, transparent 1px, transparent 26px)',
                            }}
                            title={`${seg.start} → ${seg.end}`}
                          >
                            {width >= 45 && (
                              <span
                                className="absolute inset-0 flex items-center justify-center text-[9px] font-bold truncate px-1"
                                style={{ color: seg.darkText ? '#3a2e00' : '#fff', textShadow: seg.darkText ? 'none' : '0 1px 1px rgba(0,0,0,0.25)' }}
                              >
                                {seg.segLabel}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
