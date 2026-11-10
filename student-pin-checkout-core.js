'use strict';

// A successful PIN challenge issues a short-lived, single-use capability
// for one physical book checkout. It never creates a login session.
const crypto = require('node:crypto');
const path = require('node:path');
const core = require('./google-auth-core');
const pins = require('./student-pin-core');
const { readJsonSnapshot, mutateJsonLocked, mutateJsonLockedAsync } =
  require('./database-write-coordinator');

const DATA_PATH = process.env.BOEKENBAAI_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_DATA_PATH)
  : path.join(__dirname, 'data', 'db.json');
const AUTH_PATH = process.env.BOEKENBAAI_AUTH_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_AUTH_DATA_PATH)
  : DATA_PATH + '.auth.json';
const SECRET = pins.configuredSecret();
const GRANT_TTL_MS = 60_000;
const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60_000;

function loadDb() {
  const db = readJsonSnapshot(DATA_PATH);
  if (!db || typeof db !== 'object' || Array.isArray(db)) throw Error('invalid_database');
  return db;
}
function loadAuth() {
  const store = readJsonSnapshot(AUTH_PATH, { missingValue: core.emptyAuthStore() });
  if (!store || typeof store !== 'object' || Array.isArray(store)) throw Error('invalid_auth');
  return core.pruneStore(core.normalizeStore(store));
}

function error(message, status = 401) {
  const result = new Error(message);
  result.status = status;
  return result;
}
function activeStudent(db, studentId) {
  return (db.students || []).find(student =>
    student?.id === studentId && student.active !== false
    && student.status !== 'inactive') || null;
}
function availableBook(db, bookId) {
  return (db.books || []).some(book =>
    book?.id === bookId && book.status !== 'borrowed'
    && !book.borrowedBy && !book.borrowedByClassId);
}
function currentLink(auth, studentId) {
  const link = core.findLinkByAccount(auth, 'student', studentId);
  return link?.sub && link?.email ? link : null;
}
function credentialUsable(db, auth, studentId, bookId) {
  if (!activeStudent(db, studentId) || !availableBook(db, bookId)) return null;
  const link = currentLink(auth, studentId);
  const credential = pins.credentialFor(auth, studentId);
  if (!link || !credential?.hash || !credential?.salt
    || credential.linkedSub !== link.sub) return null;
  return { link, credential };
}

function rateEntry(auth, studentId, now) {
  if (!Array.isArray(auth.pinAttemptLimits)) auth.pinAttemptLimits = [];
  let record = auth.pinAttemptLimits.find(item => item.studentId === studentId);
  if (!record) {
    record = { studentId, attempts: [], blockedUntil: 0, updatedAt: now };
    auth.pinAttemptLimits.push(record);
  }
  record.attempts = (Array.isArray(record.attempts) ? record.attempts : [])
    .filter(time => Number.isFinite(time) && time > now - WINDOW_MS);
  return record;
}
async function issueGrant({ studentId, bookId, pin, now = Date.now() }) {
  if (!SECRET) throw error('PIN-uitlenen is niet geconfigureerd.', 503);
  if (typeof studentId !== 'string' || !/^[\w-]{1,100}$/.test(studentId)
    || typeof bookId !== 'string' || !/^[\w-]{1,100}$/.test(bookId)
    || !pins.validPin(pin)) throw error('Ongeldige naam of PIN.');
  // Reserve an attempt under the cross-process DB/auth lock BEFORE doing KDF
  // work. Five attempts per student/15 minutes, across processes and restarts.
  let snapshot = null;
  await mutateJsonLockedAsync({
    lockPath: DATA_PATH, filePath: AUTH_PATH, read: loadAuth, waitMs: 1800,
    mutate: auth => {
      const db = loadDb();
      const record = rateEntry(auth, studentId, now);
      if (Number(record.blockedUntil) > now) {
        throw error('Te veel pogingen. Probeer het later opnieuw.', 429);
      }
      if (record.attempts.length >= MAX_ATTEMPTS) {
        record.blockedUntil = now + LOCK_MS;
        record.updatedAt = now;
        snapshot = null;
        return auth;
      }
      record.attempts.push(now);
      record.updatedAt = now;
      snapshot = credentialUsable(db, auth, studentId, bookId);
      return auth;
    },
  });
  if (snapshot === null) {
    const current = loadAuth().pinAttemptLimits?.find(item => item.studentId === studentId);
    if (Number(current?.blockedUntil) > now) throw error('Te veel pogingen. Probeer het later opnieuw.', 429);
    // Missing or inactive users, missing PIN, absent books etc. are not
    // distinguishable from a wrong PIN to an unauthenticated visitor.
    throw error('Controleer je naam en PIN. Je kunt ook met Google inloggen.');
  }

  const success = await pins.verifyCredential(
    pin, studentId, SECRET, snapshot.credential, snapshot.link.sub);
  if (!success) throw error('Controleer je naam en PIN. Je kunt ook met Google inloggen.');

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = core.tokenHash(token);
  await mutateJsonLockedAsync({
    lockPath: DATA_PATH, filePath: AUTH_PATH, read: loadAuth, waitMs: 1800,
    mutate: auth => {
      const db = loadDb();
      const latest = credentialUsable(db, auth, studentId, bookId);
      const limit = rateEntry(auth, studentId, Date.now());
      if (!latest || latest.credential.hash !== snapshot.credential.hash
        || pins.currentGeneration(latest.credential) !==
          pins.currentGeneration(snapshot.credential)
        || latest.link.sub !== snapshot.link.sub
        || Number(limit.blockedUntil) > Date.now()) {
        throw error('PIN of boekgegevens zijn veranderd. Probeer opnieuw.', 409);
      }
      limit.attempts = [];
      limit.blockedUntil = 0;
      limit.updatedAt = Date.now();
      if (!Array.isArray(auth.pinCheckoutGrants)) auth.pinCheckoutGrants = [];
      auth.pinCheckoutGrants.push({
        tokenHash, studentId, bookId,
        generation: pins.currentGeneration(latest.credential),
        linkedSub: latest.link.sub,
        expiresAt: Date.now() + GRANT_TTL_MS,
      });
      return auth;
    },
  });
  return { grant: token, expiresInSeconds: GRANT_TTL_MS / 1000 };
}

function consumeGrant(grant, bookId) {
  if (typeof grant !== 'string' || !/^[a-zA-Z0-9_-]{32,100}$/.test(grant)
    || typeof bookId !== 'string' || !/^[\w-]{1,100}$/.test(bookId)) return null;
  const hash = core.tokenHash(grant);
  let studentId = null;
  mutateJsonLocked({
    lockPath: DATA_PATH, filePath: AUTH_PATH, read: loadAuth,
    mutate: auth => {
      const db = loadDb();
      const list = Array.isArray(auth.pinCheckoutGrants) ? auth.pinCheckoutGrants : [];
      const entry = list.find(item => item.tokenHash === hash);
      // Always consume the token, even if the identifier doesn't match.
      auth.pinCheckoutGrants = list.filter(item => item.tokenHash !== hash);
      if (entry && entry.bookId === bookId && Number(entry.expiresAt) > Date.now()) {
        const credential = pins.credentialFor(auth, entry.studentId);
        const link = currentLink(auth, entry.studentId);
        if (activeStudent(db, entry.studentId) && credential?.hash
          && pins.currentGeneration(credential) === entry.generation
          && credential.linkedSub === entry.linkedSub
          && link?.sub === entry.linkedSub) {
          studentId = entry.studentId;
        }
      }
      return auth;
    },
  });
  return studentId;
}

module.exports = { issueGrant, consumeGrant, GRANT_TTL_MS };
