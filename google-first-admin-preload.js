'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');
const XLSX = require('xlsx');
const core = require('./google-auth-core');
const { applyPeopleImport } = require('./google-first-people-import');

const DEFAULT_DATA_PATH = path.join(__dirname, 'data', 'db.json');
const DATA_PATH = process.env.BOEKENBAAI_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_DATA_PATH)
  : DEFAULT_DATA_PATH;
const AUTH_DATA_PATH = process.env.BOEKENBAAI_AUTH_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_AUTH_DATA_PATH)
  : `${DATA_PATH}.auth.json`;
const GOOGLE_DOMAIN = core.normalizeDomain(process.env.BOEKENBAAI_GOOGLE_DOMAIN || 'koraaledu.nl');
const SESSION_COOKIE = 'boekenbaai_session';
const MAX_BODY_BYTES = 20 * 1024 * 1024;
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
  if (!Array.isArray(db.books)) db.books = [];
  return db;
}

function loadAuthStore() {
  const raw = readJsonStrict(AUTH_DATA_PATH, {
    missingValue: core.emptyAuthStore(),
    label: 'Auth-opslag',
  });
  return core.pruneStore(core.normalizeStore(raw));
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

function resolveAdmin(req) {
  const db = readMainDb();
  const store = loadAuthStore();
  core.setLocalOnlyStaffAccountIds(
    db.users.filter((entry) => entry?.role === 'admin').map((entry) => entry.id)
  );
  const cookieToken = parseCookies(req)[SESSION_COOKIE] || '';
  const bearer = getBearerToken(req);
  const candidates = [bearer && bearer !== 'cookie' ? bearer : '', cookieToken].filter(Boolean);
  for (const token of candidates) {
    const session = core.resolveSession(store, token);
    if (!session || session.type !== 'staff') continue;
    const user = db.users.find((entry) => entry?.id === session.userId && entry?.role === 'admin');
    if (user) return { db, store, user };
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

function decodeWorkbookRows(file) {
  const raw = String(file || '').replace(/^data:.*?;base64,/, '');
  if (!raw) throw new Error('Geen Excelbestand ontvangen.');
  const buffer = Buffer.from(raw, 'base64');
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new Error('Het Excelbestand bevat geen werkblad.');
  const sheet = workbook.Sheets[firstSheet];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (!rows.length) throw new Error('Het Excelbestand bevat geen gegevensrijen.');
  return rows;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function importPeople(context, kind, file, preview) {
  const rows = decodeWorkbookRows(file);
  const result = applyPeopleImport({
    kind,
    rows,
    db: clone(context.db),
    store: clone(context.store),
    domain: GOOGLE_DOMAIN,
    actorId: context.user.id,
  });
  if (!preview) {
    writeJsonAtomic(DATA_PATH, result.db);
    writeJsonAtomic(AUTH_DATA_PATH, core.pruneStore(result.store));
  }
  return {
    preview: Boolean(preview),
    domain: GOOGLE_DOMAIN,
    summary: result.summary,
    results: result.results,
  };
}

function buildAdminSummary(context) {
  const students = context.db.students.filter((entry) => entry?.active !== false);
  const teachers = context.db.users.filter((entry) => entry?.role === 'teacher' && entry?.active !== false);
  const links = core.normalizeStore(context.store).links;
  const studentLinks = new Set(
    links.filter((entry) => entry?.accountType === 'student').map((entry) => entry.accountId)
  );
  const teacherLinks = new Set(
    links.filter((entry) => entry?.accountType === 'staff').map((entry) => entry.accountId)
  );
  const pendingRequests = core.pruneStore(context.store).linkRequests.filter(
    (entry) => entry?.status === 'pending'
  );
  return {
    students: students.length,
    teachers: teachers.length,
    classes: context.db.classes.length,
    books: context.db.books.length,
    studentLinks: studentLinks.size,
    teacherLinks: teacherLinks.size,
    studentsUnlinked: students.filter((entry) => !studentLinks.has(entry.id)).length,
    teachersUnlinked: teachers.filter((entry) => !teacherLinks.has(entry.id)).length,
    pendingRequests: pendingRequests.length,
  };
}

function wrapRequestListener(listener) {
  return async function googleFirstAdminListener(req, res) {
    let requestUrl;
    try {
      requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch (error) {
      return listener(req, res);
    }
    try {
      if (requestUrl.pathname === '/api/admin/google-first/summary' && req.method === 'GET') {
        const context = resolveAdmin(req);
        if (!context) return sendJson(res, 403, { message: 'Alleen beheerders kunnen dit overzicht bekijken.' });
        return sendJson(res, 200, buildAdminSummary(context));
      }

      if (requestUrl.pathname === '/api/admin/google-first/import' && req.method === 'POST') {
        const initialContext = resolveAdmin(req);
        if (!initialContext) return sendJson(res, 403, { message: 'Alleen beheerders kunnen personen importeren.' });
        const body = await parseBody(req);
        const context = resolveAdmin(req);
        if (!context) return sendJson(res, 403, { message: 'Je beheerderssessie is niet meer geldig. Log opnieuw in.' });
        const kind = body.kind === 'teacher' ? 'teacher' : body.kind === 'student' ? 'student' : '';
        if (!kind) return sendJson(res, 400, { message: 'Kies leerlingen of docenten.' });
        if (!body.file) return sendJson(res, 400, { message: 'Geen Excelbestand ontvangen.' });
        return sendJson(res, 200, importPeople(context, kind, body.file, Boolean(body.preview)));
      }

      return listener(req, res);
    } catch (error) {
      console.error('[Google-first beheer]', error?.message || error);
      if (!res.headersSent && !res.writableEnded) {
        return sendJson(res, error?.code === 'BODY_TOO_LARGE' ? 413 : 400, {
          message: error?.message || 'Beheeractie mislukt.',
        });
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
    loadAuthStore,
    resolveAdmin,
    decodeWorkbookRows,
    importPeople,
    buildAdminSummary,
  },
};
