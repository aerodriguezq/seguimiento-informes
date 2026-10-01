import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Inbox, Plus, Pencil, Trash2, X, Search, BellRing, FolderOpen, Upload, FileText, CheckCircle2, XCircle, FileSpreadsheet, Settings, Save } from 'lucide-react';
import { AreaConsolida, Contact, Empresa, Peticion, PeticionesConfig, Project, SemaforoStatus } from '../../types';
import { SemaforoBadge } from '../common/SemaforoBadge';
import { useAuth } from '../../auth/AuthContext';

type PeticionFormState = {
  empresaId: string;
  fechaRadicacion: string;
  peticionario: string;
  asunto: string;
  areaConsolida: string;
  correoPersonaAsignada: string;
  areasIntervienen: string;
  plazoRespuesta: string;
  fechaRadicadoRespuesta: string;
  observaciones: string;
  responsableIds: string[];
  proyectoIds: string[];
};

const EMPTY_FORM: PeticionFormState = {
  empresaId: '',
  fechaRadicacion: '',
  peticionario: '',
  asunto: '',
  areaConsolida: '',
  correoPersonaAsignada: '',
  areasIntervienen: '',
  plazoRespuesta: '',
  fechaRadicadoRespuesta: '',
  observaciones: '',
  responsableIds: [],
  proyectoIds: [],
};

function formToPayload(form: PeticionFormState) {
  return {
    empresaId: form.empresaId ? Number(form.empresaId) : null,
    fechaRadicacion: form.fechaRadicacion || null,
    peticionario: form.peticionario.trim(),
    asunto: form.asunto.trim(),
    areaConsolida: form.areaConsolida.trim(),
    correoPersonaAsignada: form.correoPersonaAsignada.trim(),
    areasIntervienen: form.areasIntervienen.trim(),
    plazoRespuesta: form.plazoRespuesta === '' ? null : Number(form.plazoRespuesta),
    fechaRadicadoRespuesta: form.fechaRadicadoRespuesta || null,
    observaciones: form.observaciones.trim(),
  };
}

function peticionToForm(p: Peticion): PeticionFormState {
  return {
    empresaId: p.empresaId ?? '',
    fechaRadicacion: p.fechaRadicacion ?? '',
    peticionario: p.peticionario,
    asunto: p.asunto,
    areaConsolida: p.areaConsolida,
    correoPersonaAsignada: p.correoPersonaAsignada,
    areasIntervienen: p.areasIntervienen,
    plazoRespuesta: p.plazoRespuesta === null ? '' : String(p.plazoRespuesta),
    fechaRadicadoRespuesta: p.fechaRadicadoRespuesta ?? '',
    observaciones: p.observaciones ?? '',
    responsableIds: p.responsables.map((r) => r.id),
    proyectoIds: p.proyectos.map((pr) => pr.id),
  };
}

// Solo tiene sentido una vez que ya se registró la fecha de respuesta: si no
// hay plazo definido, no se puede estar "fuera de tiempo" de nada.
function computeResponseOnTime(p: Peticion): boolean {
  if (!p.fechaRadicadoRespuesta) return true;
  if (!p.fechaPlazoRespuesta) return true;
  return p.fechaRadicadoRespuesta <= p.fechaPlazoRespuesta;
}

const ResponseStatusBadge: React.FC<{ onTime: boolean }> = ({ onTime }) =>
  onTime ? (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 whitespace-nowrap">
      <CheckCircle2 className="w-3.5 h-3.5" />
      Respondido a tiempo
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200 whitespace-nowrap">
      <XCircle className="w-3.5 h-3.5" />
      Respondido fuera de tiempo
    </span>
  );

// Mismos umbrales que el backend (server/google-gmail.ts /
// api/alerts/index.ts): 5 días = verde, 3 días = amarillo, 2 días en
// adelante (incluye vencido) = rojo.
function computeAlertStatus(p: Peticion): { status: SemaforoStatus; daysRemaining?: number } {
  if (p.fechaRadicadoRespuesta) return { status: 'en_tiempo' };
  if (!p.fechaPlazoRespuesta) return { status: 'no_aplica' };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${p.fechaPlazoRespuesta}T00:00:00`);
  const days = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 2) return { status: 'vencido', daysRemaining: days };
  if (days <= 4) return { status: 'proximo', daysRemaining: days };
  return { status: 'en_tiempo', daysRemaining: days };
}

// Recuerda el último "correo adicional" usado para no tener que
// escribirlo de nuevo cada vez que se crea una petición.
const LAST_CORREO_KEY = 'peticiones:lastCorreoAdicional';
function getLastCorreoAdicional(): string {
  try {
    return window.localStorage.getItem(LAST_CORREO_KEY) ?? '';
  } catch {
    return '';
  }
}
function setLastCorreoAdicional(value: string) {
  try {
    if (value) window.localStorage.setItem(LAST_CORREO_KEY, value);
  } catch {
    /* localStorage no disponible (modo privado, etc.) — no es crítico */
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const FIELD_LABEL: Record<string, string> = {
  empresa: 'Empresa',
  fechaRadicacion: 'Fecha Radicación',
  peticionario: 'Peticionario',
  asunto: 'Asunto',
  areaConsolida: 'Área Consolida',
  correoPersonaAsignada: 'Correo adicional (opcional)',
  areasIntervienen: 'Áreas Intervienen',
  plazoRespuesta: 'Plazo Respuesta (días)',
  fechaRadicadoRespuesta: 'Fecha Radicado Respuesta',
  observaciones: 'Observaciones',
};

const PeticionForm: React.FC<{
  form: PeticionFormState;
  onChange: (form: PeticionFormState) => void;
  contacts: Contact[];
  empresas: Empresa[];
  areasConsolida: AreaConsolida[];
  projects: Project[];
}> = ({ form, onChange, contacts, empresas, areasConsolida, projects }) => {
  const set = (key: keyof PeticionFormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    onChange({ ...form, [key]: e.target.value });

  const toggleResponsable = (contactId: string) => {
    const next = form.responsableIds.includes(contactId)
      ? form.responsableIds.filter((id) => id !== contactId)
      : [...form.responsableIds, contactId];
    onChange({ ...form, responsableIds: next });
  };

  const toggleProyecto = (projectId: string) => {
    const next = form.proyectoIds.includes(projectId)
      ? form.proyectoIds.filter((id) => id !== projectId)
      : [...form.proyectoIds, projectId];
    onChange({ ...form, proyectoIds: next });
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <label className="block text-[11px] font-semibold text-slate-700 mb-1">{FIELD_LABEL.empresa} *</label>
        <select value={form.empresaId} onChange={set('empresaId')} className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-teal-600 bg-white">
          <option value="">Selecciona una empresa...</option>
          {empresas.map((e) => (
            <option key={e.id} value={e.id}>{e.name}{e.code ? ` (${e.code})` : ''}</option>
          ))}
        </select>
        <p className="mt-1 text-[10.5px] text-slate-400">El radicado se genera solo: año-empresa-consecutivo.</p>
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-slate-700 mb-1">{FIELD_LABEL.fechaRadicacion}</label>
        <input type="date" value={form.fechaRadicacion} onChange={set('fechaRadicacion')} className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-teal-600" />
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-slate-700 mb-1">{FIELD_LABEL.peticionario}</label>
        <input value={form.peticionario} onChange={set('peticionario')} className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-teal-600" />
      </div>
      <div className="sm:col-span-2">
        <label className="block text-[11px] font-semibold text-slate-700 mb-1">{FIELD_LABEL.asunto} *</label>
        <input value={form.asunto} onChange={set('asunto')} className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-teal-600" />
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-slate-700 mb-1">{FIELD_LABEL.areaConsolida}</label>
        <select value={form.areaConsolida} onChange={set('areaConsolida')} className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-teal-600 bg-white">
          <option value="">Selecciona un área...</option>
          {areasConsolida.map((a) => (
            <option key={a.id} value={a.name}>{a.name}</option>
          ))}
          {form.areaConsolida && !areasConsolida.some((a) => a.name === form.areaConsolida) && (
            <option value={form.areaConsolida}>{form.areaConsolida} (no está en la lista)</option>
          )}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className="block text-[11px] font-semibold text-slate-700 mb-1">{FIELD_LABEL.areasIntervienen}</label>
        <input value={form.areasIntervienen} onChange={set('areasIntervienen')} className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-teal-600" />
      </div>

      <div className="sm:col-span-2">
        <label className="block text-[11px] font-semibold text-slate-700 mb-1">Proyectos *</label>
        <div className="max-h-36 overflow-y-auto rounded-lg border border-slate-200 p-2 space-y-1">
          {projects.length === 0 ? (
            <p className="text-[11px] italic text-slate-400">No hay proyectos registrados.</p>
          ) : (
            projects.map((pr) => (
              <label key={pr.id} className="flex items-center gap-2 text-[11px] text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.proyectoIds.includes(pr.id)}
                  onChange={() => toggleProyecto(pr.id)}
                  className="rounded"
                  style={{ accentColor: '#0f766e' }}
                />
                <span className="font-medium">{pr.name}</span>
              </label>
            ))
          )}
        </div>
        <p className="mt-1 text-[10.5px] text-slate-400">Puedes asignar uno o varios proyectos a esta petición.</p>
      </div>

      <div className="sm:col-span-2">
        <label className="block text-[11px] font-semibold text-slate-700 mb-1">Responsables (Contactos de Listas Maestras)</label>
        <div className="max-h-36 overflow-y-auto rounded-lg border border-slate-200 p-2 space-y-1">
          {contacts.length === 0 ? (
            <p className="text-[11px] italic text-slate-400">No hay contactos registrados en Listas Maestras.</p>
          ) : (
            contacts.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-[11px] text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.responsableIds.includes(c.id)}
                  onChange={() => toggleResponsable(c.id)}
                  className="rounded"
                  style={{ accentColor: '#0f766e' }}
                />
                <span className="font-medium">{c.name}</span>
                <span className="text-slate-400">· {c.email || 'sin correo'}</span>
              </label>
            ))
          )}
        </div>
      </div>
      <div className="sm:col-span-2">
        <label className="block text-[11px] font-semibold text-slate-700 mb-1">{FIELD_LABEL.correoPersonaAsignada}</label>
        <input type="email" value={form.correoPersonaAsignada} onChange={set('correoPersonaAsignada')} className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-teal-600" />
        <p className="mt-1 text-[10.5px] text-slate-400">Va en copia (CC) al correo de los responsables asignados.</p>
      </div>

      <div>
        <label className="block text-[11px] font-semibold text-slate-700 mb-1">{FIELD_LABEL.plazoRespuesta}</label>
        <input type="number" min={0} value={form.plazoRespuesta} onChange={set('plazoRespuesta')} className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-teal-600" />
        <p className="mt-1 text-[10.5px] text-slate-400">La Fecha Plazo Respuesta se calcula sola (Fecha Radicación + días).</p>
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-slate-700 mb-1">{FIELD_LABEL.fechaRadicadoRespuesta}</label>
        <input type="date" value={form.fechaRadicadoRespuesta} onChange={set('fechaRadicadoRespuesta')} className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-teal-600" />
      </div>
      <div className="sm:col-span-2">
        <label className="block text-[11px] font-semibold text-slate-700 mb-1">{FIELD_LABEL.observaciones}</label>
        <textarea
          rows={3}
          value={form.observaciones}
          onChange={set('observaciones')}
          placeholder="Notas internas sobre esta petición..."
          className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-teal-600 resize-y"
        />
        <p className="mt-1 text-[10.5px] text-slate-400">Se incluyen en los correos de asignación y recordatorio de esta petición.</p>
      </div>
    </div>
  );
};

export const PeticionesView: React.FC<{
  contacts: Contact[];
  empresas: Empresa[];
  areasConsolida: AreaConsolida[];
  projects: Project[];
  peticionesConfig: PeticionesConfig;
  onSavePeticionesConfig: (driveRootFolderUrl: string) => Promise<void>;
}> = ({ contacts, empresas, areasConsolida, projects, peticionesConfig, onSavePeticionesConfig }) => {
  const { user, canEdit } = useAuth();
  const editable = canEdit('peticiones');
  const isAdmin = !!user?.isAdmin;

  const [peticiones, setPeticiones] = useState<Peticion[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingRadicado, setEditingRadicado] = useState<string | null>(null);
  const [form, setForm] = useState<PeticionFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reminderState, setReminderState] = useState<Record<string, 'sending' | 'sent' | 'error'>>({});
  const [uploadingWhich, setUploadingWhich] = useState<'peticion' | 'respuesta' | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [driveFolderInput, setDriveFolderInput] = useState('');
  const [isSavingDriveConfig, setIsSavingDriveConfig] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const peticionFileInputRef = useRef<HTMLInputElement>(null);
  const respuestaFileInputRef = useRef<HTMLInputElement>(null);

  const fetchPeticiones = async () => {
    try {
      const res = await fetch('/api/catalogs?kind=peticiones');
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.errors?.[0] || 'No fue posible cargar las peticiones.');
      setPeticiones(payload.data);
      setLoadError('');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'No fue posible cargar las peticiones.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPeticiones();
  }, []);

  const filtered = useMemo(() => {
    if (!peticiones) return [];
    const q = search.trim().toLowerCase();
    if (!q) return peticiones;
    return peticiones.filter(
      (p) =>
        p.radicado.toLowerCase().includes(q) ||
        p.peticionario.toLowerCase().includes(q) ||
        p.asunto.toLowerCase().includes(q) ||
        p.areaConsolida.toLowerCase().includes(q),
    );
  }, [peticiones, search]);

  const openCreate = () => {
    // Prioriza el último correo ya guardado en la base (funciona en
    // cualquier dispositivo/navegador); si no hay ninguno todavía, usa el
    // recordado localmente.
    const lastFromData = (peticiones ?? []).find((p) => p.correoPersonaAsignada)?.correoPersonaAsignada;
    setEditingId(null);
    setEditingRadicado(null);
    setForm({ ...EMPTY_FORM, correoPersonaAsignada: lastFromData || getLastCorreoAdicional() });
    setFormError('');
    setUploadError('');
    setIsFormOpen(true);
  };

  const openEdit = (p: Peticion) => {
    setEditingId(p.id);
    setEditingRadicado(p.radicado);
    setForm(peticionToForm(p));
    setFormError('');
    setUploadError('');
    setIsFormOpen(true);
  };

  const handleSave = async () => {
    if (!form.empresaId || !form.asunto.trim()) {
      setFormError('La empresa y el asunto son obligatorios.');
      return;
    }
    if (form.proyectoIds.length === 0) {
      setFormError('Debes asignar al menos un proyecto.');
      return;
    }
    setIsSaving(true);
    setFormError('');
    try {
      const payload = formToPayload(form);
      const res = await fetch('/api/catalogs', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          editingId
            ? { kind: 'peticion', id: Number(editingId), data: payload, responsableIds: form.responsableIds, proyectoIds: form.proyectoIds }
            : { kind: 'peticion', data: payload, responsableIds: form.responsableIds, proyectoIds: form.proyectoIds },
        ),
      });
      const responsePayload = await res.json();
      if (!res.ok) throw new Error(responsePayload.errors?.[0] || 'No fue posible guardar la petición.');
      setLastCorreoAdicional(payload.correoPersonaAsignada);
      setIsFormOpen(false);
      await fetchPeticiones();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No fue posible guardar la petición.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('¿Eliminar esta petición? Esta acción no se puede deshacer.')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/catalogs?kind=peticion&id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.errors?.[0] || 'No fue posible eliminar la petición.');
      setPeticiones((prev) => (prev ? prev.filter((p) => p.id !== id) : prev));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'No fue posible eliminar la petición.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleSendReminder = async (id: string) => {
    setReminderState((prev) => ({ ...prev, [id]: 'sending' }));
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sendPeticionReminder', peticionId: Number(id) }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.errors?.[0] || 'No fue posible enviar el recordatorio.');
      setReminderState((prev) => ({ ...prev, [id]: 'sent' }));
      window.setTimeout(() => setReminderState((prev) => ({ ...prev, [id]: undefined as any })), 4000);
    } catch (err) {
      setReminderState((prev) => ({ ...prev, [id]: 'error' }));
      window.setTimeout(() => setReminderState((prev) => ({ ...prev, [id]: undefined as any })), 4000);
    }
  };

  const editingPeticion = peticiones?.find((p) => p.id === editingId) ?? null;

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result ?? '');
        resolve(result.slice(result.indexOf(',') + 1));
      };
      reader.onerror = () => reject(new Error('No fue posible leer el archivo.'));
      reader.readAsDataURL(file);
    });

  const handleUploadDocument = async (which: 'peticion' | 'respuesta', file: File) => {
    if (!editingId) return;
    if (file.size > 4 * 1024 * 1024) {
      setUploadError('El archivo es demasiado grande (máx. 4 MB).');
      return;
    }
    setUploadingWhich(which);
    setUploadError('');
    try {
      const contentBase64 = await fileToBase64(file);
      const res = await fetch('/api/catalogs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'peticionDocument',
          data: { peticionId: Number(editingId), which, fileName: file.name, mimeType: file.type, contentBase64 },
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.errors?.[0] || 'No fue posible subir el documento.');
      await fetchPeticiones();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'No fue posible subir el documento.');
    } finally {
      setUploadingWhich(null);
    }
  };

  const handleSaveDriveConfig = async () => {
    if (!driveFolderInput.trim()) return;
    setIsSavingDriveConfig(true);
    try {
      await onSavePeticionesConfig(driveFolderInput.trim());
      setDriveFolderInput('');
      setIsConfigOpen(false);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'No fue posible guardar la carpeta de Drive.');
    } finally {
      setIsSavingDriveConfig(false);
    }
  };

  const handleExportExcel = async (range: { from: string; to: string } | null) => {
    const XLSX = await import('xlsx');
    const source = peticiones ?? [];
    const rows = range
      ? source.filter((p) => {
          if (!p.fechaRadicacion) return false;
          if (range.from && p.fechaRadicacion < range.from) return false;
          if (range.to && p.fechaRadicacion > range.to) return false;
          return true;
        })
      : source;

    const data = rows.map((p) => {
      const diasRespuesta =
        p.fechaRadicacion && p.fechaRadicadoRespuesta
          ? Math.round(
              (new Date(`${p.fechaRadicadoRespuesta}T00:00:00`).getTime() - new Date(`${p.fechaRadicacion}T00:00:00`).getTime()) /
                (1000 * 60 * 60 * 24),
            )
          : null;
      const diferenciaPlazo =
        p.fechaPlazoRespuesta && p.fechaRadicadoRespuesta
          ? Math.round(
              (new Date(`${p.fechaRadicadoRespuesta}T00:00:00`).getTime() - new Date(`${p.fechaPlazoRespuesta}T00:00:00`).getTime()) /
                (1000 * 60 * 60 * 24),
            )
          : null;
      return {
        Radicado: p.radicado,
        Empresa: p.empresaName,
        'Fecha Radicación': p.fechaRadicacion ?? '',
        Peticionario: p.peticionario,
        Asunto: p.asunto,
        Proyectos: p.proyectos.map((pr) => pr.name).join(', '),
        'Área Consolida': p.areaConsolida,
        Responsables: p.responsables.map((r) => r.name).join(', '),
        'Plazo (días)': p.plazoRespuesta ?? '',
        'Fecha Plazo Respuesta': p.fechaPlazoRespuesta ?? '',
        'Fecha Radicado Respuesta': p.fechaRadicadoRespuesta ?? '',
        'Días hasta la respuesta': diasRespuesta ?? '',
        'Días de diferencia vs. plazo': diferenciaPlazo ?? '',
        Estado: !p.fechaRadicadoRespuesta ? 'Pendiente' : computeResponseOnTime(p) ? 'Respondido a tiempo' : 'Respondido fuera de tiempo',
        Observaciones: p.observaciones ?? '',
      };
    });

    const sheet = XLSX.utils.json_to_sheet(data);
    sheet['!cols'] = [
      { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 22 }, { wch: 32 }, { wch: 28 }, { wch: 16 }, { wch: 24 },
      { wch: 10 }, { wch: 16 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 24 }, { wch: 36 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Peticiones');
    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `peticiones_tiempos_respuesta_${today}.xlsx`);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 pb-8">
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg shrink-0 bg-teal-50 text-teal-700">
              <Inbox className="h-4.5 w-4.5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Peticiones</h3>
              <p className="text-[11px] text-slate-500">
                Registro, responsables y recordatorios de radicados. Verde a 5 días, amarillo a 3, rojo desde 2 días.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative w-full sm:w-56">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por radicado, peticionario, asunto..."
                className="w-full pl-7 pr-2 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-teal-600"
              />
            </div>
            <button
              type="button"
              onClick={() => handleExportExcel(null)}
              disabled={!peticiones || peticiones.length === 0}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50 rounded-lg disabled:opacity-50"
              title="Exportar todas las peticiones a Excel"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Exportar
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setIsConfigOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50 rounded-lg"
                title="Configurar carpeta raíz de Drive"
              >
                <Settings className="h-3.5 w-3.5" />
              </button>
            )}
            {editable && (
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
              >
                <Plus className="h-3.5 w-3.5" />
                Nueva petición
              </button>
            )}
          </div>
        </div>

        {isAdmin && isConfigOpen && (
          <div className="mx-4 mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 border border-slate-100 p-3">
            <div className="flex-1 min-w-64">
              <label htmlFor="peticiones-drive-root" className="block text-[11px] font-semibold text-slate-700 mb-1">
                Carpeta raíz de Drive para documentos de Peticiones
              </label>
              <input
                id="peticiones-drive-root"
                type="text"
                value={driveFolderInput}
                onChange={(e) => setDriveFolderInput(e.target.value)}
                placeholder="https://drive.google.com/drive/folders/..."
                className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-teal-600"
              />
              <p className="mt-1 text-[10.5px] text-slate-500 font-mono">
                Actual: {peticionesConfig.driveRootFolderUrl ?? '(sin configurar)'}
              </p>
              <p className="mt-1 text-[10.5px] text-slate-400">Por cada petición se crea una subcarpeta con su radicado, donde se guardan sus documentos.</p>
            </div>
            <button
              type="button"
              onClick={handleSaveDriveConfig}
              disabled={isSavingDriveConfig || !driveFolderInput.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-lg disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {isSavingDriveConfig ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        )}

        <div className="mx-4 mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-[10.5px] font-semibold text-slate-500 mb-1">Exportar rango (Fecha Radicación)</label>
            <input type="date" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-teal-600" />
          </div>
          <span className="pb-1.5 text-xs text-slate-400">a</span>
          <div>
            <input type="date" value={exportTo} onChange={(e) => setExportTo(e.target.value)} className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-teal-600" />
          </div>
          <button
            type="button"
            onClick={() => handleExportExcel({ from: exportFrom, to: exportTo })}
            disabled={!peticiones || peticiones.length === 0 || (!exportFrom && !exportTo)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50 rounded-lg disabled:opacity-50"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Exportar rango
          </button>
        </div>

        {loadError && (
          <div className="mx-4 mt-3 rounded-lg bg-rose-50 border border-rose-100 px-3 py-2 text-xs text-rose-700">{loadError}</div>
        )}

        {isLoading ? (
          <div className="p-6 text-center text-xs text-slate-400">Cargando peticiones...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400 border-2 border-dashed border-slate-200 rounded-xl m-4">
            {peticiones && peticiones.length > 0 ? 'Sin resultados para esa búsqueda.' : 'Aún no hay peticiones registradas.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1150px] text-left">
              <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                <tr>
                  <th className="px-4 py-3">Radicado</th>
                  <th className="px-3 py-3">Fecha Radicación</th>
                  <th className="px-3 py-3">Peticionario</th>
                  <th className="px-3 py-3">Asunto</th>
                  <th className="px-3 py-3">Proyectos</th>
                  <th className="px-3 py-3">Área Consolida</th>
                  <th className="px-3 py-3">Responsables</th>
                  <th className="px-3 py-3">Plazo</th>
                  <th className="px-3 py-3">Fecha Plazo Respuesta</th>
                  <th className="px-3 py-3">Fecha Radicado Respuesta</th>
                  <th className="px-3 py-3">Estado</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filtered.map((p) => {
                  const alert = computeAlertStatus(p);
                  const responsablesText = p.responsables.map((r) => r.name).join(', ') || p.correoPersonaAsignada || '—';
                  const proyectosText = p.proyectos.map((pr) => pr.name).join(', ') || '—';
                  const reminder = reminderState[p.id];
                  return (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-bold text-slate-900 whitespace-nowrap">{p.radicado}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-slate-600">{fmtDate(p.fechaRadicacion)}</td>
                      <td className="px-3 py-3 max-w-40 truncate text-slate-700" title={p.peticionario}>{p.peticionario || '—'}</td>
                      <td className="px-3 py-3 max-w-56 truncate text-slate-700" title={p.asunto}>{p.asunto}</td>
                      <td className="px-3 py-3 max-w-44 truncate text-slate-600" title={proyectosText}>{proyectosText}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-slate-600">{p.areaConsolida || '—'}</td>
                      <td className="px-3 py-3 max-w-44 truncate text-slate-600" title={responsablesText}>{responsablesText}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-slate-600">{p.plazoRespuesta ?? '—'} d</td>
                      <td className="px-3 py-3 whitespace-nowrap text-slate-600">{fmtDate(p.fechaPlazoRespuesta)}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-slate-600">{fmtDate(p.fechaRadicadoRespuesta)}</td>
                      <td className="px-3 py-3">
                        {p.fechaRadicadoRespuesta ? (
                          <ResponseStatusBadge onTime={computeResponseOnTime(p)} />
                        ) : (
                          <SemaforoBadge status={alert.status} daysRemaining={alert.daysRemaining} />
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {p.driveFolderUrl && (
                            <a href={p.driveFolderUrl} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-teal-700" title="Abrir carpeta de Drive">
                              <FolderOpen className="h-3.5 w-3.5" />
                            </a>
                          )}
                          {!p.fechaRadicadoRespuesta && (
                            <button
                              type="button"
                              onClick={() => handleSendReminder(p.id)}
                              disabled={reminder === 'sending'}
                              className={`disabled:opacity-50 ${reminder === 'sent' ? 'text-emerald-600' : reminder === 'error' ? 'text-rose-600' : 'text-slate-400 hover:text-amber-600'}`}
                              title={reminder === 'sent' ? 'Recordatorio enviado' : reminder === 'error' ? 'No se pudo enviar' : 'Enviar recordatorio ahora'}
                            >
                              <BellRing className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {editable && (
                            <>
                              <button type="button" onClick={() => openEdit(p)} className="text-slate-400 hover:text-teal-700" title="Editar">
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(p.id)}
                                disabled={deletingId === p.id}
                                className="text-slate-400 hover:text-rose-600 disabled:opacity-50"
                                title="Eliminar"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold text-slate-900">{editingId ? 'Editar petición' : 'Nueva petición'}</h3>
                {editingRadicado && <p className="mt-0.5 text-[11px] font-mono text-slate-500">Radicado: {editingRadicado}</p>}
              </div>
              <button type="button" onClick={() => setIsFormOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <PeticionForm form={form} onChange={setForm} contacts={contacts} empresas={empresas} areasConsolida={areasConsolida} projects={projects} />
              {formError && <p className="text-xs text-rose-600">{formError}</p>}

              {editingId && (
                <div className="border-t border-slate-100 pt-3 space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Documentos</p>
                  {!peticionesConfig.driveRootFolderId ? (
                    <p className="text-[11px] italic text-slate-400">
                      {isAdmin ? 'Configura primero la carpeta raíz de Drive (ícono de engranaje arriba).' : 'Un administrador debe configurar primero la carpeta de Drive.'}
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="rounded-lg border border-slate-200 p-2.5 space-y-1.5">
                        <p className="text-[11px] font-semibold text-slate-700">Documento de petición</p>
                        {editingPeticion?.documentoPeticionUrl ? (
                          <a href={editingPeticion.documentoPeticionUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[11px] text-teal-700 hover:underline truncate">
                            <FileText className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{editingPeticion.documentoPeticionNombre}</span>
                          </a>
                        ) : (
                          <p className="text-[11px] italic text-slate-400">Sin documento cargado.</p>
                        )}
                        <input
                          ref={peticionFileInputRef}
                          type="file"
                          className="hidden"
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadDocument('peticion', f); e.target.value = ''; }}
                        />
                        <button
                          type="button"
                          onClick={() => peticionFileInputRef.current?.click()}
                          disabled={uploadingWhich === 'peticion'}
                          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 hover:text-teal-700 disabled:opacity-50"
                        >
                          <Upload className="h-3.5 w-3.5" />
                          {uploadingWhich === 'peticion' ? 'Subiendo...' : editingPeticion?.documentoPeticionUrl ? 'Reemplazar' : 'Subir documento'}
                        </button>
                      </div>
                      <div className="rounded-lg border border-slate-200 p-2.5 space-y-1.5">
                        <p className="text-[11px] font-semibold text-slate-700">Documento de respuesta</p>
                        {editingPeticion?.documentoRespuestaUrl ? (
                          <a href={editingPeticion.documentoRespuestaUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[11px] text-teal-700 hover:underline truncate">
                            <FileText className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{editingPeticion.documentoRespuestaNombre}</span>
                          </a>
                        ) : (
                          <p className="text-[11px] italic text-slate-400">Sin documento cargado.</p>
                        )}
                        <input
                          ref={respuestaFileInputRef}
                          type="file"
                          className="hidden"
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadDocument('respuesta', f); e.target.value = ''; }}
                        />
                        <button
                          type="button"
                          onClick={() => respuestaFileInputRef.current?.click()}
                          disabled={uploadingWhich === 'respuesta'}
                          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 hover:text-teal-700 disabled:opacity-50"
                        >
                          <Upload className="h-3.5 w-3.5" />
                          {uploadingWhich === 'respuesta' ? 'Subiendo...' : editingPeticion?.documentoRespuestaUrl ? 'Reemplazar' : 'Subir documento'}
                        </button>
                      </div>
                    </div>
                  )}
                  {uploadError && <p className="text-xs text-rose-600">{uploadError}</p>}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100">
              <button type="button" onClick={() => setIsFormOpen(false)} className="px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700">
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-lg disabled:opacity-50"
              >
                {isSaving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
