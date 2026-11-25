import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  HardDrive,
  Archive,
  Users,
  ShieldCheck,
  Activity,
  UserCog,
  Smartphone,
  ClipboardList,
  Trash2,
  ExternalLink,
  X,
} from 'lucide-react';
import { ActiveModule } from '../../types';
import { useAuth } from '../../auth/AuthContext';

interface ConfigSidebarProps {
  activeModule: ActiveModule;
  onSelectModule: (module: ActiveModule) => void;
  onGoHome: () => void;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
}

type ConfigLeaf = { id: ActiveModule; label: string; icon: React.ElementType; visible: boolean };
type GeoCampoLink = { key: string; label: string; icon: React.ElementType };

// Mismos tokens visuales que Sidebar.tsx (operación de Informes), para que
// el espacio de Configuración se sienta parte de la misma app aunque viva
// separado de ella.
const BG = '#0F172A';
const PANEL = '#141E33';
const BORDER = '#263449';
const ACCENT = '#5238F5';
const SUCCESS = '#00D6A0';

// GeoCampo abre en su propio espacio de configuración con la sección
// pedida -- mismo puente SSO que usa la tarjeta de Geo-Campo del hub
// (api/auth/google/[action].ts, acción sso-geocampo), así quien ya tiene
// sesión en Seguimiento entra derecho sin loguearse otra vez.
const GEOCAMPO_CONFIG_LINKS: GeoCampoLink[] = [
  { key: 'usuarios', label: 'Usuarios', icon: UserCog },
  { key: 'dispositivos', label: 'Dispositivos', icon: Smartphone },
  { key: 'formularios', label: 'Formularios', icon: ClipboardList },
  { key: 'papelera', label: 'Papelera', icon: Trash2 },
];

function geoCampoConfigUrl(section: string): string {
  const returnUrl = `https://geocampo-egdn.vercel.app/panel/?espacio=config&ir=${section}`;
  return `/api/auth/google/sso-geocampo?return=${encodeURIComponent(returnUrl)}`;
}

export const ConfigSidebar: React.FC<ConfigSidebarProps> = ({
  activeModule,
  onSelectModule,
  onGoHome,
  isMobileOpen,
  onCloseMobile,
}) => {
  const { user, canView } = useAuth();

  // Mismas reglas de visibilidad que tenían estos 5 ítems dentro de
  // Informes (ver Sidebar.tsx) -- solo cambiaron de casa, no de permisos.
  const seguimientoItems: ConfigLeaf[] = [
    { id: 'drive_links', label: 'Fuentes Google Drive', icon: HardDrive, visible: canView('drive_links') },
    { id: 'lists', label: 'Listas Maestras', icon: Archive, visible: canView('lists') },
    { id: 'users', label: 'Equipo & Permisos', icon: Users, visible: user.isAdmin },
    { id: 'file_cleaner', label: 'Limpieza de Archivos', icon: ShieldCheck, visible: canView('file_cleaner') },
    { id: 'performance', label: 'Rendimiento del Sistema', icon: Activity, visible: user.isAdmin },
  ];

  const handleSelect = (mod: ActiveModule) => {
    onSelectModule(mod);
    if (isMobileOpen) onCloseMobile();
  };

  const renderContent = () => (
    <div className="flex flex-col h-full select-none" style={{ background: BG, color: '#94A3B8' }}>
      <div className="h-16 shrink-0 flex items-center px-4 border-b" style={{ borderColor: `${BORDER}b3` }}>
        <button
          type="button"
          onClick={onGoHome}
          title="Volver a la selección de sistema"
          className="flex items-center gap-3 overflow-hidden text-left rounded-lg -mx-1 px-1 py-1 hover:bg-white/5 transition-colors"
        >
          <div
            className="relative w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ring-1 ring-white/20 shadow-md bg-gradient-to-tr from-[#3B82F6] via-[#5238F5] to-[#8B5CF6]"
            style={{ boxShadow: `0 4px 14px -2px ${ACCENT}4d` }}
          >
            <img src="/logo.svg" alt="" className="w-6 h-6 object-contain" />
          </div>
          <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.18 }} className="min-w-0">
            <h1 className="text-sm font-bold text-[#E2E8F0] tracking-tight truncate leading-tight">Configuración</h1>
            <p className="text-[10px] text-[#94A3B8] font-medium truncate mt-0.5">Control maestro de los dos sistemas</p>
          </motion.div>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-3.5 no-scrollbar">
        <button
          type="button"
          onClick={onGoHome}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-colors text-[#94A3B8] hover:text-[#E2E8F0] hover:bg-[#1E293B]"
          style={{ border: `1px solid ${BORDER}` }}
        >
          <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
          Inicio
        </button>

        <div>
          <div className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-wider text-[#475569]">Seguimiento de Informes</div>
          <nav className="space-y-1" aria-label="Configuración de Seguimiento de Informes">
            {seguimientoItems
              .filter((item) => item.visible)
              .map((item) => {
                const Icon = item.icon;
                const isActive = activeModule === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelect(item.id)}
                    style={{
                      background: isActive ? ACCENT : undefined,
                      boxShadow: isActive ? `0 4px 14px -2px ${ACCENT}4d` : undefined,
                    }}
                    className={`w-full flex items-center gap-2.5 pl-3 pr-3 py-2.5 rounded-xl text-xs font-medium transition-all duration-150 group cursor-pointer ${
                      isActive ? 'text-white font-semibold' : 'text-[#94A3B8] hover:text-[#E2E8F0] hover:bg-[#1E293B]'
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 transition-colors ${isActive ? 'text-white' : 'text-[#64748B] group-hover:text-[#CBD5E1]'}`} />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
          </nav>
        </div>

        <div>
          <div className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-wider text-[#475569]">GeoCampo</div>
          <nav className="space-y-1" aria-label="Configuración de GeoCampo">
            {GEOCAMPO_CONFIG_LINKS.map((link) => {
              const Icon = link.icon;
              return (
                <a
                  key={link.key}
                  href={geoCampoConfigUrl(link.key)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-between gap-2.5 pl-3 pr-3 py-2.5 rounded-xl text-xs font-medium transition-all duration-150 group cursor-pointer text-[#94A3B8] hover:text-[#E2E8F0] hover:bg-[#1E293B]"
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <Icon className="w-4 h-4 shrink-0 text-[#64748B] group-hover:text-[#CBD5E1] transition-colors" />
                    <span className="truncate">{link.label}</span>
                  </span>
                  <ExternalLink className="w-3.5 h-3.5 shrink-0 text-[#475569] group-hover:text-[#CBD5E1] transition-colors" />
                </a>
              );
            })}
          </nav>
        </div>
      </div>

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
      <aside id="app-config-sidebar-nav" className="hidden lg:flex shrink-0 flex-col w-64 h-screen sticky top-0 z-40 border-r" style={{ borderColor: BORDER }}>
        {renderContent()}
      </aside>

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
