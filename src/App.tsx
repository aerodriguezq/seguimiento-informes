import React, { useState } from 'react';
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
} from './types';
import {
  INITIAL_PROJECTS,
  INITIAL_REPORTS,
  INITIAL_REPORT_TYPES,
  INITIAL_CONTACTS,
  INITIAL_SCHEDULED_ALERTS,
  INITIAL_NOTIFICATIONS,
  calculateDaysRemaining,
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
import { CheckCircle2, Info, X } from 'lucide-react';

export default function App() {
  // Global State
  const [activeModule, setActiveModule] = useState<ActiveModule>('dashboard');
  const [projects, setProjects] = useState<Project[]>(INITIAL_PROJECTS);
  const [reports, setReports] = useState<Report[]>(INITIAL_REPORTS);
  const [reportTypes, setReportTypes] = useState<ReportType[]>(INITIAL_REPORT_TYPES);
  const [contacts, setContacts] = useState<Contact[]>(INITIAL_CONTACTS);
  const [alerts, setAlerts] = useState<ScheduledAlert[]>(INITIAL_SCHEDULED_ALERTS);
  const [notifications, setNotifications] = useState<SystemNotification[]>(INITIAL_NOTIFICATIONS);

  // Context & Selections
  const [currentProjectId, setCurrentProjectId] = useState<string>(INITIAL_PROJECTS[0].id);
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
    setActiveModule('new_report');
  };

  const handleViewAllReports = (filterStatus?: ReportStatus | 'vencidos' | 'proximos') => {
    setReportsFilterStatus(filterStatus || 'all');
    setActiveModule('reports');
  };

  const handleSelectProjectDetail = (projId: string) => {
    setCurrentProjectId(projId);
    setActiveModule('project_detail');
  };

  // Report creation
  const handleSubmitNewReport = (newReport: Report) => {
    setReports([newReport, ...reports]);
    setActiveModule('reports');
    setSelectedReportId(newReport.id);
    showToast(`Informe ${newReport.consecutive} creado y registrado con éxito.`, 'success');

    // Add notification
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
  const handleUpdateReportStatus = (reportId: string, newStatus: ReportStatus, comment: string) => {
    setReports((prev) =>
      prev.map((rep) => {
        if (rep.id !== reportId) return rep;
        const newHistoryItem = {
          status: newStatus,
          date: '2026-09-14 10:15',
          userName: 'Ing. Alejandro Rodríguez',
          comment,
        };
        return {
          ...rep,
          status: newStatus,
          history: [...rep.history, newHistoryItem],
        };
      })
    );
    showToast(`Estado del informe actualizado a "${newStatus}" con trazabilidad.`, 'success');
  };

  const handleAddReportAttachment = (reportId: string, attachment: ReportAttachment) => {
    setReports((prev) =>
      prev.map((rep) => {
        if (rep.id !== reportId) return rep;
        return {
          ...rep,
          attachments: [...rep.attachments, attachment],
        };
      })
    );
    showToast(`Archivo "${attachment.name}" adjuntado correctamente.`, 'success');
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

  // Alerts
  const handleToggleAlertActive = (alertId: string) => {
    setAlerts((prev) =>
      prev.map((a) => {
        if (a.id !== alertId) return a;
        const next = !a.active;
        showToast(next ? `Regla "${a.name}" activada.` : `Regla "${a.name}" pausada.`, 'info');
        return { ...a, active: next };
      })
    );
  };

  const handleAddNewAlert = (newAlert: ScheduledAlert) => {
    setAlerts([newAlert, ...alerts]);
    showToast(`Regla de alerta "${newAlert.name}" programada exitosamente.`, 'success');
  };

  const handleSimulateAlertTrigger = (alert: ScheduledAlert) => {
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
    showToast(`Prueba de envío exitosa. Notificación generada y enviada a los destinatarios.`, 'success');
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
  const handleAddReportType = (newType: ReportType) => {
    setReportTypes([...reportTypes, newType]);
    showToast(`Nuevo tipo de informe "${newType.code} - ${newType.name}" agregado.`, 'success');
  };

  const handleAddContact = (newContact: Contact) => {
    setContacts([...contacts, newContact]);
    showToast(`Contacto "${newContact.name}" registrado en la lista maestra.`, 'success');
  };

  const activeReportForModal = reports.find((r) => r.id === selectedReportId);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex font-sans antialiased">
      {/* Sidebar Navigation */}
      <Sidebar
        activeModule={activeModule}
        onSelectModule={(mod) => {
          setActiveModule(mod);
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
              setActiveModule('reports');
            }
          }}
          searchQuery={globalSearchQuery}
        />

        {/* Dynamic Main Content Container */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto">
          {/* M01: Dashboard */}
          {activeModule === 'dashboard' && (
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
          {activeModule === 'reports' && (
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
          {activeModule === 'new_report' && (
            <NewReportWizard
              projects={projects}
              reportTypes={reportTypes}
              contacts={contacts}
              preselectedProjectId={currentProjectId}
              onCancel={() => setActiveModule('reports')}
              onSubmitReport={handleSubmitNewReport}
            />
          )}

          {/* M05: Proyectos */}
          {activeModule === 'projects' && (
            <ProjectsListView
              projects={projects}
              reports={reports}
              reportTypes={reportTypes}
              onSelectProject={handleSelectProjectDetail}
              onOpenNewReportForProject={handleOpenNewReport}
            />
          )}

          {/* M06: Detalle de Proyecto (Rediseño de la pantalla analizada) */}
          {activeModule === 'project_detail' && currentProject && (
            <ProjectDetailView
              project={currentProject}
              reports={reports}
              reportTypes={reportTypes}
              alerts={alerts}
              contacts={contacts}
              onBackToProjects={() => setActiveModule('projects')}
              onOpenNewReport={handleOpenNewReport}
              onSelectReport={handleNavigateToReport}
              onToggleProjectAutoAlerts={handleToggleProjectAutoAlerts}
              onUpdateProjectApplicableTypes={handleUpdateProjectApplicableTypes}
              onToggleAlertRuleActive={handleToggleAlertActive}
              onAddNewAlertRule={handleAddNewAlert}
              onViewAllReports={() => handleViewAllReports()}
            />
          )}

          {/* M07: Alertas */}
          {activeModule === 'alerts' && (
            <AlertsView
              alerts={alerts}
              projects={projects}
              contacts={contacts}
              onToggleAlertActive={handleToggleAlertActive}
              onAddNewAlert={handleAddNewAlert}
              onSimulateTrigger={handleSimulateAlertTrigger}
            />
          )}

          {/* M08: Listas Maestras */}
          {activeModule === 'lists' && (
            <MasterListsView
              reportTypes={reportTypes}
              contacts={contacts}
              onAddReportType={handleAddReportType}
              onAddContact={handleAddContact}
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
