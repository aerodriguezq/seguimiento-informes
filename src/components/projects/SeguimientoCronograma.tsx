import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarRange, RefreshCw, AlertTriangle, Settings, Save, Search, ChevronDown, ChevronUp, Columns3, Printer } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';

const INSUMO_COLUMNS: { key: string; label: string }[] = [
  { key: 'insumo', label: 'Insumo' },
  { key: 'unidad', label: 'Unidad' },
  { key: 'componente', label: 'Componente' },
  { key: 'proceso', label: 'Proceso' },
  { key: 'cantidad', label: 'Cantidad' },
  { key: 'beneficiarios', label: 'Benef.' },
  { key: 'fechaCompra', label: 'Fecha compra' },
  { key: 'fechaEntrega', label: 'Fecha entrega' },
  { key: 'llego', label: 'Llegó' },
  { key: 'estado', label: 'Estado' },
  { key: 'tanda', label: 'Tanda' },
];
const INSUMO_COLUMN_KEYS = INSUMO_COLUMNS.map((c) => c.key);

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
  config: {
    spreadsheetId: string;
    cronogramaGid: string;
    lastImportAt: string | null;
    lastError: string | null;
    insumosColumnasVisibles: string[] | null;
  } | null;
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

const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fmtShortDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${MESES_CORTO[Number(m) - 1]} ${y}`;
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

export const SeguimientoCronograma: React.FC<{ projectId: string; canEdit: boolean; standalone?: boolean }> = ({
  projectId,
  canEdit,
  standalone = false,
}) => {
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;
  const [data, setData] = useState<SeguimientoData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [isLogVisible, setIsLogVisible] = useState(true);
  const [isEditingConfig, setIsEditingConfig] = useState(false);
  const [sheetInput, setSheetInput] = useState('');
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set(FILTERS.map((f) => f.key)));
  const [isColumnsPanelOpen, setIsColumnsPanelOpen] = useState(false);
  const [draftColumns, setDraftColumns] = useState<Set<string>>(new Set(INSUMO_COLUMN_KEYS));
  const [isSavingColumns, setIsSavingColumns] = useState(false);

  const pushLog = (message: string, tone: LogEntry['tone']) => {
    const time = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLog((prev) => [{ time, message, tone }, ...prev].slice(0, 14));
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
    setIsLogVisible(true);
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
      const d = payload.data.detalle;
      if (d) {
        pushLog(`Referencia SubActividad-Linea: ${d.referenciaSubActividadLinea.filasLeidas} fila(s) → ${d.referenciaSubActividadLinea.lineasMapeadas} línea(s) mapeada(s).`, d.referenciaSubActividadLinea.lineasMapeadas === 0 ? 'error' : 'info');
        pushLog(`Insumos Detalle: ${d.insumosDetalle.filasLeidas} fila(s) → ${d.insumosDetalle.lineasConDatos} línea(s) con datos.`, 'info');
        pushLog(`Abono: ${d.abono.filasLeidas} fila(s) → ${d.abono.lineasConDatos} línea(s) con datos.`, 'info');
        pushLog(`Material Vegetal: ${d.materialVegetal.filasLeidas} fila(s) → ${d.materialVegetal.lineasConDatos} línea(s) con datos.`, 'info');
        pushLog(`Entrega Insumos: ${d.entregaInsumos.filasLeidas} fila(s) → ${d.entregaInsumos.lineasConDatos} línea(s) con datos.`, 'info');
        pushLog(`Entrega Estimada Manual: ${d.entregaEstimadaManual.filasLeidas} fila(s) → ${d.entregaEstimadaManual.subActividadesConDatos} sub actividad(es).`, 'info');
        pushLog(`Beneficiarios: ${d.beneficiarios.filasLeidas} fila(s).`, 'info');
      }
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

  const handleOpenColumnsPanel = () => {
    const visible = data?.config?.insumosColumnasVisibles;
    setDraftColumns(new Set(visible && visible.length > 0 ? visible : INSUMO_COLUMN_KEYS));
    setIsColumnsPanelOpen(true);
  };

  const toggleDraftColumn = (key: string) => {
    setDraftColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSaveColumns = async () => {
    setIsSavingColumns(true);
    try {
      const columnas = draftColumns.size === INSUMO_COLUMN_KEYS.length ? null : INSUMO_COLUMN_KEYS.filter((k) => draftColumns.has(k));
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'seguimientoInsumosColumnas', projectId: Number(projectId), columnas }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.errors?.[0] || 'No fue posible guardar las columnas.');
      setData((prev) => (prev && prev.config ? { ...prev, config: { ...prev.config, insumosColumnasVisibles: columnas } } : prev));
      setIsColumnsPanelOpen(false);
    } catch (err) {
      pushLog(err instanceof Error ? err.message : 'No fue posible guardar las columnas.', 'error');
    } finally {
      setIsSavingColumns(false);
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
    const withTimeline = data.rows.filter(
      (r) => r.pistas.some((p) => p.fechaInicio && p.fechaFin) || (r.proyeccion?.fechaInicio && r.proyeccion.fechaFin),
    );
    const q = search.trim().toLowerCase();
    if (!q) return withTimeline;
    return withTimeline.filter((r) => r.subActividad.toLowerCase().includes(q) || r.concepto.toLowerCase().includes(q));
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
    if (!canEdit) {
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="no-print inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50 rounded-lg"
          >
            <Printer className="h-3.5 w-3.5" />
            Imprimir
          </button>
          {canEdit && (
            <>
              {isAdmin && (
                <button
                  type="button"
                  onClick={handleOpenColumnsPanel}
                  className="no-print inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50 rounded-lg"
                >
                  <Columns3 className="h-3.5 w-3.5" />
                  Columnas de insumos
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsEditingConfig((v) => !v)}
                className="no-print inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50 rounded-lg"
              >
                <Settings className="h-3.5 w-3.5" />
                Cambiar hoja
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={isImporting}
                className="no-print inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white rounded-lg disabled:opacity-50"
                style={{ background: ACCENT }}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isImporting ? 'animate-spin' : ''}`} />
                {isImporting ? 'Importando...' : 'Importar desde Google Sheets'}
              </button>
            </>
          )}
        </div>
      </div>

      {canEdit && isEditingConfig && (
        <div className="no-print mx-4 mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 border border-slate-100 p-3">
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

      {isAdmin && isColumnsPanelOpen && (
        <div className="no-print mx-4 mt-3 rounded-lg bg-slate-50 border border-slate-100 p-3">
          <p className="text-[11px] font-semibold text-slate-700 mb-2">Columnas visibles en "Ver insumos"</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
            {INSUMO_COLUMNS.map((col) => (
              <label key={col.key} className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draftColumns.has(col.key)}
                  onChange={() => toggleDraftColumn(col.key)}
                  className="rounded"
                  style={{ accentColor: ACCENT }}
                />
                {col.label}
              </label>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleSaveColumns}
              disabled={isSavingColumns || draftColumns.size === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-lg disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {isSavingColumns ? 'Guardando...' : 'Guardar'}
            </button>
            <button
              type="button"
              onClick={() => setIsColumnsPanelOpen(false)}
              className="px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {data.config.lastError && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg bg-rose-50 border border-rose-100 px-3 py-2 text-xs text-rose-700">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{data.config.lastError}</span>
        </div>
      )}

      {canEdit && log.length > 0 && (
        <div className="no-print mx-4 mt-3">
          <button
            type="button"
            onClick={() => setIsLogVisible((v) => !v)}
            className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-slate-500 hover:text-slate-700"
          >
            {isLogVisible ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {isLogVisible ? 'Ocultar registro de importación' : `Ver registro de importación (${log.length})`}
          </button>
          {isLogVisible && (
            <div className="mt-1.5 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 space-y-1 font-mono text-[10.5px] max-h-56 overflow-y-auto">
              {log.map((entry, idx) => (
                <p key={idx} className={entry.tone === 'error' ? 'text-rose-600' : entry.tone === 'success' ? 'text-emerald-700' : 'text-slate-500'}>
                  <span className="text-slate-400">[{entry.time}]</span> {entry.message}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {!hasData ? (
        <div className="p-4">
          <div className="py-8 text-center text-xs text-slate-400 border-2 border-dashed border-slate-200 rounded-xl">
            Sin datos importados todavía. {canEdit ? 'Usa "Importar desde Google Sheets" para traer el seguimiento.' : ''}
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
            <div className="no-print relative ml-auto w-full sm:w-56">
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
              <SeguimientoRowCard
                key={row.id}
                row={row}
                activeFilters={activeFilters}
                days={sharedDays}
                projectId={projectId}
                visibleInsumoColumns={data.config?.insumosColumnasVisibles && data.config.insumosColumnasVisibles.length > 0 ? data.config.insumosColumnasVisibles : INSUMO_COLUMN_KEYS}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

type Segment = { start: string; end: string; segLabel: string; color: string; darkText: boolean };
type Track = { key: string; label: string; segments: Segment[]; badge: string };

type InsumoDetalle = {
  insumo: string;
  unidad: string;
  componente: string;
  proceso: string;
  cantidad: number | null;
  beneficiarios: number | null;
  fechaCompra: string | null;
  fechaEntrega: string | null;
  notaEntrega: string;
  llego: string;
  estado: string;
  tanda: string;
};

const SeguimientoRowCard: React.FC<{ row: SeguimientoRow; activeFilters: Set<string>; days: string[]; projectId: string; visibleInsumoColumns: string[] }> = ({ row, activeFilters, days, projectId, visibleInsumoColumns }) => {
  const [isInsumosOpen, setIsInsumosOpen] = useState(false);
  const [isLoadingInsumos, setIsLoadingInsumos] = useState(false);
  const [insumos, setInsumos] = useState<InsumoDetalle[] | null>(null);
  const [insumosError, setInsumosError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [monthLabel, setMonthLabel] = useState('');
  const [hoverTip, setHoverTip] = useState<{ x: number; y: number; title: string; range: string; extra: string } | null>(null);

  const tracks: Track[] = [];

  const insumosCount = row.pistas.find((p) => p.pista === 'proveeduria_entrega')?.cantidadTotal
    ?? row.pistas.find((p) => p.pista === 'proveeduria_compra')?.cantidadTotal
    ?? 0;

  const handleToggleInsumos = async () => {
    const next = !isInsumosOpen;
    setIsInsumosOpen(next);
    if (next && insumos === null && row.lineaProductiva) {
      setIsLoadingInsumos(true);
      setInsumosError('');
      try {
        const res = await fetch(`/api/projects?seguimiento=insumos&projectId=${encodeURIComponent(projectId)}&linea=${encodeURIComponent(row.lineaProductiva)}`);
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.errors?.[0] || 'No fue posible cargar los insumos.');
        setInsumos(payload.data);
      } catch (err) {
        setInsumosError(err instanceof Error ? err.message : 'No fue posible cargar los insumos.');
      } finally {
        setIsLoadingInsumos(false);
      }
    }
  };

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
  // Presupuesto de ancho aproximado para la línea de tiempo en una hoja
  // horizontal (carta/A4) menos la columna de etiquetas y márgenes.
  const printScale = Math.min(1, 850 / totalW);
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
    <div className="seg-row-card rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}`, background: row.isResumen ? '#fafbfc' : '#fff' }}>
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
          <div className="no-print flex items-center gap-2 mb-1">
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

            <div ref={scrollRef} onScroll={updateMonthLabel} className="seg-timeline-scroll flex-1 min-w-0 overflow-x-auto overflow-y-hidden rounded-md">
              <div className="seg-timeline-track" style={{ position: 'relative', width: totalW, ['--seg-print-scale' as string]: printScale }}>
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
                            className="absolute rounded cursor-default"
                            style={{
                              top: 2, bottom: 2, left, width,
                              backgroundColor: seg.color,
                              boxShadow: '0 0 0 1px rgba(0,0,0,0.06)',
                              backgroundImage: 'repeating-linear-gradient(to right, rgba(0,0,0,0.16) 0, rgba(0,0,0,0.16) 1px, transparent 1px, transparent 26px)',
                            }}
                            onMouseEnter={(e) => {
                              const rect = e.currentTarget.getBoundingClientRect();
                              setHoverTip({
                                x: rect.left + rect.width / 2,
                                y: rect.top,
                                title: `${track.label} · ${seg.segLabel}`,
                                range: seg.start === seg.end ? fmtShortDate(seg.start) : `${fmtShortDate(seg.start)} → ${fmtShortDate(seg.end)}`,
                                extra: track.badge,
                              });
                            }}
                            onMouseMove={(e) => {
                              const rect = e.currentTarget.getBoundingClientRect();
                              setHoverTip((prev) => (prev ? { ...prev, x: rect.left + rect.width / 2, y: rect.top } : prev));
                            }}
                            onMouseLeave={() => setHoverTip(null)}
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

      {row.lineaProductiva && (
        <div className="border-t" style={{ borderColor: BORDER }}>
          <button
            type="button"
            onClick={handleToggleInsumos}
            disabled={insumosCount === 0}
            className="no-print w-full flex items-center gap-2 px-4 py-2 text-left text-xs font-semibold disabled:cursor-default disabled:opacity-50"
            style={{ color: ACCENT }}
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isInsumosOpen ? 'rotate-180' : ''}`} />
            {insumosCount === 0 ? 'Sin insumos asociados' : isInsumosOpen ? 'Ocultar insumos' : 'Ver insumos'}
            {insumosCount > 0 && (
              <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: ACCENT_LIGHT, color: ACCENT }}>{insumosCount}</span>
            )}
          </button>

          {isInsumosOpen && (
            <div className="px-4 pb-3">
              {isLoadingInsumos ? (
                <p className="text-[11px] italic" style={{ color: MUTED }}>Cargando insumos...</p>
              ) : insumosError ? (
                <p className="text-[11px] text-rose-600">{insumosError}</p>
              ) : insumos && insumos.length > 0 ? (
                <div className="overflow-x-auto rounded-lg" style={{ border: `1px solid ${BORDER}` }}>
                  <table className="w-full text-[10.5px] border-collapse">
                    <thead>
                      <tr style={{ background: '#eef2f6' }}>
                        {INSUMO_COLUMNS.filter((c) => visibleInsumoColumns.includes(c.key)).map((c) => (
                          <th key={c.key} className="px-2 py-1.5 text-left font-bold whitespace-nowrap" style={{ borderBottom: `2px solid ${BORDER}`, color: '#1f2937' }}>{c.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {insumos.map((row2, idx) => {
                        const cellByKey: Record<string, React.ReactNode> = {
                          insumo: row2.insumo,
                          unidad: row2.unidad,
                          componente: row2.componente,
                          proceso: row2.proceso,
                          cantidad: row2.cantidad ?? '',
                          beneficiarios: row2.beneficiarios ?? '',
                          fechaCompra: row2.fechaCompra ? fmtShortDate(row2.fechaCompra) : '',
                          fechaEntrega: row2.fechaEntrega ? fmtShortDate(row2.fechaEntrega) : '',
                          llego: row2.llego,
                          estado: row2.estado,
                          tanda: row2.tanda,
                        };
                        return (
                          <tr key={idx} style={{ background: idx % 2 === 1 ? '#fafbfc' : '#fff' }}>
                            {INSUMO_COLUMNS.filter((c) => visibleInsumoColumns.includes(c.key)).map((c) => (
                              <td
                                key={c.key}
                                className={`px-2 py-1.5 whitespace-nowrap ${c.key === 'insumo' ? 'max-w-56 truncate' : ''} ${c.key === 'cantidad' || c.key === 'beneficiarios' ? 'text-right' : ''}`}
                                title={c.key === 'insumo' ? row2.insumo : undefined}
                                style={{ borderBottom: `1px solid ${BORDER}` }}
                              >
                                {cellByKey[c.key]}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-[11px] italic" style={{ color: MUTED }}>Sin insumos asociados.</p>
              )}
            </div>
          )}
        </div>
      )}

      {hoverTip && (
        <div
          className="no-print pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-lg px-3 py-2 text-[11px] shadow-lg"
          style={{ left: hoverTip.x, top: hoverTip.y - 8, background: '#1f2937', color: '#fff', maxWidth: 220 }}
        >
          <p className="font-bold leading-snug">{hoverTip.title}</p>
          <p className="mt-0.5 text-[10.5px]" style={{ color: '#cbd5e1' }}>{hoverTip.range}</p>
          {hoverTip.extra && <p className="mt-0.5 text-[10.5px]" style={{ color: '#a5f3fc' }}>{hoverTip.extra}</p>}
          <div className="absolute left-1/2 top-full -translate-x-1/2" style={{ width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '5px solid #1f2937' }} />
        </div>
      )}
    </div>
  );
};
