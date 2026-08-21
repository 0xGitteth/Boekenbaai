'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');
const authCore = require('./google-auth-core');
const {
  MAX_QUERY_LENGTH,
  normalizeSearchText,
  buildStudentMatches,
  buildStaffMatches,
  DirectoryRateLimiter,
} = require('./login-directory-core');

const DEFAULT_DATA_PATH = path.join(__dirname, 'data', 'db.json');
const DATA_PATH = process.env.BOEKENBAAI_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_DATA_PATH)
  : DEFAULT_DATA_PATH;
const CONFIGURED_PUBLIC_URL = String(process.env.BOEKENBAAI_PUBLIC_URL || '').replace(/\/$/, '');
const DIRECTORY_COOKIE = 'boekenbaai_login_directory';
const DIRECTORY_COOKIE_MAX_AGE_SECONDS = 30 * 60;

const originalCreateServer = http.createServer.bind(http);
const directoryLimiter = new DirectoryRateLimiter();

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(payload));
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

function readDatabase() {
  const raw = fs.readFileSync(DATA_PATH, 'utf8');
  const db = JSON.parse(raw);
  if (!db || typeof db !== 'object' || Array.isArray(db)) {
    throw new Error('Boekenbaai database heeft een ongeldig formaat.');
  }
  if (!Array.isArray(db.users)) db.users = [];
  if (!Array.isArray(db.students)) db.students = [];
  if (!Array.isArray(db.classes)) db.classes = [];
  return db;
}

function applyLocalOnlyPolicy(db) {
  const adminIds = (db?.users || [])
    .filter((entry) => entry?.role === 'admin' && entry?.id)
    .map((entry) => entry.id);
  authCore.setLocalOnlyStaffAccountIds(adminIds);
  return adminIds;
}

function readDatabaseWithPolicy() {
  const db = readDatabase();
  applyLocalOnlyPolicy(db);
  return db;
}

function getSelectedAccount(db, type, accountId) {
  const id = String(accountId || '').trim();
  if (!id) return null;
  if (type === 'student') {
    const account = db.students.find((entry) => entry?.id === id);
    return account ? { id: account.id, role: 'student', authMode: 'google' } : null;
  }
  const account = db.users.find(
    (entry) => entry?.id === id && ['teacher', 'admin'].includes(entry?.role)
  );
  if (!account) return null;
  return {
    id: account.id,
    role: account.role,
    authMode: account.role === 'admin' ? 'password' : 'google',
  };
}

function modeErrorRedirect(type, code) {
  const page = type === 'staff' ? '/staff.html' : '/index.html';
  return `${page}?googleAuth=${encodeURIComponent(code)}`;
}

function parseCookies(req) {
  const result = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const rawValue = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(rawValue);
    } catch (error) {
      result[key] = rawValue;
    }
  }
  return result;
}

function requestUsesHttps(req) {
  if (CONFIGURED_PUBLIC_URL) {
    try {
      return new URL(CONFIGURED_PUBLIC_URL).protocol === 'https:';
    } catch (error) {
      // Val terug op de proxy/socketinformatie.
    }
  }
  const forwarded = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
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
    .split(',')[0]
    .trim()
    .slice(0, 128);
  const remote = String(req.socket?.remoteAddress || '').trim().slice(0, 128);
  return hashRateKey(`${forwarded || 'no-forwarded'}\u0000${remote || 'no-remote'}`);
}

function isKnownCrossOriginRequest(req) {
  const site = String(req.headers['sec-fetch-site'] || '').trim().toLowerCase();
  return Boolean(site && site !== 'same-origin');
}

function sendDirectoryRateLimit(res, status) {
  res.setHeader('Retry-After', String(status.retryAfterSeconds || 60));
  return sendJson(res, 429, {
    message: 'Te veel naamzoekopdrachten. Wacht even en probeer opnieuw.',
    retryAfterSeconds: status.retryAfterSeconds || 60,
  });
}

function handleLoginDirectory(req, res, requestUrl) {
  if (isKnownCrossOriginRequest(req)) {
    return sendJson(res, 403, {
      message: 'Zoek namen vanuit de Boekenbaai-inlogpagina.',
    });
  }

  const type = String(requestUrl.searchParams.get('type') || 'student').trim().toLowerCase();
  if (!['student', 'staff'].includes(type)) {
    return sendJson(res, 400, { message: 'Ongeldig accounttype.' });
  }

  const rawQuery = String(requestUrl.searchParams.get('q') || '');
  if (rawQuery.length > MAX_QUERY_LENGTH) {
    return sendJson(res, 400, { message: 'Zoekopdracht is te lang.' });
  }
  const normalizedQuery = normalizeSearchText(rawQuery);
  if (normalizedQuery.length < 2) {
    return sendJson(res, 200, { matches: [] });
  }

  const browserNonce = ensureDirectoryCookie(req, res);
  const networkKey = directoryNetworkKey(req);
  const browserKey = hashRateKey(`${networkKey}\u0000${browserNonce}`);
  const rate = directoryLimiter.checkAndRecord({ browserKey, networkKey });
  if (!rate.allowed) return sendDirectoryRateLimit(res, rate);

  const db = readDatabaseWithPolicy();
  const matches = type === 'staff'
    ? buildStaffMatches(db, normalizedQuery)
    : buildStudentMatches(db, normalizedQuery);
  return sendJson(res, 200, { matches });
}

function wrapRequestListener(listener) {
  return function loginFlowPolicyListener(req, res) {
    let requestUrl;
    try {
      requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch (error) {
      return listener(req, res);
    }

    try {
      if (req.method === 'GET' && requestUrl.pathname === '/api/login-search') {
        return handleLoginDirectory(req, res, requestUrl);
      }

      if (
        requestUrl.pathname === '/api/auth/login-mode' ||
        requestUrl.pathname.startsWith('/api/auth/google/')
      ) {
        readDatabaseWithPolicy();
      }

      if (req.method === 'GET' && requestUrl.pathname === '/api/auth/login-mode') {
        const type = requestUrl.searchParams.get('type') === 'staff' ? 'staff' : 'student';
        const accountId = requestUrl.searchParams.get('accountId') || '';
        const account = getSelectedAccount(readDatabaseWithPolicy(), type, accountId);
        if (!account) {
          return sendJson(res, 404, { message: 'Kies een geldig account uit de lijst.' });
        }
        return sendJson(res, 200, {
          accountId: account.id,
          authMode: account.authMode,
        });
      }

      if (req.method === 'GET' && requestUrl.pathname === '/api/auth/google/start') {
        const type = requestUrl.searchParams.get('type') === 'staff' ? 'staff' : 'student';
        const accountId = requestUrl.searchParams.get('accountId') || '';
        const account = getSelectedAccount(readDatabaseWithPolicy(), type, accountId);
        if (!account) {
          return redirect(res, modeErrorRedirect(type, 'select-account'));
        }
        if (account.authMode !== 'google') {
          return redirect(res, modeErrorRedirect(type, 'local-only'));
        }
        return listener(req, res);
      }

      return listener(req, res);
    } catch (error) {
      console.error('[Login policy] Interne fout:', error?.message || error);
      if (!res.headersSent && !res.writableEnded) {
        return sendJson(res, 500, { message: 'Inlogbeleid kon niet worden gecontroleerd.' });
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
    DIRECTORY_COOKIE,
    readDatabase,
    readDatabaseWithPolicy,
    applyLocalOnlyPolicy,
    getSelectedAccount,
    parseCookies,
    directoryNetworkKey,
    isKnownCrossOriginRequest,
    handleLoginDirectory,
  },
};
