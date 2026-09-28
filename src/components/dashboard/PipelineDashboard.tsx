import React, { useEffect, useState } from 'react';
import {
  ClipboardList,
  CheckCircle2,
  Clock3,
  AlertOctagon,
  Inbox,
  Hourglass,
  CalendarClock,
  BellRing,
  ShieldAlert,
  Users,
  Layers,
} from 'lucide-react';

type GeneralStats = {
  totalInformes: number;
  completados: number;
  pendientes: number;
  vencidos: number;
  entregasRecibidas: number;
  entregasPendientes: number;
  entregasTardias: number;
  alertasActivas: number;
  procesosEnRiesgo: number;
};
type ResponsableStats = { id: string; name: string; totalAsignaciones: number; completadas: number; pendientes: number; vencidas: number; cumplimiento: number };
type EtapaStats = { typeName: string; order: number; stepName: string; total: number; completadas: number; pendientes: number; vencidas: number };
type TemporalStats = { entregasHoy: number; entregasProximas: number; entregasVencidas: number; alertasProximas: number; alertasCriticas: number };
type StagesDashboardData = { general: GeneralStats; porResponsable: ResponsableStats[]; porEtapa: EtapaStats[]; temporal: TemporalStats };

const GENERAL_META: { key: keyof GeneralStats; label: string; icon: React.ElementType; tone: string }[] = [
  { key: 'totalInformes', label: 'Total informes', icon: ClipboardList, tone: 'text-slate-700 bg-slate-100' },
  { key: 'completados', label: 'Completados', icon: CheckCircle2, tone: 'text-emerald-700 bg-emerald-50' },
  { key: 'pendientes', label: 'Pendientes', icon: Clock3, tone: 'text-amber-700 bg-amber-50' },
  { key: 'vencidos', label: 'Vencidos', icon: AlertOctagon, tone: 'text-rose-700 bg-rose-50' },
  { key: 'entregasRecibidas', label: 'Entregas recibidas', icon: Inbox, tone: 'text-teal-700 bg-teal-50' },
  { key: 'entregasPendientes', label: 'Entregas pendientes', icon: Hourglass, tone: 'text-amber-700 bg-amber-50' },
  { key: 'entregasTardias', label: 'Entregas tardías', icon: CalendarClock, tone: 'text-orange-700 bg-orange-50' },
  { key: 'alertasActivas', label: 'Alertas activas', icon: BellRing, tone: 'text-indigo-700 bg-indigo-50' },
  { key: 'procesosEnRiesgo', label: 'Procesos en riesgo', icon: ShieldAlert, tone: 'text-rose-700 bg-rose-50' },
];

export const PipelineDashboard: React.FC = () => {
  const [data, setData] = useState<StagesDashboardData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/reports?view=stagesDashboard')
      .then((res) => res.json())
      .then((payload) => {
        if (cancelled) return;
        if (payload?.data) setData(payload.data);
        else setError(payload?.errors?.[0] || 'No fue posible cargar el motor de etapas.');
      })
      .catch(() => { if (!cancelled) setError('No fue posible cargar el motor de etapas.'); });
    return () => { cancelled = true; };
  }, []);

  if (error) return null;
  if (!data || data.general.totalInformes === 0) return null;

  return (
    <section className="space-y-3">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-teal-700">Motor de Etapas</p>
        <h3 className="text-sm font-bold text-slate-950">Seguimiento de Informes por responsable y etapa</h3>
      </div>

      {/* Indicadores generales */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-9">
        {GENERAL_META.map((meta) => {
          const Icon = meta.icon;
          return (
            <div key={meta.key} className="rounded-[10px] border border-slate-200 bg-white p-3 shadow-[0_6px_16px_rgba(20,32,43,0.04)]">
              <span className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${meta.tone}`}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              <p className="mt-2 text-lg font-bold text-slate-950">{data.general[meta.key]}</p>
              <p className="text-[10px] font-medium text-slate-500 leading-tight">{meta.label}</p>
            </div>
          );
        })}
      </div>

      {/* Indicadores temporales */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          { label: 'Entregas hoy', value: data.temporal.entregasHoy, tone: 'text-indigo-700' },
          { label: 'Próximas (7 días)', value: data.temporal.entregasProximas, tone: 'text-amber-700' },
          { label: 'Vencidas', value: data.temporal.entregasVencidas, tone: 'text-rose-700' },
          { label: 'Alertas próximas', value: data.temporal.alertasProximas, tone: 'text-amber-700' },
          { label: 'Alertas críticas', value: data.temporal.alertasCriticas, tone: 'text-rose-700' },
        ].map((item) => (
          <div key={item.label} className="rounded-[10px] border border-slate-200 bg-white px-3 py-2.5 text-center shadow-[0_6px_16px_rgba(20,32,43,0.04)]">
            <p className={`text-xl font-bold ${item.tone}`}>{item.value}</p>
            <p className="text-[10px] font-medium text-slate-500">{item.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {/* Por responsable */}
        <div className="overflow-hidden rounded-[10px] border border-slate-200 bg-white shadow-[0_10px_24px_rgba(20,32,43,0.045)]">
          <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
            <Users className="h-4 w-4 text-teal-700" />
            <h4 className="text-xs font-bold text-slate-950">Cumplimiento por responsable</h4>
          </div>
          {data.porResponsable.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-slate-400">Sin responsables asignados en el flujo todavía.</p>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Responsable</th>
                    <th className="px-2 py-2 text-center">Total</th>
                    <th className="px-2 py-2 text-center">Completadas</th>
                    <th className="px-2 py-2 text-center">Pendientes</th>
                    <th className="px-2 py-2 text-center">Vencidas</th>
                    <th className="px-3 py-2">Cumplimiento</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.porResponsable.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-2 font-semibold text-slate-800">{r.name}</td>
                      <td className="px-2 py-2 text-center text-slate-600">{r.totalAsignaciones}</td>
                      <td className="px-2 py-2 text-center text-emerald-700 font-medium">{r.completadas}</td>
                      <td className="px-2 py-2 text-center text-amber-700 font-medium">{r.pendientes}</td>
                      <td className="px-2 py-2 text-center text-rose-700 font-medium">{r.vencidas}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full bg-slate-100">
                            <div
                              className={`h-full rounded-full ${r.cumplimiento >= 80 ? 'bg-emerald-500' : r.cumplimiento >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`}
                              style={{ width: `${r.cumplimiento}%` }}
                            />
                          </div>
                          <span className="w-9 font-bold text-slate-700">{r.cumplimiento}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Por etapa */}
        <div className="overflow-hidden rounded-[10px] border border-slate-200 bg-white shadow-[0_10px_24px_rgba(20,32,43,0.045)]">
          <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
            <Layers className="h-4 w-4 text-teal-700" />
            <h4 className="text-xs font-bold text-slate-950">Avance por etapa</h4>
          </div>
          {data.porEtapa.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-slate-400">Sin pasos de flujo configurados todavía.</p>
          ) : (
            <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
              {data.porEtapa.map((e) => {
                const pct = e.total > 0 ? Math.round((e.completadas / e.total) * 100) : 0;
                return (
                  <div key={`${e.typeName}-${e.order}-${e.stepName}`} className="px-4 py-2.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-slate-800 truncate">{e.order}. {e.stepName}</span>
                      <span className="shrink-0 text-[10px] text-slate-400">{e.typeName}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1.5 flex-1 rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-teal-600" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-9 text-[11px] font-bold text-slate-700">{pct}%</span>
                    </div>
                    <p className="mt-1 text-[10px] text-slate-500">
                      {e.completadas} completadas · {e.pendientes} pendientes · {e.vencidas} vencidas (de {e.total})
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
