import React, { useState } from 'react';
import {
  Project,
  Report,
  ReportType,
  ScheduledAlert,
  Contact,
  ReportStatus,
} from '../../types';
import {
  calculateDaysRemaining,
  getSemaforoStatus,
} from '../../data/mockData';
import { StatusBadge } from '../common/StatusBadge';
import { SemaforoBadge } from '../common/SemaforoBadge';
import { ScheduleFrequencyField } from '../alerts/ScheduleFrequencyField';
import { SeguimientoCronograma } from './SeguimientoCronograma';
import { ErrorBoundary } from '../common/ErrorBoundary';
import {
  ArrowLeft,
  Building2,
  Bell,
  BellRing,
  BellOff,
  Plus,
  FileText,
  Calendar,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Filter,
  Search,
  Eye,
  Sliders,
  Users,
  Info,
  Edit2,
  Check,
  X,
} from 'lucide-react';

interface ProjectDetailViewProps {
  project: Project;
  reports: Report[];
  reportTypes: ReportType[];
  alerts: ScheduledAlert[];
  contacts: Contact[];
  onBackToProjects: () => void;
  onOpenNewReport: (projectId: string) => void;
  onSelectReport: (reportId: string) => void;
  onToggleProjectAutoAlerts: (projectId: string) => void;
  onUpdateProjectApplicableTypes: (projectId: string, newTypeIds: string[]) => void;
  onToggleAlertRuleActive: (alertId: string) => void;
  onAddNewAlertRule: (draft: {
    projectId?: string;
    name: string;
    schedule: string;
    time: string;
    type: ScheduledAlert['type'];
    recipientIds: string[];
  }) => Promise<void>;
  onViewAllReports: () => void;
  onUpdateProjectVigencia: (projectId: string, startDate: string, endDate: string) => Promise<void>;
  canEditSeguimiento: boolean;
}

export const ProjectDetailView: React.FC<ProjectDetailViewProps> = ({
  project,
  reports,
  reportTypes,
  alerts,
  contacts,
  onBackToProjects,
  onOpenNewReport,
  onSelectReport,
  onToggleProjectAutoAlerts,
  onUpdateProjectApplicableTypes,
  onToggleAlertRuleActive,
  onAddNewAlertRule,
  onViewAllReports,
  onUpdateProjectVigencia,
  canEditSeguimiento,
}) => {
  const [isEditingVigencia, setIsEditingVigencia] = useState(false);
  const [vigenciaStart, setVigenciaStart] = useState(project.startDate);
  const [vigenciaEnd, setVigenciaEnd] = useState(project.endDate);
  const [isSavingVigencia, setIsSavingVigencia] = useState(false);

  const handleSaveVigencia = async () => {
    setIsSavingVigencia(true);
    try {
      await onUpdateProjectVigencia(project.id, vigenciaStart, vigenciaEnd);
      setIsEditingVigencia(false);
    } finally {
      setIsSavingVigencia(false);
    }
  };
  const [reportFilterStatus, setReportFilterStatus] = useState<string>('all');
  const [reportSearchQuery, setReportSearchQuery] = useState('');
  const [isManagingTypes, setIsManagingTypes] = useState(false);
  const [selectedTypeIds, setSelectedTypeIds] = useState<string[]>(project.applicableTypeIds);
  const [showNewAlertModal, setShowNewAlertModal] = useState(false);
  const [newAlertName, setNewAlertName] = useState('');
  const [newAlertSchedule, setNewAlertSchedule] = useState('5 días antes del vencimiento');
  const [newAlertType, setNewAlertType] = useState<'Preventiva' | 'Vencimiento' | 'Seguimiento'>('Preventiva');
  const [newAlertTime, setNewAlertTime] = useState('08:00 AM');
  const [newAlertRecipients, setNewAlertRecipients] = useState<string[]>([]);

  // Project-specific reports
  const projectReports = reports.filter((r) => r.projectId === project.id);
  const projectAlerts = alerts.filter((a) => a.projectId === project.id);

  // Quick KPIs for this project
  const countPendientes = projectReports.filter((r) => r.status === 'Pendientes Evidencias').length;
  const countElaboracion = projectReports.filter((r) => r.status === 'Informe en Elaboración').length;
  const countEntregados = projectReports.filter((r) => r.status === 'Entregado a Of. Proyectos').length;
  const countEnviados = projectReports.filter((r) => r.status === 'Enviado').length;

  const countVencidos = projectReports.filter(
    (r) => getSemaforoStatus(r.dueDate, r.status) === 'vencido'
  ).length;
  const countProximos = projectReports.filter(
    (r) => getSemaforoStatus(r.dueDate, r.status) === 'proximo'
  ).length;
  const activeAlertsCount = projectAlerts.filter((a) => a.active).length;

  // Filtered reports for the project table
  const filteredProjectReports = projectReports.filter((report) => {
    if (reportSearchQuery.trim()) {
      const q = reportSearchQuery.toLowerCase();
      const matchConsecutive = report.consecutive.toLowerCase().includes(q);
      const matchType = report.typeName.toLowerCase().includes(q);
      if (!matchConsecutive && !matchType) return false;
    }
    if (reportFilterStatus === 'vencidos') {
      return getSemaforoStatus(report.dueDate, report.status) === 'vencido';
    }
    if (reportFilterStatus === 'proximos') {
      return getSemaforoStatus(report.dueDate, report.status) === 'proximo';
    }
    if (reportFilterStatus !== 'all') {
      return report.status === reportFilterStatus;
    }
    return true;
  });

  const handleSaveTypes = () => {
    onUpdateProjectApplicableTypes(project.id, selectedTypeIds);
    setIsManagingTypes(false);
  };

  const [isCreatingAlert, setIsCreatingAlert] = useState(false);

  const handleCreateAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAlertName.trim() || newAlertRecipients.length === 0) return;

    setIsCreatingAlert(true);
    try {
      await onAddNewAlertRule({
        projectId: project.id,
        name: newAlertName.trim(),
        schedule: newAlertSchedule,
        time: newAlertTime,
        type: newAlertType,
        recipientIds: newAlertRecipients,
      });
      setShowNewAlertModal(false);
      setNewAlertRecipients([]);
      setNewAlertName('');
    } catch {
      // El toast de error ya lo muestra App.tsx; dejamos el modal abierto para reintentar.
    } finally {
      setIsCreatingAlert(false);
    }
  };

  const allowsAll = project.applicableTypeIds.length === 0;

  return (
    <div id="view-project-detail" className="space-y-6 max-w-7xl mx-auto">
      {/* 1. ENCABEZADO MEJORADO (Sección 7) */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-2">
            <button
              id="back-to-projects-btn"
              type="button"
              onClick={onBackToProjects}
              className="inline-flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 font-semibold mb-1"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Volver a la cartera de proyectos</span>
            </button>

            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded">
                BPIN {project.bpin}
              </span>
              <span className="px-2.5 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                {project.generalStatus}
              </span>
              {project.budget && (
                <span className="text-xs text-slate-500">
                  Presupuesto: <strong className="text-slate-700">{project.budget}</strong>
                </span>
              )}
            </div>

            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              {project.name}
            </h1>

            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <Building2 className="w-4 h-4 text-slate-400" />
              <span>Empresa Contratista: <strong className="text-slate-700">{project.company}</strong></span>
              <span>•</span>
              {isEditingVigencia ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span>Vigencia:</span>
                  <input
                    type="date"
                    value={vigenciaStart}
                    onChange={(e) => setVigenciaStart(e.target.value)}
                    className="rounded border border-slate-200 px-1.5 py-0.5 text-xs outline-none focus:border-indigo-500"
                  />
                  <span>al</span>
                  <input
                    type="date"
                    value={vigenciaEnd}
                    onChange={(e) => setVigenciaEnd(e.target.value)}
                    className="rounded border border-slate-200 px-1.5 py-0.5 text-xs outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={handleSaveVigencia}
                    disabled={isSavingVigencia}
                    className="text-emerald-600 hover:text-emerald-800 disabled:opacity-50"
                    title="Guardar vigencia"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setVigenciaStart(project.startDate);
                      setVigenciaEnd(project.endDate);
                      setIsEditingVigencia(false);
                    }}
                    className="text-slate-400 hover:text-slate-700"
                    title="Cancelar"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <span>
                    Vigencia: {project.startDate || 'sin definir'} al {project.endDate || 'sin definir'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsEditingVigencia(true)}
                    className="text-slate-400 hover:text-indigo-600"
                    title="Editar vigencia"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                </span>
              )}
            </div>
          </div>

          {/* Right Action Controls: Automatic Alerts Switch & New Report Button */}
          <div className="flex flex-wrap items-center gap-3 shrink-0 pt-2 lg:pt-0">
            {/* Automatic Alerts Toggle (Sección 6) */}
            <div className="flex items-center gap-2.5 px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-lg">
              <div className="text-left">
                <span className="text-[11px] text-slate-500 block leading-tight">
                  Alertas automáticas
                </span>
                <span className="text-xs font-bold text-slate-800">
                  {project.autoAlertsEnabled ? 'Activadas' : 'Desactivadas'}
                </span>
              </div>
              <button
                id="toggle-project-auto-alerts-btn"
                type="button"
                onClick={() => onToggleProjectAutoAlerts(project.id)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  project.autoAlertsEnabled ? 'bg-indigo-600' : 'bg-slate-300'
                }`}
                title={project.autoAlertsEnabled ? 'Desactivar alertas del proyecto' : 'Activar alertas del proyecto'}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                    project.autoAlertsEnabled ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <button
              id="project-detail-new-report-btn"
              type="button"
              onClick={() => onOpenNewReport(project.id)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Nuevo Informe</span>
            </button>
          </div>
        </div>

        {/* 2. RESUMEN RÁPIDO (CARDS KPI - Sección 7) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-6 pt-5 border-t border-slate-100">
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
            <span className="text-[11px] font-medium text-slate-500 flex items-center justify-between">
              Total Informes
              <FileText className="w-3.5 h-3.5 text-slate-400" />
            </span>
            <div className="text-xl font-bold text-slate-900 mt-1">{projectReports.length}</div>
            <span className="text-[10px] text-slate-400">Contratados</span>
          </div>

          <div className="p-3 bg-amber-50/70 rounded-xl border border-amber-200/60">
            <span className="text-[11px] font-medium text-amber-800 flex items-center justify-between">
              Pendientes
              <Clock className="w-3.5 h-3.5 text-amber-500" />
            </span>
            <div className="text-xl font-bold text-amber-900 mt-1">{countPendientes}</div>
            <span className="text-[10px] text-amber-700">Fase evidencias</span>
          </div>

          <div className="p-3 bg-rose-50 rounded-xl border border-rose-200/80">
            <span className="text-[11px] font-medium text-rose-800 flex items-center justify-between">
              Vencidos
              <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
            </span>
            <div className="text-xl font-bold text-rose-800 mt-1">{countVencidos}</div>
            <span className="text-[10px] text-rose-600">Requiere gestión</span>
          </div>

          <div className="p-3 bg-amber-50/50 rounded-xl border border-amber-200/60">
            <span className="text-[11px] font-medium text-amber-800 flex items-center justify-between">
              Próximos (1-5 d)
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            </span>
            <div className="text-xl font-bold text-amber-900 mt-1">{countProximos}</div>
            <span className="text-[10px] text-amber-700">Por vencer</span>
          </div>

          <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200/80">
            <span className="text-[11px] font-medium text-emerald-800 flex items-center justify-between">
              Enviados
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            </span>
            <div className="text-xl font-bold text-emerald-900 mt-1">{countEnviados}</div>
            <span className="text-[10px] text-emerald-700">Cumplidos</span>
          </div>

          <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-200/80">
            <span className="text-[11px] font-medium text-indigo-800 flex items-center justify-between">
              Alertas Activas
              <BellRing className="w-3.5 h-3.5 text-indigo-500" />
            </span>
            <div className="text-xl font-bold text-indigo-900 mt-1">{activeAlertsCount}</div>
            <span className="text-[10px] text-indigo-700">De {projectAlerts.length} reglas</span>
          </div>
        </div>
      </div>

      {/* 3. BLOQUE TIPOS DE INFORME APLICABLES (Sección 7 - Rediseñado) */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-indigo-600" />
            <h3 className="font-bold text-sm text-slate-900">
              Tipos de Informe Aplicables para este Proyecto
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setIsManagingTypes(!isManagingTypes)}
            className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold inline-flex items-center gap-1"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>{isManagingTypes ? 'Cerrar selector' : 'Gestionar tipos aplicables'}</span>
          </button>
        </div>

        {/* Business Rule Notice if no types defined */}
        {allowsAll && !isManagingTypes ? (
          <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-lg text-xs text-blue-900 flex items-start gap-2">
            <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <div>
              <strong>Regla de negocio:</strong> Este proyecto no tiene tipos restringidos. Se permiten y habilitan automáticamente todos los tipos disponibles del catálogo maestro.
            </div>
          </div>
        ) : null}

        {/* Display chips or editor */}
        {!isManagingTypes ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {reportTypes.map((type) => {
              const isApplicable = allowsAll || project.applicableTypeIds.includes(type.id);
              return (
                <div
                  key={type.id}
                  className={`px-3 py-1.5 rounded-lg border text-xs flex items-center gap-2 transition-all ${
                    isApplicable
                      ? 'bg-indigo-50/70 border-indigo-200 text-indigo-950 font-medium'
                      : 'bg-slate-50 border-slate-200 text-slate-400 line-through opacity-60'
                  }`}
                >
                  <span className="font-mono text-[10px] font-bold bg-white px-1.5 py-0.5 rounded border border-slate-200">
                    {type.code}
                  </span>
                  <span>{type.name}</span>
                  {isApplicable && (
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-600" />
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
            <div className="text-xs text-slate-600">
              Marque o desmarque los tipos que deben ser válidos para este contrato. Si no selecciona ninguno, el sistema aplicará la regla general de permitir todos los tipos:
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {reportTypes.map((t) => {
                const isChecked = selectedTypeIds.includes(t.id);
                return (
                  <label
                    key={t.id}
                    className="p-2.5 bg-white border border-slate-200 rounded-lg flex items-center gap-2.5 text-xs cursor-pointer hover:border-indigo-300"
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {
                        if (isChecked) {
                          setSelectedTypeIds(selectedTypeIds.filter((id) => id !== t.id));
                        } else {
                          setSelectedTypeIds([...selectedTypeIds, t.id]);
                        }
                      }}
                      className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                    />
                    <div>
                      <span className="font-bold text-slate-800">{t.code}</span> - {t.name}
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedTypeIds(project.applicableTypeIds);
                  setIsManagingTypes(false);
                }}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveTypes}
                className="px-3.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs"
              >
                Guardar Configuración
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 3.5 BLOQUE SEGUIMIENTO (extensión de proyecto: cronograma de entregas importado desde Google Sheets) */}
      <ErrorBoundary fallbackLabel="No fue posible mostrar el Seguimiento de este proyecto.">
        <SeguimientoCronograma projectId={project.id} canEdit={canEditSeguimiento} />
      </ErrorBoundary>

      {/* 4. BLOQUE ALERTAS PROGRAMADAS (Sección 7) */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2">
            <BellRing className="w-4 h-4 text-indigo-600" />
            <h3 className="font-bold text-sm text-slate-900">
              Alertas Programadas del Proyecto
            </h3>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-100 text-indigo-800">
              {projectAlerts.length}
            </span>
          </div>

          <button
            id="new-alert-rule-btn"
            type="button"
            onClick={() => setShowNewAlertModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100/70 rounded-lg transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nueva Alerta</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-2.5 px-4">Regla / Nombre</th>
                <th className="py-2.5 px-4">Programación / Frecuencia</th>
                <th className="py-2.5 px-4">Hora</th>
                <th className="py-2.5 px-4">Tipo</th>
                <th className="py-2.5 px-4">Próxima Ejecución</th>
                <th className="py-2.5 px-4">Destinatarios</th>
                <th className="py-2.5 px-4">Estado</th>
                <th className="py-2.5 px-4 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {projectAlerts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    No hay alertas programadas para este proyecto. Presione "Nueva Alerta" para crear una.
                  </td>
                </tr>
              ) : (
                projectAlerts.map((alert) => {
                  return (
                    <tr key={alert.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {alert.name}
                      </td>
                      <td className="py-3 px-4 text-slate-700 font-medium">
                        {alert.schedule}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-600">
                        {alert.time}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            alert.type === 'Vencimiento'
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : alert.type === 'Preventiva'
                              ? 'bg-amber-50 text-amber-800 border border-amber-200'
                              : 'bg-indigo-50 text-indigo-700'
                          }`}
                        >
                          {alert.type}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-600 font-medium">
                        {alert.nextExecution}
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-[11px] text-slate-600">
                          {alert.recipientIds.length} contacto(s)
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => onToggleAlertRuleActive(alert.id)}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold transition-colors cursor-pointer ${
                            alert.active
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              alert.active ? 'bg-emerald-500' : 'bg-slate-400'
                            }`}
                          />
                          {alert.active ? 'Activa' : 'Inactiva'}
                        </button>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => onToggleAlertRuleActive(alert.id)}
                          className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                        >
                          {alert.active ? 'Desactivar' : 'Activar'}
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

      {/* 5. BLOQUE INFORMES DEL PROYECTO (Sección 7) */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-indigo-600" />
            <h3 className="font-bold text-sm text-slate-900">
              Informes Asociados al Proyecto
            </h3>
            <span className="text-xs text-slate-500">
              ({filteredProjectReports.length} informes)
            </span>
          </div>

          {/* Quick Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={reportSearchQuery}
                onChange={(e) => setReportSearchQuery(e.target.value)}
                placeholder="Buscar informe..."
                className="pl-8 pr-2.5 py-1 text-xs bg-white border border-slate-200 rounded-lg outline-none focus:border-indigo-500"
              />
            </div>

            <select
              value={reportFilterStatus}
              onChange={(e) => setReportFilterStatus(e.target.value)}
              className="px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-lg text-slate-700"
            >
              <option value="all">Todos los estados</option>
              <option value="Pendientes Evidencias">Pendientes Evidencias</option>
              <option value="Informe en Elaboración">Informe en Elaboración</option>
              <option value="Entregado a Of. Proyectos">Entregado a Of. Proyectos</option>
              <option value="Enviado">Enviado</option>
              <option value="vencidos">Solo Vencidos</option>
              <option value="proximos">Próximos a vencer</option>
            </select>
          </div>
        </div>

        {/* Reports Table with Period, Days Remaining, Primary Contact & Semaforo */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-2.5 px-4">Consecutivo</th>
                <th className="py-2.5 px-4">Tipo de Informe</th>
                <th className="py-2.5 px-4">Período (Mes/Año)</th>
                <th className="py-2.5 px-4">Fecha Límite</th>
                <th className="py-2.5 px-4">Semáforo</th>
                <th className="py-2.5 px-4">Estado del Ciclo</th>
                <th className="py-2.5 px-4">Responsable Principal</th>
                <th className="py-2.5 px-4 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredProjectReports.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-400">
                    No se encontraron informes con los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                filteredProjectReports.map((report) => {
                  const daysRemaining = calculateDaysRemaining(report.dueDate, report.status);
                  const semaforo = getSemaforoStatus(report.dueDate, report.status);
                  const primaryContact = contacts.find((c) => c.id === report.primaryContactId);

                  return (
                    <tr
                      key={report.id}
                      onClick={() => onSelectReport(report.id)}
                      className="hover:bg-slate-50 cursor-pointer transition-colors group"
                    >
                      <td className="py-3 px-4 font-mono font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                        {report.consecutive}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-800">
                        {report.typeName}
                      </td>
                      <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                        {report.month} {report.year}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap font-medium text-slate-800">
                        {report.dueDate}
                      </td>
                      <td className="py-3 px-4">
                        <SemaforoBadge status={semaforo} daysRemaining={daysRemaining} />
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={report.status} size="sm" />
                      </td>
                      <td className="py-3 px-4 text-slate-700">
                        {primaryContact ? primaryContact.name : 'Sin asignar'}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectReport(report.id);
                          }}
                          className="px-2.5 py-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-md transition-colors"
                        >
                          Ver Detalle
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

      {/* New Alert Rule Modal */}
      {showNewAlertModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-2xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 p-5 max-w-md w-full space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <BellRing className="w-4 h-4 text-indigo-600" />
                Nueva Regla de Alerta Programada
              </h3>
              <button
                type="button"
                onClick={() => setShowNewAlertModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateAlert} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Nombre de la regla
                </label>
                <input
                  type="text"
                  required
                  value={newAlertName}
                  onChange={(e) => setNewAlertName(e.target.value)}
                  placeholder="Ej: Recordatorio a Interventoría 3 días antes"
                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Frecuencia / Condición
                  </label>
                  <ScheduleFrequencyField value={newAlertSchedule} onChange={setNewAlertSchedule} />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Hora de disparo
                  </label>
                  <input
                    type="text"
                    value={newAlertTime}
                    onChange={(e) => setNewAlertTime(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Tipo de Alerta
                </label>
                <select
                  value={newAlertType}
                  onChange={(e) => setNewAlertType(e.target.value as any)}
                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500"
                >
                  <option value="Preventiva">Preventiva (Aviso anticipado)</option>
                  <option value="Vencimiento">Vencimiento (Crítica al límite)</option>
                  <option value="Seguimiento">Seguimiento (Recordatorio recurrente)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Destinatarios
                </label>
                <div className="max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1.5">
                  {contacts.map((c) => {
                    const checked = newAlertRecipients.includes(c.id);
                    return (
                      <label key={c.id} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            if (checked) {
                              setNewAlertRecipients(newAlertRecipients.filter((id) => id !== c.id));
                            } else {
                              setNewAlertRecipients([...newAlertRecipients, c.id]);
                            }
                          }}
                          className="rounded text-indigo-600"
                        />
                        <span className="text-slate-800">
                          {c.name} ({c.role})
                        </span>
                      </label>
                    );
                  })}
                </div>
                {newAlertRecipients.length === 0 && (
                  <p className="mt-1 text-[11px] text-rose-600">Selecciona al menos un destinatario.</p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowNewAlertModal(false)}
                  className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={newAlertRecipients.length === 0 || isCreatingAlert}
                  className="px-4 py-1.5 font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isCreatingAlert ? 'Guardando...' : 'Crear Regla'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
