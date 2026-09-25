import React, { useEffect, useMemo, useState } from 'react';
import { Inbox, Plus, Pencil, Trash2, X, Search, BellRing } from 'lucide-react';
import { Contact, Peticion, SemaforoStatus } from '../../types';
import { SemaforoBadge } from '../common/SemaforoBadge';
import { useAuth } from '../../auth/AuthContext';

type PeticionFormState = {
  radicado: string;
  fechaRadicacion: string;
  peticionario: string;
  asunto: string;
  areaConsolida: string;
  correoPersonaAsignada: string;
  areasIntervienen: string;
  plazoRespuesta: string;
  fechaRadicadoRespuesta: string;
  responsableIds: string[];
};

const EMPTY_FORM: PeticionFormState = {
  radicado: '',
  fechaRadicacion: '',
  peticionario: '',
  asunto: '',
  areaConsolida: '',
  correoPersonaAsignada: '',
  areasIntervienen: '',
  plazoRespuesta: '',
  fechaRadicadoRespuesta: '',
  responsableIds: [],
};

function formToPayload(form: PeticionFormState) {
  return {
    radicado: form.radicado.trim(),
    fechaRadicacion: form.fechaRadicacion || null,
    peticionario: form.peticionario.trim(),
    asunto: form.asunto.trim(),
    areaConsolida: form.areaConsolida.trim(),
    correoPersonaAsignada: form.correoPersonaAsignada.trim(),
    areasIntervienen: form.areasIntervienen.trim(),
    plazoRespuesta: form.plazoRespuesta === '' ? null : Number(form.plazoRespuesta),
    fechaRadicadoRespuesta: form.fechaRadicadoRespuesta || null,
  };
}

function peticionToForm(p: Peticion): PeticionFormState {
  return {
    radicado: p.radicado,
    fechaRadicacion: p.fechaRadicacion ?? '',
    peticionario: p.peticionario,
    asunto: p.asunto,
    areaConsolida: p.areaConsolida,
    correoPersonaAsignada: p.correoPersonaAsignada,
    areasIntervienen: p.areasIntervienen,
    plazoRespuesta: p.plazoRespuesta === null ? '' : String(p.plazoRespuesta),
    fechaRadicadoRespuesta: p.fechaRadicadoRespuesta ?? '',
    responsableIds: p.responsables.map((r) => r.id),
  };
}

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

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const FIELD_LABEL: Record<string, string> = {
  radicado: 'Radicado',
  fechaRadicacion: 'Fecha Radicación',
  peticionario: 'Peticionario',
  asunto: 'Asunto',
  areaConsolida: 'Área Consolida',
  correoPersonaAsignada: 'Correo adicional (opcional)',
  areasIntervienen: 'Áreas Intervienen',
  plazoRespuesta: 'Plazo Respuesta (días)',
  fechaRadicadoRespuesta: 'Fecha Radicado Respuesta',
};

const PeticionForm: React.FC<{
  form: PeticionFormState;
  onChange: (form: PeticionFormState) => void;
  contacts: Contact[];
}> = ({ form, onChange, contacts }) => {
  const set = (key: keyof PeticionFormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...form, [key]: e.target.value });

  const toggleResponsable = (contactId: string) => {
    const next = form.responsableIds.includes(contactId)
      ? form.responsableIds.filter((id) => id !== contactId)
      : [...form.responsableIds, contactId];
    onChange({ ...form, responsableIds: next });
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <label className="block text-[11px] font-semibold text-slate-700 mb-1">{FIELD_LABEL.radicado} *</label>
        <input value={form.radicado} onChange={set('radicado')} className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-teal-600" />
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
        <input value={form.areaConsolida} onChange={set('areaConsolida')} className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-teal-600" />
      </div>
      <div className="sm:col-span-2">
        <label className="block text-[11px] font-semibold text-slate-700 mb-1">{FIELD_LABEL.areasIntervienen}</label>
        <input value={form.areasIntervienen} onChange={set('areasIntervienen')} className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-teal-600" />
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
        <p className="mt-1 text-[10.5px] text-slate-400">Solo para alguien que no está en Contactos.</p>
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
    </div>
  );
};

export const PeticionesView: React.FC<{ contacts: Contact[] }> = ({ contacts }) => {
  const { canEdit } = useAuth();
  const editable = canEdit('peticiones');

  const [peticiones, setPeticiones] = useState<Peticion[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PeticionFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reminderState, setReminderState] = useState<Record<string, 'sending' | 'sent' | 'error'>>({});

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
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setIsFormOpen(true);
  };

  const openEdit = (p: Peticion) => {
    setEditingId(p.id);
    setForm(peticionToForm(p));
    setFormError('');
    setIsFormOpen(true);
  };

  const handleSave = async () => {
    if (!form.radicado.trim() || !form.asunto.trim()) {
      setFormError('El radicado y el asunto son obligatorios.');
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
            ? { kind: 'peticion', id: Number(editingId), data: payload, responsableIds: form.responsableIds }
            : { kind: 'peticion', data: payload, responsableIds: form.responsableIds },
        ),
      });
      const responsePayload = await res.json();
      if (!res.ok) throw new Error(responsePayload.errors?.[0] || 'No fue posible guardar la petición.');
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
                  <th className="px-3 py-3">Área Consolida</th>
                  <th className="px-3 py-3">Responsables</th>
                  <th className="px-3 py-3">Plazo</th>
                  <th className="px-3 py-3">Fecha Plazo Respuesta</th>
                  <th className="px-3 py-3">Fecha Radicado Respuesta</th>
                  <th className="px-3 py-3">Alerta Vencimiento</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filtered.map((p) => {
                  const alert = computeAlertStatus(p);
                  const responsablesText = p.responsables.map((r) => r.name).join(', ') || p.correoPersonaAsignada || '—';
                  const reminder = reminderState[p.id];
                  return (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-bold text-slate-900 whitespace-nowrap">{p.radicado}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-slate-600">{fmtDate(p.fechaRadicacion)}</td>
                      <td className="px-3 py-3 max-w-40 truncate text-slate-700" title={p.peticionario}>{p.peticionario || '—'}</td>
                      <td className="px-3 py-3 max-w-56 truncate text-slate-700" title={p.asunto}>{p.asunto}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-slate-600">{p.areaConsolida || '—'}</td>
                      <td className="px-3 py-3 max-w-44 truncate text-slate-600" title={responsablesText}>{responsablesText}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-slate-600">{p.plazoRespuesta ?? '—'} d</td>
                      <td className="px-3 py-3 whitespace-nowrap text-slate-600">{fmtDate(p.fechaPlazoRespuesta)}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-slate-600">{fmtDate(p.fechaRadicadoRespuesta)}</td>
                      <td className="px-3 py-3">
                        <SemaforoBadge status={alert.status} daysRemaining={alert.daysRemaining} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
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
              <h3 className="text-sm font-bold text-slate-900">{editingId ? 'Editar petición' : 'Nueva petición'}</h3>
              <button type="button" onClick={() => setIsFormOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <PeticionForm form={form} onChange={setForm} contacts={contacts} />
              {formError && <p className="text-xs text-rose-600">{formError}</p>}
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
