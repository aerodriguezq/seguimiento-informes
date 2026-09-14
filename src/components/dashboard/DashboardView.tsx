import React from 'react';
import {
  Project,
  Report,
  ScheduledAlert,
  ReportStatus,
} from '../../types';
import {
  calculateDaysRemaining,
  getSemaforoStatus,
} from '../../data/mockData';
import { StatusBadge } from '../common/StatusBadge';
import { SemaforoBadge } from '../common/SemaforoBadge';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ArrowRight,
  TrendingUp,
  FolderGit2,
  BellRing,
  User,
  Plus,
  Filter,
} from 'lucide-react';

interface DashboardViewProps {
  projects: Project[];
  reports: Report[];
  alerts: ScheduledAlert[];
  onSelectProjectDetail: (projectId: string) => void;
  onSelectReportDetail: (reportId: string) => void;
  onOpenNewReport: () => void;
  onViewAllReports: (filterStatus?: ReportStatus | 'vencidos' | 'proximos') => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  projects,
  reports,
  alerts,
  onSelectProjectDetail,
  onSelectReportDetail,
  onOpenNewReport,
  onViewAllReports,
}) => {
  // Compute counts
  const countPendientes = reports.filter((r) => r.status === 'Pendientes Evidencias').length;
  const countElaboracion = reports.filter((r) => r.status === 'Informe en Elaboración').length;
  const countEntregados = reports.filter((r) => r.status === 'Entregado a Of. Proyectos').length;
  const countEnviados = reports.filter((r) => r.status === 'Enviado').length;

  const vencidos = reports.filter((r) => getSemaforoStatus(r.dueDate, r.status) === 'vencido');
  const proximos = reports.filter((r) => getSemaforoStatus(r.dueDate, r.status) === 'proximo');
  const activosAlertas = alerts.filter((a) => a.active).length;

  // Urgent reports needing action right now
  const urgentReports = [...vencidos, ...proximos].sort((a, b) => {
    const da = calculateDaysRemaining(a.dueDate, a.status);
    const db = calculateDaysRemaining(b.dueDate, b.status);
    return da - db;
  });

  // Calculate project compliance statistics
  const projectStats = projects.map((p) => {
    const pReports = reports.filter((r) => r.projectId === p.id);
    const total = pReports.length;
    const sent = pReports.filter((r) => r.status === 'Enviado').length;
    const overdue = pReports.filter(
      (r) => getSemaforoStatus(r.dueDate, r.status) === 'vencido'
    ).length;
    const percent = total > 0 ? Math.round((sent / total) * 100) : 100;
    return {
      project: p,
      total,
      sent,
      overdue,
      percent,
    };
  });

  return (
    <div id="view-dashboard" className="space-y-6 max-w-7xl mx-auto">
      {/* 30-Second Operational Summary Banner */}
      <div
        id="operational-control-banner"
        className="bg-slate-900 text-white rounded-xl p-5 border border-slate-800 shadow-sm"
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-300">
              <TrendingUp className="w-4 h-4" />
              <span>Control Operacional • Estado al 14 de Septiembre 2026</span>
            </div>
            <h2 className="text-xl font-bold mt-1 text-white tracking-tight">
              {vencidos.length > 0
                ? `Atención requerida: ${vencidos.length} ${
                    vencidos.length === 1 ? 'informe vencido' : 'informes vencidos'
                  } y ${proximos.length} próximos a vencer`
                : 'Todos los informes se encuentran al día según el cronograma'}
            </h2>
            <p className="text-xs text-slate-300 mt-1 max-w-3xl">
              Visualice en tiempo real los informes de contratos y supervisión. Identifique los
              responsables asignados y ejecute las transiciones requeridas antes del cierre del
              período.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              id="dashboard-create-report-btn"
              type="button"
              onClick={onOpenNewReport}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Crear Nuevo Informe</span>
            </button>
            <button
              id="dashboard-view-critical-btn"
              type="button"
              onClick={() => onViewAllReports('vencidos')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-200 rounded-lg text-xs font-medium border border-slate-700 transition-colors cursor-pointer"
            >
              <Filter className="w-3.5 h-3.5 text-rose-400" />
              <span>Filtrar Vencidos ({vencidos.length})</span>
            </button>
          </div>
        </div>

        {/* Rapid KPI Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 mt-5 pt-4 border-t border-slate-800">
          <div
            onClick={() => onViewAllReports('vencidos')}
            className="p-3 bg-rose-950/40 border border-rose-900/60 rounded-lg hover:bg-rose-900/40 cursor-pointer transition-colors"
          >
            <div className="text-[11px] font-medium text-rose-300 flex items-center justify-between">
              <span>Vencidos</span>
              <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
            </div>
            <div className="text-xl font-bold text-rose-200 mt-1">{vencidos.length}</div>
            <div className="text-[10px] text-rose-400/80 mt-0.5">Acción inmediata</div>
          </div>

          <div
            onClick={() => onViewAllReports('proximos')}
            className="p-3 bg-amber-950/40 border border-amber-900/60 rounded-lg hover:bg-amber-900/40 cursor-pointer transition-colors"
          >
            <div className="text-[11px] font-medium text-amber-300 flex items-center justify-between">
              <span>Próximos (1-5 d)</span>
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="text-xl font-bold text-amber-200 mt-1">{proximos.length}</div>
            <div className="text-[10px] text-amber-400/80 mt-0.5">Seguimiento preventivo</div>
          </div>

          <div
            onClick={() => onViewAllReports('Pendientes Evidencias')}
            className="p-3 bg-slate-800/60 border border-slate-700 rounded-lg hover:bg-slate-800 cursor-pointer transition-colors"
          >
            <div className="text-[11px] font-medium text-slate-300 flex items-center justify-between">
              <span>Pend. Evidencias</span>
              <Clock className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="text-xl font-bold text-white mt-1">{countPendientes}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">Fase inicial</div>
          </div>

          <div
            onClick={() => onViewAllReports('Informe en Elaboración')}
            className="p-3 bg-slate-800/60 border border-slate-700 rounded-lg hover:bg-slate-800 cursor-pointer transition-colors"
          >
            <div className="text-[11px] font-medium text-slate-300 flex items-center justify-between">
              <span>En Elaboración</span>
              <Clock className="w-3.5 h-3.5 text-blue-400" />
            </div>
            <div className="text-xl font-bold text-white mt-1">{countElaboracion}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">Redacción y anexos</div>
          </div>

          <div
            onClick={() => onViewAllReports('Entregado a Of. Proyectos')}
            className="p-3 bg-slate-800/60 border border-slate-700 rounded-lg hover:bg-slate-800 cursor-pointer transition-colors"
          >
            <div className="text-[11px] font-medium text-slate-300 flex items-center justify-between">
              <span>Entregados Ofic.</span>
              <Clock className="w-3.5 h-3.5 text-indigo-400" />
            </div>
            <div className="text-xl font-bold text-white mt-1">{countEntregados}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">En revisión</div>
          </div>

          <div
            onClick={() => onViewAllReports('Enviado')}
            className="p-3 bg-emerald-950/40 border border-emerald-900/60 rounded-lg hover:bg-emerald-900/40 cursor-pointer transition-colors"
          >
            <div className="text-[11px] font-medium text-emerald-300 flex items-center justify-between">
              <span>Enviados</span>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="text-xl font-bold text-emerald-200 mt-1">{countEnviados}</div>
            <div className="text-[10px] text-emerald-400/80 mt-0.5">Cumplidos</div>
          </div>

          <div className="p-3 bg-slate-800/60 border border-slate-700 rounded-lg">
            <div className="text-[11px] font-medium text-slate-300 flex items-center justify-between">
              <span>Alertas Activas</span>
              <BellRing className="w-3.5 h-3.5 text-indigo-400" />
            </div>
            <div className="text-xl font-bold text-white mt-1">{activosAlertas}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">Reglas evaluándose</div>
          </div>
        </div>
      </div>

      {/* Main Grid: Urgent reports table + Project compliance list */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Urgent Attention Reports */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600" />
              <h3 className="font-bold text-sm text-slate-900">
                Informes que Requieren Atención Inmediata
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-100 text-rose-800">
                {urgentReports.length}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onViewAllReports()}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold inline-flex items-center gap-1"
            >
              Ver todos los informes <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-2.5 px-4">Consecutivo / Tipo</th>
                  <th className="py-2.5 px-4">Proyecto</th>
                  <th className="py-2.5 px-4">Período / Límite</th>
                  <th className="py-2.5 px-4">Semáforo</th>
                  <th className="py-2.5 px-4">Estado Ciclo</th>
                  <th className="py-2.5 px-4 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {urgentReports.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      No hay informes vencidos ni próximos a vencer en este momento.
                    </td>
                  </tr>
                ) : (
                  urgentReports.map((report) => {
                    const daysRemaining = calculateDaysRemaining(report.dueDate, report.status);
                    const semaforo = getSemaforoStatus(report.dueDate, report.status);
                    return (
                      <tr
                        key={report.id}
                        id={`urgent-report-row-${report.id}`}
                        className="hover:bg-slate-50/80 transition-colors group cursor-pointer"
                        onClick={() => onSelectReportDetail(report.id)}
                      >
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900">{report.consecutive}</div>
                          <div className="text-[11px] text-slate-500 line-clamp-1">
                            {report.typeName}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="text-slate-800 font-medium line-clamp-1 max-w-44">
                            {report.projectName}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            BPIN: {report.projectBpin}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="text-slate-700 font-medium">
                            {report.month} {report.year}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {report.dueDate}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <SemaforoBadge status={semaforo} daysRemaining={daysRemaining} />
                        </td>
                        <td className="py-3 px-4">
                          <StatusBadge status={report.status} size="sm" />
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectReportDetail(report.id);
                            }}
                            className="px-2.5 py-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-md transition-colors"
                          >
                            Gestionar
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right 1 Col: Project Compliance Status */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
            <div className="flex items-center gap-2">
              <FolderGit2 className="w-4 h-4 text-indigo-600" />
              <h3 className="font-bold text-sm text-slate-900">
                Semáforo de Proyectos
              </h3>
            </div>
            <span className="text-xs text-slate-500">
              {projects.length} proyectos
            </span>
          </div>

          <div className="p-4 space-y-4 flex-1 overflow-y-auto">
            {projectStats.map((item) => (
              <div
                key={item.project.id}
                id={`dashboard-project-card-${item.project.id}`}
                onClick={() => onSelectProjectDetail(item.project.id)}
                className="p-3 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/20 transition-all cursor-pointer group"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-xs text-slate-900 group-hover:text-indigo-700 transition-colors line-clamp-1">
                      {item.project.name}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                      {item.project.company}
                    </div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                      item.overdue > 0
                        ? 'bg-rose-100 text-rose-800'
                        : item.percent === 100
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-indigo-100 text-indigo-800'
                    }`}
                  >
                    {item.overdue > 0 ? `${item.overdue} vencidos` : `${item.percent}% al día`}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="mt-2.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                    <span>Cumplimiento ({item.sent}/{item.total} informes)</span>
                    <span className="font-semibold text-slate-700">{item.percent}%</span>
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        item.overdue > 0
                          ? 'bg-rose-500'
                          : item.percent === 100
                          ? 'bg-emerald-500'
                          : 'bg-indigo-500'
                      }`}
                      style={{ width: `${Math.max(item.percent, 8)}%` }}
                    />
                  </div>
                </div>

                <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                  <span>BPIN: {item.project.bpin}</span>
                  <span className="group-hover:text-indigo-600 font-semibold inline-flex items-center">
                    Ver detalle <ArrowRight className="w-3 h-3 ml-0.5" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
