import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, Clock3, Gauge, RefreshCw, Server } from 'lucide-react';

type RouteStat = {
  route: string;
  method: string;
  requestCount: number | string;
  errorCount: number | string;
  avgDurationMs: number | string | null;
  p95DurationMs: number | string | null;
  maxDurationMs: number | string | null;
};

type RecentEvent = {
  eventType: string;
  route: string | null;
  method: string | null;
  statusCode: number | null;
  durationMs: number | null;
  errorMessage: string | null;
  createdAt: string;
};

type Summary = {
  windowDays: number;
  totals: { totalRequests: number | string; totalErrors: number | string };
  routes: RouteStat[];
  recentErrors: RecentEvent[];
  pageLoad: { loadCount: number | string; avgDurationMs: number | string | null; p95DurationMs: number | string | null };
};

const n = (value: number | string | null | undefined): number => (value === null || value === undefined ? 0 : Number(value));
const ms = (value: number | string | null | undefined): string => (value === null || value === undefined ? '--' : `${Math.round(Number(value))} ms`);

export const PerformanceView: React.FC = () => {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    setIsLoading(true);
    setError('');
    fetch('/api/health?action=summary')
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.errors?.[0] || 'No fue posible cargar el panel de rendimiento.');
        setSummary(payload.data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'No fue posible cargar el panel de rendimiento.'))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const totalRequests = summary ? n(summary.totals.totalRequests) : 0;
  const totalErrors = summary ? n(summary.totals.totalErrors) : 0;
  const errorRate = totalRequests > 0 ? ((totalErrors / totalRequests) * 100).toFixed(1) : '0.0';

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Activity className="w-5 h-5 text-indigo-600" />
            Rendimiento del Sistema
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Eficiencia de toda la app en los últimos {summary?.windowDays ?? 7} días: cuánto se demora cada función, cuántas fallan, y cuánto tarda en cargar en el navegador.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs font-semibold text-rose-700">{error}</div>
      )}

      {isLoading && !summary && (
        <div className="p-8 text-center text-xs text-slate-400">Cargando métricas...</div>
      )}

      {summary && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-4 bg-white border border-slate-200 rounded-xl">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <Server className="w-3.5 h-3.5" /> Peticiones a la API
              </div>
              <div className="mt-1.5 text-2xl font-bold text-slate-900">{totalRequests.toLocaleString('es-CO')}</div>
            </div>
            <div className="p-4 bg-white border border-slate-200 rounded-xl">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <AlertTriangle className="w-3.5 h-3.5" /> Tasa de error
              </div>
              <div className={`mt-1.5 text-2xl font-bold ${totalErrors > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{errorRate}%</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{totalErrors.toLocaleString('es-CO')} con error</div>
            </div>
            <div className="p-4 bg-white border border-slate-200 rounded-xl">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <Clock3 className="w-3.5 h-3.5" /> Carga de página (prom.)
              </div>
              <div className="mt-1.5 text-2xl font-bold text-slate-900">{ms(summary.pageLoad.avgDurationMs)}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{n(summary.pageLoad.loadCount).toLocaleString('es-CO')} cargas medidas</div>
            </div>
            <div className="p-4 bg-white border border-slate-200 rounded-xl">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <Gauge className="w-3.5 h-3.5" /> Carga de página (p95)
              </div>
              <div className="mt-1.5 text-2xl font-bold text-slate-900">{ms(summary.pageLoad.p95DurationMs)}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">9 de cada 10 cargan más rápido que esto</div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Por función de la API</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="text-left font-semibold px-4 py-2">Ruta</th>
                    <th className="text-left font-semibold px-4 py-2">Método</th>
                    <th className="text-right font-semibold px-4 py-2">Peticiones</th>
                    <th className="text-right font-semibold px-4 py-2">Promedio</th>
                    <th className="text-right font-semibold px-4 py-2">p95</th>
                    <th className="text-right font-semibold px-4 py-2">Máximo</th>
                    <th className="text-right font-semibold px-4 py-2">Errores</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.routes.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-slate-400">Todavía no hay peticiones registradas.</td>
                    </tr>
                  )}
                  {summary.routes.map((route) => {
                    const errors = n(route.errorCount);
                    return (
                      <tr key={`${route.route}-${route.method}`} className="hover:bg-slate-50">
                        <td className="px-4 py-2 font-mono font-semibold text-slate-800">{route.route}</td>
                        <td className="px-4 py-2 text-slate-500">{route.method}</td>
                        <td className="px-4 py-2 text-right text-slate-700">{n(route.requestCount).toLocaleString('es-CO')}</td>
                        <td className="px-4 py-2 text-right text-slate-700">{ms(route.avgDurationMs)}</td>
                        <td className="px-4 py-2 text-right text-slate-700">{ms(route.p95DurationMs)}</td>
                        <td className="px-4 py-2 text-right text-slate-500">{ms(route.maxDurationMs)}</td>
                        <td className={`px-4 py-2 text-right font-semibold ${errors > 0 ? 'text-rose-600' : 'text-slate-400'}`}>{errors}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Errores recientes (API y navegador)</span>
            </div>
            {summary.recentErrors.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-slate-400">Sin errores registrados -- todo tranquilo.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {summary.recentErrors.map((event, idx) => (
                  <div key={idx} className="px-4 py-2.5 text-xs flex items-start gap-3">
                    <span className="text-slate-400 whitespace-nowrap shrink-0" title={event.createdAt}>
                      {new Date(event.createdAt).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'medium' })}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 font-semibold shrink-0">
                      {event.eventType === 'client_error' ? 'Navegador' : event.statusCode ?? 'Error'}
                    </span>
                    {event.route && <span className="font-mono text-slate-600 shrink-0">{event.route}</span>}
                    <span className="text-slate-700 truncate" title={event.errorMessage ?? ''}>{event.errorMessage || 'Sin mensaje.'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
