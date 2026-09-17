import React, { useState } from 'react';
import { ScheduledAlert, Project, Contact } from '../../types';
import { ScheduleFrequencyField } from './ScheduleFrequencyField';
import {
  BellRing,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  Send,
  AlertTriangle,
  Play,
  Users,
  Building2,
  X,
  Sparkles,
  Edit2,
  Trash2,
} from 'lucide-react';

interface AlertsViewProps {
  alerts: ScheduledAlert[];
  projects: Project[];
  contacts: Contact[];
  onToggleAlertActive: (alertId: string) => void;
  onAddNewAlert: (draft: {
    projectId?: string;
    name: string;
    schedule: string;
    time: string;
    type: ScheduledAlert['type'];
    recipientIds: string[];
  }) => Promise<void>;
  onUpdateAlert: (alertId: string, draft: {
    projectId?: string;
    name: string;
    schedule: string;
    time: string;
    type: ScheduledAlert['type'];
    recipientIds: string[];
  }) => Promise<void>;
  onDeleteAlert: (alertId: string) => Promise<void>;
  onSimulateTrigger: (alert: ScheduledAlert) => Promise<void>;
}

export const AlertsView: React.FC<AlertsViewProps> = ({
  alerts,
  projects,
  contacts,
  onToggleAlertActive,
  onAddNewAlert,
  onUpdateAlert,
  onDeleteAlert,
  onSimulateTrigger,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterProject, setFilterProject] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editingAlertId, setEditingAlertId] = useState<string | null>(null);

  // Form states for new/edit rule
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState(projects[0]?.id || '');
  const [schedule, setSchedule] = useState('5 días antes del vencimiento');
  const [time, setTime] = useState('08:00 AM');
  const [type, setType] = useState<'Preventiva' | 'Vencimiento' | 'Seguimiento' | 'Confirmación'>('Preventiva');
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([contacts[0]?.id || '']);

  const openCreateModal = () => {
    setEditingAlertId(null);
    setName('');
    setProjectId(projects[0]?.id || '');
    setSchedule('5 días antes del vencimiento');
    setTime('08:00 AM');
    setType('Preventiva');
    setSelectedContactIds([contacts[0]?.id || '']);
    setShowModal(true);
  };

  const openEditModal = (alert: ScheduledAlert) => {
    setEditingAlertId(alert.id);
    setName(alert.name);
    setProjectId(alert.projectId || projects[0]?.id || '');
    setSchedule(alert.schedule);
    setTime(alert.time);
    setType(alert.type);
    setSelectedContactIds(alert.recipientIds);
    setShowModal(true);
  };

  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);

  const handleDelete = async (alertId: string) => {
    if (!window.confirm('¿Eliminar esta regla de alerta? Esta acción no se puede deshacer.')) return;
    setIsDeletingId(alertId);
    try {
      await onDeleteAlert(alertId);
    } finally {
      setIsDeletingId(null);
    }
  };

  const filteredAlerts = alerts.filter((a) => {
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      if (!a.name.toLowerCase().includes(q) && !(a.projectName || '').toLowerCase().includes(q)) {
        return false;
      }
    }
    if (filterType !== 'all' && a.type !== filterType) return false;
    if (filterProject !== 'all' && a.projectId !== filterProject) return false;
    return true;
  });

  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || selectedContactIds.length === 0) return;

    setIsCreating(true);
    try {
      const draft = {
        projectId,
        name: name.trim(),
        schedule,
        time,
        type,
        recipientIds: selectedContactIds,
      };
      if (editingAlertId) {
        await onUpdateAlert(editingAlertId, draft);
      } else {
        await onAddNewAlert(draft);
      }
      setShowModal(false);
      setName('');
      setEditingAlertId(null);
    } catch {
      // El toast de error ya lo muestra App.tsx; dejamos el modal abierto para reintentar.
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div id="view-alerts" className="space-y-5 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            Motor de Alertas y Notificaciones Automáticas
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Configuración de reglas preventivas, avisos de vencimiento y recordatorios periódicos para los responsables.
          </p>
        </div>

        <button
          id="create-alert-rule-btn"
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-2xs transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Crear Regla de Alerta</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-xs flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por nombre de regla o proyecto..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 hover:bg-slate-100/70 focus:bg-white border border-slate-200 rounded-lg outline-none focus:border-indigo-500 transition-all"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={filterProject}
            onChange={(e) => setFilterProject(e.target.value)}
            className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none text-slate-800"
          >
            <option value="all">Todos los proyectos</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none text-slate-800"
          >
            <option value="all">Todos los tipos</option>
            <option value="Preventiva">Preventiva</option>
            <option value="Vencimiento">Vencimiento</option>
            <option value="Seguimiento">Seguimiento</option>
          </select>
        </div>
      </div>

      {/* Rules Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-3 px-4">Nombre de la Regla</th>
                <th className="py-3 px-4">Proyecto Asociado</th>
                <th className="py-3 px-4">Programación / Condición</th>
                <th className="py-3 px-4">Hora</th>
                <th className="py-3 px-4">Tipo</th>
                <th className="py-3 px-4">Destinatarios</th>
                <th className="py-3 px-4">Próxima Ejecución</th>
                <th className="py-3 px-4">Estado</th>
                <th className="py-3 px-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredAlerts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-400">
                    No se encontraron reglas de alerta con los filtros aplicados.
                  </td>
                </tr>
              ) : (
                filteredAlerts.map((alert) => {
                  const recipientNames = alert.recipientIds
                    .map((id) => contacts.find((c) => c.id === id)?.name)
                    .filter(Boolean);

                  return (
                    <tr key={alert.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 px-4 font-semibold text-slate-900">
                        {alert.name}
                      </td>
                      <td className="py-3.5 px-4 text-slate-700 max-w-xs">
                        <div className="line-clamp-1">{alert.projectName || 'General'}</div>
                      </td>
                      <td className="py-3.5 px-4 font-medium text-slate-800">
                        {alert.schedule}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-600">
                        {alert.time}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            alert.type === 'Vencimiento'
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : alert.type === 'Preventiva'
                              ? 'bg-amber-50 text-amber-800 border border-amber-200'
                              : 'bg-indigo-50 text-indigo-700'
                          }`}
                        >
                          {alert.type}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 max-w-48">
                        <span className="text-[11px] text-slate-600 line-clamp-1">
                          {recipientNames.length > 0 ? recipientNames.join(', ') : 'Sin destinatarios'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 font-medium">
                        {alert.nextExecution}
                      </td>
                      <td className="py-3.5 px-4">
                        <button
                          type="button"
                          onClick={() => onToggleAlertActive(alert.id)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors cursor-pointer ${
                            alert.active
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          <span
                            className={`w-2 h-2 rounded-full ${
                              alert.active ? 'bg-emerald-500' : 'bg-slate-400'
                            }`}
                          />
                          {alert.active ? 'Activa' : 'Inactiva'}
                        </button>
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onSimulateTrigger(alert)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-md transition-colors"
                            title="Simular disparo de alerta y enviar notificación"
                          >
                            <Play className="w-3 h-3" />
                            <span>Probar Envío</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(alert)}
                            className="p-1.5 text-slate-400 hover:text-indigo-700 hover:bg-indigo-50 rounded-md transition-colors"
                            title="Editar regla"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(alert.id)}
                            disabled={isDeletingId === alert.id}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors disabled:opacity-50"
                            title="Eliminar regla"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Rule Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-2xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 p-5 max-w-lg w-full space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <BellRing className="w-4 h-4 text-indigo-600" />
                {editingAlertId ? 'Editar Regla de Alerta' : 'Crear Regla de Alerta Automática'}
              </h3>
              <button
                type="button"
                onClick={() => { setShowModal(false); setEditingAlertId(null); }}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Nombre descriptivo de la regla
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej: Notificación anticipada 4 días antes del vencimiento"
                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Proyecto objetivo
                </label>
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.bpin})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Frecuencia / Programación
                  </label>
                  <ScheduleFrequencyField value={schedule} onChange={setSchedule} />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Hora de disparo
                  </label>
                  <input
                    type="text"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Tipo de Alerta
                </label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as any)}
                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500"
                >
                  <option value="Preventiva">Preventiva (Aviso de corte próximo)</option>
                  <option value="Vencimiento">Vencimiento (Crítica / Urgente)</option>
                  <option value="Seguimiento">Seguimiento (Recordatorio recurrente)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Destinatarios
                </label>
                <div className="max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1.5">
                  {contacts.map((c) => {
                    const checked = selectedContactIds.includes(c.id);
                    return (
                      <label key={c.id} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            if (checked) {
                              setSelectedContactIds(selectedContactIds.filter((id) => id !== c.id));
                            } else {
                              setSelectedContactIds([...selectedContactIds, c.id]);
                            }
                          }}
                          className="rounded text-indigo-600"
                        />
                        <span className="text-slate-800">
                          {c.name} ({c.role})
                        </span>
                      </label>
                    );
                  })}
                </div>
                {selectedContactIds.length === 0 && (
                  <p className="mt-1 text-[11px] text-rose-600">Selecciona al menos un destinatario.</p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setEditingAlertId(null); }}
                  className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={selectedContactIds.length === 0 || isCreating}
                  className="px-4 py-1.5 font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isCreating ? 'Guardando...' : editingAlertId ? 'Guardar Cambios' : 'Registrar Regla'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
