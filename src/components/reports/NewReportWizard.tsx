import React, { useState } from 'react';
import {
  Project,
  ReportType,
  Contact,
  ReportStatus,
  Report,
  ReportAttachment,
} from '../../types';
import { MONTHS_LIST, YEARS_LIST, STATUS_SEQUENCE } from '../../data/mockData';
import {
  Building2,
  FileText,
  Calendar,
  Clock,
  Users,
  Paperclip,
  Check,
  ChevronRight,
  ChevronLeft,
  AlertCircle,
  UploadCloud,
  X,
  Bell,
  BellOff,
  Info,
} from 'lucide-react';

interface NewReportWizardProps {
  projects: Project[];
  reportTypes: ReportType[];
  contacts: Contact[];
  preselectedProjectId?: string;
  onCancel: () => void;
  onSubmitReport: (newReport: Report) => void;
}

export const NewReportWizard: React.FC<NewReportWizardProps> = ({
  projects,
  reportTypes,
  contacts,
  preselectedProjectId,
  onCancel,
  onSubmitReport,
}) => {
  const [currentStep, setCurrentStep] = useState(1);

  // Form states
  const [selectedProjectId, setSelectedProjectId] = useState(
    preselectedProjectId || (projects[0]?.id || '')
  );
  const [selectedTypeId, setSelectedTypeId] = useState('');
  const [selectedMonth, setSelectedMonth] = useState('Septiembre');
  const [selectedYear, setSelectedYear] = useState(2026);
  const [dueDate, setDueDate] = useState('2026-09-30');
  const [status, setStatus] = useState<ReportStatus>('Pendientes Evidencias');
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [primaryContactId, setPrimaryContactId] = useState('');
  const [alarmPreferences, setAlarmPreferences] = useState<Record<string, boolean>>({});
  const [observations, setObservations] = useState('');
  const [attachments, setAttachments] = useState<ReportAttachment[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  // Selected project info
  const currentProject = projects.find((p) => p.id === selectedProjectId);

  // Applicable report types rule (Sección 11)
  // If project has no types defined, it allows all available types; rule must be shown explicitly.
  const applicableTypes = React.useMemo(() => {
    if (!currentProject) return reportTypes;
    if (!currentProject.applicableTypeIds || currentProject.applicableTypeIds.length === 0) {
      return reportTypes; // allows all
    }
    return reportTypes.filter((t) => currentProject.applicableTypeIds.includes(t.id));
  }, [currentProject, reportTypes]);

  const allowsAllTypes = !currentProject?.applicableTypeIds || currentProject.applicableTypeIds.length === 0;

  // Auto select first type if current selection is invalid
  React.useEffect(() => {
    if (applicableTypes.length > 0 && (!selectedTypeId || !applicableTypes.find((t) => t.id === selectedTypeId))) {
      setSelectedTypeId(applicableTypes[0].id);
    }
  }, [applicableTypes, selectedTypeId]);

  const toggleContact = (contactId: string) => {
    if (selectedContactIds.includes(contactId)) {
      setSelectedContactIds(selectedContactIds.filter((id) => id !== contactId));
      if (primaryContactId === contactId) {
        setPrimaryContactId('');
      }
    } else {
      setSelectedContactIds([...selectedContactIds, contactId]);
      if (!primaryContactId) {
        setPrimaryContactId(contactId);
      }
      setAlarmPreferences((prev) => ({
        ...prev,
        [contactId]: true, // Default with alarm
      }));
    }
  };

  const toggleContactAlarm = (contactId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setAlarmPreferences((prev) => ({
      ...prev,
      [contactId]: !prev[contactId],
    }));
  };

  // Mock file attachment handler
  const handleSimulatedFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    const newAtt: ReportAttachment = {
      id: `att-${Date.now()}`,
      name: file.name,
      size: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
      uploadedAt: '2026-09-14',
      uploadedBy: 'Ing. Alejandro Rodríguez',
    };
    setAttachments([...attachments, newAtt]);
  };

  const removeAttachment = (id: string) => {
    setAttachments(attachments.filter((a) => a.id !== id));
  };

  const steps = [
    { num: 1, title: 'Proyecto' },
    { num: 2, title: 'Tipo' },
    { num: 3, title: 'Período' },
    { num: 4, title: 'Vencimiento' },
    { num: 5, title: 'Estado' },
    { num: 6, title: 'Responsables' },
    { num: 7, title: 'Evidencias' },
  ];

  const handleNext = () => {
    setErrorMsg('');
    if (currentStep === 1 && !selectedProjectId) {
      setErrorMsg('Debe seleccionar un proyecto.');
      return;
    }
    if (currentStep === 2 && !selectedTypeId) {
      setErrorMsg('Debe seleccionar un tipo de informe aplicable.');
      return;
    }
    if (currentStep === 4 && !dueDate) {
      setErrorMsg('Debe indicar una fecha de entrega / vencimiento.');
      return;
    }
    if (currentStep === 6 && selectedContactIds.length === 0) {
      setErrorMsg('Debe seleccionar al menos un contacto o responsable.');
      return;
    }
    setCurrentStep((prev) => Math.min(prev + 1, 7));
  };

  const handlePrev = () => {
    setErrorMsg('');
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  const handleSubmit = () => {
    if (!currentProject) return;
    const selectedType = reportTypes.find((t) => t.id === selectedTypeId);
    const newConsecutive = `INF-2026-${Math.floor(100 + Math.random() * 900)}`;

    const newReport: Report = {
      id: `rep-${Date.now()}`,
      consecutive: newConsecutive,
      projectId: currentProject.id,
      projectName: currentProject.name,
      projectBpin: currentProject.bpin,
      typeId: selectedTypeId,
      typeName: selectedType ? selectedType.name : 'Informe General',
      month: selectedMonth,
      year: selectedYear,
      dueDate: dueDate,
      status: status,
      contactIds: selectedContactIds,
      primaryContactId: primaryContactId || selectedContactIds[0] || '',
      observations: observations.trim() || 'Apertura de informe para seguimiento del cronograma contractual.',
      attachments: attachments,
      alertRulesCount: 2,
      createdAt: '2026-09-14',
      history: [
        {
          status: status,
          date: '2026-09-14 09:30',
          userName: 'Ing. Alejandro Rodríguez',
          comment: observations.trim() || 'Creación inicial del informe mediante el asistente guiado.',
        },
      ],
    };

    onSubmitReport(newReport);
  };

  return (
    <div id="new-report-wizard-container" className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            Crear Nuevo Informe de Seguimiento
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Formulario guiado con validación de tipos aplicables, cronograma y asignación de responsables.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
        >
          Cancelar
        </button>
      </div>

      {/* Stepper Progress Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
        <div className="flex items-center justify-between">
          {steps.map((step, idx) => {
            const isCompleted = currentStep > step.num;
            const isCurrent = currentStep === step.num;
            return (
              <React.Fragment key={step.num}>
                <div className="flex flex-col items-center">
                  <button
                    type="button"
                    onClick={() => {
                      if (step.num < currentStep) setCurrentStep(step.num);
                    }}
                    disabled={step.num > currentStep}
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                      isCompleted
                        ? 'bg-emerald-600 text-white cursor-pointer'
                        : isCurrent
                        ? 'bg-indigo-600 text-white ring-4 ring-indigo-100'
                        : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    {isCompleted ? <Check className="w-4 h-4" /> : step.num}
                  </button>
                  <span
                    className={`text-[11px] mt-1.5 font-medium whitespace-nowrap hidden sm:block ${
                      isCurrent ? 'text-indigo-600 font-bold' : isCompleted ? 'text-slate-700' : 'text-slate-400'
                    }`}
                  >
                    {step.title}
                  </span>
                </div>
                {idx < steps.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-2 transition-colors ${
                      currentStep > step.num ? 'bg-emerald-500' : 'bg-slate-200'
                    }`}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Error notification if any */}
      {errorMsg && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Step Content Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs min-h-96 flex flex-col justify-between">
        <div>
          {/* STEP 1: Proyecto */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-indigo-600" />
                  Paso 1: Seleccione el Proyecto
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  El proyecto seleccionado determinará los tipos de informe permitidos y las reglas de alertas asociadas.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                {projects.map((proj) => {
                  const isSelected = selectedProjectId === proj.id;
                  return (
                    <div
                      key={proj.id}
                      id={`wizard-project-${proj.id}`}
                      onClick={() => setSelectedProjectId(proj.id)}
                      className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                        isSelected
                          ? 'border-indigo-600 bg-indigo-50/30 shadow-xs'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-semibold text-xs text-slate-900 line-clamp-1">
                          {proj.name}
                        </div>
                        {isSelected && <Check className="w-4 h-4 text-indigo-600 shrink-0" />}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1">
                        BPIN: <strong className="font-mono text-slate-700">{proj.bpin}</strong>
                      </div>
                      <div className="text-[11px] text-slate-600 mt-0.5 truncate">
                        {proj.company}
                      </div>
                      <div className="mt-2.5 flex items-center justify-between text-[10px]">
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded">
                          {proj.generalStatus}
                        </span>
                        <span className="text-indigo-600 font-medium">
                          {proj.applicableTypeIds.length > 0
                            ? `${proj.applicableTypeIds.length} tipos permitidos`
                            : 'Todos los tipos permitidos'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 2: Tipo de informe */}
          {currentStep === 2 && (
            <div className="space-y-4">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-indigo-600" />
                  Paso 2: Tipo de Informe Aplicable
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Tipos configurados y permitidos específicamente para <strong>{currentProject?.name}</strong>.
                </p>
              </div>

              {/* Explicit Business Rule Banner (Sección 11) */}
              {allowsAllTypes ? (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800 flex items-start gap-2">
                  <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    <strong>Regla de negocio activa:</strong> Este proyecto no tiene tipos de informe restringidos en su configuración. El sistema permite seleccionar libremente cualquier tipo del catálogo maestro.
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 flex items-start gap-2">
                  <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  <div>
                    Mostrando únicamente los <strong>{applicableTypes.length} tipos de informe</strong> formalmente autorizados para este contrato.
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                {applicableTypes.map((type) => {
                  const isSelected = selectedTypeId === type.id;
                  return (
                    <div
                      key={type.id}
                      id={`wizard-type-${type.id}`}
                      onClick={() => setSelectedTypeId(type.id)}
                      className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                        isSelected
                          ? 'border-indigo-600 bg-indigo-50/40 shadow-xs'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                          {type.code}
                        </span>
                        <span className="text-[10px] text-slate-500 font-medium bg-slate-100 px-2 py-0.5 rounded">
                          {type.periodicity}
                        </span>
                      </div>
                      <div className="font-semibold text-xs text-slate-900 mt-2">
                        {type.name}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1 line-clamp-2">
                        {type.description}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 3: Período estructurado */}
          {currentStep === 3 && (
            <div className="space-y-4">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-indigo-600" />
                  Paso 3: Período de Corte del Informe
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Especifique el mes y año contable/físico que reporta este documento.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Mes reportado
                  </label>
                  <select
                    id="wizard-period-month"
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
                  >
                    {MONTHS_LIST.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Año de vigencia
                  </label>
                  <select
                    id="wizard-period-year"
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
                  >
                    {YEARS_LIST.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl mt-4">
                <span className="text-xs text-slate-500 block">Identificación del corte:</span>
                <span className="text-sm font-bold text-slate-800 mt-0.5 block">
                  Informe correspondiente a: {selectedMonth} de {selectedYear}
                </span>
              </div>
            </div>
          )}

          {/* STEP 4: Fecha de vencimiento / límite */}
          {currentStep === 4 && (
            <div className="space-y-4">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-indigo-600" />
                  Paso 4: Fecha Límite de Entrega
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Fecha máxima contractual para radicar este informe ante la oficina de proyectos o ente supervisor.
                </p>
              </div>

              <div className="max-w-md space-y-3">
                <label className="block text-xs font-semibold text-slate-700">
                  Fecha de compromiso (YYYY-MM-DD)
                </label>
                <input
                  id="wizard-due-date"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
                />

                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                  <strong>Impacto de alerta:</strong> A partir de esta fecha, el sistema evaluará automáticamente las reglas programadas de aviso preventivo (5 días antes) y alerta crítica de vencimiento.
                </div>
              </div>
            </div>
          )}

          {/* STEP 5: Estado Inicial */}
          {currentStep === 5 && (
            <div className="space-y-4">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-indigo-600" />
                  Paso 5: Estado Inicial del Informe
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Indique en qué etapa del ciclo de vida se crea este registro (por defecto: Pendientes Evidencias).
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                {STATUS_SEQUENCE.map((s) => {
                  const isSelected = status === s;
                  return (
                    <div
                      key={s}
                      id={`wizard-status-${s}`}
                      onClick={() => setStatus(s)}
                      className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                        isSelected
                          ? 'border-indigo-600 bg-indigo-50/30 shadow-xs'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-slate-900">{s}</span>
                        {isSelected && <Check className="w-4 h-4 text-indigo-600" />}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1.5">
                        {s === 'Pendientes Evidencias' && 'Se esperan certificaciones, firmas o ensayos del contratista.'}
                        {s === 'Informe en Elaboración' && 'Equipo técnico redactando el documento y cuadros de soporte.'}
                        {s === 'Entregado a Of. Proyectos' && 'Radicado formalmente para revisión y aprobación.'}
                        {s === 'Enviado' && 'Aprobado y remitido al cliente o entidad contratante.'}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 6: Responsables y alarmas */}
          {currentStep === 6 && (
            <div className="space-y-4">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Users className="w-4 h-4 text-indigo-600" />
                  Paso 6: Contactos y Responsables Asignados
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Seleccione los responsables directos y configure si deben recibir alarmas de notificación automáticas por correo.
                </p>
              </div>

              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {contacts.map((contact) => {
                  const isSelected = selectedContactIds.includes(contact.id);
                  const hasAlarm = alarmPreferences[contact.id] ?? true;
                  const isPrimary = primaryContactId === contact.id;

                  return (
                    <div
                      key={contact.id}
                      id={`wizard-contact-${contact.id}`}
                      onClick={() => toggleContact(contact.id)}
                      className={`p-3 rounded-lg border flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                        isSelected
                          ? 'border-indigo-300 bg-indigo-50/40'
                          : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}} // Handled by container
                          className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                        />
                        <div>
                          <div className="text-xs font-semibold text-slate-900 flex items-center gap-2">
                            <span>{contact.name}</span>
                            {isPrimary && (
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-indigo-600 text-white">
                                Principal
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {contact.role} • {contact.company} ({contact.email})
                          </div>
                        </div>
                      </div>

                      {/* Right: Alarm toggle and primary button */}
                      {isSelected && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => toggleContactAlarm(contact.id, e)}
                            className={`p-1.5 rounded-md text-xs font-medium flex items-center gap-1 transition-colors ${
                              hasAlarm
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-slate-200 text-slate-600'
                            }`}
                            title={hasAlarm ? 'Alarma activa: Recibirá avisos automáticos' : 'Sin alarma'}
                          >
                            {hasAlarm ? (
                              <>
                                <Bell className="w-3.5 h-3.5 text-emerald-700" />
                                <span className="text-[10px]">Con alarma</span>
                              </>
                            ) : (
                              <>
                                <BellOff className="w-3.5 h-3.5 text-slate-500" />
                                <span className="text-[10px]">Sin alarma</span>
                              </>
                            )}
                          </button>

                          {!isPrimary && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPrimaryContactId(contact.id);
                              }}
                              className="text-[10px] text-indigo-600 hover:text-indigo-800 font-semibold p-1 hover:bg-indigo-100/60 rounded"
                            >
                              Hacer principal
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 7: Observaciones y Evidencias */}
          {currentStep === 7 && (
            <div className="space-y-4">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Paperclip className="w-4 h-4 text-indigo-600" />
                  Paso 7: Observaciones y Archivos de Evidencia
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Ingrese anotaciones iniciales y adjunte documentos preliminares (actas, memorandos o borradores).
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Observaciones / Alcance del informe
                </label>
                <textarea
                  id="wizard-observations-input"
                  rows={3}
                  value={observations}
                  onChange={(e) => setObservations(e.target.value)}
                  placeholder="Escriba aquí los compromisos, fuentes de información requeridas o detalles relevantes..."
                  className="w-full p-2.5 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
                />
              </div>

              {/* Upload area */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-700">
                  Evidencias adjuntas
                </label>
                <label
                  id="wizard-file-dropzone"
                  className="border-2 border-dashed border-slate-200 hover:border-indigo-400 rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer transition-colors bg-slate-50/50 hover:bg-indigo-50/20"
                >
                  <UploadCloud className="w-8 h-8 text-indigo-600 mb-1" />
                  <span className="text-xs font-semibold text-slate-800">
                    Haga clic o arrastre archivos aquí
                  </span>
                  <span className="text-[11px] text-slate-400 mt-0.5">
                    Formatos admitidos: PDF, XLSX, DOCX, ZIP (Máx. 50 MB)
                  </span>
                  <input
                    type="file"
                    className="hidden"
                    onChange={handleSimulatedFileUpload}
                  />
                </label>

                {/* Uploaded attachments list */}
                {attachments.length > 0 && (
                  <div className="space-y-1.5 pt-2">
                    {attachments.map((att) => (
                      <div
                        key={att.id}
                        className="flex items-center justify-between p-2 bg-slate-100 rounded-lg text-xs"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <Paperclip className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          <span className="font-medium text-slate-800 truncate">{att.name}</span>
                          <span className="text-[10px] text-slate-400">({att.size})</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeAttachment(att.id)}
                          className="text-slate-400 hover:text-rose-600 p-1"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Wizard Footer Buttons */}
        <div className="flex items-center justify-between pt-6 border-t border-slate-100 mt-6">
          <button
            type="button"
            onClick={currentStep === 1 ? onCancel : handlePrev}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>{currentStep === 1 ? 'Cancelar' : 'Anterior'}</span>
          </button>

          {currentStep < 7 ? (
            <button
              id="wizard-next-step-btn"
              type="button"
              onClick={handleNext}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-xs cursor-pointer"
            >
              <span>Siguiente</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              id="wizard-submit-report-btn"
              type="button"
              onClick={handleSubmit}
              className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors shadow-xs cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>Crear y Registrar Informe</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
