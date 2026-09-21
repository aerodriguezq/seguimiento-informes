import React, { useEffect, useState } from 'react';
import { CalendarRange, RefreshCw, AlertTriangle, Settings, Save } from 'lucide-react';

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

type Segment = { start: string; end: string; color: string };
type CronogramaRow = {
  id: number;
  subActividad: string;
  concepto: string;
  totalToneladas: number | null;
  toneladasRiegoAbono: number | null;
  observaciones: string;
  isResumen: boolean;
  segments: Segment[];
};
type CronogramaData = {
  config: { spreadsheetId: string; cronogramaGid: string; lastImportAt: string | null; lastError: string | null } | null;
  rows: CronogramaRow[];
};

type LogEntry = { time: string; message: string; tone: 'info' | 'success' | 'error' };

const MESES_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function dayIndex(iso: string, minIso: string): number {
  return Math.round((new Date(`${iso}T00:00:00`).getTime() - new Date(`${minIso}T00:00:00`).getTime()) / 86400000);
}

export const SeguimientoCronograma: React.FC<{ projectId: string; isAdmin: boolean }> = ({ projectId, isAdmin }) => {
  const [data, setData] = useState<CronogramaData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [isEditingConfig, setIsEditingConfig] = useState(false);
  const [sheetInput, setSheetInput] = useState('');
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  const pushLog = (message: string, tone: LogEntry['tone']) => {
    const time = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLog((prev) => [{ time, message, tone }, ...prev].slice(0, 5));
  };

  const fetchData = async () => {
    try {
      const res = await fetch(`/api/projects?seguimiento=cronograma&projectId=${encodeURIComponent(projectId)}`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.errors?.[0] || 'No fue posible cargar el cronograma.');
      setData(payload.data);
    } catch (err) {
      pushLog(err instanceof Error ? err.message : 'No fue posible cargar el cronograma.', 'error');
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
    pushLog('Leyendo la hoja de cálculo conectada...', 'info');
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'importCronograma', projectId: Number(projectId) }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.errors?.[0] || 'No fue posible importar el cronograma.');
      pushLog(`Importado: ${payload.data.rowsImported} fila(s), ${payload.data.daysDetected} día(s) detectados.`, 'success');
      await fetchData();
    } catch (err) {
      pushLog(err instanceof Error ? err.message : 'No fue posible importar el cronograma.', 'error');
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
            <h3 className="text-sm font-bold text-slate-900">Cronograma de Entregas (Seguimiento)</h3>
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

  const allSegments = data.rows.flatMap((r) => r.segments);
  const hasTimeline = allSegments.length > 0;
  const minIso = hasTimeline ? allSegments.reduce((min, s) => (s.start < min ? s.start : min), allSegments[0].start) : '';
  const maxIso = hasTimeline ? allSegments.reduce((max, s) => (s.end > max ? s.end : max), allSegments[0].end) : '';
  const totalDays = hasTimeline ? dayIndex(maxIso, minIso) + 1 : 0;

  const monthTicks: { label: string; left: number }[] = [];
  if (hasTimeline) {
    let cursor = new Date(`${minIso}T00:00:00`);
    const end = new Date(`${maxIso}T00:00:00`);
    cursor.setDate(1);
    while (cursor <= end) {
      const iso = cursor.toISOString().slice(0, 10);
      const idx = dayIndex(iso, minIso);
      if (idx >= 0) {
        monthTicks.push({ label: `${MESES_ES[cursor.getMonth()]} ${cursor.getFullYear()}`, left: (idx / totalDays) * 100 });
      }
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
  }

  return (
    <div id="project-seguimiento-cronograma" className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700 shrink-0">
            <CalendarRange className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Cronograma de Entregas (Seguimiento)</h3>
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

      <div className="p-4">
        {!hasTimeline ? (
          <div className="py-8 text-center text-xs text-slate-400 border-2 border-dashed border-slate-200 rounded-xl">
            Sin datos importados todavía. {isAdmin ? 'Usa "Importar desde Google Sheets" para traer el cronograma.' : ''}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div style={{ minWidth: 760 }}>
              <div className="relative h-5 ml-56 border-b border-slate-200 mb-1">
                {monthTicks.map((tick, idx) => (
                  <span
                    key={idx}
                    className="absolute top-0 text-[10px] font-semibold text-slate-400 -translate-x-0"
                    style={{ left: `${tick.left}%` }}
                  >
                    {tick.label}
                  </span>
                ))}
              </div>
              <div className="space-y-1">
                {data.rows.map((row) => (
                  <div key={row.id} className={`flex items-center gap-2 ${row.isResumen ? 'pt-2' : ''}`}>
                    <div className="w-56 shrink-0 pr-2">
                      <p className={`text-xs truncate ${row.isResumen ? 'font-bold text-slate-800' : 'text-slate-700'}`} title={row.concepto}>
                        {row.subActividad ? <span className="font-mono text-[10px] text-slate-400 mr-1">{row.subActividad}</span> : null}
                        {row.concepto}
                      </p>
                    </div>
                    <div className="relative flex-1 h-5 bg-slate-50 rounded">
                      {row.segments.map((seg, idx) => {
                        const left = (dayIndex(seg.start, minIso) / totalDays) * 100;
                        const width = ((dayIndex(seg.end, minIso) - dayIndex(seg.start, minIso) + 1) / totalDays) * 100;
                        return (
                          <div
                            key={idx}
                            className="absolute top-0 h-5 rounded"
                            style={{ left: `${left}%`, width: `${Math.max(width, 0.5)}%`, backgroundColor: seg.color }}
                            title={`${seg.start} → ${seg.end}`}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
