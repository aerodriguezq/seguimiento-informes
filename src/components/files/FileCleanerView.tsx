import React, { useState } from 'react';
import {
  Upload, FileText, AlertTriangle, ShieldAlert, CheckCircle2, Download,
  XCircle, Info, Lock,
} from 'lucide-react';

type PdfInfo = {
  title: string | null;
  author: string | null;
  subject: string | null;
  keywords: string | null;
  creator: string | null;
  producer: string | null;
  creationDate: string | null;
  modDate: string | null;
};

type PdfReport = {
  pageCount: number;
  version: string;
  sizeBytes: number;
  encrypted: boolean;
  revisionCount: number;
  info: PdfInfo;
  hasXMP: boolean;
  hasJavaScript: boolean;
  hasEmbeddedFiles: boolean;
  hasOpenAction: boolean;
  hasOutlines: boolean;
  hasForm: boolean;
  formFieldCount: number;
  hasLang: boolean;
  hasStructTree: boolean;
  possibleSignature: boolean;
};

const INFO_FIELD_KEYS = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate', 'Trapped'];
const CATALOG_KEYS_TO_STRIP = ['Metadata', 'OpenAction', 'Names', 'Outlines', 'Lang', 'PieceInfo', 'AA', 'StructTreeRoot', 'MarkInfo'];

async function analyzePdf(bytes: Uint8Array): Promise<PdfReport> {
  const { PDFDocument, PDFName, PDFDict } = await import('pdf-lib');
  // Escaneo de bytes crudos para lo que pdf-lib no expone directo: versión
  // de cabecera, número de revisiones (%%EOF) y rastro de firma (/Type
  // /Sig o /ByteRange son el indicio estándar de una firma incrustada).
  const raw = new TextDecoder('latin1').decode(bytes);
  const versionMatch = raw.slice(0, 16).match(/%PDF-(\d\.\d)/);
  const revisionCount = (raw.match(/%%EOF/g) || []).length;
  const possibleSignature = /\/Type\s*\/Sig\b/.test(raw) || /\/ByteRange/.test(raw);

  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const catalog = doc.catalog;
  const lookupFlag = (key: string) => !!catalog.lookup(PDFName.of(key));
  const namesDict = catalog.lookup(PDFName.of('Names'));
  let hasJavaScript = false;
  let hasEmbeddedFiles = false;
  if (namesDict instanceof PDFDict) {
    hasJavaScript = !!namesDict.lookup(PDFName.of('JavaScript'));
    hasEmbeddedFiles = !!namesDict.lookup(PDFName.of('EmbeddedFiles'));
  }

  let hasForm = false;
  let formFieldCount = 0;
  try {
    const fields = doc.getForm().getFields();
    formFieldCount = fields.length;
    hasForm = formFieldCount > 0;
  } catch {
    // Algunos PDFs traen un AcroForm mal formado que rompe el parser de
    // formularios de pdf-lib -- se reporta como "no se pudo leer", no como "no tiene".
  }

  return {
    pageCount: doc.getPageCount(),
    version: versionMatch ? versionMatch[1] : 'desconocida',
    sizeBytes: bytes.length,
    encrypted: doc.isEncrypted,
    revisionCount,
    info: {
      title: doc.getTitle() || null,
      author: doc.getAuthor() || null,
      subject: doc.getSubject() || null,
      keywords: doc.getKeywords() || null,
      creator: doc.getCreator() || null,
      producer: doc.getProducer() || null,
      creationDate: doc.getCreationDate()?.toISOString() ?? null,
      modDate: doc.getModificationDate()?.toISOString() ?? null,
    },
    hasXMP: lookupFlag('Metadata'),
    hasJavaScript,
    hasEmbeddedFiles,
    hasOpenAction: lookupFlag('OpenAction'),
    hasOutlines: lookupFlag('Outlines'),
    hasForm,
    formFieldCount,
    hasLang: lookupFlag('Lang'),
    hasStructTree: lookupFlag('StructTreeRoot'),
    possibleSignature,
  };
}

async function cleanPdf(bytes: Uint8Array): Promise<Uint8Array> {
  const { PDFDocument, PDFName } = await import('pdf-lib');
  // updateMetadata:false evita que pdf-lib se auto-firme como Producer y
  // pise el ModDate apenas se carga el documento (lo hace por defecto).
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });

  // Elimina las claves del diccionario /Info en vez de vaciarlas -- así no
  // queda ni el campo con valor vacío, se borra el par clave/valor entero.
  // getInfoDict existe en runtime pero las typings de pdf-lib la marcan
  // private, así que se accede mediante un cast.
  const info = (doc as unknown as { getInfoDict(): { delete(key: ReturnType<typeof PDFName.of>): void } }).getInfoDict();
  INFO_FIELD_KEYS.forEach((k) => info.delete(PDFName.of(k)));

  const catalog = doc.catalog;
  CATALOG_KEYS_TO_STRIP.forEach((k) => catalog.delete(PDFName.of(k)));

  // Sin object streams, como se pidió -- pdf-lib no soporta linealizar
  // ni fijar un /ID determinístico, eso no se puede replicar aquí.
  return doc.save({ useObjectStreams: false });
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

const FlagRow: React.FC<{ label: string; present: boolean; detail?: string }> = ({ label, present, detail }) => (
  <div className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
    <span className="text-slate-600">{label}</span>
    <span className={`inline-flex items-center gap-1 font-semibold ${present ? 'text-amber-700' : 'text-emerald-700'}`}>
      {present ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
      {present ? (detail || 'Presente') : 'No'}
    </span>
  </div>
);

export const FileCleanerView: React.FC = () => {
  const [fileName, setFileName] = useState('');
  const [originalBytes, setOriginalBytes] = useState<Uint8Array | null>(null);
  const [report, setReport] = useState<PdfReport | null>(null);
  const [cleanedReport, setCleanedReport] = useState<PdfReport | null>(null);
  const [cleanedSize, setCleanedSize] = useState<number | null>(null);
  const [sigConfirmed, setSigConfirmed] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [error, setError] = useState('');
  const [cleanedReady, setCleanedReady] = useState(false);

  const reset = () => {
    setFileName(''); setOriginalBytes(null); setReport(null); setCleanedReport(null);
    setCleanedSize(null); setSigConfirmed(false); setError(''); setCleanedReady(false);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    reset();
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Por ahora esta herramienta solo procesa archivos PDF.');
      return;
    }
    setFileName(file.name);
    setIsAnalyzing(true);
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      setOriginalBytes(bytes);
      const analyzed = await analyzePdf(bytes);
      setReport(analyzed);
    } catch (err) {
      setError(err instanceof Error ? `No fue posible leer el archivo: ${err.message}` : 'No fue posible leer el archivo.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleClean = async () => {
    if (!originalBytes || !fileName) return;
    if (report?.possibleSignature && !sigConfirmed) return;
    setIsCleaning(true);
    setError('');
    try {
      const cleaned = await cleanPdf(originalBytes);
      const verified = await analyzePdf(cleaned);
      setCleanedReport(verified);
      setCleanedSize(cleaned.length);
      setCleanedReady(true);

      const baseName = fileName.replace(/\.pdf$/i, '');
      const blob = new Blob([cleaned], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${baseName}_limpio.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? `No fue posible limpiar el archivo: ${err.message}` : 'No fue posible limpiar el archivo.');
    } finally {
      setIsCleaning(false);
    }
  };

  const infoIsEmpty = (info: PdfInfo) => Object.values(info).every((v) => !v);

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-10">
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg shrink-0 bg-slate-100 text-slate-700">
            <FileText className="h-4.5 w-4.5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Limpieza de Metadatos de Archivos</h2>
            <p className="text-[11px] text-slate-500">
              Sube un PDF, revisa qué metadatos trae y descarga una copia limpia. Todo corre en tu navegador -- el archivo nunca se sube a ningún servidor.
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5 text-[11px] text-slate-600 flex items-start gap-1.5">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-slate-400" />
          <span>
            Por ahora solo procesa <strong>PDF</strong>, y limpia metadatos (Info/XMP, JavaScript, adjuntos incrustados, acciones automáticas, marcadores, idioma) -- no valida el contenido del documento (nombres, cédulas, porcentajes, etc.), eso depende de cada tipo de documento y no se puede generalizar.
          </span>
        </div>

        <label className="mt-4 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors px-6 py-8 cursor-pointer">
          <Upload className="h-6 w-6 text-slate-400" />
          <span className="text-xs font-semibold text-slate-700">{fileName || 'Elegir archivo PDF'}</span>
          <span className="text-[10.5px] text-slate-400">Clic para seleccionar</span>
          <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={handleFileChange} />
        </label>

        {isAnalyzing && <p className="mt-3 text-xs text-slate-500">Analizando archivo...</p>}
        {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}
      </div>

      {report && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Diagnóstico del archivo original</h3>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="rounded-lg bg-slate-50 border border-slate-100 p-2.5">
              <span className="block text-slate-400 text-[10.5px]">Páginas</span>
              <span className="font-bold text-slate-900">{report.pageCount}</span>
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-100 p-2.5">
              <span className="block text-slate-400 text-[10.5px]">Versión PDF</span>
              <span className="font-bold text-slate-900">{report.version}</span>
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-100 p-2.5">
              <span className="block text-slate-400 text-[10.5px]">Tamaño</span>
              <span className="font-bold text-slate-900">{fmtBytes(report.sizeBytes)}</span>
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-100 p-2.5">
              <span className="block text-slate-400 text-[10.5px]">Revisiones (%%EOF)</span>
              <span className="font-bold text-slate-900">{report.revisionCount}</span>
            </div>
          </div>

          {report.encrypted && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-800 flex items-start gap-1.5">
              <Lock className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>Este PDF parece estar cifrado/protegido. La limpieza puede no funcionar de forma confiable sobre contenido cifrado.</span>
            </div>
          )}

          {report.possibleSignature && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2.5 text-[11px] text-rose-800 space-y-2">
              <div className="flex items-start gap-1.5 font-semibold">
                <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>Se detectó un posible rastro de firma digital (/Type /Sig o /ByteRange). Limpiar este archivo probablemente invalide esa firma.</span>
              </div>
              <label className="flex items-center gap-2 cursor-pointer pl-5">
                <input type="checkbox" checked={sigConfirmed} onChange={(e) => setSigConfirmed(e.target.checked)} className="rounded" />
                <span>Entiendo el riesgo y quiero limpiar el archivo de todas formas.</span>
              </label>
            </div>
          )}

          <div>
            <p className="text-[11px] font-semibold text-slate-600 mb-1.5">Metadatos encontrados (diccionario /Info)</p>
            {infoIsEmpty(report.info) ? (
              <p className="text-[11px] italic text-slate-400">Ninguno.</p>
            ) : (
              <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 text-[11px]">
                {Object.entries(report.info).filter(([, v]) => v).map(([k, v]) => (
                  <div key={k} className="flex items-start justify-between gap-3 px-2.5 py-1.5">
                    <span className="text-slate-500 shrink-0">{k}</span>
                    <span className="text-slate-800 text-right break-all">{v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="text-[11px] font-semibold text-slate-600 mb-1.5">Otros rastros</p>
            <div className="text-[11px]">
              <FlagRow label="Metadatos XMP" present={report.hasXMP} />
              <FlagRow label="JavaScript embebido" present={report.hasJavaScript} />
              <FlagRow label="Archivos adjuntos incrustados" present={report.hasEmbeddedFiles} />
              <FlagRow label="Acción automática al abrir (OpenAction)" present={report.hasOpenAction} />
              <FlagRow label="Marcadores (Outlines)" present={report.hasOutlines} />
              <FlagRow label="Idioma declarado (/Lang)" present={report.hasLang} />
              <FlagRow label="Etiquetado de accesibilidad (StructTree)" present={report.hasStructTree} />
              <FlagRow label="Campos de formulario" present={report.hasForm} detail={report.hasForm ? `${report.formFieldCount} campo(s)` : undefined} />
            </div>
          </div>

          <button
            type="button"
            onClick={handleClean}
            disabled={isCleaning || (report.possibleSignature && !sigConfirmed)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="h-3.5 w-3.5" />
            {isCleaning ? 'Limpiando...' : 'Limpiar y descargar'}
          </button>
        </div>
      )}

      {cleanedReady && cleanedReport && report && cleanedSize !== null && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            Verificación del archivo limpio
          </h3>

          <div className="overflow-x-auto">
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-left">
                  <th className="px-2.5 py-1.5 font-semibold">Campo</th>
                  <th className="px-2.5 py-1.5 font-semibold">Original</th>
                  <th className="px-2.5 py-1.5 font-semibold">Limpio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr><td className="px-2.5 py-1.5 text-slate-500">Páginas</td><td className="px-2.5 py-1.5">{report.pageCount}</td><td className="px-2.5 py-1.5">{cleanedReport.pageCount} {cleanedReport.pageCount === report.pageCount ? <CheckCircle2 className="inline h-3 w-3 text-emerald-600 ml-1" /> : <XCircle className="inline h-3 w-3 text-rose-600 ml-1" />}</td></tr>
                <tr><td className="px-2.5 py-1.5 text-slate-500">Tamaño</td><td className="px-2.5 py-1.5">{fmtBytes(report.sizeBytes)}</td><td className="px-2.5 py-1.5">{fmtBytes(cleanedSize)}</td></tr>
                <tr><td className="px-2.5 py-1.5 text-slate-500">Metadatos /Info</td><td className="px-2.5 py-1.5">{infoIsEmpty(report.info) ? 'Ninguno' : 'Presentes'}</td><td className="px-2.5 py-1.5">{infoIsEmpty(cleanedReport.info) ? <span className="text-emerald-700 font-semibold">Ninguno ✓</span> : <span className="text-rose-600 font-semibold">Aún presentes</span>}</td></tr>
                <tr><td className="px-2.5 py-1.5 text-slate-500">XMP</td><td className="px-2.5 py-1.5">{report.hasXMP ? 'Sí' : 'No'}</td><td className="px-2.5 py-1.5">{cleanedReport.hasXMP ? <span className="text-rose-600 font-semibold">Aún presente</span> : <span className="text-emerald-700 font-semibold">Eliminado ✓</span>}</td></tr>
                <tr><td className="px-2.5 py-1.5 text-slate-500">JavaScript / adjuntos</td><td className="px-2.5 py-1.5">{report.hasJavaScript || report.hasEmbeddedFiles ? 'Sí' : 'No'}</td><td className="px-2.5 py-1.5">{cleanedReport.hasJavaScript || cleanedReport.hasEmbeddedFiles ? <span className="text-rose-600 font-semibold">Aún presente</span> : <span className="text-emerald-700 font-semibold">Eliminado ✓</span>}</td></tr>
                <tr><td className="px-2.5 py-1.5 text-slate-500">Revisiones (%%EOF)</td><td className="px-2.5 py-1.5">{report.revisionCount}</td><td className="px-2.5 py-1.5">{cleanedReport.revisionCount}</td></tr>
              </tbody>
            </table>
          </div>

          <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-[11px] text-slate-600 space-y-1.5">
            <p className="font-semibold text-slate-700">Qué se eliminó</p>
            <p>Diccionario /Info completo (autor, título, productor, fechas...), metadatos XMP, JavaScript embebido, adjuntos incrustados, acción automática al abrir, marcadores, idioma declarado y el árbol de etiquetado de accesibilidad.</p>
            <p className="font-semibold text-slate-700 pt-1">Qué se pierde</p>
            <p>El etiquetado de accesibilidad (lectores de pantalla) y los marcadores de navegación, si el PDF los tenía. El contenido visible y el texto de cada página no se tocan.</p>
            <p className="font-semibold text-slate-700 pt-1">Rastros que esto NO elimina</p>
            <p>El nombre del archivo, los atributos del sistema operativo (fecha de creación/modificación en el Finder, no dentro del PDF), ni copias que ya hayas enviado por correo o subido a otro lado. Tampoco se verificó render píxel a píxel entre el original y el limpio, ni se linealizó o se le fijó un /ID determinístico al archivo -- esas partes del proceso no se replicaron aquí.</p>
          </div>
        </div>
      )}
    </div>
  );
};
