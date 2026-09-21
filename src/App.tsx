import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ActiveModule,
  Project,
  Report,
  ReportType,
  Contact,
  ScheduledAlert,
  SystemNotification,
  ReportStatus,
  ReportAttachment,
  ReportTypeStep,
} from './types';
import {
  getSemaforoStatus,
} from './data/mockData';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { DashboardView } from './components/dashboard/DashboardView';
import { ReportsListView } from './components/reports/ReportsListView';
import { NewReportWizard } from './components/reports/NewReportWizard';
import { ReportDetailModal } from './components/reports/ReportDetailModal';
import { ProjectsListView } from './components/projects/ProjectsListView';
import { ProjectDetailView } from './components/projects/ProjectDetailView';
import { AlertsView } from './components/alerts/AlertsView';
import { MasterListsView } from './components/master-lists/MasterListsView';
import { DriveLinksView } from './components/drive/DriveLinksView';
import { UsersManagementView, AuthorizedUser } from './components/users/UsersManagementView';
import { useAuth } from './auth/AuthContext';
import { CheckCircle2, Info, X } from 'lucide-react';

const MODULE_ROUTES: Partial<Record<ActiveModule, string>> = {
  dashboard: '/dashboard',
  reports: '/reports',
  projects: '/projects',
  alerts: '/alerts',
  lists: '/lists',
  drive_links: '/drive-links',
  users: '/usuarios',
};

const PATH_TO_MODULE: Partial<Record<string, ActiveModule>> = Object.fromEntries(
  Object.entries(MODULE_ROUTES).map(([mod, path]) => [path, mod as ActiveModule])
);

function mapAlert(a: any): ScheduledAlert {
  return {
    id: String(a.id),
    projectId: a.projectId ? String(a.projectId) : undefined,
    projectName: a.projectName || undefined,
    reportId: a.reportId ? String(a.reportId) : undefined,
    name: a.name,
    schedule: a.schedule,
    time: a.time,
    type: a.type,
    recipientIds: a.recipientIds,
    active: a.active,
    nextExecution: a.nextExecution,
  };
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, canView } = useAuth();

  const canViewModule = (mod: ActiveModule): boolean => {
    if (mod === 'users') return user.isAdmin;
    if (mod === 'dashboard' || mod === 'new_report' || mod === 'project_detail') {
      return mod === 'new_report' ? canView('reports') : mod === 'project_detail' ? canView('projects') : true;
    }
    return canView(mod as any);
  };

  // Global State
  const [activeModule, setActiveModule] = useState<ActiveModule>(
    PATH_TO_MODULE[location.pathname] || 'dashboard'
  );

  // Keep the URL and the active module in sync: routable modules (sidebar's
  // primary sections) get a real path; sub-views like new_report/project_detail
  // stay internal state and don't change the URL.
  const goToModule = (mod: ActiveModule) => {
    if (!canViewModule(mod)) return;
    setActiveModule(mod);
    const path = MODULE_ROUTES[mod];
    if (path && path !== location.pathname) {
      navigate(path);
    }
  };

  useEffect(() => {
    if (location.pathname === '/') {
      navigate('/dashboard', { replace: true });
      return;
    }
    const matched = PATH_TO_MODULE[location.pathname];
    if (matched && canViewModule(matched)) {
      setActiveModule(matched);
    } else {
      navigate('/dashboard', { replace: true });
    }
  }, [location.pathname]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [reportTypes, setReportTypes] = useState<ReportType[]>([]);
  const [reportTypeSteps, setReportTypeSteps] = useState<ReportTypeStep[]>([]);
  const [authorizedUsers, setAuthorizedUsers] = useState<AuthorizedUser[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [alerts, setAlerts] = useState<ScheduledAlert[]>([]);
  const [notifications, setNotifications] = useState<SystemNotification[]>([]);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  // Context & Selections
  const [currentProjectId, setCurrentProjectId] = useState<string>('');
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [reportsFilterStatus, setReportsFilterStatus] = useState<string>('all');
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [toastMessage, setToastMessage] = useState<{ id: string; text: string; type: 'success' | 'info' } | null>(null);

  const showToast = (text: string, type: 'success' | 'info' = 'success') => {
    setToastMessage({ id: String(Date.now()), text, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  useEffect(() => {
    const loadWorkspace = async () => {
      try {
        const [projectsResponse, catalogsResponse, reportsResponse, alertsResponse] = await Promise.all([
          fetch('/api/projects'),
          fetch('/api/catalogs'),
          fetch('/api/reports'),
          fetch('/api/alerts'),
        ]);
        const projectsPayload = await projectsResponse.json();
        const catalogsPayload = await catalogsResponse.json();
        const reportsPayload = await reportsResponse.json();
        const alertsPayload = await alertsResponse.json();

        if (!projectsResponse.ok) {
          throw new Error(projectsPayload.errors?.[0] || 'No fue posible consultar los proyectos.');
        }
        if (!catalogsResponse.ok) {
          throw new Error(catalogsPayload.errors?.[0] || 'No fue posible consultar los catálogos.');
        }
        if (!reportsResponse.ok) {
          throw new Error(reportsPayload.errors?.[0] || 'No fue posible consultar los informes.');
        }
        if (!alertsResponse.ok) {
          throw new Error(alertsPayload.errors?.[0] || 'No fue posible consultar las alertas.');
        }

        const loadedProjects: Project[] = projectsPayload.data.map((project: {
          id: string | number;
          name: string;
          bpin: string;
          company_name: string;
          applicable_type_ids: Array<string | number>;
          startDate: string | null;
          endDate: string | null;
        }) => ({
          id: String(project.id),
          name: project.name,
          bpin: project.bpin,
          company: project.company_name,
          generalStatus: 'En Inicio',
          autoAlertsEnabled: false,
          applicableTypeIds: project.applicable_type_ids.map(String),
          startDate: project.startDate || '',
          endDate: project.endDate || '',
        }));

        const loadedReports: Report[] = reportsPayload.data.map((report: any) => ({
          id: String(report.id),
          consecutive: report.consecutive || '',
          projectId: String(report.projectId),
          projectName: report.projectName,
          projectBpin: report.projectBpin,
          typeId: String(report.typeId),
          typeName: report.typeName,
          month: report.month,
          year: report.year,
          dueDate: report.dueDate,
          status: report.status,
          contactIds: report.contactIds,
          primaryContactId: report.primaryContactId,
          observations: report.observations,
          history: report.history.map((h: any) => ({ status: h.status, date: h.date, userName: h.userName, comment: h.comment })),
          attachments: report.attachments.map((a: any) => ({ id: String(a.id), name: a.name, driveUrl: a.driveUrl, uploadedAt: a.uploadedAt, uploadedBy: a.uploadedBy })),
          alertRulesCount: report.alertRulesCount,
          createdAt: report.createdAt,
          currentStepId: report.currentStepId ? String(report.currentStepId) : undefined,
          currentStepName: report.currentStepName || undefined,
          currentStepIsFinal: report.currentStepIsFinal ?? undefined,
          currentStepEmailSubject: report.currentStepEmailSubject || undefined,
          isWorkflowCompleted: report.isWorkflowCompleted ?? undefined,
        }));

        const loadedAlerts: ScheduledAlert[] = alertsPayload.data.map(mapAlert);

        setProjects(loadedProjects);
        setReportTypes(catalogsPayload.data.reportTypes);
        setReportTypeSteps(catalogsPayload.data.reportTypeSteps || []);
        setAuthorizedUsers(catalogsPayload.data.authorizedUsers || []);
        setContacts(catalogsPayload.data.contacts);
        setReports(loadedReports);
        setAlerts(loadedAlerts);
        setCurrentProjectId((currentId) => currentId || loadedProjects[0]?.id || '');
        setWorkspaceError(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No fue posible cargar el espacio de trabajo.';
        setWorkspaceError(message);
        showToast(message, 'info');
      } finally {
        setIsLoadingWorkspace(false);
      }
    };

    void loadWorkspace();
  }, []);

  const currentProject = projects.find((p) => p.id === currentProjectId) || null;

  // Counts for sidebar
  const pendingReportsCount = reports.filter((r) => r.status !== 'Enviado').length;
  const urgentReportsCount = reports.filter((r) => {
    const s = getSemaforoStatus(r.dueDate, r.status);
    return s === 'vencido' || s === 'proximo';
  }).length;
  const activeAlertsCount = alerts.filter((a) => a.active).length;

  // Handlers
  const handleSelectProjectFromHeader = (projId: string) => {
    setCurrentProjectId(projId);
    showToast(`Proyecto activo cambiado a: ${projects.find((p) => p.id === projId)?.name}`, 'info');
  };

  const handleNavigateToReport = (reportId: string) => {
    setSelectedReportId(reportId);
  };

  const handleOpenNewReport = (preselectedProjId?: string) => {
    if (preselectedProjId) {
      setCurrentProjectId(preselectedProjId);
    }
    goToModule('new_report');
  };

  const handleViewAllReports = (filterStatus?: ReportStatus | 'vencidos' | 'proximos') => {
    setReportsFilterStatus(filterStatus || 'all');
    goToModule('reports');
  };

  const handleSelectProjectDetail = (projId: string) => {
    setCurrentProjectId(projId);
    goToModule('project_detail');
  };

  const handleCreateProject = async (projectInput: { name: string; bpin: string; company: string }) => {
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(projectInput),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.errors?.[0] || 'No fue posible crear el proyecto.');
    }

    const project = payload.data;
    setProjects((prev) => [
      {
        id: String(project.id),
        name: project.name,
        bpin: project.bpin,
        company: project.company_name,
        generalStatus: 'En Inicio',
        autoAlertsEnabled: false,
        applicableTypeIds: [],
        startDate: '',
        endDate: '',
      },
      ...prev,
    ]);
    showToast('Proyecto registrado en Neon.', 'success');
  };

  // Report creation
  const handleSubmitNewReport = async (input: {
    projectId: string;
    typeId: string;
    month: string;
    year: number;
    dueDate: string;
    status: ReportStatus;
    contactIds: string[];
    primaryContactId: string;
    observations: string;
    attachments: ReportAttachment[];
  }) => {
    const response = await fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.errors?.[0] || 'No fue posible crear el informe.');

    let newReport: Report = payload.data;
    for (const attachment of input.attachments) {
      const attachResponse = await fetch('/api/reports', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'attachment', reportId: newReport.id, attachment }),
      });
      const attachPayload = await attachResponse.json();
      if (attachResponse.ok) newReport = attachPayload.data;
    }

    setReports((prev) => [newReport, ...prev]);
    goToModule('reports');
    setSelectedReportId(newReport.id);
    showToast(`Informe ${newReport.consecutive} creado y registrado con éxito.`, 'success');

    const newNotif: SystemNotification = {
      id: `notif-${Date.now()}`,
      title: `Nuevo Informe Registrado: ${newReport.consecutive}`,
      message: `Se registró el informe "${newReport.typeName}" para el proyecto ${newReport.projectName}.`,
      severity: 'info',
      timestamp: 'Justo ahora',
      read: false,
      relatedReportId: newReport.id,
      relatedProjectId: newReport.projectId,
    };
    setNotifications([newNotif, ...notifications]);
  };

  // Report status transition
  const handleUpdateReportStatus = async (reportId: string, newStatus: ReportStatus, comment: string) => {
    try {
      const response = await fetch('/api/reports', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status', reportId, status: newStatus, comment }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.errors?.[0] || 'No fue posible actualizar el estado.');
      setReports((prev) => prev.map((rep) => (rep.id === reportId ? payload.data : rep)));
      showToast(`Estado del informe actualizado a "${newStatus}" con trazabilidad.`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No fue posible actualizar el estado.', 'info');
    }
  };

  const handleAddReportAttachment = async (reportId: string, attachment: ReportAttachment) => {
    try {
      const response = await fetch('/api/reports', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'attachment', reportId, attachment }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.errors?.[0] || 'No fue posible adjuntar el archivo.');
      setReports((prev) => prev.map((rep) => (rep.id === reportId ? payload.data : rep)));
      showToast(`Archivo "${attachment.name}" adjuntado correctamente.`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No fue posible adjuntar el archivo.', 'info');
    }
  };

  const handleAdvanceReportStep = async (reportId: string) => {
    try {
      const response = await fetch('/api/reports', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'advance_step', reportId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.errors?.[0] || 'No fue posible avanzar el paso.');
      setReports((prev) => prev.map((rep) => (rep.id === reportId ? payload.data : rep)));

      const alertsResponse = await fetch('/api/alerts');
      const alertsPayload = await alertsResponse.json();
      if (alertsResponse.ok) {
        setAlerts(alertsPayload.data.map(mapAlert));
      }
      showToast('Paso del flujo actualizado. Las alertas del paso anterior se detuvieron.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No fue posible avanzar el paso.', 'info');
    }
  };

  // Project settings
  const handleToggleProjectAutoAlerts = (projectId: string) => {
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== projectId) return p;
        const newState = !p.autoAlertsEnabled;
        showToast(
          newState
            ? `Alertas automáticas activadas para ${p.name}`
            : `Alertas automáticas desactivadas para ${p.name}`,
          'info'
        );
        return { ...p, autoAlertsEnabled: newState };
      })
    );
  };

  const handleUpdateProjectApplicableTypes = (projectId: string, newTypeIds: string[]) => {
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== projectId) return p;
        return { ...p, applicableTypeIds: newTypeIds };
      })
    );
    showToast('Configuración de tipos aplicables actualizada para el proyecto.', 'success');
  };

  const handleUpdateProjectVigencia = async (projectId: string, startDate: string, endDate: string) => {
    try {
      const response = await fetch('/api/projects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: projectId, startDate, endDate }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.errors?.[0] || 'No fue posible actualizar la vigencia.');
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, startDate: payload.data.startDate || '', endDate: payload.data.endDate || '' } : p))
      );
      showToast('Vigencia del proyecto actualizada.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No fue posible actualizar la vigencia.', 'info');
    }
  };

  // Alerts
  const handleToggleAlertActive = async (alertId: string) => {
    const current = alerts.find((a) => a.id === alertId);
    if (!current) return;
    const nextActive = !current.active;
    try {
      const response = await fetch('/api/alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertId, active: nextActive }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.errors?.[0] || 'No fue posible actualizar la alerta.');
      setAlerts((prev) => prev.map((a) => (a.id === alertId ? payload.data : a)));
      showToast(nextActive ? `Regla "${current.name}" activada.` : `Regla "${current.name}" pausada.`, 'info');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No fue posible actualizar la alerta.', 'info');
    }
  };

  const handleAddNewAlert = async (draft: {
    projectId?: string;
    name: string;
    schedule: string;
    time: string;
    type: ScheduledAlert['type'];
    recipientIds: string[];
  }) => {
    try {
      const response = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.errors?.[0] || 'No fue posible crear la alerta.');
      setAlerts((prev) => [payload.data, ...prev]);
      showToast(`Regla de alerta "${draft.name}" programada exitosamente.`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No fue posible crear la alerta.', 'info');
      throw error;
    }
  };

  const handleUpdateAlert = async (
    alertId: string,
    draft: {
      projectId?: string;
      name: string;
      schedule: string;
      time: string;
      type: ScheduledAlert['type'];
      recipientIds: string[];
    }
  ) => {
    try {
      const response = await fetch('/api/alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertId, ...draft }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.errors?.[0] || 'No fue posible actualizar la alerta.');
      setAlerts((prev) => prev.map((a) => (a.id === alertId ? payload.data : a)));
      showToast(`Regla de alerta "${draft.name}" actualizada.`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No fue posible actualizar la alerta.', 'info');
      throw error;
    }
  };

  const handleDeleteAlert = async (alertId: string) => {
    try {
      const response = await fetch(`/api/alerts?alertId=${encodeURIComponent(alertId)}`, { method: 'DELETE' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.errors?.[0] || 'No fue posible eliminar la alerta.');
      setAlerts((prev) => prev.filter((a) => a.id !== alertId));
      showToast('Regla de alerta eliminada.', 'info');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No fue posible eliminar la alerta.', 'info');
      throw error;
    }
  };

  const handleSimulateAlertTrigger = async (alert: ScheduledAlert) => {
    const recipients = alert.recipientIds
      .map((id) => contacts.find((contact) => contact.id === id))
      .filter((contact): contact is Contact => Boolean(contact?.email))
      .map((contact) => ({ email: contact.email, name: contact.name }));

    const response = await fetch('/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'send', alert, recipients }),
    });
    const payload = await response.json();

    if (!response.ok) {
      showToast(payload.errors?.[0] || 'No fue posible enviar la alerta.', 'info');
      return;
    }

    const newNotif: SystemNotification = {
      id: `notif-${Date.now()}`,
      title: `Disparo de Alerta: ${alert.name}`,
      message: `Se envió recordatorio a ${alert.recipientIds.length} contacto(s) para el proyecto ${alert.projectName || 'general'}.`,
      severity: alert.type === 'Vencimiento' ? 'critical' : 'warning',
      timestamp: 'Hace un momento',
      read: false,
      relatedProjectId: alert.projectId,
    };
    setNotifications([newNotif, ...notifications]);
    showToast(`Correo enviado por Google Apps Script a ${payload.data.recipientCount} destinatario(s).`, 'success');
  };

  // Notifications
  const handleMarkNotificationAsRead = (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  };

  const handleClearAllNotifications = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    showToast('Todas las notificaciones marcadas como leídas.', 'info');
  };

  // Master Lists
  const handleAddReportType = async (newType: ReportType) => {
    const response = await fetch('/api/catalogs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'reportType', data: newType }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.errors?.[0] || 'No fue posible guardar el tipo de informe.');
    setReportTypes((prev) => [...prev, payload.data]);
    showToast(`Nuevo tipo de informe "${newType.code} - ${newType.name}" agregado.`, 'success');
  };

  const handleAddContact = async (newContact: Contact) => {
    const response = await fetch('/api/catalogs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'contact', data: newContact }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.errors?.[0] || 'No fue posible guardar el contacto.');
    setContacts((prev) => [...prev, payload.data]);
    showToast(`Contacto "${newContact.name}" registrado en la lista maestra.`, 'success');
  };

  const handleAddReportTypeStep = async (step: { typeId: string; name: string; emailSubject: string; isFinal: boolean; contactIds: string[] }) => {
    const response = await fetch('/api/catalogs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'reportTypeStep', data: step }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.errors?.[0] || 'No fue posible guardar el paso.');
    setReportTypeSteps((prev) => [...prev, payload.data]);
    showToast(`Paso "${step.name}" agregado al flujo.`, 'success');
  };

  const handleDeleteReportTypeStep = async (stepId: string) => {
    try {
      const response = await fetch(`/api/catalogs?stepId=${encodeURIComponent(stepId)}`, { method: 'DELETE' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.errors?.[0] || 'No fue posible eliminar el paso.');
      setReportTypeSteps((prev) => prev.filter((s) => s.id !== stepId));
      showToast('Paso eliminado del flujo.', 'info');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No fue posible eliminar el paso.', 'info');
    }
  };

  const handleAddAuthorizedUser = async (email: string, name: string) => {
    const response = await fetch('/api/catalogs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'authorizedUser', data: { email, name } }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.errors?.[0] || 'No fue posible agregar el usuario.');
    setAuthorizedUsers((prev) => [...prev.filter((u) => u.email !== payload.data.email), payload.data]);
    showToast(`Usuario "${email}" autorizado.`, 'success');
  };

  const handleRemoveAuthorizedUser = async (email: string) => {
    try {
      const response = await fetch(`/api/catalogs?kind=authorizedUser&email=${encodeURIComponent(email)}`, { method: 'DELETE' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.errors?.[0] || 'No fue posible quitar el usuario.');
      setAuthorizedUsers((prev) => prev.filter((u) => u.email !== email));
      showToast('Usuario removido de la lista autorizada.', 'info');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No fue posible quitar el usuario.', 'info');
    }
  };

  const handleUpdateAuthorizedUser = async (
    email: string,
    updates: { name?: string; active?: boolean; isAdmin?: boolean; permissions?: Record<string, string> }
  ) => {
    const response = await fetch('/api/catalogs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'authorizedUser', email, ...updates }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.errors?.[0] || 'No fue posible actualizar el usuario.');
    setAuthorizedUsers((prev) => prev.map((u) => (u.email === email ? payload.data : u)));
    showToast(`Usuario "${email}" actualizado.`, 'success');
  };

  const activeReportForModal = reports.find((r) => r.id === selectedReportId);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex font-sans antialiased">
      {/* Sidebar Navigation */}
      <Sidebar
        activeModule={activeModule}
        onSelectModule={(mod) => {
          goToModule(mod);
          if (mod === 'reports') {
            setReportsFilterStatus('all');
          }
        }}
        pendingReportsCount={pendingReportsCount}
        urgentReportsCount={urgentReportsCount}
        activeAlertsCount={activeAlertsCount}
      />

      {/* Main Workspace Column */}
      <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
        {/* Header Bar with Project Selector, Search and Notification Center */}
        <Header
          currentProject={currentProject}
          projects={projects}
          onSelectProject={handleSelectProjectFromHeader}
          notifications={notifications}
          onMarkNotificationAsRead={handleMarkNotificationAsRead}
          onClearAllNotifications={handleClearAllNotifications}
          onNavigateToReport={handleNavigateToReport}
          onOpenNewReport={() => handleOpenNewReport(currentProjectId)}
          onSearchGlobal={(q) => {
            setGlobalSearchQuery(q);
            if (activeModule !== 'reports' && q.trim()) {
              goToModule('reports');
            }
          }}
          searchQuery={globalSearchQuery}
        />

        {/* Dynamic Main Content Container */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto">
          {isLoadingWorkspace && (
            <div className="mx-auto max-w-7xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
              <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" />
              <p className="text-sm font-semibold text-slate-800">Cargando espacio de trabajo</p>
              <p className="mt-1 text-xs text-slate-500">Conectando proyectos y catálogos con Neon.</p>
            </div>
          )}
          {!isLoadingWorkspace && workspaceError && (
            <div className="mx-auto max-w-7xl rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center">
              <p className="text-sm font-semibold text-rose-900">No se pudo cargar la información</p>
              <p className="mt-1 text-xs text-rose-700">{workspaceError}</p>
            </div>
          )}
          {/* M01: Dashboard */}
          {!isLoadingWorkspace && !workspaceError && activeModule === 'dashboard' && (
            <DashboardView
              projects={projects}
              reports={reports}
              alerts={alerts}
              onSelectProjectDetail={handleSelectProjectDetail}
              onSelectReportDetail={handleNavigateToReport}
              onOpenNewReport={() => handleOpenNewReport(currentProjectId)}
              onViewAllReports={handleViewAllReports}
            />
          )}

          {/* M02: Listado de Informes */}
          {!isLoadingWorkspace && !workspaceError && activeModule === 'reports' && (
            <ReportsListView
              reports={reports}
              projects={projects}
              reportTypes={reportTypes}
              contacts={contacts}
              onSelectReport={handleNavigateToReport}
              onOpenNewReport={() => handleOpenNewReport(currentProjectId)}
              initialFilterStatus={reportsFilterStatus}
            />
          )}

          {/* M03: Nuevo Informe Wizard */}
          {!isLoadingWorkspace && !workspaceError && activeModule === 'new_report' && (
            <NewReportWizard
              projects={projects}
              reportTypes={reportTypes}
              contacts={contacts}
              preselectedProjectId={currentProjectId}
              onCancel={() => goToModule('reports')}
              onSubmitReport={handleSubmitNewReport}
            />
          )}

          {/* M05: Proyectos */}
          {!isLoadingWorkspace && !workspaceError && activeModule === 'projects' && (
            <ProjectsListView
              projects={projects}
              reports={reports}
              reportTypes={reportTypes}
              onSelectProject={handleSelectProjectDetail}
              onOpenNewReportForProject={handleOpenNewReport}
              onCreateProject={handleCreateProject}
            />
          )}

          {/* M06: Detalle de Proyecto (Rediseño de la pantalla analizada) */}
          {!isLoadingWorkspace && !workspaceError && activeModule === 'project_detail' && !currentProject && (
            <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
              <p className="text-sm font-semibold text-slate-800">Selecciona un proyecto primero</p>
              <p className="mt-1 text-xs text-slate-500">Elige un proyecto desde la Cartera de Proyectos para ver su detalle.</p>
              <button
                type="button"
                onClick={() => goToModule('projects')}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-teal-800"
              >
                Ir a Proyectos
              </button>
            </div>
          )}
          {!isLoadingWorkspace && !workspaceError && activeModule === 'project_detail' && currentProject && (
            <ProjectDetailView
              project={currentProject}
              reports={reports}
              reportTypes={reportTypes}
              alerts={alerts}
              contacts={contacts}
              onBackToProjects={() => goToModule('projects')}
              onOpenNewReport={handleOpenNewReport}
              onSelectReport={handleNavigateToReport}
              onToggleProjectAutoAlerts={handleToggleProjectAutoAlerts}
              onUpdateProjectApplicableTypes={handleUpdateProjectApplicableTypes}
              onUpdateProjectVigencia={handleUpdateProjectVigencia}
              onToggleAlertRuleActive={handleToggleAlertActive}
              onAddNewAlertRule={handleAddNewAlert}
              onViewAllReports={() => handleViewAllReports()}
            />
          )}

          {/* M07: Alertas */}
          {!isLoadingWorkspace && !workspaceError && activeModule === 'alerts' && (
            <AlertsView
              alerts={alerts}
              projects={projects}
              contacts={contacts}
              onToggleAlertActive={handleToggleAlertActive}
              onAddNewAlert={handleAddNewAlert}
              onUpdateAlert={handleUpdateAlert}
              onDeleteAlert={handleDeleteAlert}
              onSimulateTrigger={handleSimulateAlertTrigger}
            />
          )}

          {/* M08: Listas Maestras */}
          {!isLoadingWorkspace && !workspaceError && activeModule === 'lists' && (
            <MasterListsView
              reportTypes={reportTypes}
              contacts={contacts}
              reportTypeSteps={reportTypeSteps}
              onAddReportType={handleAddReportType}
              onAddContact={handleAddContact}
              onAddReportTypeStep={handleAddReportTypeStep}
              onDeleteReportTypeStep={handleDeleteReportTypeStep}
            />
          )}

          {!isLoadingWorkspace && !workspaceError && activeModule === 'drive_links' && <DriveLinksView />}

          {/* M09: Usuarios Autorizados (solo administradores) */}
          {!isLoadingWorkspace && !workspaceError && activeModule === 'users' && user.isAdmin && (
            <UsersManagementView
              users={authorizedUsers}
              currentUserEmail={user.email}
              onAddUser={handleAddAuthorizedUser}
              onUpdateUser={handleUpdateAuthorizedUser}
              onRemoveUser={handleRemoveAuthorizedUser}
            />
          )}
        </main>
      </div>

      {/* M04: Detalle de Informe Modal / Drawer */}
      {activeReportForModal && (
        <ReportDetailModal
          report={activeReportForModal}
          contacts={contacts}
          alerts={alerts}
          onClose={() => setSelectedReportId(null)}
          onUpdateStatus={handleUpdateReportStatus}
          onAddAttachment={handleAddReportAttachment}
          onAdvanceStep={handleAdvanceReportStep}
        />
      )}

      {/* Toast Notification Banner */}
      {toastMessage && (
        <div
          id="app-toast-feedback"
          className={`fixed bottom-5 right-5 z-70 px-4 py-3 rounded-xl shadow-xl border flex items-center gap-2.5 text-xs font-semibold animate-in slide-in-from-bottom-3 duration-200 ${
            toastMessage.type === 'success'
              ? 'bg-slate-900 text-white border-slate-800'
              : 'bg-indigo-900 text-white border-indigo-700'
          }`}
        >
          {toastMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <Info className="w-4 h-4 text-indigo-300 shrink-0" />
          )}
          <span>{toastMessage.text}</span>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="ml-2 text-slate-400 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
