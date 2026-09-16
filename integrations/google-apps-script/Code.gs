function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    var expectedToken = PropertiesService.getScriptProperties().getProperty('APP_SCRIPT_SHARED_SECRET');

    if (!expectedToken || body.token !== expectedToken) {
      return jsonResponse({ ok: false, error: 'unauthorized' });
    }

    if (body.action === 'copy-drive') {
      try {
        startDriveCopyJob(body.jobId);
        return jsonResponse({ ok: true, action: 'copy-drive', result: { jobId: body.jobId, started: true } });
      } catch (copyError) {
        console.error(copyError);
        return jsonResponse({ ok: false, error: String(copyError.message || copyError) });
      }
    }

    if (body.action === 'drive-progress') {
      return jsonResponse({ ok: true, progress: getDriveCopyProgress(body.jobId) });
    }

    var recipients = (body.recipients || [])
      .map(function (recipient) { return recipient.email; })
      .filter(function (email) { return email && email.indexOf('@') > 0; });

    if (!body.alert || !body.alert.name || recipients.length === 0) {
      return jsonResponse({ ok: false, error: 'missing-alert-or-recipients' });
    }

    var subject = '[Seguimiento] ' + body.alert.name;
    var textBody = [
      'Se activó una alerta de seguimiento.',
      '',
      'Alerta: ' + body.alert.name,
      'Proyecto: ' + body.alert.projectName,
      'Tipo: ' + body.alert.type,
      'Programación: ' + body.alert.schedule,
      '',
      'Este mensaje fue enviado automáticamente desde Seguimiento de Informes.'
    ].join('\n');

    GmailApp.sendEmail(recipients.join(','), subject, textBody);
    return jsonResponse({ ok: true, recipientCount: recipients.length });
  } catch (error) {
    console.error(error);
    return jsonResponse({ ok: false, error: String(error.message || error) });
  }
}

function syncDatabaseToSheet() {
  var properties = PropertiesService.getScriptProperties();
  var appUrl = properties.getProperty('APP_URL');
  var token = properties.getProperty('APP_SCRIPT_SHARED_SECRET');
  var spreadsheetId = properties.getProperty('SPREADSHEET_ID');

  if (!appUrl || !token || !spreadsheetId) {
    throw new Error('Configura APP_URL, APP_SCRIPT_SHARED_SECRET y SPREADSHEET_ID.');
  }

  var response = UrlFetchApp.fetch(appUrl + '/api/sync/snapshot', {
    method: 'get',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  var payload = JSON.parse(response.getContentText());

  if (response.getResponseCode() !== 200 || !payload.data) {
    throw new Error('El snapshot de Neon no está disponible: ' + response.getContentText());
  }

  var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  payload.data.tables.forEach(function (table) {
    replaceSheetContents(spreadsheet, table.name, table.rows);
  });
  properties.setProperty('LAST_SYNC_AT', payload.data.generatedAt);
}

function getDriveLinksFromApp() {
  var properties = PropertiesService.getScriptProperties();
  var appUrl = properties.getProperty('APP_URL');
  var token = properties.getProperty('APP_SCRIPT_SHARED_SECRET');

  if (!appUrl || !token) {
    throw new Error('Configura APP_URL y APP_SCRIPT_SHARED_SECRET.');
  }

  var response = UrlFetchApp.fetch(appUrl + '/api/drive-links', {
    method: 'get',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  var payload = JSON.parse(response.getContentText());

  if (response.getResponseCode() !== 200 || !payload.data) {
    throw new Error('No fue posible leer los enlaces Drive: ' + response.getContentText());
  }

  return payload.data;
}

function copyFilesFromSourceToDestination(jobId) {
  var links = getDriveLinksFromApp();
  var sourceFolder = DriveApp.getFolderById(extractDriveFolderId(links.sourceUrl));
  var destinationFolder = DriveApp.getFolderById(extractDriveFolderId(links.destinationUrl));
  var summary = { copiedFiles: 0, skippedFiles: 0, createdFolders: 0, reusedFolders: 0 };
  var progress = { percent: 5, processed: 0, total: 0, phase: 'Contando elementos...' };
  saveDriveCopyProgress(jobId, progress);
  progress.total = countFolderItems(sourceFolder);
  progress.phase = 'Copiando carpeta...';
  saveDriveCopyProgress(jobId, progress);

  // Replica la carpeta origen completa dentro de la carpeta destino.
  copyFolderTree(sourceFolder, destinationFolder, summary, progress, jobId);
  saveDriveCopyProgress(jobId, { percent: 100, processed: progress.processed, total: progress.total, phase: 'Copia completada' });

  Logger.log(JSON.stringify(summary));
  return summary;
}

function startDriveCopyJob(jobId) {
  if (!jobId) throw new Error('Falta jobId.');
  var links = getDriveLinksFromApp();
  var sourceFolderId = extractDriveFolderId(links.sourceUrl);
  var destinationFolderId = extractDriveFolderId(links.destinationUrl);
  var state = {
    jobId: jobId,
    queue: [{ sourceId: sourceFolderId, destinationParentId: destinationFolderId }],
    copiedFiles: 0,
    skippedFiles: 0,
    createdFolders: 0,
    reusedFolders: 0,
    processedFolders: 0,
    done: false,
    percent: 1,
    phase: 'Trabajo iniciado',
    updatedAt: new Date().toISOString()
  };
  saveDriveCopyState(state);
  installDriveCopyTrigger();
  processDriveCopyBatch();
}

function processDriveCopyBatch() {
  var state = loadDriveCopyState();
  if (!state || state.done) return;
  var startedAt = new Date().getTime();
  var batchLimitMs = 80000;
  state.phase = 'Copiando por lotes...';

  while (state.queue.length && new Date().getTime() - startedAt < batchLimitMs) {
    var item = state.queue.shift();
    var sourceFolder = DriveApp.getFolderById(item.sourceId);
    var destinationParent = DriveApp.getFolderById(item.destinationParentId);
    var destinationFolder = findFolder(destinationParent, sourceFolder.getName());

    if (destinationFolder) state.reusedFolders++;
    else {
      destinationFolder = destinationParent.createFolder(sourceFolder.getName());
      state.createdFolders++;
    }

    var files = sourceFolder.getFiles();
    while (files.hasNext()) {
      var sourceFile = files.next();
      if (findFile(destinationFolder, sourceFile.getName())) state.skippedFiles++;
      else {
        sourceFile.makeCopy(sourceFile.getName(), destinationFolder);
        state.copiedFiles++;
      }
    }

    var folders = sourceFolder.getFolders();
    while (folders.hasNext()) {
      state.queue.push({ sourceId: folders.next().getId(), destinationParentId: destinationFolder.getId() });
    }
    state.processedFolders++;
    state.percent = Math.min(99, Math.max(5, state.processedFolders % 95));
    state.updatedAt = new Date().toISOString();
    saveDriveCopyState(state);
  }

  if (!state.queue.length) {
    state.done = true;
    state.percent = 100;
    state.phase = 'Copia completada';
    removeDriveCopyTriggers();
  }
  state.updatedAt = new Date().toISOString();
  saveDriveCopyState(state);
}

function saveDriveCopyState(state) {
  PropertiesService.getScriptProperties().setProperty('DRIVE_COPY_STATE_' + state.jobId, JSON.stringify(state));
}

function loadDriveCopyState() {
  var properties = PropertiesService.getScriptProperties();
  var keys = properties.getProperties();
  var stateKey = Object.keys(keys).filter(function (key) { return key.indexOf('DRIVE_COPY_STATE_') === 0; })[0];
  return stateKey ? JSON.parse(keys[stateKey]) : null;
}

function installDriveCopyTrigger() {
  removeDriveCopyTriggers();
  ScriptApp.newTrigger('processDriveCopyBatch').timeBased().everyMinutes(1).create();
}

function removeDriveCopyTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'processDriveCopyBatch') ScriptApp.deleteTrigger(trigger);
  });
}

function copyFolderTree(sourceFolder, destinationParent, summary, progress, jobId) {
  var destinationFolder = findFolder(destinationParent, sourceFolder.getName());

  if (destinationFolder) {
    summary.reusedFolders++;
  } else {
    destinationFolder = destinationParent.createFolder(sourceFolder.getName());
    summary.createdFolders++;
  }

  var files = sourceFolder.getFiles();
  while (files.hasNext()) {
    var sourceFile = files.next();

    // Evita duplicar archivos si se ejecuta de nuevo el proceso.
    if (findFile(destinationFolder, sourceFile.getName())) {
      summary.skippedFiles++;
    } else {
      sourceFile.makeCopy(sourceFile.getName(), destinationFolder);
      summary.copiedFiles++;
    }
    progress.processed++;
    progress.percent = progress.total ? Math.min(99, Math.round((progress.processed / progress.total) * 100)) : 5;
    saveDriveCopyProgress(jobId, progress);
  }

  var folders = sourceFolder.getFolders();
  while (folders.hasNext()) {
    copyFolderTree(folders.next(), destinationFolder, summary, progress, jobId);
  }
}

function countFolderItems(folder) {
  var total = 0;
  var files = folder.getFiles();
  while (files.hasNext()) { files.next(); total++; }
  var folders = folder.getFolders();
  while (folders.hasNext()) { total++; total += countFolderItems(folders.next()); }
  return total;
}

function saveDriveCopyProgress(jobId, progress) {
  if (!jobId) return;
  PropertiesService.getScriptProperties().setProperty('DRIVE_COPY_' + jobId, JSON.stringify(progress));
}

function getDriveCopyProgress(jobId) {
  if (!jobId) return { percent: 0, processed: 0, total: 0, phase: 'Sin identificador' };
  var state = PropertiesService.getScriptProperties().getProperty('DRIVE_COPY_STATE_' + jobId);
  if (state) {
    var parsedState = JSON.parse(state);
    return {
      percent: parsedState.percent,
      processed: parsedState.copiedFiles + parsedState.skippedFiles,
      total: parsedState.copiedFiles + parsedState.skippedFiles + parsedState.queue.length,
      phase: parsedState.phase,
      done: parsedState.done,
      copiedFiles: parsedState.copiedFiles,
      skippedFiles: parsedState.skippedFiles,
      createdFolders: parsedState.createdFolders
    };
  }
  var value = PropertiesService.getScriptProperties().getProperty('DRIVE_COPY_' + jobId);
  return value ? JSON.parse(value) : { percent: 0, processed: 0, total: 0, phase: 'Esperando Apps Script...' };
}

function findFolder(parentFolder, folderName) {
  var folders = parentFolder.getFoldersByName(folderName);
  return folders.hasNext() ? folders.next() : null;
}

function findFile(parentFolder, fileName) {
  var files = parentFolder.getFilesByName(fileName);
  return files.hasNext() ? files.next() : null;
}

function extractDriveFolderId(url) {
  var match = String(url).match(/\/folders\/([\w-]+)/);
  if (!match) throw new Error('Enlace de carpeta Drive no válido.');
  return match[1];
}

function installDatabaseSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'syncDatabaseToSheet') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('syncDatabaseToSheet')
    .timeBased()
    .everyMinutes(5)
    .create();
}

function replaceSheetContents(spreadsheet, sheetName, rows) {
  var sheet = spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
  sheet.clearContents();

  if (!rows || rows.length === 0) {
    sheet.getRange(1, 1).setValue('Sin registros');
    return;
  }

  var headers = Object.keys(rows[0]);
  var values = [headers].concat(rows.map(function (row) {
    return headers.map(function (header) {
      var value = row[header];
      return Array.isArray(value) ? value.join(', ') : value == null ? '' : value;
    });
  }));

  sheet.getRange(1, 1, values.length, headers.length).setValues(values);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}