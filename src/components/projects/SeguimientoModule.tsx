import React, { useEffect, useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { Project } from '../../types';
import { SeguimientoCronograma } from './SeguimientoCronograma';

interface SeguimientoModuleProps {
  projects: Project[];
  isAdmin: boolean;
}

// Preferimos abrir por defecto un proyecto que ya tenga Seguimiento configurado
// (hoy solo Montes de Maria), en vez de forzar al usuario a saber cuál elegir.
function preferredDefaultProjectId(projects: Project[]): string {
  const montesDeMaria = projects.find((p) => p.bpin === '20241301010155');
  return montesDeMaria?.id ?? projects[0]?.id ?? '';
}

export const SeguimientoModule: React.FC<SeguimientoModuleProps> = ({ projects, isAdmin }) => {
  const [selectedProjectId, setSelectedProjectId] = useState('');

  useEffect(() => {
    if (!selectedProjectId && projects.length > 0) {
      setSelectedProjectId(preferredDefaultProjectId(projects));
    }
  }, [projects, selectedProjectId]);

  const sortedProjects = [...projects].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div id="view-seguimiento" className="space-y-4 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
            <CalendarRange className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">Seguimiento</h2>
            <p className="text-xs text-slate-500 mt-0.5">Cronograma de entregas e insumos por proyecto.</p>
          </div>
        </div>

        <div>
          <label htmlFor="seguimiento-project-select" className="sr-only">Proyecto</label>
          <select
            id="seguimiento-project-select"
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="min-w-64 px-3 py-2 text-sm font-semibold border border-slate-200 rounded-lg outline-none focus:border-teal-600 bg-white"
          >
            {sortedProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>

      {selectedProjectId && (
        <SeguimientoCronograma projectId={selectedProjectId} isAdmin={isAdmin} standalone />
      )}
    </div>
  );
};
