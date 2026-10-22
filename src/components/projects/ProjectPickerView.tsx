import React, { useState } from 'react';
import { Building2, LogOut, Search } from 'lucide-react';
import { Project } from '../../types';
import { useAuth } from '../../auth/AuthContext';

interface ProjectPickerViewProps {
  projects: Project[];
  onSelectProject: (projectId: string) => void;
  onLogout: () => void;
}

// Pantalla de entrada tras iniciar sesión: elegir UN proyecto activo (de los
// que esta cuenta tiene acceso -- ya viene filtrado desde el backend) para
// que el resto de la app quede acotada solo a su información.
export const ProjectPickerView: React.FC<ProjectPickerViewProps> = ({ projects, onSelectProject, onLogout }) => {
  const { user } = useAuth();
  const [search, setSearch] = useState('');

  const activeProjects = projects.filter((p) => p.active);
  const filtered = search.trim()
    ? activeProjects.filter((p) =>
        `${p.name} ${p.bpin} ${p.company}`.toLowerCase().includes(search.trim().toLowerCase()),
      )
    : activeProjects;

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-900">¿En qué proyecto quieres trabajar?</h1>
          <p className="text-xs text-slate-500 mt-0.5">Elige un proyecto para ver solo su información. Puedes cambiar de proyecto cuando quieras.</p>
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

      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="relative max-w-sm mb-6">
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, BPIN o empresa..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-teal-600 bg-white"
          />
        </div>

        {activeProjects.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-400 border-2 border-dashed border-slate-200 rounded-2xl bg-white">
            {user?.isAdmin
              ? 'No hay proyectos activos todavía. Créalos o actívalos desde "Proyectos".'
              : 'Todavía no tienes acceso a ningún proyecto activo. Pídele a un administrador que te lo asigne.'}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-400 border-2 border-dashed border-slate-200 rounded-2xl bg-white">
            Ningún proyecto coincide con "{search}".
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelectProject(p.id)}
                className="text-left bg-white rounded-xl border border-slate-200 p-4 hover:border-teal-400 hover:shadow-md transition-all group"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-50 text-teal-700 group-hover:bg-teal-100">
                  <Building2 className="h-5 w-5" />
                </div>
                <h3 className="mt-3 text-sm font-bold text-slate-900 line-clamp-2">{p.name}</h3>
                <p className="mt-1 text-[11px] text-slate-500">BPIN: {p.bpin || '—'}</p>
                <p className="text-[11px] text-slate-500 truncate">{p.company}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
