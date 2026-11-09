import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
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
  Info,
  X,
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
  isCurrentProjectSuspended: boolean;
  // Drawer de móvil -- hoy la barra siempre se renderizaba a ancho fijo
  // sin ocultarse en pantallas angostas; el disparador vive en Header.tsx
  // (botón hamburguesa) y el estado en App.tsx.
  isMobileOpen: boolean;
  onCloseMobile: () => void;
}

type LeafNode = {
  kind: 'leaf';
  id: ActiveModule;
  label: string;
  icon: React.ElementType;
  badge?: number | string;
  badgeColor?: string;
  visible: boolean;
  disabled?: boolean;
  disabledTitle?: string;
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

// Paleta -- calcada del mockup para fidelidad visual real, en vez de
// aproximar con los tokens slate/indigo que ya trae Tailwind.
const BG = '#0F172A';
const PANEL = '#141E33';
const BORDER = '#263449';
const ACCENT = '#5238F5';
const SUCCESS = '#00D6A0';
const DANGER = '#F43F5E';

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
  isCurrentProjectSuspended,
  isMobileOpen,
  onCloseMobile,
}) => {
  const { user, canView } = useAuth();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['informes']));
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
          visible: user.isAdmin,
        },
        {
          kind: 'leaf',
          id: 'project_detail',
          label: 'Detalle del Proyecto',
          icon: Info,
          visible: canView('projects') && !!currentProjectId,
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
              disabled: isCurrentProjectSuspended,
              disabledTitle: 'El proyecto está suspendido -- no se pueden crear informes nuevos.',
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

  // Igual que onSelectModule, pero además cierra el drawer en móvil al
  // navegar -- si ya está en escritorio (drawer cerrado), onCloseMobile no
  // tiene nada que hacer.
  const handleSelect = (mod: ActiveModule) => {
    onSelectModule(mod);
    if (isMobileOpen) onCloseMobile();
  };

  const renderNode = (node: NavNode, depth: number): React.ReactNode => {
    if (node.kind === 'section') {
      const visibleChildren = node.children.map((child) => renderNode(child, 0)).filter(Boolean);
      if (visibleChildren.length === 0) return null;
      return (
        <div key={node.label}>
          <div className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-wider text-[#475569]">
            {node.label}
          </div>
          <div className="space-y-1">{visibleChildren}</div>
        </div>
      );
    }

    if (!node.visible) return null;

    if (node.kind === 'leaf') {
      const Icon = node.icon;
      const isActive = activeModule === node.id;
      const isDisabled = Boolean(node.disabled);
      return (
        <button
          key={node.id}
          id={`sidebar-nav-${node.id}`}
          type="button"
          disabled={isDisabled}
          onClick={() => !isDisabled && handleSelect(node.id)}
          title={isDisabled ? node.disabledTitle : undefined}
          style={{
            paddingLeft: `${12 + depth * 16}px`,
            background: isActive ? ACCENT : undefined,
            boxShadow: isActive ? `0 4px 14px -2px ${ACCENT}4d` : undefined,
          }}
          className={`w-full flex items-center justify-between pr-3 py-2.5 rounded-xl text-xs font-medium transition-all duration-150 group ${
            isDisabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
          } ${
            isActive
              ? 'text-white font-semibold'
              : isDisabled
              ? 'text-[#64748B]'
              : 'text-[#94A3B8] hover:text-[#E2E8F0] hover:bg-[#1E293B]'
          }`}
        >
          <div className="flex items-center min-w-0 gap-2.5">
            <Icon className={`w-4 h-4 shrink-0 transition-colors ${isActive ? 'text-white' : 'text-[#64748B] group-hover:text-[#CBD5E1]'}`} />
            <span className="truncate">{node.label}</span>
          </div>
          {hasBadge(node.badge) && (
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

    const Icon = node.icon;
    const isOpen = expandedGroups.has(node.id);
    return (
      <div key={node.id}>
        <button
          type="button"
          onClick={() => toggleGroup(node.id)}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
          className="w-full flex items-center justify-between pr-3 py-2.5 rounded-xl text-xs font-bold text-[#CBD5E1] hover:bg-[#1E293B] hover:text-white transition-all cursor-pointer"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Icon className="w-4 h-4 shrink-0 text-[#64748B]" />
            <span className="truncate">{node.label}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {hasBadge(node.badge) && (
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold font-mono ${node.badgeColor}`}>
                {node.badge}
              </span>
            )}
            <ChevronRight className={`w-3.5 h-3.5 shrink-0 text-[#64748B] transition-transform ${isOpen ? 'rotate-90' : ''}`} />
          </div>
        </button>
        {isOpen && <div className="space-y-1 mt-1">{visibleChildren}</div>}
      </div>
    );
  };

  const renderContent = () => (
    <div className="flex flex-col h-full select-none" style={{ background: BG, color: '#94A3B8' }}>
      {/* Encabezado con logo real dentro del badge con gradiente */}
      <div className="h-16 shrink-0 flex items-center px-4 border-b" style={{ borderColor: `${BORDER}b3` }}>
        <div className="flex items-center gap-3 overflow-hidden">
          <div
            className="relative w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ring-1 ring-white/20 shadow-md bg-gradient-to-tr from-[#3B82F6] via-[#5238F5] to-[#8B5CF6]"
            style={{ boxShadow: `0 4px 14px -2px ${ACCENT}4d` }}
          >
            <img src="/logo.svg" alt="" className="w-6 h-6 object-contain" />
          </div>
          <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.18 }} className="min-w-0">
            <h1 className="text-sm font-bold text-[#E2E8F0] tracking-tight truncate leading-tight">Seguimiento & Alertas</h1>
            <p className="text-[10px] text-[#94A3B8] font-medium truncate mt-0.5">Gestión Operacional de Informes</p>
          </motion.div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-3.5 no-scrollbar">
        {/* Proyecto en Pantalla: aclara de inmediato a qué proyecto queda
            acotada toda la app (ver remasterización de acceso por proyecto). */}
        {currentProject && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3 rounded-xl transition-all shadow-xs"
            style={{ background: PANEL, border: `1px solid ${BORDER}` }}
          >
            <div className="flex items-center justify-between gap-1 mb-1.5">
              <span className="text-[9px] font-bold tracking-wider uppercase" style={{ color: '#64748B' }}>
                Proyecto en Pantalla
              </span>
              <span
                className="inline-flex items-center gap-1 text-[9px] font-bold rounded-md px-1.5 py-0.5"
                style={
                  isCurrentProjectSuspended
                    ? { color: DANGER, background: `${DANGER}1a`, border: `1px solid ${DANGER}33` }
                    : { color: SUCCESS, background: `${SUCCESS}1a`, border: `1px solid ${SUCCESS}33` }
                }
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${isCurrentProjectSuspended ? '' : 'animate-pulse'}`}
                  style={{ background: isCurrentProjectSuspended ? DANGER : SUCCESS }}
                />
                {isCurrentProjectSuspended ? 'SUSPENDIDO' : 'ACTIVO'}
              </span>
            </div>
            <h3 className="text-xs font-bold text-[#E2E8F0] truncate leading-tight">{currentProject.name}</h3>
            <p className="text-[10px] font-mono text-[#94A3B8] mt-0.5 tracking-tight truncate">BPIN: {currentProject.bpin}</p>
          </motion.div>
        )}

        {/* Pastilla de alertas urgentes -- mismo dato y mismo destino
            (lista de Informes) que ya usaba el diseño anterior. */}
        {urgentReportsCount > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={() => handleSelect('reports')}
            className="p-2.5 rounded-xl flex items-center justify-between cursor-pointer transition-all shadow-xs group"
            style={{ background: '#2A121E', border: '1px solid #541B2E' }}
            title="Haz clic para ver los informes urgentes"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: DANGER }} />
                <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: DANGER }} />
              </span>
              <span className="text-xs font-medium truncate" style={{ color: DANGER }}>
                {urgentReportsCount} {urgentReportsCount === 1 ? 'urgente' : 'urgentes'}
              </span>
            </div>
            <span className="text-[11px] font-semibold text-rose-300 group-hover:text-white flex items-center gap-0.5 shrink-0 transition-colors">
              Ver
              <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
            </span>
          </motion.div>
        )}

        <nav className="space-y-1" aria-label="Navegación principal">
          {navTree.map((node) => renderNode(node, 0))}
        </nav>
      </div>

      {/* Pie de página -- sin hora de sincronización inventada: solo
          confirma que el sistema está respondiendo. */}
      <div className="p-3 border-t text-[11px] text-[#94A3B8] flex items-center justify-between shrink-0" style={{ borderColor: BORDER }}>
        <div className="flex items-center gap-2 truncate">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: SUCCESS }} />
          <span className="truncate">Sistema en línea</span>
        </div>
        <span className="text-[10px] font-mono text-[#64748B]">v2.0</span>
      </div>
    </div>
  );

  return (
    <>
      {/* Barra persistente de escritorio */}
      <aside id="app-sidebar-nav" className="hidden lg:flex shrink-0 flex-col w-64 h-screen sticky top-0 z-40 border-r" style={{ borderColor: BORDER }}>
        {renderContent()}
      </aside>

      {/* Drawer deslizable en móvil, se abre desde el botón hamburguesa de
          Header.tsx. */}
      <AnimatePresence>
        {isMobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onCloseMobile}
              className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-xs z-50"
            />
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 250 }}
              className="lg:hidden fixed top-0 bottom-0 left-0 w-[280px] z-50 shadow-2xl"
            >
              <div className="relative h-full">
                {renderContent()}
                <button
                  type="button"
                  onClick={onCloseMobile}
                  className="absolute top-4 right-3 p-1.5 rounded-lg text-[#94A3B8] hover:text-white bg-[#1E293B]"
                  aria-label="Cerrar menú"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};
