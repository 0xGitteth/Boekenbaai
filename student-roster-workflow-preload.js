'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');
const core = require('./google-auth-core');
const {
  MAX_QUERY_LENGTH,
  normalizeSearchText,
  buildStudentMatches,
  DirectoryRateLimiter,
} = require('./login-directory-core');
const { compareStudentGoogleName } = require('./student-identity-match-core');

const DEFAULT_DATA_PATH = path.join(__dirname, 'data', 'db.json');
const DATA_PATH = process.env.BOEKENBAAI_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_DATA_PATH)
  : DEFAULT_DATA_PATH;
const AUTH_DATA_PATH = process.env.BOEKENBAAI_AUTH_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_AUTH_DATA_PATH)
  : `${DATA_PATH}.auth.json`;
const CONFIGURED_PUBLIC_URL = String(process.env.BOEKENBAAI_PUBLIC_URL || '').replace(/\/$/, '');
const SESSION_COOKIE = 'boekenbaai_session';
const DIRECTORY_COOKIE = 'boekenbaai_login_directory';
const DIRECTORY_COOKIE_MAX_AGE_SECONDS = 30 * 60;
const MAX_BODY_BYTES = 256 * 1024;
const originalCreateServer = http.createServer.bind(http);
const directoryLimiter = new DirectoryRateLimiter();

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

function readMainDb() {
  const db = readJsonStrict(DATA_PATH, { label: 'Boekenbaai database' });
  if (!db || typeof db !== 'object' || Array.isArray(db)) {
    throw new Error('Boekenbaai database heeft een ongeldig formaat.');
  }
  if (!Array.isArray(db.books)) db.books = [];
  if (!Array.isArray(db.users)) db.users = [];
  if (!Array.isArray(db.students)) db.students = [];
  if (!Array.isArray(db.classes)) db.classes = [];
  if (!Array.isArray(db.history)) db.history = [];
  if (!Array.isArray(db.studentTransfers)) db.studentTransfers = [];
  return db;
}

function loadAuthStore() {
  const raw = readJsonStrict(AUTH_DATA_PATH, {
    missingValue: core.emptyAuthStore(),
    label: 'Auth-opslag',
  });
  return core.pruneStore(core.normalizeStore(raw));
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

function saveMainDb(db) {
  writeJsonAtomic(DATA_PATH, db);
}

function saveAuthStore(store) {
  writeJsonAtomic(AUTH_DATA_PATH, core.pruneStore(core.normalizeStore(store)));
}

function parseCookies(req) {
  const result = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const raw = part.slice(index + 1).trim();
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

function resolveStaff(req) {
  const db = readMainDb();
  const store = loadAuthStore();
  core.setLocalOnlyStaffAccountIds(
    db.users.filter((entry) => entry?.role === 'admin').map((entry) => entry.id)
  );
  const bearer = getBearerToken(req);
  const cookieToken = parseCookies(req)[SESSION_COOKIE] || '';
  const candidates = [bearer && bearer !== 'cookie' ? bearer : '', cookieToken].filter(Boolean);
  for (const token of candidates) {
    const session = core.resolveSession(store, token);
    if (!session || session.type !== 'staff') continue;
    const user = db.users.find(
      (entry) =>
        entry?.id === session.userId &&
        ['teacher', 'admin'].includes(entry?.role) &&
        entry?.active !== false
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
      if (tooLarge) return reject(Object.assign(new Error('Payload te groot.'), { code: 'BODY_TOO_LARGE' }));
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(Object.assign(new Error('Ongeldige JSON.'), { code: 'INVALID_JSON' }));
      }
    });
    req.on('error', reject);
  });
}

function cleanText(value, max = 160) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function normalizeName(value) {
  return cleanText(value, 180).toLocaleLowerCase('nl-NL');
}

function classById(db, classId) {
  return db.classes.find((entry) => entry?.id === classId) || null;
}

function classNamesForStudent(db, studentId) {
  const ids = new Set(core.getStudentClassIds(db, studentId));
  return db.classes
    .filter((entry) => ids.has(entry.id))
    .map((entry) => entry.name)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'nl'));
}

function teacherCanManageClass(db, user, classId) {
  if (user?.role === 'admin') return true;
  if (user?.role !== 'teacher') return false;
  return core.getTeacherClassIds(db, user.id).includes(classId);
}

function teachersForClass(db, classId) {
  const klass = classById(db, classId);
  if (!klass) return [];
  const ids = new Set(klass.teacherIds || []);
  for (const user of db.users || []) {
    if (user?.role === 'teacher' && (user.classIds || []).includes(classId)) ids.add(user.id);
  }
  return Array.from(ids).filter((id) =>
    db.users.some((entry) => entry?.id === id && entry?.role === 'teacher' && entry?.active !== false)
  );
}

function makeUniqueUsername(db, name) {
  const base = String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 42) || 'leerling';
  const taken = (candidate) => [
    ...(db.students || []),
    ...(db.users || []),
  ].some((entry) => String(entry?.username || '').toLowerCase() === candidate.toLowerCase());
  if (!taken(base)) return base;
  for (let index = 2; index < 10000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!taken(candidate)) return candidate;
  }
  return `${base}-${crypto.randomBytes(4).toString('hex')}`;
}

function makeInternalPasswordHash() {
  return crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex');
}

function appendHistory(db, type, message, actorId) {
  db.history.push({
    id: crypto.randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    actorId: actorId || null,
    message,
  });
}

function activeStudents(db) {
  return db.students.filter((entry) => entry?.id && entry?.active !== false);
}

function buildRosterManage(context) {
  const { db, store, user } = context;
  const myClassIds = user.role === 'admin'
    ? db.classes.map((entry) => entry.id)
    : core.getTeacherClassIds(db, user.id);
  const manageableStudents = user.role === 'admin'
    ? activeStudents(db)
    : activeStudents(db).filter((student) => core.canStaffManageStudent(db, user, student.id));

  const classes = db.classes
    .filter((entry) => entry?.id && entry?.name)
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      mine: myClassIds.includes(entry.id),
      hasMentor: teachersForClass(db, entry.id).length > 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'nl'));

  const students = manageableStudents
    .map((student) => ({
      id: student.id,
      name: student.name || '',
      classIds: core.getStudentClassIds(db, student.id),
      classNames: classNamesForStudent(db, student.id),
      hasLoans: Array.isArray(student.borrowedBooks) && student.borrowedBooks.length > 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'nl'));

  const canSeeTransfer = (request) => {
    if (user.role === 'admin') return true;
    return teacherCanManageClass(db, user, request?.sourceClassId) ||
      teacherCanManageClass(db, user, request?.targetClassId);
  };
  const transfers = db.studentTransfers
    .filter((entry) => entry && ['pending', 'escalated'].includes(entry.status) && canSeeTransfer(entry))
    .map((entry) => {
      const student = db.students.find((item) => item?.id === entry.studentId);
      return {
        id: entry.id,
        studentId: entry.studentId,
        studentName: student?.name || 'Onbekende leerling',
        sourceClassId: entry.sourceClassId,
        sourceClassName: classById(db, entry.sourceClassId)?.name || 'Onbekende klas',
        targetClassId: entry.targetClassId,
        targetClassName: classById(db, entry.targetClassId)?.name || 'Onbekende klas',
        status: entry.status,
        requestedBy: entry.requestedBy,
        createdAt: entry.createdAt,
        rejectedBy: entry.rejectedBy || null,
        canApprove: user.role === 'admin' ||
          (entry.status === 'pending' && teacherCanManageClass(db, user, entry.targetClassId)),
        canReject: user.role === 'admin' ||
          (entry.status === 'pending' && teacherCanManageClass(db, user, entry.targetClassId)),
        canCancel: user.role === 'admin' || teacherCanManageClass(db, user, entry.sourceClassId),
      };
    });

  const googleRequests = (store.linkRequests || [])
    .filter((request) => {
      if (request?.status !== 'pending' || !request?.studentId) return false;
      return user.role === 'admin' || core.canStaffManageStudent(db, user, request.studentId);
    })
    .map((request) => {
      const student = db.students.find((entry) => entry?.id === request.studentId);
      const comparison = compareStudentGoogleName(student, request.googleName || '');
      return {
        id: request.id,
        studentId: request.studentId,
        studentName: student?.name || 'Onbekende leerling',
        classNames: classNamesForStudent(db, request.studentId),
        email: request.email || '',
        googleName: request.googleName || '',
        nameMatch: comparison.status,
        nameWarning: comparison.warning,
        createdAt: request.createdAt,
      };
    });

  return {
    role: user.role,
    userId: user.id,
    myClassIds,
    classes,
    students,
    transfers,
    googleRequests,
  };
}

function createStudent(context, body) {
  const { db, user } = context;
  const classId = cleanText(body.classId, 120);
  const name = cleanText(body.name, 180);
  const studentNumber = cleanText(body.studentNumber, 80);
  if (!name || name.length < 2) throw Object.assign(new Error('Vul de naam van de leerling in.'), { statusCode: 400 });
  const klass = classById(db, classId);
  if (!klass) throw Object.assign(new Error('Klas niet gevonden.'), { statusCode: 404 });
  if (!teacherCanManageClass(db, user, classId)) {
    throw Object.assign(new Error('Je kunt alleen een nieuwe leerling aan je eigen klas toevoegen.'), { statusCode: 403 });
  }

  const sameName = db.students.filter((entry) => normalizeName(entry?.name) === normalizeName(name));
  if (sameName.length) {
    const existing = sameName[0];
    const error = new Error(
      existing.active === false
        ? 'Deze leerling bestaat al als inactieve leerling. Vraag beheer om het bestaande account te herstellen.'
        : `Deze leerling bestaat al${classNamesForStudent(db, existing.id).length ? ` in ${classNamesForStudent(db, existing.id).join(', ')}` : ''}. Verplaats het bestaande account in plaats van een nieuw account te maken.`
    );
    error.statusCode = 409;
    error.code = existing.active === false ? 'INACTIVE_STUDENT' : 'EXISTING_STUDENT';
    error.existing = {
      id: existing.id,
      name: existing.name,
      classNames: classNamesForStudent(db, existing.id),
    };
    throw error;
  }

  if (studentNumber) {
    const numberOwner = db.students.find((entry) =>
      String(entry?.parnassysStudentNumber || entry?.externalIds?.parnassys || '').trim() === studentNumber
    );
    if (numberOwner) {
      const error = new Error('Dit ParnasSys-leerlingnummer hoort al bij een andere leerling.');
      error.statusCode = 409;
      error.code = 'STUDENT_NUMBER_EXISTS';
      throw error;
    }
  }

  const parts = name.split(/\s+/).filter(Boolean);
  const student = {
    id: crypto.randomUUID(),
    name,
    firstName: parts[0] || name,
    middleName: '',
    lastName: parts.length > 1 ? parts[parts.length - 1] : '',
    username: makeUniqueUsername(db, name),
    passwordHash: makeInternalPasswordHash(),
    mustChangePassword: false,
    borrowedBooks: [],
    classIds: [classId],
    active: true,
    source: 'manual-mentor',
    createdBy: user.id,
    createdAt: new Date().toISOString(),
  };
  if (studentNumber) {
    student.parnassysStudentNumber = studentNumber;
    student.externalIds = { parnassys: studentNumber };
  }
  db.students.push(student);
  if (!Array.isArray(klass.studentIds)) klass.studentIds = [];
  if (!klass.studentIds.includes(student.id)) klass.studentIds.push(student.id);
  appendHistory(db, 'student_manual_added', `${name} toegevoegd aan ${klass.name}.`, user.id);
  saveMainDb(db);
  return {
    id: student.id,
    name: student.name,
    classId,
    className: klass.name,
  };
}

function createTransfer(context, body) {
  const { db, user } = context;
  const studentId = cleanText(body.studentId, 120);
  const targetClassId = cleanText(body.targetClassId, 120);
  const student = db.students.find((entry) => entry?.id === studentId && entry?.active !== false);
  if (!student) throw Object.assign(new Error('Leerling niet gevonden.'), { statusCode: 404 });
  if (!core.canStaffManageStudent(db, user, studentId) && user.role !== 'admin') {
    throw Object.assign(new Error('Je kunt alleen leerlingen uit je eigen klas verplaatsen.'), { statusCode: 403 });
  }
  const target = classById(db, targetClassId);
  if (!target) throw Object.assign(new Error('Doelklas niet gevonden.'), { statusCode: 404 });

  const studentClassIds = core.getStudentClassIds(db, studentId);
  const sourceClassId = cleanText(body.sourceClassId, 120) || studentClassIds.find((id) =>
    user.role === 'admin' || teacherCanManageClass(db, user, id)
  );
  if (!sourceClassId || !studentClassIds.includes(sourceClassId)) {
    throw Object.assign(new Error('Huidige klas kon niet veilig worden vastgesteld.'), { statusCode: 409 });
  }
  if (!teacherCanManageClass(db, user, sourceClassId)) {
    throw Object.assign(new Error('Alleen de huidige mentor of beheer kan de verplaatsing starten.'), { statusCode: 403 });
  }
  if (sourceClassId === targetClassId) {
    throw Object.assign(new Error('Kies een andere klas.'), { statusCode: 400 });
  }
  const existing = db.studentTransfers.find((entry) =>
    entry?.studentId === studentId && ['pending', 'escalated'].includes(entry?.status)
  );
  if (existing) {
    throw Object.assign(new Error('Voor deze leerling staat al een verplaatsingsverzoek open.'), { statusCode: 409 });
  }

  const now = new Date().toISOString();
  const targetHasMentor = teachersForClass(db, targetClassId).length > 0;
  const request = {
    id: crypto.randomUUID(),
    studentId,
    sourceClassId,
    targetClassId,
    status: targetHasMentor ? 'pending' : 'escalated',
    requestedBy: user.id,
    createdAt: now,
    updatedAt: now,
    escalatedReason: targetHasMentor ? null : 'target-without-mentor',
  };
  db.studentTransfers.push(request);
  appendHistory(
    db,
    'student_transfer_requested',
    `${student.name} voorgesteld voor verplaatsing van ${classById(db, sourceClassId)?.name || 'onbekend'} naar ${target.name}.`,
    user.id
  );
  saveMainDb(db);
  return request;
}

function moveStudent(db, request, actorId) {
  const student = db.students.find((entry) => entry?.id === request.studentId && entry?.active !== false);
  if (!student) throw Object.assign(new Error('Leerling is niet meer actief.'), { statusCode: 409 });
  const source = classById(db, request.sourceClassId);
  const target = classById(db, request.targetClassId);
  if (!source || !target) throw Object.assign(new Error('Een van de klassen bestaat niet meer.'), { statusCode: 409 });

  source.studentIds = (source.studentIds || []).filter((id) => id !== student.id);
  if (!Array.isArray(target.studentIds)) target.studentIds = [];
  if (!target.studentIds.includes(student.id)) target.studentIds.push(student.id);
  const ids = new Set(core.getStudentClassIds(db, student.id));
  ids.delete(source.id);
  ids.add(target.id);
  student.classIds = Array.from(ids);

  request.status = 'approved';
  request.approvedBy = actorId;
  request.updatedAt = new Date().toISOString();
  appendHistory(db, 'student_transfer_approved', `${student.name} verplaatst van ${source.name} naar ${target.name}.`, actorId);
}

function actOnTransfer(context, requestId, action) {
  const { db, user } = context;
  const request = db.studentTransfers.find((entry) => entry?.id === requestId);
  if (!request || !['pending', 'escalated'].includes(request.status)) {
    throw Object.assign(new Error('Openstaand verplaatsingsverzoek niet gevonden.'), { statusCode: 404 });
  }

  if (action === 'approve') {
    const allowed = user.role === 'admin' ||
      (request.status === 'pending' && teacherCanManageClass(db, user, request.targetClassId));
    if (!allowed) throw Object.assign(new Error('Alleen de nieuwe mentor of beheer kan dit accepteren.'), { statusCode: 403 });
    moveStudent(db, request, user.id);
  } else if (action === 'reject') {
    if (user.role === 'admin') {
      request.status = 'cancelled';
      request.cancelledBy = user.id;
      request.updatedAt = new Date().toISOString();
      appendHistory(db, 'student_transfer_cancelled', 'Verplaatsingsverzoek door beheer gesloten.', user.id);
    } else {
      if (request.status !== 'pending' || !teacherCanManageClass(db, user, request.targetClassId)) {
        throw Object.assign(new Error('Alleen de nieuwe mentor kan dit verzoek weigeren.'), { statusCode: 403 });
      }
      request.status = 'escalated';
      request.rejectedBy = user.id;
      request.updatedAt = new Date().toISOString();
      request.escalatedReason = 'target-mentor-rejected';
      appendHistory(db, 'student_transfer_escalated', 'Verplaatsingsverzoek na weigering doorgestuurd naar beheer.', user.id);
    }
  } else if (action === 'cancel') {
    if (user.role !== 'admin' && !teacherCanManageClass(db, user, request.sourceClassId)) {
      throw Object.assign(new Error('Alleen de huidige mentor of beheer kan dit verzoek intrekken.'), { statusCode: 403 });
    }
    request.status = 'cancelled';
    request.cancelledBy = user.id;
    request.updatedAt = new Date().toISOString();
    appendHistory(db, 'student_transfer_cancelled', 'Verplaatsingsverzoek ingetrokken.', user.id);
  } else {
    throw Object.assign(new Error('Onbekende actie.'), { statusCode: 400 });
  }

  saveMainDb(db);
  return request;
}

function deactivateStudent(context, studentId) {
  const { db, user } = context;
  const student = db.students.find((entry) => entry?.id === studentId && entry?.active !== false);
  if (!student) throw Object.assign(new Error('Actieve leerling niet gevonden.'), { statusCode: 404 });
  if (user.role !== 'admin' && !core.canStaffManageStudent(db, user, studentId)) {
    throw Object.assign(new Error('Je kunt alleen een leerling uit je eigen klas van school afmelden.'), { statusCode: 403 });
  }
  const borrowed = Array.isArray(student.borrowedBooks) ? student.borrowedBooks.filter(Boolean) : [];
  if (borrowed.length) {
    const error = new Error(`Deze leerling heeft nog ${borrowed.length} boek${borrowed.length === 1 ? '' : 'en'} geleend. Lever die eerst in.`);
    error.statusCode = 409;
    error.code = 'OUTSTANDING_LOANS';
    error.outstandingLoans = borrowed.length;
    throw error;
  }

  for (const klass of db.classes) {
    klass.studentIds = Array.isArray(klass.studentIds)
      ? klass.studentIds.filter((id) => id !== student.id)
      : [];
  }
  student.classIds = [];
  student.active = false;
  student.inactiveAt = new Date().toISOString();
  student.inactiveReason = 'left-school';
  student.inactivatedBy = user.id;
  for (const request of db.studentTransfers) {
    if (request?.studentId === student.id && ['pending', 'escalated'].includes(request.status)) {
      request.status = 'cancelled';
      request.updatedAt = student.inactiveAt;
      request.cancelledBy = user.id;
    }
  }
  appendHistory(db, 'student_left_school', `${student.name} van school afgemeld.`, user.id);
  saveMainDb(db);

  let store = context.store;
  store.sessions = (store.sessions || []).filter(
    (entry) => !(entry?.type === 'student' && entry?.userId === student.id)
  );
  for (const request of store.linkRequests || []) {
    if (request?.studentId === student.id && request?.status === 'pending') {
      request.status = 'cancelled';
      request.updatedAt = student.inactiveAt;
      request.reviewedBy = user.id;
    }
  }
  store.pendingIdentities = (store.pendingIdentities || []).filter(
    (entry) => entry?.studentId !== student.id
  );
  saveAuthStore(store);
  return { id: student.id, name: student.name, active: false };
}

function requestUsesHttps(req) {
  if (CONFIGURED_PUBLIC_URL) {
    try {
      return new URL(CONFIGURED_PUBLIC_URL).protocol === 'https:';
    } catch (error) {
      // Fall through.
    }
  }
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (forwarded) return forwarded === 'https';
  return Boolean(req.socket?.encrypted);
}

function appendSetCookie(res, cookie) {
  const current = res.getHeader('Set-Cookie');
  const values = current ? (Array.isArray(current) ? current : [current]) : [];
  res.setHeader('Set-Cookie', [...values, cookie]);
}

function ensureDirectoryCookie(req, res) {
  const cookies = parseCookies(req);
  const existing = String(cookies[DIRECTORY_COOKIE] || '');
  if (/^[A-Za-z0-9_-]{24,64}$/.test(existing)) return existing;
  const nonce = crypto.randomBytes(24).toString('base64url');
  const parts = [
    `${DIRECTORY_COOKIE}=${encodeURIComponent(nonce)}`,
    'Path=/',
    `Max-Age=${DIRECTORY_COOKIE_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (requestUsesHttps(req)) parts.push('Secure');
  appendSetCookie(res, parts.join('; '));
  return nonce;
}

function hashRateKey(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 32);
}

function directoryNetworkKey(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .pop() || '';
  const remote = String(req.socket?.remoteAddress || '').trim().slice(0, 128);
  return hashRateKey(`${forwarded.slice(0, 128) || 'no-forwarded'}\u0000${remote || 'no-remote'}`);
}

function isKnownCrossOriginRequest(req) {
  const site = String(req.headers['sec-fetch-site'] || '').trim().toLowerCase();
  return Boolean(site && site !== 'same-origin');
}

function handleStudentLoginDirectory(req, res, requestUrl) {
  if (isKnownCrossOriginRequest(req)) {
    return sendJson(res, 403, { message: 'Zoek namen vanuit de Boekenbaai-inlogpagina.' });
  }
  const rawQuery = String(requestUrl.searchParams.get('q') || '');
  if (rawQuery.length > MAX_QUERY_LENGTH) {
    return sendJson(res, 400, { message: 'Zoekopdracht is te lang.' });
  }
  const normalizedQuery = normalizeSearchText(rawQuery);
  if (normalizedQuery.length < 2) return sendJson(res, 200, { matches: [] });

  const browserNonce = ensureDirectoryCookie(req, res);
  const networkKey = directoryNetworkKey(req);
  const rate = directoryLimiter.checkAndRecord({
    browserKey: hashRateKey(`${networkKey}\u0000${browserNonce}`),
    networkKey,
  });
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfterSeconds || 60));
    return sendJson(res, 429, {
      message: 'Te veel naamzoekopdrachten. Wacht even en probeer opnieuw.',
      retryAfterSeconds: rate.retryAfterSeconds || 60,
    });
  }

  const db = readMainDb();
  const safeDb = {
    ...db,
    students: activeStudents(db),
  };
  const matches = buildStudentMatches(safeDb, normalizedQuery).map((match) => {
    const classNames = classNamesForStudent(db, match.id);
    return {
      ...match,
      class: classNames.join(', '),
    };
  });
  return sendJson(res, 200, { matches });
}

function validateSelectedStudentIsActive(requestUrl, res) {
  const type = requestUrl.searchParams.get('type') === 'staff' ? 'staff' : 'student';
  if (type !== 'student') return false;
  const accountId = cleanText(requestUrl.searchParams.get('accountId'), 120);
  if (!accountId) return false;
  const db = readMainDb();
  const student = db.students.find((entry) => entry?.id === accountId);
  if (!student || student.active === false) {
    sendJson(res, 404, { message: 'Deze leerling is niet meer actief. Kies opnieuw je naam.' });
    return true;
  }
  return false;
}

function injectAssets(req, res, listener) {
  const requestUrl = new URL(req.url, 'http://localhost');
  if (!['/staff.html', '/staff'].includes(requestUrl.pathname)) return listener(req, res);
  const originalEnd = res.end.bind(res);
  res.end = function rosterAssetEnd(chunk, encoding, callback) {
    let nextChunk = chunk;
    const contentType = String(res.getHeader('Content-Type') || '').toLowerCase();
    if (chunk && (!contentType || contentType.includes('text/html'))) {
      let html = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      if (!html.includes('/student-roster.css')) {
        html = html.replace(/<\/head>/i, '    <link rel="stylesheet" href="/student-roster.css" />\n  </head>');
      }
      if (!html.includes('/student-roster.js')) {
        html = html.replace(/<\/body>/i, '    <script src="/student-roster.js"></script>\n  </body>');
      }
      nextChunk = html;
      res.removeHeader('Content-Length');
    }
    return originalEnd(nextChunk, encoding, callback);
  };
  return listener(req, res);
}

function wrapRequestListener(listener) {
  return async function studentRosterWorkflowListener(req, res) {
    let requestUrl;
    try {
      requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch (error) {
      return listener(req, res);
    }

    try {
      if (
        req.method === 'GET' &&
        requestUrl.pathname === '/api/login-search' &&
        (requestUrl.searchParams.get('type') || 'student') === 'student'
      ) {
        return handleStudentLoginDirectory(req, res, requestUrl);
      }

      if (
        req.method === 'GET' &&
        ['/api/auth/login-mode', '/api/auth/google/start-token', '/api/auth/google/start'].includes(requestUrl.pathname) &&
        validateSelectedStudentIsActive(requestUrl, res)
      ) {
        return undefined;
      }

      if (req.method === 'GET' && requestUrl.pathname === '/api/roster/manage') {
        const context = resolveStaff(req);
        if (!context) return sendJson(res, 401, { message: 'Log opnieuw in als medewerker.' });
        return sendJson(res, 200, buildRosterManage(context));
      }

      if (req.method === 'POST' && requestUrl.pathname === '/api/roster/students') {
        const context = resolveStaff(req);
        if (!context) return sendJson(res, 401, { message: 'Log opnieuw in als medewerker.' });
        const body = await parseBody(req);
        return sendJson(res, 201, createStudent(context, body));
      }

      if (req.method === 'POST' && requestUrl.pathname === '/api/roster/transfers') {
        const context = resolveStaff(req);
        if (!context) return sendJson(res, 401, { message: 'Log opnieuw in als medewerker.' });
        const body = await parseBody(req);
        return sendJson(res, 201, createTransfer(context, body));
      }

      const transferAction = requestUrl.pathname.match(/^\/api\/roster\/transfers\/([\w-]+)\/(approve|reject|cancel)$/);
      if (req.method === 'POST' && transferAction) {
        const context = resolveStaff(req);
        if (!context) return sendJson(res, 401, { message: 'Log opnieuw in als medewerker.' });
        return sendJson(res, 200, actOnTransfer(context, transferAction[1], transferAction[2]));
      }

      const deactivateMatch = requestUrl.pathname.match(/^\/api\/roster\/students\/([\w-]+)\/deactivate$/);
      if (req.method === 'POST' && deactivateMatch) {
        const context = resolveStaff(req);
        if (!context) return sendJson(res, 401, { message: 'Log opnieuw in als medewerker.' });
        return sendJson(res, 200, deactivateStudent(context, deactivateMatch[1]));
      }

      return injectAssets(req, res, listener);
    } catch (error) {
      console.error('[Leerlingbeheer]', error?.message || error);
      if (!res.headersSent && !res.writableEnded) {
        const payload = { message: error?.message || 'Leerlingbeheeractie mislukt.' };
        if (error?.code) payload.code = error.code;
        if (error?.existing) payload.existing = error.existing;
        if (error?.outstandingLoans !== undefined) payload.outstandingLoans = error.outstandingLoans;
        return sendJson(res, error?.statusCode || (error?.code === 'BODY_TOO_LARGE' ? 413 : 400), payload);
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
    readMainDb,
    resolveStaff,
    classNamesForStudent,
    teacherCanManageClass,
    teachersForClass,
    buildRosterManage,
    createStudent,
    createTransfer,
    actOnTransfer,
    deactivateStudent,
    handleStudentLoginDirectory,
    validateSelectedStudentIsActive,
  },
};
