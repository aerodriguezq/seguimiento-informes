import React from 'react';
import {
  LayoutDashboard,
  FileText,
  PlusCircle,
  FolderGit2,
  Sliders,
  BellRing,
  Database,
  ExternalLink,
  ShieldAlert,
  ChevronRight,
  UserCog,
  CalendarRange,
} from 'lucide-react';
import { ActiveModule } from '../../types';
import { useAuth } from '../../auth/AuthContext';

interface SidebarProps {
  activeModule: ActiveModule;
  onSelectModule: (module: ActiveModule) => void;
  pendingReportsCount: number;
  urgentReportsCount: number;
  activeAlertsCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeModule,
  onSelectModule,
  pendingReportsCount,
  urgentReportsCount,
  activeAlertsCount,
}) => {
  const { user, canView } = useAuth();

  const allNavItems: {
    id: ActiveModule;
    label: string;
    icon: React.ElementType;
    badge?: number;
    badgeColor?: string;
    description?: string;
    visible: boolean;
  }[] = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: LayoutDashboard,
      description: 'Vista ejecutiva de KPIs y cumplimiento',
      visible: true,
    },
    {
      id: 'reports',
      label: 'Informes',
      icon: FileText,
      badge: pendingReportsCount,
      badgeColor: 'bg-amber-100 text-amber-800',
      description: 'Listado, filtros y semáforos',
      visible: canView('reports'),
    },
    {
      id: 'new_report',
      label: 'Nuevo Informe',
      icon: PlusCircle,
      description: 'Creación guiada por pasos',
      visible: canView('reports'),
    },
    {
      id: 'projects',
      label: 'Proyectos',
      icon: FolderGit2,
      description: 'Cartera y estados BPIN',
      visible: canView('projects'),
    },
    {
      id: 'project_detail',
      label: 'Detalle de Proyecto',
      icon: Sliders,
      description: 'Configuración, alertas e informes',
      visible: canView('projects'),
    },
    {
      id: 'alerts',
      label: 'Alertas',
      icon: BellRing,
      badge: activeAlertsCount,
      badgeColor: 'bg-indigo-100 text-indigo-800',
      description: 'Reglas y programación automática',
      visible: canView('alerts'),
    },
    {
      id: 'lists',
      label: 'Listas Maestras',
      icon: Database,
      description: 'Catálogos, tipos y contactos',
      visible: canView('lists'),
    },
    {
      id: 'drive_links',
      label: 'Fuentes Drive',
      icon: ExternalLink,
      description: 'Origen y destino para automatizaciones',
      visible: canView('drive_links'),
    },
    {
      id: 'seguimiento',
      label: 'Seguimiento',
      icon: CalendarRange,
      description: 'Cronograma de entregas por proyecto',
      visible: canView('seguimiento'),
    },
    {
      id: 'users',
      label: 'Usuarios',
      icon: UserCog,
      description: 'Acceso y permisos por módulo',
      visible: user.isAdmin,
    },
  ];

  const navItems = allNavItems.filter((item) => item.visible);

  return (
    <aside
      id="app-sidebar-nav"
      className="w-64 bg-slate-900 text-slate-200 shrink-0 flex flex-col justify-between h-screen sticky top-0 border-r border-slate-800 z-40 select-none"
    >
      {/* Top branding */}
      <div>
        <div className="px-5 py-5 border-b border-slate-800 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-white shadow-md shadow-indigo-900/30">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="font-bold text-sm text-white tracking-tight leading-tight truncate">
              Seguimiento & Alertas
            </h1>
            <p className="text-[11px] text-slate-400 truncate">
              Gestión Operacional de Informes
            </p>
          </div>
        </div>

        {/* Operational Quick Alert Pill */}
        {urgentReportsCount > 0 && (
          <div className="mx-3 mt-3 px-3 py-2 rounded-lg bg-rose-950/60 border border-rose-800/60 text-xs text-rose-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping shrink-0" />
              <span className="font-medium text-[11px]">
                {urgentReportsCount} {urgentReportsCount === 1 ? 'urgente' : 'urgentes'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onSelectModule('reports')}
              className="text-[10px] text-rose-300 hover:text-white font-semibold flex items-center"
            >
              Ver <ChevronRight className="w-3 h-3 ml-0.5" />
            </button>
          </div>
        )}

        {/* Navigation Menu */}
        <nav className="p-3 space-y-1 mt-2" aria-label="Navegación principal">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeModule === item.id;
            return (
              <button
                key={item.id}
                id={`sidebar-nav-${item.id}`}
                type="button"
                onClick={() => onSelectModule(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-all group cursor-pointer ${
                  isActive
                    ? 'bg-indigo-600 text-white font-semibold shadow-xs'
                    : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon
                    className={`w-4 h-4 shrink-0 transition-colors ${
                      isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'
                    }`}
                  />
                  <span className="truncate">{item.label}</span>
                </div>
                {item.badge !== undefined && item.badge > 0 && (
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                      isActive ? 'bg-white/20 text-white' : item.badgeColor
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

    </aside>
  );
};
