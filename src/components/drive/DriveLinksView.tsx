import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ChevronDown, ChevronUp, Cloud, Copy, Download, ExternalLink, FolderInput, LogIn, LogOut, Save, SearchCheck, Square } from 'lucide-react';
import { DriveLinks } from '../../types';

type DriveCopyLogEntry = {
  path: string;
  name: string;
  type: 'folder' | 'file';
  mimeType: string;
  status: 'copied' | 'skipped' | 'error';
  errorMessage?: string | null;
};

type RecentItem = { name: string; relativePath: string; isFolder: boolean; status: 'copied' | 'skipped' | 'error'; errorMessage?: string | null };

const STATUS_LABELS: Record<DriveCopyLogEntry['status'], string> = {
  copied: 'Copiado',
  skipped: 'Omitido (ya existía)',
  error: 'Error',
};

// Resultado de "Validar" (recorrido de solo lectura, no copia nada):
// clasifica cada archivo/carpeta de origen como que ya existe en destino o
// que falta por copiar -- se corre antes de la copia real para saber qué
// hace falta sin comprometerse todavía a copiar nada.
type ValidateRecentItem = { name: string; relativePath: string; isFolder: boolean; status: 'missing' | 'exists' | 'error'; errorMessage?: string | null };

const VALIDATE_STATUS_LABELS: Record<ValidateRecentItem['status'], string> = {
  missing: 'Falta por copiar',
  exists: 'Ya existe en destino',
  error: 'Error',
};

const LIVE_LOG_COLLAPSED_COUNT = 8;

// Si Vercel mata la función por exceder el tiempo máximo (60s en el plan
// actual), la respuesta no es JSON sino una página de error — sin esto,
// response.json() revienta con un "Unexpected token" críptico en vez de
// explicar lo que realmente pasó.
async function parseJsonResponse(response: Response): Promise<any> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    if (!response.ok) {
      throw new Error(
        'La copia tardó demasiado y el servidor la interrumpió (límite de 60s). Prueba copiar una carpeta más pequeña, o copia sus subcarpetas por separado.',
      );
    }
    throw new Error('El servidor devolvió una respuesta inesperada.');
  }
}

// Si la copia se corta por un error de red (no un "Detener" explícito), el
// siguiente clic en "Copiar" retoma el mismo trabajo en vez de volver a
// escanear todo el origen desde cero -- se guarda solo mientras el par
// origen/destino no cambie.
const DRIVE_COPY_JOB_STORAGE_KEY = 'seguimiento_drive_copy_job';

function readSavedCopyJob(sourceUrl: string, destinationUrl: string): string | null {
  try {
    const raw = window.localStorage.getItem(DRIVE_COPY_JOB_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (saved?.sourceUrl === sourceUrl && saved?.destinationUrl === destinationUrl && typeof saved?.jobId === 'string') {
      return saved.jobId;
    }
    return null;
  } catch {
    return null;
  }
}

function saveCopyJob(jobId: string, sourceUrl: string, destinationUrl: string) {
  try {
    window.localStorage.setItem(DRIVE_COPY_JOB_STORAGE_KEY, JSON.stringify({ jobId, sourceUrl, destinationUrl }));
  } catch {
    // Conveniencia solamente -- si no se puede guardar, el próximo intento simplemente arranca de cero.
  }
}

function clearSavedCopyJob() {
  try {
    window.localStorage.removeItem(DRIVE_COPY_JOB_STORAGE_KEY);
  } catch {
    // No crítico.
  }
}

// Mismo mecanismo de reanudación, pero para el job de validación (son dos
// jobs completamente independientes -- validar nunca toca ni reutiliza las
// filas de un job de copia, y viceversa).
const DRIVE_VALIDATE_JOB_STORAGE_KEY = 'seguimiento_drive_validate_job';

function readSavedValidateJob(sourceUrl: string, destinationUrl: string): string | null {
  try {
    const raw = window.localStorage.getItem(DRIVE_VALIDATE_JOB_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (saved?.sourceUrl === sourceUrl && saved?.destinationUrl === destinationUrl && typeof saved?.jobId === 'string') {
      return saved.jobId;
    }
    return null;
  } catch {
    return null;
  }
}

function saveValidateJob(jobId: string, sourceUrl: string, destinationUrl: string) {
  try {
    window.localStorage.setItem(DRIVE_VALIDATE_JOB_STORAGE_KEY, JSON.stringify({ jobId, sourceUrl, destinationUrl }));
  } catch {
    // Conveniencia solamente.
  }
}

function clearSavedValidateJob() {
  try {
    window.localStorage.removeItem(DRIVE_VALIDATE_JOB_STORAGE_KEY);
  } catch {
    // No crítico.
  }
}

const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

const downloadCsv = (filenamePrefix: string, rows: string[][]) => {
  const csvContent = rows.map((row) => row.map(csvCell).join(',')).join('\n');
  const blob = new Blob([`﻿${csvContent}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${filenamePrefix}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

const downloadCopyReportCsv = (log: DriveCopyLogEntry[]) => {
  downloadCsv('informe-copiado-drive', [
    ['Ruta', 'Nombre', 'Tipo', 'Estado', 'Detalle del error'],
    ...log.map((entry) => [entry.path, entry.name, entry.type === 'folder' ? 'Carpeta' : 'Archivo', STATUS_LABELS[entry.status], entry.errorMessage ?? '']),
  ]);
};

const downloadValidateReportCsv = (items: ValidateRecentItem[]) => {
  downloadCsv('informe-validacion-drive', [
    ['Ruta', 'Nombre', 'Tipo', 'Estado', 'Detalle del error'],
    ...items.map((entry) => [entry.relativePath, entry.name, entry.isFolder ? 'Carpeta' : 'Archivo', VALIDATE_STATUS_LABELS[entry.status], entry.errorMessage ?? '']),
  ]);
};

export const DriveLinksView: React.FC = () => {
  const [links, setLinks] = useState<DriveLinks>({ sourceUrl: '', destinationUrl: '' });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [copyProgress, setCopyProgress] = useState({ percent: 0, processed: 0, total: 0, phase: '' });
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [driveSession, setDriveSession] = useState<{ connected: boolean; email: string | null }>({ connected: false, email: null });
  const [copyLog, setCopyLog] = useState<DriveCopyLogEntry[] | null>(null);
  const [liveLog, setLiveLog] = useState<RecentItem[]>([]);
  const [isLogExpanded, setIsLogExpanded] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeJobIdRef = useRef<string | null>(null);
  const pollingRef = useRef(false);
  const directJobIdRef = useRef<string | null>(null);
  const directCancelRequestedRef = useRef(false);

  // Estado de "Validar" -- completamente aparte del de "Copiar": corre su
  // propio job de solo lectura, con su propio log en vivo y resumen final.
  const [isValidating, setIsValidating] = useState(false);
  const [validateProgress, setValidateProgress] = useState({ percent: 0, processed: 0, total: 0, phase: '' });
  const [validateMessage, setValidateMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [validateLog, setValidateLog] = useState<ValidateRecentItem[] | null>(null);
  const [validateLiveLog, setValidateLiveLog] = useState<ValidateRecentItem[]>([]);
  const [isValidateLogExpanded, setIsValidateLogExpanded] = useState(false);
  // Se guarda aparte del ref (que se limpia al terminar el loop) para poder
  // ofrecer "Copiar lo que falta" después de que la validación ya terminó.
  const [completedValidateJobId, setCompletedValidateJobId] = useState<string | null>(null);
  const validateAbortControllerRef = useRef<AbortController | null>(null);
  const validateJobIdRef = useRef<string | null>(null);
  const validateCancelRequestedRef = useRef(false);

  useEffect(() => {
    const loadLinks = async () => {
      try {
        const response = await fetch('/api/drive-links');
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.errors?.[0] || 'No fue posible cargar los enlaces.');
        const loaded: DriveLinks = payload.data || { sourceUrl: '', destinationUrl: '' };
        setLinks(loaded);
        // Si quedó una copia en curso de un refresco o cierre anterior (no
        // un "Detener" explícito, eso borra el job guardado), se retoma
        // sola -- no hace falta darle clic a "Copiar" de nuevo para seguir
        // viendo el progreso.
        const savedJobId = readSavedCopyJob(loaded.sourceUrl, loaded.destinationUrl);
        if (savedJobId) void resumeSavedCopy(savedJobId);
        const savedValidateJobId = readSavedValidateJob(loaded.sourceUrl, loaded.destinationUrl);
        if (savedValidateJobId) void resumeSavedValidate(savedValidateJobId);
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

  // Compartido entre "Copiar carpeta completa" y la reanudación automática
  // al recargar la página -- ambos simplemente siguen llamando al mismo
  // endpoint con el jobId hasta que "done" sea true.
  // firstRequestBody: para arrancar el loop con una petición distinta de la
  // normal (ej. "copyMissing", que primero convierte un job de validación
  // ya terminado en uno de copia real) -- desde la segunda vuelta siempre
  // sigue con el jobId normal, igual que cualquier otra copia.
  const runDirectCopyLoop = async (initialJobId: string | null, firstRequestBody?: Record<string, unknown>) => {
    directCancelRequestedRef.current = false;
    directJobIdRef.current = null;
    let jobId: string | null = initialJobId;
    let done = false;
    let isFirstRequest = true;
    try {
      while (!done) {
        if (directCancelRequestedRef.current) {
          setMessage({ type: 'error', text: 'Copiado detenido por el usuario.' });
          break;
        }
        const controller = new AbortController();
        abortControllerRef.current = controller;
        const requestBody = isFirstRequest && firstRequestBody ? firstRequestBody : (jobId ? { jobId } : links);
        isFirstRequest = false;
        const response = await fetch('/api/drive-copy-direct', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
        abortControllerRef.current = null;
        const payload = await parseJsonResponse(response);
        if (!response.ok) throw new Error(payload.errors?.[0] || 'No fue posible copiar desde Google Drive.');
        const result = payload.data;
        jobId = result.jobId;
        directJobIdRef.current = jobId;
        saveCopyJob(jobId, links.sourceUrl, links.destinationUrl);

        if (Array.isArray(result.recentItems) && result.recentItems.length > 0) {
          setLiveLog((prev) => [...prev, ...result.recentItems]);
        }

        {
          // El total crece a medida que se descubren más carpetas -- no se
          // conoce de antemano, así que el porcentaje es solo una
          // referencia aproximada mientras la copia sigue en curso.
          const processed = result.copiedFiles + result.skippedFiles + (result.errors ?? 0);
          const total = result.total ?? processed;
          setCopyProgress({
            percent: result.done ? 100 : total > 0 ? Math.min(99, Math.round((processed / total) * 100)) : 5,
            processed,
            total,
            phase: result.done ? 'Copia completada' : `Copiando... ${processed} de ${total} elemento(s) procesados`,
          });
        }

        if (result.cancelled) {
          clearSavedCopyJob();
          setCopyLog(result.log || []);
          setMessage({ type: 'error', text: 'Copiado detenido por el usuario.' });
          done = true;
        } else if (result.done) {
          clearSavedCopyJob();
          setCopyLog(result.log || []);
          // El motivo del primer error se muestra directo en pantalla -- no
          // hay que abrir el CSV para enterarse de qué falló.
          const firstError = (result.log || []).find((entry: DriveCopyLogEntry) => entry.status === 'error' && entry.errorMessage);
          const errorNote = result.errors > 0 ? ` (${result.errors} con error: ${firstError?.errorMessage ?? 'sin detalle'})` : '';
          setMessage({
            type: result.errors > 0 ? 'error' : 'success',
            text: `Copia completada: ${result.copiedFiles} archivos, ${result.createdFolders} carpetas nuevas y ${result.skippedFiles} omitidos${errorNote}.`,
          });
          done = true;
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setMessage({ type: 'error', text: 'Copiado detenido por el usuario.' });
      } else {
        setMessage({ type: 'error', text: error instanceof Error ? error.message : 'No fue posible copiar desde Google Drive.' });
      }
    } finally {
      abortControllerRef.current = null;
      directJobIdRef.current = null;
      setIsCopying(false);
    }
  };

  // Al recargar la página con una copia en curso guardada: primero pide el
  // estado actual SIN avanzar nada (action: 'status'), para que el log y
  // la barra de progreso aparezcan de inmediato con todo lo ya hecho --
  // recién después sigue el loop normal para continuar procesando.
  const resumeSavedCopy = async (jobId: string) => {
    setIsCopying(true);
    setMessage({ type: 'success', text: 'Retomando una copia interrumpida anteriormente...' });
    setLiveLog([]);
    try {
      const response = await fetch('/api/drive-copy-direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status', jobId }),
      });
      const payload = await parseJsonResponse(response);
      if (response.ok) {
        const result = payload.data;
        if (Array.isArray(result.recentItems)) setLiveLog(result.recentItems);
        const processed = (result.copiedFiles ?? 0) + (result.skippedFiles ?? 0) + (result.errors ?? 0);
        const total = result.total ?? processed;
        setCopyProgress({
          percent: result.done ? 100 : total > 0 ? Math.min(99, Math.round((processed / total) * 100)) : 5,
          processed,
          total,
          phase: `Retomando... ${processed} de ${total} elemento(s) procesados`,
        });
        if (result.done || result.cancelled) {
          clearSavedCopyJob();
          setIsCopying(false);
          return;
        }
      }
    } catch {
      // Si la consulta de estado falla, igual se intenta continuar abajo.
    }
    await runDirectCopyLoop(jobId);
  };

  // Copia solo lo que "Validar qué falta" encontró que falta -- convierte
  // ese mismo job (lo que ya existía queda resuelto tal cual) en vez de
  // volver a recorrer y comparar todo el árbol desde cero.
  const copyMissingFromValidation = async () => {
    if (!completedValidateJobId) return;
    const jobId = completedValidateJobId;
    setCompletedValidateJobId(null);
    setIsCopying(true);
    setCopyProgress({ percent: 3, processed: 0, total: 0, phase: 'Copiando lo que falta...' });
    setMessage(null);
    setCopyLog(null);
    setLiveLog([]);
    await runDirectCopyLoop(jobId, { action: 'copyMissing', jobId });
  };

  const copyFolder = async () => {
    setIsCopying(true);
    setCopyProgress({ percent: 3, processed: 0, total: 0, phase: 'Iniciando copia...' });
    setMessage(null);
    setCopyLog(null);
    if (driveSession.connected) {
      const savedJobId = readSavedCopyJob(links.sourceUrl, links.destinationUrl);
      if (savedJobId) {
        setMessage({ type: 'success', text: 'Retomando una copia interrumpida anteriormente...' });
      } else {
        setLiveLog([]);
      }
      await runDirectCopyLoop(savedJobId);
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
      const payload = await parseJsonResponse(response);
      if (!response.ok) throw new Error(payload.errors?.[0] || 'No fue posible iniciar la copia.');
      const startedJobId = payload.data.jobId || jobId;
      activeJobIdRef.current = startedJobId;
      let completed = false;
      while (!completed && pollingRef.current) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const progressResponse = await fetch(`/api/drive-progress?jobId=${encodeURIComponent(startedJobId)}`);
        const progressPayload = await parseJsonResponse(progressResponse);
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
    if (abortControllerRef.current || directJobIdRef.current) {
      directCancelRequestedRef.current = true;
      abortControllerRef.current?.abort();
      if (directJobIdRef.current) {
        try {
          await fetch('/api/drive-copy-direct', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'cancel', jobId: directJobIdRef.current }),
          });
        } catch {
          // El loop local ya se detiene con directCancelRequestedRef.
        }
      }
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

  // Mismo mecanismo que runDirectCopyLoop, pero contra el job de validación
  // (action: 'validate' al crearlo) -- nunca escribe nada en Drive, solo
  // compara y clasifica.
  const runDirectValidateLoop = async (initialJobId: string | null) => {
    validateCancelRequestedRef.current = false;
    validateJobIdRef.current = null;
    let jobId: string | null = initialJobId;
    let done = false;
    try {
      while (!done) {
        if (validateCancelRequestedRef.current) {
          setValidateMessage({ type: 'error', text: 'Validación detenida por el usuario.' });
          break;
        }
        const controller = new AbortController();
        validateAbortControllerRef.current = controller;
        const response = await fetch('/api/drive-copy-direct', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(jobId ? { jobId } : { ...links, action: 'validate' }),
          signal: controller.signal,
        });
        validateAbortControllerRef.current = null;
        const payload = await parseJsonResponse(response);
        if (!response.ok) throw new Error(payload.errors?.[0] || 'No fue posible validar la carpeta de Drive.');
        const result = payload.data;
        jobId = result.jobId;
        validateJobIdRef.current = jobId;
        saveValidateJob(jobId, links.sourceUrl, links.destinationUrl);

        if (Array.isArray(result.recentItems) && result.recentItems.length > 0) {
          setValidateLiveLog((prev) => [...prev, ...result.recentItems]);
        }

        {
          const processed = (result.missingFiles ?? 0) + (result.missingFolders ?? 0) + (result.existingFiles ?? 0) + (result.existingFolders ?? 0) + (result.errors ?? 0);
          const total = result.total ?? processed;
          setValidateProgress({
            percent: result.done ? 100 : total > 0 ? Math.min(99, Math.round((processed / total) * 100)) : 5,
            processed,
            total,
            phase: result.done ? 'Validación completada' : `Validando... ${processed} de ${total} elemento(s) revisados`,
          });
        }

        if (result.cancelled) {
          clearSavedValidateJob();
          setValidateLog(result.log || []);
          setValidateMessage({ type: 'error', text: 'Validación detenida por el usuario.' });
          done = true;
        } else if (result.done) {
          clearSavedValidateJob();
          setValidateLog(result.log || []);
          const missingTotal = (result.missingFiles ?? 0) + (result.missingFolders ?? 0);
          const errorNote = result.errors > 0 ? ` (${result.errors} con error al validar)` : '';
          setValidateMessage({
            type: missingTotal > 0 ? 'error' : 'success',
            text: missingTotal > 0
              ? `Faltan por copiar: ${result.missingFiles} archivo(s) y ${result.missingFolders} carpeta(s). Ya existen: ${result.existingFiles} archivo(s) y ${result.existingFolders} carpeta(s)${errorNote}.`
              : `Todo al día: no falta nada por copiar (${result.existingFiles} archivo(s) y ${result.existingFolders} carpeta(s) ya están en destino)${errorNote}.`,
          });
          if (missingTotal > 0) setCompletedValidateJobId(jobId);
          done = true;
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setValidateMessage({ type: 'error', text: 'Validación detenida por el usuario.' });
      } else {
        setValidateMessage({ type: 'error', text: error instanceof Error ? error.message : 'No fue posible validar la carpeta de Drive.' });
      }
    } finally {
      validateAbortControllerRef.current = null;
      validateJobIdRef.current = null;
      setIsValidating(false);
    }
  };

  const resumeSavedValidate = async (jobId: string) => {
    setIsValidating(true);
    setValidateMessage({ type: 'success', text: 'Retomando una validación interrumpida anteriormente...' });
    setValidateLiveLog([]);
    try {
      const response = await fetch('/api/drive-copy-direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status', jobId }),
      });
      const payload = await parseJsonResponse(response);
      if (response.ok) {
        const result = payload.data;
        if (Array.isArray(result.recentItems)) setValidateLiveLog(result.recentItems);
        const processed = (result.missingFiles ?? 0) + (result.missingFolders ?? 0) + (result.existingFiles ?? 0) + (result.existingFolders ?? 0) + (result.errors ?? 0);
        const total = result.total ?? processed;
        setValidateProgress({
          percent: result.done ? 100 : total > 0 ? Math.min(99, Math.round((processed / total) * 100)) : 5,
          processed,
          total,
          phase: `Retomando... ${processed} de ${total} elemento(s) revisados`,
        });
        if (result.done || result.cancelled) {
          clearSavedValidateJob();
          setIsValidating(false);
          return;
        }
      }
    } catch {
      // Si la consulta de estado falla, igual se intenta continuar abajo.
    }
    await runDirectValidateLoop(jobId);
  };

  const validateFolder = async () => {
    setIsValidating(true);
    setValidateProgress({ percent: 3, processed: 0, total: 0, phase: 'Iniciando validación...' });
    setValidateMessage(null);
    setValidateLog(null);
    setCompletedValidateJobId(null);
    const savedJobId = readSavedValidateJob(links.sourceUrl, links.destinationUrl);
    if (savedJobId) {
      setValidateMessage({ type: 'success', text: 'Retomando una validación interrumpida anteriormente...' });
    } else {
      setValidateLiveLog([]);
    }
    await runDirectValidateLoop(savedJobId);
  };

  const stopValidate = async () => {
    validateCancelRequestedRef.current = true;
    validateAbortControllerRef.current?.abort();
    if (validateJobIdRef.current) {
      try {
        await fetch('/api/drive-copy-direct', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'cancel', jobId: validateJobIdRef.current }),
        });
      } catch {
        // El loop local ya se detiene con validateCancelRequestedRef.
      }
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
          {validateMessage && (
            <div role="status" className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${validateMessage.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
              <span>{validateMessage.text}</span>
              <div className="flex items-center gap-2">
                {completedValidateJobId && (
                  <button
                    type="button"
                    onClick={copyMissingFromValidation}
                    disabled={isCopying || isValidating}
                    className="inline-flex items-center gap-1.5 rounded-md border border-current px-2.5 py-1 text-[11px] font-bold hover:bg-white/60 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Copy className="h-3.5 w-3.5" /> Copiar lo que falta
                  </button>
                )}
                {validateLog && validateLog.length > 0 && (
                  <button type="button" onClick={() => downloadValidateReportCsv(validateLog)} className="inline-flex items-center gap-1.5 rounded-md border border-current px-2.5 py-1 text-[11px] font-bold hover:bg-white/60">
                    <Download className="h-3.5 w-3.5" /> Descargar informe (CSV)
                  </button>
                )}
              </div>
            </div>
          )}
          {isValidating && (
            <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3" role="status">
              <div className="flex items-center justify-between text-[11px] font-bold text-indigo-900">
                <span>{validateProgress.phase}</span>
                <span>{validateProgress.percent}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
                <div className="h-full rounded-full bg-indigo-600 transition-all duration-500" style={{ width: `${Math.max(validateProgress.percent, 3)}%` }} />
              </div>
              <p className="mt-2 text-[11px] text-indigo-800">{validateProgress.processed} de {validateProgress.total || '...'} elementos revisados</p>

              {validateLiveLog.length > 0 && (
                <div className="mt-3 border-t border-indigo-100 pt-2.5">
                  <div className="max-h-56 space-y-1 overflow-y-auto rounded-md bg-white/70 p-2">
                    {(isValidateLogExpanded ? validateLiveLog : validateLiveLog.slice(-LIVE_LOG_COLLAPSED_COUNT)).slice().reverse().map((item, idx) => (
                      <div key={`${item.relativePath}-${idx}`} className="flex items-center gap-1.5 text-[11px]">
                        <span className={`shrink-0 font-bold ${item.status === 'error' ? 'text-rose-600' : item.status === 'exists' ? 'text-slate-400' : 'text-amber-600'}`}>
                          {item.status === 'error' ? '✕' : item.status === 'exists' ? '·' : '!'}
                        </span>
                        <span className="truncate text-slate-700" title={item.errorMessage ?? item.relativePath}>{item.name}{item.isFolder ? '/' : ''}</span>
                      </div>
                    ))}
                  </div>
                  {validateLiveLog.length > LIVE_LOG_COLLAPSED_COUNT && (
                    <button
                      type="button"
                      onClick={() => setIsValidateLogExpanded((prev) => !prev)}
                      className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold text-indigo-700 hover:text-indigo-900"
                    >
                      {isValidateLogExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      {isValidateLogExpanded ? 'Mostrar menos' : `Mostrar más (${validateLiveLog.length} en total)`}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {message && (
            <div role="status" className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${message.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
              <span>{message.text}</span>
              {copyLog && copyLog.length > 0 && (
                <button type="button" onClick={() => downloadCopyReportCsv(copyLog)} className="inline-flex items-center gap-1.5 rounded-md border border-current px-2.5 py-1 text-[11px] font-bold hover:bg-white/60">
                  <Download className="h-3.5 w-3.5" /> Descargar informe (CSV)
                </button>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <p className="max-w-md text-[11px] leading-5 text-slate-500">Solo se almacenan las URLs. Las credenciales y permisos permanecen en Google Apps Script/Colab.</p>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="submit" disabled={isSaving || isCopying || isValidating} className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"><Save className="h-3.5 w-3.5" />{isSaving ? 'Guardando...' : 'Guardar enlaces'}</button>
              {isValidating ? (
                <button type="button" onClick={stopValidate} className="inline-flex items-center gap-2 rounded-lg border border-rose-600 bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-700 transition hover:bg-rose-100"><Square className="h-3.5 w-3.5" /> Detener validación</button>
              ) : (
                <button type="button" onClick={validateFolder} disabled={isSaving || isCopying || !links.sourceUrl || !links.destinationUrl || !driveSession.connected} title="Revisa qué archivos faltan por copiar, sin copiar nada todavía" className="inline-flex items-center gap-2 rounded-lg border border-indigo-600 px-4 py-2.5 text-xs font-bold text-indigo-700 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"><SearchCheck className="h-3.5 w-3.5" /> Validar qué falta</button>
              )}
              {isCopying ? (
                <button type="button" onClick={stopCopy} className="inline-flex items-center gap-2 rounded-lg border border-rose-600 bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-700 transition hover:bg-rose-100"><Square className="h-3.5 w-3.5" /> Detener copiado</button>
              ) : (
                <button type="button" onClick={copyFolder} disabled={isSaving || isValidating || !links.sourceUrl || !links.destinationUrl || !driveSession.connected} className="inline-flex items-center gap-2 rounded-lg border border-teal-700 px-4 py-2.5 text-xs font-bold text-teal-800 transition hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50"><Copy className="h-3.5 w-3.5" /> Copiar carpeta completa</button>
              )}
            </div>
          </div>
          {isCopying && (
            <div className="mt-4 rounded-lg border border-teal-100 bg-teal-50 p-3" role="status">
              <div className="flex items-center justify-between text-[11px] font-bold text-teal-900">
                <span>{copyProgress.phase}</span>
                <span>{copyProgress.percent}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
                <div className="h-full rounded-full bg-teal-600 transition-all duration-500" style={{ width: `${Math.max(copyProgress.percent, 3)}%` }} />
              </div>
              <p className="mt-2 text-[11px] text-teal-800">{copyProgress.processed} de {copyProgress.total || '...'} elementos procesados</p>

              {liveLog.length > 0 && (
                <div className="mt-3 border-t border-teal-100 pt-2.5">
                  <div className="max-h-56 space-y-1 overflow-y-auto rounded-md bg-white/70 p-2">
                    {(isLogExpanded ? liveLog : liveLog.slice(-LIVE_LOG_COLLAPSED_COUNT)).slice().reverse().map((item, idx) => (
                      <div key={`${item.relativePath}-${idx}`} className="flex items-center gap-1.5 text-[11px]">
                        <span className={`shrink-0 font-bold ${item.status === 'error' ? 'text-rose-600' : item.status === 'skipped' ? 'text-slate-400' : 'text-emerald-700'}`}>
                          {item.status === 'error' ? '✕' : item.status === 'skipped' ? '·' : '✓'}
                        </span>
                        <span className="truncate text-slate-700" title={item.errorMessage ?? item.relativePath}>{item.name}{item.isFolder ? '/' : ''}</span>
                      </div>
                    ))}
                  </div>
                  {liveLog.length > LIVE_LOG_COLLAPSED_COUNT && (
                    <button
                      type="button"
                      onClick={() => setIsLogExpanded((prev) => !prev)}
                      className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold text-teal-700 hover:text-teal-900"
                    >
                      {isLogExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      {isLogExpanded ? 'Mostrar menos' : `Mostrar más (${liveLog.length} en total)`}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </form>}
      </section>

      <section className="rounded-[10px] border border-slate-200 bg-[#eef7f5] p-5">
        <div className="flex items-start gap-3"><ExternalLink className="mt-0.5 h-5 w-5 text-teal-700" /><div><h3 className="text-sm font-bold text-slate-950">Flujo preparado</h3><p className="mt-1 text-xs leading-5 text-slate-600">Apps Script puede leer esta configuración desde <code className="font-mono text-teal-800">GET /api/drive-links</code>. Colab puede invocar el endpoint protegido de automatización cuando necesites ejecutar un proceso manual.</p><a href="https://drive.google.com" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-teal-700 hover:text-teal-900">Abrir Drive <ArrowUpRight className="h-3.5 w-3.5" /></a></div></div>
      </section>
    </div>
  );
};