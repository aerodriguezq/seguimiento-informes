import React, { useState } from 'react';
import {
  Report,
  ReportStatus,
  Contact,
  ScheduledAlert,
  ReportAttachment,
} from '../../types';
import {
  calculateDaysRemaining,
  getSemaforoStatus,
  STATUS_SEQUENCE,
} from '../../data/mockData';
import { StatusBadge } from '../common/StatusBadge';
import { SemaforoBadge } from '../common/SemaforoBadge';
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
} from 'lucide-react';

interface ReportDetailModalProps {
  report: Report;
  contacts: Contact[];
  alerts: ScheduledAlert[];
  onClose: () => void;
  onUpdateStatus: (reportId: string, newStatus: ReportStatus, comment: string) => void;
  onAddAttachment: (reportId: string, attachment: ReportAttachment) => void;
}

export const ReportDetailModal: React.FC<ReportDetailModalProps> = ({
  report,
  contacts,
  alerts,
  onClose,
  onUpdateStatus,
  onAddAttachment,
}) => {
  const [showTransitionModal, setShowTransitionModal] = useState(false);
  const [targetStatus, setTargetStatus] = useState<ReportStatus>(report.status);
  const [transitionComment, setTransitionComment] = useState('');
  const [activeTab, setActiveTab] = useState<'timeline' | 'contacts' | 'alerts' | 'attachments' | 'history'>('timeline');

  const daysRemaining = calculateDaysRemaining(report.dueDate, report.status);
  const semaforo = getSemaforoStatus(report.dueDate, report.status);

  // Find assigned contacts
  const assignedContacts = contacts.filter((c) => report.contactIds.includes(c.id));
  const primaryContact = contacts.find((c) => c.id === report.primaryContactId);

  // Related project alerts
  const projectAlerts = alerts.filter((a) => a.projectId === report.projectId);

  // Current state index in cycle
  const currentStepIndex = STATUS_SEQUENCE.indexOf(report.status);

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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    const newAtt: ReportAttachment = {
      id: `att-${Date.now()}`,
      name: file.name,
      size: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
      uploadedAt: new Date().toISOString().slice(0, 10),
      uploadedBy: 'Ing. Alejandro Rodríguez',
    };
    onAddAttachment(report.id, newAtt);
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

          <button
            id="close-report-detail-btn"
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body with Scroll */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Section 10: Horizontal Progress Lifecycle */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Línea de Progreso del Ciclo de Vida del Informe
              </span>
              {currentStepIndex < STATUS_SEQUENCE.length - 1 && (
                <button
                  type="button"
                  onClick={() => handleOpenTransition(STATUS_SEQUENCE[currentStepIndex + 1])}
                  className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                >
                  <span>Avanzar a {STATUS_SEQUENCE[currentStepIndex + 1]}</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Horizontal timeline steps */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 relative">
              {STATUS_SEQUENCE.map((seqStatus, idx) => {
                const isPassed = idx < currentStepIndex;
                const isCurrent = idx === currentStepIndex;
                const isPending = idx > currentStepIndex;

                // Find history transition info for this step if exists
                const transitionItem = report.history.find((h) => h.status === seqStatus);

                return (
                  <div
                    key={seqStatus}
                    className={`p-3 rounded-lg border text-xs flex flex-col justify-between transition-all ${
                      isCurrent
                        ? 'border-indigo-500 bg-white ring-2 ring-indigo-100 shadow-xs'
                        : isPassed
                        ? 'border-emerald-200 bg-emerald-50/50'
                        : 'border-slate-200 bg-slate-100/60 opacity-65'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-bold text-slate-400">PASO {idx + 1}</span>
                        {isPassed && <CheckCircle className="w-4 h-4 text-emerald-600" />}
                        {isCurrent && (
                          <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 animate-pulse" />
                        )}
                      </div>
                      <div
                        className={`font-bold leading-tight ${
                          isCurrent ? 'text-indigo-950' : isPassed ? 'text-emerald-950' : 'text-slate-600'
                        }`}
                      >
                        {seqStatus}
                      </div>
                    </div>

                    <div className="mt-3 pt-2 border-t border-slate-200/60 text-[11px] text-slate-500">
                      {transitionItem ? (
                        <>
                          <div className="font-semibold text-slate-700">{transitionItem.userName}</div>
                          <div className="text-[10px] text-slate-400 mt-0.5">{transitionItem.date}</div>
                        </>
                      ) : (
                        <span className="text-slate-400 italic">Pendiente por registrar</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

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
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Contactos y Notificaciones Asignadas
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {assignedContacts.map((contact) => {
                  const isPrimary = contact.id === report.primaryContactId;
                  return (
                    <div
                      key={contact.id}
                      className="p-3.5 border border-slate-200 rounded-xl bg-white flex items-start justify-between gap-3 text-xs"
                    >
                      <div>
                        <div className="font-bold text-slate-900 flex items-center gap-2">
                          <span>{contact.name}</span>
                          {isPrimary && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-indigo-600 text-white">
                              Principal
                            </span>
                          )}
                        </div>
                        <div className="text-slate-600 text-[11px] mt-0.5">
                          {contact.role} • {contact.company}
                        </div>
                        <div className="text-slate-500 text-[11px] mt-1 font-mono">
                          {contact.email} • {contact.phone}
                        </div>
                      </div>
                      <span
                        className={`px-2 py-1 rounded text-[10px] font-semibold flex items-center gap-1 shrink-0 ${
                          contact.hasNotificationAlarm
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        <Bell className="w-3 h-3" />
                        {contact.hasNotificationAlarm ? 'Alarma Activa' : 'Sin Alarma'}
                      </span>
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
                  projectAlerts.map((alert) => (
                    <div
                      key={alert.id}
                      className="p-3 border border-slate-200 rounded-xl bg-white flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                            alert.active ? 'bg-emerald-500' : 'bg-slate-300'
                          }`}
                        />
                        <div>
                          <div className="font-semibold text-slate-900">{alert.name}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            Frecuencia: {alert.schedule} • Hora: {alert.time} • Tipo: {alert.type}
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-[11px] font-semibold text-slate-700 block">
                          Próxima: {alert.nextExecution}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {alert.recipientIds.length} destinatarios
                        </span>
                      </div>
                    </div>
                  ))
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
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-semibold cursor-pointer transition-colors">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Adjuntar Archivo</span>
                  <input type="file" className="hidden" onChange={handleFileUpload} />
                </label>
              </div>

              {report.attachments.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400 border-2 border-dashed border-slate-200 rounded-xl">
                  No se han adjuntado evidencias todavía. Puede subir archivos PDF, XLSX o DOCX.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {report.attachments.map((att) => (
                    <div
                      key={att.id}
                      className="p-3 border border-slate-200 rounded-xl bg-white flex items-center justify-between gap-3 text-xs hover:border-slate-300 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileText className="w-5 h-5 text-indigo-600 shrink-0" />
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 truncate">{att.name}</div>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            {att.size} • Subido por {att.uploadedBy} el {att.uploadedAt}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => alert(`Descargando documento de prueba: ${att.name}`)}
                        className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded-md transition-colors shrink-0"
                        title="Descargar archivo"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
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
