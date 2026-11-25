import React from 'react';
import {
  ArrowLeft,
  Settings2,
  HardDrive,
  Archive,
  Users,
  ShieldCheck,
  Activity,
  UserCog,
  Smartphone,
  ClipboardList,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { ActiveModule } from '../../types';

export type GeoCampoSectionKey = 'usuarios' | 'dispositivos' | 'formularios' | 'papelera';

type ConfigCard = { id: ActiveModule; label: string; description: string; icon: LucideIcon; visible: boolean };
type GeoCampoCard = { key: GeoCampoSectionKey; label: string; description: string; icon: LucideIcon };

// Tokens propios de este espacio -- a propósito distintos a la paleta
// oscura slate/índigo del Sidebar de Informes, para que Configuración se
// sienta un panel de control aparte, no una sección más de la operación
// diaria. Cada zona (Seguimiento / GeoCampo) tiene su propio acento para
// que de un vistazo se note de qué sistema es cada tarjeta.
const PAPER = '#FAF8F4';
const INK = '#1C1917';
const SEGUIMIENTO_ACCENT = '#6D28D9';
const GEOCAMPO_ACCENT = '#047857';

const SEGUIMIENTO_CARDS: ConfigCard[] = [
  { id: 'lists', label: 'Listas Maestras', description: 'Tipos de informe, roles, empresas y áreas.', icon: Archive, visible: true },
  { id: 'users', label: 'Equipo & Permisos', description: 'Usuarios autorizados y sus permisos.', icon: Users, visible: true },
  { id: 'drive_links', label: 'Fuentes Google Drive', description: 'Carpetas de origen y destino conectadas.', icon: HardDrive, visible: true },
  { id: 'file_cleaner', label: 'Limpieza de Archivos', description: 'Quita metadatos antes de compartir un archivo.', icon: ShieldCheck, visible: true },
  { id: 'performance', label: 'Rendimiento del Sistema', description: 'Salud y tiempos de respuesta de la app.', icon: Activity, visible: true },
];

const GEOCAMPO_CARDS: GeoCampoCard[] = [
  { key: 'usuarios', label: 'Usuarios', description: 'Cuentas y roles de campo en GeoCampo.', icon: UserCog },
  { key: 'dispositivos', label: 'Dispositivos', description: 'Equipos autorizados a capturar registros.', icon: Smartphone },
  { key: 'formularios', label: 'Formularios', description: 'Constructor de formularios de campo.', icon: ClipboardList },
  { key: 'papelera', label: 'Papelera', description: 'Registros, fotos y usuarios eliminados.', icon: Trash2 },
];

function geoCampoEmbedUrl(section: GeoCampoSectionKey): string {
  const returnUrl = `https://geocampo-egdn.vercel.app/panel/?espacio=config&embed=1&ir=${section}`;
  return `/api/auth/google/sso-geocampo?return=${encodeURIComponent(returnUrl)}`;
}

interface ConfigSpaceProps {
  activeModule: ActiveModule;
  onSelectModule: (module: ActiveModule) => void;
  onGoHome: () => void;
  geoCampoSection: GeoCampoSectionKey | null;
  onSelectGeoCampoSection: (section: GeoCampoSectionKey | null) => void;
  canViewModule: (module: ActiveModule) => boolean;
  children: React.ReactNode;
}

export const ConfigSpace: React.FC<ConfigSpaceProps> = ({
  activeModule,
  onSelectModule,
  onGoHome,
  geoCampoSection,
  onSelectGeoCampoSection,
  canViewModule,
  children,
}) => {
  const seguimientoCards = SEGUIMIENTO_CARDS.filter((card) => card.visible && canViewModule(card.id));
  const isLanding = activeModule === 'config_home' && !geoCampoSection;

  const activeLabel = geoCampoSection
    ? GEOCAMPO_CARDS.find((c) => c.key === geoCampoSection)?.label
    : seguimientoCards.find((c) => c.id === activeModule)?.label;

  const goToModuleCard = (id: ActiveModule) => {
    onSelectGeoCampoSection(null);
    onSelectModule(id);
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: PAPER, color: INK }}>
      {/* Encabezado -- siempre el mismo, cambia solo el título/breadcrumb */}
      <header className="h-16 shrink-0 flex items-center justify-between px-6 border-b" style={{ borderColor: '#E7E2D9' }}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-white" style={{ background: INK }}>
            <Settings2 className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            {isLanding ? (
              <h1 className="text-sm font-bold tracking-tight truncate">Panel de Configuración</h1>
            ) : (
              <button
                type="button"
                onClick={() => { onSelectGeoCampoSection(null); onSelectModule('config_home'); }}
                className="text-sm font-bold tracking-tight truncate hover:underline flex items-center gap-1.5"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Panel de Configuración <span className="opacity-40">/</span> {activeLabel}
              </button>
            )}
            <p className="text-[11px] mt-0.5 truncate" style={{ color: '#78716C' }}>Seguimiento de Informes y GeoCampo, en un solo lugar</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onGoHome}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border shrink-0"
          style={{ borderColor: '#E7E2D9', color: INK }}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Inicio
        </button>
      </header>

      {/* Tira de acceso rápido -- siempre visible, para saltar de una
          sección a otra (de cualquiera de los dos sistemas) sin tener que
          volver primero al panel. */}
      <div className="h-12 shrink-0 flex items-center gap-1.5 px-6 overflow-x-auto border-b" style={{ borderColor: '#E7E2D9' }}>
        {seguimientoCards.map((card) => {
          const Icon = card.icon;
          const isActive = !geoCampoSection && activeModule === card.id;
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => goToModuleCard(card.id)}
              style={isActive ? { background: SEGUIMIENTO_ACCENT, color: 'white' } : undefined}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors ${
                isActive ? '' : 'text-[#44403C] hover:bg-[#EFEAE1]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {card.label}
            </button>
          );
        })}
        <span className="w-px h-5 mx-1 shrink-0" style={{ background: '#E7E2D9' }} />
        {GEOCAMPO_CARDS.map((card) => {
          const Icon = card.icon;
          const isActive = geoCampoSection === card.key;
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => onSelectGeoCampoSection(card.key)}
              style={isActive ? { background: GEOCAMPO_ACCENT, color: 'white' } : undefined}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors ${
                isActive ? '' : 'text-[#44403C] hover:bg-[#E3F2EB]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {card.label}
            </button>
          );
        })}
      </div>

      {/* Contenido */}
      {geoCampoSection ? (
        <iframe
          key={geoCampoSection}
          src={geoCampoEmbedUrl(geoCampoSection)}
          title={`GeoCampo · ${GEOCAMPO_CARDS.find((c) => c.key === geoCampoSection)?.label}`}
          className="flex-1 w-full border-0"
          style={{ height: 'calc(100vh - 112px)' }}
        />
      ) : isLanding ? (
        <div className="flex-1 overflow-y-auto px-6 py-10">
          <div className="max-w-5xl mx-auto space-y-10">
            <section>
              <div className="flex items-baseline gap-2 mb-4">
                <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: SEGUIMIENTO_ACCENT }}>Seguimiento de Informes</h2>
                <span className="text-xs" style={{ color: '#A8A29E' }}>— datos de esta app</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {seguimientoCards.map((card) => {
                  const Icon = card.icon;
                  return (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => goToModuleCard(card.id)}
                      className="text-left bg-white rounded-2xl border p-5 hover:shadow-md transition-all flex flex-col"
                      style={{ borderColor: '#E7E2D9' }}
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `${SEGUIMIENTO_ACCENT}14`, color: SEGUIMIENTO_ACCENT }}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <h3 className="mt-3 text-sm font-bold">{card.label}</h3>
                      <p className="mt-1 text-xs" style={{ color: '#78716C' }}>{card.description}</p>
                    </button>
                  );
                })}
              </div>
            </section>

            <section>
              <div className="flex items-baseline gap-2 mb-4">
                <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: GEOCAMPO_ACCENT }}>GeoCampo</h2>
                <span className="text-xs" style={{ color: '#A8A29E' }}>— se configura aquí mismo, se guarda allá</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {GEOCAMPO_CARDS.map((card) => {
                  const Icon = card.icon;
                  return (
                    <button
                      key={card.key}
                      type="button"
                      onClick={() => onSelectGeoCampoSection(card.key)}
                      className="text-left bg-white rounded-2xl border p-5 hover:shadow-md transition-all flex flex-col"
                      style={{ borderColor: '#E7E2D9' }}
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `${GEOCAMPO_ACCENT}14`, color: GEOCAMPO_ACCENT }}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <h3 className="mt-3 text-sm font-bold">{card.label}</h3>
                      <p className="mt-1 text-xs" style={{ color: '#78716C' }}>{card.description}</p>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">{children}</div>
      )}
    </div>
  );
};
