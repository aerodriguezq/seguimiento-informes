// =====================================================================
// Actividad y Reversiones de Drive
// ---------------------------------------------------------------------
// Módulo aparte del flujo de copia/sincronización de Code.gs -- vive en
// su propia hoja de cálculo ("Actividad y Reversiones - Drive"), que NO
// está atada a este proyecto (este script es standalone). Por eso el
// menú se instala con un trigger instalable (installActivityMenuSetup,
// se corre UNA sola vez a mano) en vez de un onOpen() simple.
//
// Funcionalidad 1 (extraerActividadDrive): recorre la Drive Activity API
// para una carpeta y rango de fechas, resuelve cada actor "people/ID" a
// nombre/correo con la People API, y reescribe por completo la hoja
// "Actividad Drive" -- repetir el mismo rango nunca duplica filas,
// porque siempre se reemplaza entero.
//
// Funcionalidad 2 (simularReversion / ejecutarReversionConfirmada): para
// cada elemento movido en el rango, calcula su carpeta ANTES de su
// primer movimiento, arma un plan en "Reversión - Simulación" sin mover
// nada, y solo mueve de verdad cuando se confirma desde el menú --
// dejando constancia permanente en "Reversión - Log".
//
// Las tres operaciones pueden pasar de los 6 minutos de límite de Apps
// Script si hay mucha actividad: se trocean en lotes guardando el
// avance en Script Properties y retomando con un trigger por tiempo,
// igual que ya hace processDriveCopyBatch en Code.gs.
// =====================================================================

var ACTIVITY_SPREADSHEET_ID_DEFAULT = '1ow9gJg6gOYIbDwMxk6HmLL8jJ5Q7_cemzrlODjjD5ds';
var ACTIVITY_SHEET_NAME = 'Actividad Drive';
var SIMULATION_SHEET_NAME = 'Reversión - Simulación';
var LOG_SHEET_NAME = 'Reversión - Log';
var ACTIVITY_JOB_PROPERTY_PREFIX = 'ACTIVITY_JOB_';
var ACTIVITY_BATCH_LIMIT_MS = 5 * 60 * 1000; // deja margen bajo el límite real de 6 min.

var ACTIVITY_SHEET_HEADERS = [
  'Fecha/hora', 'Usuario', 'Acción', 'Nombre del elemento', 'ID', 'Tipo',
  'Carpeta origen', 'Carpeta destino', 'Nombre anterior/nuevo', 'Link al elemento'
];
var SIMULATION_SHEET_HEADERS = [
  'Elemento', 'ID', 'Tipo', 'Ubicación actual', 'ID ubicación actual',
  'Carpeta destino (original)', 'ID carpeta destino', 'Estado'
];
var LOG_SHEET_HEADERS = ['Fecha/hora', 'Ejecutado por', 'Elemento', 'ID', 'De (carpeta)', 'A (carpeta)', 'Resultado'];

var ACTIVITY_ACTION_LABELS = {
  move: 'Mover',
  edit: 'Editar',
  rename: 'Renombrar',
  delete: 'Borrar',
  restore: 'Restaurar',
  create: 'Crear',
  permissionChange: 'Permisos',
  comment: 'Comentario'
};

// --------------------------- Menú ---------------------------

// Correr ESTA función una sola vez a mano desde el editor de Apps
// Script (seleccionarla en el desplegable de funciones y darle
// "Ejecutar"). Deja guardado el ID de la hoja y crea el trigger
// instalable que pone el menú cada vez que esa hoja se abre -- no hace
// falta volver a correrla salvo que se borre el trigger.
function installActivityMenuSetup() {
  PropertiesService.getScriptProperties().setProperty('ACTIVITY_SPREADSHEET_ID', ACTIVITY_SPREADSHEET_ID_DEFAULT);

  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'onOpenActivityMenu') ScriptApp.deleteTrigger(trigger);
  });

  ScriptApp.newTrigger('onOpenActivityMenu')
    .forSpreadsheet(ACTIVITY_SPREADSHEET_ID_DEFAULT)
    .onOpen()
    .create();

  Logger.log('Listo. Cierra y vuelve a abrir la hoja "Actividad y Reversiones - Drive" -- el menú debería aparecer.');
}

function onOpenActivityMenu(e) {
  SpreadsheetApp.getUi()
    .createMenu('Actividad y Reversiones')
    .addItem('Extraer actividad a hoja', 'extraerActividadDrive')
    .addSeparator()
    .addItem('Simular reversión', 'simularReversion')
    .addItem('Ejecutar reversión confirmada', 'ejecutarReversionConfirmada')
    .addToUi();
}

// --------------------- Entradas compartidas ---------------------

// Acepta /folders/ID (con o sin /u/0/ y con cualquier parámetro extra
// como ?usp=sharing) y también open?id=ID.
function extractDriveFolderIdForActivity(url) {
  var text = String(url || '').trim();
  var foldersMatch = text.match(/\/folders\/([\w-]+)/);
  if (foldersMatch) return foldersMatch[1];
  var openIdMatch = text.match(/[?&]id=([\w-]+)/);
  if (openIdMatch) return openIdMatch[1];
  throw new Error('No se reconoce como un link de carpeta de Google Drive.');
}

// America/Bogota es UTC-5 todo el año (sin horario de verano) -- se arma
// la fecha directo en esa hora fija en vez de depender de la zona
// horaria del servidor que corre el script.
function parseActivityDateBogota(text, endOfDay) {
  var match = String(text).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  var iso = match[1] + '-' + match[2] + '-' + match[3] + (endOfDay ? 'T23:59:59.999-05:00' : 'T00:00:00.000-05:00');
  var date = new Date(iso);
  return isNaN(date.getTime()) ? null : date;
}

function promptFolderAndRange(ui, title) {
  var folderResponse = ui.prompt(title, 'Pega el link de la carpeta (Unidad Compartida):', ui.ButtonSet.OK_CANCEL);
  if (folderResponse.getSelectedButton() !== ui.Button.OK) return null;

  var folderId;
  try {
    folderId = extractDriveFolderIdForActivity(folderResponse.getResponseText());
  } catch (err) {
    ui.alert('Enlace no válido: ' + err.message);
    return null;
  }

  try {
    DriveApp.getFolderById(folderId).getName();
  } catch (err) {
    ui.alert('No se pudo abrir esa carpeta (revisa el link o los permisos): ' + err.message);
    return null;
  }

  var fromResponse = ui.prompt(title, 'Fecha inicial (AAAA-MM-DD), hora de Bogotá:', ui.ButtonSet.OK_CANCEL);
  if (fromResponse.getSelectedButton() !== ui.Button.OK) return null;
  var toResponse = ui.prompt(title, 'Fecha final (AAAA-MM-DD), hora de Bogotá:', ui.ButtonSet.OK_CANCEL);
  if (toResponse.getSelectedButton() !== ui.Button.OK) return null;

  var fromDate = parseActivityDateBogota(fromResponse.getResponseText(), false);
  var toDate = parseActivityDateBogota(toResponse.getResponseText(), true);
  if (!fromDate || !toDate || fromDate.getTime() > toDate.getTime()) {
    ui.alert('Rango de fechas no válido. Usa el formato AAAA-MM-DD, con la fecha inicial antes que la final.');
    return null;
  }

  return { folderId: folderId, fromDate: fromDate, toDate: toDate };
}

function buildActivityTimeFilter(fromIso, toIso) {
  return 'time >= "' + fromIso + '" AND time <= "' + toIso + '"';
}

function openActivitySpreadsheet() {
  var id = PropertiesService.getScriptProperties().getProperty('ACTIVITY_SPREADSHEET_ID');
  if (!id) throw new Error('Falta ACTIVITY_SPREADSHEET_ID -- corre installActivityMenuSetup() primero.');
  return SpreadsheetApp.openById(id);
}

// Drive Activity API y People API NO quedaron disponibles como
// "servicio avanzado" en este proyecto (Apps Script devolvió "Service
// not found" al intentar habilitarlas así) -- se llaman directo por
// REST con el token OAuth del propio script, que ya trae los scopes
// drive.activity.readonly/directory.readonly del manifiesto. Para que
// esto funcione, además del scope hay que tener esas dos APIs
// habilitadas en el proyecto de Google Cloud asociado al script
// (Configuración del proyecto -> proyecto de GCP -> Habilitar APIs).
function queryDriveActivity(request) {
  var response = UrlFetchApp.fetch('https://driveactivity.googleapis.com/v2/activity:query', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify(request),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    throw new Error('Drive Activity API respondió ' + response.getResponseCode() + ': ' + response.getContentText());
  }
  return JSON.parse(response.getContentText());
}

function fetchPersonFields(personName) {
  var response = UrlFetchApp.fetch(
    'https://people.googleapis.com/v1/' + personName + '?personFields=names,emailAddresses',
    { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true }
  );
  if (response.getResponseCode() !== 200) {
    throw new Error('People API respondió ' + response.getResponseCode() + ': ' + response.getContentText());
  }
  return JSON.parse(response.getContentText());
}

// Resuelve el actor de una actividad a "Nombre <correo>" -- el caso
// típico es un usuario conocido del dominio (actor.user.knownUser.
// personName = "people/ID"), que se resuelve con la People API. El
// resultado se cachea (en memoria, por job) porque la misma persona
// suele aparecer en decenas de actividades seguidas.
function resolveActorName(actor, cache) {
  if (!actor) return 'Desconocido';
  if (actor.administrator) return 'Administrador de Workspace';
  if (actor.anonymous) return 'Anónimo';
  if (actor.impersonation) return 'Suplantación (' + resolveActorName(actor.impersonation.impersonatedUser, cache) + ')';
  if (actor.system) return 'Sistema (' + (actor.system.type || 'Drive') + ')';
  if (!actor.user) return 'Desconocido';
  if (actor.user.deletedUser) return 'Usuario eliminado';
  if (!actor.user.knownUser || !actor.user.knownUser.personName) return 'Usuario desconocido';

  var personName = actor.user.knownUser.personName;
  if (cache[personName]) return cache[personName];

  var resolved = personName;
  try {
    var person = fetchPersonFields(personName);
    var email = person.emailAddresses && person.emailAddresses[0] ? person.emailAddresses[0].value : null;
    var name = person.names && person.names[0] ? person.names[0].displayName : null;
    resolved = name && email ? name + ' <' + email + '>' : (email || name || personName);
  } catch (err) {
    resolved = personName + ' (sin permiso para resolver -- ver directory.readonly)';
  }
  cache[personName] = resolved;
  return resolved;
}

// --------------------- Script Properties: jobs por lotes ---------------------

function saveActivityJobState(state) {
  PropertiesService.getScriptProperties().setProperty(ACTIVITY_JOB_PROPERTY_PREFIX + state.jobId, JSON.stringify(state));
}
function loadActivityJobState(jobId) {
  var raw = PropertiesService.getScriptProperties().getProperty(ACTIVITY_JOB_PROPERTY_PREFIX + jobId);
  return raw ? JSON.parse(raw) : null;
}
function clearActivityJobState(jobId) {
  PropertiesService.getScriptProperties().deleteProperty(ACTIVITY_JOB_PROPERTY_PREFIX + jobId);
}
function findActiveActivityJobId(kind) {
  var properties = PropertiesService.getScriptProperties().getProperties();
  var matchingKey = Object.keys(properties).filter(function (key) {
    if (key.indexOf(ACTIVITY_JOB_PROPERTY_PREFIX) !== 0) return false;
    try {
      return JSON.parse(properties[key]).kind === kind;
    } catch (err) {
      return false;
    }
  })[0];
  if (!matchingKey) return null;
  return JSON.parse(properties[matchingKey]).jobId;
}
function installActivityContinuationTrigger(handlerFunctionName) {
  removeActivityContinuationTrigger(handlerFunctionName);
  ScriptApp.newTrigger(handlerFunctionName).timeBased().everyMinutes(1).create();
}
function removeActivityContinuationTrigger(handlerFunctionName) {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === handlerFunctionName) ScriptApp.deleteTrigger(trigger);
  });
}

// ======================= Funcionalidad 1: extraer actividad =======================

function extraerActividadDrive() {
  var ui = SpreadsheetApp.getUi();
  var input = promptFolderAndRange(ui, 'Extraer actividad de Drive');
  if (!input) return;

  var jobId = Utilities.getUuid();
  var state = {
    jobId: jobId,
    kind: 'extract',
    folderId: input.folderId,
    fromIso: input.fromDate.toISOString(),
    toIso: input.toDate.toISOString(),
    pageToken: null,
    rows: [],
    actorCache: {}
  };
  saveActivityJobState(state);

  var finishedNow = runActivityExtractBatch(jobId);
  if (finishedNow) {
    ui.alert('Listo. Se escribió la actividad de ese rango en la hoja "' + ACTIVITY_SHEET_NAME + '".');
  } else {
    installActivityContinuationTrigger('continueActivityExtractBatch');
    ui.alert('Hay mucha actividad en ese rango -- sigue procesando solo en segundo plano (reintenta cada minuto). La hoja "' + ACTIVITY_SHEET_NAME + '" se actualiza sola cuando termine; puedes cerrar este aviso.');
  }
}

function continueActivityExtractBatch() {
  var jobId = findActiveActivityJobId('extract');
  if (!jobId) { removeActivityContinuationTrigger('continueActivityExtractBatch'); return; }
  if (runActivityExtractBatch(jobId)) removeActivityContinuationTrigger('continueActivityExtractBatch');
}

function runActivityExtractBatch(jobId) {
  var state = loadActivityJobState(jobId);
  if (!state) return true;
  var startedAt = Date.now();

  while (Date.now() - startedAt < ACTIVITY_BATCH_LIMIT_MS) {
    var request = {
      ancestorName: 'items/' + state.folderId,
      filter: buildActivityTimeFilter(state.fromIso, state.toIso),
      pageSize: 100
    };
    if (state.pageToken) request.pageToken = state.pageToken;

    var response = queryDriveActivity(request);
    var activities = response.activities || [];
    for (var i = 0; i < activities.length; i++) {
      var row = describeActivityRow(activities[i], state.actorCache);
      if (row) state.rows.push(row);
    }
    state.pageToken = response.nextPageToken || null;

    if (!state.pageToken) {
      writeActivityRowsToSheet(state.rows);
      clearActivityJobState(jobId);
      return true;
    }
    saveActivityJobState(state);
  }
  return false;
}

function describeActivityRow(activity, actorCache) {
  var detail = activity.primaryActionDetail || {};
  var actionKey = Object.keys(detail)[0] || 'desconocida';
  var actionLabel = ACTIVITY_ACTION_LABELS[actionKey] || actionKey;

  var actorText = activity.actors && activity.actors.length > 0 ? resolveActorName(activity.actors[0], actorCache) : 'Desconocido';

  var target = (activity.targets && activity.targets[0]) || {};
  var driveItem = target.driveItem || {};
  var itemName = driveItem.title || '(sin nombre)';
  var itemId = driveItem.name ? String(driveItem.name).replace('items/', '') : '';
  var isFolder = !!driveItem.driveFolder;
  var tipo = isFolder ? 'Carpeta' : 'Archivo';

  var carpetaOrigen = '', carpetaDestino = '', nombreAnteriorNuevo = '';

  if (actionKey === 'move' && detail.move) {
    var removed = detail.move.removedParents || [];
    var added = detail.move.addedParents || [];
    carpetaOrigen = removed.length > 0 && removed[0].driveItem ? removed[0].driveItem.title : '';
    carpetaDestino = added.length > 0 && added[0].driveItem ? added[0].driveItem.title : '';
  }
  if (actionKey === 'rename' && detail.rename) {
    nombreAnteriorNuevo = (detail.rename.oldTitle || '') + ' -> ' + (detail.rename.newTitle || '');
  }

  var timestamp = activity.timestamp || (activity.timeRange ? activity.timeRange.endTime : null);
  var fecha = timestamp ? Utilities.formatDate(new Date(timestamp), 'America/Bogota', 'yyyy-MM-dd HH:mm:ss') : '';
  var link = itemId ? (isFolder ? 'https://drive.google.com/drive/folders/' + itemId : 'https://drive.google.com/file/d/' + itemId + '/view') : '';

  return [fecha, actorText, actionLabel, itemName, itemId, tipo, carpetaOrigen, carpetaDestino, nombreAnteriorNuevo, link];
}

function writeActivityRowsToSheet(rows) {
  var spreadsheet = openActivitySpreadsheet();
  var sheet = spreadsheet.getSheetByName(ACTIVITY_SHEET_NAME) || spreadsheet.insertSheet(ACTIVITY_SHEET_NAME);
  sheet.clearContents();

  var body = rows.length > 0 ? rows : [['Sin actividad en ese rango.', '', '', '', '', '', '', '', '', '']];
  var values = [ACTIVITY_SHEET_HEADERS].concat(body);
  sheet.getRange(1, 1, values.length, ACTIVITY_SHEET_HEADERS.length).setValues(values);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, ACTIVITY_SHEET_HEADERS.length);
}

// ======================= Funcionalidad 2: revertir movimientos =======================

function simularReversion() {
  var ui = SpreadsheetApp.getUi();
  var input = promptFolderAndRange(ui, 'Simular reversión');
  if (!input) return;

  var jobId = Utilities.getUuid();
  var state = {
    jobId: jobId,
    kind: 'simulate',
    folderId: input.folderId,
    fromIso: input.fromDate.toISOString(),
    toIso: input.toDate.toISOString(),
    pageToken: null,
    phase: 'collecting',
    firstMoveByItem: {},
    actorCache: {}
  };
  saveActivityJobState(state);

  var finishedNow = runActivitySimulateBatch(jobId);
  if (finishedNow) {
    ui.alert('Listo. El plan de reversión quedó en la hoja "' + SIMULATION_SHEET_NAME + '". Revísalo antes de ejecutar nada.');
  } else {
    installActivityContinuationTrigger('continueActivitySimulateBatch');
    ui.alert('Hay mucha actividad en ese rango -- sigue calculando solo en segundo plano. La hoja "' + SIMULATION_SHEET_NAME + '" se llena sola cuando termine.');
  }
}

function continueActivitySimulateBatch() {
  var jobId = findActiveActivityJobId('simulate');
  if (!jobId) { removeActivityContinuationTrigger('continueActivitySimulateBatch'); return; }
  if (runActivitySimulateBatch(jobId)) removeActivityContinuationTrigger('continueActivitySimulateBatch');
}

// Dos fases: 'collecting' (recorre la Activity API y se queda con el
// movimiento MÁS VIEJO de cada elemento dentro del rango) y 'resolving'
// (por cada elemento, consulta dónde está AHORA para armar el plan --
// esto pega una llamada a la API de Drive por elemento, así que también
// se trocea aparte).
function runActivitySimulateBatch(jobId) {
  var state = loadActivityJobState(jobId);
  if (!state) return true;
  var startedAt = Date.now();

  if (state.phase === 'collecting') {
    while (Date.now() - startedAt < ACTIVITY_BATCH_LIMIT_MS) {
      var request = {
        ancestorName: 'items/' + state.folderId,
        filter: buildActivityTimeFilter(state.fromIso, state.toIso),
        pageSize: 100
      };
      if (state.pageToken) request.pageToken = state.pageToken;

      var response = queryDriveActivity(request);
      var activities = response.activities || [];
      for (var i = 0; i < activities.length; i++) {
        registerFirstMove(activities[i], state.firstMoveByItem);
      }
      state.pageToken = response.nextPageToken || null;

      if (!state.pageToken) {
        state.phase = 'resolving';
        state.resolveIds = Object.keys(state.firstMoveByItem);
        state.resolveIndex = 0;
        state.resolvedRows = [];
        break;
      }
      saveActivityJobState(state);
    }
    saveActivityJobState(state);
    if (state.phase !== 'resolving') return false;
  }

  while (state.resolveIndex < state.resolveIds.length && Date.now() - startedAt < ACTIVITY_BATCH_LIMIT_MS) {
    var itemId = state.resolveIds[state.resolveIndex];
    state.resolvedRows.push(resolveSimulationRow(itemId, state.firstMoveByItem[itemId]));
    state.resolveIndex++;
    if (state.resolveIndex % 25 === 0) saveActivityJobState(state);
  }
  saveActivityJobState(state);

  if (state.resolveIndex >= state.resolveIds.length) {
    writeSimulationSheet(state.resolvedRows);
    clearActivityJobState(jobId);
    return true;
  }
  return false;
}

function registerFirstMove(activity, firstMoveByItem) {
  var detail = activity.primaryActionDetail;
  if (!detail || !detail.move) return;

  var target = (activity.targets && activity.targets[0]) || {};
  var driveItem = target.driveItem || {};
  var itemId = driveItem.name ? String(driveItem.name).replace('items/', '') : null;
  if (!itemId) return;

  var timestamp = activity.timestamp || (activity.timeRange ? activity.timeRange.startTime : null);
  if (!timestamp) return;
  var time = new Date(timestamp).getTime();

  var removed = detail.move.removedParents || [];
  if (removed.length === 0 || !removed[0].driveItem) return; // sin carpeta de origen registrada, no hay a dónde revertir

  var existing = firstMoveByItem[itemId];
  if (existing && existing.time <= time) return;

  firstMoveByItem[itemId] = {
    time: time,
    itemTitle: driveItem.title || '(sin nombre)',
    isFolder: !!driveItem.driveFolder,
    originId: removed[0].driveItem.name ? String(removed[0].driveItem.name).replace('items/', '') : null,
    originTitle: removed[0].driveItem.title || '(desconocida)'
  };
}

function resolveSimulationRow(itemId, info) {
  var currentParentId = null, currentParentTitle = '', estado = 'Pendiente';
  try {
    var file = Drive.Files.get(itemId, { fields: 'id,name,parents,trashed', supportsAllDrives: true });
    if (file.trashed) {
      estado = 'Omitido: el elemento está en la papelera';
    } else if (file.parents && file.parents.length > 0) {
      currentParentId = file.parents[0];
      try {
        currentParentTitle = DriveApp.getFolderById(currentParentId).getName();
      } catch (titleErr) {
        currentParentTitle = currentParentId;
      }
      if (currentParentId === info.originId) estado = 'Omitido: ya está en su carpeta original';
    } else {
      estado = 'Omitido: no se encontró su carpeta actual (puede estar en otra unidad o en Mi unidad de alguien)';
    }
  } catch (err) {
    estado = 'Error: ' + (err.message || err);
  }

  return [
    info.itemTitle, itemId, info.isFolder ? 'Carpeta' : 'Archivo',
    currentParentTitle, currentParentId || '',
    info.originTitle, info.originId || '',
    estado
  ];
}

function writeSimulationSheet(rows) {
  var spreadsheet = openActivitySpreadsheet();
  var sheet = spreadsheet.getSheetByName(SIMULATION_SHEET_NAME) || spreadsheet.insertSheet(SIMULATION_SHEET_NAME);
  sheet.clearContents();

  var body = rows.length > 0 ? rows : [['Sin movimientos en ese rango.', '', '', '', '', '', '', '']];
  var values = [SIMULATION_SHEET_HEADERS].concat(body);
  sheet.getRange(1, 1, values.length, SIMULATION_SHEET_HEADERS.length).setValues(values);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, SIMULATION_SHEET_HEADERS.length);
}

// Mueve de verdad lo que en "Reversión - Simulación" siga en "Pendiente"
// -- lo que ya quedó "Omitido" u "Hecho" de una corrida anterior no se
// vuelve a tocar. Trocea por si hay muchas filas: el progreso (qué fila
// sigue) se guarda en Script Properties igual que los otros jobs.
function ejecutarReversionConfirmada() {
  var ui = SpreadsheetApp.getUi();
  var confirm = ui.alert(
    'Ejecutar reversión',
    'Esto va a mover de verdad los elementos marcados "Pendiente" en "' + SIMULATION_SHEET_NAME + '", devolviéndolos a su carpeta original. ¿Confirmas?',
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  var spreadsheet = openActivitySpreadsheet();
  var sheet = spreadsheet.getSheetByName(SIMULATION_SHEET_NAME);
  if (!sheet || sheet.getLastRow() <= 1) {
    ui.alert('Primero corre "Simular reversión" -- todavía no hay ningún plan.');
    return;
  }

  var jobId = Utilities.getUuid();
  var state = { jobId: jobId, kind: 'revert', rowIndex: 1, executedBy: Session.getActiveUser().getEmail() || 'Desconocido' };
  saveActivityJobState(state);

  var finishedNow = runActivityRevertBatch(jobId);
  if (finishedNow) {
    ui.alert('Reversión terminada. Revisa "' + LOG_SHEET_NAME + '" para el detalle de cada elemento.');
  } else {
    installActivityContinuationTrigger('continueActivityRevertBatch');
    ui.alert('Son muchos elementos -- sigue moviendo solo en segundo plano. Revisa "' + LOG_SHEET_NAME + '" a medida que avanza.');
  }
}

function continueActivityRevertBatch() {
  var jobId = findActiveActivityJobId('revert');
  if (!jobId) { removeActivityContinuationTrigger('continueActivityRevertBatch'); return; }
  if (runActivityRevertBatch(jobId)) removeActivityContinuationTrigger('continueActivityRevertBatch');
}

function runActivityRevertBatch(jobId) {
  var state = loadActivityJobState(jobId);
  if (!state) return true;
  var startedAt = Date.now();

  var spreadsheet = openActivitySpreadsheet();
  var sheet = spreadsheet.getSheetByName(SIMULATION_SHEET_NAME);
  var lastRow = sheet.getLastRow();
  var logRows = [];

  while (state.rowIndex < lastRow && Date.now() - startedAt < ACTIVITY_BATCH_LIMIT_MS) {
    var rowNumber = state.rowIndex + 1; // +1: la hoja tiene encabezado en la fila 1
    var row = sheet.getRange(rowNumber, 1, 1, SIMULATION_SHEET_HEADERS.length).getValues()[0];
    var itemTitle = row[0], itemId = row[1], currentParentTitle = row[3], currentParentId = row[4],
      originTitle = row[5], originId = row[6], estado = row[7];

    if (String(estado).indexOf('Pendiente') === 0) {
      var resultado;
      try {
        if (!originId) throw new Error('Sin carpeta de origen registrada.');
        Drive.Files.update({}, itemId, null, { addParents: originId, removeParents: currentParentId, supportsAllDrives: true });
        resultado = 'Movido correctamente';
        sheet.getRange(rowNumber, 8).setValue('Hecho');
      } catch (err) {
        resultado = 'Error: ' + (err.message || err);
        sheet.getRange(rowNumber, 8).setValue(resultado);
      }
      logRows.push([
        Utilities.formatDate(new Date(), 'America/Bogota', 'yyyy-MM-dd HH:mm:ss'),
        state.executedBy, itemTitle, itemId, currentParentTitle, originTitle, resultado
      ]);
    }

    state.rowIndex++;
    if (state.rowIndex % 20 === 0) {
      appendActivityLogRows(logRows);
      logRows = [];
      saveActivityJobState(state);
    }
  }

  appendActivityLogRows(logRows);

  if (state.rowIndex >= lastRow) {
    clearActivityJobState(jobId);
    return true;
  }
  saveActivityJobState(state);
  return false;
}

function appendActivityLogRows(rows) {
  if (!rows || rows.length === 0) return;
  var spreadsheet = openActivitySpreadsheet();
  var sheet = spreadsheet.getSheetByName(LOG_SHEET_NAME) || spreadsheet.insertSheet(LOG_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, LOG_SHEET_HEADERS.length).setValues([LOG_SHEET_HEADERS]);
    sheet.setFrozenRows(1);
  }
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, LOG_SHEET_HEADERS.length).setValues(rows);
  sheet.autoResizeColumns(1, LOG_SHEET_HEADERS.length);
}
