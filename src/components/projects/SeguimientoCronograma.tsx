import React, { useEffect, useMemo, useState } from 'react';
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

const KPI_META: { key: string; label: string; color: string; bar: string }[] = [
  { key: 'insumo', label: 'INSUMO', color: 'text-sky-700', bar: 'bg-sky-500' },
  { key: 'abono', label: 'ABONO', color: 'text-emerald-700', bar: 'bg-emerald-500' },
  { key: 'material_vegetal', label: 'MATERIAL VEGETAL', color: 'text-amber-700', bar: 'bg-amber-500' },
];

const PISTA_META: Record<string, { label: string; color: string }> = {
  proveeduria_compra: { label: 'Compra', color: '#4338ca' },
  proveeduria_entrega: { label: 'Entrega', color: '#93c5fd' },
  entrega_insumos: { label: 'Entrega de Insumos', color: '#f59e0b' },
  entrega_abono: { label: 'Entrega Abono', color: '#22c55e' },
  entrega_material_vegetal: { label: 'Entrega Material Vegetal', color: '#fb923c' },
};
const PROYECCION_COLOR = '#a855f7';

const FILTERS: { key: string; label: string }[] = [
  { key: 'proveeduria', label: 'Proveeduría' },
  { key: 'proyeccion', label: 'Proyección Entrega de Insumos' },
  { key: 'entrega_insumos', label: 'Entrega de Insumos' },
  { key: 'entrega_abono', label: 'Entrega Abono' },
  { key: 'entrega_material_vegetal', label: 'Entrega Material Vegetal' },
];

function dayIndex(iso: string, minIso: string): number {
  return Math.round((new Date(`${iso}T00:00:00`).getTime() - new Date(`${minIso}T00:00:00`).getTime()) / 86400000);
}

function fmtTon(v: number | null): string {
  const n = Number(v);
  return v === null || !Number.isFinite(n) ? '' : `${n.toFixed(1)} t`;
}

export const SeguimientoCronograma: React.FC<{ projectId: string; isAdmin: boolean }> = ({ projectId, isAdmin }) => {
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

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 text-center text-xs text-slate-400">
        Cargando seguimiento...
      </div>
    );
  }

  // Sin configuración: si no es admin, no hay nada que mostrar; si lo es, ofrece configurarla.
  if (!data?.config) {
    if (!isAdmin) return null;
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700 shrink-0">
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
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700 shrink-0">
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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-lg disabled:opacity-50"
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
          {/* KPI cards */}
          <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {KPI_META.map((meta) => {
              const kpi = data.kpis[meta.key];
              const kpiTotal = Number(kpi?.total);
              const kpiAvance = Number(kpi?.avance);
              if (!kpi || !Number.isFinite(kpiTotal) || kpiTotal === 0) return null;
              const pct = Math.round((kpiAvance / kpiTotal) * 1000) / 10;
              return (
                <div key={meta.key} className="rounded-xl border border-slate-200 p-3.5">
                  <p className={`text-[11px] font-bold tracking-wide ${meta.color}`}>{meta.label}</p>
                  <p className="text-2xl font-extrabold text-slate-900 mt-1">{pct.toFixed(1)}%</p>
                  <p className="text-[10.5px] text-slate-500 mb-1.5">Porcentaje de avance general</p>
                  <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div className={`h-full rounded-full ${meta.bar}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                  <div className="flex items-center justify-between mt-1.5 text-[10.5px] text-slate-500">
                    <span>Beneficiarios</span>
                    <span className="font-semibold text-slate-700">{kpi.avance} / {kpi.total}</span>
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
                  className="rounded text-indigo-600"
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

          <div className="border-t border-slate-100 divide-y divide-slate-100">
            {filteredRows.map((row) => (
              <SeguimientoRowCard key={row.id} row={row} activeFilters={activeFilters} />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

const SeguimientoRowCard: React.FC<{ row: SeguimientoRow; activeFilters: Set<string> }> = ({ row, activeFilters }) => {
  type Track = { key: string; label: string; color: string; segments: { start: string; end: string }[]; badge: string };

  const tracks: Track[] = [];

  if (activeFilters.has('proveeduria')) {
    const compra = row.pistas.find((p) => p.pista === 'proveeduria_compra');
    const entrega = row.pistas.find((p) => p.pista === 'proveeduria_entrega');
    if ((compra && compra.fechaInicio) || (entrega && entrega.fechaInicio)) {
      const segments: Track['segments'] = [];
      if (compra?.fechaInicio && compra.fechaFin) segments.push({ start: compra.fechaInicio, end: compra.fechaFin });
      if (entrega?.fechaInicio && entrega.fechaFin) segments.push({ start: entrega.fechaInicio, end: entrega.fechaFin });
      const total = entrega?.cantidadTotal ?? compra?.cantidadTotal ?? 0;
      const entregado = entrega?.cantidadEntregada ?? compra?.cantidadEntregada ?? 0;
      tracks.push({ key: 'proveeduria', label: 'Proveeduría', color: PISTA_META.proveeduria_entrega.color, segments, badge: `${entregado}/${total} insumos` });
    }
  }

  if (activeFilters.has('proyeccion') && row.proyeccion?.fechaInicio && row.proyeccion.fechaFin) {
    const p = row.proyeccion;
    tracks.push({
      key: 'proyeccion',
      label: 'Proyección Entrega de Insumos',
      color: PROYECCION_COLOR,
      segments: [{ start: p.fechaInicio as string, end: p.fechaFin as string }],
      badge: p.beneficiariosPorDia ? `${p.beneficiariosPorDia} benef./día` : '',
    });
  }

  (['entrega_insumos', 'entrega_abono', 'entrega_material_vegetal'] as const).forEach((key) => {
    if (!activeFilters.has(key)) return;
    const pista = row.pistas.find((p) => p.pista === key);
    if (!pista || !pista.fechaInicio || !pista.fechaFin) return;
    const meta = PISTA_META[key];
    const badgeParts: string[] = [];
    const toneladas = Number(pista.toneladasTotal);
    if (pista.toneladasTotal !== null && Number.isFinite(toneladas)) badgeParts.push(`${toneladas.toFixed(1)}t`);
    badgeParts.push(`${pista.cantidadEntregada}/${pista.cantidadTotal}`);
    tracks.push({ key, label: meta.label, color: meta.color, segments: [{ start: pista.fechaInicio, end: pista.fechaFin }], badge: badgeParts.join(' · ') });
  });

  const allDates = tracks.flatMap((t) => t.segments.flatMap((s) => [s.start, s.end]));
  const hasTimeline = allDates.length > 0;
  const minIso = hasTimeline ? allDates.reduce((min, d) => (d < min ? d : min)) : '';
  const maxIso = hasTimeline ? allDates.reduce((max, d) => (d > max ? d : max)) : '';
  const totalDays = hasTimeline ? Math.max(dayIndex(maxIso, minIso) + 1, 1) : 0;
  const todayIso = new Date().toISOString().slice(0, 10);
  const todayLeft = hasTimeline && todayIso >= minIso && todayIso <= maxIso ? (dayIndex(todayIso, minIso) / totalDays) * 100 : null;

  return (
    <div className={`px-4 py-3.5 ${row.isResumen ? 'bg-slate-50' : ''}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          {row.subActividad && (
            <span className="shrink-0 font-mono text-[10.5px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">{row.subActividad}</span>
          )}
          <p className={`text-sm truncate ${row.isResumen ? 'font-bold text-slate-800' : 'text-slate-700'}`} title={row.concepto}>
            {row.concepto}
          </p>
          {row.lineaProductiva && (
            <span className="shrink-0 text-[10.5px] font-semibold text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded">{row.lineaProductiva}</span>
          )}
        </div>
        {row.totalToneladas !== null && (
          <span className="shrink-0 text-[11px] text-slate-500">{fmtTon(row.totalToneladas)} riego/abono</span>
        )}
      </div>

      {!hasTimeline ? (
        <p className="text-[11px] text-slate-400 italic">Sin fechas registradas para esta actividad.</p>
      ) : (
        <div className="space-y-1.5">
          {tracks.map((track) => (
            <div key={track.key} className="flex items-center gap-2">
              <div className="w-44 shrink-0">
                <p className="text-[10.5px] font-semibold text-slate-600 truncate">{track.label}</p>
                {track.badge && <p className="text-[10px] text-slate-400 truncate">{track.badge}</p>}
              </div>
              <div className="relative flex-1 h-4 bg-slate-50 rounded">
                {track.segments.map((seg, idx) => {
                  const left = (dayIndex(seg.start, minIso) / totalDays) * 100;
                  const width = ((dayIndex(seg.end, minIso) - dayIndex(seg.start, minIso) + 1) / totalDays) * 100;
                  return (
                    <div
                      key={idx}
                      className="absolute top-0 h-4 rounded"
                      style={{ left: `${left}%`, width: `${Math.max(width, 1)}%`, backgroundColor: track.color, opacity: idx === 0 && track.segments.length > 1 ? 0.85 : 1 }}
                      title={`${seg.start} → ${seg.end}`}
                    />
                  );
                })}
                {todayLeft !== null && (
                  <div className="absolute top-0 bottom-0 w-px bg-rose-500" style={{ left: `${todayLeft}%` }} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
