'use strict';
// PR7: school-import email notification core. No student/borrower data is mailed.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
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
    revision: 0, verificationWindowStart: 0, verificationCount: 0,
    lastVerificationRequestedAt: 0, verificationRequests: [] };
  return { mode: ['school', 'alternate', 'off'].includes(row.mode) ? row.mode : 'school',
    alternateEmail: validEmail(row.alternateEmail) || '',
    revision: Number.isSafeInteger(row.revision) ? row.revision : 0,
    verificationWindowStart: Number.isSafeInteger(row.verificationWindowStart)
      ? row.verificationWindowStart : 0,
    verificationCount: Number.isSafeInteger(row.verificationCount)
      ? row.verificationCount : 0,
    lastVerificationRequestedAt: Number.isSafeInteger(row.lastVerificationRequestedAt)
      ? row.lastVerificationRequestedAt : 0,
    verificationRequests: Array.isArray(row.verificationRequests)
      ? row.verificationRequests.filter(Number.isSafeInteger).slice(-3) : [],
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

// The guard prevents two processes from reclaiming one another's locks.
// Unlike mail locks, process-owned DATABASE guards also carry PID/host metadata
// so a crashed guard owner cannot permanently block database recovery.
// PID 1 can be reused after a container restart. Linux /proc start ticks
// distinguish the process generation without a third orphanable lock file.
function processStartTicks(pid) {
  try {
    const raw = fs.readFileSync('/proc/' + pid + '/stat', 'utf8');
    const end = raw.lastIndexOf(') ');
    if (end < 0) return '';
    const start = raw.slice(end + 2).trim().split(/\s+/)[19];
    return /^\d+$/.test(start || '') ? start : '';
  } catch (error) {
    if (['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR'].includes(error?.code)) return '';
    throw error;
  }
}
const SELF_PROCESS_START_TICKS = processStartTicks(process.pid);
function guardOwnerMetadata() {
  return {
    format: 'boekenbaai-lock-guard-v1',
    pid: process.pid, host: os.hostname(),
    ...(SELF_PROCESS_START_TICKS ? { pidStartTicks: SELF_PROCESS_START_TICKS } : {}),
  };
}
function deadLocalOwner(record) {
  if (!record || record.format !== 'boekenbaai-lock-guard-v1'
    || record.host !== os.hostname()
    || !Number.isSafeInteger(record.pid) || record.pid <= 0) return false;
  try {
    process.kill(record.pid, 0);
  } catch (error) {
    if (error?.code === 'ESRCH') return true;
    if (error?.code === 'EPERM') return false;
    throw error;
  }
  const currentStart = processStartTicks(record.pid);
  return Boolean(record.pidStartTicks && currentStart
    && String(record.pidStartTicks) !== currentStart);
}

// Guards/reapers contain no asynchronous work. When a deployment changes
// hostname there is no portable way to probe the old PID. Keep fail-closed
// for five minutes, then permit recovering the abandoned synchronous guard.
// A known LIVE local PID is never reclaimed merely for being old.
const ORPHAN_GUARD_STALE_MS = 5 * 60 * 1000;
function reclaimableGuardArtifact(owner, contents, stat) {
  if (deadLocalOwner(owner)) return true;
  const localOwner = owner?.format === 'boekenbaai-lock-guard-v1'
    && owner.host === os.hostname()
    && Number.isSafeInteger(owner.pid) && owner.pid > 0;
  // A matching kernel start signature proves the SAME process still owns
  // this file. Old PID-only records are recoverable after the stale period.
  if (localOwner && owner.pidStartTicks
    && processStartTicks(owner.pid) === String(owner.pidStartTicks)) return false;
  const age = Date.now() - stat.mtimeMs;
  return age > (contents.trim() ? ORPHAN_GUARD_STALE_MS : 30000);
}

function acquireGuardReaper(gate) {
  const filename = gate + '.reaper';
  function create() {
    let fd;
    try { fd = fs.openSync(filename, 'wx', 0o600); }
    catch (error) {
      if (error?.code === 'EEXIST') return null;
      throw error;
    }
    try {
      fs.writeFileSync(fd, JSON.stringify(guardOwnerMetadata()));
      fs.fsyncSync(fd);
    } catch (error) {
      fs.closeSync(fd);
      try { fs.unlinkSync(filename); }
      catch (cleanup) { if (cleanup?.code !== 'ENOENT') throw cleanup; }
      throw error;
    }
    return () => {
      fs.closeSync(fd);
      fs.unlinkSync(filename);
    };
  }

  let release = create();
  if (release) return release;
  // The recovery lock itself is also process-owned. It has no third-tier
  // lock: first check the owner's liveness and *recheck* the same inode and
  // content immediately before removing a provably dead owner's file.
  let previous;
  let stat;
  try {
    stat = fs.statSync(filename);
    previous = fs.readFileSync(filename, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return create();
    throw error;
  }
  let owner;
  try { owner = JSON.parse(previous); } catch { owner = null; }
  if (!reclaimableGuardArtifact(owner, previous, stat)) return null;
  try {
    const freshStat = fs.statSync(filename);
    if (freshStat.ino !== stat.ino || freshStat.dev !== stat.dev
      || fs.readFileSync(filename, 'utf8') !== previous) return null;
    fs.unlinkSync(filename);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return create();
}

function reclaimDeadGuard(gate) {
  // The reaper is owned by a live process or can be reclaimed after its
  // process exits; a second crash cannot permanently wedge the write lock.
  const release = acquireGuardReaper(gate);
  if (!release) return false;
  try {
    let observed;
    try { observed = fs.readFileSync(gate, 'utf8'); }
    catch (error) {
      if (error?.code === 'ENOENT') return true;
      throw error;
    }
    let owner;
    try { owner = JSON.parse(observed); }
    catch { owner = null; }
    let stat;
    try { stat = fs.statSync(gate); }
    catch (error) {
      if (error?.code === 'ENOENT') return true;
      throw error;
    }
    if (!reclaimableGuardArtifact(owner, observed, stat)) return false;
    // Do not remove a replaced guard after a concurrent owner acquired it.
    const current = fs.statSync(gate);
    if (current.ino !== stat.ino || current.dev !== stat.dev
      || fs.readFileSync(gate, 'utf8') !== observed) return false;
    fs.unlinkSync(gate);
    return true;
  } finally {
    release();
  }
}
function withLockGuard(filename, operation, { processOwned = false } = {}) {
  const gate = filename + '.guard';
  let fd;
  function openGuard() {
    try { return fs.openSync(gate, 'wx', 0o600); }
    catch (error) {
      if (error?.code === 'EEXIST') return null;
      throw error;
    }
  }
  fd = openGuard();
  if (!fd && processOwned && reclaimDeadGuard(gate)) fd = openGuard();
  if (!fd) return null;
  try {
    if (processOwned) {
      fs.writeFileSync(fd, JSON.stringify(guardOwnerMetadata()));
      fs.fsyncSync(fd);
    }
    return operation();
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(gate);
  }
}
function acquireFileLock(filename, { staleMs = 300000, processOwned = false } = {}) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const owner = crypto.randomBytes(24).toString('hex');
  const contents = processOwned ? JSON.stringify({
    format: 'boekenbaai-process-lock-v1', owner, pid: process.pid, host: os.hostname(),
    ...(SELF_PROCESS_START_TICKS ? { pidStartTicks: SELF_PROCESS_START_TICKS } : {}),
  }) : owner;
  function createOwnedLock() {
    const fd = fs.openSync(filename, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, contents);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    let released = false;
    return () => {
      if (released) return;
      // Retain ownership if the guard is briefly unavailable. The lock
      // expires and can be reaped safely under the same guard if necessary.
      const success = withLockGuard(filename, () => {
        let observed;
        try { observed = fs.readFileSync(filename, 'utf8'); }
        catch (error) {
          if (error.code === 'ENOENT') return true;
          throw error;
        }
        if (observed === contents) fs.unlinkSync(filename);
        return true;
      }, { processOwned });
      if (success) released = true;
      else {
        // A guard is held only for synchronous filesystem operations.
        // Do not abandon the lock on a transient EEXIST: callers otherwise
        // cannot release the owned lock until stale recovery.
        const pause = new Int32Array(new SharedArrayBuffer(4));
        for (let attempt = 0; attempt < 50 && !released; attempt++) {
          Atomics.wait(pause, 0, 0, 2);
          const retry = withLockGuard(filename, () => {
            let observed;
            try { observed = fs.readFileSync(filename, 'utf8'); }
            catch (error) {
              if (error.code === 'ENOENT') return true;
              throw error;
            }
            if (observed === contents) fs.unlinkSync(filename);
            return true;
          }, { processOwned });
          if (retry) released = true;
        }
        if (!released) throw new Error('Lock guard bleef bezet tijdens vrijgave');
      }
    };
  }
  return withLockGuard(filename, () => {
    try { return createOwnedLock(); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    let stat;
    try { stat = fs.statSync(filename); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return createOwnedLock();
    }
    // This is a PROCESS-owned main database lock, not an arbitrary stale
    // mail lock. A recycled PID must not mask the death of the old writer,
    // and a VERIFIED live writer must never be stolen merely because a
    // long-running database operation exceeded the stale timeout.
    if (processOwned) {
      let previous = null;
      try { previous = JSON.parse(fs.readFileSync(filename, 'utf8')); }
      catch (error) {
        if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      }
      if (previous?.format === 'boekenbaai-process-lock-v1'
        && previous.host === os.hostname()
        && Number.isSafeInteger(previous.pid) && previous.pid > 0) {
        let dead = false;
        let knownLive = false;
        try {
          process.kill(previous.pid, 0);
          const nowTicks = processStartTicks(previous.pid);
          if (previous.pidStartTicks && nowTicks) {
            dead = String(previous.pidStartTicks) !== nowTicks;
            knownLive = !dead;
          }
        } catch (error) {
          if (error?.code === 'ESRCH') dead = true;
          else if (error?.code !== 'EPERM') throw error;
        }
        if (dead) {
          fs.unlinkSync(filename);
          return createOwnedLock();
        }
        if (knownLive) return null;
        // Older PID-only records cannot distinguish a restarted container.
        // Allow only their bounded, age-based recovery below.
      }
    }
    if (Date.now() - stat.mtimeMs <= staleMs) return null;
    // Protected by the guard. Re-inspect before unlinking so the reclaim
    // decision is made on the current file, not a previous observation.
    fs.unlinkSync(filename);
    return createOwnedLock();
  }, { processOwned });
}
function recipientLockPath(folder, recipientId) {
  const hash = crypto.createHash('sha256').update(String(recipientId)).digest('hex');
  return path.join(folder, 'locks', hash + '.lock');
}
async function withRecipientLock(folder, recipientId, job) {
  const release = acquireFileLock(recipientLockPath(folder, recipientId));
  if (!release) return false;
  try { await job(); return true; } finally { release(); }
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
  now = Date.now(), fetchImpl, currentState, shouldStop = () => false }) {
  const config = configuration(env);
  const result = { enabled: config.enabled, ready: config.ready,
    recipients: 0, claimed: 0, accepted: 0, failed: 0 };
  if (!config.ready) return result;
  const people = collectRecipients(db, links, now, config.schoolDomain);
  for (const person of people) {
    if (shouldStop()) break;
    await withRecipientLock(folder, 'teacher:' + person.teacherId, async () => {
      const latest = currentState ? currentState() : { db, links };
      const current = collectRecipients(latest.db, latest.links, now, config.schoolDomain)
        .find(row => row.teacherId === person.teacherId && row.to === person.to);
      if (!current || shouldStop()) return;
      // The recipient lock encloses ALL task claims and the delivery attempt;
      // overlapping workers cannot split one teacher's batch across mails.
      const ids = [];
      for (const task of current.tasks) {
        const id = claimId(person.teacherId, task);
        if (claimOnce(folder, id)) ids.push(id);
      }
      if (!ids.length) return;
      result.recipients++;
      result.claimed += ids.length;
      const accepted = await bridgeSend({ config, to: person.to,
        id: crypto.createHash('sha256').update(ids.join('|')).digest('hex'),
        subject: 'Boekenbaai: openstaande boekcontroles voor jouw klas',
        body: mailText(current.tasks.length, config.base + MAIL_PATH),
        now: Date.now(), fetchImpl });
      result[accepted ? 'accepted' : 'failed'] += ids.length;
    });
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
  // Pending verification can be cancelled or confirmed without resetting
  // the five-minute request limit.
  if (prev.lastVerificationRequestedAt
    && now - prev.lastVerificationRequestedAt < VERIFY_COOLDOWN_MS) {
    return { ok: false, error: 'rate_limited' };
  }
  // Rolling 24h quota, with conservative fallback for old fixed-window
  // preferences created by earlier PR7 versions.
  const recent = prev.verificationRequests.filter(t => t <= now && t > now - DAY_MS);
  if (!prev.verificationRequests.length && prev.verificationCount > 0
    && now - prev.verificationWindowStart < DAY_MS
    && now >= prev.verificationWindowStart) {
    while (recent.length < prev.verificationCount) recent.push(prev.verificationWindowStart);
  }
  if (recent.length >= 3) return { ok: false, error: 'daily_limit' };
  const code = String(crypto.randomInt(0, 100000000)).padStart(8, '0');
  const next = { ...prev, revision: prev.revision + 1,
    verificationWindowStart: recent.length ? Math.min(...recent) : now,
    verificationCount: recent.length + 1,
    verificationRequests: [...recent, now],
    lastVerificationRequestedAt: now,
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
    pending: null, revision: previous.revision + 1 };
  return true;
}
module.exports = { HOUR_MS, MAIL_PATH, DAY_MS, configuration, validEmail,
  readSchoolLinks, prefsFor, schoolEmailFor, collectRecipients, claimId, claimOnce,
  mailText, signature, bridgeSend, dispatchReminders, beginVerification,
  confirmVerification, changePreference, verificationHash, acquireFileLock,
  recipientLockPath, withRecipientLock };
