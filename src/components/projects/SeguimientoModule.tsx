import React from 'react';
import { CalendarRange } from 'lucide-react';
import { SeguimientoCronograma } from './SeguimientoCronograma';
import { useAuth } from '../../auth/AuthContext';

interface SeguimientoModuleProps {
  currentProjectId: string;
}

export const SeguimientoModule: React.FC<SeguimientoModuleProps> = ({ currentProjectId }) => {
  const { canEdit } = useAuth();

  return (
    <div id="view-seguimiento" className="space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
          <CalendarRange className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Seguimiento</h2>
          <p className="text-xs text-slate-500 mt-0.5">Cronograma de entregas e insumos del proyecto.</p>
        </div>
      </div>

      {currentProjectId && (
        <SeguimientoCronograma projectId={currentProjectId} canEdit={canEdit('seguimiento')} standalone />
      )}
    </div>
  );
};
