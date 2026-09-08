'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');
const {
  MAX_QUERY_LENGTH,
  normalizeSearchText,
  buildStudentMatches,
  DirectoryRateLimiter,
} = require('./login-directory-core');
const core = require('./google-auth-core');

const DEFAULT_DATA_PATH = path.join(__dirname, 'data', 'db.json');
const DATA_PATH = process.env.BOEKENBAAI_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_DATA_PATH)
  : DEFAULT_DATA_PATH;
const CONFIGURED_PUBLIC_URL = String(process.env.BOEKENBAAI_PUBLIC_URL || '').replace(/\/$/, '');
const DIRECTORY_COOKIE = 'boekenbaai_login_directory';
const DIRECTORY_COOKIE_MAX_AGE_SECONDS = 30 * 60;
const originalCreateServer = http.createServer.bind(http);
const directoryLimiter = new DirectoryRateLimiter();

function readDatabase() {
  const raw = fs.readFileSync(DATA_PATH, 'utf8');
  const db = JSON.parse(raw);
  if (!db || typeof db !== 'object' || Array.isArray(db)) {
    throw new Error('Boekenbaai database heeft een ongeldig formaat.');
  }
  if (!Array.isArray(db.students)) db.students = [];
  if (!Array.isArray(db.classes)) db.classes = [];
  return db;
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

function requestUsesHttps(req) {
  if (CONFIGURED_PUBLIC_URL) {
    try {
      return new URL(CONFIGURED_PUBLIC_URL).protocol === 'https:';
    } catch (error) {
      // Val terug op proxy/socketinformatie.
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
  const existing = String(parseCookies(req)[DIRECTORY_COOKIE] || '');
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

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(payload));
}

function studentClassNames(db, studentId) {
  const ids = new Set(core.getStudentClassIds(db, studentId));
  return db.classes
    .filter((entry) => ids.has(entry.id))
    .map((entry) => String(entry?.name || '').trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'nl'));
}

function handleStudentDirectory(req, res, requestUrl) {
  if (isKnownCrossOriginRequest(req)) {
    return sendJson(res, 403, { message: 'Zoek namen vanuit de Boekenbaai-inlogpagina.' });
  }
  const rawQuery = String(requestUrl.searchParams.get('q') || '');
  if (rawQuery.length > MAX_QUERY_LENGTH) {
    return sendJson(res, 400, { message: 'Zoekopdracht is te lang.' });
  }
  const query = normalizeSearchText(rawQuery);
  if (query.length < 2) return sendJson(res, 200, { matches: [] });

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

  const db = readDatabase();
  const safeDb = {
    ...db,
    students: db.students.filter((entry) => entry?.active !== false),
  };
  const matches = buildStudentMatches(safeDb, query).map((match) => {
    const classLabel = studentClassNames(db, match.id).join(', ');
    const displayName = classLabel
      ? `${match.displayName || match.name} · ${classLabel}`
      : (match.displayName || match.name);
    return {
      id: match.id,
      name: displayName,
      displayName,
      type: 'student',
    };
  });
  return sendJson(res, 200, { matches });
}

function selectedInactiveStudent(requestUrl) {
  const type = requestUrl.searchParams.get('type') === 'staff' ? 'staff' : 'student';
  if (type !== 'student') return null;
  const accountId = String(requestUrl.searchParams.get('accountId') || '').trim();
  if (!accountId) return null;
  const db = readDatabase();
  const student = db.students.find((entry) => entry?.id === accountId);
  return !student || student.active === false ? accountId : null;
}

function injectCompatibilityAsset(req, res, listener) {
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
      if (!html.includes('/student-management-compat.js')) {
        html = html.replace(/<\/body>/i, '  <script src="/student-management-compat.js"></script>\n</body>');
      }
      nextChunk = html;
      res.removeHeader('Content-Length');
    }
    if (enc !== undefined) return originalEnd(nextChunk, enc, cb);
    return originalEnd(nextChunk, cb);
  };
  return listener(req, res);
}

function wrapRequestListener(listener) {
  return function studentLoginDirectoryListener(req, res) {
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
        return handleStudentDirectory(req, res, requestUrl);
      }

      if (
        req.method === 'GET' &&
        ['/api/auth/login-mode', '/api/auth/google/start-token', '/api/auth/google/start'].includes(requestUrl.pathname) &&
        selectedInactiveStudent(requestUrl)
      ) {
        if (requestUrl.pathname === '/api/auth/google/start') {
          res.statusCode = 302;
          res.setHeader('Location', '/index.html?googleAuth=select-account');
          res.setHeader('Cache-Control', 'no-store');
          res.end();
          return undefined;
        }
        return sendJson(res, 404, { message: 'Deze leerling is niet meer actief. Kies opnieuw je naam.' });
      }

      return injectCompatibilityAsset(req, res, listener);
    } catch (error) {
      console.error('[Leerlinglogin]', error?.message || error);
      if (!res.headersSent && !res.writableEnded) {
        return sendJson(res, 500, { message: 'De leerlinglijst kon niet worden geladen.' });
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
    studentClassNames,
    selectedInactiveStudent,
    handleStudentDirectory,
  },
};
