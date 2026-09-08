'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');
const core = require('./google-auth-core');
const {
  getParnassysStudentNumber,
  setParnassysStudentNumber,
} = require('./google-first-people-import');

const DEFAULT_DATA_PATH = path.join(__dirname, 'data', 'db.json');
const DATA_PATH = process.env.BOEKENBAAI_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_DATA_PATH)
  : DEFAULT_DATA_PATH;
const AUTH_DATA_PATH = process.env.BOEKENBAAI_AUTH_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_AUTH_DATA_PATH)
  : `${DATA_PATH}.auth.json`;
const SCRIPT_PATH = path.join(__dirname, 'public', 'student-detail.js');
const SESSION_COOKIE = 'boekenbaai_session';
const MAX_BODY_BYTES = 64 * 1024;
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
  if (!Array.isArray(db.history)) db.history = [];
  if (!Array.isArray(db.studentTransferRequests)) db.studentTransferRequests = [];
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

function getRequestTokens(req) {
  const bearerMatch = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  const bearer = bearerMatch ? bearerMatch[1].trim() : '';
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
      (entry) =>
        entry?.id === session.userId &&
        entry?.active !== false &&
        ['teacher', 'admin'].includes(entry?.role)
    );
    if (user) return { db, store, user, token };
  }
  return null;
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

function canManageStudent(db, user, student) {
  if (!student || student.active === false) return false;
  if (user?.role === 'admin') return true;
  const own = managedClassIds(db, user);
  return studentClassIds(db, student).some((id) => own.has(id));
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

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(payload));
}

function splitName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  const parts = name.split(' ').filter(Boolean);
  return {
    name,
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' '),
  };
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

function clearParnassysStudentNumber(student) {
  delete student.parnassysStudentNumber;
  if (student.externalIds && typeof student.externalIds === 'object') {
    delete student.externalIds.parnassys;
    if (!Object.keys(student.externalIds).length) delete student.externalIds;
  }
}

function cancelOpenTransfers(db, studentId, actorId) {
  const now = new Date().toISOString();
  let count = 0;
  for (const request of db.studentTransferRequests) {
    if (request?.studentId !== studentId || !['pending', 'rejected'].includes(request?.status)) continue;
    request.status = 'cancelled';
    request.updatedAt = now;
    request.resolvedBy = actorId;
    request.escalatedToAdmin = false;
    request.escalationReason = 'admin-direct-class-change';
    count += 1;
  }
  return count;
}

function updateStudentAsAdmin(context, studentId, body) {
  if (context.user.role !== 'admin') {
    return { status: 403, payload: { message: 'Alleen Beheer kan leerlinggegevens direct wijzigen.' } };
  }
  const student = context.db.students.find((entry) => entry?.id === studentId && entry?.active !== false);
  if (!student) return { status: 404, payload: { message: 'Leerling niet gevonden.' } };

  const changes = [];
  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    const next = splitName(body.name);
    if (!next.name) return { status: 400, payload: { message: 'Naam mag niet leeg zijn.' } };
    if (student.name !== next.name) {
      student.name = next.name;
      student.firstName = next.firstName;
      student.lastName = next.lastName;
      changes.push('naam');
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'classIds')) {
    const requested = Array.isArray(body.classIds)
      ? Array.from(new Set(body.classIds.map((entry) => String(entry || '').trim()).filter(Boolean)))
      : [];
    if (!requested.length) {
      return { status: 400, payload: { message: 'Kies minimaal één klas.' } };
    }
    const missing = requested.filter((id) => !context.db.classes.some((entry) => entry?.id === id));
    if (missing.length) {
      return { status: 400, payload: { message: 'Een gekozen klas bestaat niet meer. Vernieuw de pagina.' } };
    }
    const before = studentClassIds(context.db, student).sort();
    const after = [...requested].sort();
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      ensureClassMembership(context.db, student, requested);
      cancelOpenTransfers(context.db, student.id, context.user.id);
      changes.push('klas');
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'parnassysStudentNumber')) {
    const nextNumber = String(body.parnassysStudentNumber || '').trim();
    const currentNumber = getParnassysStudentNumber(student);
    if (nextNumber !== currentNumber) {
      if (nextNumber) {
        const duplicate = context.db.students.find(
          (entry) => entry?.id !== student.id && getParnassysStudentNumber(entry) === nextNumber
        );
        if (duplicate) {
          return {
            status: 409,
            payload: { message: `Leerlingnummer ${nextNumber} is al gekoppeld aan ${duplicate.name || 'een andere leerling'}.` },
          };
        }
        setParnassysStudentNumber(student, nextNumber);
      } else {
        clearParnassysStudentNumber(student);
      }
      changes.push('ParnasSys-leerlingnummer');
    }
  }

  if (!changes.length) {
    return { status: 200, payload: { changed: false } };
  }

  appendHistory(
    context.db,
    'student_admin_updated',
    `${student.name || 'Leerling'} administratief bijgewerkt door Beheer: ${changes.join(', ')}.`,
    { studentId: student.id, performedBy: context.user.id, fields: changes }
  );
  writeJsonAtomic(DATA_PATH, context.db);
  return { status: 200, payload: { changed: true, fields: changes } };
}

function unlinkStudentGoogle(context, studentId) {
  if (context.user.role !== 'admin') {
    return { status: 403, payload: { message: 'Alleen Beheer kan een Google-koppeling verwijderen.' } };
  }
  const student = context.db.students.find((entry) => entry?.id === studentId && entry?.active !== false);
  if (!student) return { status: 404, payload: { message: 'Leerling niet gevonden.' } };

  const store = loadAuthStore();
  const beforeLinks = store.links.length;
  store.links = store.links.filter(
    (entry) => !(entry?.accountType === 'student' && entry?.accountId === studentId)
  );
  store.sessions = store.sessions.filter(
    (entry) => !(entry?.type === 'student' && entry?.userId === studentId)
  );
  const now = new Date().toISOString();
  for (const request of store.linkRequests) {
    if (request?.studentId === studentId && request.status === 'pending') {
      request.status = 'superseded';
      request.updatedAt = now;
      request.reviewedBy = context.user.id;
    }
  }
  saveAuthStore(store);
  return {
    status: 200,
    payload: {
      studentId,
      googleEmail: '',
      googleVerified: false,
      changed: beforeLinks !== store.links.length,
    },
  };
}

function serveScript(res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(fs.readFileSync(SCRIPT_PATH, 'utf8'));
}

function patchStudentManagementAsset(req, res, listener) {
  const originalEnd = res.end.bind(res);
  res.end = function studentDetailPatchedEnd(chunk, encoding, callback) {
    let nextChunk = chunk;
    if (chunk != null) {
      let source = Buffer.isBuffer(chunk) ? chunk.toString(encoding || 'utf8') : String(chunk);
      const needle = "const row = make('div', { className: 'student-management__student-row' });";
      if (source.includes(needle) && !source.includes('row.dataset.studentId = student.id')) {
        source = source.replace(
          needle,
          `${needle}\n    row.dataset.studentId = student.id;\n    row.dataset.sourceClassId = sourceClassOverride || '';`
        );
        nextChunk = source;
        if (!res.headersSent) res.removeHeader('Content-Length');
      }
    }
    return originalEnd(nextChunk, encoding, callback);
  };
  return listener(req, res);
}

function injectDetailScript(req, res, listener) {
  const originalEnd = res.end.bind(res);
  res.end = function studentDetailHtmlEnd(chunk, encoding, callback) {
    let nextChunk = chunk;
    const contentType = String(res.getHeader('Content-Type') || '').toLowerCase();
    if (chunk != null && (!contentType || contentType.includes('text/html'))) {
      let html = Buffer.isBuffer(chunk) ? chunk.toString(encoding || 'utf8') : String(chunk);
      if (!html.includes('/student-detail.js')) {
        html = html.replace(/<\/body>/i, '    <script src="/student-detail.js"></script>\n  </body>');
        nextChunk = html;
        if (!res.headersSent) res.removeHeader('Content-Length');
      }
    }
    return originalEnd(nextChunk, encoding, callback);
  };
  return listener(req, res);
}

function wrapRequestListener(listener) {
  return async function studentDetailAdminListener(req, res) {
    let requestUrl;
    try {
      requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch (error) {
      return listener(req, res);
    }

    if (req.method === 'GET' && requestUrl.pathname === '/student-detail.js') {
      return serveScript(res);
    }

    if (req.method === 'GET' && requestUrl.pathname === '/student-management.js') {
      return patchStudentManagementAsset(req, res, listener);
    }

    if (['/staff', '/staff.html'].includes(requestUrl.pathname)) {
      return injectDetailScript(req, res, listener);
    }

    const adminStudentMatch = requestUrl.pathname.match(/^\/api\/admin\/students\/([^/]+)$/);
    if (req.method === 'PATCH' && adminStudentMatch) {
      const initial = resolveStaff(req);
      if (!initial) return sendJson(res, 401, { message: 'Log opnieuw in.' });
      if (initial.user.role !== 'admin') {
        return sendJson(res, 403, { message: 'Alleen Beheer kan leerlinggegevens direct wijzigen.' });
      }
      try {
        const body = await parseBody(req);
        const fresh = resolveStaff(req);
        if (!fresh) return sendJson(res, 401, { message: 'Je sessie is niet meer geldig. Log opnieuw in.' });
        const result = updateStudentAsAdmin(fresh, decodeURIComponent(adminStudentMatch[1]), body);
        return sendJson(res, result.status, result.payload);
      } catch (error) {
        const status = error?.code === 'BODY_TOO_LARGE' ? 413 : error?.code === 'INVALID_JSON' ? 400 : 500;
        return sendJson(res, status, { message: error.message || 'Leerling wijzigen is mislukt.' });
      }
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/auth/google/student-email') {
      const context = resolveStaff(req);
      if (context?.user?.role === 'teacher') {
        return sendJson(res, 403, {
          message: 'Alleen Beheer kan het Google-schoolaccount van een leerling handmatig wijzigen.',
        });
      }
      if (requestUrl.searchParams.get('unlink') === '1') {
        if (!context || context.user.role !== 'admin') {
          return sendJson(res, 403, { message: 'Alleen Beheer kan een Google-koppeling verwijderen.' });
        }
        try {
          const body = await parseBody(req);
          const fresh = resolveStaff(req);
          if (!fresh || fresh.user.role !== 'admin') {
            return sendJson(res, 403, { message: 'Alleen Beheer kan een Google-koppeling verwijderen.' });
          }
          const result = unlinkStudentGoogle(fresh, String(body.studentId || '').trim());
          return sendJson(res, result.status, result.payload);
        } catch (error) {
          const status = error?.code === 'BODY_TOO_LARGE' ? 413 : error?.code === 'INVALID_JSON' ? 400 : 500;
          return sendJson(res, status, { message: error.message || 'Google-koppeling verwijderen is mislukt.' });
        }
      }
    }

    return listener(req, res);
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
    updateStudentAsAdmin,
    unlinkStudentGoogle,
  },
};
