'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const core = require('./google-auth-core');
const {
  getExpectedOrigin,
  isMutationRequest,
  isSameOriginMutation,
  validatePersistedSession,
  decorateSessionResult,
} = require('./google-auth-security-core');
const {
  snapshotGoogleLinks,
  findChangedExistingGoogleAccounts,
  revokePersistedSessionsForAccounts,
} = require('./google-link-session-revocation-core');

const originalCreateServer = http.createServer.bind(http);
const originalUpsertSession = core.upsertSession;
const requestContext = new AsyncLocalStorage();
const revokedTokenHashes = new Set();

const DEFAULT_DATA_PATH = path.join(__dirname, 'data', 'db.json');
const DATA_PATH = process.env.BOEKENBAAI_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_DATA_PATH)
  : DEFAULT_DATA_PATH;
const AUTH_DATA_PATH = process.env.BOEKENBAAI_AUTH_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_AUTH_DATA_PATH)
  : `${DATA_PATH}.auth.json`;
const CONFIGURED_PUBLIC_URL = String(process.env.BOEKENBAAI_PUBLIC_URL || '').replace(/\/$/, '');

const SESSION_COOKIE = 'boekenbaai_session';
const SESSION_HINT_COOKIE = 'boekenbaai_auth_hint';
const OAUTH_NONCE_COOKIE = 'boekenbaai_oauth_nonce';
const PENDING_COOKIE = 'boekenbaai_google_pending';
const SESSION_SENTINEL = 'cookie';
const GOOGLE_LINK_MUTATION_PATHS = new Set([
  '/api/auth/google/student-email',
  '/api/auth/google/staff-email',
]);

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readMainDb() {
  const db = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  if (!Array.isArray(db.users)) db.users = [];
  if (!Array.isArray(db.students)) db.students = [];
  if (!Array.isArray(db.classes)) db.classes = [];
  return db;
}

function readAuthStoreStrict() {
  let raw;
  try {
    raw = fs.readFileSync(AUTH_DATA_PATH, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return core.emptyAuthStore();
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const wrapped = new Error('Auth-opslag is beschadigd en wordt niet overschreven.');
    wrapped.code = 'AUTH_STORE_CORRUPT';
    throw wrapped;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const error = new Error('Auth-opslag heeft een ongeldig formaat.');
    error.code = 'AUTH_STORE_CORRUPT';
    throw error;
  }
  for (const field of ['links', 'sessions', 'pendingIdentities', 'linkRequests']) {
    if (parsed[field] !== undefined && !Array.isArray(parsed[field])) {
      const error = new Error(`Auth-opslagveld ${field} heeft een ongeldig formaat.`);
      error.code = 'AUTH_STORE_CORRUPT';
      throw error;
    }
  }
  return core.normalizeStore(parsed);
}

function saveAuthStoreStrict(store) {
  const normalized = core.pruneStore(core.normalizeStore(store));
  ensureParentDirectory(AUTH_DATA_PATH);
  const tmp = `${AUTH_DATA_PATH}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2));
  fs.renameSync(tmp, AUTH_DATA_PATH);
  return normalized;
}

function parseCookies(req) {
  const cookies = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(value);
    } catch (error) {
      cookies[name] = value;
    }
  }
  return cookies;
}

function getBearerToken(req) {
  const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function appendSetCookie(res, cookie) {
  const current = res.getHeader('Set-Cookie');
  const values = current ? (Array.isArray(current) ? current : [current]) : [];
  res.setHeader('Set-Cookie', [...values, cookie]);
}

function clearAuthCookies(res, secure) {
  const suffix = `; Path=/; Max-Age=0; SameSite=Lax${secure ? '; Secure' : ''}`;
  appendSetCookie(res, `${SESSION_COOKIE}=${suffix}`);
  appendSetCookie(res, `${SESSION_HINT_COOKIE}=${suffix}`);
  appendSetCookie(res, `${OAUTH_NONCE_COOKIE}=${suffix}; HttpOnly`);
  appendSetCookie(res, `${PENDING_COOKIE}=${suffix}; HttpOnly`);
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function removePersistedToken(store, tokenHash) {
  store.sessions = (store.sessions || []).filter((entry) => entry?.tokenHash !== tokenHash);
  revokedTokenHashes.add(tokenHash);
  return store;
}

function shouldReadAuthStore(pathname, cookies, bearer) {
  if (cookies[SESSION_COOKIE] || cookies[PENDING_COOKIE]) return true;
  if (bearer && bearer !== SESSION_SENTINEL) return true;
  return (
    pathname.startsWith('/api/auth/google/') &&
    !['/api/auth/google/config', '/api/auth/google/start'].includes(pathname)
  ) || pathname.startsWith('/api/auth/session/');
}

function shouldWatchGoogleLinkMutation(req, pathname) {
  if (String(req?.method || '').toUpperCase() !== 'POST') return false;
  if (GOOGLE_LINK_MUTATION_PATHS.has(pathname)) return true;
  return /^\/api\/auth\/google\/link-requests\/[\w-]+\/approve$/.test(pathname);
}

function installGoogleLinkSessionRevocation(res, beforeStore) {
  const beforeSnapshot = snapshotGoogleLinks(beforeStore);
  const originalEnd = res.end.bind(res);
  let processed = false;

  res.end = function patchedGoogleLinkMutationEnd(chunk, encoding, callback) {
    if (!processed) {
      processed = true;
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const latestStore = readAuthStoreStrict();
        const changedAccounts = findChangedExistingGoogleAccounts(beforeSnapshot, latestStore);
        if (changedAccounts.length) {
          const revoked = revokePersistedSessionsForAccounts(latestStore, changedAccounts);
          if (revoked.revokedTokenHashes.length) {
            for (const hash of revoked.revokedTokenHashes) {
              revokedTokenHashes.add(hash);
            }
            saveAuthStoreStrict(revoked.store);
          }
        }
      }
    }
    return originalEnd(chunk, encoding, callback);
  };
}

function wrapMeResponse(res, activeSession) {
  if (activeSession?.authMethod !== 'google') return;
  const originalEnd = res.end.bind(res);
  res.end = function patchedEnd(chunk, encoding, callback) {
    const contentType = String(res.getHeader('Content-Type') || '');
    if (
      chunk != null &&
      contentType.includes('application/json') &&
      res.statusCode >= 200 &&
      res.statusCode < 300
    ) {
      try {
        const raw = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        const payload = JSON.parse(raw);
        if (payload && typeof payload === 'object') {
          payload.mustChangePassword = false;
          return originalEnd(JSON.stringify(payload), encoding, callback);
        }
      } catch (error) {
        // Laat het oorspronkelijke antwoord ongemoeid als het geen valide JSON is.
      }
    }
    return originalEnd(chunk, encoding, callback);
  };
}

function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

core.upsertSession = function hardenedUpsertSession(store, token, input = {}) {
  const result = originalUpsertSession(store, token, input);
  const context = requestContext.getStore() || {};
  return decorateSessionResult(result, readMainDb(), context.pathname || '');
};

function wrapRequestListener(listener) {
  return function securityGuardListener(req, res) {
    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = requestUrl.pathname;
      const expectedOrigin = getExpectedOrigin(req, CONFIGURED_PUBLIC_URL);
      const secure = expectedOrigin.startsWith('https://');
      const cookies = parseCookies(req);
      const bearer = getBearerToken(req);
      const hasAmbientAuth = Boolean(cookies[SESSION_COOKIE] || cookies[PENDING_COOKIE]);

      applySecurityHeaders(res);

      if (hasAmbientAuth && isMutationRequest(req.method) && !isSameOriginMutation(req, expectedOrigin)) {
        return sendJson(res, 403, { message: 'Dit verzoek is om veiligheidsredenen geblokkeerd.' });
      }

      let authStore = null;
      let activeSession = null;
      if (shouldReadAuthStore(pathname, cookies, bearer)) {
        authStore = readAuthStoreStrict();
      }

      const cookieToken = cookies[SESSION_COOKIE] || '';
      if (cookieToken && bearer && bearer !== SESSION_SENTINEL && bearer !== cookieToken) {
        return sendJson(res, 401, { message: 'Ongeldige combinatie van sessies' });
      }

      const db = cookieToken || (bearer && bearer !== SESSION_SENTINEL) ? readMainDb() : null;

      if (cookieToken) {
        const cookieHash = core.tokenHash(cookieToken);
        if (revokedTokenHashes.has(cookieHash)) {
          clearAuthCookies(res, secure);
          return pathname.startsWith('/api/')
            ? sendJson(res, 401, { message: 'Sessie is verlopen' })
            : listener(req, res);
        }
        const validation = validatePersistedSession(
          authStore || core.emptyAuthStore(),
          cookieToken,
          db
        );
        if (!validation.valid) {
          if (authStore) {
            removePersistedToken(authStore, validation.tokenHash);
            saveAuthStoreStrict(authStore);
          }
          clearAuthCookies(res, secure);
          return pathname.startsWith('/api/')
            ? sendJson(res, 401, { message: 'Sessie is verlopen' })
            : listener(req, res);
        }
        activeSession = validation.session;
      }

      if (bearer && bearer !== SESSION_SENTINEL) {
        const bearerHash = core.tokenHash(bearer);
        if (revokedTokenHashes.has(bearerHash)) {
          return sendJson(res, 401, { message: 'Sessie is verlopen' });
        }
        const persistent = (authStore?.sessions || []).find((entry) => entry?.tokenHash === bearerHash);
        if (persistent) {
          const validation = validatePersistedSession(authStore, bearer, db);
          if (!validation.valid) {
            removePersistedToken(authStore, validation.tokenHash);
            saveAuthStoreStrict(authStore);
            clearAuthCookies(res, secure);
            return sendJson(res, 401, { message: 'Sessie is verlopen' });
          }
          activeSession = validation.session;
        }
      }

      if (pathname === '/api/me' && activeSession) {
        wrapMeResponse(res, activeSession);
      }
      if (authStore && shouldWatchGoogleLinkMutation(req, pathname)) {
        installGoogleLinkSessionRevocation(res, authStore);
      }

      return requestContext.run({ pathname }, () => listener(req, res));
    } catch (error) {
      console.error('[Auth Security] Verzoek geblokkeerd door een interne fout:', error?.message || error);
      if (!res.headersSent && !res.writableEnded) {
        return sendJson(res, 503, { message: 'Inloggen is tijdelijk niet beschikbaar.' });
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
    readAuthStoreStrict,
  },
};
