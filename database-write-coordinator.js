'use strict';
// A narrow, filesystem-backed optimistic transaction for Boekenbaai's JSON DB.
// Each process reads a versioned snapshot. A writer obtains the shared lock,
// validates that the disk still contains that version, then atomically replaces
// it. A stale writer fails with 409 instead of erasing a concurrent change.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { acquireFileLock } = require('./book-import-reminder-mail');
const { enforceGoogleLinkInvariants } = require('./google-link-transaction-core');

const versions = new WeakMap();

function fingerprint(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function conflict(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function readJsonSnapshot(filePath, { missingValue } = {}) {
  const absolute = path.resolve(filePath);
  let raw = null;
  try { raw = fs.readFileSync(absolute, 'utf8'); }
  catch (error) {
    if (error?.code !== 'ENOENT' || missingValue === undefined) throw error;
  }
  const value = raw === null ? structuredClone(missingValue) : JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw conflict('DATABASE_INVALID', 'Database heeft een ongeldig formaat.');
  }
  versions.set(value, { path: absolute, hash: raw === null ? null : fingerprint(raw) });
  return value;
}

// Preserve the expected on-disk version if a caller must copy a snapshot.
// Passing a fresh object without explicit provenance is rejected.
function inheritSnapshot(next, original) {
  const version = versions.get(original);
  if (!version || !next || typeof next !== 'object' || Array.isArray(next)) {
    throw conflict('DATABASE_SNAPSHOT_UNTRACKED', 'Databaseversie is onbekend.');
  }
  versions.set(next, { ...version });
  return next;
}

function atomicWrite(filePath, raw) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let mode = 0o600;
  try { mode = fs.statSync(filePath).mode & 0o777; }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  const temporary = filePath + '.' + process.pid + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
  try {
    fs.writeFileSync(temporary, raw, { flag: 'wx', mode });
    fs.renameSync(temporary, filePath);
  } finally {
    try { fs.unlinkSync(temporary); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
}

function withDatabaseWriteLock(dataPath, work, { waitMs = 0 } = {}) {
  const absolute = path.resolve(dataPath);
  const lockFile = absolute + '.database-write.lock';
  const maxWait = Number.isFinite(waitMs) ? Math.min(Math.max(0, waitMs), 15000) : 0;
  const deadline = Date.now() + maxWait;
  const pause = maxWait ? new Int32Array(new SharedArrayBuffer(4)) : null;
  let release = acquireFileLock(lockFile);
  while (!release && Date.now() < deadline) {
    Atomics.wait(pause, 0, 0, Math.min(20, Math.max(1, deadline - Date.now())));
    release = acquireFileLock(lockFile);
  }
  if (!release) {
    throw conflict('DATABASE_WRITE_BUSY', 'Andere databasewijziging is nog bezig.');
  }
  try {
    const result = work();
    if (result && typeof result.then === 'function') {
      throw conflict('DATABASE_ASYNC_WRITE',
        'Een database-transactie mag geen asynchrone operatie bevatten.');
    }
    return result;
  } finally {
    release();
  }
}

function assertNoPendingPairedJournal(dataPath) {
  const journalPath = path.resolve(dataPath) + '.paired-store-journal.json';
  if (fs.existsSync(journalPath)) {
    throw conflict('DATABASE_RECOVERY_REQUIRED',
      'Er staat nog een onvoltooide gecombineerde opslag klaar voor herstel.');
  }
}

function assertSnapshotCurrent(filePath, snapshot) {
  const absolute = path.resolve(filePath);
  const expected = versions.get(snapshot);
  if (!expected || expected.path !== absolute) {
    throw conflict('DATABASE_SNAPSHOT_UNTRACKED', 'Databasewijziging zonder geldige versie geweigerd.');
  }
  let raw = null;
  try { raw = fs.readFileSync(absolute, 'utf8'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  const actual = raw === null ? null : fingerprint(raw);
  if (actual !== expected.hash) {
    throw conflict('DATABASE_WRITE_CONFLICT',
      'Database is veranderd sinds het inlezen; de wijziging is niet opgeslagen.');
  }
}

function commitJsonSnapshot({ dataPath, value, beforeWrite, lockPath = dataPath }) {
  const absolute = path.resolve(dataPath);
  return withDatabaseWriteLock(lockPath, () => {
    assertNoPendingPairedJournal(lockPath);
    assertSnapshotCurrent(absolute, value);
    if (beforeWrite) {
      const validation = beforeWrite();
      if (validation && typeof validation.then === 'function') {
        throw conflict('DATABASE_ASYNC_WRITE', 'Opslagvalidatie moet synchroon plaatsvinden.');
      }
    }
    let committed = value;
    if (absolute !== path.resolve(lockPath)) {
      let oldAuth = {};
      try { oldAuth = JSON.parse(fs.readFileSync(absolute, 'utf8')); }
      catch (error) { if (error?.code !== 'ENOENT') throw error; }
      committed = enforceGoogleLinkInvariants(oldAuth, value);
    }
    const raw = JSON.stringify(committed, null, 2);
    atomicWrite(absolute, raw);
    if (committed !== value) Object.assign(value, committed);
    versions.set(value, { path: absolute, hash: fingerprint(raw) });
  });
}

function mutateJsonLocked({ lockPath, filePath, read, mutate }) {
  if (typeof read !== 'function' || typeof mutate !== 'function') {
    throw new TypeError('Read and mutate callbacks are required.');
  }
  return withDatabaseWriteLock(lockPath, () => {
    assertNoPendingPairedJournal(lockPath);
    const latest = read();
    const next = mutate(latest);
    if (next && typeof next.then === 'function') {
      throw conflict('DATABASE_ASYNC_WRITE', 'Mutaties moeten synchroon plaatsvinden.');
    }
    if (next === false) return false;
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      throw conflict('DATABASE_INVALID', 'Ongeldig resultaat van databasewijziging.');
    }
    const committed = path.resolve(filePath) === path.resolve(lockPath)
      ? next : enforceGoogleLinkInvariants(latest, next);
    atomicWrite(path.resolve(filePath), JSON.stringify(committed, null, 2));
    return true;
  });
}

module.exports = { readJsonSnapshot, inheritSnapshot, commitJsonSnapshot,
  assertSnapshotCurrent, assertNoPendingPairedJournal,
  withDatabaseWriteLock, mutateJsonLocked };
