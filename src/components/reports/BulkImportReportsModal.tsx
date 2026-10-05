import React, { useState } from 'react';
import { Project, ReportType } from '../../types';
import { MONTHS_LIST } from '../../data/mockData';
import { X, Download, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle } from 'lucide-react';

const VALID_STATUSES = ['Pendientes Evidencias', 'Informe en Elaboración', 'Entregado a Of. Proyectos', 'Enviado'];

type RowResult = { row: number; status: 'created' | 'error'; message?: string; consecutive?: string };
type ImportResult = { created: number; errors: number; results: RowResult[] };

export const BulkImportReportsModal: React.FC<{
  projects: Project[];
  reportTypes: ReportType[];
  onClose: () => void;
  onImported: () => Promise<void>;
}> = ({ projects, reportTypes, onClose, onImported }) => {
  const [parsedRows, setParsedRows] = useState<Record<string, unknown>[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const handleDownloadTemplate = async () => {
    const XLSX = await import('xlsx');

    const exampleRow = {
      BPIN: projects[0]?.bpin ?? '20241301010175',
      Proyecto: projects[0]?.name ?? '',
      'Código Tipo Informe': reportTypes[0]?.code ?? 'INF',
      Mes: 'Septiembre',
      Año: 2026,
      'Fecha Límite': '2026-10-10',
      Estado: 'Enviado',
      Consecutivo: '',
      'Responsables (correos separados por coma)': '',
      Observaciones: '',
    };
    const informesSheet = XLSX.utils.json_to_sheet([exampleRow]);
    informesSheet['!cols'] = [{ wch: 18 }, { wch: 28 }, { wch: 20 }, { wch: 14 }, { wch: 8 }, { wch: 14 }, { wch: 24 }, { wch: 16 }, { wch: 36 }, { wch: 30 }];

    const projectsSheet = XLSX.utils.json_to_sheet(
      projects.map((p) => ({ BPIN: p.bpin, Proyecto: p.name, Empresa: p.company })),
    );
    projectsSheet['!cols'] = [{ wch: 18 }, { wch: 30 }, { wch: 20 }];

    const typesSheet = XLSX.utils.json_to_sheet(
      reportTypes.map((t) => ({ Código: t.code, 'Tipo de Informe': t.name, Periodicidad: t.periodicity })),
    );
    typesSheet['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 14 }];

    const referenceSheet = XLSX.utils.json_to_sheet([
      { Campo: 'BPIN / Proyecto', 'Valores válidos': 'Da al menos uno de los dos -- si falta el BPIN, se busca por el nombre exacto del proyecto.' },
      { Campo: 'Mes', 'Valores válidos': MONTHS_LIST.join(', ') },
      { Campo: 'Estado', 'Valores válidos': VALID_STATUSES.join(', ') },
      { Campo: 'Fecha Límite', 'Valores válidos': 'Formato AAAA-MM-DD, ej. 2026-10-10' },
      { Campo: 'Consecutivo', 'Valores válidos': 'Opcional -- el número real que ya se usó antes del sistema (ej. en el documento entregado), para darle continuidad a la numeración. Si se deja vacío, se calcula solo como con "Nuevo Informe".' },
    ]);
    referenceSheet['!cols'] = [{ wch: 16 }, { wch: 90 }];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, informesSheet, 'Informes');
    XLSX.utils.book_append_sheet(workbook, projectsSheet, 'Proyectos (BPIN)');
    XLSX.utils.book_append_sheet(workbook, typesSheet, 'Tipos de Informe (Código)');
    XLSX.utils.book_append_sheet(workbook, referenceSheet, 'Valores válidos');
    XLSX.writeFile(workbook, 'plantilla_informes_anteriores.xlsx');
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setParseError('');
    setResult(null);
    setFileName(file.name);
    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheetName = workbook.SheetNames.includes('Informes') ? 'Informes' : workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: false, defval: '' });
      if (rows.length === 0) {
        setParseError('La hoja "Informes" no tiene filas con datos.');
        setParsedRows(null);
        return;
      }
      setParsedRows(rows);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : 'No fue posible leer el archivo.');
      setParsedRows(null);
    }
  };

  const handleImport = async () => {
    if (!parsedRows || parsedRows.length === 0) return;
    setIsImporting(true);
    setParseError('');
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bulkImportReports', rows: parsedRows }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.errors?.[0] || 'No fue posible importar los informes.');
      setResult(payload.data);
      if (payload.data.created > 0) await onImported();
    } catch (error) {
      setParseError(error instanceof Error ? error.message : 'No fue posible importar los informes.');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Cargar informes anteriores</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">Carga masiva de informes ya ocurridos, para dejarlos en el historial.</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          <div className="rounded-lg border border-slate-200 p-3 space-y-2">
            <p className="font-semibold text-slate-700">1. Descarga la plantilla</p>
            <p className="text-[11px] text-slate-500">
              Incluye la hoja "Informes" para llenar, más hojas de referencia con los BPIN de tus proyectos, los códigos de tipo de informe y los valores válidos de mes/estado.
            </p>
            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
            >
              <Download className="h-3.5 w-3.5" />
              Descargar plantilla
            </button>
          </div>

          <div className="rounded-lg border border-slate-200 p-3 space-y-2">
            <p className="font-semibold text-slate-700">2. Sube el archivo lleno</p>
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50">
              <Upload className="h-3.5 w-3.5" />
              {fileName || 'Elegir archivo .xlsx'}
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
            </label>
            {parsedRows && (
              <p className="text-[11px] text-emerald-700 flex items-center gap-1">
                <FileSpreadsheet className="h-3.5 w-3.5" />
                {parsedRows.length} fila(s) leída(s) de "{fileName}".
              </p>
            )}
            {parseError && <p className="text-[11px] text-rose-600">{parseError}</p>}
          </div>

          {parsedRows && !result && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleImport}
                disabled={isImporting}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50"
              >
                {isImporting ? 'Importando...' : `Importar ${parsedRows.length} informe(s)`}
              </button>
            </div>
          )}

          {result && (
            <div className="rounded-lg border border-slate-200 p-3 space-y-2">
              <div className="flex items-center gap-4">
                <span className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {result.created} creado(s)
                </span>
                {result.errors > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-rose-600 font-semibold">
                    <AlertTriangle className="h-3.5 w-3.5" /> {result.errors} con error
                  </span>
                )}
              </div>
              {result.errors > 0 && (
                <div className="max-h-48 overflow-y-auto rounded-lg border border-rose-100 bg-rose-50 divide-y divide-rose-100">
                  {result.results.filter((r) => r.status === 'error').map((r) => (
                    <p key={r.row} className="px-2.5 py-1.5 text-[11px] text-rose-700">
                      Fila {r.row}: {r.message}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
