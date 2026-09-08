'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');
const core = require('./google-auth-core');
const { setParnassysStudentNumber, getParnassysStudentNumber } = require('./google-first-people-import');

const DEFAULT_DATA_PATH = path.join(__dirname, 'data', 'db.json');
const DATA_PATH = process.env.BOEKENBAAI_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_DATA_PATH)
  : DEFAULT_DATA_PATH;
const AUTH_DATA_PATH = process.env.BOEKENBAAI_AUTH_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_AUTH_DATA_PATH)
  : `${DATA_PATH}.auth.json`;
const SESSION_COOKIE = 'boekenbaai_session';
const SESSION_HINT_COOKIE = 'boekenbaai_auth_hint';
const MAX_BODY_BYTES = 64 * 1024;
const REVOKED_TOKEN_RETENTION_MS = 31 * 24 * 60 * 60 * 1000;
const originalCreateServer = http.createServer.bind(http);

function readJsonStrict(filePath, { missingValue, label }) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT' && missingValue !== undefined) return missingValue;
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    const wrapped = new Error(`${label || 'JSON-bestand'} is beschadigd.`);
    wrapped.code = 'CORRUPT_JSON';
    throw wrapped;
  }
}

function writeJsonAtomic(filePath, value) {
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
      // Best effort cleanup.
    }
  }
}

function readMainDb() {
  const db = readJsonStrict(DATA_PATH, { label: 'Boekenbaai database' });
  if (!db || typeof db !== 'object' || Array.isArray(db)) {
    throw new Error('Boekenbaai database heeft een ongeldig formaat.');
  }
  if (!Array.isArray(db.users)) db.users = [];
  if (!Array.isArray(db.students)) db.students = [];
  if (!Array.isArray(db.classes)) db.classes = [];
  if (!Array.isArray(db.books)) db.books = [];
  if (!Array.isArray(db.history)) db.history = [];
  if (!Array.isArray(db.studentTransferRequests)) db.studentTransferRequests = [];
  if (!Array.isArray(db.revokedStudentSessions)) db.revokedStudentSessions = [];
  return db;
}

function loadAuthStore() {
  const raw = readJsonStrict(AUTH_DATA_PATH, {
    missingValue: core.emptyAuthStore(),
    label: 'Auth-opslag',
  });
  return core.pruneStore(core.normalizeStore(raw));
}

function saveAuthStore(store) {
  const safe = core.pruneStore(core.normalizeStore(store));
  writeJsonAtomic(AUTH_DATA_PATH, safe);
  return safe;
}

function parseCookies(req) {
  const result = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const raw = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(raw);
    } catch (error) {
      result[key] = raw;
    }
  }
  return result;
}

function getBearerToken(req) {
  const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function getRequestTokens(req) {
  const bearer = getBearerToken(req);
  const cookie = parseCookies(req)[SESSION_COOKIE] || '';
  return Array.from(new Set([bearer && bearer !== 'cookie' ? bearer : '', cookie].filter(Boolean)));
}

function resolveStaff(req) {
  const db = readMainDb();
  const store = loadAuthStore();
  for (const token of getRequestTokens(req)) {
    const session = core.resolveSession(store, token);
    if (!session || session.type !== 'staff') continue;
    const user = db.users.find(
      (entry) => entry?.id === session.userId && ['teacher', 'admin'].includes(entry?.role)
    );
    if (user) return { db, store, user, token };
  }
  return null;
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      body += chunk.toString();
      if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
        tooLarge = true;
        body = '';
      }
    });
    req.on('end', () => {
      if (tooLarge) return reject(Object.assign(new Error('Payload te groot'), { code: 'BODY_TOO_LARGE' }));
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(Object.assign(new Error('Ongeldige JSON'), { code: 'INVALID_JSON' }));
      }
    });
    req.on('error', reject);
  });
}

function normalizeName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('nl-NL');
}

function splitName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  const parts = name.split(' ').filter(Boolean);
  return {
    name,
    firstName: parts[0] || '',
    lastName: parts.length > 1 ? parts[parts.length - 1] : '',
  };
}

function slugUsername(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 42) || 'leerling';
}

function uniqueUsername(db, value) {
  const used = new Set([
    ...db.students.map((entry) => String(entry?.username || '').toLowerCase()),
    ...db.users.map((entry) => String(entry?.username || '').toLowerCase()),
  ]);
  const base = slugUsername(value);
  if (!used.has(base)) return base;
  for (let index = 2; index < 10000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${crypto.randomBytes(4).toString('hex')}`;
}

function internalPasswordHash() {
  return crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex');
}

function managedClassIds(db, user) {
  if (user?.role === 'admin') return new Set(db.classes.map((entry) => entry.id));
  const ids = new Set(Array.isArray(user?.classIds) ? user.classIds.filter(Boolean) : []);
  for (const klass of db.classes) {
    if (Array.isArray(klass?.teacherIds) && klass.teacherIds.includes(user?.id)) ids.add(klass.id);
  }
  return ids;
}

function studentClassIds(db, student) {
  const ids = new Set(Array.isArray(student?.classIds) ? student.classIds.filter(Boolean) : []);
  for (const klass of db.classes) {
    if (Array.isArray(klass?.studentIds) && klass.studentIds.includes(student?.id)) ids.add(klass.id);
  }
  return Array.from(ids);
}

function classNames(db, ids) {
  const wanted = new Set(ids || []);
  return db.classes.filter((entry) => wanted.has(entry.id)).map((entry) => entry.name).filter(Boolean);
}

function canManageStudent(db, user, student) {
  if (!student || student.active === false) return false;
  if (user?.role === 'admin') return true;
  const own = managedClassIds(db, user);
  return studentClassIds(db, student).some((id) => own.has(id));
}

function ownsClass(db, user, classId) {
  return user?.role === 'admin' || managedClassIds(db, user).has(classId);
}

function ensureClassMembership(db, student, classIds) {
  const desired = Array.from(new Set((classIds || []).filter(Boolean)));
  student.classIds = desired;
  for (const klass of db.classes) {
    klass.studentIds = Array.isArray(klass.studentIds) ? klass.studentIds : [];
    const shouldHave = desired.includes(klass.id);
    const has = klass.studentIds.includes(student.id);
    if (shouldHave && !has) klass.studentIds.push(student.id);
    if (!shouldHave && has) klass.studentIds = klass.studentIds.filter((id) => id !== student.id);
  }
}

function appendHistory(db, type, message, extra = {}) {
  db.history.push({
    id: crypto.randomUUID(),
    type,
    message,
    timestamp: new Date().toISOString(),
    ...extra,
  });
}

function sanitizeStudent(db, store, student) {
  const ids = studentClassIds(db, student);
  const link = core.findLinkByAccount(store, 'student', student.id);
  return {
    id: student.id,
    name: student.name || '',
    firstName: student.firstName || '',
    lastName: student.lastName || '',
    classIds: ids,
    classNames: classNames(db, ids),
    parnassysStudentNumber: getParnassysStudentNumber(student),
    active: student.active !== false,
    googleLinked: Boolean(link?.sub),
    googleEmail: link?.email || '',
    borrowedCount: activeBorrowedBooks(db, student).length,
  };
}

function activeBorrowedBooks(db, student) {
  const ids = new Set(Array.isArray(student?.borrowedBooks) ? student.borrowedBooks.filter(Boolean) : []);
  return db.books.filter(
    (book) => ids.has(book.id) || (book?.status === 'borrowed' && book?.borrowedBy === student?.id)
  );
}

function normalizePersonWords(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('nl-NL')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function compareGoogleName(studentName, googleName) {
  const student = normalizePersonWords(studentName);
  const google = normalizePersonWords(googleName);
  if (!student.length || !google.length) return 'unknown';
  if (student.join(' ') === google.join(' ')) return 'match';
  const firstMatches = student[0] === google[0];
  const lastMatches = student[student.length - 1] === google[google.length - 1];
  return firstMatches && lastMatches ? 'match' : 'warning';
}

function pendingGoogleRequests(db, store, user) {
  return store.linkRequests
    .filter((request) => {
      if (request?.status !== 'pending' || !request?.studentId) return false;
      const student = db.students.find((entry) => entry?.id === request.studentId);
      return canManageStudent(db, user, student);
    })
    .map((request) => {
      const student = db.students.find((entry) => entry?.id === request.studentId);
      const sanitized = sanitizeStudent(db, store, student);
      return {
        id: request.id,
        studentId: request.studentId,
        studentName: student?.name || 'Onbekende leerling',
        classNames: sanitized.classNames,
        email: request.email || '',
        googleName: request.googleName || '',
        nameMatch: compareGoogleName(student?.name, request.googleName),
        createdAt: request.createdAt,
      };
    });
}

function transferForResponse(db, request) {
  const student = db.students.find((entry) => entry?.id === request.studentId);
  const fromClass = db.classes.find((entry) => entry?.id === request.fromClassId);
  const toClass = db.classes.find((entry) => entry?.id === request.toClassId);
  return {
    id: request.id,
    studentId: request.studentId,
    studentName: student?.name || 'Onbekende leerling',
    fromClassId: request.fromClassId,
    fromClassName: fromClass?.name || 'Onbekende klas',
    toClassId: request.toClassId,
    toClassName: toClass?.name || 'Onbekende klas',
    status: request.status,
    escalatedToAdmin: Boolean(request.escalatedToAdmin),
    escalationReason: request.escalationReason || '',
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

function buildManagementState(context) {
  const ownIds = managedClassIds(context.db, context.user);
  const classes = context.db.classes
    .map((klass) => ({
      id: klass.id,
      name: klass.name || '',
      isOwn: ownIds.has(klass.id),
      hasMentor: Array.isArray(klass.teacherIds) && klass.teacherIds.length > 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'nl'));

  const students = context.db.students
    .filter((student) => student.active !== false && (context.user.role === 'admin' || canManageStudent(context.db, context.user, student)))
    .map((student) => sanitizeStudent(context.db, context.store, student))
    .sort((a, b) => a.name.localeCompare(b.name, 'nl'));

  const transfers = context.db.studentTransferRequests.map((entry) => transferForResponse(context.db, entry));
  const incoming = transfers.filter((entry) =>
    entry.status === 'pending' && (context.user.role === 'admin' || ownIds.has(entry.toClassId))
  );
  const outgoing = transfers.filter((entry) =>
    ['pending', 'rejected'].includes(entry.status) && (context.user.role === 'admin' || ownIds.has(entry.fromClassId))
  );
  const escalated = context.user.role === 'admin'
    ? transfers.filter((entry) => entry.escalatedToAdmin && ['pending', 'rejected'].includes(entry.status))
    : [];

  return {
    role: context.user.role,
    classes,
    students,
    incoming,
    outgoing,
    escalated,
    googleRequests: pendingGoogleRequests(context.db, context.store, context.user),
  };
}

function findStudentByNumber(db, number) {
  const wanted = String(number || '').trim();
  if (!wanted) return null;
  return db.students.find((entry) => getParnassysStudentNumber(entry) === wanted) || null;
}

function addStudent(context, body) {
  const classId = String(body.classId || '').trim();
  const targetClass = context.db.classes.find((entry) => entry?.id === classId);
  if (!targetClass || !ownsClass(context.db, context.user, classId)) {
    return { status: 403, payload: { message: 'Je kunt alleen een leerling aan je eigen klas toevoegen.' } };
  }
  const parts = splitName(body.name);
  if (parts.name.length < 2 || parts.name.length > 120) {
    return { status: 400, payload: { message: 'Vul de naam van de leerling in.' } };
  }
  const studentNumber = String(body.parnassysStudentNumber || '').trim();
  if (studentNumber && findStudentByNumber(context.db, studentNumber)) {
    return { status: 409, payload: { message: 'Dit ParnasSys-leerlingnummer bestaat al in Boekenbaai.' } };
  }
  const sameName = context.db.students.filter(
    (entry) => entry?.active !== false && normalizeName(entry?.name) === normalizeName(parts.name)
  );
  if (sameName.length) {
    const existing = sameName[0];
    const existingClasses = classNames(context.db, studentClassIds(context.db, existing));
    return {
      status: 409,
      payload: {
        message: sameName.length > 1
          ? 'Er bestaan meerdere actieve leerlingen met deze naam. Zoek de bestaande leerling en gebruik Verplaatsen.'
          : `${existing.name} bestaat al${existingClasses.length ? ` in ${existingClasses.join(', ')}` : ''}. Gebruik Verplaatsen in plaats van een tweede account te maken.`,
        code: 'existing-student',
        student: sanitizeStudent(context.db, context.store, existing),
      },
    };
  }

  const student = {
    id: crypto.randomUUID(),
    name: parts.name,
    firstName: parts.firstName,
    middleName: '',
    lastName: parts.lastName,
    username: uniqueUsername(context.db, studentNumber || parts.name),
    passwordHash: internalPasswordHash(),
    mustChangePassword: false,
    borrowedBooks: [],
    classIds: [classId],
    active: true,
    source: 'manual',
    createdAt: new Date().toISOString(),
  };
  if (studentNumber) setParnassysStudentNumber(student, studentNumber);
  context.db.students.push(student);
  targetClass.studentIds = Array.isArray(targetClass.studentIds) ? targetClass.studentIds : [];
  if (!targetClass.studentIds.includes(student.id)) targetClass.studentIds.push(student.id);
  appendHistory(
    context.db,
    'student_manual_added',
    `${student.name} is toegevoegd aan ${targetClass.name}`,
    { studentId: student.id, classId, changedBy: context.user.id }
  );
  writeJsonAtomic(DATA_PATH, context.db);
  return { status: 201, payload: { student: sanitizeStudent(context.db, context.store, student) } };
}

function createTransfer(context, studentId, body) {
  const student = context.db.students.find((entry) => entry?.id === studentId && entry?.active !== false);
  if (!student || !canManageStudent(context.db, context.user, student)) {
    return { status: 403, payload: { message: 'Je kunt alleen een leerling uit je eigen klas verplaatsen.' } };
  }
  const toClassId = String(body.toClassId || '').trim();
  const targetClass = context.db.classes.find((entry) => entry?.id === toClassId);
  if (!targetClass) return { status: 404, payload: { message: 'Doelklas niet gevonden.' } };
  const ownIds = managedClassIds(context.db, context.user);
  const currentIds = studentClassIds(context.db, student);
  const requestedFrom = String(body.fromClassId || '').trim();
  const fromClassId = requestedFrom && currentIds.includes(requestedFrom) && ownIds.has(requestedFrom)
    ? requestedFrom
    : currentIds.find((id) => ownIds.has(id));
  if (!fromClassId) return { status: 409, payload: { message: 'De huidige klas van deze leerling kon niet worden vastgesteld.' } };
  if (fromClassId === toClassId) return { status: 400, payload: { message: 'Kies een andere klas.' } };
  const existing = context.db.studentTransferRequests.find(
    (entry) => entry?.studentId === student.id && ['pending', 'rejected'].includes(entry?.status)
  );
  if (existing) return { status: 409, payload: { message: 'Er staat al een verplaatsingsverzoek voor deze leerling open.' } };

  const now = new Date().toISOString();
  const hasTargetMentor = Array.isArray(targetClass.teacherIds) && targetClass.teacherIds.length > 0;
  const request = {
    id: crypto.randomUUID(),
    studentId: student.id,
    fromClassId,
    toClassId,
    requestedBy: context.user.id,
    status: 'pending',
    escalatedToAdmin: !hasTargetMentor,
    escalationReason: hasTargetMentor ? '' : 'no-target-mentor',
    createdAt: now,
    updatedAt: now,
  };
  context.db.studentTransferRequests.push(request);
  const fromClass = context.db.classes.find((entry) => entry.id === fromClassId);
  appendHistory(
    context.db,
    'student_transfer_requested',
    `Verplaatsing van ${student.name} van ${fromClass?.name || 'oude klas'} naar ${targetClass.name} aangevraagd`,
    { studentId: student.id, fromClassId, toClassId, changedBy: context.user.id }
  );
  writeJsonAtomic(DATA_PATH, context.db);
  return { status: 201, payload: { transfer: transferForResponse(context.db, request) } };
}

function performTransfer(db, request, reviewerId) {
  const student = db.students.find((entry) => entry?.id === request.studentId && entry?.active !== false);
  const targetClass = db.classes.find((entry) => entry?.id === request.toClassId);
  if (!student || !targetClass) throw new Error('Leerling of doelklas bestaat niet meer.');
  const currentIds = studentClassIds(db, student).filter((id) => id !== request.fromClassId);
  if (!currentIds.includes(targetClass.id)) currentIds.push(targetClass.id);
  ensureClassMembership(db, student, currentIds);
  request.status = 'accepted';
  request.reviewedBy = reviewerId;
  request.updatedAt = new Date().toISOString();
  request.escalatedToAdmin = false;
  appendHistory(
    db,
    'student_transferred',
    `${student.name} is verplaatst naar ${targetClass.name}`,
    { studentId: student.id, fromClassId: request.fromClassId, toClassId: request.toClassId, changedBy: reviewerId }
  );
}

function reviewTransfer(context, transferId, action) {
  const request = context.db.studentTransferRequests.find((entry) => entry?.id === transferId);
  if (!request || request.status !== 'pending') {
    return { status: 404, payload: { message: 'Openstaand verplaatsingsverzoek niet gevonden.' } };
  }
  if (!ownsClass(context.db, context.user, request.toClassId)) {
    return { status: 403, payload: { message: 'Alleen de nieuwe mentor of beheer kan dit verzoek beoordelen.' } };
  }
  if (action === 'accept') {
    performTransfer(context.db, request, context.user.id);
  } else {
    request.status = 'rejected';
    request.reviewedBy = context.user.id;
    request.updatedAt = new Date().toISOString();
    request.escalatedToAdmin = true;
    request.escalationReason = 'target-rejected';
    const student = context.db.students.find((entry) => entry?.id === request.studentId);
    appendHistory(
      context.db,
      'student_transfer_rejected',
      `Verplaatsing van ${student?.name || 'leerling'} is geweigerd en doorgestuurd naar beheer`,
      { studentId: request.studentId, changedBy: context.user.id }
    );
  }
  writeJsonAtomic(DATA_PATH, context.db);
  return { status: 200, payload: { transfer: transferForResponse(context.db, request) } };
}

function resolveEscalatedTransfer(context, transferId, action) {
  if (context.user.role !== 'admin') return { status: 403, payload: { message: 'Alleen beheer kan dit oplossen.' } };
  const request = context.db.studentTransferRequests.find((entry) => entry?.id === transferId);
  if (!request || !['pending', 'rejected'].includes(request.status) || !request.escalatedToAdmin) {
    return { status: 404, payload: { message: 'Openstaand beheerverzoek niet gevonden.' } };
  }
  if (action === 'accept') {
    performTransfer(context.db, request, context.user.id);
  } else {
    request.status = 'cancelled';
    request.reviewedBy = context.user.id;
    request.updatedAt = new Date().toISOString();
    request.escalatedToAdmin = false;
  }
  writeJsonAtomic(DATA_PATH, context.db);
  return { status: 200, payload: { transfer: transferForResponse(context.db, request) } };
}

function deactivateStudent(context, studentId) {
  const student = context.db.students.find((entry) => entry?.id === studentId && entry?.active !== false);
  if (!student || !canManageStudent(context.db, context.user, student)) {
    return { status: 403, payload: { message: 'Je kunt alleen een leerling uit je eigen klas van school afmelden.' } };
  }
  const borrowed = activeBorrowedBooks(context.db, student);
  if (borrowed.length) {
    return {
      status: 409,
      payload: {
        code: 'borrowed-books',
        message: 'Deze leerling heeft nog boeken in bezit. Lever die eerst in.',
        borrowedBooks: borrowed.map((book) => ({ id: book.id, title: book.title || 'Onbekend boek' })),
      },
    };
  }

  const now = new Date().toISOString();
  student.active = false;
  student.inactiveAt = now;
  student.inactiveReason = 'left-school';
  student.inactiveBy = context.user.id;
  ensureClassMembership(context.db, student, []);

  const revoked = context.store.sessions.filter(
    (entry) => entry?.type === 'student' && entry?.userId === student.id
  );
  const expiresCutoff = Date.now() + REVOKED_TOKEN_RETENTION_MS;
  for (const entry of revoked) {
    if (!entry?.tokenHash) continue;
    context.db.revokedStudentSessions.push({
      tokenHash: entry.tokenHash,
      studentId: student.id,
      expiresAt: Math.max(Number(entry.expiresAt) || 0, expiresCutoff),
    });
  }
  context.db.revokedStudentSessions = context.db.revokedStudentSessions.filter(
    (entry) => Number(entry?.expiresAt) > Date.now()
  );
  context.store.sessions = context.store.sessions.filter(
    (entry) => !(entry?.type === 'student' && entry?.userId === student.id)
  );
  for (const request of context.store.linkRequests) {
    if (request?.studentId === student.id && request?.status === 'pending') {
      request.status = 'superseded';
      request.updatedAt = now;
    }
  }
  for (const transfer of context.db.studentTransferRequests) {
    if (transfer?.studentId === student.id && ['pending', 'rejected'].includes(transfer.status)) {
      transfer.status = 'cancelled';
      transfer.updatedAt = now;
      transfer.escalatedToAdmin = false;
    }
  }

  appendHistory(
    context.db,
    'student_deactivated',
    `${student.name} is van school afgemeld`,
    { studentId: student.id, changedBy: context.user.id }
  );
  writeJsonAtomic(DATA_PATH, context.db);
  saveAuthStore(context.store);
  return { status: 200, payload: { studentId: student.id, inactive: true } };
}

function stripCookie(rawCookie, name) {
  return String(rawCookie || '')
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry && !entry.startsWith(`${name}=`))
    .join('; ');
}

function appendSetCookie(res, value) {
  const current = res.getHeader('Set-Cookie');
  const values = current ? (Array.isArray(current) ? current : [current]) : [];
  res.setHeader('Set-Cookie', [...values, value]);
}

function stripInvalidStudentSession(req, res) {
  const tokens = getRequestTokens(req);
  if (!tokens.length) return;
  const db = readMainDb();
  const store = loadAuthStore();
  const revokedHashes = new Set(
    db.revokedStudentSessions
      .filter((entry) => Number(entry?.expiresAt) > Date.now())
      .map((entry) => entry.tokenHash)
  );
  let invalid = false;
  for (const token of tokens) {
    const hash = core.tokenHash(token);
    if (revokedHashes.has(hash)) {
      invalid = true;
      break;
    }
    const session = core.resolveSession(store, token);
    if (session?.type === 'student') {
      const student = db.students.find((entry) => entry?.id === session.userId);
      if (!student || student.active === false) {
        invalid = true;
        break;
      }
    }
  }
  if (!invalid) return;
  req.headers.cookie = stripCookie(req.headers.cookie, SESSION_COOKIE);
  if (getBearerToken(req)) delete req.headers.authorization;
  appendSetCookie(res, `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  appendSetCookie(res, `${SESSION_HINT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`);
}

function injectManagementAssets(req, res, listener) {
  const requestUrl = new URL(req.url, 'http://localhost');
  if (!['/staff', '/staff.html'].includes(requestUrl.pathname)) return listener(req, res);
  const originalEnd = res.end.bind(res);
  res.end = function patchedEnd(chunk, encoding, callback) {
    let enc = encoding;
    let cb = callback;
    if (typeof encoding === 'function') {
      cb = encoding;
      enc = undefined;
    }
    let nextChunk = chunk;
    const contentType = String(res.getHeader('Content-Type') || '').toLowerCase();
    if (chunk != null && (!contentType || contentType.includes('text/html'))) {
      let html = Buffer.isBuffer(chunk) ? chunk.toString(enc || 'utf8') : String(chunk);
      const links = [
        ['/admin-modern.css', '<link rel="stylesheet" href="/admin-modern.css" />'],
        ['/student-management.css', '<link rel="stylesheet" href="/student-management.css" />'],
      ];
      for (const [needle, tag] of links) {
        if (!html.includes(needle)) html = html.replace(/<\/head>/i, `  ${tag}\n</head>`);
      }
      const scripts = [
        ['/admin-modern.js', '<script src="/admin-modern.js"></script>'],
        ['/admin-google-links.js', '<script src="/admin-google-links.js"></script>'],
        ['/student-management.js', '<script src="/student-management.js"></script>'],
      ];
      for (const [needle, tag] of scripts) {
        if (!html.includes(needle)) html = html.replace(/<\/body>/i, `  ${tag}\n</body>`);
      }
      nextChunk = html;
      res.removeHeader('Content-Length');
    }
    if (enc !== undefined) return originalEnd(nextChunk, enc, cb);
    return originalEnd(nextChunk, cb);
  };
  return listener(req, res);
}

function handleManagementApi(req, res, requestUrl) {
  if (!requestUrl.pathname.startsWith('/api/mentor/') && !requestUrl.pathname.startsWith('/api/admin/student-transfers/')) {
    return false;
  }
  const context = resolveStaff(req);
  if (!context) {
    sendJson(res, 401, { message: 'Log in als medewerker.' });
    return true;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/mentor/student-management') {
    sendJson(res, 200, buildManagementState(context));
    return true;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/mentor/students') {
    parseBody(req).then((body) => {
      const result = addStudent(context, body);
      sendJson(res, result.status, result.payload);
    }).catch((error) => sendJson(res, error?.code === 'BODY_TOO_LARGE' ? 413 : 400, { message: error.message }));
    return true;
  }

  const transferStart = requestUrl.pathname.match(/^\/api\/mentor\/students\/([\w-]+)\/transfer$/);
  if (req.method === 'POST' && transferStart) {
    parseBody(req).then((body) => {
      const result = createTransfer(context, transferStart[1], body);
      sendJson(res, result.status, result.payload);
    }).catch((error) => sendJson(res, 400, { message: error.message }));
    return true;
  }

  const review = requestUrl.pathname.match(/^\/api\/mentor\/student-transfers\/([\w-]+)\/(accept|reject)$/);
  if (req.method === 'POST' && review) {
    const result = reviewTransfer(context, review[1], review[2]);
    sendJson(res, result.status, result.payload);
    return true;
  }

  const resolve = requestUrl.pathname.match(/^\/api\/admin\/student-transfers\/([\w-]+)\/(accept|cancel)$/);
  if (req.method === 'POST' && resolve) {
    const result = resolveEscalatedTransfer(context, resolve[1], resolve[2]);
    sendJson(res, result.status, result.payload);
    return true;
  }

  const deactivate = requestUrl.pathname.match(/^\/api\/mentor\/students\/([\w-]+)\/deactivate$/);
  if (req.method === 'POST' && deactivate) {
    const result = deactivateStudent(context, deactivate[1]);
    sendJson(res, result.status, result.payload);
    return true;
  }

  sendJson(res, 404, { message: 'Beheeractie niet gevonden.' });
  return true;
}

function wrapRequestListener(listener) {
  return function studentManagementListener(req, res) {
    let requestUrl;
    try {
      requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch (error) {
      return listener(req, res);
    }
    try {
      stripInvalidStudentSession(req, res);
      if (handleManagementApi(req, res, requestUrl)) return undefined;
      return injectManagementAssets(req, res, listener);
    } catch (error) {
      console.error('[Leerlingbeheer] Interne fout:', error?.message || error);
      if (!res.headersSent && !res.writableEnded) {
        return sendJson(res, 500, { message: 'Leerlingbeheer kon niet worden verwerkt.' });
      }
      if (!res.writableEnded) res.end();
      return undefined;
    }
  };
}

http.createServer = function patchedCreateServer(...args) {
  const listenerIndex = typeof args[0] === 'function' ? 0 : 1;
  const listener = args[listenerIndex];
  if (typeof listener !== 'function') return originalCreateServer(...args);
  const wrapped = wrapRequestListener(listener);
  if (listenerIndex === 0) return originalCreateServer(wrapped);
  return originalCreateServer(args[0], wrapped);
};

module.exports = {
  __test: {
    DATA_PATH,
    AUTH_DATA_PATH,
    compareGoogleName,
    managedClassIds,
    studentClassIds,
    buildManagementState,
    activeBorrowedBooks,
  },
};
