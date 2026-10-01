import React, { useState } from 'react';
import { ReportType, Contact, ReportStatus, ReportTypeStep, AreaConsolida, Project } from '../../types';
import { STATUS_SEQUENCE, MONTHS_LIST, YEARS_LIST } from '../../data/mockData';
import { StatusBadge } from '../common/StatusBadge';
import {
  Database,
  Plus,
  Search,
  Check,
  Edit2,
  Trash2,
  FileText,
  Users,
  Calendar,
  Layers,
  X,
  Building2,
  Mail,
  Phone,
  Bell,
  GitBranch,
  Flag,
  ChevronUp,
  ChevronDown,
  Briefcase,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';

interface MasterListsViewProps {
  reportTypes: ReportType[];
  contacts: Contact[];
  reportTypeSteps: ReportTypeStep[];
  projects: Project[];
  onAddReportType: (type: ReportType) => Promise<void>;
  onAddContact: (contact: Contact) => Promise<void>;
  onAddReportTypeStep: (step: { typeId: string; projectId?: string | null; name: string; emailSubject: string; isFinal: boolean; contactIds: string[]; diaInicio?: number; diaLimite?: number; palabrasClave?: string }) => Promise<void>;
  onDeleteReportTypeStep: (stepId: string) => Promise<void>;
  onMoveReportTypeStep: (stepId: string, direction: 'up' | 'down') => Promise<void>;
  areasConsolida: AreaConsolida[];
  onAddAreaConsolida: (name: string) => Promise<void>;
  onDeleteAreaConsolida: (areaId: string) => Promise<void>;
}

export const MasterListsView: React.FC<MasterListsViewProps> = ({
  reportTypes,
  contacts,
  reportTypeSteps,
  projects,
  onAddReportType,
  onAddContact,
  onAddReportTypeStep,
  onDeleteReportTypeStep,
  onMoveReportTypeStep,
  areasConsolida,
  onAddAreaConsolida,
  onDeleteAreaConsolida,
}) => {
  const { canEdit } = useAuth();
  const canEditLists = canEdit('lists');

  const [stepsModalTypeId, setStepsModalTypeId] = useState<string | null>(null);
  const [stepsScopeProjectId, setStepsScopeProjectId] = useState<string | null>(null);
  const [newStepName, setNewStepName] = useState('');
  const [newStepSubject, setNewStepSubject] = useState('');
  const [newStepIsFinal, setNewStepIsFinal] = useState(false);
  const [newStepContactIds, setNewStepContactIds] = useState<string[]>([]);
  const [newStepDiaInicio, setNewStepDiaInicio] = useState('');
  const [newStepDiaLimite, setNewStepDiaLimite] = useState('');
  const [newStepKeywords, setNewStepKeywords] = useState('');
  const [stepError, setStepError] = useState('');
  const [isSavingStep, setIsSavingStep] = useState(false);
  const [activeTab, setActiveTab] = useState<'types' | 'contacts' | 'statuses' | 'periods' | 'areas'>('types');
  const [newAreaName, setNewAreaName] = useState('');
  const [areaError, setAreaError] = useState('');
  const [isSavingArea, setIsSavingArea] = useState(false);
  const [deletingAreaId, setDeletingAreaId] = useState<string | null>(null);

  const handleAddArea = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAreaName.trim()) return;
    setIsSavingArea(true);
    setAreaError('');
    try {
      await onAddAreaConsolida(newAreaName.trim());
      setNewAreaName('');
    } catch (error) {
      setAreaError(error instanceof Error ? error.message : 'No fue posible agregar el área.');
    } finally {
      setIsSavingArea(false);
    }
  };

  const handleDeleteArea = async (areaId: string) => {
    if (!window.confirm('¿Eliminar esta área? Las peticiones que ya la usan conservan el texto, solo deja de aparecer en el desplegable.')) return;
    setDeletingAreaId(areaId);
    try {
      await onDeleteAreaConsolida(areaId);
    } finally {
      setDeletingAreaId(null);
    }
  };
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  // New Type Form
  const [newTypeCode, setNewTypeCode] = useState('');
  const [newTypeName, setNewTypeName] = useState('');
  const [newTypePeriodicity, setNewTypePeriodicity] = useState<'Mensual' | 'Bimestral' | 'Trimestral' | 'Semestral' | 'Anual' | 'Único'>('Mensual');
  const [newTypeDesc, setNewTypeDesc] = useState('');

  // New Contact Form
  const [newContactName, setNewContactName] = useState('');
  const [newContactEmail, setNewContactEmail] = useState('');
  const [newContactRole, setNewContactRole] = useState('Residente Técnico');
  const [newContactCompany, setNewContactCompany] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [formError, setFormError] = useState('');

  const filteredTypes = reportTypes.filter(
    (t) =>
      t.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredContacts = contacts.filter(
    (c) =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.role.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.company.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSaveType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTypeCode.trim() || !newTypeName.trim()) return;

    const created: ReportType = {
      id: `rt-${Date.now()}`,
      code: newTypeCode.trim().toUpperCase(),
      name: newTypeName.trim(),
      periodicity: newTypePeriodicity,
      description: newTypeDesc.trim() || 'Tipo de informe añadido a listas maestras.',
      active: true,
    };
    try {
      setFormError('');
      await onAddReportType(created);
      setShowAddModal(false);
      setNewTypeCode('');
      setNewTypeName('');
      setNewTypeDesc('');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'No fue posible guardar el tipo de informe.');
    }
  };

  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContactName.trim() || !newContactEmail.trim()) return;

    const created: Contact = {
      id: `c-${Date.now()}`,
      name: newContactName.trim(),
      email: newContactEmail.trim(),
      role: newContactRole,
      company: newContactCompany.trim() || 'Consorcio / Entidad',
      phone: newContactPhone.trim() || '+57 300 000 0000',
      hasNotificationAlarm: true,
      active: true,
    };
    try {
      setFormError('');
      await onAddContact(created);
      setShowAddModal(false);
      setNewContactName('');
      setNewContactEmail('');
      setNewContactCompany('');
      setNewContactPhone('');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'No fue posible guardar el contacto.');
    }
  };

  const handleSaveStep = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stepsModalTypeId || !newStepName.trim() || !newStepSubject.trim() || newStepContactIds.length === 0) return;

    setIsSavingStep(true);
    setStepError('');
    try {
      await onAddReportTypeStep({
        typeId: stepsModalTypeId,
        projectId: stepsScopeProjectId,
        name: newStepName.trim(),
        emailSubject: newStepSubject.trim(),
        isFinal: newStepIsFinal,
        contactIds: newStepContactIds,
        diaInicio: stepsForModalType.length === 0 && newStepDiaInicio !== '' ? Number(newStepDiaInicio) : undefined,
        diaLimite: newStepDiaLimite === '' ? undefined : Number(newStepDiaLimite),
        palabrasClave: newStepKeywords.trim() || undefined,
      });
      setNewStepName('');
      setNewStepSubject('');
      setNewStepIsFinal(false);
      setNewStepContactIds([]);
      setNewStepDiaInicio('');
      setNewStepDiaLimite('');
      setNewStepKeywords('');
    } catch (error) {
      setStepError(error instanceof Error ? error.message : 'No fue posible guardar el paso.');
    } finally {
      setIsSavingStep(false);
    }
  };

  const stepsForModalType = reportTypeSteps
    .filter((s) => s.typeId === stepsModalTypeId && (s.projectId ?? null) === stepsScopeProjectId)
    .sort((a, b) => a.order - b.order);
  const typeForStepsModal = reportTypes.find((t) => t.id === stepsModalTypeId);
  const projectsForStepsModal = projects.filter(
    (p) => stepsModalTypeId && (p.applicableTypeIds.length === 0 || p.applicableTypeIds.includes(stepsModalTypeId)),
  );

  return (
    <div id="view-master-lists" className="space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            Catálogos y Listas Maestras
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Mantenimiento y administración de entidades base: tipos de informe, estados del ciclo, contactos y períodos.
          </p>
        </div>

        {(activeTab === 'types' || activeTab === 'contacts') && canEditLists && (
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-2xs transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>
              {activeTab === 'types' ? 'Nuevo Tipo de Informe' : 'Nuevo Contacto / Responsable'}
            </span>
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 text-xs overflow-x-auto">
        <button
          type="button"
          onClick={() => { setActiveTab('types'); setSearchTerm(''); }}
          className={`px-4 py-2.5 font-bold border-b-2 transition-colors inline-flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === 'types'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Tipos de Informe ({reportTypes.length})</span>
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('contacts'); setSearchTerm(''); }}
          className={`px-4 py-2.5 font-bold border-b-2 transition-colors inline-flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === 'contacts'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Contactos y Responsables ({contacts.length})</span>
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('statuses'); setSearchTerm(''); }}
          className={`px-4 py-2.5 font-bold border-b-2 transition-colors inline-flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === 'statuses'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Estados del Ciclo (4)</span>
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('periods'); setSearchTerm(''); }}
          className={`px-4 py-2.5 font-bold border-b-2 transition-colors inline-flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === 'periods'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>Períodos & Vigencias</span>
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('areas'); setSearchTerm(''); }}
          className={`px-4 py-2.5 font-bold border-b-2 transition-colors inline-flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === 'areas'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <Briefcase className="w-4 h-4" />
          <span>Áreas Consolida ({areasConsolida.length})</span>
        </button>
      </div>

      {/* Tab: Áreas que Consolidan (Peticiones) */}
      {activeTab === 'areas' && (
        <div className="space-y-3">
          <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs">
            <p className="text-xs text-slate-500 mb-2">Lista desplegable de "Área Consolida" al crear una Petición.</p>
            {canEditLists && (
              <form onSubmit={handleAddArea} className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Nueva área</label>
                  <input
                    type="text"
                    value={newAreaName}
                    onChange={(e) => setNewAreaName(e.target.value)}
                    placeholder="Ej: Comunicaciones"
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-indigo-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSavingArea || !newAreaName.trim()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {isSavingArea ? 'Agregando...' : 'Agregar'}
                </button>
              </form>
            )}
            {areaError && <p className="mt-2 text-xs font-medium text-rose-700">{areaError}</p>}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-xs divide-y divide-slate-100">
            {areasConsolida.length === 0 ? (
              <div className="flex min-h-24 flex-col items-center justify-center px-6 text-center">
                <Briefcase className="mb-2 h-5 w-5 text-slate-300" />
                <p className="text-sm font-semibold text-slate-700">Sin áreas configuradas todavía</p>
              </div>
            ) : (
              areasConsolida.map((a) => (
                <div key={a.id} className="flex items-center justify-between px-4 py-3 text-xs">
                  <span className="font-semibold text-slate-800">{a.name}</span>
                  {canEditLists && (
                    <button
                      type="button"
                      onClick={() => handleDeleteArea(a.id)}
                      disabled={deletingAreaId === a.id}
                      className="text-slate-400 hover:text-rose-600 disabled:opacity-50"
                      title="Eliminar área"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Tab: Tipos de Informe */}
      {activeTab === 'types' && (
        <div className="space-y-3">
          <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs flex items-center justify-between">
            <div className="relative w-full max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por código o nombre..."
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-indigo-500"
              />
            </div>
            <span className="text-xs text-slate-400">
              {filteredTypes.length} tipos activos
            </span>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-2.5 px-4">Código</th>
                  <th className="py-2.5 px-4">Nombre del Informe</th>
                  <th className="py-2.5 px-4">Periodicidad</th>
                  <th className="py-2.5 px-4">Descripción del Alcance</th>
                  <th className="py-2.5 px-4">Estado</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Flujo de entrega (asunto de correo)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTypes.map((type) => {
                  const typeSteps = reportTypeSteps.filter((s) => s.typeId === type.id);
                  return (
                    <tr key={type.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-indigo-700">
                        {type.code}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {type.name}
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        <span className="px-2 py-0.5 rounded bg-slate-100 font-medium text-[11px]">
                          {type.periodicity}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-600 max-w-xs truncate" title={type.description}>
                        {type.description}
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          Activo
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => {
                            setStepsModalTypeId(type.id);
                            setStepsScopeProjectId(null);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100"
                        >
                          <GitBranch className="h-3.5 w-3.5" />
                          {typeSteps.length > 0 ? `${typeSteps.length} paso(s)` : 'Configurar pasos'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Contactos y Responsables */}
      {activeTab === 'contacts' && (
        <div className="space-y-3">
          <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs flex items-center justify-between">
            <div className="relative w-full max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por nombre, cargo o correo..."
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-indigo-500"
              />
            </div>
            <span className="text-xs text-slate-400">
              {filteredContacts.length} contactos
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredContacts.map((contact) => (
              <div
                key={contact.id}
                className="p-4 bg-white border border-slate-200 rounded-xl shadow-xs text-xs space-y-2 hover:border-indigo-300 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="font-bold text-slate-900">{contact.name}</div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                      contact.hasNotificationAlarm
                        ? 'bg-emerald-50 text-emerald-800'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {contact.hasNotificationAlarm ? 'Alarmas Activas' : 'Silenciado'}
                  </span>
                </div>
                <div className="text-indigo-700 font-medium">{contact.role}</div>
                <div className="flex items-center gap-1.5 text-slate-600 text-[11px]">
                  <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="truncate">{contact.company}</span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-500 text-[11px]">
                  <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="truncate">{contact.email}</span>
                </div>
                {contact.phone && (
                  <div className="flex items-center gap-1.5 text-slate-500 text-[11px]">
                    <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>{contact.phone}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab: Estados del Ciclo */}
      {activeTab === 'statuses' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Ciclo de Vida Estandarizado de Informes (Sección 10)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Secuencia obligatoria de progresión y transición de estados para los informes contractuales.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
            {STATUS_SEQUENCE.map((statusName, idx) => (
              <div
                key={statusName}
                className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">
                    Etapa {idx + 1}
                  </span>
                  <StatusBadge status={statusName} size="sm" />
                </div>
                <h4 className="font-bold text-slate-900 text-sm">{statusName}</h4>
                <p className="text-slate-600 text-[11px] leading-relaxed">
                  {statusName === 'Pendientes Evidencias' &&
                    'Apertura del período. Recolección de ensayos, certificados y soportes de campo.'}
                  {statusName === 'Informe en Elaboración' &&
                    'Redacción del documento técnico o financiero y compilación de anexos.'}
                  {statusName === 'Entregado a Of. Proyectos' &&
                    'Radicado formal ante la oficina de supervisión para revisión y aprobación.'}
                  {statusName === 'Enviado' &&
                    'Aprobación final y remisión al cliente, fiduciaria o ente supervisor.'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab: Períodos */}
      {activeTab === 'periods' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Períodos y Vigencias Operativas</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Meses y años configurados para cortes contables y técnicos de informes.
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <span className="text-xs font-bold text-slate-700 block mb-2">
                Meses del Cronograma:
              </span>
              <div className="flex flex-wrap gap-2">
                {MONTHS_LIST.map((m) => (
                  <span
                    key={m}
                    className="px-3 py-1 bg-slate-100 border border-slate-200 rounded-lg text-xs font-medium text-slate-700"
                  >
                    {m}
                  </span>
                ))}
              </div>
            </div>

            <div className="pt-2">
              <span className="text-xs font-bold text-slate-700 block mb-2">
                Vigencias Anuales Habilitadas:
              </span>
              <div className="flex flex-wrap gap-2">
                {YEARS_LIST.map((y) => (
                  <span
                    key={y}
                    className="px-4 py-1.5 bg-indigo-50 border border-indigo-200 rounded-lg text-xs font-bold text-indigo-800 font-mono"
                  >
                    {y}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-2xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 p-5 max-w-md w-full space-y-4 animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="font-bold text-sm text-slate-900">
                {activeTab === 'types' ? 'Nuevo Tipo de Informe' : 'Nuevo Contacto / Responsable'}
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700" role="alert">
                {formError}
              </div>
            )}

            {activeTab === 'types' ? (
              <form onSubmit={handleSaveType} className="space-y-3 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Código de Referencia
                  </label>
                  <input
                    type="text"
                    required
                    value={newTypeCode}
                    onChange={(e) => setNewTypeCode(e.target.value)}
                    placeholder="Ej: INF-SEG, INF-CAL"
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500 font-mono uppercase"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Nombre del Tipo de Informe
                  </label>
                  <input
                    type="text"
                    required
                    value={newTypeName}
                    onChange={(e) => setNewTypeName(e.target.value)}
                    placeholder="Ej: Informe de Aseguramiento de Calidad"
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Periodicidad
                  </label>
                  <select
                    value={newTypePeriodicity}
                    onChange={(e) => setNewTypePeriodicity(e.target.value as any)}
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500"
                  >
                    <option value="Mensual">Mensual</option>
                    <option value="Bimestral">Bimestral</option>
                    <option value="Trimestral">Trimestral</option>
                    <option value="Semestral">Semestral</option>
                    <option value="Anual">Anual</option>
                    <option value="Único">Único</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Descripción del Alcance
                  </label>
                  <textarea
                    rows={2}
                    value={newTypeDesc}
                    onChange={(e) => setNewTypeDesc(e.target.value)}
                    placeholder="Detalles sobre lo que contiene este tipo de informe..."
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs"
                  >
                    Guardar Tipo
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleSaveContact} className="space-y-3 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Nombre completo
                  </label>
                  <input
                    type="text"
                    required
                    value={newContactName}
                    onChange={(e) => setNewContactName(e.target.value)}
                    placeholder="Ej: Ing. Laura Morales"
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Correo electrónico
                  </label>
                  <input
                    type="email"
                    required
                    value={newContactEmail}
                    onChange={(e) => setNewContactEmail(e.target.value)}
                    placeholder="lmorales@consorcio.co"
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Rol / Cargo
                    </label>
                    <input
                      type="text"
                      value={newContactRole}
                      onChange={(e) => setNewContactRole(e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Empresa
                    </label>
                    <input
                      type="text"
                      value={newContactCompany}
                      onChange={(e) => setNewContactCompany(e.target.value)}
                      placeholder="Empresa o entidad"
                      className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Teléfono celular
                  </label>
                  <input
                    type="text"
                    value={newContactPhone}
                    onChange={(e) => setNewContactPhone(e.target.value)}
                    placeholder="+57 310 000 0000"
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs"
                  >
                    Guardar Contacto
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Steps Modal */}
      {stepsModalTypeId && typeForStepsModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-2xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-xl w-full max-h-[92vh] flex flex-col animate-in zoom-in-95">
            {/* Header (fijo) */}
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 shrink-0">
              <div className="min-w-0">
                <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-indigo-600 shrink-0" />
                  <span className="truncate">Flujo de entrega: {typeForStepsModal.name}</span>
                </h3>
                <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">
                  Al crear un informe se avisa al paso 1; al confirmar cada entrega se avanza al siguiente hasta el paso final.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStepsModalTypeId(null)}
                className="text-slate-400 hover:text-slate-600 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Cuerpo (scrollable) */}
            <div className="overflow-y-auto px-5 py-4 space-y-4 text-xs">
              {typeForStepsModal.periodicity === 'Mensual' && (
                <div className="rounded-lg bg-indigo-50 border border-indigo-100 px-3 py-2.5 text-[11px] text-indigo-800 leading-relaxed">
                  <b>Mensual:</b> cada proyecto genera un informe nuevo cada mes (repite este flujo desde el paso 1) hasta que termine el proyecto. El asunto de cada paso aplica a todos esos informes — el sistema le agrega el número de secuencia (01, 02...) al final.
                </div>
              )}

              {/* Selector de alcance: plantilla general o proyecto específico */}
              <div className="rounded-lg border border-slate-200 p-3 space-y-1.5">
                <label className="block text-[10.5px] font-semibold text-slate-500">Aplicar a</label>
                <select
                  value={stepsScopeProjectId ?? ''}
                  onChange={(e) => setStepsScopeProjectId(e.target.value || null)}
                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500 bg-white"
                >
                  <option value="">Plantilla general (todos los proyectos)</option>
                  {projectsForStepsModal.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <p className="text-[10.5px] text-slate-400 leading-relaxed">
                  {stepsScopeProjectId
                    ? 'Este proyecto usa su propio flujo (distinto de la plantilla general) para este tipo de informe.'
                    : 'Flujo por defecto para todos los proyectos de este tipo, salvo que un proyecto tenga su propio flujo configurado.'}
                </p>
              </div>

              {/* Lista de pasos existentes */}
              <div>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  Pasos configurados {stepsForModalType.length > 0 && `(${stepsForModalType.length})`}
                </p>
                {stepsForModalType.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-slate-400">
                    Este tipo de informe todavía no tiene pasos configurados.
                  </p>
                ) : (
                  <ol className="space-y-1.5">
                    {stepsForModalType.map((step, idx) => (
                      <li key={step.id} className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 p-2.5">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 font-bold text-slate-900">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[10px] text-indigo-700">{idx + 1}</span>
                            <span className="truncate">{step.name}</span>
                            {step.isFinal && (
                              <span className="inline-flex shrink-0 items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                                <Flag className="h-3 w-3" /> Final
                              </span>
                            )}
                          </div>
                          <p className="mt-1 truncate text-[11px] text-slate-500">Asunto: "{step.emailSubject}"</p>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                            {(step.diaInicio || step.diaLimite) && (
                              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                                {step.diaInicio ? `Inicia día ${step.diaInicio}` : 'Inicia con la entrega anterior'}
                                {step.diaLimite ? ` · Límite día ${step.diaLimite}` : ''}
                              </span>
                            )}
                            <span className="text-[11px] text-slate-500 truncate">
                              {step.contactIds.map((id) => contacts.find((c) => c.id === id)?.name).filter(Boolean).join(', ') || 'Sin contactos'}
                            </span>
                          </div>
                        </div>
                        {canEditLists && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => onMoveReportTypeStep(step.id, 'up')}
                              disabled={idx === 0}
                              className="text-slate-400 hover:text-indigo-600 disabled:opacity-30 disabled:hover:text-slate-400"
                              title="Mover arriba"
                            >
                              <ChevronUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onMoveReportTypeStep(step.id, 'down')}
                              disabled={idx === stepsForModalType.length - 1}
                              className="text-slate-400 hover:text-indigo-600 disabled:opacity-30 disabled:hover:text-slate-400"
                              title="Mover abajo"
                            >
                              <ChevronDown className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteReportTypeStep(step.id)}
                              className="text-slate-400 hover:text-rose-600"
                              title="Eliminar paso"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              {stepError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700" role="alert">
                  {stepError}
                </div>
              )}

              {/* Formulario: agregar paso nuevo */}
              {canEditLists && (
                <form onSubmit={handleSaveStep} className="space-y-3 border-t border-slate-100 pt-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    Agregar paso {stepsForModalType.length + 1}
                  </p>

                  {/* Sección: identificación */}
                  <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                    <div>
                      <label className="block text-[10.5px] font-semibold text-slate-500 mb-1">Nombre del paso</label>
                      <input
                        type="text"
                        required
                        value={newStepName}
                        onChange={(e) => setNewStepName(e.target.value)}
                        placeholder="Ej: Entrega de interventoría"
                        className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10.5px] font-semibold text-slate-500 mb-1">Asunto de correo que confirma la entrega</label>
                      <input
                        type="text"
                        required
                        value={newStepSubject}
                        onChange={(e) => setNewStepSubject(e.target.value)}
                        placeholder='Ej: "Entrega mensual interventoría"'
                        className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500"
                      />
                      <p className="mt-1 text-[10.5px] text-slate-400">Asunto base sin número — se reutiliza cada mes; el sistema agrega el número de secuencia solo.</p>
                    </div>
                    <div>
                      <label className="block text-[10.5px] font-semibold text-slate-500 mb-1">Palabras clave adicionales (opcional)</label>
                      <input
                        type="text"
                        value={newStepKeywords}
                        onChange={(e) => setNewStepKeywords(e.target.value)}
                        placeholder="Separadas por coma"
                        className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500"
                      />
                      <p className="mt-1 text-[10.5px] text-slate-400">Se suman al asunto al buscar en Gmail, para no depender solo de que sea exacto.</p>
                    </div>
                  </div>

                  {/* Sección: programación */}
                  <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                    <p className="text-[10.5px] font-semibold text-slate-500">Programación</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10.5px] font-semibold text-slate-500 mb-1">Día de inicio del mes</label>
                        {stepsForModalType.length === 0 ? (
                          <input
                            type="number"
                            min={1}
                            max={31}
                            value={newStepDiaInicio}
                            onChange={(e) => setNewStepDiaInicio(e.target.value)}
                            placeholder="Ej: 3"
                            className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500"
                          />
                        ) : (
                          <div className="w-full px-2.5 py-1.5 border border-dashed border-slate-200 rounded-lg text-[10.5px] text-slate-400 bg-slate-50">
                            No aplica
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="block text-[10.5px] font-semibold text-slate-500 mb-1">Día límite del mes</label>
                        <input
                          type="number"
                          min={1}
                          max={31}
                          value={newStepDiaLimite}
                          onChange={(e) => setNewStepDiaLimite(e.target.value)}
                          placeholder="Ej: 6"
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>
                    <p className="text-[10.5px] text-slate-400 leading-relaxed">
                      {stepsForModalType.length === 0 ? (
                        'Es el primer paso: "Día de inicio" es el día fijo del mes en que arranca (ej. 3 = el 3 de cada mes).'
                      ) : (
                        `Arranca solo, el mismo día en que se confirme la entrega de "${stepsForModalType[stepsForModalType.length - 1].name}" — por eso el día de inicio no aplica aquí.`
                      )}
                    </p>
                  </div>

                  {/* Sección: responsables */}
                  <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                    <label className="block text-[10.5px] font-semibold text-slate-500">Responsables de este paso</label>
                    <div className="max-h-28 overflow-y-auto rounded-lg border border-slate-200 p-2 space-y-1.5">
                      {contacts.map((c) => {
                        const checked = newStepContactIds.includes(c.id);
                        return (
                          <label key={c.id} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setNewStepContactIds((prev) => (checked ? prev.filter((id) => id !== c.id) : [...prev, c.id]));
                              }}
                              className="rounded text-indigo-600"
                            />
                            <span className="text-slate-800">{c.name} ({c.role})</span>
                          </label>
                        );
                      })}
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer text-slate-700 pt-1">
                      <input
                        type="checkbox"
                        checked={newStepIsFinal}
                        onChange={(e) => setNewStepIsFinal(e.target.checked)}
                        className="rounded text-indigo-600"
                      />
                      Este es el paso final (al entregarlo, se cierra el informe)
                    </label>
                  </div>

                  <div className="flex items-center justify-end pt-1">
                    <button
                      type="submit"
                      disabled={isSavingStep || newStepContactIds.length === 0}
                      className="px-4 py-1.5 font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isSavingStep ? 'Guardando...' : 'Agregar paso'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
