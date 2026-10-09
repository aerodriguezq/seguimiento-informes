import React, { useState } from 'react';
import {
  Upload, FileText, AlertTriangle, ShieldAlert, CheckCircle2, Download,
  XCircle, Info, Lock, FolderOpen, ChevronDown, ChevronRight, Archive, Trash2, Image, FileSpreadsheet,
} from 'lucide-react';

// ===================== PDF =====================

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
  kind: 'pdf';
  sizeBytes: number;
  pageCount: number;
  version: string;
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

const PDF_INFO_FIELD_KEYS = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate', 'Trapped'];
const PDF_CATALOG_KEYS_TO_STRIP = ['Metadata', 'OpenAction', 'Names', 'Outlines', 'Lang', 'PieceInfo', 'AA', 'StructTreeRoot', 'MarkInfo'];

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
    kind: 'pdf',
    sizeBytes: bytes.length,
    pageCount: doc.getPageCount(),
    version: versionMatch ? versionMatch[1] : 'desconocida',
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
  PDF_INFO_FIELD_KEYS.forEach((k) => info.delete(PDFName.of(k)));

  const catalog = doc.catalog;
  PDF_CATALOG_KEYS_TO_STRIP.forEach((k) => catalog.delete(PDFName.of(k)));

  // Sin object streams, como se pidió -- pdf-lib no soporta linealizar
  // ni fijar un /ID determinístico, eso no se puede replicar aquí.
  return doc.save({ useObjectStreams: false });
}

// ===================== PNG =====================

type PngReport = {
  kind: 'png';
  sizeBytes: number;
  width: number;
  height: number;
  textKeywords: string[];
  hasExif: boolean;
  hasTimeChunk: boolean;
};

type PngChunk = { type: string; data: Uint8Array };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_METADATA_CHUNKS_TO_STRIP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

function parsePngChunks(bytes: Uint8Array): PngChunk[] {
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error('No es un PNG válido (firma de archivo incorrecta).');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: PngChunk[] = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const dataStart = offset + 8;
    const data = bytes.slice(dataStart, dataStart + length);
    chunks.push({ type, data });
    offset = dataStart + length + 4; // +4 salta el CRC
    if (type === 'IEND') break;
  }
  return chunks;
}

// CRC-32 estándar (el mismo que usa PNG) -- necesario para reescribir cada
// chunk con un checksum válido, o los visores lo marcan como corrupto.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function rebuildPng(chunks: PngChunk[]): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array(PNG_SIGNATURE)];
  for (const chunk of chunks) {
    const typeBytes = new Uint8Array(chunk.type.split('').map((c) => c.charCodeAt(0)));
    const lengthBuf = new Uint8Array(4);
    new DataView(lengthBuf.buffer).setUint32(0, chunk.data.length);
    const crcInput = new Uint8Array(typeBytes.length + chunk.data.length);
    crcInput.set(typeBytes, 0);
    crcInput.set(chunk.data, typeBytes.length);
    const crcBuf = new Uint8Array(4);
    new DataView(crcBuf.buffer).setUint32(0, crc32(crcInput));
    parts.push(lengthBuf, typeBytes, chunk.data, crcBuf);
  }
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

function analyzePng(bytes: Uint8Array): PngReport {
  const chunks = parsePngChunks(bytes);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  const view = ihdr ? new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength) : null;
  const textKeywords = chunks
    .filter((c) => c.type === 'tEXt' || c.type === 'zTXt' || c.type === 'iTXt')
    .map((c) => {
      const nullIdx = c.data.indexOf(0);
      const keyword = nullIdx > 0 ? new TextDecoder('latin1').decode(c.data.slice(0, nullIdx)) : '(desconocido)';
      return `${keyword} (${c.type})`;
    });

  return {
    kind: 'png',
    sizeBytes: bytes.length,
    width: view ? view.getUint32(0) : 0,
    height: view ? view.getUint32(4) : 0,
    textKeywords,
    hasExif: chunks.some((c) => c.type === 'eXIf'),
    hasTimeChunk: chunks.some((c) => c.type === 'tIME'),
  };
}

function cleanPng(bytes: Uint8Array): Uint8Array {
  const chunks = parsePngChunks(bytes);
  const kept = chunks.filter((c) => !PNG_METADATA_CHUNKS_TO_STRIP.has(c.type));
  return rebuildPng(kept);
}

// ===================== XLSX =====================

type XlsxReport = {
  kind: 'xlsx';
  sizeBytes: number;
  creator: string | null;
  lastModifiedBy: string | null;
  created: string | null;
  modified: string | null;
  title: string | null;
  subject: string | null;
  description: string | null;
  keywords: string | null;
  category: string | null;
  company: string | null;
  manager: string | null;
  hasCustomProps: boolean;
};

const XLSX_CORE_TAGS: Array<keyof Omit<XlsxReport, 'kind' | 'sizeBytes' | 'company' | 'manager' | 'hasCustomProps'>> = [
  'creator', 'lastModifiedBy', 'created', 'modified', 'title', 'subject', 'description', 'keywords', 'category',
];
const XLSX_CORE_TAG_NAMES: Record<string, string[]> = {
  creator: ['dc:creator', 'creator'],
  lastModifiedBy: ['cp:lastModifiedBy', 'lastModifiedBy'],
  created: ['dcterms:created', 'created'],
  modified: ['dcterms:modified', 'modified'],
  title: ['dc:title', 'title'],
  subject: ['dc:subject', 'subject'],
  description: ['dc:description', 'description'],
  keywords: ['cp:keywords', 'keywords'],
  category: ['cp:category', 'category'],
};

function getXmlText(doc: Document, tagNames: string[]): string | null {
  for (const tag of tagNames) {
    const el = doc.getElementsByTagName(tag)[0];
    if (el?.textContent) return el.textContent;
  }
  return null;
}

async function analyzeXlsx(bytes: Uint8Array): Promise<XlsxReport> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(bytes);
  const parser = new DOMParser();

  const coreFile = zip.file('docProps/core.xml');
  const coreValues: Record<string, string | null> = {};
  if (coreFile) {
    const doc = parser.parseFromString(await coreFile.async('text'), 'application/xml');
    for (const key of XLSX_CORE_TAGS) coreValues[key] = getXmlText(doc, XLSX_CORE_TAG_NAMES[key]);
  }

  let company: string | null = null;
  let manager: string | null = null;
  const appFile = zip.file('docProps/app.xml');
  if (appFile) {
    const doc = parser.parseFromString(await appFile.async('text'), 'application/xml');
    company = getXmlText(doc, ['Company']);
    manager = getXmlText(doc, ['Manager']);
  }

  return {
    kind: 'xlsx',
    sizeBytes: bytes.length,
    creator: coreValues.creator ?? null,
    lastModifiedBy: coreValues.lastModifiedBy ?? null,
    created: coreValues.created ?? null,
    modified: coreValues.modified ?? null,
    title: coreValues.title ?? null,
    subject: coreValues.subject ?? null,
    description: coreValues.description ?? null,
    keywords: coreValues.keywords ?? null,
    category: coreValues.category ?? null,
    company,
    manager,
    hasCustomProps: !!zip.file('docProps/custom.xml'),
  };
}

async function cleanXlsx(bytes: Uint8Array): Promise<Uint8Array> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(bytes);
  const parser = new DOMParser();
  const serializer = new XMLSerializer();

  const blankTags = (xml: string, tagGroups: string[][]): string => {
    const doc = parser.parseFromString(xml, 'application/xml');
    for (const tags of tagGroups) {
      for (const tag of tags) {
        const el = doc.getElementsByTagName(tag)[0];
        if (el) el.textContent = '';
      }
    }
    return serializer.serializeToString(doc);
  };

  const coreFile = zip.file('docProps/core.xml');
  if (coreFile) {
    const xml = await coreFile.async('text');
    zip.file('docProps/core.xml', blankTags(xml, Object.values(XLSX_CORE_TAG_NAMES)));
  }

  const appFile = zip.file('docProps/app.xml');
  if (appFile) {
    const xml = await appFile.async('text');
    zip.file('docProps/app.xml', blankTags(xml, [['Company'], ['Manager']]));
  }

  // docProps/custom.xml no se borra (eso rompería las referencias en
  // [Content_Types].xml y _rels) -- se vacía el valor de cada propiedad
  // personalizada, dejando la estructura del archivo intacta.
  const customFile = zip.file('docProps/custom.xml');
  if (customFile) {
    const xml = await customFile.async('text');
    const doc = parser.parseFromString(xml, 'application/xml');
    const properties = Array.from(doc.getElementsByTagName('property'));
    for (const prop of properties) {
      for (let i = 0; i < prop.children.length; i++) prop.children[i].textContent = '';
    }
    zip.file('docProps/custom.xml', serializer.serializeToString(doc));
  }

  return zip.generateAsync({ type: 'uint8array' });
}

// ===================== Compartido =====================

type FileKind = 'pdf' | 'png' | 'xlsx';
type AnyReport = PdfReport | PngReport | XlsxReport;

function detectKind(file: File): FileKind | null {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (file.type === 'image/png' || name.endsWith('.png')) return 'png';
  if (name.endsWith('.xlsx') || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx';
  return null;
}

const KIND_LABEL: Record<FileKind, string> = { pdf: 'PDF', png: 'PNG', xlsx: 'Excel' };
const KIND_ICON: Record<FileKind, React.ElementType> = { pdf: FileText, png: Image, xlsx: FileSpreadsheet };
const KIND_EXT: Record<FileKind, string> = { pdf: '.pdf', png: '.png', xlsx: '.xlsx' };

async function analyzeByKind(kind: FileKind, bytes: Uint8Array): Promise<AnyReport> {
  if (kind === 'pdf') return analyzePdf(bytes);
  if (kind === 'png') return analyzePng(bytes);
  return analyzeXlsx(bytes);
}

async function cleanByKind(kind: FileKind, bytes: Uint8Array): Promise<Uint8Array> {
  if (kind === 'pdf') return cleanPdf(bytes);
  if (kind === 'png') return cleanPng(bytes);
  return cleanXlsx(bytes);
}

function countTraces(report: AnyReport): number {
  if (report.kind === 'pdf') {
    return [report.hasXMP, report.hasJavaScript, report.hasEmbeddedFiles, report.hasOpenAction, report.hasOutlines, report.hasStructTree, report.hasLang]
      .filter(Boolean).length + (Object.values(report.info).some((v) => v) ? 1 : 0);
  }
  if (report.kind === 'png') {
    return report.textKeywords.length + (report.hasExif ? 1 : 0) + (report.hasTimeChunk ? 1 : 0);
  }
  return [report.creator, report.lastModifiedBy, report.created, report.modified, report.title, report.subject, report.description, report.keywords, report.category, report.company, report.manager]
    .filter((v) => v).length + (report.hasCustomProps ? 1 : 0);
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// Camina recursivamente las entradas que entrega el drag-and-drop (incluye
// carpetas completas) -- la API nativa del navegador solo da acceso a esto
// vía DataTransferItem.webkitGetAsEntry(), con lectura de directorios
// paginada (readEntries devuelve como mucho ~100 por llamada).
async function readDroppedEntries(items: DataTransferItemList): Promise<{ file: File; relativePath: string }[]> {
  const results: { file: File; relativePath: string }[] = [];
  const topEntries: any[] = [];
  for (let i = 0; i < items.length; i++) {
    const entry = (items[i] as any).webkitGetAsEntry?.();
    if (entry) topEntries.push(entry);
  }

  const walk = async (entry: any, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
      results.push({ file, relativePath: `${prefix}${entry.name}` });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const readBatch = (): Promise<any[]> => new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      let batch = await readBatch();
      while (batch.length > 0) {
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
        batch = await readBatch();
      }
    }
  };

  for (const entry of topEntries) await walk(entry, '');
  return results;
}

type ItemStatus = 'pending' | 'analyzing' | 'analyzed' | 'cleaning' | 'cleaned' | 'error';

type FileItem = {
  id: string;
  file: File;
  relativePath: string;
  kind: FileKind;
  status: ItemStatus;
  report: AnyReport | null;
  cleanedReport: AnyReport | null;
  cleanedBytes: Uint8Array | null;
  sigConfirmed: boolean;
  error: string | null;
};

const FlagRow: React.FC<{ label: string; present: boolean; detail?: string }> = ({ label, present, detail }) => (
  <div className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
    <span className="text-slate-600">{label}</span>
    <span className={`inline-flex items-center gap-1 font-semibold ${present ? 'text-amber-700' : 'text-emerald-700'}`}>
      {present ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
      {present ? (detail || 'Presente') : 'No'}
    </span>
  </div>
);

function downloadBytes(bytes: Uint8Array, fileName: string, mimeType: string) {
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

const KIND_MIME: Record<FileKind, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function cleanedFileName(relativePath: string, kind: FileKind): string {
  const parts = relativePath.split('/');
  const base = parts.pop() || relativePath;
  const ext = KIND_EXT[kind];
  const withoutExt = base.replace(new RegExp(`\\${ext}$`, 'i'), '');
  return [...parts, `${withoutExt}_limpio${ext}`].join('/');
}

export const FileCleanerView: React.FC = () => {
  const [items, setItems] = useState<FileItem[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [isBulkWorking, setIsBulkWorking] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [selectionNote, setSelectionNote] = useState('');
  const dragCounterRef = React.useRef(0);

  const updateItem = (id: string, patch: Partial<FileItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const analyzeOne = async (id: string, file: File, kind: FileKind) => {
    updateItem(id, { status: 'analyzing' });
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const report = await analyzeByKind(kind, bytes);
      updateItem(id, { status: 'analyzed', report });
    } catch (err) {
      updateItem(id, { status: 'error', error: err instanceof Error ? err.message : 'No fue posible leer el archivo.' });
    }
  };

  const addFiles = (incoming: { file: File; relativePath: string }[]) => {
    if (incoming.length === 0) {
      setSelectionNote('No se detectó ningún archivo en lo que seleccionaste o arrastraste.');
      return;
    }
    const withKind = incoming.map((f) => ({ ...f, kind: detectKind(f.file) }));
    const supported = withKind.filter((f): f is typeof f & { kind: FileKind } => f.kind !== null);
    if (supported.length === 0) {
      setSelectionNote(`Se revisaron ${incoming.length} elemento(s), pero ninguno es un formato soportado (PDF, PNG o Excel .xlsx).`);
      return;
    }
    setSelectionNote(
      supported.length < incoming.length
        ? `Se agregaron ${supported.length} de ${incoming.length} elemento(s) -- el resto no es PDF, PNG ni Excel (.xlsx).`
        : '',
    );
    const newItems: FileItem[] = supported.map((f) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file: f.file,
      relativePath: f.relativePath || f.file.name,
      kind: f.kind,
      status: 'pending',
      report: null,
      cleanedReport: null,
      cleanedBytes: null,
      sigConfirmed: false,
      error: null,
    }));
    setItems((prev) => [...prev, ...newItems]);
    newItems.forEach((it) => void analyzeOne(it.id, it.file, it.kind));
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    addFiles(files.map((file: File) => ({ file, relativePath: (file as any).webkitRelativePath || file.name })));
  };

  const handleDragEnter = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    if (!e.dataTransfer.types.includes('Files')) return;
    dragCounterRef.current += 1;
    setIsDragging(true);
  };

  const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0 && (e.dataTransfer.items[0] as any).webkitGetAsEntry) {
      const entries = await readDroppedEntries(e.dataTransfer.items);
      addFiles(entries);
    } else {
      const files = Array.from(e.dataTransfer.files || []);
      addFiles(files.map((file: File) => ({ file, relativePath: file.name })));
    }
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const cleanAndStore = async (item: FileItem) => {
    updateItem(item.id, { status: 'cleaning' });
    try {
      const buffer = await item.file.arrayBuffer();
      const cleaned = await cleanByKind(item.kind, new Uint8Array(buffer));
      const verified = await analyzeByKind(item.kind, cleaned);
      updateItem(item.id, { status: 'cleaned', cleanedBytes: cleaned, cleanedReport: verified });
      return cleaned;
    } catch (err) {
      updateItem(item.id, { status: 'error', error: err instanceof Error ? err.message : 'No fue posible limpiar el archivo.' });
      return null;
    }
  };

  const handleCleanOne = async (item: FileItem) => {
    if (!item.report) return;
    if (item.report.kind === 'pdf' && item.report.possibleSignature && !item.sigConfirmed) return;
    const cleaned = await cleanAndStore(item);
    if (cleaned) downloadBytes(cleaned, cleanedFileName(item.relativePath, item.kind).split('/').pop()!, KIND_MIME[item.kind]);
  };

  const handleCleanAllPending = async () => {
    setIsBulkWorking(true);
    try {
      for (const item of items) {
        if (item.status !== 'analyzed' || !item.report) continue;
        if (item.report.kind === 'pdf' && item.report.possibleSignature && !item.sigConfirmed) continue;
        await cleanAndStore(item);
      }
    } finally {
      setIsBulkWorking(false);
    }
  };

  const handleDownloadZip = async () => {
    const cleanedItems = items.filter((it) => it.status === 'cleaned' && it.cleanedBytes);
    if (cleanedItems.length === 0) return;
    setIsZipping(true);
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      cleanedItems.forEach((it) => {
        zip.file(cleanedFileName(it.relativePath, it.kind), it.cleanedBytes as Uint8Array);
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `documentos_limpios_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } finally {
      setIsZipping(false);
    }
  };

  const handleRemoveItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleClearAll = () => {
    setItems([]);
    setExpandedIds(new Set());
  };

  const pendingCount = items.filter((it) => it.status === 'analyzed').length;
  const cleanedCount = items.filter((it) => it.status === 'cleaned').length;

  const STATUS_BADGE: Record<ItemStatus, { label: string; className: string }> = {
    pending: { label: 'En cola', className: 'bg-slate-100 text-slate-500' },
    analyzing: { label: 'Analizando...', className: 'bg-indigo-50 text-indigo-700' },
    analyzed: { label: 'Analizado', className: 'bg-slate-100 text-slate-600' },
    cleaning: { label: 'Limpiando...', className: 'bg-indigo-50 text-indigo-700' },
    cleaned: { label: 'Limpio', className: 'bg-emerald-50 text-emerald-700' },
    error: { label: 'Error', className: 'bg-rose-50 text-rose-700' },
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-10">
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg shrink-0 bg-slate-100 text-slate-700">
            <FileText className="h-4.5 w-4.5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Limpieza de Metadatos de Archivos</h2>
            <p className="text-[11px] text-slate-500">
              Sube uno o varios archivos (o una carpeta completa), revisa qué metadatos traen y descarga copias limpias. Todo corre en tu navegador -- los archivos nunca se suben a ningún servidor.
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5 text-[11px] text-slate-600 flex items-start gap-1.5">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-slate-400" />
          <span>
            Procesa <strong>PDF</strong>, <strong>PNG</strong> y <strong>Excel (.xlsx)</strong>. En cada uno limpia solo los metadatos (autor, fechas, software, comentarios, etc.) -- no valida el contenido del documento (nombres, cédulas, porcentajes, etc.), eso depende de cada tipo de documento y no se puede generalizar.
          </span>
        </div>

        <label
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`mt-4 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed transition-colors px-6 py-8 cursor-pointer ${
            isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40'
          }`}
        >
          <Upload className={`h-6 w-6 ${isDragging ? 'text-indigo-500' : 'text-slate-400'}`} />
          <span className="text-xs font-semibold text-slate-700">
            {items.length > 0 ? `${items.length} archivo(s) agregado(s)` : 'Elegir archivos (PDF, PNG, Excel)'}
          </span>
          <span className="text-[10.5px] text-slate-400">
            {isDragging ? 'Suelta aquí (archivos o carpetas completas)' : 'Arrastra archivos o una carpeta completa, o haz clic para elegir'}
          </span>
          <input
            type="file"
            accept="application/pdf,.pdf,image/png,.png,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            multiple
            className="hidden"
            onChange={handleFileInputChange}
          />
        </label>

        <div className="mt-2.5 flex items-center justify-center">
          <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-indigo-700 hover:text-indigo-800 cursor-pointer">
            <FolderOpen className="h-3.5 w-3.5" />
            O elegir una carpeta completa
            <input
              type="file"
              className="hidden"
              onChange={handleFileInputChange}
              {...({ webkitdirectory: '', directory: '', mozdirectory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
            />
          </label>
        </div>

        {selectionNote && (
          <p className="mt-3 text-[11px] text-rose-600">{selectionNote}</p>
        )}
      </div>

      {items.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Archivos ({items.length})
            </h3>
            <div className="flex items-center gap-2">
              {pendingCount > 0 && (
                <button
                  type="button"
                  onClick={handleCleanAllPending}
                  disabled={isBulkWorking}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  {isBulkWorking ? 'Limpiando...' : `Limpiar ${pendingCount} pendiente(s)`}
                </button>
              )}
              {cleanedCount > 1 && (
                <button
                  type="button"
                  onClick={handleDownloadZip}
                  disabled={isZipping}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-indigo-700 border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 rounded-lg disabled:opacity-50"
                >
                  <Archive className="h-3.5 w-3.5" />
                  {isZipping ? 'Comprimiendo...' : `Descargar ${cleanedCount} en ZIP`}
                </button>
              )}
              <button
                type="button"
                onClick={handleClearAll}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-slate-500 hover:text-rose-600 rounded-lg"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Limpiar lista
              </button>
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {items.map((item) => {
              const isExpanded = expandedIds.has(item.id);
              const badge = STATUS_BADGE[item.status];
              const KindIcon = KIND_ICON[item.kind];
              return (
                <div key={item.id} className="py-2.5">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(item.id)}
                      disabled={!item.report}
                      className="shrink-0 text-slate-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-default"
                    >
                      {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </button>
                    <KindIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-slate-800 truncate" title={item.relativePath}>{item.relativePath}</p>
                      {item.report && (
                        <p className="text-[10.5px] text-slate-400">
                          {KIND_LABEL[item.kind]}
                          {item.report.kind === 'pdf' && ` · ${item.report.pageCount} pág.`}
                          {item.report.kind === 'png' && ` · ${item.report.width}×${item.report.height}`}
                          {` · ${fmtBytes(item.report.sizeBytes)}`}
                          {countTraces(item.report) > 0 && ` · ${countTraces(item.report)} rastro(s)`}
                          {item.report.kind === 'pdf' && item.report.possibleSignature && ' · posible firma digital'}
                        </p>
                      )}
                      {item.error && <p className="text-[10.5px] text-rose-600">{item.error}</p>}
                    </div>
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${badge.className}`}>{badge.label}</span>
                    {item.status === 'cleaned' && item.cleanedBytes && (
                      <button
                        type="button"
                        onClick={() => downloadBytes(item.cleanedBytes as Uint8Array, cleanedFileName(item.relativePath, item.kind).split('/').pop()!, KIND_MIME[item.kind])}
                        className="shrink-0 text-indigo-600 hover:text-indigo-800"
                        title="Descargar de nuevo"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(item.id)}
                      className="shrink-0 text-slate-300 hover:text-rose-600"
                      title="Quitar de la lista"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {isExpanded && item.report && (
                    <div className="mt-3 ml-5 space-y-3 rounded-lg bg-slate-50 border border-slate-100 p-3">
                      {item.report.kind === 'pdf' && (
                        <>
                          {item.report.encrypted && (
                            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-800 flex items-start gap-1.5">
                              <Lock className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                              <span>Este PDF parece estar cifrado/protegido. La limpieza puede no funcionar de forma confiable sobre contenido cifrado.</span>
                            </div>
                          )}

                          {item.report.possibleSignature && (
                            <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2.5 text-[11px] text-rose-800 space-y-2">
                              <div className="flex items-start gap-1.5 font-semibold">
                                <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                <span>Se detectó un posible rastro de firma digital (/Type /Sig o /ByteRange). Limpiar este archivo probablemente invalide esa firma.</span>
                              </div>
                              <label className="flex items-center gap-2 cursor-pointer pl-5">
                                <input
                                  type="checkbox"
                                  checked={item.sigConfirmed}
                                  onChange={(e) => updateItem(item.id, { sigConfirmed: e.target.checked })}
                                  className="rounded"
                                />
                                <span>Entiendo el riesgo y quiero limpiar este archivo de todas formas.</span>
                              </label>
                            </div>
                          )}

                          <div>
                            <p className="text-[11px] font-semibold text-slate-600 mb-1.5">Metadatos encontrados (diccionario /Info)</p>
                            {Object.values(item.report.info).every((v) => !v) ? (
                              <p className="text-[11px] italic text-slate-400">Ninguno.</p>
                            ) : (
                              <div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100 text-[11px]">
                                {Object.entries(item.report.info).filter(([, v]) => v).map(([k, v]) => (
                                  <div key={k} className="flex items-start justify-between gap-3 px-2.5 py-1.5">
                                    <span className="text-slate-500 shrink-0">{k}</span>
                                    <span className="text-slate-800 text-right break-all">{v}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="bg-white rounded-lg border border-slate-200 px-2.5">
                            <FlagRow label="Metadatos XMP" present={item.report.hasXMP} />
                            <FlagRow label="JavaScript embebido" present={item.report.hasJavaScript} />
                            <FlagRow label="Archivos adjuntos incrustados" present={item.report.hasEmbeddedFiles} />
                            <FlagRow label="Acción automática al abrir (OpenAction)" present={item.report.hasOpenAction} />
                            <FlagRow label="Marcadores (Outlines)" present={item.report.hasOutlines} />
                            <FlagRow label="Idioma declarado (/Lang)" present={item.report.hasLang} />
                            <FlagRow label="Etiquetado de accesibilidad (StructTree)" present={item.report.hasStructTree} />
                            <FlagRow label="Campos de formulario" present={item.report.hasForm} detail={item.report.hasForm ? `${item.report.formFieldCount} campo(s)` : undefined} />
                          </div>
                        </>
                      )}

                      {item.report.kind === 'png' && (
                        <>
                          <div className="bg-white rounded-lg border border-slate-200 px-2.5">
                            <FlagRow label="EXIF (cámara, GPS, fecha)" present={item.report.hasExif} />
                            <FlagRow label="Marca de tiempo (tIME)" present={item.report.hasTimeChunk} />
                            <FlagRow label="Texto/comentarios/XMP incrustado" present={item.report.textKeywords.length > 0} detail={item.report.textKeywords.length > 0 ? `${item.report.textKeywords.length} bloque(s)` : undefined} />
                          </div>
                          {item.report.textKeywords.length > 0 && (
                            <div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100 text-[11px]">
                              {item.report.textKeywords.map((k, idx) => (
                                <div key={idx} className="px-2.5 py-1.5 text-slate-700">{k}</div>
                              ))}
                            </div>
                          )}
                        </>
                      )}

                      {item.report.kind === 'xlsx' && (
                        <div>
                          <p className="text-[11px] font-semibold text-slate-600 mb-1.5">Propiedades del documento</p>
                          {[
                            ['Autor', item.report.creator], ['Última modificación por', item.report.lastModifiedBy],
                            ['Creado', item.report.created], ['Modificado', item.report.modified],
                            ['Título', item.report.title], ['Asunto', item.report.subject],
                            ['Descripción', item.report.description], ['Palabras clave', item.report.keywords],
                            ['Categoría', item.report.category], ['Empresa', item.report.company], ['Administrador', item.report.manager],
                          ].filter(([, v]) => v).length === 0 && !item.report.hasCustomProps ? (
                            <p className="text-[11px] italic text-slate-400">Ninguna.</p>
                          ) : (
                            <div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100 text-[11px]">
                              {[
                                ['Autor', item.report.creator], ['Última modificación por', item.report.lastModifiedBy],
                                ['Creado', item.report.created], ['Modificado', item.report.modified],
                                ['Título', item.report.title], ['Asunto', item.report.subject],
                                ['Descripción', item.report.description], ['Palabras clave', item.report.keywords],
                                ['Categoría', item.report.category], ['Empresa', item.report.company], ['Administrador', item.report.manager],
                              ].filter(([, v]) => v).map(([k, v]) => (
                                <div key={k as string} className="flex items-start justify-between gap-3 px-2.5 py-1.5">
                                  <span className="text-slate-500 shrink-0">{k}</span>
                                  <span className="text-slate-800 text-right break-all">{v}</span>
                                </div>
                              ))}
                              {item.report.hasCustomProps && (
                                <div className="px-2.5 py-1.5 text-amber-700">Tiene propiedades personalizadas adicionales</div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {item.status === 'cleaned' && item.cleanedReport ? (
                        <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-[11px] text-emerald-800 flex items-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                          <span>
                            Limpio: {fmtBytes(item.cleanedReport.sizeBytes)}
                            {countTraces(item.cleanedReport) === 0 ? ' · sin rastros de metadatos' : ` · ${countTraces(item.cleanedReport)} rastro(s) restante(s)`}
                          </span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleCleanOne(item)}
                          disabled={item.status === 'cleaning' || (item.report.kind === 'pdf' && item.report.possibleSignature && !item.sigConfirmed)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Download className="h-3 w-3" />
                          {item.status === 'cleaning' ? 'Limpiando...' : 'Limpiar y descargar este archivo'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-[11px] text-slate-600 space-y-1">
            <p className="font-semibold text-slate-700">Qué se elimina de cada tipo de archivo</p>
            <p><strong>PDF:</strong> diccionario /Info completo (autor, título, productor, fechas...), metadatos XMP, JavaScript embebido, adjuntos incrustados, acción automática al abrir, marcadores, idioma declarado y el árbol de etiquetado de accesibilidad.</p>
            <p><strong>PNG:</strong> bloques EXIF (cámara, GPS, fecha), marca de tiempo y cualquier texto/comentario/XMP incrustado.</p>
            <p><strong>Excel (.xlsx):</strong> autor, última persona que modificó, fechas de creación/modificación, título, asunto, descripción, palabras clave, categoría, empresa, administrador, y el valor de las propiedades personalizadas.</p>
            <p className="pt-1">En los tres casos, el contenido visible (texto, imagen, celdas) no se toca.</p>
            <p className="font-semibold text-slate-700 pt-1">Rastros que esto NO elimina</p>
            <p>El nombre del archivo, los atributos del sistema operativo, ni copias ya enviadas por correo o subidas a otro lado. No se verifica render píxel a píxel entre el original y el limpio.</p>
          </div>
        </div>
      )}
    </div>
  );
};
