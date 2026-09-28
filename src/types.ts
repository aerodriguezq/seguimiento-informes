export type ReportStatus =
  | 'Pendientes Evidencias'
  | 'Informe en Elaboración'
  | 'Entregado a Of. Proyectos'
  | 'Enviado';

export type SemaforoStatus = 'vencido' | 'proximo' | 'en_tiempo' | 'no_aplica';

export interface ReportType {
  id: string;
  code: string;
  name: string;
  periodicity: 'Mensual' | 'Bimestral' | 'Trimestral' | 'Semestral' | 'Anual' | 'Único';
  description: string;
  active: boolean;
}

export interface ReportTypeStep {
  id: string;
  typeId: string;
  order: number;
  name: string;
  emailSubject: string;
  isFinal: boolean;
  contactIds: string[];
  // Día del mes en que inicia esta etapa (solo aplica al primer paso; los
  // siguientes inician con la fecha real de la entrega anterior) y día del
  // mes límite para completarla. Ambos opcionales.
  diaInicio?: number | null;
  diaLimite?: number | null;
  // Palabras clave opcionales (separadas por coma) que se suman al asunto
  // en la búsqueda en Gmail, para no depender solo del asunto exacto.
  palabrasClave?: string | null;
}

export interface ReportStageInstance {
  stepId: string;
  stepName: string;
  order: number;
  startDate: string | null;
  dueDate: string | null;
  status: string;
  receivedAt: string | null;
  fromEmail: string | null;
}

export interface Contact {
  id: string;
  name: string;
  email: string;
  role: string;
  company: string;
  phone?: string;
  hasNotificationAlarm: boolean;
  active: boolean;
}

export interface Project {
  id: string;
  name: string;
  bpin: string;
  company: string;
  generalStatus: 'En Ejecución' | 'En Inicio' | 'En Cierre' | 'Suspendido';
  autoAlertsEnabled: boolean;
  applicableTypeIds: string[]; // empty means all available allowed
  startDate: string;
  endDate: string;
  budget?: string;
}

export interface ScheduledAlert {
  id: string;
  projectId?: string;
  projectName?: string;
  reportId?: string;
  stepId?: string;
  name: string;
  schedule: string; // e.g. "5 días antes del vencimiento", "Semanal Lunes"
  time: string; // e.g. "08:00 AM"
  type: 'Preventiva' | 'Vencimiento' | 'Seguimiento' | 'Confirmación';
  recipientIds: string[];
  active: boolean;
  nextExecution: string;
  // Solo para alertas automáticas ligadas a un paso de flujo (reportId +
  // stepId): el asunto que la automatización de detección de entregas busca
  // en Gmail, y los correos desde los que debe llegar.
  emailSubjectBase?: string | null;
  expectedEmailSubject?: string | null;
  expectedFromEmails?: string[];
}

export interface StatusTransition {
  status: ReportStatus;
  date: string;
  userName: string;
  comment: string;
}

export interface ReportAttachment {
  id: string;
  name: string;
  driveUrl: string;
  uploadedAt: string;
  uploadedBy: string;
}

export interface Report {
  id: string;
  consecutive: string; // e.g. "INF-2026-001"
  projectId: string;
  projectName: string;
  projectBpin: string;
  typeId: string;
  typeName: string;
  month: string;
  year: number;
  dueDate: string; // YYYY-MM-DD
  status: ReportStatus;
  contactIds: string[];
  primaryContactId: string;
  observations: string;
  history: StatusTransition[];
  attachments: ReportAttachment[];
  alertRulesCount: number;
  createdAt: string;
  currentStepId?: string;
  currentStepName?: string;
  currentStepIsFinal?: boolean;
  currentStepEmailSubject?: string;
  isWorkflowCompleted?: boolean;
  stageInstances?: ReportStageInstance[];
}

export interface SystemNotification {
  id: string;
  title: string;
  message: string;
  severity: 'critical' | 'warning' | 'info' | 'success';
  timestamp: string;
  read: boolean;
  relatedReportId?: string;
  relatedProjectId?: string;
}

export interface DriveLinks {
  sourceUrl: string;
  destinationUrl: string;
  updatedAt?: string;
}

export type ActiveModule =
  | 'dashboard'
  | 'reports'
  | 'new_report'
  | 'projects'
  | 'project_detail'
  | 'alerts'
  | 'lists'
  | 'drive_links'
  | 'seguimiento'
  | 'peticiones'
  | 'users';

export interface PeticionResponsable {
  id: string;
  name: string;
  email: string;
}

export interface Peticion {
  id: string;
  radicado: string;
  fechaRadicacion: string | null;
  peticionario: string;
  asunto: string;
  areaConsolida: string;
  correoPersonaAsignada: string;
  areasIntervienen: string;
  plazoRespuesta: number | null;
  fechaPlazoRespuesta: string | null;
  fechaRadicadoRespuesta: string | null;
  responsables: PeticionResponsable[];
  createdAt: string;
}
