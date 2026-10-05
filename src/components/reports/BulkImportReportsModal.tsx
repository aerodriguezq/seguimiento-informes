import React, { useState } from 'react';
import { Project, ReportType, Contact } from '../../types';
import { MONTHS_LIST } from '../../data/mockData';
import { X, Download, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Info } from 'lucide-react';

const VALID_STATUSES = ['Pendientes Evidencias', 'Informe en Elaboración', 'Entregado a Of. Proyectos', 'Enviado'];

// Columna "ancla" que marca una fila como ejemplo -- se llenan filas de
// ejemplo justo debajo del encabezado, y se filtran solas antes de
// importar (el usuario no tiene que acordarse de borrarlas).
const EXAMPLE_MARKER_HEADER = 'EJEMPLO';
const EXAMPLE_MARKER_VALUE = 'SÍ';

// Los encabezados coinciden EXACTO con las claves que ya lee el backend
// (bulkImportReports en api/reports.ts) -- así no hace falta traducir
// nada entre la plantilla y la importación.
const INFORMES_HEADERS = [
  'Fila',
  EXAMPLE_MARKER_HEADER,
  'Proyecto',
  'BPIN',
  'Empresa',
  'Tipo de Informe',
  'Código Tipo Informe',
  'Periodicidad',
  'Mes',
  'Año',
  'Periodo Inicio',
  'Periodo Fin',
  'Fecha Límite',
  'Estado',
  'Responsables',
  'Responsable Revisión',
  'Fecha Entrega',
  'Fecha Revisión',
  'Enlace Informe',
  'Enlace Evidencias',
  'Consecutivo',
  'Observaciones',
  'Validación',
];
// Columnas informativas/calculadas solas que NO se mandan al importar
// (el backend simplemente las ignora si vinieran, pero ni falta hace).
const AUTO_OR_HELPER_COLUMNS = new Set(['Fila', EXAMPLE_MARKER_HEADER, 'BPIN', 'Empresa', 'Código Tipo Informe', 'Periodicidad', 'Validación']);

type RowResult = { row: number; status: 'created' | 'error'; message?: string; consecutive?: string };
type ImportResult = { created: number; errors: number; results: RowResult[] };

export const BulkImportReportsModal: React.FC<{
  projects: Project[];
  reportTypes: ReportType[];
  contacts: Contact[];
  onClose: () => void;
  onImported: () => Promise<void>;
}> = ({ projects, reportTypes, contacts, onClose, onImported }) => {
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

    const typeById = Object.fromEntries(reportTypes.map((t) => [t.id, t]));

    // Hoja de apoyo oculta: listas para los desplegables + tablas de
    // búsqueda para los campos que se calculan solos -- el usuario solo
    // ve y llena la hoja "Informes" ("mostrar todo en una hoja").
    const data = workbook.addWorksheet('Datos', { state: 'veryHidden' });
    projects.forEach((p, i) => {
      data.getCell(i + 1, 1).value = p.name; // A: Proyecto
      data.getCell(i + 1, 2).value = p.bpin; // B: BPIN
      data.getCell(i + 1, 3).value = p.company; // C: Empresa
      const applicableNames = p.applicableTypeIds.length
        ? p.applicableTypeIds.map((id) => typeById[id]?.name).filter(Boolean).join(' | ')
        : 'TODOS';
      data.getCell(i + 1, 10).value = applicableNames; // J: tipos aplicables (para Validación)
    });
    reportTypes.forEach((t, i) => {
      data.getCell(i + 1, 4).value = t.name; // D: Tipo de Informe
      data.getCell(i + 1, 5).value = t.code; // E: Código
      data.getCell(i + 1, 6).value = t.periodicity; // F: Periodicidad
    });
    MONTHS_LIST.forEach((m, i) => { data.getCell(i + 1, 7).value = m; }); // G
    VALID_STATUSES.forEach((s, i) => { data.getCell(i + 1, 8).value = s; }); // H
    contacts.forEach((c, i) => { data.getCell(i + 1, 9).value = c.name; }); // I: nombres de contactos

    const projectsRange = `Datos!$A$1:$A$${Math.max(projects.length, 1)}`;
    const typesRange = `Datos!$D$1:$D$${Math.max(reportTypes.length, 1)}`;
    const monthsRange = `Datos!$G$1:$G$${MONTHS_LIST.length}`;
    const statusRange = `Datos!$H$1:$H$${VALID_STATUSES.length}`;
    const contactsRange = `Datos!$I$1:$I$${Math.max(contacts.length, 1)}`;

    const sheet = workbook.addWorksheet('Informes', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });

    const ACCENT = 'FF0F766E'; // teal-700, el color del módulo de Informes
    const EXAMPLE_FILL = 'FFFEF3C7'; // amber-100
    const AUTO_FILL = 'FFF1F5F9'; // slate-100 (campos calculados solos)
    const HELPER_FILL = 'FFEFF6FF'; // blue-50 (columnas de ayuda: Fila, Validación)

    sheet.columns = INFORMES_HEADERS.map((h) => ({ header: h, key: h }));
    sheet.getColumn('Fila').width = 7;
    sheet.getColumn(EXAMPLE_MARKER_HEADER).width = 10;
    sheet.getColumn('Proyecto').width = 26;
    sheet.getColumn('BPIN').width = 16;
    sheet.getColumn('Empresa').width = 16;
    sheet.getColumn('Tipo de Informe').width = 24;
    sheet.getColumn('Código Tipo Informe').width = 14;
    sheet.getColumn('Periodicidad').width = 13;
    sheet.getColumn('Mes').width = 13;
    sheet.getColumn('Año').width = 8;
    sheet.getColumn('Periodo Inicio').width = 13;
    sheet.getColumn('Periodo Fin').width = 13;
    sheet.getColumn('Fecha Límite').width = 14;
    sheet.getColumn('Estado').width = 22;
    sheet.getColumn('Responsables').width = 36;
    sheet.getColumn('Responsable Revisión').width = 22;
    sheet.getColumn('Fecha Entrega').width = 13;
    sheet.getColumn('Fecha Revisión').width = 13;
    sheet.getColumn('Enlace Informe').width = 26;
    sheet.getColumn('Enlace Evidencias').width = 26;
    sheet.getColumn('Consecutivo').width = 15;
    sheet.getColumn('Observaciones').width = 30;
    sheet.getColumn('Validación').width = 26;

    const headerRow = sheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
    headerRow.height = 30;

    const headerNotes: Record<string, string> = {
      'Fila': 'Solo de referencia, se numera sola.',
      [EXAMPLE_MARKER_HEADER]: 'No tocar: marca las filas de ejemplo, que se ignoran al importar.',
      'Proyecto': 'Elígelo del desplegable.',
      'BPIN': 'Se calcula solo a partir del Proyecto. No editar.',
      'Empresa': 'Se calcula sola a partir del Proyecto. No editar.',
      'Tipo de Informe': 'Elígelo del desplegable.',
      'Código Tipo Informe': 'Se calcula solo a partir del Tipo de Informe. No editar.',
      'Periodicidad': 'Se calcula sola a partir del Tipo de Informe. No editar.',
      'Mes': 'Elígelo del desplegable -- es el período que reporta el informe.',
      'Año': 'Número de 4 dígitos, ej. 2026.',
      'Periodo Inicio': 'Opcional. Se guarda como nota en Observaciones.',
      'Periodo Fin': 'Opcional. Se guarda como nota en Observaciones.',
      'Fecha Límite': 'Obligatoria. Formato AAAA-MM-DD -- fecha real de entrega o vencimiento.',
      'Estado': 'Elígelo del desplegable. Vacío = se usa "Enviado".',
      'Responsables': 'Opcional. Correos separados por coma, deben existir en Listas Maestras > Contactos.',
      'Responsable Revisión': 'Opcional. Un nombre (desplegable), solo queda registrado, no envía notificaciones.',
      'Fecha Entrega': 'Opcional. Fecha REAL en que se entregó (formato AAAA-MM-DD), distinta de la Fecha Límite.',
      'Fecha Revisión': 'Opcional. Formato AAAA-MM-DD.',
      'Enlace Informe': 'Opcional. Link de Google Drive/Docs -- queda como adjunto del informe.',
      'Enlace Evidencias': 'Opcional. Link de Google Drive/Docs -- queda como adjunto del informe.',
      'Consecutivo': 'Opcional: el número ya usado antes del sistema, para darle continuidad. Vacío = se calcula solo.',
      'Observaciones': 'Opcional, texto libre.',
      'Validación': 'Solo de referencia: te avisa si falta algo antes de subir el archivo.',
    };
    INFORMES_HEADERS.forEach((h, idx) => {
      const cell = sheet.getCell(1, idx + 1);
      if (headerNotes[h]) cell.note = headerNotes[h];
    });

    const col = (header: string) => INFORMES_HEADERS.indexOf(header) + 1;
    const letter = (header: string) => String.fromCharCode(64 + col(header)); // A, B, C...

    const exampleProject = projects[0]?.name ?? 'Montes de Maria';
    const otherProject = projects[1]?.name ?? exampleProject;
    const exampleType = reportTypes[0]?.name ?? 'Informe Técnico';
    const otherType = reportTypes[1]?.name ?? exampleType;

    const buildExampleRow = (overrides: Record<string, string | number>) => {
      const row: Record<string, string | number> = { [EXAMPLE_MARKER_HEADER]: EXAMPLE_MARKER_VALUE, ...overrides };
      return INFORMES_HEADERS.map((h) => row[h] ?? '');
    };
    const exampleRows = [
      buildExampleRow({
        Proyecto: exampleProject, 'Tipo de Informe': exampleType, Mes: 'Septiembre', Año: 2026,
        'Fecha Límite': '2026-10-10', Estado: 'Enviado',
        Responsables: 'responsable1@correo.com, responsable2@correo.com',
        'Responsable Revisión': contacts[0]?.name ?? '',
        'Fecha Entrega': '2026-10-09', Observaciones: 'Informe entregado a tiempo, radicado en físico.',
      }),
      buildExampleRow({
        Proyecto: otherProject, 'Tipo de Informe': otherType, Mes: 'Agosto', Año: 2026,
        'Fecha Límite': '2026-09-08', Estado: 'Entregado a Of. Proyectos', Consecutivo: 'INF-2026-004',
        Responsables: 'responsable1@correo.com', 'Enlace Informe': 'https://drive.google.com/file/d/EJEMPLO/view',
      }),
      buildExampleRow({
        Proyecto: exampleProject, 'Tipo de Informe': exampleType, Mes: 'Julio', Año: 2026,
        'Fecha Límite': '2026-08-10', Estado: 'Enviado', Observaciones: 'Sin responsables asignados todavía.',
      }),
    ];

    const BLANK_ROWS = 12;
    const totalDataRows = exampleRows.length + BLANK_ROWS;

    exampleRows.forEach((values) => sheet.addRow(values));
    for (let i = 0; i < BLANK_ROWS; i++) sheet.addRow(new Array(INFORMES_HEADERS.length).fill(''));

    for (let r = 2; r <= 1 + totalDataRows; r++) {
      const row = sheet.getRow(r);
      const isExample = r <= 1 + exampleRows.length;

      row.getCell(col('Fila')).value = { formula: `ROW()-1`, result: r - 1 } as any;

      // BPIN / Empresa / Código / Periodicidad se calculan solos y quedan
      // protegidos (locked) para que no se editen a mano por accidente.
      const autoFormulas: [string, string][] = [
        ['BPIN', `IF(${letter('Proyecto')}${r}="","",IFERROR(VLOOKUP(${letter('Proyecto')}${r},Datos!$A:$B,2,0),"¿Proyecto no existe?"))`],
        ['Empresa', `IF(${letter('Proyecto')}${r}="","",IFERROR(VLOOKUP(${letter('Proyecto')}${r},Datos!$A:$C,3,0),""))`],
        ['Código Tipo Informe', `IF(${letter('Tipo de Informe')}${r}="","",IFERROR(VLOOKUP(${letter('Tipo de Informe')}${r},Datos!$D:$E,2,0),"¿Tipo no existe?"))`],
        ['Periodicidad', `IF(${letter('Tipo de Informe')}${r}="","",IFERROR(VLOOKUP(${letter('Tipo de Informe')}${r},Datos!$D:$F,3,0),""))`],
      ];
      autoFormulas.forEach(([header, formula]) => {
        const cell = row.getCell(col(header));
        cell.value = { formula, result: '' } as any;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AUTO_FILL } };
        cell.font = { italic: true, color: { argb: 'FF64748B' } };
        cell.protection = { locked: true };
      });

      // Validación: avisa ANTES de subir el archivo si falta algo o el
      // tipo de informe no aplica a ese proyecto.
      const pCell = `${letter('Proyecto')}${r}`;
      const tCell = `${letter('Tipo de Informe')}${r}`;
      const mCell = `${letter('Mes')}${r}`;
      const yCell = `${letter('Año')}${r}`;
      const fCell = `${letter('Fecha Límite')}${r}`;
      const validacionFormula =
        `IF(COUNTA(${pCell},${tCell},${mCell},${yCell},${fCell})=0,"",` +
        `IF(${pCell}="","ERROR: Falta Proyecto",` +
        `IF(COUNTIF(Datos!$A:$A,${pCell})=0,"ERROR: Proyecto no existe",` +
        `IF(${tCell}="","ERROR: Falta Tipo de Informe",` +
        `IF(COUNTIF(Datos!$D:$D,${tCell})=0,"ERROR: Tipo no existe",` +
        `IF(OR(${mCell}="",${yCell}="",${fCell}=""),"REVISAR: faltan Mes/Año/Fecha Límite",` +
        `IF(OR(IFERROR(VLOOKUP(${pCell},Datos!$A:$J,10,0),"")="TODOS",ISNUMBER(SEARCH(${tCell},IFERROR(VLOOKUP(${pCell},Datos!$A:$J,10,0),"")))),"OK","REVISAR: Tipo no aplicable a este proyecto")` +
        `))))))`;
      const validacionCell = row.getCell(col('Validación'));
      validacionCell.value = { formula: validacionFormula, result: '' } as any;
      validacionCell.protection = { locked: true };
      validacionCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HELPER_FILL } };

      row.getCell(col('Fila')).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HELPER_FILL } };
      row.getCell(col('Fila')).protection = { locked: true };

      // Desplegables reales.
      row.getCell(col('Proyecto')).dataValidation = { type: 'list', allowBlank: true, formulae: [projectsRange] };
      row.getCell(col('Tipo de Informe')).dataValidation = { type: 'list', allowBlank: true, formulae: [typesRange] };
      row.getCell(col('Mes')).dataValidation = { type: 'list', allowBlank: true, formulae: [monthsRange] };
      row.getCell(col('Estado')).dataValidation = { type: 'list', allowBlank: true, formulae: [statusRange] };
      row.getCell(col('Responsable Revisión')).dataValidation = { type: 'list', allowBlank: true, formulae: [contactsRange] };

      // Todas las columnas de captura quedan desbloqueadas -- la hoja se
      // protege más abajo, así que solo los campos auto-calculados (y
      // Fila/Validación) quedan de solo lectura.
      INFORMES_HEADERS.forEach((h) => {
        if (!AUTO_OR_HELPER_COLUMNS.has(h)) row.getCell(col(h)).protection = { locked: false };
      });

      if (isExample) {
        INFORMES_HEADERS.forEach((h) => {
          if (h === 'BPIN' || h === 'Empresa' || h === 'Código Tipo Informe' || h === 'Periodicidad' || h === 'Validación' || h === 'Fila') return;
          row.getCell(col(h)).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXAMPLE_FILL } };
        });
      }
      row.commit();
    }

    // Protección sin contraseña: solo evita ediciones accidentales en los
    // campos calculados solos -- cualquiera puede quitarla desde "Revisar
    // > Desproteger hoja" si hace falta.
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
      // Los encabezados de la plantilla ya coinciden con las claves que
      // entiende el backend -- no hace falta traducir nada.
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

  // result.results[i] viene en el mismo orden que parsedRows -- se
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
              Todo en una sola hoja: 3 filas de ejemplo ya llenas (se ignoran solas al importar), filas vacías listas para escribir, desplegables para Proyecto / Tipo de Informe / Mes / Estado / Responsable de Revisión, una columna de <strong>Validación</strong> que te avisa si falta algo, y una notita de ayuda en cada encabezado (pasa el mouse por encima).
            </p>
            <div className="rounded-lg bg-indigo-50 border border-indigo-100 px-2.5 py-2 text-[11px] text-indigo-800 flex items-start gap-1.5">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                Las columnas en <strong>gris</strong> (BPIN, Empresa, Código, Periodicidad) se calculan solas y quedan bloqueadas al elegir el Proyecto/Tipo del desplegable. Debes abrir el archivo en Excel real y guardarlo para que esas fórmulas (y la columna Validación) se calculen antes de subirlo.
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
