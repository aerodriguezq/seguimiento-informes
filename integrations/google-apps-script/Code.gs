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

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}