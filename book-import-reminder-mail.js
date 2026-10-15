'use strict';
// PR7: school-import email notification core. No student/borrower data is mailed.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const authCore = require('./google-auth-core');
const { taskStage, settingsFor } = require('./book-import-followups');

const DAY_MS = 86400000;
const HOUR_MS = 3600000;
const VERIFY_LIFETIME_MS = DAY_MS;
const VERIFY_COOLDOWN_MS = 300000;
const MAIL_PATH = '/staff.html#book-import-followups-panel';

function validEmail(value) {
  if (typeof value !== 'string' || value.length > 254 || value !== value.trim()) return '';
  const email = authCore.normalizeEmail(value);
  if (!email || email.length > 254 || /[\r\n\s<>]/.test(email)) return '';
  const parts = email.split('@');
  if (parts.length !== 2 || !parts[0] || parts[0].length > 64
    || parts[0].startsWith('.') || parts[0].endsWith('.') || parts[0].includes('..')
    || !/^[a-z0-9.!#$%&'*+/=?^_\x60{|}~-]+$/i.test(parts[0])
    || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(parts[1])) return '';
  return email;
}
function publicBaseUrl(env) {
  try {
    const raw = String(env.BOEKENBAAI_PUBLIC_URL || '').trim();
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password
      || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) return '';
    return url.origin;
  } catch (_) { return ''; }
}
function configuration(env = process.env) {
  const bridgeUrl = String(env.BOEKENBAAI_MAIL_SCRIPT_URL || '').trim();
  let url = '';
  try {
    const v = new URL(bridgeUrl);
    if (v.protocol === 'https:' && v.hostname === 'script.google.com'
      && /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(v.pathname)
      && !v.username && !v.password && !v.search && !v.hash) url = v.href;
  } catch (_) { /* Not configured */ }
  const key = String(env.BOEKENBAAI_MAIL_SCRIPT_SECRET || '');
  const enabled = env.BOEKENBAAI_MAIL_ENABLED === 'true';
  const base = publicBaseUrl(env);
  return { enabled, ready: Boolean(enabled && url && key.length >= 32 && base),
    url, key, base, schoolDomain: authCore.normalizeDomain(
      env.BOEKENBAAI_GOOGLE_DOMAIN || 'koraaledu.nl') };
}
function readSchoolLinks(filename) {
  try { return authCore.normalizeStore(JSON.parse(fs.readFileSync(filename, 'utf8'))); }
  catch (err) { if (err.code === 'ENOENT') return authCore.emptyAuthStore(); throw err; }
}
function prefsFor(db, id) {
  const table = db.bookImportEmailPreferences;
  const row = table && Object.prototype.hasOwnProperty.call(table, id) ? table[id] : null;
  if (!row || typeof row !== 'object') return { mode: 'school', alternateEmail: '',
    revision: 0, verificationWindowStart: 0, verificationCount: 0 };
  return { mode: ['school', 'alternate', 'off'].includes(row.mode) ? row.mode : 'school',
    alternateEmail: validEmail(row.alternateEmail) || '',
    revision: Number.isSafeInteger(row.revision) ? row.revision : 0,
    verificationWindowStart: Number.isSafeInteger(row.verificationWindowStart)
      ? row.verificationWindowStart : 0,
    verificationCount: Number.isSafeInteger(row.verificationCount)
      ? row.verificationCount : 0,
    pending: row.pending || null };
}
function schoolEmailFor(links, id, schoolDomain) {
  const link = authCore.findLinkByAccount(links, 'staff', id);
  return authCore.isAllowedSchoolEmail(link?.email, schoolDomain)
    ? authCore.normalizeEmail(link.email) : '';
}
function activeTeacher(teacher) {
  return teacher?.role === 'teacher' && teacher.active !== false
    && teacher.isActive !== false && teacher.disabled !== true
    && teacher.status !== 'inactive';
}
function collectRecipients(db, links, now = Date.now(), schoolDomain = 'koraaledu.nl') {
  const config = settingsFor(db);
  const classes = new Map((db.classes || []).filter(c => c?.id).map(c => [c.id, c]));
  const classIds = new Set(classes.keys());
  const books = new Set((db.books || []).map(b => b?.id).filter(Boolean));
  const teachers = new Map((db.users || []).filter(activeTeacher).map(u => [u.id, u]));
  const recipients = new Map();
  for (const task of (db.bookImportFollowups || [])) {
    if (!task?.id || !task.classId || !classes.has(task.classId) || !books.has(task.bookId)
      || taskStage(task, config, now, classIds, books) !== 'reminder') continue;
    for (const userId of (classes.get(task.classId).teacherIds || [])) {
      const teacher = teachers.get(userId);
      if (!teacher) continue;
      const pref = prefsFor(db, userId);
      if (pref.mode === 'off') continue;
      const to = pref.mode === 'alternate' ? pref.alternateEmail
        : schoolEmailFor(links, userId, schoolDomain);
      if (!validEmail(to)) continue;
      // Never expose source Excel values, book titles or student identities.
      if (!recipients.has(userId)) recipients.set(userId, { teacherId: userId, to, tasks: [] });
      const recipient = recipients.get(userId);
      if (!recipient.tasks.some(t => t.id === task.id)) recipient.tasks.push({
        id: task.id, epoch: task.createdAt,
      });
    }
  }
  return [...recipients.values()];
}
function claimId(teacherId, task) {
  return crypto.createHash('sha256').update(JSON.stringify([
    'boekenbaai-reminder-pr7', teacherId, task.id, task.epoch,
  ])).digest('hex');
}
function claimOnce(folder, id) {
  if (!/^[0-9a-f]{64}$/.test(id)) throw Error('invalid_receipt_id');
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  try {
    const fd = fs.openSync(path.join(folder, id + '.claim'), 'wx', 0o600);
    try { fs.writeFileSync(fd, new Date().toISOString()); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  }
}
function mailText(count, link) {
  return 'Er ' + (count === 1 ? 'staat 1 openstaande controle' : 'staan '
    + count + ' openstaande controles') + ' van een boekimport klaar voor jouw klas(sen).\n\n'
    + 'Log in bij Boekenbaai om deze taken te bekijken:\n' + link + '\n\n'
    + 'Deze e-mail bevat geen leerlingnamen of uitleengegevens.\n'
    + 'Is de taak inmiddels afgehandeld? Dan hoef je niets te doen.\n\nBoekenbaai';
}
function signature(payload, key) {
  return crypto.createHmac('sha256', key).update(payload).digest('hex');
}
async function bridgeSend({ config, id, to, subject, body, fetchImpl = fetch,
  now = Date.now() }) {
  if (!config.ready || !validEmail(to) || !/^[0-9a-f]{64}$/.test(id)
    || typeof subject !== 'string' || typeof body !== 'string'
    || subject.length > 150 || body.length > 4000) return false;
  const payload = JSON.stringify({ version: 1, id, timestamp: now,
    to, subject, body });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    // Apps Script's ContentService uses a 302 to an isolated Google host.
    // Never forward the signed POST to an arbitrary redirected destination.
    const first = await fetchImpl(config.url, {
      method: 'POST', redirect: 'manual', signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload, signature: signature(payload, config.key) }),
    });
    let response = first;
    if ([301, 302, 303].includes(first.status)) {
      const redirect = new URL(first.headers.get('location') || '');
      if (redirect.protocol !== 'https:'
        || !(redirect.hostname === 'script.googleusercontent.com'
          || redirect.hostname.endsWith('.googleusercontent.com'))) return false;
      response = await fetchImpl(redirect.href, {
        method: 'GET', redirect: 'error', signal: controller.signal,
      });
    }
    if (!response.ok) return false;
    const result = await response.json();
    return result?.ok === true && result?.id === id;
  } catch (_) { return false; }
  finally { clearTimeout(timeout); }
}
async function dispatchReminders({ db, links, folder, env = process.env,
  now = Date.now(), fetchImpl }) {
  const config = configuration(env);
  const result = { enabled: config.enabled, ready: config.ready,
    recipients: 0, claimed: 0, accepted: 0, failed: 0 };
  if (!config.ready) return result;
  const people = collectRecipients(db, links, now, config.schoolDomain);
  for (const person of people) {
    const ids = [];
    for (const task of person.tasks) {
      const id = claimId(person.teacherId, task);
      if (claimOnce(folder, id)) ids.push(id);
    }
    if (!ids.length) continue;
    result.recipients++;
    result.claimed += ids.length;
    // Batch task reminders into one message per recipient, not one per book.
    const accepted = await bridgeSend({ config, to: person.to,
      id: crypto.createHash('sha256').update(ids.join('|')).digest('hex'),
      subject: 'Boekenbaai: openstaande boekimportcontroles',
      body: mailText(ids.length, config.base + MAIL_PATH),
      now, fetchImpl });
    result[accepted ? 'accepted' : 'failed'] += ids.length;
  }
  return result;
}
function verificationHash(teacherId, email, code, secret) {
  return crypto.createHmac('sha256', secret)
    .update(JSON.stringify([teacherId, email, code])).digest('hex');
}
function beginVerification(db, teacherId, email, secret, now = Date.now()) {
  const normalized = validEmail(email);
  if (!normalized) return { ok: false, error: 'invalid_email' };
  const prev = prefsFor(db, teacherId);
  if (prev.pending && now - prev.pending.requestedAt < VERIFY_COOLDOWN_MS) {
    return { ok: false, error: 'rate_limited' };
  }
  const withinDay = now >= prev.verificationWindowStart
    && now - prev.verificationWindowStart < DAY_MS;
  if (withinDay && prev.verificationCount >= 3) {
    return { ok: false, error: 'daily_limit' };
  }
  const code = String(crypto.randomInt(0, 100000000)).padStart(8, '0');
  const next = { ...prev, revision: prev.revision + 1,
    verificationWindowStart: withinDay ? prev.verificationWindowStart : now,
    verificationCount: withinDay ? prev.verificationCount + 1 : 1,
    pending: { email: normalized, hash: verificationHash(teacherId, normalized, code, secret),
      requestedAt: now, expiresAt: now + VERIFY_LIFETIME_MS, attempts: 0 } };
  db.bookImportEmailPreferences = Object.assign(
    Object.create(null), db.bookImportEmailPreferences || {});
  db.bookImportEmailPreferences[teacherId] = next;
  return { ok: true, code, email: normalized, next };
}
function confirmVerification(db, teacherId, code, secret, now = Date.now()) {
  const previous = prefsFor(db, teacherId);
  const pending = previous.pending;
  if (!pending || pending.expiresAt < now || pending.attempts >= 5
    || !/^[0-9a-f]{64}$/.test(pending.hash || '')
    || !/^\d{8}$/.test(String(code))) return { ok: false, error: 'invalid_or_expired' };
  const candidate = verificationHash(teacherId, pending.email, String(code), secret);
  const equal = crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(pending.hash));
  if (!equal) {
    previous.pending.attempts++;
    previous.revision++;
    db.bookImportEmailPreferences[teacherId] = previous;
    return { ok: false, error: 'invalid_code', persist: true };
  }
  db.bookImportEmailPreferences[teacherId] = {
    ...previous, mode: 'alternate', alternateEmail: pending.email,
    revision: previous.revision + 1, pending: null,
  };
  return { ok: true };
}
function changePreference(db, teacherId, mode) {
  const previous = prefsFor(db, teacherId);
  if (!['school', 'off', 'alternate'].includes(mode)
    || (mode === 'alternate' && !validEmail(previous.alternateEmail))) return false;
  db.bookImportEmailPreferences = Object.assign(
    Object.create(null), db.bookImportEmailPreferences || {});
  db.bookImportEmailPreferences[teacherId] = { ...previous, mode,
    revision: previous.revision + 1 };
  return true;
}
module.exports = { HOUR_MS, MAIL_PATH, DAY_MS, configuration, validEmail,
  readSchoolLinks, prefsFor, schoolEmailFor, collectRecipients, claimId, claimOnce,
  mailText, signature, bridgeSend, dispatchReminders, beginVerification,
  confirmVerification, changePreference, verificationHash };
