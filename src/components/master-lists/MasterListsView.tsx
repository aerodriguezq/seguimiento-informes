import React, { useState } from 'react';
import { ReportType, Contact, ReportStatus } from '../../types';
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
} from 'lucide-react';

interface MasterListsViewProps {
  reportTypes: ReportType[];
  contacts: Contact[];
  onAddReportType: (type: ReportType) => Promise<void>;
  onAddContact: (contact: Contact) => Promise<void>;
}

export const MasterListsView: React.FC<MasterListsViewProps> = ({
  reportTypes,
  contacts,
  onAddReportType,
  onAddContact,
}) => {
  const [activeTab, setActiveTab] = useState<'types' | 'contacts' | 'statuses' | 'periods'>('types');
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

        {(activeTab === 'types' || activeTab === 'contacts') && (
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
      </div>

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

          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-2.5 px-4">Código</th>
                  <th className="py-2.5 px-4">Nombre del Informe</th>
                  <th className="py-2.5 px-4">Periodicidad</th>
                  <th className="py-2.5 px-4">Descripción del Alcance</th>
                  <th className="py-2.5 px-4">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTypes.map((type) => (
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
                    <td className="py-3 px-4 text-slate-600 max-w-md">
                      {type.description}
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        Activo
                      </span>
                    </td>
                  </tr>
                ))}
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
    </div>
  );
};
