import React, { useEffect, useState } from 'react';
import { ArrowUpRight, Cloud, ExternalLink, FolderInput, Save } from 'lucide-react';
import { DriveLinks } from '../../types';

export const DriveLinksView: React.FC = () => {
  const [links, setLinks] = useState<DriveLinks>({ sourceUrl: '', destinationUrl: '' });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const loadLinks = async () => {
      try {
        const response = await fetch('/api/drive-links');
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.errors?.[0] || 'No fue posible cargar los enlaces.');
        setLinks(payload.data || { sourceUrl: '', destinationUrl: '' });
      } catch (error) {
        setMessage({ type: 'error', text: error instanceof Error ? error.message : 'No fue posible cargar los enlaces.' });
      } finally {
        setIsLoading(false);
      }
    };
    void loadLinks();
  }, []);

  const saveLinks = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/drive-links', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(links),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.errors?.[0] || 'No fue posible guardar los enlaces.');
      setLinks(payload.data);
      setMessage({ type: 'success', text: 'Enlaces guardados en Neon.' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'No fue posible guardar los enlaces.' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <section className="rounded-[10px] border border-slate-200 bg-white p-6 shadow-[0_12px_30px_rgba(20,32,43,0.06)]">
        <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-teal-700">Automatización documental</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Fuentes de Google Drive</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Define la carpeta compartida de origen y tu carpeta de destino. Apps Script y Colab usarán estos enlaces para automatizar el traslado de archivos.</p>
          </div>
          <span className="rounded-full bg-teal-50 px-3 py-1 text-[11px] font-bold text-teal-800">Configuración centralizada</span>
        </div>

        {isLoading ? <div className="py-10 text-center text-sm text-slate-500">Cargando configuración...</div> : <form onSubmit={saveLinks} className="space-y-5 pt-5">
          <label className="block">
            <span className="flex items-center gap-2 text-xs font-bold text-slate-800"><FolderInput className="h-4 w-4 text-teal-700" /> Link origen</span>
            <span className="mt-1 block text-[11px] text-slate-500">Carpeta de Drive que te comparten y de la que se leerán archivos.</span>
            <input required type="url" value={links.sourceUrl} onChange={(event) => setLinks((current) => ({ ...current, sourceUrl: event.target.value }))} placeholder="https://drive.google.com/drive/folders/..." className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-teal-600 focus:bg-white" />
          </label>
          <label className="block">
            <span className="flex items-center gap-2 text-xs font-bold text-slate-800"><Cloud className="h-4 w-4 text-teal-700" /> Link destino</span>
            <span className="mt-1 block text-[11px] text-slate-500">Tu carpeta de Drive donde se copiarán o procesarán los documentos.</span>
            <input required type="url" value={links.destinationUrl} onChange={(event) => setLinks((current) => ({ ...current, destinationUrl: event.target.value }))} placeholder="https://drive.google.com/drive/folders/..." className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-teal-600 focus:bg-white" />
          </label>
          {message && <div role="status" className={`rounded-lg border px-3 py-2 text-xs font-semibold ${message.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>{message.text}</div>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <p className="max-w-md text-[11px] leading-5 text-slate-500">Solo se almacenan las URLs. Las credenciales y permisos permanecen en Google Apps Script/Colab.</p>
            <button type="submit" disabled={isSaving} className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"><Save className="h-3.5 w-3.5" />{isSaving ? 'Guardando...' : 'Guardar enlaces'}</button>
          </div>
        </form>}
      </section>

      <section className="rounded-[10px] border border-slate-200 bg-[#eef7f5] p-5">
        <div className="flex items-start gap-3"><ExternalLink className="mt-0.5 h-5 w-5 text-teal-700" /><div><h3 className="text-sm font-bold text-slate-950">Flujo preparado</h3><p className="mt-1 text-xs leading-5 text-slate-600">Apps Script puede leer esta configuración desde <code className="font-mono text-teal-800">GET /api/drive-links</code>. Colab puede invocar el endpoint protegido de automatización cuando necesites ejecutar un proceso manual.</p><a href="https://drive.google.com" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-teal-700 hover:text-teal-900">Abrir Drive <ArrowUpRight className="h-3.5 w-3.5" /></a></div></div>
      </section>
    </div>
  );
};