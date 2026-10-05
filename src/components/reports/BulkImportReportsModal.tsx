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
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Seguimiento de Informes';

    // Hoja de apoyo oculta: aquí viven las listas que alimentan los
    // desplegables y las fórmulas de la hoja "Informes" -- el usuario solo
    // ve y llena una hoja ("mostrar todo en una hoja").
    const data = workbook.addWorksheet('Datos', { state: 'veryHidden' });
    projects.forEach((p, i) => {
      data.getCell(i + 1, 1).value = p.name; // A: Proyecto
      data.getCell(i + 1, 2).value = p.bpin; // B: BPIN
    });
    reportTypes.forEach((t, i) => {
      data.getCell(i + 1, 4).value = t.name; // D: Tipo de Informe
      data.getCell(i + 1, 5).value = t.code; // E: Código
    });
    MONTHS_LIST.forEach((m, i) => { data.getCell(i + 1, 7).value = m; }); // G
    VALID_STATUSES.forEach((s, i) => { data.getCell(i + 1, 8).value = s; }); // H
    const projectsRange = `Datos!$A$1:$A$${Math.max(projects.length, 1)}`;
    const typesRange = `Datos!$D$1:$D$${Math.max(reportTypes.length, 1)}`;
    const monthsRange = `Datos!$G$1:$G$${MONTHS_LIST.length}`;
    const statusRange = `Datos!$H$1:$H$${VALID_STATUSES.length}`;

    const sheet = workbook.addWorksheet('Informes', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    const ACCENT = 'FF0F766E'; // teal-700, el color del módulo de Informes
    const EXAMPLE_FILL = 'FFFEF3C7'; // amber-100
    const AUTO_FILL_COL = 'FFF1F5F9'; // slate-100

    sheet.columns = [
      { header: EXAMPLE_MARKER_HEADER, key: 'ejemplo', width: 40 },
      { header: 'Proyecto', key: 'proyecto', width: 28 },
      { header: 'BPIN (se llena solo)', key: 'bpin', width: 16 },
      { header: 'Tipo de Informe', key: 'tipo', width: 24 },
      { header: 'Código (se llena solo)', key: 'codigo', width: 16 },
      { header: 'Mes', key: 'mes', width: 13 },
      { header: 'Año', key: 'anio', width: 8 },
      { header: 'Fecha Límite (AAAA-MM-DD)', key: 'fecha', width: 16 },
      { header: 'Estado', key: 'estado', width: 24 },
      { header: 'Consecutivo (opcional)', key: 'consecutivo', width: 16 },
      { header: 'Responsables (correos, separados por coma)', key: 'responsables', width: 38 },
      { header: 'Observaciones', key: 'observaciones', width: 32 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFFFFFFF' } } };
    });
    headerRow.height = 32;
    const headerNotes: Record<string, string> = {
      proyecto: 'Elígelo del desplegable (nombre exacto del proyecto).',
      bpin: 'No lo toques: se calcula solo a partir del Proyecto.',
      tipo: 'Elígelo del desplegable.',
      codigo: 'No lo toques: se calcula solo a partir del Tipo de Informe.',
      mes: 'Elígelo del desplegable.',
      anio: 'Número de 4 dígitos, ej. 2026.',
      fecha: 'Fecha real de entrega o vencimiento, formato AAAA-MM-DD.',
      estado: 'Elígelo del desplegable. Vacío = se usa "Enviado".',
      consecutivo: 'Opcional: el número ya usado antes del sistema, para darle continuidad. Vacío = se calcula solo.',
      responsables: 'Opcional: correos que ya existan en Listas Maestras > Contactos.',
      observaciones: 'Opcional, texto libre.',
    };
    Object.entries(headerNotes).forEach(([key, note]) => {
      const col = sheet.getColumn(key);
      const cell = sheet.getCell(1, col.number as number);
      cell.note = note;
    });

    const exampleProject = projects[0]?.name ?? 'Montes de Maria';
    const otherProject = projects[1]?.name ?? exampleProject;
    const exampleType = reportTypes[0]?.name ?? 'Informe Técnico';
    const otherType = reportTypes[1]?.name ?? exampleType;

    const exampleRows = [
      [EXAMPLE_MARKER_VALUE, exampleProject, '', exampleType, '', 'Septiembre', 2026, '2026-10-10', 'Enviado', '', 'responsable1@correo.com, responsable2@correo.com', 'Informe entregado a tiempo, radicado en físico.'],
      [EXAMPLE_MARKER_VALUE, otherProject, '', otherType, '', 'Agosto', 2026, '2026-09-08', 'Entregado a Of. Proyectos', 'INF-2026-004', 'responsable1@correo.com', ''],
      [EXAMPLE_MARKER_VALUE, exampleProject, '', exampleType, '', 'Julio', 2026, '2026-08-10', 'Enviado', '', '', 'Sin responsables asignados todavía.'],
    ];
    const BLANK_ROWS = 12;
    const totalDataRows = exampleRows.length + BLANK_ROWS;

    exampleRows.forEach((values) => sheet.addRow(values));
    for (let i = 0; i < BLANK_ROWS; i++) sheet.addRow(new Array(INFORMES_HEADERS.length).fill(''));

    for (let r = 2; r <= 1 + totalDataRows; r++) {
      const row = sheet.getRow(r);
      const isExample = r <= 1 + exampleRows.length;

      // BPIN y Código se calculan solos (VLOOKUP) y quedan protegidos
      // (locked) para que no se puedan editar a mano por accidente.
      const bpinCell = row.getCell(3);
      bpinCell.value = { formula: `IF(B${r}="","",IFERROR(VLOOKUP(B${r},Datos!$A:$B,2,0),"¿Proyecto no existe?"))`, result: '' } as any;
      bpinCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AUTO_FILL_COL } };
      bpinCell.font = { italic: true, color: { argb: 'FF64748B' } };
      bpinCell.protection = { locked: true };

      const codigoCell = row.getCell(5);
      codigoCell.value = { formula: `IF(D${r}="","",IFERROR(VLOOKUP(D${r},Datos!$D:$E,2,0),"¿Tipo no existe?"))`, result: '' } as any;
      codigoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AUTO_FILL_COL } };
      codigoCell.font = { italic: true, color: { argb: 'FF64748B' } };
      codigoCell.protection = { locked: true };

      // Desplegables reales: Proyecto, Tipo de Informe, Mes, Estado.
      row.getCell(2).dataValidation = { type: 'list', allowBlank: true, formulae: [projectsRange] };
      row.getCell(4).dataValidation = { type: 'list', allowBlank: true, formulae: [typesRange] };
      row.getCell(6).dataValidation = { type: 'list', allowBlank: true, formulae: [monthsRange] };
      row.getCell(9).dataValidation = { type: 'list', allowBlank: true, formulae: [statusRange] };

      // El resto de columnas queda desbloqueado -- la hoja se protege más
      // abajo, así que solo BPIN/Código quedan de solo lectura.
      [1, 2, 4, 6, 7, 8, 9, 10, 11, 12].forEach((col) => {
        row.getCell(col).protection = { locked: false };
      });

      if (isExample) {
        for (let c = 1; c <= INFORMES_HEADERS.length; c++) {
          const cell = row.getCell(c);
          if (c !== 3 && c !== 5) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXAMPLE_FILL } };
        }
      }
      row.commit();
    }

    // Protección sin contraseña: solo evita ediciones accidentales en
    // BPIN/Código, cualquiera puede quitarla desde "Revisar > Desproteger".
    await sheet.protect('', { selectLockedCells: true, selectUnlockedCells: true });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'plantilla_informes_anteriores.xlsx';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
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
              Todo en una sola hoja: 3 filas de ejemplo ya llenas (se ignoran solas al importar), filas vacías listas para escribir, desplegables para Proyecto / Tipo de Informe / Mes / Estado, y una notita de ayuda en cada encabezado (pasa el mouse por encima).
            </p>
            <div className="rounded-lg bg-indigo-50 border border-indigo-100 px-2.5 py-2 text-[11px] text-indigo-800 flex items-start gap-1.5">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                Las columnas <strong>BPIN</strong> y <strong>Código</strong> (en gris) se calculan solas y quedan bloqueadas al elegir el Proyecto/Tipo del desplegable -- no hace falta tocarlas. Debes abrir el archivo en Excel real y guardarlo para que esas fórmulas se calculen antes de subirlo.
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
