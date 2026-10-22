import React, { useState } from 'react';
import {
  Bell,
  Search,
  Plus,
  Calendar,
  Layers,
  ChevronDown,
  Building2,
  Check,
  X,
  ExternalLink,
  Clock,
  AlertCircle,
  AlertTriangle,
  Info,
  LogOut,
} from 'lucide-react';
import { Project, SystemNotification } from '../../types';
import { useAuth } from '../../auth/AuthContext';

interface HeaderProps {
  currentProject: Project | null;
  projects: Project[];
  onSelectProject: (projectId: string) => void;
  onViewAllProjects: () => void;
  notifications: SystemNotification[];
  onMarkNotificationAsRead: (id: string) => void;
  onClearAllNotifications: () => void;
  onNavigateToReport: (reportId: string) => void;
  onOpenNewReport: () => void;
  onOpenSearch: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentProject,
  projects,
  onSelectProject,
  onViewAllProjects,
  notifications,
  onMarkNotificationAsRead,
  onClearAllNotifications,
  onNavigateToReport,
  onOpenNewReport,
  onOpenSearch,
}) => {
  const { user, logout } = useAuth();
  const currentDateLabel = new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date());
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProjectSelector, setShowProjectSelector] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [activeNotifTab, setActiveNotifTab] = useState<'all' | 'critical' | 'unread'>('all');

  const unreadCount = notifications.filter((n) => !n.read).length;
  const criticalCount = notifications.filter((n) => n.severity === 'critical').length;

  const filteredNotifications = notifications.filter((n) => {
    if (activeNotifTab === 'critical') return n.severity === 'critical';
    if (activeNotifTab === 'unread') return !n.read;
    return true;
  });

  return (
    <header
      id="app-main-header"
      className="bg-white border-b border-slate-200 sticky top-0 z-30 px-6 py-3 shadow-xs"
    >
      <div className="flex items-center justify-between gap-4">
        {/* Left: Project Selector & Context */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <button
              id="project-selector-dropdown-btn"
              type="button"
              onClick={() => setShowProjectSelector(!showProjectSelector)}
              className="flex items-center gap-2.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200/80 rounded-lg text-sm font-medium text-slate-800 transition-colors border border-slate-200"
              title="Cambiar proyecto activo"
            >
              <Building2 className="w-4 h-4 text-slate-600" />
              <div className="text-left max-w-xs md:max-w-md truncate">
                <span className="text-xs text-slate-500 block leading-none font-normal">
                  Proyecto activo
                </span>
                <span className="font-semibold text-slate-900 truncate">
                  {currentProject ? currentProject.name : 'Todos los proyectos'}
                </span>
              </div>
              <ChevronDown className="w-4 h-4 text-slate-500 ml-1 shrink-0" />
            </button>

            {/* Project dropdown */}
            {showProjectSelector && (
              <div
                id="project-dropdown-menu"
                className="absolute left-0 mt-2 w-80 bg-white rounded-xl shadow-lg border border-slate-200 py-2 z-50 animate-in fade-in zoom-in-95 duration-100"
              >
                <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-100">
                  Seleccionar Proyecto
                </div>
                <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                  {projects.map((p) => (
                    <button
                      key={p.id}
                      id={`select-project-item-${p.id}`}
                      type="button"
                      onClick={() => {
                        onSelectProject(p.id);
                        setShowProjectSelector(false);
                      }}
                      className={`w-full text-left px-3.5 py-2.5 hover:bg-slate-50 flex items-start justify-between text-xs transition-colors ${
                        currentProject?.id === p.id ? 'bg-indigo-50/70 font-semibold' : ''
                      }`}
                    >
                      <div>
                        <div className="text-slate-900 line-clamp-1">{p.name}</div>
                        <div className="text-slate-500 text-[11px] mt-0.5">
                          BPIN: {p.bpin} • {p.company}
                        </div>
                      </div>
                      {currentProject?.id === p.id && (
                        <Check className="w-4 h-4 text-indigo-600 shrink-0 ml-2 mt-0.5" />
                      )}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onViewAllProjects();
                    setShowProjectSelector(false);
                  }}
                  className="w-full text-left px-3.5 py-2 text-xs font-semibold text-teal-700 hover:bg-teal-50 border-t border-slate-100 mt-1"
                >
                  Ver todos los proyectos (tarjetas)
                </button>
              </div>
            )}
          </div>

          {currentProject && (
            <div className="hidden lg:flex items-center gap-2 text-xs text-slate-500 border-l border-slate-200 pl-3">
              <span>BPIN: <strong className="text-slate-700">{currentProject.bpin}</strong></span>
              <span>•</span>
              <span>Empresa: <strong className="text-slate-700 truncate max-w-44">{currentProject.company}</strong></span>
            </div>
          )}
        </div>

        {/* Center: Global Quick Search (abre el modal de búsqueda ⌘K) */}
        <div className="hidden md:flex flex-1 max-w-md items-center">
          <button
            id="global-search-input"
            type="button"
            onClick={onOpenSearch}
            className="w-full flex items-center justify-between gap-2 px-3.5 py-1.5 text-xs text-slate-500 bg-slate-100/80 hover:bg-slate-100 border border-slate-200/80 rounded-lg transition-colors"
          >
            <span className="flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="truncate">Buscar por consecutivo, tipo, proyecto...</span>
            </span>
            <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono text-slate-500 bg-white rounded border border-slate-200 shrink-0">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Right Controls: Date indicator, Quick New Report, Notifications, User profile */}
        <div className="flex items-center gap-3">
          {/* Current system date */}
          <div
            id="current-system-date"
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg border border-slate-200"
            title={`Fecha del sistema: ${currentDateLabel}`}
          >
            <Calendar className="w-3.5 h-3.5 text-slate-500" />
            <span>{currentDateLabel}</span>
          </div>

          {/* New Report quick action */}
          <button
            id="header-quick-new-report-btn"
            type="button"
            onClick={onOpenNewReport}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Nuevo Informe</span>
          </button>

          {/* Notifications Bell */}
          <div className="relative">
            <button
              id="header-notification-bell-btn"
              type="button"
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors border border-slate-200"
              aria-label="Centro de notificaciones"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span
                  id="notifications-badge-counter"
                  className="absolute -top-1 -right-1 flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-rose-600 text-[10px] font-bold text-white shadow-xs"
                >
                  {unreadCount}
                </span>
              )}
            </button>

            {/* Notification Drawer / Popover (M09) */}
            {showNotifications && (
              <div
                id="notification-center-drawer"
                className="absolute right-0 mt-2 w-88 sm:w-96 bg-white rounded-xl shadow-2xl border border-slate-200 py-3 z-50 animate-in fade-in zoom-in-95 duration-100"
              >
                <div className="flex items-center justify-between px-4 pb-2 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-slate-900">
                      Centro de Notificaciones
                    </span>
                    {criticalCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700">
                        {criticalCount} críticas
                      </span>
                    )}
                  </div>
                  <button
                    id="close-notifications-btn"
                    type="button"
                    onClick={() => setShowNotifications(false)}
                    className="text-slate-400 hover:text-slate-600 p-1"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Tabs */}
                <div className="flex items-center gap-2 px-4 pt-2.5 pb-2 text-xs border-b border-slate-100">
                  <button
                    type="button"
                    onClick={() => setActiveNotifTab('all')}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                      activeNotifTab === 'all'
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Todas ({notifications.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveNotifTab('critical')}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                      activeNotifTab === 'critical'
                        ? 'bg-rose-600 text-white'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Vencidas / Críticas ({criticalCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveNotifTab('unread')}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                      activeNotifTab === 'unread'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Sin leer ({unreadCount})
                  </button>
                </div>

                {/* List */}
                <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                  {filteredNotifications.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-400">
                      No hay notificaciones en este filtro
                    </div>
                  ) : (
                    filteredNotifications.map((notif) => {
                      const icon = {
                        critical: <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />,
                        warning: <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />,
                        info: <Info className="w-4 h-4 text-blue-600 shrink-0" />,
                        success: <Check className="w-4 h-4 text-emerald-600 shrink-0" />,
                      }[notif.severity];

                      return (
                        <div
                          key={notif.id}
                          id={`notification-item-${notif.id}`}
                          className={`p-3.5 hover:bg-slate-50 transition-colors flex items-start gap-3 ${
                            !notif.read ? 'bg-slate-50/70' : ''
                          }`}
                        >
                          <div className="mt-0.5">{icon}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1">
                              <h4 className="text-xs font-semibold text-slate-900 leading-tight">
                                {notif.title}
                              </h4>
                              <span className="text-[10px] text-slate-400 whitespace-nowrap">
                                {notif.timestamp}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 mt-1 line-clamp-2">
                              {notif.message}
                            </p>
                            <div className="flex items-center gap-3 mt-2">
                              {notif.relatedReportId && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onNavigateToReport(notif.relatedReportId!);
                                    setShowNotifications(false);
                                  }}
                                  className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold inline-flex items-center gap-1"
                                >
                                  Ver informe <ExternalLink className="w-3 h-3" />
                                </button>
                              )}
                              {!notif.read && (
                                <button
                                  type="button"
                                  onClick={() => onMarkNotificationAsRead(notif.id)}
                                  className="text-[11px] text-slate-400 hover:text-slate-700"
                                >
                                  Marcar leída
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Footer */}
                {notifications.length > 0 && (
                  <div className="p-2 border-t border-slate-100 text-center">
                    <button
                      id="clear-all-notifs-btn"
                      type="button"
                      onClick={onClearAllNotifications}
                      className="text-xs text-slate-500 hover:text-slate-800 font-medium"
                    >
                      Marcar todas como leídas
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* User profile menu */}
          <div className="relative pl-2 border-l border-slate-200">
            <button
              type="button"
              onClick={() => setShowProfileMenu(!showProfileMenu)}
              className="flex items-center gap-2 p-1 rounded-lg hover:bg-slate-100 transition-colors"
              aria-label="Menú de usuario"
            >
              <div className="w-7 h-7 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center shrink-0">
                {(user.name || user.email).slice(0, 2).toUpperCase()}
              </div>
              <div className="hidden xl:block text-left text-xs">
                <div className="font-semibold text-slate-800 leading-none">{user.name || user.email}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">{user.isAdmin ? 'Administrador' : 'Usuario autorizado'}</div>
              </div>
              <ChevronDown className="hidden xl:block w-3.5 h-3.5 text-slate-400 shrink-0" />
            </button>

            {showProfileMenu && (
              <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-lg border border-slate-200 py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100">
                <div className="px-3.5 py-2.5 border-b border-slate-100">
                  <div className="font-semibold text-xs text-slate-900 truncate">{user.name || 'Sin nombre'}</div>
                  <div className="text-[11px] text-slate-500 truncate">{user.email}</div>
                  <div className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">
                    {user.isAdmin ? 'Administrador' : 'Usuario autorizado'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowProfileMenu(false);
                    logout();
                  }}
                  className="w-full px-3.5 py-2 text-left text-xs text-rose-600 hover:bg-rose-50 flex items-center gap-2"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Cerrar sesión
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
