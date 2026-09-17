import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Cloud, Copy, ExternalLink, FolderInput, LogIn, LogOut, Save, Square } from 'lucide-react';
import { DriveLinks } from '../../types';

export const DriveLinksView: React.FC = () => {
  const [links, setLinks] = useState<DriveLinks>({ sourceUrl: '', destinationUrl: '' });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [copyProgress, setCopyProgress] = useState({ percent: 0, processed: 0, total: 0, phase: '' });
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [driveSession, setDriveSession] = useState<{ connected: boolean; email: string | null }>({ connected: false, email: null });
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeJobIdRef = useRef<string | null>(null);
  const pollingRef = useRef(false);

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
    const loadSession = async () => {
      try {
        const response = await fetch('/api/auth/google/status');
        const payload = await response.json();
        if (response.ok && payload.data) setDriveSession(payload.data);
      } catch {
        // La conexión se puede reintentar desde el botón.
      }
    };
    void loadSession();
  }, []);

  const connectGoogle = () => { window.location.href = '/api/auth/google'; };
  const disconnectGoogle = async () => {
    await fetch('/api/auth/google/logout', { method: 'POST' });
    setDriveSession({ connected: false, email: null });
  };

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

  const copyFolder = async () => {
    setIsCopying(true);
    setCopyProgress({ percent: 3, processed: 0, total: 0, phase: 'Iniciando copia...' });
    setMessage(null);
    if (driveSession.connected) {
      const controller = new AbortController();
      abortControllerRef.current = controller;
      try {
        const response = await fetch('/api/drive-copy-direct', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(links),
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.errors?.[0] || 'No fue posible copiar desde Google Drive.');
        const result = payload.data;
        setCopyProgress({ percent: 100, processed: result.copiedFiles + result.skippedFiles, total: result.copiedFiles + result.skippedFiles, phase: 'Copia completada' });
        setMessage({ type: 'success', text: `Copia completada: ${result.copiedFiles} archivos, ${result.createdFolders} carpetas nuevas y ${result.skippedFiles} omitidos.` });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          setMessage({ type: 'error', text: 'Copiado detenido por el usuario.' });
        } else {
          setMessage({ type: 'error', text: error instanceof Error ? error.message : 'No fue posible copiar desde Google Drive.' });
        }
      } finally {
        abortControllerRef.current = null;
        setIsCopying(false);
      }
      return;
    }

    const jobId = crypto.randomUUID();
    activeJobIdRef.current = jobId;
    pollingRef.current = true;
    const pollProgress = async () => {
      while (pollingRef.current) {
        try {
          const progressResponse = await fetch(`/api/drive-progress?jobId=${encodeURIComponent(jobId)}`);
          const progressPayload = await progressResponse.json();
          if (progressResponse.ok && progressPayload.data) setCopyProgress(progressPayload.data);
        } catch {
          // La petición principal conserva el resultado final si un sondeo falla.
        }
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    };
    void pollProgress();
    try {
      const response = await fetch('/api/drive-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.errors?.[0] || 'No fue posible iniciar la copia.');
      const startedJobId = payload.data.jobId || jobId;
      activeJobIdRef.current = startedJobId;
      let completed = false;
      while (!completed && pollingRef.current) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const progressResponse = await fetch(`/api/drive-progress?jobId=${encodeURIComponent(startedJobId)}`);
        const progressPayload = await progressResponse.json();
        if (!progressResponse.ok) throw new Error(progressPayload.errors?.[0] || 'No fue posible consultar el progreso.');
        const result = progressPayload.data;
        setCopyProgress(result);
        completed = result.done === true;
        if (completed) {
          setMessage(
            result.cancelled
              ? { type: 'error', text: 'Copiado detenido por el usuario.' }
              : {
                  type: 'success',
                  text: `Copia completada: ${result.copiedFiles} archivos, ${result.createdFolders} carpetas nuevas y ${result.skippedFiles} archivos omitidos.`,
                }
          );
        }
      }
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'No fue posible iniciar la copia.' });
    } finally {
      pollingRef.current = false;
      activeJobIdRef.current = null;
      setIsCopying(false);
    }
  };

  const stopCopy = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      return;
    }
    const jobId = activeJobIdRef.current;
    pollingRef.current = false;
    if (jobId) {
      try {
        await fetch('/api/drive-copy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'cancel', jobId }),
        });
      } catch {
        // El sondeo ya se detuvo localmente aunque falle la petición de cancelación.
      }
    }
    activeJobIdRef.current = null;
    setIsCopying(false);
    setMessage({ type: 'error', text: 'Copiado detenido por el usuario.' });
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
          <div className="flex flex-wrap items-center gap-2">
            {driveSession.connected ? <><span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-bold text-emerald-800">Drive conectado: {driveSession.email}</span><button type="button" onClick={disconnectGoogle} className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-slate-900"><LogOut className="h-3.5 w-3.5" /> Desconectar</button></> : <button type="button" onClick={connectGoogle} className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-3 py-2 text-[11px] font-bold text-white hover:bg-teal-800"><LogIn className="h-3.5 w-3.5" /> Conectar Google Drive</button>}
          </div>
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
            <div className="flex flex-wrap justify-end gap-2">
              <button type="submit" disabled={isSaving || isCopying} className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"><Save className="h-3.5 w-3.5" />{isSaving ? 'Guardando...' : 'Guardar enlaces'}</button>
              {isCopying ? (
                <button type="button" onClick={stopCopy} className="inline-flex items-center gap-2 rounded-lg border border-rose-600 bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-700 transition hover:bg-rose-100"><Square className="h-3.5 w-3.5" /> Detener copiado</button>
              ) : (
                <button type="button" onClick={copyFolder} disabled={isSaving || !links.sourceUrl || !links.destinationUrl || !driveSession.connected} className="inline-flex items-center gap-2 rounded-lg border border-teal-700 px-4 py-2.5 text-xs font-bold text-teal-800 transition hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50"><Copy className="h-3.5 w-3.5" /> Copiar carpeta completa</button>
              )}
            </div>
          </div>
          {isCopying && <div className="mt-4 rounded-lg border border-teal-100 bg-teal-50 p-3" role="status"><div className="flex items-center justify-between text-[11px] font-bold text-teal-900"><span>{copyProgress.phase}</span><span>{copyProgress.percent}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-teal-600 transition-all duration-500" style={{ width: `${Math.max(copyProgress.percent, 3)}%` }} /></div><p className="mt-2 text-[11px] text-teal-800">{copyProgress.processed} de {copyProgress.total || '...'} elementos procesados</p></div>}
        </form>}
      </section>

      <section className="rounded-[10px] border border-slate-200 bg-[#eef7f5] p-5">
        <div className="flex items-start gap-3"><ExternalLink className="mt-0.5 h-5 w-5 text-teal-700" /><div><h3 className="text-sm font-bold text-slate-950">Flujo preparado</h3><p className="mt-1 text-xs leading-5 text-slate-600">Apps Script puede leer esta configuración desde <code className="font-mono text-teal-800">GET /api/drive-links</code>. Colab puede invocar el endpoint protegido de automatización cuando necesites ejecutar un proceso manual.</p><a href="https://drive.google.com" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-teal-700 hover:text-teal-900">Abrir Drive <ArrowUpRight className="h-3.5 w-3.5" /></a></div></div>
      </section>
    </div>
  );
};