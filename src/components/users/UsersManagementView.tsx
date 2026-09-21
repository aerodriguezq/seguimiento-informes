import React, { useState } from 'react';
import { ShieldCheck, Plus, Trash2, Save, UserCog, ChevronDown, ChevronRight, ShieldAlert, Users as UsersIcon, RadioTower, Play, AlertTriangle, CheckCircle2, PauseCircle } from 'lucide-react';
import type { PermissionModule, PermissionLevel } from '../../auth/AuthContext';

export interface AuthorizedUser {
  email: string;
  name: string | null;
  isAdmin: boolean;
  active: boolean;
  permissions: Partial<Record<PermissionModule, PermissionLevel>>;
}

export interface SweepConfig {
  kind: string;
  label: string;
  active: boolean;
  frequencyMinutes: number;
  lastRunAt: string | null;
  lastRunSuccess: boolean | null;
  lastRunResult: Record<string, unknown> | null;
}

interface UsersManagementViewProps {
  users: AuthorizedUser[];
  currentUserEmail: string;
  onAddUser: (email: string, name: string) => Promise<void>;
  onUpdateUser: (email: string, updates: Partial<Pick<AuthorizedUser, 'name' | 'active' | 'isAdmin' | 'permissions'>>) => Promise<void>;
  onRemoveUser: (email: string) => Promise<void>;
  sweeps: SweepConfig[];
  onUpdateSweep: (kind: string, updates: { active?: boolean; frequencyMinutes?: number }) => Promise<void>;
  onTriggerSweep: (kind: string) => Promise<Record<string, unknown>>;
}

const MODULES: { key: PermissionModule; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'reports', label: 'Informes' },
  { key: 'projects', label: 'Proyectos' },
  { key: 'alerts', label: 'Alertas' },
  { key: 'lists', label: 'Listas Maestras' },
  { key: 'drive_links', label: 'Fuentes Drive' },
];

const PERMISSION_LABEL: Record<PermissionLevel, string> = { none: 'Sin acceso', view: 'Solo ver', edit: 'Editar' };

const UserRow: React.FC<{
  user: AuthorizedUser;
  isSelf: boolean;
  defaultOpen: boolean;
  onUpdateUser: UsersManagementViewProps['onUpdateUser'];
  onRemoveUser: UsersManagementViewProps['onRemoveUser'];
}> = ({ user, isSelf, defaultOpen, onUpdateUser, onRemoveUser }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [name, setName] = useState(user.name || '');
  const [isAdmin, setIsAdmin] = useState(user.isAdmin);
  const [active, setActive] = useState(user.active);
  const [permissions, setPermissions] = useState<Partial<Record<PermissionModule, PermissionLevel>>>(user.permissions || {});
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');

  const isDirty =
    name !== (user.name || '') ||
    isAdmin !== user.isAdmin ||
    active !== user.active ||
    JSON.stringify(permissions) !== JSON.stringify(user.permissions || {});

  const handleSave = async () => {
    setIsSaving(true);
    setError('');
    try {
      await onUpdateUser(user.email, { name, isAdmin, active, permissions });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible guardar los cambios.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!window.confirm(`¿Quitar el acceso de ${user.email}? Ya no podrá iniciar sesión.`)) return;
    setIsDeleting(true);
    try {
      await onRemoveUser(user.email);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible quitar el usuario.');
      setIsDeleting(false);
    }
  };

  const summaryPermCount = Object.values(user.permissions || {}).filter((v) => v === 'edit').length;

  return (
    <div className={`rounded-xl border overflow-hidden ${user.active ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50 opacity-70'}`}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-slate-50/80 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />}
          <div className="min-w-0">
            <p className="font-mono text-xs font-bold text-slate-900 truncate">{user.email}</p>
            <p className="text-[11px] text-slate-500 truncate">{user.name || 'Sin nombre'}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isSelf && <span className="rounded bg-teal-50 px-2 py-0.5 text-[10px] font-bold text-teal-700">Tú</span>}
          <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${user.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
            {user.active ? 'Activo' : 'Inactivo'}
          </span>
          {!user.isAdmin && <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{summaryPermCount}/{MODULES.length} editables</span>}
        </div>
      </button>

      {isOpen && (
        <div className="border-t border-slate-100 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={isSelf} className="rounded text-teal-600" />
              Activo
            </label>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer">
              <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} disabled={isSelf} className="rounded text-teal-600" />
              Administrador
            </label>
          </div>

          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre completo"
            className="w-full max-w-sm px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-teal-600"
          />

          {!isAdmin && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Permisos por módulo</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {MODULES.map((m) => (
                  <div key={m.key} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs">
                    <span className="text-slate-700">{m.label}</span>
                    <select
                      value={permissions[m.key] ?? 'edit'}
                      onChange={(e) => setPermissions((prev) => ({ ...prev, [m.key]: e.target.value as PermissionLevel }))}
                      className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] outline-none focus:border-teal-600"
                    >
                      <option value="none">{PERMISSION_LABEL.none}</option>
                      <option value="view">{PERMISSION_LABEL.view}</option>
                      <option value="edit">{PERMISSION_LABEL.edit}</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}
          {isAdmin && <p className="text-[11px] text-slate-500 italic">Los administradores tienen acceso total a todos los módulos.</p>}

          {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}

          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-2.5">
            {!isSelf && (
              <button
                type="button"
                onClick={handleRemove}
                disabled={isDeleting}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-lg disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {isDeleting ? 'Quitando...' : 'Quitar acceso'}
              </button>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={!isDirty || isSaving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-lg disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Save className="h-3.5 w-3.5" />
              {isSaving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

function formatSweepResult(kind: string, result: Record<string, unknown> | null): string {
  if (!result) return 'Sin datos aún.';
  if (result.skipped) return `Omitido (${result.skipped}).`;
  if (result.error) return `Error: ${String(result.error)}`;
  if (kind === 'deteccion_entregas') {
    return `${result.checked ?? 0} informe(s) revisados · ${result.advanced ?? 0} avanzado(s).`;
  }
  return `${result.evaluated ?? 0} alerta(s) evaluadas · ${result.sent ?? 0} enviada(s).`;
}

type LogEntry = { time: string; message: string; tone: 'info' | 'success' | 'error' };

const LOG_TONE_CLASSES: Record<LogEntry['tone'], string> = {
  info: 'text-slate-500',
  success: 'text-emerald-700',
  error: 'text-rose-600',
};

// La detección de entregas se mide en minutos (corre cada 30 min); los
// recordatorios son de ritmo diario, así que se editan en horas.
const SWEEP_UNITS: Record<string, { label: string; factor: number; min: number; step: number }> = {
  recordatorios_alertas: { label: 'h', factor: 60, min: 1, step: 1 },
};
const DEFAULT_UNIT = { label: 'min', factor: 1, min: 5, step: 5 };

function getSweepUnit(kind: string) {
  return SWEEP_UNITS[kind] || DEFAULT_UNIT;
}

const SweepCard: React.FC<{
  sweep: SweepConfig;
  onUpdateSweep: UsersManagementViewProps['onUpdateSweep'];
  onTriggerSweep: UsersManagementViewProps['onTriggerSweep'];
}> = ({ sweep, onUpdateSweep, onTriggerSweep }) => {
  const unit = getSweepUnit(sweep.kind);
  const [frequency, setFrequency] = useState(String(sweep.frequencyMinutes / unit.factor));
  const [isSavingFreq, setIsSavingFreq] = useState(false);
  const [isTogglingActive, setIsTogglingActive] = useState(false);
  const [isRunningNow, setIsRunningNow] = useState(false);
  const [error, setError] = useState('');
  const [log, setLog] = useState<LogEntry[]>([]);

  const pushLog = (message: string, tone: LogEntry['tone']) => {
    const time = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLog((prev) => [{ time, message, tone }, ...prev].slice(0, 6));
  };

  const frequencyDirty = frequency !== String(sweep.frequencyMinutes / unit.factor);

  const health = !sweep.lastRunAt
    ? { label: 'Sin ejecuciones aún', tone: 'slate', Icon: PauseCircle }
    : !sweep.active
    ? { label: 'Desactivado', tone: 'slate', Icon: PauseCircle }
    : sweep.lastRunSuccess === false
    ? { label: 'Con errores', tone: 'rose', Icon: AlertTriangle }
    : (() => {
        const elapsedMinutes = (Date.now() - new Date(sweep.lastRunAt as string).getTime()) / 60000;
        return elapsedMinutes > sweep.frequencyMinutes * 3
          ? { label: 'Posible interrupción', tone: 'amber', Icon: AlertTriangle }
          : { label: 'Funcionando', tone: 'emerald', Icon: CheckCircle2 };
      })();

  const toneClasses: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-600',
    rose: 'bg-rose-50 text-rose-700',
    amber: 'bg-amber-50 text-amber-700',
    emerald: 'bg-emerald-50 text-emerald-700',
  };

  const handleToggleActive = async () => {
    setIsTogglingActive(true);
    setError('');
    try {
      await onUpdateSweep(sweep.kind, { active: !sweep.active });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible cambiar el estado.');
    } finally {
      setIsTogglingActive(false);
    }
  };

  const handleSaveFrequency = async () => {
    const enteredValue = Math.max(unit.min, Number(frequency) || 0);
    const minutes = enteredValue * unit.factor;
    setIsSavingFreq(true);
    setError('');
    try {
      await onUpdateSweep(sweep.kind, { frequencyMinutes: minutes });
      setFrequency(String(enteredValue));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible guardar la frecuencia.');
    } finally {
      setIsSavingFreq(false);
    }
  };

  const handleRunNow = async () => {
    setIsRunningNow(true);
    setError('');
    pushLog('Enviando solicitud al servidor...', 'info');
    try {
      const result = await onTriggerSweep(sweep.kind);
      pushLog(formatSweepResult(sweep.kind, result), 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No fue posible lanzar el barrido.';
      setError(message);
      pushLog(message, 'error');
    } finally {
      setIsRunningNow(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700 shrink-0">
            <RadioTower className="h-4.5 w-4.5" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-900">{sweep.label}</p>
            <p className="text-[11px] text-slate-500 font-mono">{sweep.kind}</p>
          </div>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${toneClasses[health.tone]}`}>
          <health.Icon className="h-3 w-3" />
          {health.label}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs">
        <label className="inline-flex items-center gap-2 cursor-pointer select-none">
          <button
            type="button"
            role="switch"
            aria-checked={sweep.active}
            onClick={handleToggleActive}
            disabled={isTogglingActive}
            className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-50 ${sweep.active ? 'bg-teal-700' : 'bg-slate-300'}`}
          >
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${sweep.active ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
          <span className="font-semibold text-slate-700">{sweep.active ? 'Activo' : 'Desactivado'}</span>
        </label>

        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-slate-700">Cada</span>
          <input
            id={`sweep-frequency-${sweep.kind}`}
            type="number"
            min={unit.min}
            step={unit.step}
            value={frequency}
            onChange={(e) => setFrequency(e.target.value)}
            className="w-16 px-2 py-1 border border-slate-200 rounded-lg outline-none focus:border-teal-600 text-center"
          />
          <span className="text-slate-500">{unit.label}</span>
          {frequencyDirty && (
            <button
              type="button"
              onClick={handleSaveFrequency}
              disabled={isSavingFreq}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-lg disabled:opacity-50"
            >
              <Save className="h-3 w-3" />
              {isSavingFreq ? 'Guardando...' : 'Guardar'}
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={handleRunNow}
          disabled={isRunningNow}
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-teal-700 border border-teal-200 bg-teal-50 hover:bg-teal-100 rounded-lg disabled:opacity-50"
        >
          <Play className="h-3 w-3" />
          {isRunningNow ? 'Ejecutando...' : 'Ejecutar ahora'}
        </button>
      </div>

      <div className="border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">
        <p>
          {sweep.lastRunAt
            ? `Última ejecución registrada: ${new Date(sweep.lastRunAt).toLocaleString('es-CO')}`
            : 'Aún no se ha ejecutado.'}
        </p>
        <p className="mt-0.5">{formatSweepResult(sweep.kind, sweep.lastRunResult)}</p>
      </div>

      <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 space-y-1 font-mono text-[10.5px] max-h-28 overflow-y-auto">
        {log.length === 0 ? (
          <p className="text-slate-400">Sin actividad reciente. Usa "Ejecutar ahora" para ver el progreso aquí.</p>
        ) : (
          log.map((entry, idx) => (
            <p key={idx} className={LOG_TONE_CLASSES[entry.tone]}>
              <span className="text-slate-400">[{entry.time}]</span> {entry.message}
            </p>
          ))
        )}
      </div>

      {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
    </div>
  );
};

export const UsersManagementView: React.FC<UsersManagementViewProps> = ({
  users,
  currentUserEmail,
  onAddUser,
  onUpdateUser,
  onRemoveUser,
  sweeps,
  onUpdateSweep,
  onTriggerSweep,
}) => {
  const [activeTab, setActiveTab] = useState<'admins' | 'users' | 'sweeps'>('users');
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setIsSaving(true);
    setError('');
    try {
      await onAddUser(newEmail.trim().toLowerCase(), newName.trim());
      setNewEmail('');
      setNewName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible agregar el usuario.');
    } finally {
      setIsSaving(false);
    }
  };

  const admins = users.filter((u) => u.isAdmin);
  const regularUsers = users.filter((u) => !u.isAdmin);
  const visibleUsers = activeTab === 'admins' ? admins : regularUsers;

  return (
    <div id="view-users-management" className="space-y-5 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
          <UserCog className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Usuarios Autorizados</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Solo las cuentas de Google listadas aquí pueden iniciar sesión. Controla por módulo si cada persona puede ver o editar.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-teal-700" />
          Autorizar nueva cuenta
        </h3>
        <form onSubmit={handleAdd} className="mt-3 flex flex-wrap items-end gap-2 text-xs">
          <div className="flex-1 min-w-50">
            <label className="block font-semibold text-slate-700 mb-1">Correo de Gmail</label>
            <input
              type="email"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="persona@gmail.com"
              className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-teal-600"
            />
          </div>
          <div className="flex-1 min-w-40">
            <label className="block font-semibold text-slate-700 mb-1">Nombre (opcional)</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nombre completo"
              className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-teal-600"
            />
          </div>
          <button
            type="submit"
            disabled={isSaving}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-teal-700 hover:bg-teal-800 text-white rounded-lg font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            {isSaving ? 'Guardando...' : 'Autorizar'}
          </button>
        </form>
        {error && <p className="mt-2 text-xs font-semibold text-rose-600">{error}</p>}
      </div>

      <div className="flex items-center gap-2 border-b border-slate-200 text-xs">
        <button
          type="button"
          onClick={() => setActiveTab('users')}
          className={`px-4 py-2.5 font-bold border-b-2 transition-colors inline-flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === 'users' ? 'border-teal-700 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <UsersIcon className="w-4 h-4" />
          <span>Usuarios ({regularUsers.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('admins')}
          className={`px-4 py-2.5 font-bold border-b-2 transition-colors inline-flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === 'admins' ? 'border-teal-700 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <ShieldAlert className="w-4 h-4" />
          <span>Administradores ({admins.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('sweeps')}
          className={`px-4 py-2.5 font-bold border-b-2 transition-colors inline-flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === 'sweeps' ? 'border-teal-700 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <RadioTower className="w-4 h-4" />
          <span>Barridos ({sweeps.length})</span>
        </button>
      </div>

      {activeTab === 'sweeps' ? (
        <div className="space-y-2.5">
          <p className="text-xs text-slate-500 -mt-1">
            Controla cada cuánto se revisan las entregas por correo y se envían los recordatorios, o lánzalos ya mismo.
          </p>
          {sweeps.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400 border-2 border-dashed border-slate-200 rounded-xl">
              Sin barridos configurados todavía.
            </div>
          ) : (
            sweeps.map((s) => (
              <SweepCard key={s.kind} sweep={s} onUpdateSweep={onUpdateSweep} onTriggerSweep={onTriggerSweep} />
            ))
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {visibleUsers.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400 border-2 border-dashed border-slate-200 rounded-xl">
              No hay usuarios en esta categoría.
            </div>
          ) : (
            visibleUsers.map((u, idx) => (
              <UserRow
                key={u.email}
                user={u}
                isSelf={u.email === currentUserEmail}
                defaultOpen={visibleUsers.length === 1 && idx === 0}
                onUpdateUser={onUpdateUser}
                onRemoveUser={onRemoveUser}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};
