import React, { useState, useMemo } from 'react';
import {
  Report,
  Project,
  ReportType,
  Contact,
  ReportStatus,
} from '../../types';
import {
  calculateDaysRemaining,
  getSemaforoStatus,
} from '../../data/mockData';
import { StatusBadge } from '../common/StatusBadge';
import { SemaforoBadge } from '../common/SemaforoBadge';
import {
  Search,
  Filter,
  Plus,
  ArrowUpDown,
  Download,
  Eye,
  Edit2,
  Calendar,
  Layers,
  Users,
  AlertCircle,
  Clock,
  CheckCircle2,
} from 'lucide-react';

interface ReportsListViewProps {
  reports: Report[];
  projects: Project[];
  reportTypes: ReportType[];
  contacts: Contact[];
  onSelectReport: (reportId: string) => void;
  onOpenNewReport: () => void;
  onQuickChangeStatus?: (reportId: string, newStatus: ReportStatus) => void;
  initialFilterStatus?: string;
}

export const ReportsListView: React.FC<ReportsListViewProps> = ({
  reports,
  projects,
  reportTypes,
  contacts,
  onSelectReport,
  onOpenNewReport,
  initialFilterStatus = 'all',
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProject, setSelectedProject] = useState('all');
  const [selectedType, setSelectedType] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState<string>(initialFilterStatus);
  const [selectedSemaforo, setSelectedSemaforo] = useState<'all' | 'vencido' | 'proximo' | 'en_tiempo'>('all');
  const [sortField, setSortField] = useState<'dueDate' | 'consecutive' | 'project'>('dueDate');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Filter logic
  const filteredReports = useMemo(() => {
    return reports.filter((report) => {
      // Search
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchesConsecutive = report.consecutive.toLowerCase().includes(query);
        const matchesProject = report.projectName.toLowerCase().includes(query);
        const matchesType = report.typeName.toLowerCase().includes(query);
        const matchesBpin = report.projectBpin.toLowerCase().includes(query);
        const matchesObs = report.observations.toLowerCase().includes(query);
        if (!matchesConsecutive && !matchesProject && !matchesType && !matchesBpin && !matchesObs) {
          return false;
        }
      }

      // Project filter
      if (selectedProject !== 'all' && report.projectId !== selectedProject) {
        return false;
      }

      // Type filter
      if (selectedType !== 'all' && report.typeId !== selectedType) {
        return false;
      }

      // Status filter
      if (selectedStatus === 'vencidos') {
        if (getSemaforoStatus(report.dueDate, report.status) !== 'vencido') return false;
      } else if (selectedStatus === 'proximos') {
        if (getSemaforoStatus(report.dueDate, report.status) !== 'proximo') return false;
      } else if (selectedStatus !== 'all' && report.status !== selectedStatus) {
        return false;
      }

      // Semaforo filter
      if (selectedSemaforo !== 'all') {
        const currentSemaforo = getSemaforoStatus(report.dueDate, report.status);
        if (currentSemaforo !== selectedSemaforo) return false;
      }

      return true;
    }).sort((a, b) => {
      if (sortField === 'dueDate') {
        const comp = new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
        return sortOrder === 'asc' ? comp : -comp;
      }
      if (sortField === 'consecutive') {
        return sortOrder === 'asc'
          ? a.consecutive.localeCompare(b.consecutive)
          : b.consecutive.localeCompare(a.consecutive);
      }
      if (sortField === 'project') {
        return sortOrder === 'asc'
          ? a.projectName.localeCompare(b.projectName)
          : b.projectName.localeCompare(a.projectName);
      }
      return 0;
    });
  }, [reports, searchTerm, selectedProject, selectedType, selectedStatus, selectedSemaforo, sortField, sortOrder]);

  const handleExportCSV = () => {
    const headers = ['Consecutivo', 'Proyecto', 'BPIN', 'Tipo', 'Periodo', 'Fecha_Limite', 'Estado', 'Semaforo'];
    const rows = filteredReports.map((r) => [
      r.consecutive,
      `"${r.projectName.replace(/"/g, '""')}"`,
      r.projectBpin,
      `"${r.typeName.replace(/"/g, '""')}"`,
      `"${r.month} ${r.year}"`,
      r.dueDate,
      r.status,
      getSemaforoStatus(r.dueDate, r.status),
    ]);
    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `informes_seguimiento_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getContactNames = (contactIds: string[]) => {
    return contactIds
      .map((id) => contacts.find((c) => c.id === id)?.name)
      .filter(Boolean);
  };

  return (
    <div id="view-reports-list" className="space-y-5 max-w-7xl mx-auto">
      {/* Header Bar with Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            Listado General de Informes
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Monitoreo y trazabilidad de informes, estados contractuales, responsables y fechas de vencimiento.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            id="reports-export-csv-btn"
            type="button"
            onClick={handleExportCSV}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg shadow-2xs transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Exportar CSV</span>
          </button>
          <button
            id="reports-new-report-btn"
            type="button"
            onClick={onOpenNewReport}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-2xs transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Nuevo Informe</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Panel */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Search Box */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400 pointer-events-none" />
            <input
              id="reports-search-input"
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar consecutivo, proyecto, palabra..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 hover:bg-slate-100/70 focus:bg-white border border-slate-200 rounded-lg outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all"
            />
          </div>

          {/* Project Filter */}
          <div>
            <select
              id="reports-project-filter"
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 hover:bg-slate-100/70 focus:bg-white border border-slate-200 rounded-lg outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all text-slate-800"
            >
              <option value="all">Todos los proyectos ({projects.length})</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.bpin})
                </option>
              ))}
            </select>
          </div>

          {/* Report Type Filter */}
          <div>
            <select
              id="reports-type-filter"
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 hover:bg-slate-100/70 focus:bg-white border border-slate-200 rounded-lg outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all text-slate-800"
            >
              <option value="all">Todos los tipos de informe</option>
              {reportTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.code} - {t.name}
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <select
              id="reports-status-filter"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 hover:bg-slate-100/70 focus:bg-white border border-slate-200 rounded-lg outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all text-slate-800"
            >
              <option value="all">Todos los estados</option>
              <option value="Pendientes Evidencias">Pendientes Evidencias</option>
              <option value="Informe en Elaboración">Informe en Elaboración</option>
              <option value="Entregado a Of. Proyectos">Entregado a Of. Proyectos</option>
              <option value="Enviado">Enviado (Cumplido)</option>
              <option value="vencidos">Solo Vencidos</option>
              <option value="proximos">Solo Próximos a Vencer</option>
            </select>
          </div>
        </div>

        {/* Secondary Filter Chips */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 font-medium">Semáforo:</span>
            <button
              type="button"
              onClick={() => setSelectedSemaforo('all')}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                selectedSemaforo === 'all'
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Todos ({reports.length})
            </button>
            <button
              type="button"
              onClick={() => setSelectedSemaforo('vencido')}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                selectedSemaforo === 'vencido'
                  ? 'bg-rose-600 text-white'
                  : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
              }`}
            >
              Vencidos
            </button>
            <button
              type="button"
              onClick={() => setSelectedSemaforo('proximo')}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                selectedSemaforo === 'proximo'
                  ? 'bg-amber-500 text-white'
                  : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
              }`}
            >
              Próximos (1-5 d)
            </button>
            <button
              type="button"
              onClick={() => setSelectedSemaforo('en_tiempo')}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                selectedSemaforo === 'en_tiempo'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
              }`}
            >
              Al día / Cumplidos
            </button>
          </div>

          <div className="text-slate-400 text-xs">
            Mostrando <strong>{filteredReports.length}</strong> de {reports.length} informes
          </div>
        </div>
      </div>

      {/* Reports Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th
                  className="py-3 px-4 cursor-pointer hover:text-slate-800 transition-colors"
                  onClick={() => {
                    if (sortField === 'consecutive') setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                    else { setSortField('consecutive'); setSortOrder('asc'); }
                  }}
                >
                  <div className="flex items-center gap-1">
                    <span>Consecutivo</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th
                  className="py-3 px-4 cursor-pointer hover:text-slate-800 transition-colors"
                  onClick={() => {
                    if (sortField === 'project') setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                    else { setSortField('project'); setSortOrder('asc'); }
                  }}
                >
                  <div className="flex items-center gap-1">
                    <span>Proyecto & BPIN</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th className="py-3 px-4">Tipo de Informe</th>
                <th className="py-3 px-4">Período</th>
                <th
                  className="py-3 px-4 cursor-pointer hover:text-slate-800 transition-colors"
                  onClick={() => {
                    if (sortField === 'dueDate') setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                    else { setSortField('dueDate'); setSortOrder('asc'); }
                  }}
                >
                  <div className="flex items-center gap-1">
                    <span>Fecha Límite</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th className="py-3 px-4">Semáforo</th>
                <th className="py-3 px-4">Estado del Ciclo</th>
                <th className="py-3 px-4">Responsables</th>
                <th className="py-3 px-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredReports.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <div className="max-w-xs mx-auto">
                      <Layers className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      <p className="font-semibold text-slate-700">No se encontraron informes</p>
                      <p className="text-xs text-slate-500 mt-1">
                        Pruebe ajustando los filtros de búsqueda o registre un nuevo informe.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredReports.map((report) => {
                  const daysRemaining = calculateDaysRemaining(report.dueDate, report.status);
                  const semaforo = getSemaforoStatus(report.dueDate, report.status);
                  const assignedContactNames = getContactNames(report.contactIds);

                  return (
                    <tr
                      key={report.id}
                      id={`report-row-${report.id}`}
                      onClick={() => onSelectReport(report.id)}
                      className="hover:bg-slate-50/90 transition-colors cursor-pointer group"
                    >
                      {/* Consecutivo */}
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                        {report.consecutive}
                      </td>

                      {/* Proyecto & BPIN */}
                      <td className="py-3.5 px-4 max-w-xs">
                        <div className="font-semibold text-slate-900 line-clamp-1">
                          {report.projectName}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          BPIN: {report.projectBpin}
                        </div>
                      </td>

                      {/* Tipo */}
                      <td className="py-3.5 px-4 max-w-xs">
                        <span className="font-medium text-slate-800 line-clamp-1">
                          {report.typeName}
                        </span>
                      </td>

                      {/* Período */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className="font-medium text-slate-700">
                          {report.month} {report.year}
                        </span>
                      </td>

                      {/* Fecha Límite */}
                      <td className="py-3.5 px-4 whitespace-nowrap font-medium text-slate-800">
                        {report.dueDate}
                      </td>

                      {/* Semáforo */}
                      <td className="py-3.5 px-4">
                        <SemaforoBadge status={semaforo} daysRemaining={daysRemaining} />
                      </td>

                      {/* Estado del ciclo */}
                      <td className="py-3.5 px-4">
                        <StatusBadge status={report.status} size="sm" />
                      </td>

                      {/* Responsables */}
                      <td className="py-3.5 px-4 max-w-44">
                        <div className="flex items-center gap-1 text-slate-700 line-clamp-1 text-[11px]">
                          <Users className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>
                            {assignedContactNames.length > 0
                              ? assignedContactNames.join(', ')
                              : 'Sin asignar'}
                          </span>
                        </div>
                      </td>

                      {/* Acciones */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectReport(report.id);
                          }}
                          className="px-2.5 py-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-md transition-colors inline-flex items-center gap-1"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Detalle</span>
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
    </div>
  );
};
