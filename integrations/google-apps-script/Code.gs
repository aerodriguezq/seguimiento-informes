function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    var expectedToken = PropertiesService.getScriptProperties().getProperty('APP_SCRIPT_SHARED_SECRET');

    if (!expectedToken || body.token !== expectedToken) {
      return jsonResponse({ ok: false, error: 'unauthorized' });
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
    return jsonResponse({ ok: false, error: 'send-failed' });
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

function copyFilesFromSourceToDestination() {
  var links = getDriveLinksFromApp();
  var sourceFolder = DriveApp.getFolderById(extractDriveFolderId(links.sourceUrl));
  var destinationFolder = DriveApp.getFolderById(extractDriveFolderId(links.destinationUrl));
  var files = sourceFolder.getFiles();
  var copied = 0;

  while (files.hasNext()) {
    files.next().makeCopy(destinationFolder);
    copied++;
  }

  return { copied: copied, sourceUrl: links.sourceUrl, destinationUrl: links.destinationUrl };
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