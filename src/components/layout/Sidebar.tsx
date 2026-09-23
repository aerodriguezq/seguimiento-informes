import React, { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Folder,
  FolderOpen,
  FileSpreadsheet,
  TrendingUp,
  FileText,
  List,
  PlusCircle,
  BellRing,
  Wrench,
  Cloud,
  Archive,
  Users,
  ShieldAlert,
  ChevronRight,
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

type LeafNode = {
  kind: 'leaf';
  id: ActiveModule;
  label: string;
  icon: React.ElementType;
  badge?: number;
  badgeColor?: string;
  visible: boolean;
};
type GroupNode = {
  kind: 'group';
  id: string;
  label: string;
  icon: React.ElementType;
  visible: boolean;
  children: NavNode[];
};
type NavNode = LeafNode | GroupNode;

// Busca la cadena de ids de grupo que hay que tener abiertos para que
// "targetId" quede visible (p.ej. para 'alerts' -> ['proyectos', 'informes']).
function findAncestorGroups(nodes: NavNode[], targetId: ActiveModule, path: string[] = []): string[] | null {
  for (const node of nodes) {
    if (node.kind === 'leaf') {
      if (node.id === targetId) return path;
    } else {
      const found = findAncestorGroups(node.children, targetId, [...path, node.id]);
      if (found) return found;
    }
  }
  return null;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeModule,
  onSelectModule,
  pendingReportsCount,
  urgentReportsCount,
  activeAlertsCount,
}) => {
  const { user, canView } = useAuth();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['proyectos', 'informes', 'admin']));

  const toggleGroup = (id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const navTree: NavNode[] = [
    {
      kind: 'leaf',
      id: 'dashboard',
      label: 'Dashboard',
      icon: LayoutDashboard,
      visible: true,
    },
    {
      kind: 'group',
      id: 'proyectos',
      label: 'Proyectos',
      icon: Folder,
      visible: true,
      children: [
        {
          kind: 'leaf',
          id: 'projects',
          label: 'Lista de Proyectos',
          icon: FolderOpen,
          visible: canView('projects'),
        },
        {
          kind: 'leaf',
          id: 'project_detail',
          label: 'Detalle de Proyecto',
          icon: FileSpreadsheet,
          visible: canView('projects'),
        },
        {
          kind: 'leaf',
          id: 'seguimiento',
          label: 'Seguimiento',
          icon: TrendingUp,
          visible: canView('seguimiento'),
        },
        {
          kind: 'group',
          id: 'informes',
          label: 'Informes',
          icon: FileText,
          visible: true,
          children: [
            {
              kind: 'leaf',
              id: 'reports',
              label: 'Ver Todos',
              icon: List,
              badge: pendingReportsCount,
              badgeColor: 'bg-amber-100 text-amber-800',
              visible: canView('reports'),
            },
            {
              kind: 'leaf',
              id: 'new_report',
              label: 'Crear Nuevo Informe',
              icon: PlusCircle,
              visible: canView('reports'),
            },
            {
              kind: 'leaf',
              id: 'alerts',
              label: 'Configuración de Alertas',
              icon: BellRing,
              badge: activeAlertsCount,
              badgeColor: 'bg-indigo-100 text-indigo-800',
              visible: canView('alerts'),
            },
          ],
        },
      ],
    },
    {
      kind: 'group',
      id: 'admin',
      label: 'Administración / Datos',
      icon: Wrench,
      visible: true,
      children: [
        {
          kind: 'leaf',
          id: 'drive_links',
          label: 'Fuentes Drive',
          icon: Cloud,
          visible: canView('drive_links'),
        },
        {
          kind: 'leaf',
          id: 'lists',
          label: 'Listas Maestras',
          icon: Archive,
          visible: canView('lists'),
        },
        {
          kind: 'leaf',
          id: 'users',
          label: 'Usuarios',
          icon: Users,
          visible: user.isAdmin,
        },
      ],
    },
  ];

  // Si navegamos a una ruta cuya hoja está dentro de un grupo cerrado (p.ej.
  // por deep-link, o porque el usuario lo había plegado), lo reabrimos para
  // que la ubicación activa quede visible en vez de escondida.
  useEffect(() => {
    const ancestors = findAncestorGroups(navTree, activeModule);
    if (!ancestors || ancestors.length === 0) return;
    setExpandedGroups((prev) => {
      const missing = ancestors.filter((id) => !prev.has(id));
      if (missing.length === 0) return prev;
      const next = new Set(prev);
      missing.forEach((id) => next.add(id));
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModule]);

  const renderNode = (node: NavNode, depth: number): React.ReactNode => {
    if (!node.visible) return null;

    if (node.kind === 'leaf') {
      const Icon = node.icon;
      const isActive = activeModule === node.id;
      return (
        <button
          key={node.id}
          id={`sidebar-nav-${node.id}`}
          type="button"
          onClick={() => onSelectModule(node.id)}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
          className={`w-full flex items-center justify-between pr-3 py-2.5 rounded-lg text-xs font-medium transition-all group cursor-pointer ${
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
            <span className="truncate">{node.label}</span>
          </div>
          {node.badge !== undefined && node.badge > 0 && (
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                isActive ? 'bg-white/20 text-white' : node.badgeColor
              }`}
            >
              {node.badge}
            </span>
          )}
        </button>
      );
    }

    const visibleChildren = node.children.map((child) => renderNode(child, depth + 1)).filter(Boolean);
    if (visibleChildren.length === 0) return null;

    const Icon = node.icon;
    const isOpen = expandedGroups.has(node.id);
    return (
      <div key={node.id}>
        <button
          type="button"
          onClick={() => toggleGroup(node.id)}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
          className="w-full flex items-center justify-between pr-3 py-2.5 rounded-lg text-xs font-bold text-slate-200 hover:bg-slate-800/80 hover:text-white transition-all cursor-pointer"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Icon className="w-4 h-4 shrink-0 text-slate-400" />
            <span className="truncate">{node.label}</span>
          </div>
          <ChevronRight className={`w-3.5 h-3.5 shrink-0 text-slate-500 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
        </button>
        {isOpen && <div className="space-y-1 mt-1">{visibleChildren}</div>}
      </div>
    );
  };

  return (
    <aside
      id="app-sidebar-nav"
      className="w-64 bg-slate-900 text-slate-200 shrink-0 flex flex-col justify-between h-screen sticky top-0 border-r border-slate-800 z-40 select-none"
    >
      {/* Top branding */}
      <div className="flex-1 min-h-0 flex flex-col">
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
        <nav className="p-3 space-y-1 mt-2 overflow-y-auto" aria-label="Navegación principal">
          {navTree.map((node) => renderNode(node, 0))}
        </nav>
      </div>
    </aside>
  );
};
