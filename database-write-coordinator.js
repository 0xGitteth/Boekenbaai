'use strict';
// A narrow, filesystem-backed optimistic transaction for Boekenbaai's JSON DB.
// Each process reads a versioned snapshot. A writer obtains the shared lock,
// validates that the disk still contains that version, then atomically replaces
// it. A stale writer fails with 409 instead of erasing a concurrent change.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { acquireFileLock } = require('./book-import-reminder-mail');

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

function withDatabaseWriteLock(dataPath, work) {
  const absolute = path.resolve(dataPath);
  const release = acquireFileLock(absolute + '.database-write.lock');
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

function commitJsonSnapshot({ dataPath, value, beforeWrite }) {
  const absolute = path.resolve(dataPath);
  return withDatabaseWriteLock(absolute, () => {
    assertSnapshotCurrent(absolute, value);
    if (beforeWrite) beforeWrite();
    const raw = JSON.stringify(value, null, 2);
    atomicWrite(absolute, raw);
    versions.set(value, { path: absolute, hash: fingerprint(raw) });
  });
}

module.exports = { readJsonSnapshot, inheritSnapshot, commitJsonSnapshot,
  assertSnapshotCurrent, withDatabaseWriteLock };
