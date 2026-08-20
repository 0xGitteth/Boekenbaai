'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');
const { AsyncLocalStorage } = require('async_hooks');
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
const SELECTION_MAX_AGE_MS = 15 * 60 * 1000;

const requestContext = new AsyncLocalStorage();
const originalCreateServer = http.createServer.bind(http);
const originalCreateSignedState = core.createSignedState.bind(core);
const originalFindLinkByIdentity = core.findLinkByIdentity.bind(core);

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
  if (!Array.isArray(db.users)) db.users = [];
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
  const cookies = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const rawValue = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(rawValue);
    } catch (error) {
      cookies[key] = rawValue;
    }
  }
  return cookies;
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

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/'];
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  parts.push('SameSite=Lax');
  return parts.join('; ');
}

function appendSetCookie(res, cookie) {
  const current = res.getHeader('Set-Cookie');
  const values = current ? (Array.isArray(current) ? current : [current]) : [];
  res.setHeader('Set-Cookie', [...values, cookie]);
}

function clearSelectedAccountCookie(req, res) {
  appendSetCookie(res, serializeCookie(SELECTED_ACCOUNT_COOKIE, '', {
    httpOnly: true,
    secure: useSecureCookies(req),
    maxAge: 0,
  }));
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
  return state;
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
    (link.sub !== pending.sub || core.normalizeEmail(link.email) !== core.normalizeEmail(pending.email))
  );
}

function identityLinkedElsewhere(store, pending, studentId) {
  const email = core.normalizeEmail(pending?.email);
  const sub = String(pending?.sub || '').trim();
  return store.links.find((entry) => {
    if (!entry) return false;
    if (typeof core.isLocalOnlyStaffAccount === 'function' &&
        core.isLocalOnlyStaffAccount(entry.accountType, entry.accountId)) {
      return false;
    }
    if (entry.accountType === 'student' && entry.accountId === studentId) return false;
    const sameSub = Boolean(sub && String(entry.sub || '').trim() === sub);
    const sameEmail = Boolean(email && core.normalizeEmail(entry.email) === email);
    return sameSub || sameEmail;
  }) || null;
}

function findLatestRequest(store, pending, studentId) {
  return store.linkRequests
    .filter(
      (entry) =>
        entry?.studentId === studentId &&
        entry?.sub === pending.sub &&
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
  const studentId = String(selection.accountId || '').trim();
  const student = db.students.find((entry) => entry?.id === studentId);
  if (!student) {
    clearSelectedAccountCookie(req, res);
    return sendJson(res, 404, { message: 'Het gekozen leerlingaccount bestaat niet meer.' });
  }

  let store = loadAuthStore();
  const pending = pendingIdentityForRequest(req, store);
  if (!pending) {
    return sendJson(res, 401, { message: 'Google-koppeling is verlopen. Log opnieuw in.' });
  }

  // Vanaf hier is deze pending Google-identiteit aan de eerder gekozen leerling gebonden.
  // De oude handmatige zoekroute mag dit account daarna niet meer wisselen.
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

  const otherLink = identityLinkedElsewhere(store, pending, studentId);
  if (otherLink) {
    saveAuthStore(store);
    clearSelectedAccountCookie(req, res);
    return sendJson(res, 409, {
      message:
        'Dit Google-account is al aan een ander Boekenbaai-account gekoppeld. Vraag je docent om hulp.',
    });
  }

  const current = findLatestRequest(store, pending, studentId);
  if (current?.status === 'pending') {
    saveAuthStore(store);
    clearSelectedAccountCookie(req, res);
    return sendJson(res, 200, {
      automatic: true,
      status: 'pending',
      studentId,
      requestId: current.id,
      message: 'Je koppelverzoek wacht op goedkeuring van je docent.',
    });
  }
  if (current?.status === 'approved') {
    saveAuthStore(store);
    clearSelectedAccountCookie(req, res);
    return sendJson(res, 200, {
      automatic: true,
      status: 'approved',
      studentId,
      requestId: current.id,
      message: 'Je koppelverzoek is goedgekeurd.',
    });
  }
  if (current?.status === 'denied') {
    saveAuthStore(store);
    clearSelectedAccountCookie(req, res);
    return sendJson(res, 200, {
      automatic: true,
      status: 'denied',
      studentId,
      requestId: current.id,
      message: 'Je docent heeft het koppelverzoek afgewezen.',
    });
  }

  const nowIso = new Date().toISOString();
  for (const entry of store.linkRequests) {
    if (
      entry?.status === 'pending' &&
      (entry?.sub === pending.sub || core.normalizeEmail(entry?.email) === core.normalizeEmail(pending.email))
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

function rejectBoundManualLinkRequest(req, res) {
  const store = loadAuthStore();
  const pending = pendingIdentityForRequest(req, store);
  if (!pending) return false;
  const selection = selectedAccountState(req);
  const hasSecureStudentSelection = selection?.type === 'student' && selection?.accountId;
  if (!pending.studentId && !hasSecureStudentSelection) return false;
  sendJson(res, 409, {
    message:
      'Deze Google-login hoort al bij de leerlingnaam die je eerder koos. Log opnieuw in om een andere naam te kiezen.',
  });
  return true;
}

function buildContext(req) {
  let requestUrl = null;
  try {
    requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch (error) {
    return { requestUrl: null, pathname: '', oauthType: '', oauthAccountId: '', accountMismatch: false };
  }

  const context = {
    requestUrl,
    pathname: requestUrl.pathname,
    oauthType: '',
    oauthAccountId: '',
    accountMismatch: false,
  };

  if (requestUrl.pathname === '/api/auth/google/callback' && AUTH_SECRET) {
    const state = core.verifySignedState(requestUrl.searchParams.get('state'), AUTH_SECRET);
    if (state?.accountId && ['student', 'staff'].includes(state?.type)) {
      context.oauthType = state.type;
      context.oauthAccountId = String(state.accountId).trim();
    }
  }
  return context;
}

function installSelectedAccountCookie(req, res, context) {
  if (
    context.pathname !== '/api/auth/google/start' ||
    req.method !== 'GET' ||
    !AUTH_SECRET
  ) {
    return;
  }
  const type = context.requestUrl.searchParams.get('type') === 'staff' ? 'staff' : 'student';
  const accountId = String(context.requestUrl.searchParams.get('accountId') || '').trim();
  if (!accountId) return;
  const signed = originalCreateSignedState(
    { type, accountId, iat: Date.now() },
    AUTH_SECRET
  );
  appendSetCookie(res, serializeCookie(SELECTED_ACCOUNT_COOKIE, signed, {
    httpOnly: true,
    secure: useSecureCookies(req),
    maxAge: Math.floor(SELECTION_MAX_AGE_MS / 1000),
  }));
}

function wrapCallbackResponse(req, res, context) {
  if (context.pathname !== '/api/auth/google/callback') return;

  const originalSetHeader = res.setHeader.bind(res);
  res.setHeader = function patchedSetHeader(name, value) {
    if (String(name).toLowerCase() === 'location' && context.accountMismatch) {
      const page = context.oauthType === 'staff' ? '/staff.html' : '/index.html';
      return originalSetHeader(name, `${page}?googleAuth=account-mismatch`);
    }
    return originalSetHeader(name, value);
  };

  const originalEnd = res.end.bind(res);
  res.end = function patchedEnd(...args) {
    const location = String(res.getHeader('Location') || '');
    if (!location.includes('googleAuth=link-required')) {
      clearSelectedAccountCookie(req, res);
    }
    return originalEnd(...args);
  };
}

core.createSignedState = function createSignedStateWithSelectedAccount(payload, secret) {
  const context = requestContext.getStore();
  if (context?.pathname === '/api/auth/google/start' && payload && typeof payload === 'object') {
    const accountId = String(context.requestUrl?.searchParams.get('accountId') || '').trim();
    if (accountId) {
      return originalCreateSignedState({ ...payload, accountId }, secret);
    }
  }
  return originalCreateSignedState(payload, secret);
};

core.findLinkByIdentity = function findLinkByIdentityForSelectedAccount(store, accountType, identity) {
  const link = originalFindLinkByIdentity(store, accountType, identity);
  const context = requestContext.getStore();
  const expectedType = context?.oauthType === 'staff' ? 'staff' : 'student';
  if (
    link &&
    context?.oauthAccountId &&
    accountType === expectedType &&
    link.accountId !== context.oauthAccountId
  ) {
    context.accountMismatch = true;
    const error = new Error('Het gekozen Boekenbaai-account hoort bij een ander Google-account.');
    error.code = 'ACCOUNT_MISMATCH';
    throw error;
  }
  return link;
};

function wrapRequestListener(listener) {
  return function studentGoogleHandoffListener(req, res) {
    const context = buildContext(req);
    return requestContext.run(context, () => {
      try {
        if (
          req.method === 'POST' &&
          context.pathname === '/api/auth/google/auto-link-request'
        ) {
          return createAutomaticLinkRequest(req, res);
        }
        if (
          req.method === 'POST' &&
          context.pathname === '/api/auth/google/link-request' &&
          rejectBoundManualLinkRequest(req, res)
        ) {
          return undefined;
        }
        installSelectedAccountCookie(req, res, context);
        wrapCallbackResponse(req, res, context);
        return listener(req, res);
      } catch (error) {
        console.error('[Student Google handoff] Interne fout:', error?.message || error);
        if (!res.headersSent && !res.writableEnded) {
          return sendJson(res, 500, { message: 'De Google-koppeling kon niet worden voorbereid.' });
        }
        if (!res.writableEnded) res.end();
        return undefined;
      }
    });
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
  },
};
