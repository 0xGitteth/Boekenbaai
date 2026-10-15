/**
 * Boekenbaai PR7 mail bridge. Paste into a standalone Google Apps Script
 * project owned by the dedicated boekenbaai@gmail.com account.
 *
 * Script Properties: BOEKENBAAI_SHARED_SECRET = same 32+ character random
 * secret as Sliplane's BOEKENBAAI_MAIL_SCRIPT_SECRET.
 *
 * Deploy > Web app > Execute as Me > Who has access: Anyone.
 * The public URL does not grant sending rights without an HMAC signature.
 * This script never reads a Gmail inbox. MailApp only sends mail.
 */
function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function signatureHex_(value, key) {
  return Utilities.computeHmacSha256Signature(value, key)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); })
    .join('');
}

function equal_(a, b) {
  if (!/^[0-9a-f]{64}$/.test(String(a)) || !/^[0-9a-f]{64}$/.test(String(b))) return false;
  var different = 0;
  for (var i = 0; i < a.length; i++) different |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return different === 0;
}

function safeEmail_(value) {
  return typeof value === 'string' && value.length <= 254
    && /^[^\s@<>]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(value);
}

function pruneReceipts_(props, now) {
  var values = props.getProperties();
  var cutoff = now - 35 * 86400000;
  Object.keys(values).forEach(function (key) {
    if (key.slice(0, 8) !== 'receipt:') return;
    var saved = Number(values[key]);
    if (!Number.isFinite(saved) || saved < cutoff) props.deleteProperty(key);
  });
}

function doPost(e) {
  var data;
  try {
    data = JSON.parse(e.postData.contents || '{}');
    var key = PropertiesService.getScriptProperties()
      .getProperty('BOEKENBAAI_SHARED_SECRET') || '';
    if (key.length < 32 || typeof data.payload !== 'string'
      || data.payload.length > 6000 || !equal_(data.signature,
        signatureHex_(data.payload, key))) return json_({ ok: false, error: 'unauthorized' });
    var mail = JSON.parse(data.payload);
    if (mail.version !== 1 || !/^[0-9a-f]{64}$/.test(mail.id)
      || !Number.isSafeInteger(mail.timestamp)
      || Math.abs(Date.now() - mail.timestamp) > 5 * 60000
      || !safeEmail_(mail.to) || typeof mail.subject !== 'string'
      || !mail.subject || mail.subject.length > 150 || /[\r\n]/.test(mail.subject)
      || typeof mail.body !== 'string' || mail.body.length > 4000) {
      return json_({ ok: false, error: 'invalid_message' });
    }
    // One sender, one transaction: protect duplicates from retries and
    // simultaneous web-app requests using the script-wide lock.
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return json_({ ok: false, error: 'busy' });
    try {
      var props = PropertiesService.getScriptProperties();
      var receipt = 'receipt:' + mail.id;
      if (props.getProperty(receipt)) return json_({ ok: true, id: mail.id });
      if (MailApp.getRemainingDailyQuota() < 1) {
        return json_({ ok: false, error: 'daily_quota' });
      }
      // Claim before sending. If MailApp fails ambiguously, do not resend.
      // Boekenbaai also claims per teacher/task in its persistent storage.
      props.setProperty(receipt, String(Date.now()));
      MailApp.sendEmail({
        to: mail.to,
        subject: mail.subject,
        body: mail.body,
        name: 'Boekenbaai',
      });
      if (Math.random() < 0.02) pruneReceipts_(props, Date.now());
      return json_({ ok: true, id: mail.id });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    // Never echo token, recipient, mail content, or shared secret.
    return json_({ ok: false, error: 'delivery_failed' });
  }
}
