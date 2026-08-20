'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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
const GOOGLE_CLIENT_SECRET =
  process.env.BOEKENBAAI_GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '';
const AUTH_SECRET = process.env.BOEKENBAAI_AUTH_SECRET || GOOGLE_CLIENT_SECRET || '';
const CONFIGURED_PUBLIC_URL = String(process.env.BOEKENBAAI_PUBLIC_URL || '').replace(/\/$/, '');

const PENDING_COOKIE = 'boekenbaai_google_pending';
const SELECTED_ACCOUNT_COOKIE = 'boekenbaai_google_selected_account';
const SESSION_COOKIE = 'boekenbaai_session';
const SESSION_HINT_COOKIE = 'boekenbaai_auth_hint';
const SELECTION_MAX_AGE_MS = 15 * 60 * 1000;

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

function readMainDb() {
  const db = readJsonStrict(DATA_PATH, { label: 'Boekenbaai database' });
  if (!db || typeof db !== 'object' || Array.isArray(db)) {
    throw new Error('Boekenbaai database heeft een ongeldig formaat.');
  }
  if (!Array.isArray(db.students)) db.students = [];
  return db;
}

function loadAuthStore() {
  const raw = readJsonStrict(AUTH_DATA_PATH, {
    missingValue: core.emptyAuthStore(),
    label: 'Auth-opslag',
  });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Auth-opslag heeft een ongeldig formaat.');
  }
  for (const field of ['links', 'sessions', 'pendingIdentities', 'linkRequests']) {
    if (raw[field] !== undefined && !Array.isArray(raw[field])) {
      throw new Error(`Auth-opslagveld ${field} is ongeldig.`);
    }
  }
  return core.pruneStore(core.normalizeStore(raw));
}

function saveAuthStore(store) {
  const normalized = core.pruneStore(core.normalizeStore(store));
  fs.mkdirSync(path.dirname(AUTH_DATA_PATH), { recursive: true });
  const tmp = `${AUTH_DATA_PATH}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2));
  fs.renameSync(tmp, AUTH_DATA_PATH);
  return normalized;
}

function parseCookies(req) {
  const result = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(value);
    } catch (error) {
      result[key] = value;
    }
  }
  return result;
}

function isHttpsRequest(req) {
  const forwarded = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (forwarded) return forwarded === 'https';
  return Boolean(req.socket?.encrypted);
}

function useSecureCookies(req) {
  if (CONFIGURED_PUBLIC_URL) {
    try {
      return new URL(CONFIGURED_PUBLIC_URL).protocol === 'https:';
    } catch (error) {
      return isHttpsRequest(req);
    }
  }
  return isHttpsRequest(req);
}

function serializeCookie(name, value, { httpOnly = true, maxAge } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/'];
  if (maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  if (httpOnly) parts.push('HttpOnly');
  if (useSecureCookieFlag) parts.push('Secure');
  parts.push('SameSite=Lax');
  return parts.join('; ');
}

let useSecureCookieFlag = false;

function cookieForRequest(req, name, value, options = {}) {
  const previous = useSecureCookieFlag;
  useSecureCookieFlag = useSecureCookies(req);
  try {
    return serializeCookie(name, value, options);
  } finally {
    useSecureCookieFlag = previous;
  }
}

function appendSetCookie(res, cookie) {
  const current = res.getHeader('Set-Cookie');
  const values = current ? (Array.isArray(current) ? current : [current]) : [];
  res.setHeader('Set-Cookie', [...values, cookie]);
}

function clearCookie(req, res, name, httpOnly = true) {
  appendSetCookie(res, cookieForRequest(req, name, '', { httpOnly, maxAge: 0 }));
}

function clearSelectedAccountCookie(req, res) {
  clearCookie(req, res, SELECTED_ACCOUNT_COOKIE, true);
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function selectedAccountState(req) {
  const signed = parseCookies(req)[SELECTED_ACCOUNT_COOKIE] || '';
  if (!signed || !AUTH_SECRET) return null;
  const state = core.verifySignedState(signed, AUTH_SECRET, {
    maxAgeMs: SELECTION_MAX_AGE_MS,
  });
  if (!state || !state.accountId || !['student', 'staff'].includes(state.type)) return null;
  return {
    type: state.type,
    accountId: String(state.accountId).trim(),
  };
}

function pendingIdentityForRequest(req, store) {
  const token = parseCookies(req)[PENDING_COOKIE] || '';
  if (!token) return null;
  const tokenHash = core.tokenHash(token);
  return store.pendingIdentities.find(
    (entry) => entry?.tokenHash === tokenHash && Number(entry?.expiresAt) > Date.now()
  ) || null;
}

function verifiedLinkConflicts(link, pending) {
  return Boolean(
    link?.sub &&
    (String(link.sub) !== String(pending.sub) ||
      core.normalizeEmail(link.email) !== core.normalizeEmail(pending.email))
  );
}

function identityLinkedElsewhere(store, pending, studentId) {
  for (const accountType of ['student', 'staff']) {
    const link = core.findLinkByIdentity(store, accountType, {
      email: pending.email,
      sub: pending.sub,
    });
    if (!link) continue;
    if (accountType === 'student' && link.accountId === studentId) continue;
    return link;
  }
  return null;
}

function findLatestRequest(store, pending, studentId) {
  return store.linkRequests
    .filter(
      (entry) =>
        entry?.studentId === studentId &&
        String(entry?.sub || '') === String(pending.sub || '') &&
        core.normalizeEmail(entry?.email) === core.normalizeEmail(pending.email)
    )
    .sort((left, right) => {
      const leftTime = Date.parse(left?.updatedAt || left?.createdAt || '') || 0;
      const rightTime = Date.parse(right?.updatedAt || right?.createdAt || '') || 0;
      return rightTime - leftTime;
    })[0] || null;
}

function createAutomaticLinkRequest(req, res) {
  const selection = selectedAccountState(req);
  if (!selection || selection.type !== 'student') {
    return sendJson(res, 404, {
      automatic: false,
      message: 'Geen beveiligde leerlingselectie beschikbaar.',
    });
  }

  const db = readMainDb();
  const studentId = selection.accountId;
  if (!db.students.some((entry) => entry?.id === studentId)) {
    clearSelectedAccountCookie(req, res);
    return sendJson(res, 404, { message: 'Het gekozen leerlingaccount bestaat niet meer.' });
  }

  let store = loadAuthStore();
  const pending = pendingIdentityForRequest(req, store);
  if (!pending) {
    clearSelectedAccountCookie(req, res);
    return sendJson(res, 401, { message: 'Google-koppeling is verlopen. Log opnieuw in.' });
  }

  pending.studentId = studentId;

  const existingLink = core.findLinkByAccount(store, 'student', studentId);
  if (verifiedLinkConflicts(existingLink, pending)) {
    saveAuthStore(store);
    clearSelectedAccountCookie(req, res);
    return sendJson(res, 409, {
      message:
        'Dit leerlingaccount is al aan een ander Google-account gekoppeld. Vraag je docent om hulp.',
    });
  }

  if (identityLinkedElsewhere(store, pending, studentId)) {
    saveAuthStore(store);
    clearSelectedAccountCookie(req, res);
    return sendJson(res, 409, {
      message:
        'Dit Google-account is al aan een ander Boekenbaai-account gekoppeld. Vraag je docent om hulp.',
    });
  }

  const current = findLatestRequest(store, pending, studentId);
  if (current?.status === 'pending' || current?.status === 'approved') {
    saveAuthStore(store);
    clearSelectedAccountCookie(req, res);
    return sendJson(res, 200, {
      automatic: true,
      status: current.status,
      studentId,
      requestId: current.id,
      message:
        current.status === 'approved'
          ? 'Je koppelverzoek is goedgekeurd.'
          : 'Je koppelverzoek wacht op goedkeuring van je docent.',
    });
  }

  const nowIso = new Date().toISOString();
  for (const entry of store.linkRequests) {
    if (
      entry?.status === 'pending' &&
      (String(entry?.sub || '') === String(pending.sub || '') ||
        core.normalizeEmail(entry?.email) === core.normalizeEmail(pending.email))
    ) {
      entry.status = 'superseded';
      entry.updatedAt = nowIso;
    }
  }

  const request = {
    id: crypto.randomUUID(),
    studentId,
    email: pending.email,
    sub: pending.sub,
    googleName: pending.name || '',
    status: 'pending',
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  store.linkRequests.push(request);
  saveAuthStore(store);
  clearSelectedAccountCookie(req, res);
  return sendJson(res, 202, {
    automatic: true,
    status: 'pending',
    studentId,
    requestId: request.id,
    message: 'Koppelverzoek verstuurd naar je docent.',
  });
}

function freshSelectedPendingStatus(req, res) {
  const selection = selectedAccountState(req);
  if (!selection || selection.type !== 'student') return false;
  const store = loadAuthStore();
  const pending = pendingIdentityForRequest(req, store);
  if (!pending || pending.studentId) return false;
  sendJson(res, 200, {
    email: pending.email,
    googleName: pending.name || '',
    requestStatus: 'not-requested',
    studentId: null,
    canComplete: false,
    automaticSelection: true,
  });
  return true;
}

function rejectBoundManualLinkRequest(req, res) {
  const store = loadAuthStore();
  const pending = pendingIdentityForRequest(req, store);
  if (!pending) return false;
  const selection = selectedAccountState(req);
  const hasSecureStudentSelection = selection?.type === 'student' && selection.accountId;
  if (!pending.studentId && !hasSecureStudentSelection) return false;
  sendJson(res, 409, {
    message:
      'Deze Google-login hoort al bij de leerlingnaam die je eerder koos. Log opnieuw in om een andere naam te kiezen.',
  });
  return true;
}

function installSelectedAccountCookie(req, res, requestUrl) {
  if (req.method !== 'GET' || requestUrl.pathname !== '/api/auth/google/start' || !AUTH_SECRET) {
    return;
  }
  const type = requestUrl.searchParams.get('type') === 'staff' ? 'staff' : 'student';
  const accountId = String(requestUrl.searchParams.get('accountId') || '').trim();
  if (!accountId) return;
  const signed = core.createSignedState({ type, accountId, iat: Date.now() }, AUTH_SECRET);
  appendSetCookie(
    res,
    cookieForRequest(req, SELECTED_ACCOUNT_COOKIE, signed, {
      httpOnly: true,
      maxAge: Math.floor(SELECTION_MAX_AGE_MS / 1000),
    })
  );
}

function setCookieArray(res, values) {
  if (values.length) res.setHeader('Set-Cookie', values);
  else res.removeHeader('Set-Cookie');
}

function removeCookiesFromResponse(res, names) {
  const current = res.getHeader('Set-Cookie');
  const values = current ? (Array.isArray(current) ? current : [current]) : [];
  const blocked = new Set(names.map((name) => String(name).toLowerCase()));
  const kept = values.filter((entry) => {
    const name = String(entry || '').split('=', 1)[0].trim().toLowerCase();
    return !blocked.has(name);
  });
  setCookieArray(res, kept);
}

function sessionTokenFromResponse(res) {
  const current = res.getHeader('Set-Cookie');
  const values = current ? (Array.isArray(current) ? current : [current]) : [];
  for (const entry of values) {
    const text = String(entry || '');
    if (!text.toLowerCase().startsWith(`${SESSION_COOKIE.toLowerCase()}=`)) continue;
    const raw = text.slice(text.indexOf('=') + 1).split(';', 1)[0];
    try {
      return decodeURIComponent(raw);
    } catch (error) {
      return raw;
    }
  }
  return '';
}

function mismatchRedirect(selection) {
  const page = selection?.type === 'staff' ? '/staff.html' : '/index.html';
  return `${page}?googleAuth=account-mismatch`;
}

function revokeMismatchedSession(req, res, selection) {
  const location = String(res.getHeader('Location') || '');
  if (!selection || !location.includes('googleAuth=success')) return false;

  const token = sessionTokenFromResponse(res);
  if (!token) return false;

  let store = loadAuthStore();
  const session = core.resolveSession(store, token);
  const expectedType = selection.type === 'staff' ? 'staff' : 'student';
  if (session && session.userId === selection.accountId && session.type === expectedType) {
    return false;
  }

  store = core.removeSession(store, token);
  saveAuthStore(store);
  removeCookiesFromResponse(res, [SESSION_COOKIE, SESSION_HINT_COOKIE]);
  clearCookie(req, res, SESSION_COOKIE, true);
  clearCookie(req, res, SESSION_HINT_COOKIE, false);
  res.setHeader('Location', mismatchRedirect(selection));
  return true;
}

function guardCallbackResponse(req, res, requestUrl) {
  if (requestUrl.pathname !== '/api/auth/google/callback') return;
  const selection = selectedAccountState(req);
  const originalEnd = res.end.bind(res);
  let ending = false;

  res.end = function guardedEnd(...args) {
    if (ending) return originalEnd(...args);
    ending = true;
    try {
      revokeMismatchedSession(req, res, selection);
    } catch (error) {
      console.error('[Student Google handoff] Sessiecontrole mislukt:', error?.message || error);
      removeCookiesFromResponse(res, [SESSION_COOKIE, SESSION_HINT_COOKIE]);
      clearCookie(req, res, SESSION_COOKIE, true);
      clearCookie(req, res, SESSION_HINT_COOKIE, false);
      if (selection) res.setHeader('Location', mismatchRedirect(selection));
    }

    const location = String(res.getHeader('Location') || '');
    if (!location.includes('googleAuth=link-required')) {
      clearSelectedAccountCookie(req, res);
    }
    return originalEnd(...args);
  };
}

function wrapRequestListener(listener) {
  return function studentGoogleHandoffListener(req, res) {
    let requestUrl;
    try {
      requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch (error) {
      return listener(req, res);
    }

    try {
      if (
        req.method === 'POST' &&
        requestUrl.pathname === '/api/auth/google/auto-link-request'
      ) {
        return createAutomaticLinkRequest(req, res);
      }
      if (
        req.method === 'GET' &&
        requestUrl.pathname === '/api/auth/google/pending' &&
        freshSelectedPendingStatus(req, res)
      ) {
        return undefined;
      }
      if (
        req.method === 'POST' &&
        requestUrl.pathname === '/api/auth/google/link-request' &&
        rejectBoundManualLinkRequest(req, res)
      ) {
        return undefined;
      }

      installSelectedAccountCookie(req, res, requestUrl);
      guardCallbackResponse(req, res, requestUrl);
      return listener(req, res);
    } catch (error) {
      console.error('[Student Google handoff] Interne fout:', error?.message || error);
      if (!res.headersSent && !res.writableEnded) {
        return sendJson(res, 500, { message: 'De Google-koppeling kon niet worden voorbereid.' });
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
    SELECTED_ACCOUNT_COOKIE,
    selectedAccountState,
    pendingIdentityForRequest,
    findLatestRequest,
    verifiedLinkConflicts,
    identityLinkedElsewhere,
    sessionTokenFromResponse,
  },
};
