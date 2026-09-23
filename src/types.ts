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
  name: string;
  schedule: string; // e.g. "5 días antes del vencimiento", "Semanal Lunes"
  time: string; // e.g. "08:00 AM"
  type: 'Preventiva' | 'Vencimiento' | 'Seguimiento' | 'Confirmación';
  recipientIds: string[];
  active: boolean;
  nextExecution: string;
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
  | 'users';
