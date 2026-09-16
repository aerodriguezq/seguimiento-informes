import React from 'react';
import { Project, Report, ReportStatus, ScheduledAlert } from '../../types';
import { calculateDaysRemaining, getSemaforoStatus } from '../../data/mockData';
import { StatusBadge } from '../common/StatusBadge';
import { SemaforoBadge } from '../common/SemaforoBadge';
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  BellRing,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  Filter,
  FolderKanban,
  Plus,
  Users,
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
  const currentDateLabel = new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());
  const countPendientes = reports.filter((r) => r.status === 'Pendientes Evidencias').length;
  const countElaboracion = reports.filter((r) => r.status === 'Informe en Elaboración').length;
  const countEntregados = reports.filter((r) => r.status === 'Entregado a Of. Proyectos').length;
  const countEnviados = reports.filter((r) => r.status === 'Enviado').length;
  const vencidos = reports.filter((r) => getSemaforoStatus(r.dueDate, r.status) === 'vencido');
  const proximos = reports.filter((r) => getSemaforoStatus(r.dueDate, r.status) === 'proximo');
  const urgentReports = [...vencidos, ...proximos].sort(
    (a, b) => calculateDaysRemaining(a.dueDate, a.status) - calculateDaysRemaining(b.dueDate, b.status),
  );
  const totalReports = reports.length;
  const compliance = totalReports ? Math.round((countEnviados / totalReports) * 100) : 0;
  const activeAlerts = alerts.filter((alert) => alert.active).length;
  const projectStats = projects.map((project) => {
    const projectReports = reports.filter((report) => report.projectId === project.id);
    const sent = projectReports.filter((report) => report.status === 'Enviado').length;
    const overdue = projectReports.filter(
      (report) => getSemaforoStatus(report.dueDate, report.status) === 'vencido',
    ).length;
    return {
      project,
      total: projectReports.length,
      sent,
      overdue,
      percent: projectReports.length ? Math.round((sent / projectReports.length) * 100) : 0,
    };
  });

  const kpis = [
    { label: 'Total de informes', value: totalReports, note: 'En el período activo', icon: FileText, tone: 'ink', action: () => onViewAllReports() },
    { label: 'Requieren atención', value: vencidos.length, note: 'Vencidos', icon: AlertCircle, tone: 'rose', action: () => onViewAllReports('vencidos') },
    { label: 'Próximos a vencer', value: proximos.length, note: 'En los próximos días', icon: Clock3, tone: 'amber', action: () => onViewAllReports('proximos') },
    { label: 'Cumplimiento', value: `${compliance}%`, note: `${countEnviados} entregados`, icon: CheckCircle2, tone: 'teal', action: () => onViewAllReports('Enviado') },
  ];

  return (
    <div id="view-dashboard" className="mx-auto max-w-7xl space-y-5 pb-8">
      <section className="rounded-[10px] border border-slate-200 bg-white px-5 py-5 shadow-[0_12px_30px_rgba(20,32,43,0.06)] sm:px-7 sm:py-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-teal-700">
              <span className="inline-flex items-center gap-1.5"><BarChart3 className="h-3.5 w-3.5" /> Informe ejecutivo</span>
              <span className="text-slate-300">/</span>
              <span className="font-medium tracking-normal text-slate-500">Corte al {currentDateLabel}</span>
            </div>
            <h2 className="max-w-3xl text-2xl font-bold tracking-[-0.03em] text-slate-950 sm:text-3xl">Seguimiento de informes y alertas</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Lectura consolidada del cumplimiento, vencimientos y carga operativa de la cartera activa.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => onViewAllReports('vencidos')} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"><Filter className="h-3.5 w-3.5" /> Ver excepciones</button>
            <button id="dashboard-create-report-btn" type="button" onClick={onOpenNewReport} className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-teal-800"><Plus className="h-3.5 w-3.5" /> Nuevo informe</button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 divide-x divide-slate-200 border-y border-slate-200 sm:grid-cols-4">
          {kpis.map((kpi) => {
            const Icon = kpi.icon;
            const tone = { ink: 'text-slate-800 bg-slate-100', rose: 'text-rose-700 bg-rose-50', amber: 'text-amber-700 bg-amber-50', teal: 'text-teal-700 bg-teal-50' }[kpi.tone];
            return <button key={kpi.label} type="button" onClick={kpi.action} className="group px-3 py-4 text-left transition hover:bg-slate-50 sm:px-5"><div className="flex items-center justify-between gap-2"><span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{kpi.label}</span><span className={`rounded-md p-1.5 ${tone}`}><Icon className="h-3.5 w-3.5" /></span></div><div className="mt-2 text-2xl font-bold tracking-tight text-slate-950">{kpi.value}</div><div className="mt-1 text-[11px] text-slate-500 group-hover:text-slate-700">{kpi.note}</div></button>;
          })}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.85fr)]">
        <section className="overflow-hidden rounded-[10px] border border-slate-200 bg-white shadow-[0_10px_24px_rgba(20,32,43,0.045)]">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-rose-600" /><h3 className="text-sm font-bold text-slate-950">Prioridades de gestión</h3></div><p className="mt-1 text-xs text-slate-500">Elementos que necesitan una acción antes del siguiente corte.</p></div><button type="button" onClick={() => onViewAllReports()} className="hidden items-center gap-1 text-xs font-bold text-teal-700 hover:text-teal-900 sm:inline-flex">Ver todos <ArrowUpRight className="h-3.5 w-3.5" /></button></div>
          {urgentReports.length === 0 ? <div className="flex min-h-56 flex-col items-center justify-center px-6 text-center"><span className="mb-3 rounded-full bg-teal-50 p-3 text-teal-700"><CheckCircle2 className="h-5 w-5" /></span><h4 className="text-sm font-bold text-slate-900">Sin excepciones abiertas</h4><p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">No hay informes vencidos o próximos a vencer en la información disponible.</p></div> : <div className="overflow-x-auto"><table className="w-full min-w-170 text-left"><thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-widest text-slate-500"><tr><th className="px-5 py-3">Informe</th><th className="px-3 py-3">Proyecto</th><th className="px-3 py-3">Vencimiento</th><th className="px-3 py-3">Estado</th><th className="px-5 py-3 text-right">Acción</th></tr></thead><tbody className="divide-y divide-slate-100 text-xs">{urgentReports.slice(0, 6).map((report) => { const days = calculateDaysRemaining(report.dueDate, report.status); return <tr key={report.id} onClick={() => onSelectReportDetail(report.id)} className="group cursor-pointer transition hover:bg-slate-50"><td className="px-5 py-3.5"><div className="font-bold text-slate-900">{report.consecutive}</div><div className="mt-0.5 max-w-48 truncate text-[11px] text-slate-500">{report.typeName}</div></td><td className="max-w-48 truncate px-3 py-3.5 font-medium text-slate-700">{report.projectName}</td><td className="px-3 py-3.5"><div className="font-medium text-slate-700">{report.dueDate}</div><div className="mt-1 text-[11px] text-slate-400">{report.month} {report.year}</div></td><td className="px-3 py-3.5"><div className="flex flex-col items-start gap-1"><SemaforoBadge status={getSemaforoStatus(report.dueDate, report.status)} daysRemaining={days} /><StatusBadge status={report.status} size="sm" /></div></td><td className="px-5 py-3.5 text-right"><button type="button" onClick={(event) => { event.stopPropagation(); onSelectReportDetail(report.id); }} className="inline-flex items-center gap-1 font-bold text-teal-700 hover:text-teal-900">Gestionar <ChevronRight className="h-3.5 w-3.5" /></button></td></tr>; })}</tbody></table></div>}
        </section>

        <section className="rounded-[10px] border border-slate-200 bg-[#eef7f5] p-5 shadow-[0_10px_24px_rgba(20,32,43,0.045)]"><div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-teal-700">Lectura del corte</p><h3 className="mt-1 text-lg font-bold tracking-tight text-slate-950">Panorama operativo</h3></div><CalendarDays className="h-5 w-5 text-teal-700" /></div><div className="mt-5 space-y-3"><div className="border-b border-teal-900/10 pb-3"><div className="flex justify-between text-xs"><span className="text-slate-600">En elaboración</span><strong className="text-slate-900">{countElaboracion}</strong></div><div className="mt-2 h-1.5 rounded-full bg-white/80"><div className="h-full rounded-full bg-teal-600" style={{ width: `${totalReports ? Math.max((countElaboracion / totalReports) * 100, 3) : 0}%` }} /></div></div><div className="border-b border-teal-900/10 pb-3"><div className="flex justify-between text-xs"><span className="text-slate-600">Pendientes de evidencia</span><strong className="text-slate-900">{countPendientes}</strong></div><div className="mt-2 h-1.5 rounded-full bg-white/80"><div className="h-full rounded-full bg-amber-500" style={{ width: `${totalReports ? Math.max((countPendientes / totalReports) * 100, 3) : 0}%` }} /></div></div><div className="border-b border-teal-900/10 pb-3"><div className="flex justify-between text-xs"><span className="text-slate-600">Entregados a oficina</span><strong className="text-slate-900">{countEntregados}</strong></div><div className="mt-2 h-1.5 rounded-full bg-white/80"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${totalReports ? Math.max((countEntregados / totalReports) * 100, 3) : 0}%` }} /></div></div><div className="flex items-center justify-between pt-1 text-xs"><span className="inline-flex items-center gap-2 text-slate-600"><BellRing className="h-3.5 w-3.5 text-teal-700" />Alertas activas</span><strong className="text-slate-950">{activeAlerts}</strong></div></div><div className="mt-6 border-t border-teal-900/10 pt-4 text-[11px] leading-5 text-slate-600"><span className="font-bold text-slate-900">Responsables:</span> revisa primero las excepciones y confirma evidencias antes del próximo envío.</div></section>
      </div>

      <section className="overflow-hidden rounded-[10px] border border-slate-200 bg-white shadow-[0_10px_24px_rgba(20,32,43,0.045)]"><div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><div className="flex items-center gap-2"><FolderKanban className="h-4 w-4 text-teal-700" /><h3 className="text-sm font-bold text-slate-950">Cartera bajo seguimiento</h3></div><p className="mt-1 text-xs text-slate-500">Cumplimiento agregado por proyecto.</p></div><span className="text-xs font-semibold text-slate-500">{projects.length} proyectos</span></div>{projectStats.length === 0 ? <div className="flex min-h-32 flex-col items-center justify-center px-6 text-center"><Users className="mb-2 h-5 w-5 text-slate-300" /><p className="text-sm font-semibold text-slate-700">Aún no hay proyectos registrados</p><p className="mt-1 text-xs text-slate-500">Crea un proyecto para comenzar el seguimiento.</p></div> : <div className="overflow-x-auto"><table className="w-full min-w-180 text-left"><thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-widest text-slate-500"><tr><th className="px-5 py-3">Proyecto</th><th className="px-3 py-3">Empresa</th><th className="px-3 py-3">Informes</th><th className="px-3 py-3">Cumplimiento</th><th className="px-5 py-3 text-right">Abrir</th></tr></thead><tbody className="divide-y divide-slate-100 text-xs">{projectStats.map((item) => <tr key={item.project.id} onClick={() => onSelectProjectDetail(item.project.id)} className="group cursor-pointer transition hover:bg-slate-50"><td className="px-5 py-3.5"><div className="font-bold text-slate-900">{item.project.name}</div><div className="mt-0.5 font-mono text-[10px] text-slate-400">BPIN {item.project.bpin}</div></td><td className="px-3 py-3.5 text-slate-600">{item.project.company}</td><td className="px-3 py-3.5 font-medium text-slate-700">{item.sent}/{item.total} enviados{item.overdue > 0 && <span className="ml-2 text-rose-600">· {item.overdue} vencidos</span>}</td><td className="px-3 py-3.5"><div className="flex min-w-32 items-center gap-2"><div className="h-1.5 flex-1 rounded-full bg-slate-100"><div className={`h-full rounded-full ${item.overdue ? 'bg-rose-500' : 'bg-teal-600'}`} style={{ width: `${item.percent}%` }} /></div><span className="w-9 font-bold text-slate-700">{item.percent}%</span></div></td><td className="px-5 py-3.5 text-right"><ArrowUpRight className="ml-auto h-4 w-4 text-slate-400 transition group-hover:text-teal-700" /></td></tr>)}</tbody></table></div>}</section>
    </div>
  );
};