import React, { useState } from 'react';
import { Project, ReportType } from '../../types';
import { MONTHS_LIST } from '../../data/mockData';
import { X, Download, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Info } from 'lucide-react';

const VALID_STATUSES = ['Pendientes Evidencias', 'Informe en Elaboración', 'Entregado a Of. Proyectos', 'Enviado'];

// Columna "ancla" que marca una fila como ejemplo -- se llenan 3 filas de
// ejemplo justo debajo del encabezado, y se filtran solas antes de
// importar (el usuario no tiene que acordarse de borrarlas).
const EXAMPLE_MARKER_HEADER = 'EJEMPLO (no tocar / no tiene que estar lleno en tus filas)';
const EXAMPLE_MARKER_VALUE = 'SÍ — fila de ejemplo, ignorada al importar';

const INFORMES_HEADERS = [
  EXAMPLE_MARKER_HEADER,
  'Proyecto',
  'BPIN (se llena solo al escribir el Proyecto)',
  'Tipo de Informe',
  'Código Tipo Informe (se llena solo al escribir el Tipo)',
  'Mes',
  'Año',
  'Fecha Límite (AAAA-MM-DD)',
  'Estado',
  'Consecutivo (opcional)',
  'Responsables (correos separados por coma)',
  'Observaciones',
];

type RowResult = { row: number; status: 'created' | 'error'; message?: string; consecutive?: string };
type ImportResult = { created: number; errors: number; results: RowResult[] };

export const BulkImportReportsModal: React.FC<{
  projects: Project[];
  reportTypes: ReportType[];
  onClose: () => void;
  onImported: () => Promise<void>;
}> = ({ projects, reportTypes, onClose, onImported }) => {
  const [parsedRows, setParsedRows] = useState<Record<string, unknown>[] | null>(null);
  // Fila real en el Excel de origen de cada parsedRows[i] -- se guarda
  // aparte porque filtrar ejemplos/filas vacías corre las posiciones.
  const [excelRowNumbers, setExcelRowNumbers] = useState<number[]>([]);
  const [skippedExampleCount, setSkippedExampleCount] = useState(0);
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const handleDownloadTemplate = async () => {
    const XLSX = await import('xlsx');

    // --- Hoja "Informes": encabezado + 3 filas de ejemplo bien variadas +
    // columnas de BPIN / Código que se calculan solas con VLOOKUP contra
    // las hojas de referencia, a partir de lo que se escriba en
    // "Proyecto" / "Tipo de Informe".
    const exampleProject = projects[0]?.name ?? 'Montes de Maria';
    const otherProject = projects[1]?.name ?? projects[0]?.name ?? 'Montes de Maria';
    const exampleType = reportTypes[0]?.name ?? 'Informe Técnico';
    const otherType = reportTypes[1]?.name ?? reportTypes[0]?.name ?? 'Informe Técnico';

    const exampleRows: (string | number)[][] = [
      [EXAMPLE_MARKER_VALUE, exampleProject, '', exampleType, '', 'Septiembre', 2026, '2026-10-10', 'Enviado', '', 'responsable1@correo.com, responsable2@correo.com', 'Informe entregado a tiempo, radicado en físico.'],
      [EXAMPLE_MARKER_VALUE, otherProject, '', otherType, '', 'Agosto', 2026, '2026-09-08', 'Entregado a Of. Proyectos', 'INF-2026-004', 'responsable1@correo.com', ''],
      [EXAMPLE_MARKER_VALUE, exampleProject, '', exampleType, '', 'Julio', 2026, '2026-08-10', 'Enviado', '', '', 'Sin responsables asignados todavía.'],
    ];
    // 7 filas vacías listas para escribir debajo de los ejemplos.
    const blankRows: (string | number)[][] = Array.from({ length: 7 }, () => Array(INFORMES_HEADERS.length).fill(''));

    const informesSheet = XLSX.utils.aoa_to_sheet([INFORMES_HEADERS, ...exampleRows, ...blankRows]);
    informesSheet['!cols'] = [
      { wch: 42 }, { wch: 26 }, { wch: 16 }, { wch: 22 }, { wch: 16 },
      { wch: 12 }, { wch: 8 }, { wch: 16 }, { wch: 24 }, { wch: 16 }, { wch: 36 }, { wch: 32 },
    ];
    informesSheet['!freeze'] = { xSplit: 0, ySplit: 1 };
    // Primera fila de datos real (después de encabezado + 3 ejemplos).
    const firstDataRow = 1 + exampleRows.length + 1; // 1-based: fila 5
    const lastRow = firstDataRow + blankRows.length - 1;
    for (let r = 2; r <= lastRow; r++) {
      // BPIN se calcula a partir de la columna "Proyecto" (B) buscando en
      // la hoja de referencia; Código se calcula a partir de "Tipo de
      // Informe" (D). Si "Proyecto" o "Tipo" están vacíos, queda en blanco
      // en vez de mostrar un error de fórmula.
      informesSheet[`C${r}`] = { t: 'str', f: `IF(B${r}="","",IFERROR(VLOOKUP(B${r},'Proyectos (BPIN)'!A:B,2,0),"¿Proyecto no existe?"))` };
      informesSheet[`E${r}`] = { t: 'str', f: `IF(D${r}="","",IFERROR(VLOOKUP(D${r},'Tipos de Informe (Código)'!A:B,2,0),"¿Tipo no existe?"))` };
    }

    // --- Hojas de referencia (columna 1 = lo que se escribe en "Informes",
    // para que el VLOOKUP de arriba funcione).
    const projectsSheet = XLSX.utils.json_to_sheet(
      projects.map((p) => ({ Proyecto: p.name, BPIN: p.bpin, Empresa: p.company })),
    );
    projectsSheet['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 20 }];

    const typesSheet = XLSX.utils.json_to_sheet(
      reportTypes.map((t) => ({ 'Tipo de Informe': t.name, Código: t.code, Periodicidad: t.periodicity })),
    );
    typesSheet['!cols'] = [{ wch: 30 }, { wch: 12 }, { wch: 14 }];

    const referenceSheet = XLSX.utils.json_to_sheet([
      { Campo: '1. Proyecto', Instrucción: 'Escribe el nombre EXACTO de un proyecto de la hoja "Proyectos (BPIN)" (cópialo de ahí). El BPIN se llena solo.' },
      { Campo: '2. Tipo de Informe', Instrucción: 'Escribe el nombre EXACTO de un tipo de la hoja "Tipos de Informe (Código)". El código se llena solo.' },
      { Campo: '3. Mes', Instrucción: `Uno de: ${MONTHS_LIST.join(', ')}` },
      { Campo: '4. Año', Instrucción: 'Número de 4 dígitos, ej. 2026.' },
      { Campo: '5. Fecha Límite', Instrucción: 'Formato AAAA-MM-DD, ej. 2026-10-10. Es la fecha real en que se entregó o venció.' },
      { Campo: '6. Estado', Instrucción: `Uno de: ${VALID_STATUSES.join(', ')}. Si lo dejas vacío, se usa "Enviado".` },
      { Campo: '7. Consecutivo', Instrucción: 'Opcional. El número real ya usado antes del sistema (ej. en el documento entregado), para continuar la numeración. Vacío = se calcula solo.' },
      { Campo: '8. Responsables', Instrucción: 'Opcional. Correos separados por coma, deben existir en Listas Maestras > Contactos.' },
      { Campo: '9. Observaciones', Instrucción: 'Opcional, texto libre.' },
    ]);
    referenceSheet['!cols'] = [{ wch: 20 }, { wch: 95 }];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, informesSheet, 'Informes');
    XLSX.utils.book_append_sheet(workbook, projectsSheet, 'Proyectos (BPIN)');
    XLSX.utils.book_append_sheet(workbook, typesSheet, 'Tipos de Informe (Código)');
    XLSX.utils.book_append_sheet(workbook, referenceSheet, 'Cómo llenar cada columna');
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
      const allRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: false, defval: '' });

      // Se descartan las filas de ejemplo (marcadas en la primera columna)
      // y las filas totalmente vacías (las de relleno que trae la plantilla),
      // guardando la fila real del Excel de cada una que sí queda (fila 1 =
      // encabezado, así que la primera fila de datos es la 2).
      const kept = allRows
        .map((r, idx) => ({ row: r, excelRow: idx + 2 }))
        .filter(({ row: r }) => {
          const isExample = String(r[EXAMPLE_MARKER_HEADER] ?? '').trim().length > 0;
          const isBlank = Object.values(r).every((v) => String(v ?? '').trim() === '');
          return !isExample && !isBlank;
        });
      setSkippedExampleCount(allRows.length - kept.length);

      if (kept.length === 0) {
        setParseError('No se encontraron filas con datos (solo ejemplos o filas vacías).');
        setParsedRows(null);
        setExcelRowNumbers([]);
        return;
      }
      setParsedRows(kept.map((k) => k.row));
      setExcelRowNumbers(kept.map((k) => k.excelRow));
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
      // Mapea los encabezados "amigables" de la plantilla a las claves
      // cortas que ya entiende el backend (BPIN, Proyecto, typeCode...).
      const mappedRows = parsedRows.map((r) => ({
        Proyecto: r['Proyecto'],
        BPIN: r['BPIN (se llena solo al escribir el Proyecto)'],
        'Código Tipo Informe': r['Código Tipo Informe (se llena solo al escribir el Tipo)'],
        Mes: r['Mes'],
        Año: r['Año'],
        'Fecha Límite': r['Fecha Límite (AAAA-MM-DD)'],
        Estado: r['Estado'],
        Consecutivo: r['Consecutivo (opcional)'],
        Responsables: r['Responsables (correos separados por coma)'],
        Observaciones: r['Observaciones'],
      }));

      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bulkImportReports', rows: mappedRows }),
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

  // result.results[i] viene en el mismo orden que mappedRows -- se
  // traduce de vuelta a la fila real del Excel usando excelRowNumbers,
  // que sí sobrevive al filtrado de ejemplos/filas vacías.
  const toExcelRow = (resultIndex: number) => excelRowNumbers[resultIndex] ?? null;

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
              Trae 3 filas de ejemplo ya llenas (se ignoran solas al importar), filas vacías listas para escribir, una hoja por cada columna que explica qué poner, y las hojas de Proyectos / Tipos de Informe para copiar los nombres exactos.
            </p>
            <div className="rounded-lg bg-indigo-50 border border-indigo-100 px-2.5 py-2 text-[11px] text-indigo-800 flex items-start gap-1.5">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                Las columnas <strong>BPIN</strong> y <strong>Código Tipo Informe</strong> se calculan solas en Excel (fórmula) a partir de lo que escribas en "Proyecto" y "Tipo de Informe" -- no las toques a mano.
              </span>
            </div>
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
                {parsedRows.length} fila(s) de datos leída(s) de "{fileName}" (se ignoraron {skippedExampleCount} de ejemplo/vacías).
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
                  {result.results
                    .map((r, idx) => ({ ...r, excelRow: toExcelRow(idx) }))
                    .filter((r) => r.status === 'error')
                    .map((r, i) => (
                      <p key={i} className="px-2.5 py-1.5 text-[11px] text-rose-700">
                        Fila {r.excelRow ?? r.row} del Excel: {r.message}
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
