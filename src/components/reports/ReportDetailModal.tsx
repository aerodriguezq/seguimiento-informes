import React, { useState } from 'react';
import {
  Report,
  ReportStatus,
  Contact,
  ScheduledAlert,
  ReportAttachment,
  ReportTypeStep,
} from '../../types';
import {
  calculateDaysRemaining,
  getSemaforoStatus,
  STATUS_SEQUENCE,
  MONTHS_LIST,
} from '../../data/mockData';
import { StatusBadge } from '../common/StatusBadge';
import { SemaforoBadge } from '../common/SemaforoBadge';
import { useAuth } from '../../auth/AuthContext';
import {
  X,
  Calendar,
  Building2,
  FileText,
  Clock,
  CheckCircle,
  Users,
  Bell,
  Paperclip,
  History,
  ArrowRight,
  Upload,
  Download,
  Send,
  AlertTriangle,
  MessageSquare,
  ChevronRight,
  Pencil,
  Trash2,
  Save,
} from 'lucide-react';

const STAGE_LABEL: Record<string, string> = {
  PENDIENTE: 'Pendiente',
  ALERTA_GENERADA: 'Alerta generada',
  RECIBIDA_A_TIEMPO: 'Recibida a tiempo',
  RECIBIDA_TARDE: 'Recibida tarde',
  NO_RECIBIDA: 'No recibida',
  EN_REVISION: 'En revisión',
};
const STAGE_COLOR: Record<string, string> = {
  PENDIENTE: 'bg-slate-100 text-slate-600',
  ALERTA_GENERADA: 'bg-amber-50 text-amber-800 border border-amber-200',
  RECIBIDA_A_TIEMPO: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
  RECIBIDA_TARDE: 'bg-orange-50 text-orange-800 border border-orange-200',
  NO_RECIBIDA: 'bg-rose-50 text-rose-700 border border-rose-200',
  EN_REVISION: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
};

interface ReportDetailModalProps {
  report: Report;
  contacts: Contact[];
  alerts: ScheduledAlert[];
  reportTypeSteps: ReportTypeStep[];
  onClose: () => void;
  onUpdateStatus: (reportId: string, newStatus: ReportStatus, comment: string) => void;
  onAddAttachment: (reportId: string, attachment: ReportAttachment) => void;
  onAdvanceStep: (reportId: string) => Promise<void>;
  onEditReport: (reportId: string, updates: { month?: string; dueDate?: string; contactIds?: string[]; primaryContactId?: string; observations?: string }) => Promise<void>;
  onEditReportStage: (reportId: string, stepId: string, updates: { startDate?: string | null; dueDate?: string | null }) => Promise<void>;
  onDeleteReport: (reportId: string) => Promise<void>;
  onToggleContactAlarm: (contactId: string, enabled: boolean) => Promise<void>;
  onSimulateTrigger: (alert: ScheduledAlert) => Promise<void>;
  onSetPrimaryContact: (reportId: string, contactId: string) => Promise<void>;
}

export const ReportDetailModal: React.FC<ReportDetailModalProps> = ({
  report,
  contacts,
  alerts,
  reportTypeSteps,
  onClose,
  onUpdateStatus,
  onAddAttachment,
  onAdvanceStep,
  onEditReport,
  onEditReportStage,
  onDeleteReport,
  onToggleContactAlarm,
  onSimulateTrigger,
  onSetPrimaryContact,
}) => {
  const { user, canEdit } = useAuth();
  const [isAdvancingStep, setIsAdvancingStep] = useState(false);
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [stageStartInput, setStageStartInput] = useState('');
  const [stageDueInput, setStageDueInput] = useState('');
  const [isSavingStage, setIsSavingStage] = useState(false);
  const [togglingAlarmId, setTogglingAlarmId] = useState<string | null>(null);
  const [settingPrimaryId, setSettingPrimaryId] = useState<string | null>(null);
  const [sendingAlertId, setSendingAlertId] = useState<string | null>(null);
  const [sentAlertId, setSentAlertId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editMonth, setEditMonth] = useState(report.month);
  const [editObservations, setEditObservations] = useState(report.observations);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editError, setEditError] = useState('');

  const startEditing = () => {
    setEditMonth(report.month);
    setEditObservations(report.observations);
    setEditError('');
    setIsEditing(true);
  };

  const handleSaveEdit = async () => {
    setIsSavingEdit(true);
    setEditError('');
    try {
      await onEditReport(report.id, {
        month: editMonth,
        observations: editObservations,
      });
      setIsEditing(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'No fue posible guardar los cambios.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`¿Eliminar el informe ${report.consecutive}? Esta acción no se puede deshacer.`)) return;
    setIsDeleting(true);
    try {
      await onDeleteReport(report.id);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'No fue posible eliminar el informe.');
      setIsDeleting(false);
    }
  };

  const handleAdvanceStep = async () => {
    setIsAdvancingStep(true);
    try {
      await onAdvanceStep(report.id);
    } finally {
      setIsAdvancingStep(false);
    }
  };
  const [showTransitionModal, setShowTransitionModal] = useState(false);
  const [targetStatus, setTargetStatus] = useState<ReportStatus>(report.status);
  const [transitionComment, setTransitionComment] = useState('');
  const [activeTab, setActiveTab] = useState<'timeline' | 'contacts' | 'alerts' | 'attachments' | 'history'>('timeline');

  const daysRemaining = calculateDaysRemaining(report.dueDate, report.status);
  const semaforo = getSemaforoStatus(report.dueDate, report.status);

  // Responsables = los asignados directamente al informe + los
  // responsables de cada paso del flujo de este tipo de informe (el mismo
  // alcance que usa el motor de etapas: flujo propio del proyecto si
  // existe, si no la plantilla general) -- así se ve de una vez a todo el
  // que puede recibir una alerta en algún punto del proceso, no solo a
  // quien quedó asignado al crear el informe.
  const flowStepsForType = reportTypeSteps.filter((s) => s.typeId === report.typeId);
  const hasProjectScope = flowStepsForType.some((s) => s.projectId === report.projectId);
  const scopedFlowSteps = flowStepsForType.filter((s) => (hasProjectScope ? s.projectId === report.projectId : s.projectId === null));
  const stepContactIds = Array.from(new Set(scopedFlowSteps.flatMap((s) => s.contactIds)));
  const allResponsibleIds = Array.from(new Set([...report.contactIds, ...stepContactIds]));
  const assignedContacts = contacts.filter((c) => allResponsibleIds.includes(c.id));
  const primaryContact = contacts.find((c) => c.id === report.primaryContactId);

  // Alertas ligadas específicamente al flujo de este informe (más las generales del proyecto)
  const reportStepAlerts = alerts.filter((a) => a.reportId === report.id);
  const projectAlerts = reportStepAlerts.length > 0 ? reportStepAlerts : alerts.filter((a) => a.projectId === report.projectId);

  const openEditStage = (stepId: string, startDate: string | null, dueDate: string | null) => {
    setEditingStageId(stepId);
    setStageStartInput(startDate ?? '');
    setStageDueInput(dueDate ?? '');
  };

  const handleSaveStage = async (stepId: string) => {
    setIsSavingStage(true);
    try {
      await onEditReportStage(report.id, stepId, { startDate: stageStartInput || null, dueDate: stageDueInput || null });
      setEditingStageId(null);
    } finally {
      setIsSavingStage(false);
    }
  };

  const handleToggleAlarm = async (contactId: string, enabled: boolean) => {
    setTogglingAlarmId(contactId);
    try {
      await onToggleContactAlarm(contactId, enabled);
    } finally {
      setTogglingAlarmId(null);
    }
  };

  const handleMakePrimary = async (contactId: string) => {
    setSettingPrimaryId(contactId);
    try {
      await onSetPrimaryContact(report.id, contactId);
    } finally {
      setSettingPrimaryId(null);
    }
  };

  const handleSendAlertNow = async (alert: ScheduledAlert) => {
    setSendingAlertId(alert.id);
    try {
      await onSimulateTrigger(alert);
      setSentAlertId(alert.id);
      window.setTimeout(() => setSentAlertId((prev) => (prev === alert.id ? null : prev)), 4000);
    } finally {
      setSendingAlertId(null);
    }
  };

  const handleOpenTransition = (newS: ReportStatus) => {
    setTargetStatus(newS);
    setTransitionComment('');
    setShowTransitionModal(true);
  };

  const handleConfirmTransition = () => {
    if (!transitionComment.trim()) {
      alert('Por favor ingrese un comentario u observación para la trazabilidad del cambio de estado.');
      return;
    }
    onUpdateStatus(report.id, targetStatus, transitionComment.trim());
    setShowTransitionModal(false);
  };

  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkName, setLinkName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkError, setLinkError] = useState('');

  const handleAddDriveLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkName.trim() || !linkUrl.trim()) return;
    if (!/^https:\/\/(drive|docs)\.google\.com\//.test(linkUrl.trim())) {
      setLinkError('El link debe ser de Google Drive o Docs (https://drive.google.com/... o https://docs.google.com/...).');
      return;
    }
    const newAtt: ReportAttachment = {
      id: `att-${Date.now()}`,
      name: linkName.trim(),
      driveUrl: linkUrl.trim(),
      uploadedAt: new Date().toISOString().slice(0, 10),
      uploadedBy: 'Ing. Alejandro Rodríguez',
    };
    onAddAttachment(report.id, newAtt);
    setLinkName('');
    setLinkUrl('');
    setLinkError('');
    setShowLinkForm(false);
  };

  return (
    <div
      id="report-detail-modal-overlay"
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-in fade-in duration-150"
    >
      <div
        id="report-detail-modal-card"
        className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]"
      >
        {/* Modal Top Bar */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between bg-slate-50/80 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2.5 py-0.5 rounded">
                {report.consecutive}
              </span>
              <StatusBadge status={report.status} size="sm" />
              <SemaforoBadge status={semaforo} daysRemaining={daysRemaining} />
            </div>
            <h2 className="text-base font-bold text-slate-900 mt-1.5 line-clamp-1">
              {report.typeName} — {report.projectName}
            </h2>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-0.5">
              <span>BPIN: <strong className="font-mono text-slate-700">{report.projectBpin}</strong></span>
              <span>•</span>
              <span>Período: <strong className="text-slate-700">{report.month} {report.year}</strong></span>
              <span>•</span>
              <span>Fecha límite: <strong className="text-slate-700">{report.dueDate}</strong></span>
            </div>
          </div>

          <div className="flex items-start gap-1.5 shrink-0">
            {canEdit('reports') && !isEditing && (
              <button
                type="button"
                onClick={startEditing}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                <Pencil className="w-3.5 h-3.5" />
                Editar
              </button>
            )}
            {user.isAdmin && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {isDeleting ? 'Eliminando...' : 'Eliminar'}
              </button>
            )}
            <button
              id="close-report-detail-btn"
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {isEditing && (
          <div className="px-6 py-4 border-b border-slate-200 bg-indigo-50/60 shrink-0 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-700">Editando informe</span>
              <span className="text-[11px] text-slate-500">Año, tipo y proyecto no se pueden cambiar aquí.</span>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Mes</label>
              <select
                value={editMonth}
                onChange={(e) => setEditMonth(e.target.value)}
                className="w-full max-w-xs px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-indigo-500 bg-white"
              >
                {MONTHS_LIST.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <p className="mt-1 text-[10.5px] text-slate-500">La fecha límite se recalcula sola según el paso final del flujo configurado para este tipo de informe.</p>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Observaciones</label>
              <textarea
                value={editObservations}
                onChange={(e) => setEditObservations(e.target.value)}
                rows={2}
                className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-indigo-500 bg-white resize-none"
              />
            </div>
            <p className="text-[10.5px] text-slate-500">Los responsables se toman solos de los contactos configurados en cada paso del flujo (Listas Maestras) -- para cambiarlos, edita el paso correspondiente ahí.</p>

            {editError && <p className="text-xs font-semibold text-rose-600">{editError}</p>}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={isSavingEdit}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                {isSavingEdit ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        )}

        {/* Modal Body with Scroll */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Línea de progreso del flujo real configurado (pasos del tipo de
              informe, no el estado administrativo genérico) -- nombres y
              responsables tal como quedaron en Listas Maestras. */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Línea de Progreso del Flujo de Entrega
              </span>
            </div>

            {report.stageInstances && report.stageInstances.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {report.stageInstances.map((stage) => {
                  const isCurrent = stage.stepId === report.currentStepId;
                  const isDone = stage.status === 'RECIBIDA_A_TIEMPO' || stage.status === 'RECIBIDA_TARDE';
                  const step = reportTypeSteps.find((s) => s.id === stage.stepId);
                  const responsables = (step?.contactIds ?? [])
                    .map((id) => contacts.find((c) => c.id === id)?.name)
                    .filter((name): name is string => Boolean(name));

                  return (
                    <div
                      key={stage.stepId}
                      className={`p-3 rounded-lg border text-xs flex flex-col justify-between transition-all ${
                        isCurrent
                          ? 'border-indigo-500 bg-white ring-2 ring-indigo-100 shadow-xs'
                          : isDone
                          ? 'border-emerald-200 bg-emerald-50/50'
                          : 'border-slate-200 bg-slate-100/60 opacity-80'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] font-bold text-slate-400">PASO {stage.order}</span>
                          {isDone && <CheckCircle className="w-4 h-4 text-emerald-600" />}
                          {isCurrent && (
                            <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 animate-pulse" />
                          )}
                        </div>
                        <div
                          className={`font-bold leading-tight ${
                            isCurrent ? 'text-indigo-950' : isDone ? 'text-emerald-950' : 'text-slate-600'
                          }`}
                        >
                          {stage.stepName}
                        </div>
                        <span className={`inline-block mt-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${STAGE_COLOR[stage.status] || 'bg-slate-100 text-slate-600'}`}>
                          {STAGE_LABEL[stage.status] || stage.status}
                        </span>
                      </div>

                      <div className="mt-3 pt-2 border-t border-slate-200/60 text-[11px] text-slate-500">
                        {responsables.length > 0 ? (
                          <div className="truncate" title={responsables.join(', ')}>{responsables.join(', ')}</div>
                        ) : (
                          <span className="text-slate-400 italic">Sin responsables</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-400 py-4 text-center">Este informe todavía no tiene un flujo de pasos configurado.</p>
            )}
          </div>

          {/* Flujo de entrega por correo (pasos configurados en el tipo de informe) */}
          {(report.currentStepId || report.isWorkflowCompleted) && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">Flujo de entrega por correo</span>
                {report.isWorkflowCompleted ? (
                  <p className="mt-1 text-sm font-bold text-emerald-700">Flujo completado — se entregó al contacto final.</p>
                ) : (
                  <>
                    <p className="mt-1 text-sm font-bold text-indigo-950">
                      Paso actual: {report.currentStepName}
                      {report.currentStepIsFinal && <span className="ml-2 text-[11px] font-semibold text-emerald-700">(paso final)</span>}
                    </p>
                    {report.currentStepEmailSubject && (
                      <p className="mt-1 text-xs text-indigo-800">
                        Asunto de correo esperado: <span className="font-mono font-bold">"{report.currentStepEmailSubject}"</span>
                      </p>
                    )}
                  </>
                )}
              </div>
              {!report.isWorkflowCompleted && (
                <button
                  type="button"
                  onClick={handleAdvanceStep}
                  disabled={isAdvancingStep}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  title="Marca este paso como entregado manualmente (hasta que la detección automática de correo esté lista)"
                >
                  <span>{isAdvancingStep ? 'Actualizando...' : report.currentStepIsFinal ? 'Confirmar entrega final' : 'Confirmar entrega y avanzar'}</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Etapas: fecha de inicio/límite y estado calculado de cada paso */}
          {report.stageInstances && report.stageInstances.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-100">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Etapas del proceso</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      <th className="py-2 px-4">Etapa</th>
                      <th className="py-2 px-3">Inicio</th>
                      <th className="py-2 px-3">Límite</th>
                      <th className="py-2 px-3">Estado</th>
                      <th className="py-2 px-3">Recepción real</th>
                      {user.isAdmin && <th className="py-2 px-3 text-right">Editar</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.stageInstances.map((stage) => {
                      const isEditingStage = editingStageId === stage.stepId;
                      return (
                        <tr key={stage.stepId}>
                          <td className="py-2.5 px-4 font-semibold text-slate-900">{stage.order}. {stage.stepName}</td>
                          <td className="py-2.5 px-3 text-slate-600">
                            {isEditingStage ? (
                              <input
                                type="date"
                                value={stageStartInput}
                                onChange={(e) => setStageStartInput(e.target.value)}
                                className="w-36 px-1.5 py-1 text-xs border border-slate-200 rounded-md outline-none focus:border-teal-600"
                              />
                            ) : (
                              stage.startDate || '—'
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600">
                            {isEditingStage ? (
                              <input
                                type="date"
                                value={stageDueInput}
                                onChange={(e) => setStageDueInput(e.target.value)}
                                className="w-36 px-1.5 py-1 text-xs border border-slate-200 rounded-md outline-none focus:border-teal-600"
                              />
                            ) : (
                              stage.dueDate || '—'
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className={`px-2 py-0.5 rounded-full text-[10.5px] font-semibold whitespace-nowrap ${STAGE_COLOR[stage.status] || 'bg-slate-100 text-slate-600'}`}>
                              {STAGE_LABEL[stage.status] || stage.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-600">
                            {stage.receivedAt ? new Date(stage.receivedAt).toLocaleString('es-CO') : '—'}
                          </td>
                          {user.isAdmin && (
                            <td className="py-2.5 px-3 text-right">
                              {isEditingStage ? (
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleSaveStage(stage.stepId)}
                                    disabled={isSavingStage}
                                    className="text-teal-700 hover:text-teal-900 disabled:opacity-50"
                                    title="Guardar"
                                  >
                                    <Save className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingStageId(null)}
                                    disabled={isSavingStage}
                                    className="text-slate-400 hover:text-slate-700"
                                    title="Cancelar"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => openEditStage(stage.stepId, stage.startDate, stage.dueDate)}
                                  className="text-slate-400 hover:text-teal-700"
                                  title="Editar fechas de la etapa"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Navigation Tabs */}
          <div className="flex items-center gap-2 border-b border-slate-200 pb-1 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('timeline')}
              className={`px-3 py-2 font-semibold border-b-2 transition-colors cursor-pointer ${
                activeTab === 'timeline'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Observaciones & Resumen
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('contacts')}
              className={`px-3 py-2 font-semibold border-b-2 transition-colors cursor-pointer ${
                activeTab === 'contacts'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Responsables ({assignedContacts.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('alerts')}
              className={`px-3 py-2 font-semibold border-b-2 transition-colors cursor-pointer ${
                activeTab === 'alerts'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Alertas Vinculadas ({projectAlerts.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('attachments')}
              className={`px-3 py-2 font-semibold border-b-2 transition-colors cursor-pointer ${
                activeTab === 'attachments'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Evidencias ({report.attachments.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`px-3 py-2 font-semibold border-b-2 transition-colors cursor-pointer ${
                activeTab === 'history'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Historial de Trazabilidad ({report.history.length})
            </button>
          </div>

          {/* TAB 1: Observaciones & Resumen */}
          {activeTab === 'timeline' && (
            <div className="space-y-4">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Observaciones Operacionales del Informe
                </h4>
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 leading-relaxed">
                  {report.observations}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 bg-white border border-slate-200 rounded-lg text-xs">
                  <span className="text-slate-500 block">Responsable Principal:</span>
                  <span className="font-bold text-slate-900 mt-1 block">
                    {primaryContact ? primaryContact.name : 'No asignado'}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {primaryContact?.role}
                  </span>
                </div>

                <div className="p-3 bg-white border border-slate-200 rounded-lg text-xs">
                  <span className="text-slate-500 block">Fecha de Registro:</span>
                  <span className="font-bold text-slate-900 mt-1 block">{report.createdAt}</span>
                  <span className="text-[11px] text-slate-500">Sistema centralizado</span>
                </div>

                <div className="p-3 bg-white border border-slate-200 rounded-lg text-xs">
                  <span className="text-slate-500 block">Cambiar estado manualmente:</span>
                  <select
                    value={report.status}
                    onChange={(e) => handleOpenTransition(e.target.value as ReportStatus)}
                    className="w-full mt-1 px-2 py-1 border border-slate-200 rounded text-xs bg-slate-50 font-semibold"
                  >
                    {STATUS_SEQUENCE.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Responsables */}
          {activeTab === 'contacts' && (
            <div className="space-y-3">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Contactos y Notificaciones Asignadas
                </h4>
                <p className="text-[10.5px] text-slate-400 mt-0.5">Haz clic en la alarma de un contacto para activarle o quitarle los recordatorios automáticos. El principal recibe copia (CC) de todos los correos del informe.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {assignedContacts.map((contact) => {
                  const isPrimary = contact.id === report.primaryContactId;
                  const isToggling = togglingAlarmId === contact.id;
                  return (
                    <div
                      key={contact.id}
                      className="p-3.5 border border-slate-200 rounded-xl bg-white text-xs space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900 flex items-center gap-2">
                            <span className="truncate">{contact.name}</span>
                            {isPrimary && (
                              <span className="shrink-0 px-1.5 py-0.2 rounded text-[10px] font-bold bg-indigo-600 text-white">
                                Principal
                              </span>
                            )}
                          </div>
                          <div className="text-slate-600 text-[11px] mt-0.5">
                            {contact.role} • {contact.company}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleToggleAlarm(contact.id, !contact.hasNotificationAlarm)}
                          disabled={isToggling}
                          title={contact.hasNotificationAlarm ? 'Quitar recordatorios automáticos' : 'Activar recordatorios automáticos'}
                          className={`shrink-0 px-2 py-1 rounded text-[10px] font-semibold flex items-center gap-1 border transition-colors disabled:opacity-50 ${
                            contact.hasNotificationAlarm
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                              : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                          }`}
                        >
                          <Bell className="w-3 h-3" />
                          {isToggling ? '...' : contact.hasNotificationAlarm ? 'Alarma Activa' : 'Sin Alarma'}
                        </button>
                      </div>
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                        <span className="text-slate-500 text-[11px] font-mono truncate">
                          {contact.email} • {contact.phone}
                        </span>
                        {!isPrimary && (
                          <button
                            type="button"
                            onClick={() => handleMakePrimary(contact.id)}
                            disabled={settingPrimaryId === contact.id}
                            className="shrink-0 text-[10.5px] font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
                          >
                            {settingPrimaryId === contact.id ? '...' : 'Hacer principal'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: Alertas */}
          {activeTab === 'alerts' && (
            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Reglas de Alerta Activas para este Proyecto
              </h4>
              <div className="space-y-2">
                {projectAlerts.length === 0 ? (
                  <p className="text-xs text-slate-400 py-4 text-center">
                    No hay reglas de alerta configuradas para este proyecto.
                  </p>
                ) : (
                  projectAlerts.map((alert) => {
                    const isSending = sendingAlertId === alert.id;
                    const wasSent = sentAlertId === alert.id;
                    return (
                      <div
                        key={alert.id}
                        className="p-3 border border-slate-200 rounded-xl bg-white flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                              alert.active ? 'bg-emerald-500' : 'bg-slate-300'
                            }`}
                          />
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 truncate">{alert.name}</div>
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              Frecuencia: {alert.schedule} • Hora: {alert.time} • Tipo: {alert.type}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right">
                            <span className="text-[11px] font-semibold text-slate-700 block">
                              Próxima: {alert.nextExecution}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {alert.recipientIds.length} destinatarios
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleSendAlertNow(alert)}
                            disabled={isSending || alert.recipientIds.length === 0}
                            title={alert.recipientIds.length === 0 ? 'No hay destinatarios para esta alerta' : 'Enviar esta alerta ahora'}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold disabled:opacity-50 disabled:cursor-not-allowed ${
                              wasSent ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                            }`}
                          >
                            <Send className="w-3 h-3" />
                            {isSending ? 'Enviando...' : wasSent ? 'Enviada' : 'Enviar ahora'}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 4: Evidencias */}
          {activeTab === 'attachments' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Documentos y Evidencias Adjuntas
                </h4>
                <button
                  type="button"
                  onClick={() => setShowLinkForm((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-semibold cursor-pointer transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Vincular archivo de Drive</span>
                </button>
              </div>

              {showLinkForm && (
                <form onSubmit={handleAddDriveLink} className="p-3 border border-indigo-200 bg-indigo-50/50 rounded-xl space-y-2 text-xs">
                  <input
                    type="text"
                    required
                    value={linkName}
                    onChange={(e) => setLinkName(e.target.value)}
                    placeholder="Nombre del documento (ej: Informe firmado)"
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500"
                  />
                  <input
                    type="url"
                    required
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="https://drive.google.com/file/d/..."
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500"
                  />
                  {linkError && <p className="text-rose-600">{linkError}</p>}
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setShowLinkForm(false)} className="px-3 py-1.5 text-slate-600 hover:bg-white rounded-lg">
                      Cancelar
                    </button>
                    <button type="submit" className="px-3 py-1.5 font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg">
                      Vincular
                    </button>
                  </div>
                </form>
              )}

              {report.attachments.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400 border-2 border-dashed border-slate-200 rounded-xl">
                  No se han vinculado evidencias todavía. Pega el link de Drive del documento (PDF, XLSX, DOCX, etc.).
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {report.attachments.map((att) => (
                    <a
                      key={att.id}
                      href={att.driveUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="p-3 border border-slate-200 rounded-xl bg-white flex items-center justify-between gap-3 text-xs hover:border-indigo-300 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileText className="w-5 h-5 text-indigo-600 shrink-0" />
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 truncate">{att.name}</div>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            Subido por {att.uploadedBy} el {att.uploadedAt}
                          </div>
                        </div>
                      </div>
                      <Download className="w-4 h-4 text-slate-400 shrink-0" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 5: Historial de Trazabilidad */}
          {activeTab === 'history' && (
            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Registro de Auditoría y Trazabilidad (Sección 11)
              </h4>
              <div className="space-y-3 relative before:absolute before:left-3.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200 pl-8">
                {report.history.map((hist, index) => (
                  <div key={index} className="relative bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
                    <div className="absolute -left-8 top-3 w-3 h-3 rounded-full bg-indigo-600 border-2 border-white ring-2 ring-slate-200" />
                    <div className="flex items-center justify-between">
                      <StatusBadge status={hist.status} size="sm" />
                      <span className="text-[10px] font-mono text-slate-400">{hist.date}</span>
                    </div>
                    <p className="font-semibold text-slate-800 mt-1.5">{hist.userName}</p>
                    <p className="text-slate-600 mt-0.5 text-xs bg-white p-2 rounded border border-slate-100">
                      "{hist.comment}"
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
          <span className="text-xs text-slate-500">
            Consecutivo oficial: <strong>{report.consecutive}</strong>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          >
            Cerrar Detalle
          </button>
        </div>
      </div>

      {/* Transition Modal Confirmation */}
      {showTransitionModal && (
        <div className="fixed inset-0 z-60 bg-slate-900/50 backdrop-blur-2xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 p-5 max-w-md w-full space-y-4 animate-in zoom-in-95">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-indigo-600" />
              Transición de Estado: {targetStatus}
            </h3>
            <p className="text-xs text-slate-600">
              Para garantizar la trazabilidad operacional de la Sección 11, indique el motivo o comentario de esta transición:
            </p>
            <textarea
              rows={3}
              value={transitionComment}
              onChange={(e) => setTransitionComment(e.target.value)}
              placeholder="Ejemplo: Se recibieron todas las pruebas técnicas y firmas requeridas..."
              className="w-full p-2.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowTransitionModal(false)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmTransition}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
              >
                Confirmar y Guardar Transición
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
