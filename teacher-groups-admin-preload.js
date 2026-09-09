'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { URL } = require('url');
const core = require('./google-auth-core');

const DEFAULT_DATA_PATH = path.join(__dirname, 'data', 'db.json');
const DATA_PATH = process.env.BOEKENBAAI_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_DATA_PATH)
  : DEFAULT_DATA_PATH;
const AUTH_DATA_PATH = process.env.BOEKENBAAI_AUTH_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_AUTH_DATA_PATH)
  : `${DATA_PATH}.auth.json`;
const SCRIPT_PATH = path.join(__dirname, 'public', 'teacher-groups.js');
const SESSION_COOKIE = 'boekenbaai_session';
const originalCreateServer = http.createServer.bind(http);

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

function readDb() {
  const db = readJson(DATA_PATH, {});
  if (!Array.isArray(db.users)) db.users = [];
  if (!Array.isArray(db.classes)) db.classes = [];
  return db;
}

function readAuthStore() {
  return core.pruneStore(core.normalizeStore(readJson(AUTH_DATA_PATH, core.emptyAuthStore())));
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

function requestTokens(req) {
  const bearerMatch = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  const bearer = bearerMatch ? bearerMatch[1].trim() : '';
  const cookie = parseCookies(req)[SESSION_COOKIE] || '';
  return Array.from(new Set([bearer && bearer !== 'cookie' ? bearer : '', cookie].filter(Boolean)));
}

function resolveStaff(req) {
  const db = readDb();
  const store = readAuthStore();
  for (const token of requestTokens(req)) {
    const session = core.resolveSession(store, token);
    if (!session || session.type !== 'staff') continue;
    const user = db.users.find(
      (entry) => entry?.id === session.userId && entry?.active !== false && ['teacher', 'admin'].includes(entry?.role)
    );
    if (user) return { db, user };
  }
  return null;
}

function teacherClassIds(db, teacher) {
  const ids = new Set(Array.isArray(teacher?.classIds) ? teacher.classIds.filter(Boolean) : []);
  for (const klass of db.classes) {
    if (Array.isArray(klass?.teacherIds) && klass.teacherIds.includes(teacher.id)) ids.add(klass.id);
  }
  return ids;
}

function buildTeacherGroups(db) {
  const teachers = db.users
    .filter((entry) => entry?.role === 'teacher' && entry?.active !== false)
    .map((entry) => ({
      id: entry.id,
      name: entry.name || entry.username || 'Docent',
      username: entry.username || '',
      classIds: Array.from(teacherClassIds(db, entry)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'nl'));

  const classes = db.classes
    .filter(Boolean)
    .map((klass) => ({
      id: klass.id,
      name: klass.name || 'Naamloze klas',
      teachers: teachers
        .filter((teacher) => teacher.classIds.includes(klass.id))
        .map(({ id, name, username }) => ({ id, name, username })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'nl'));

  const assigned = new Set(classes.flatMap((klass) => klass.teachers.map((teacher) => teacher.id)));
  const unassigned = teachers
    .filter((teacher) => !assigned.has(teacher.id))
    .map(({ id, name, username }) => ({ id, name, username }));

  return { classes, unassigned };
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(payload));
}

function serveScript(res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(fs.readFileSync(SCRIPT_PATH, 'utf8'));
}

function injectScript(req, res, listener) {
  const originalEnd = res.end.bind(res);
  res.end = function teacherGroupsHtmlEnd(chunk, encoding, callback) {
    let nextChunk = chunk;
    const contentType = String(res.getHeader('Content-Type') || '').toLowerCase();
    if (chunk != null && (!contentType || contentType.includes('text/html'))) {
      let html = Buffer.isBuffer(chunk) ? chunk.toString(encoding || 'utf8') : String(chunk);
      if (!html.includes('/teacher-groups.js')) {
        html = html.replace(/<\/body>/i, '    <script src="/teacher-groups.js"></script>\n  </body>');
        nextChunk = html;
        if (!res.headersSent) res.removeHeader('Content-Length');
      }
    }
    return originalEnd(nextChunk, encoding, callback);
  };
  return listener(req, res);
}

function wrapListener(listener) {
  return function teacherGroupsListener(req, res) {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && requestUrl.pathname === '/teacher-groups.js') {
      return serveScript(res);
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/admin/teacher-groups') {
      try {
        const context = resolveStaff(req);
        if (!context) return sendJson(res, 401, { message: 'Log opnieuw in.' });
        if (context.user.role !== 'admin') {
          return sendJson(res, 403, { message: 'Alleen Beheer kan alle docentkoppelingen bekijken.' });
        }
        return sendJson(res, 200, buildTeacherGroups(context.db));
      } catch (error) {
        console.error('[Teacher groups] Ophalen mislukt:', error?.message || error);
        return sendJson(res, 500, { message: 'Docenten per klas konden niet worden geladen.' });
      }
    }

    if (!requestUrl.pathname.startsWith('/api/')) {
      return injectScript(req, res, listener);
    }
    return listener(req, res);
  };
}

http.createServer = function patchedCreateServer(...args) {
  const listenerIndex = typeof args[0] === 'function' ? 0 : 1;
  const listener = args[listenerIndex];
  if (typeof listener !== 'function') return originalCreateServer(...args);
  const wrapped = wrapListener(listener);
  if (listenerIndex === 0) return originalCreateServer(wrapped);
  return originalCreateServer(args[0], wrapped);
};

module.exports = { __test: { buildTeacherGroups } };
