'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { enforceGoogleLinkInvariants } = require('./google-link-transaction-core');
const { withDatabaseWriteLock, assertSnapshotCurrent,
  assertNoPendingPairedJournal } = require('./database-write-coordinator');

function ensureObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} heeft een ongeldig formaat.`);
  }
  return value;
}

function journalPathFor(dataPath) {
  return `${dataPath}.paired-store-journal.json`;
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  let mode = 0o600;
  try {
    mode = fs.statSync(filePath).mode & 0o777;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode });
    fs.renameSync(tmp, filePath);
  } finally {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch (error) {
      // Best effort cleanup; het journal blijft leidend voor herstel.
    }
  }
}

function readJournal(journalPath) {
  let raw;
  try {
    raw = fs.readFileSync(journalPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const wrapped = new Error('Het hersteljournal voor Boekenbaai is beschadigd.');
    wrapped.code = 'PAIRED_STORE_JOURNAL_CORRUPT';
    throw wrapped;
  }
  if (parsed?.version !== 1) {
    const error = new Error('Het hersteljournal heeft een onbekende versie.');
    error.code = 'PAIRED_STORE_JOURNAL_UNSUPPORTED';
    throw error;
  }
  ensureObject(parsed.data, 'Database in hersteljournal');
  ensureObject(parsed.auth, 'Auth-opslag in hersteljournal');
  return parsed;
}

function removeJournal(journalPath) {
  try {
    fs.unlinkSync(journalPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function recoverPairedJson({ dataPath, authPath }) {
  if (!dataPath || !authPath) throw new Error('Database- en auth-pad zijn verplicht voor herstel.');
  return withDatabaseWriteLock(dataPath, () => {
    const journalPath = journalPathFor(dataPath);
    const journal = readJournal(journalPath);
    if (!journal) return false;
    atomicWriteJson(dataPath, journal.data);
    atomicWriteJson(authPath, journal.auth);
    removeJournal(journalPath);
    return true;
  });
}

function commitPairedJson({ dataPath, authPath, data, auth, expectedData, expectedAuth }) {
  if (!dataPath || !authPath) throw new Error('Database- en auth-pad zijn verplicht voor opslag.');
  ensureObject(data, 'Database');
  ensureObject(auth, 'Auth-opslag');
  // Both file versions are mandatory. Never commit a pair built from a
  // snapshot that may predate another writer or recovered journal.
  return withDatabaseWriteLock(dataPath, () => {
    assertNoPendingPairedJournal(dataPath);
    assertSnapshotCurrent(dataPath, expectedData);
    assertSnapshotCurrent(authPath, expectedAuth);
    const journalPath = journalPathFor(dataPath);
    atomicWriteJson(journalPath, {
      version: 1,
      createdAt: new Date().toISOString(),
      data,
      auth: enforceGoogleLinkInvariants(expectedAuth, auth),
    });
    // Replay exactly the security-validated pair recorded in the journal.
    const journal = readJournal(journalPath);
    atomicWriteJson(dataPath, data);
    atomicWriteJson(authPath, journal.auth);
    removeJournal(journalPath);
  });
}

module.exports = {
  commitPairedJson,
  recoverPairedJson,
  journalPathFor,
  __test: {
    atomicWriteJson,
    readJournal,
  },
};
