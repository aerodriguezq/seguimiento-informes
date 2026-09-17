import React, { useState, useMemo } from 'react';
import { Project, Report, ReportType } from '../../types';
import { calculateDaysRemaining, getSemaforoStatus } from '../../data/mockData';
import {
  Search,
  LayoutGrid,
  List,
  Building2,
  FolderGit2,
  ChevronRight,
  Plus,
  BellRing,
  CheckCircle2,
  AlertCircle,
  FileText,
  SlidersHorizontal,
} from 'lucide-react';

interface ProjectsListViewProps {
  projects: Project[];
  reports: Report[];
  reportTypes: ReportType[];
  onSelectProject: (projectId: string) => void;
  onOpenNewReportForProject: (projectId: string) => void;
  onCreateProject: (project: { name: string; bpin: string; company: string }) => Promise<void>;
}

export const ProjectsListView: React.FC<ProjectsListViewProps> = ({
  projects,
  reports,
  reportTypes,
  onSelectProject,
  onOpenNewReportForProject,
  onCreateProject,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isCreateFormOpen, setIsCreateFormOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [newProject, setNewProject] = useState({ name: '', bpin: '', company: '' });

  const handleCreateProject = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');

    const normalizedBpin = newProject.bpin.trim().toLowerCase();
    const isDuplicateBpin = projects.some((p) => p.bpin.trim().toLowerCase() === normalizedBpin);
    if (isDuplicateBpin) {
      setFormError('Ya existe un proyecto registrado con este BPIN.');
      return;
    }

    setIsSubmitting(true);

    try {
      await onCreateProject(newProject);
      setNewProject({ name: '', bpin: '', company: '' });
      setIsCreateFormOpen(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'No fue posible crear el proyecto.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchesName = p.name.toLowerCase().includes(query);
        const matchesBpin = p.bpin.toLowerCase().includes(query);
        const matchesCompany = p.company.toLowerCase().includes(query);
        if (!matchesName && !matchesBpin && !matchesCompany) return false;
      }
      if (statusFilter !== 'all' && p.generalStatus !== statusFilter) {
        return false;
      }
      return true;
    });
  }, [projects, searchTerm, statusFilter]);

  const getProjectStats = (projectId: string) => {
    const pReports = reports.filter((r) => r.projectId === projectId);
    const total = pReports.length;
    const sent = pReports.filter((r) => r.status === 'Enviado').length;
    const overdue = pReports.filter((r) => getSemaforoStatus(r.dueDate, r.status) === 'vencido').length;
    const upcoming = pReports.filter((r) => getSemaforoStatus(r.dueDate, r.status) === 'proximo').length;
    const pending = total - sent;
    const compliancePercent = total > 0 ? Math.round((sent / total) * 100) : 100;
    return {
      total,
      sent,
      pending,
      overdue,
      upcoming,
      compliancePercent,
    };
  };

  return (
    <div id="view-projects-list" className="space-y-5 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            Gestión y Cartera de Proyectos
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Supervisión contractual de proyectos registrados, códigos BPIN, empresas contratistas y tipos aplicables.
          </p>
        </div>

        {/* View mode toggle */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsCreateFormOpen((open) => !open)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"
          >
            <Plus className="w-3.5 h-3.5" />
            Nuevo proyecto
          </button>
          <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-md text-xs font-medium transition-colors ${
                viewMode === 'grid'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
              title="Vista en tarjetas"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`p-1.5 rounded-md text-xs font-medium transition-colors ${
                viewMode === 'table'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
              title="Vista en tabla"
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {isCreateFormOpen && (
        <form
          onSubmit={handleCreateProject}
          className="bg-white rounded-xl border border-indigo-200 p-4 shadow-xs"
        >
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Registrar proyecto</h3>
              <p className="text-xs text-slate-500 mt-0.5">Los datos se guardarán directamente en Neon.</p>
            </div>
            <button
              type="button"
              onClick={() => setIsCreateFormOpen(false)}
              className="text-xs font-medium text-slate-500 hover:text-slate-900"
            >
              Cancelar
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              ['name', 'Nombre del proyecto', 'Ej. Mejoramiento vial regional'],
              ['bpin', 'BPIN', 'Ej. 2024001000452'],
              ['company', 'Empresa', 'Ej. Consorcio Vial Andino'],
            ].map(([field, label, placeholder]) => (
              <label key={field} className="text-xs font-medium text-slate-700">
                {label}
                <input
                  required
                  value={newProject[field as keyof typeof newProject]}
                  onChange={(event) =>
                    setNewProject((project) => ({ ...project, [field]: event.target.value }))
                  }
                  placeholder={placeholder}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-indigo-500 focus:bg-white"
                />
              </label>
            ))}
          </div>
          {formError && <p className="mt-3 text-xs font-medium text-rose-600">{formError}</p>}
          <div className="mt-4 flex justify-end">
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? 'Guardando...' : 'Guardar proyecto'}
            </button>
          </div>
        </form>
      )}

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-xs flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400 pointer-events-none" />
          <input
            id="projects-search-input"
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por nombre de proyecto, BPIN o contratista..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 hover:bg-slate-100/70 focus:bg-white border border-slate-200 rounded-lg outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-indigo-500 text-slate-800"
          >
            <option value="all">Todos los estados generales</option>
            <option value="En Ejecución">En Ejecución</option>
            <option value="En Inicio">En Inicio</option>
            <option value="En Cierre">En Cierre</option>
            <option value="Suspendido">Suspendido</option>
          </select>
        </div>
      </div>

      {/* View Mode: GRID */}
      {viewMode === 'grid' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProjects.map((project) => {
            const stats = getProjectStats(project.id);
            const applicableCount = project.applicableTypeIds.length;

            return (
              <div
                key={project.id}
                id={`project-card-${project.id}`}
                className="bg-white rounded-xl border border-slate-200 shadow-xs hover:border-indigo-400 hover:shadow-md transition-all flex flex-col justify-between overflow-hidden group cursor-pointer"
                onClick={() => onSelectProject(project.id)}
              >
                <div className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-[11px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                      BPIN {project.bpin}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        project.generalStatus === 'En Ejecución'
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {project.generalStatus}
                    </span>
                  </div>

                  <h3 className="font-bold text-sm text-slate-900 mt-2.5 group-hover:text-indigo-600 transition-colors line-clamp-2 leading-snug">
                    {project.name}
                  </h3>

                  <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1.5 truncate">
                    <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{project.company}</span>
                  </div>

                  {/* Operational stats pill */}
                  <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-slate-100 text-center text-xs">
                    <div className="p-2 bg-slate-50 rounded-lg">
                      <span className="text-[10px] text-slate-400 block">Informes</span>
                      <strong className="text-slate-800">{stats.total}</strong>
                    </div>
                    <div className="p-2 bg-slate-50 rounded-lg">
                      <span className="text-[10px] text-slate-400 block">Pendientes</span>
                      <strong className={stats.pending > 0 ? 'text-amber-700' : 'text-slate-800'}>
                        {stats.pending}
                      </strong>
                    </div>
                    <div className="p-2 bg-slate-50 rounded-lg">
                      <span className="text-[10px] text-slate-400 block">Vencidos</span>
                      <strong className={stats.overdue > 0 ? 'text-rose-600' : 'text-slate-800'}>
                        {stats.overdue}
                      </strong>
                    </div>
                  </div>

                  {/* Compliance progress bar */}
                  <div className="mt-3.5">
                    <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                      <span>Cumplimiento general</span>
                      <span className="font-semibold text-slate-800">
                        {stats.compliancePercent}%
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          stats.overdue > 0
                            ? 'bg-rose-500'
                            : stats.compliancePercent === 100
                            ? 'bg-emerald-500'
                            : 'bg-indigo-600'
                        }`}
                        style={{ width: `${Math.max(stats.compliancePercent, 6)}%` }}
                      />
                    </div>
                  </div>

                  {/* Applicable Types Rule Badge */}
                  <div className="mt-3 text-[11px] text-slate-500">
                    {applicableCount > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <FileText className="w-3 h-3 text-slate-400" />
                        <strong>{applicableCount}</strong> tipos autorizados
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-indigo-700">
                        <FileText className="w-3 h-3 text-indigo-500" />
                        Permite todos los tipos
                      </span>
                    )}
                  </div>
                </div>

                {/* Card Actions Footer */}
                <div className="px-5 py-3 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenNewReportForProject(project.id);
                    }}
                    className="inline-flex items-center gap-1 text-slate-600 hover:text-indigo-600 font-medium"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Nuevo Informe</span>
                  </button>

                  <span className="inline-flex items-center gap-1 font-semibold text-indigo-600 group-hover:translate-x-0.5 transition-transform">
                    <span>Ver Detalle</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* View Mode: TABLE */}
      {viewMode === 'table' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-3 px-4">BPIN & Proyecto</th>
                  <th className="py-3 px-4">Empresa Contratista</th>
                  <th className="py-3 px-4">Estado General</th>
                  <th className="py-3 px-4">Tipos Aplicables</th>
                  <th className="py-3 px-4">Informes (Tot / Pend / Venc)</th>
                  <th className="py-3 px-4">Cumplimiento</th>
                  <th className="py-3 px-4">Alertas Auto</th>
                  <th className="py-3 px-4 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredProjects.map((project) => {
                  const stats = getProjectStats(project.id);
                  return (
                    <tr
                      key={project.id}
                      onClick={() => onSelectProject(project.id)}
                      className="hover:bg-slate-50 cursor-pointer transition-colors group"
                    >
                      <td className="py-3.5 px-4">
                        <span className="font-mono font-bold text-indigo-700 block text-[11px]">
                          BPIN {project.bpin}
                        </span>
                        <div className="font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors line-clamp-1">
                          {project.name}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-700">
                        {project.company}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700">
                          {project.generalStatus}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600">
                        {project.applicableTypeIds.length > 0
                          ? `${project.applicableTypeIds.length} tipos`
                          : 'Todos permitidos'}
                      </td>
                      <td className="py-3.5 px-4 font-medium text-slate-800">
                        {stats.total} tot / <span className="text-amber-700">{stats.pending} pend</span> /{' '}
                        <span className="text-rose-600">{stats.overdue} venc</span>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-700 w-9">
                            {stats.compliancePercent}%
                          </span>
                          <div className="w-16 bg-slate-100 h-1.5 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                stats.overdue > 0 ? 'bg-rose-500' : 'bg-emerald-500'
                              }`}
                              style={{ width: `${stats.compliancePercent}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                            project.autoAlertsEnabled ? 'text-emerald-700' : 'text-slate-400'
                          }`}
                        >
                          <BellRing className="w-3.5 h-3.5" />
                          {project.autoAlertsEnabled ? 'Activas' : 'Inactivas'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectProject(project.id);
                          }}
                          className="px-2.5 py-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-md transition-colors"
                        >
                          Ver Detalle
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
