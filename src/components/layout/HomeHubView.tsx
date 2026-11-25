import React from 'react';
import { MapPin, FileBarChart2, Settings, LogOut, ArrowRight } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';

// Pasa por el puente de sesión (api/auth/google/[action].ts, acción
// sso-geocampo) en vez de abrir el link directo -- así, si ya hay sesión
// aquí, Geo-Campo recibe un JWT firmado y la persona entra sin loguearse
// otra vez. Si no hay sesión, ese mismo endpoint manda a loguearse primero
// y rebota de vuelta.
const GEO_CAMPO_URL = `/api/auth/google/sso-geocampo?return=${encodeURIComponent('https://geocampo-egdn.vercel.app/panel/')}`;

// Ruta especial (no es un módulo real) que App.tsx reconoce para arrancar
// derecho en el espacio de Configuración -- así esta tarjeta puede abrirlo
// en una pestaña nueva de verdad (una URL real, no solo un cambio de estado
// interno), mientras el usuario sigue trabajando en Informes en la otra.
const CONFIGURACION_URL = '/configuracion';

interface HomeHubViewProps {
  onEnterReports: () => void;
  canOpenSettings: boolean;
  onLogout: () => void;
}

// Primera pantalla tras iniciar sesión: elegir a cuál de los sistemas
// disponibles entrar. "Informes" lleva al shell de esta app tal cual
// (Sidebar + Dashboard), en la misma pestaña. "Configuración" se abre en una
// pestaña NUEVA (junta en un solo lugar la configuración de Informes y la de
// GeoCampo, para poder seguir trabajando en Informes mientras se configura
// algo). "Geo-Campo" también navega en la misma pestaña -- para volver a
// esta pantalla desde ahí se usa el botón "Inicio" de GeoCampo. Desde
// Informes se vuelve con el botón "Inicio" del Sidebar (ver onGoHome en
// App.tsx).
export const HomeHubView: React.FC<HomeHubViewProps> = ({ onEnterReports, canOpenSettings, onLogout }) => {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-md bg-gradient-to-tr from-[#3B82F6] via-[#5238F5] to-[#8B5CF6]">
            <img src="/logo.svg" alt="" className="w-6 h-6 object-contain" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">¿A dónde quieres entrar?</h1>
            <p className="text-xs text-slate-500 mt-0.5">Hola, {user.name || user.email} -- elige un sistema para continuar.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50 rounded-lg"
        >
          <LogOut className="h-3.5 w-3.5" />
          Cerrar sesión
        </button>
      </header>

      <div className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-5xl grid grid-cols-1 sm:grid-cols-3 gap-5">
          <a
            href={GEO_CAMPO_URL}
            className="group text-left bg-white rounded-2xl border border-slate-200 p-6 hover:border-emerald-400 hover:shadow-lg transition-all flex flex-col"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 group-hover:bg-emerald-100">
              <MapPin className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-base font-bold text-slate-900">Geo-Campo</h3>
            <p className="mt-1 text-xs text-slate-500 flex-1">Sistema externo de georreferenciación y visitas de campo.</p>
            <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
              Entrar <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </a>

          <button
            type="button"
            onClick={onEnterReports}
            className="group text-left bg-white rounded-2xl border border-slate-200 p-6 hover:border-teal-400 hover:shadow-lg transition-all flex flex-col"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal-50 text-teal-700 group-hover:bg-teal-100">
              <FileBarChart2 className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-base font-bold text-slate-900">Informes</h3>
            <p className="mt-1 text-xs text-slate-500 flex-1">Seguimiento de informes, alertas y proyectos.</p>
            <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-teal-700">
              Entrar <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </button>

          {canOpenSettings ? (
            <a
              href={CONFIGURACION_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group text-left bg-white rounded-2xl border border-slate-200 p-6 hover:border-indigo-400 hover:shadow-lg transition-all flex flex-col"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700 group-hover:bg-indigo-100">
                <Settings className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-base font-bold text-slate-900">Configuración</h3>
              <p className="mt-1 text-xs text-slate-500 flex-1">Listas maestras de Informes y accesos de GeoCampo, en una pestaña aparte.</p>
              <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-indigo-700">
                Abrir en pestaña nueva <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </a>
          ) : (
            <div
              title="No tienes permiso para ver Configuración."
              className="text-left bg-white rounded-2xl border border-slate-200 p-6 opacity-50 cursor-not-allowed flex flex-col"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
                <Settings className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-base font-bold text-slate-900">Configuración</h3>
              <p className="mt-1 text-xs text-slate-500 flex-1">Listas maestras de Informes y accesos de GeoCampo, en una pestaña aparte.</p>
              <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-indigo-700">
                Abrir en pestaña nueva <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
