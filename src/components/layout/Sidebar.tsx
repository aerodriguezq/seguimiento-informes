import React, { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  FolderKanban,
  FileText,
  List,
  PlusCircle,
  BellRing,
  HardDrive,
  Archive,
  Users,
  ChevronRight,
  Inbox,
  ShieldCheck,
  Sprout,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { ActiveModule, Project, Report } from '../../types';
import { useAuth } from '../../auth/AuthContext';

interface SidebarProps {
  activeModule: ActiveModule;
  onSelectModule: (module: ActiveModule) => void;
  pendingReportsCount: number;
  urgentReportsCount: number;
  activeAlertsCount: number;
  currentProject: Project | null;
  currentProjectId: string;
  projects: Project[];
  reports: Report[];
}

type LeafNode = {
  kind: 'leaf';
  id: ActiveModule;
  label: string;
  icon: React.ElementType;
  badge?: number | string;
  badgeColor?: string;
  visible: boolean;
};
type GroupNode = {
  kind: 'group';
  id: string;
  label: string;
  icon: React.ElementType;
  badge?: number | string;
  badgeColor?: string;
  visible: boolean;
  children: NavNode[];
};
// Encabezado de sección estático (no colapsable) -- solo organiza
// visualmente, no tiene estado propio ni aparece en findAncestorGroups.
type SectionNode = {
  kind: 'section';
  label: string;
  children: NavNode[];
};
type NavNode = LeafNode | GroupNode | SectionNode;

// Busca la cadena de ids de grupo colapsable que hay que tener abiertos para
// que "targetId" quede visible (p.ej. para 'alerts' -> ['informes']). Las
// secciones estáticas no tienen id/estado propio, así que no se agregan al
// path, pero sí hay que recorrer sus hijos.
function findAncestorGroups(nodes: NavNode[], targetId: ActiveModule, path: string[] = []): string[] | null {
  for (const node of nodes) {
    if (node.kind === 'leaf') {
      if (node.id === targetId) return path;
    } else if (node.kind === 'section') {
      const found = findAncestorGroups(node.children, targetId, path);
      if (found) return found;
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
  currentProject,
  currentProjectId,
  projects,
  reports,
}) => {
  const { user, canView } = useAuth();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['informes']));
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [seguimientoPct, setSeguimientoPct] = useState<number | null>(null);
  const [peticionesCount, setPeticionesCount] = useState<number | null>(null);

  // Badges con datos reales del proyecto activo -- mismo endpoint que ya usa
  // el Dashboard para "Cronograma de Entregas" y el que ya filtra Peticiones
  // por proyecto (ver remasterización de acceso por proyecto).
  useEffect(() => {
    if (!currentProjectId) {
      setSeguimientoPct(null);
      setPeticionesCount(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/projects?seguimiento=kpisResumen&projectId=${currentProjectId}`)
      .then((res) => res.json())
      .then((payload) => {
        if (cancelled || !payload?.data) return;
        const kpis = Object.values(payload.data) as { total: number; avance: number }[];
        const totals = kpis.reduce((acc, k) => acc + (Number(k.total) || 0), 0);
        const avances = kpis.reduce((acc, k) => acc + (Number(k.avance) || 0), 0);
        setSeguimientoPct(totals > 0 ? Math.round((avances / totals) * 1000) / 10 : null);
      })
      .catch(() => setSeguimientoPct(null));
    fetch(`/api/catalogs?kind=peticiones&projectId=${currentProjectId}`)
      .then((res) => res.json())
      .then((payload) => {
        if (!cancelled && Array.isArray(payload?.data)) setPeticionesCount(payload.data.length);
      })
      .catch(() => setPeticionesCount(null));
    return () => {
      cancelled = true;
    };
  }, [currentProjectId]);

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
      kind: 'section',
      label: 'Operación & Seguimiento',
      children: [
        {
          kind: 'leaf',
          id: 'dashboard',
          label: 'Dashboard General',
          icon: LayoutDashboard,
          visible: true,
        },
        {
          kind: 'leaf',
          id: 'projects',
          label: 'Cartera de Proyectos',
          icon: FolderKanban,
          badge: projects.length,
          badgeColor: 'bg-white/10 text-slate-300',
          visible: canView('projects'),
        },
        {
          kind: 'group',
          id: 'informes',
          label: 'Gestión de Informes',
          icon: FileText,
          badge: reports.length,
          badgeColor: 'bg-white/10 text-slate-300',
          visible: true,
          children: [
            {
              kind: 'leaf',
              id: 'reports',
              label: 'Ver Informes Radicados',
              icon: List,
              badge: pendingReportsCount,
              badgeColor: 'bg-amber-100 text-amber-800',
              visible: canView('reports'),
            },
            {
              kind: 'leaf',
              id: 'new_report',
              label: '+ Radicar Nuevo Informe',
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
        {
          kind: 'leaf',
          id: 'seguimiento',
          label: 'Entregas en Campo',
          icon: Sprout,
          badge: seguimientoPct !== null ? `${seguimientoPct}%` : undefined,
          badgeColor: 'bg-emerald-500/20 text-emerald-300',
          visible: canView('seguimiento'),
        },
        {
          kind: 'leaf',
          id: 'peticiones',
          label: 'Peticiones & PQRS',
          icon: Inbox,
          badge: peticionesCount !== null && peticionesCount > 0 ? peticionesCount : undefined,
          badgeColor: 'bg-amber-500/20 text-amber-300',
          visible: canView('peticiones'),
        },
      ],
    },
    {
      kind: 'section',
      label: 'Datos & Gobernanza',
      children: [
        {
          kind: 'leaf',
          id: 'drive_links',
          label: 'Fuentes Google Drive',
          icon: HardDrive,
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
          label: 'Equipo & Permisos',
          icon: Users,
          visible: user.isAdmin,
        },
        {
          kind: 'leaf',
          id: 'file_cleaner',
          label: 'Limpieza de Archivos',
          icon: ShieldCheck,
          visible: canView('file_cleaner'),
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

  const hasBadge = (badge: number | string | undefined): badge is number | string =>
    badge !== undefined && (typeof badge === 'string' ? badge !== '' : badge > 0);

  const renderNode = (node: NavNode, depth: number): React.ReactNode => {
    if (node.kind === 'section') {
      const visibleChildren = node.children.map((child) => renderNode(child, 0)).filter(Boolean);
      if (visibleChildren.length === 0) return null;
      return (
        <div key={node.label}>
          {!isCollapsed && (
            <div className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              {node.label}
            </div>
          )}
          <div className="space-y-1">{visibleChildren}</div>
        </div>
      );
    }

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
          title={isCollapsed ? node.label : undefined}
          style={isCollapsed ? undefined : { paddingLeft: `${12 + depth * 16}px` }}
          className={`w-full flex items-center rounded-lg text-xs font-medium transition-all group cursor-pointer ${
            isCollapsed ? 'justify-center py-2.5' : 'justify-between pr-3 py-2.5'
          } ${
            isActive
              ? 'bg-indigo-600 text-white font-semibold shadow-xs'
              : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
          }`}
        >
          <div className={`flex items-center min-w-0 ${isCollapsed ? '' : 'gap-2.5'}`}>
            <Icon
              className={`w-4 h-4 shrink-0 transition-colors ${
                isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'
              }`}
            />
            {!isCollapsed && <span className="truncate">{node.label}</span>}
          </div>
          {!isCollapsed && hasBadge(node.badge) && (
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold font-mono ${
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

    // Colapsado: sin jerarquía de grupos posible (no hay espacio para label
    // ni chevron) -- se listan los hijos directo, iguales a cualquier otro
    // ícono de la barra.
    if (isCollapsed) {
      return <div key={node.id} className="space-y-1">{visibleChildren}</div>;
    }

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
          <div className="flex items-center gap-1.5 shrink-0">
            {hasBadge(node.badge) && (
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold font-mono ${node.badgeColor}`}>
                {node.badge}
              </span>
            )}
            <ChevronRight className={`w-3.5 h-3.5 shrink-0 text-slate-500 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
          </div>
        </button>
        {isOpen && <div className="space-y-1 mt-1">{visibleChildren}</div>}
      </div>
    );
  };

  return (
    <aside
      id="app-sidebar-nav"
      className={`${isCollapsed ? 'w-18' : 'w-64'} bg-slate-900 text-slate-200 shrink-0 flex flex-col justify-between h-screen sticky top-0 border-r border-slate-800 z-40 select-none transition-all duration-200`}
    >
      {/* Top branding */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className={`py-5 border-b border-slate-800 flex items-center gap-3 ${isCollapsed ? 'px-3 justify-center' : 'px-5'}`}>
          <div className="w-9 h-9 rounded-xl overflow-hidden shrink-0 shadow-md shadow-indigo-900/30">
            <img src="/logo.svg" alt="" className="w-full h-full object-cover" />
          </div>
          {!isCollapsed && (
            <div className="min-w-0 flex-1">
              <h1 className="font-bold text-sm text-white tracking-tight leading-tight truncate">
                Seguimiento & Alertas
              </h1>
              <p className="text-[11px] text-slate-400 truncate">
                Gestión Operacional de Informes
              </p>
            </div>
          )}
          {!isCollapsed && (
            <button
              type="button"
              onClick={() => setIsCollapsed(true)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors shrink-0"
              title="Colapsar barra lateral"
              aria-label="Colapsar barra lateral"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          )}
        </div>

        {isCollapsed && (
          <div className="px-3 pt-2">
            <button
              type="button"
              onClick={() => setIsCollapsed(false)}
              className="w-full flex items-center justify-center p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              title="Expandir barra lateral"
              aria-label="Expandir barra lateral"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Proyecto en Pantalla: aclara de inmediato a qué proyecto queda
            acotada toda la app (ver remasterización de acceso por proyecto). */}
        {!isCollapsed && currentProject && (
          <div className="px-3 pt-3">
            <div className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-xs">
              <div className="flex items-center justify-between text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                <span>Proyecto en Pantalla</span>
                <span className="text-emerald-400 font-mono">Activo</span>
              </div>
              <div className="font-bold text-white truncate">{currentProject.name}</div>
              <div className="text-[11px] text-slate-400 font-mono truncate">
                BPIN: {currentProject.bpin}
              </div>
            </div>
          </div>
        )}

        {/* Operational Quick Alert Pill */}
        {!isCollapsed && urgentReportsCount > 0 && (
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

      {/* Footer de estado -- sin hora de sincronización inventada: solo
          confirma que el sistema está respondiendo. */}
      {!isCollapsed ? (
        <div className="p-3 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 truncate">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
            <span className="truncate">Sistema en línea</span>
          </div>
          <span className="text-[10px] font-mono text-slate-500">v2.0</span>
        </div>
      ) : (
        <div className="p-3 border-t border-slate-800 text-center shrink-0">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" title="Sistema en línea" />
        </div>
      )}
    </aside>
  );
};
