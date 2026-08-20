'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');
const {
  THIRTY_DAYS_MS,
  PENDING_IDENTITY_MAX_AGE_MS,
  normalizeEmail,
  normalizeDomain,
  isAllowedSchoolEmail,
  createSignedState,
  verifySignedState,
  emptyAuthStore,
  normalizeStore,
  pruneStore,
  findLinkByAccount,
  findLinkByIdentity,
  upsertLink,
  upsertSession,
  resolveSession,
  removeSession,
  canStaffManageStudent,
  getStudentClassIds,
} = require('./google-auth-core');

const NativeMap = global.Map;
const capturedMaps = [];
class CapturingMap extends NativeMap {
  constructor(...args) {
    super(...args);
    capturedMaps.push(this);
  }
}
global.Map = CapturingMap;

const originalCreateServer = http.createServer.bind(http);
const DEFAULT_DATA_PATH = path.join(__dirname, 'data', 'db.json');
const DATA_PATH = process.env.BOEKENBAAI_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_DATA_PATH)
  : DEFAULT_DATA_PATH;
const AUTH_DATA_PATH = process.env.BOEKENBAAI_AUTH_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_AUTH_DATA_PATH)
  : `${DATA_PATH}.auth.json`;

const GOOGLE_CLIENT_ID =
  process.env.BOEKENBAAI_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET =
  process.env.BOEKENBAAI_GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_DOMAIN = normalizeDomain(
  process.env.BOEKENBAAI_GOOGLE_DOMAIN || 'koraaledu.nl'
);
const AUTH_SECRET =
  process.env.BOEKENBAAI_AUTH_SECRET || GOOGLE_CLIENT_SECRET || '';
const CONFIGURED_PUBLIC_URL = String(process.env.BOEKENBAAI_PUBLIC_URL || '').replace(/\/$/, '');
const CONFIGURED_REDIRECT_URI = String(
  process.env.BOEKENBAAI_GOOGLE_REDIRECT_URI || ''
).trim();

const SESSION_COOKIE = 'boekenbaai_session';
const SESSION_HINT_COOKIE = 'boekenbaai_auth_hint';
const OAUTH_NONCE_COOKIE = 'boekenbaai_oauth_nonce';
const PENDING_COOKIE = 'boekenbaai_google_pending';
const SESSION_SENTINEL = 'cookie';

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function readMainDb() {
  const db = readJsonFile(DATA_PATH, {});
  if (!Array.isArray(db.users)) db.users = [];
  if (!Array.isArray(db.students)) db.students = [];
  if (!Array.isArray(db.classes)) db.classes = [];
  return db;
}

function loadAuthStore() {
  return pruneStore(normalizeStore(readJsonFile(AUTH_DATA_PATH, emptyAuthStore())));
}

function saveAuthStore(store) {
  const normalized = pruneStore(normalizeStore(store));
  ensureParentDirectory(AUTH_DATA_PATH);
  const tmp = `${AUTH_DATA_PATH}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2));
  fs.renameSync(tmp, AUTH_DATA_PATH);
  return normalized;
}

function parseCookies(req) {
  const result = {};
  const raw = String(req.headers.cookie || '');
  for (const part of raw.split(';')) {
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

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || '/'}`);
  if (options.maxAge !== undefined && options.maxAge !== null) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  return parts.join('; ');
}

function appendSetCookie(res, cookie) {
  const current = res.getHeader('Set-Cookie');
  if (!current) {
    res.setHeader('Set-Cookie', [cookie]);
    return;
  }
  const values = Array.isArray(current) ? current : [current];
  res.setHeader('Set-Cookie', [...values, cookie]);
}

function setSessionCookies(req, res, token, remember) {
  const secure = isHttpsRequest(req);
  const maxAge = remember ? Math.floor(THIRTY_DAYS_MS / 1000) : undefined;
  appendSetCookie(
    res,
    serializeCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure,
      sameSite: 'Lax',
      maxAge,
    })
  );
  appendSetCookie(
    res,
    serializeCookie(SESSION_HINT_COOKIE, '1', {
      httpOnly: false,
      secure,
      sameSite: 'Lax',
      maxAge,
    })
  );
}

function clearAuthCookies(req, res) {
  const secure = isHttpsRequest(req);
  for (const [name, httpOnly] of [
    [SESSION_COOKIE, true],
    [SESSION_HINT_COOKIE, false],
    [OAUTH_NONCE_COOKIE, true],
    [PENDING_COOKIE, true],
  ]) {
    appendSetCookie(
      res,
      serializeCookie(name, '', {
        httpOnly,
        secure,
        sameSite: 'Lax',
        maxAge: 0,
      })
    );
  }
}

function clearPendingCookie(req, res) {
  appendSetCookie(
    res,
    serializeCookie(PENDING_COOKIE, '', {
      httpOnly: true,
      secure: isHttpsRequest(req),
      sameSite: 'Lax',
      maxAge: 0,
    })
  );
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
      if (body.length > 256 * 1024) {
        reject(new Error('Payload te groot'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Kon JSON niet lezen'));
      }
    });
    req.on('error', reject);
  });
}

function getForwardedHost(req) {
  return String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim();
}

function getBaseUrl(req) {
  if (CONFIGURED_PUBLIC_URL) return CONFIGURED_PUBLIC_URL;
  const host = getForwardedHost(req);
  const protocol = isHttpsRequest(req) ? 'https' : 'http';
  return `${protocol}://${host}`;
}

function getRedirectUri(req) {
  return CONFIGURED_REDIRECT_URI || `${getBaseUrl(req)}/api/auth/google/callback`;
}

function getBearerToken(req) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function findAccount(db, type, id) {
  if (type === 'student') {
    const student = db.students.find((entry) => entry?.id === id);
    return student ? { ...student, role: 'student' } : null;
  }
  const user = db.users.find(
    (entry) => entry?.id === id && ['teacher', 'admin'].includes(entry?.role)
  );
  return user || null;
}

function getSessionContextByToken(token, sessionsMap) {
  if (!token || token === SESSION_SENTINEL) return null;
  let session = sessionsMap?.get(token) || null;
  if (!session) {
    const store = loadAuthStore();
    const persistent = resolveSession(store, token);
    if (persistent) {
      session = {
        userId: persistent.userId,
        type: persistent.type,
        createdAt: persistent.createdAt,
      };
      sessionsMap?.set(token, session);
    }
  }
  if (!session) return null;
  const db = readMainDb();
  const account = findAccount(db, session.type === 'student' ? 'student' : 'staff', session.userId);
  if (!account) return null;
  return { token, session, user: account, db };
}

function getAuthContext(req, sessionsMap) {
  const bearer = getBearerToken(req);
  const cookies = parseCookies(req);
  if (bearer && bearer !== SESSION_SENTINEL) {
    const byBearer = getSessionContextByToken(bearer, sessionsMap);
    if (byBearer) return byBearer;
  }
  const cookieToken = cookies[SESSION_COOKIE] || '';
  if (cookieToken) {
    const byCookie = getSessionContextByToken(cookieToken, sessionsMap);
    if (byCookie) return byCookie;
  }
  return null;
}

function hydrateDelegatedRequest(req, sessionsMap) {
  const context = getAuthContext(req, sessionsMap);
  if (!context) return null;
  const bearer = getBearerToken(req);
  if (!bearer || bearer === SESSION_SENTINEL || bearer !== context.token) {
    req.headers.authorization = `Bearer ${context.token}`;
  }
  return context;
}

function createLoginSession(req, res, sessionsMap, userId, type, remember) {
  const token = crypto.randomBytes(32).toString('base64url');
  const createdAt = Date.now();
  sessionsMap?.set(token, { userId, type, createdAt });
  const { store } = upsertSession(loadAuthStore(), token, {
    userId,
    type,
    remember,
    now: createdAt,
  });
  saveAuthStore(store);
  setSessionCookies(req, res, token, remember);
  return token;
}

function removeLoginSession(req, res, sessionsMap) {
  const bearer = getBearerToken(req);
  const cookies = parseCookies(req);
  const candidates = new Set(
    [bearer !== SESSION_SENTINEL ? bearer : '', cookies[SESSION_COOKIE] || ''].filter(Boolean)
  );
  let store = loadAuthStore();
  for (const token of candidates) {
    sessionsMap?.delete(token);
    store = removeSession(store, token);
  }
  saveAuthStore(store);
  clearAuthCookies(req, res);
}

function isGoogleConfigured() {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && AUTH_SECRET && GOOGLE_DOMAIN);
}

function makeOauthErrorRedirect(type, code) {
  const page = type === 'staff' ? '/staff.html' : '/index.html';
  return `${page}?googleAuth=${encodeURIComponent(code || 'error')}`;
}

async function exchangeGoogleCode(code, redirectUri) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!response.ok) {
    throw new Error(`Google token exchange mislukt (${response.status})`);
  }
  const payload = await response.json();
  if (!payload?.id_token) throw new Error('Google leverde geen ID-token terug');
  return payload.id_token;
}

async function verifyGoogleIdToken(idToken) {
  const url = new URL('https://oauth2.googleapis.com/tokeninfo');
  url.searchParams.set('id_token', idToken);
  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Google ID-token kon niet worden gecontroleerd');
  const claims = await response.json();
  const issuer = String(claims.iss || '');
  const audience = String(claims.aud || '');
  const email = normalizeEmail(claims.email);
  const hostedDomain = normalizeDomain(claims.hd);
  const emailVerified = String(claims.email_verified).toLowerCase() === 'true';
  const expiresAt = Number(claims.exp) * 1000;
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(issuer)) {
    throw new Error('Onverwachte Google issuer');
  }
  if (audience !== GOOGLE_CLIENT_ID) throw new Error('Google audience klopt niet');
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new Error('Google ID-token is verlopen');
  }
  if (!emailVerified) throw new Error('Google e-mailadres is niet geverifieerd');
  if (hostedDomain !== GOOGLE_DOMAIN || !isAllowedSchoolEmail(email, GOOGLE_DOMAIN)) {
    const error = new Error(`Gebruik een @${GOOGLE_DOMAIN} account`);
    error.code = 'WRONG_DOMAIN';
    throw error;
  }
  if (!claims.sub) throw new Error('Google account-id ontbreekt');
  return {
    sub: String(claims.sub),
    email,
    name: String(claims.name || claims.email || '').trim(),
    givenName: String(claims.given_name || '').trim(),
  };
}

function resolveLinkedAccount(db, store, accountType, identity) {
  const link = findLinkByIdentity(store, accountType, identity);
  if (!link) return { account: null, store };
  const account = findAccount(db, accountType, link.accountId);
  if (!account) return { account: null, store };
  let nextStore = store;
  if (link.sub !== identity.sub || normalizeEmail(link.email) !== identity.email) {
    const result = upsertLink(nextStore, {
      accountType,
      accountId: account.id,
      email: identity.email,
      sub: identity.sub,
      linkedBy: link.linkedBy || 'google-login',
    });
    nextStore = result.store;
  }
  return { account, store: nextStore };
}

function createPendingIdentity(req, res, identity) {
  const token = crypto.randomBytes(28).toString('base64url');
  const now = Date.now();
  const store = loadAuthStore();
  store.pendingIdentities = store.pendingIdentities.filter(
    (entry) => entry?.sub !== identity.sub && entry?.email !== identity.email
  );
  store.pendingIdentities.push({
    tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    sub: identity.sub,
    email: identity.email,
    name: identity.name,
    givenName: identity.givenName,
    createdAt: now,
    expiresAt: now + PENDING_IDENTITY_MAX_AGE_MS,
  });
  saveAuthStore(store);
  appendSetCookie(
    res,
    serializeCookie(PENDING_COOKIE, token, {
      httpOnly: true,
      secure: isHttpsRequest(req),
      sameSite: 'Lax',
      maxAge: Math.floor(PENDING_IDENTITY_MAX_AGE_MS / 1000),
    })
  );
}

function getPendingIdentity(req, store = loadAuthStore()) {
  const token = parseCookies(req)[PENDING_COOKIE] || '';
  if (!token) return null;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return store.pendingIdentities.find(
    (entry) => entry?.tokenHash === hash && Number(entry?.expiresAt) > Date.now()
  ) || null;
}

function removePendingIdentity(store, pending) {
  if (!pending) return store;
  store.pendingIdentities = store.pendingIdentities.filter(
    (entry) => entry?.tokenHash !== pending.tokenHash
  );
  return store;
}

function getClassNamesForStudent(db, studentId) {
  const classIds = new Set(getStudentClassIds(db, studentId));
  return (db.classes || [])
    .filter((klass) => classIds.has(klass.id))
    .map((klass) => klass.name)
    .filter(Boolean);
}

function getStudentSearchDisplayName(student) {
  const first = String(student?.firstName || student?.name || '').trim().split(/\s+/)[0] || '';
  const rawLast = String(student?.lastName || '').trim();
  const fallbackParts = String(student?.name || '').trim().split(/\s+/).filter(Boolean);
  const last = rawLast || (fallbackParts.length > 1 ? fallbackParts[fallbackParts.length - 1] : '');
  return last ? `${first} ${last.charAt(0).toUpperCase()}.` : first;
}

function accessibleStudents(db, user) {
  return (db.students || []).filter((student) => canStaffManageStudent(db, user, student.id));
}

function pendingRequestsForStaff(db, store, user) {
  return (store.linkRequests || []).filter(
    (request) =>
      request?.status === 'pending' &&
      request?.studentId &&
      canStaffManageStudent(db, user, request.studentId)
  );
}

function sanitizeLinkRequest(db, request) {
  const student = db.students.find((entry) => entry?.id === request.studentId);
  return {
    id: request.id,
    studentId: request.studentId,
    studentName: student?.name || 'Onbekende leerling',
    classNames: getClassNamesForStudent(db, request.studentId),
    email: request.email,
    googleName: request.googleName || '',
    createdAt: request.createdAt,
  };
}

async function handleCustomApi(req, res, requestUrl, sessionsMap) {
  const pathname = requestUrl.pathname;

  if (req.method === 'GET' && pathname === '/api/auth/google/config') {
    return sendJson(res, 200, {
      enabled: isGoogleConfigured(),
      domain: GOOGLE_DOMAIN,
      rememberDays: 30,
    });
  }

  if (req.method === 'GET' && pathname === '/api/auth/google/start') {
    const type = requestUrl.searchParams.get('type') === 'staff' ? 'staff' : 'student';
    const remember = type === 'staff' && requestUrl.searchParams.get('remember') === '1';
    if (!isGoogleConfigured()) {
      return redirect(res, makeOauthErrorRedirect(type, 'not-configured'));
    }
    const nonce = crypto.randomBytes(20).toString('base64url');
    const state = createSignedState(
      { type, remember, nonce, iat: Date.now() },
      AUTH_SECRET
    );
    appendSetCookie(
      res,
      serializeCookie(OAUTH_NONCE_COOKIE, nonce, {
        httpOnly: true,
        secure: isHttpsRequest(req),
        sameSite: 'Lax',
        maxAge: 10 * 60,
      })
    );
    const authorize = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authorize.searchParams.set('client_id', GOOGLE_CLIENT_ID);
    authorize.searchParams.set('redirect_uri', getRedirectUri(req));
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('scope', 'openid email profile');
    authorize.searchParams.set('state', state);
    authorize.searchParams.set('hd', GOOGLE_DOMAIN);
    authorize.searchParams.set('prompt', 'select_account');
    return redirect(res, authorize.toString());
  }

  if (req.method === 'GET' && pathname === '/api/auth/google/callback') {
    const state = verifySignedState(requestUrl.searchParams.get('state'), AUTH_SECRET);
    const type = state?.type === 'staff' ? 'staff' : 'student';
    const nonceCookie = parseCookies(req)[OAUTH_NONCE_COOKIE] || '';
    if (!state || !state.nonce || state.nonce !== nonceCookie) {
      return redirect(res, makeOauthErrorRedirect(type, 'state-error'));
    }
    appendSetCookie(
      res,
      serializeCookie(OAUTH_NONCE_COOKIE, '', {
        httpOnly: true,
        secure: isHttpsRequest(req),
        sameSite: 'Lax',
        maxAge: 0,
      })
    );
    const code = requestUrl.searchParams.get('code') || '';
    if (!code) return redirect(res, makeOauthErrorRedirect(type, 'oauth-error'));
    try {
      const idToken = await exchangeGoogleCode(code, getRedirectUri(req));
      const identity = await verifyGoogleIdToken(idToken);
      const db = readMainDb();
      let store = loadAuthStore();
      const resolved = resolveLinkedAccount(db, store, type, identity);
      store = resolved.store;
      if (resolved.account) {
        saveAuthStore(store);
        createLoginSession(req, res, sessionsMap, resolved.account.id, type, Boolean(state.remember));
        clearPendingCookie(req, res);
        return redirect(
          res,
          type === 'staff' ? '/staff.html?googleAuth=success' : '/index.html?googleAuth=success'
        );
      }
      if (type === 'staff') {
        return redirect(res, makeOauthErrorRedirect('staff', 'staff-unlinked'));
      }
      createPendingIdentity(req, res, identity);
      return redirect(res, '/index.html?googleAuth=link-required');
    } catch (error) {
      console.warn('[Google Auth] Callback mislukt:', error?.message || error);
      const codeName = error?.code === 'WRONG_DOMAIN' ? 'wrong-domain' : 'oauth-error';
      return redirect(res, makeOauthErrorRedirect(type, codeName));
    }
  }

  if (req.method === 'POST' && pathname === '/api/auth/session/persist') {
    const context = getAuthContext(req, sessionsMap);
    if (!context || !['teacher', 'admin'].includes(context.user.role)) {
      return sendJson(res, 401, { message: 'Niet ingelogd als medewerker' });
    }
    const { store } = upsertSession(loadAuthStore(), context.token, {
      userId: context.session.userId,
      type: 'staff',
      remember: true,
    });
    saveAuthStore(store);
    setSessionCookies(req, res, context.token, true);
    return sendJson(res, 200, { remembered: true, days: 30 });
  }

  if (req.method === 'GET' && pathname === '/api/auth/session/status') {
    const context = getAuthContext(req, sessionsMap);
    return sendJson(res, 200, {
      authenticated: Boolean(context),
      role: context?.user?.role || null,
    });
  }

  if (req.method === 'GET' && pathname === '/api/auth/google/pending') {
    const store = loadAuthStore();
    const pending = getPendingIdentity(req, store);
    if (!pending) return sendJson(res, 404, { message: 'Geen openstaande Google-koppeling' });
    const request = (store.linkRequests || []).find(
      (entry) => entry?.sub === pending.sub && entry?.email === pending.email
    );
    let approved = false;
    let studentId = request?.studentId || null;
    if (studentId) {
      const link = findLinkByAccount(store, 'student', studentId);
      approved = Boolean(
        link &&
        normalizeEmail(link.email) === pending.email &&
        (!link.sub || link.sub === pending.sub)
      );
    }
    return sendJson(res, 200, {
      email: pending.email,
      googleName: pending.name || '',
      requestStatus: approved ? 'approved' : request?.status || 'not-requested',
      studentId,
      canComplete: approved,
    });
  }

  if (req.method === 'GET' && pathname === '/api/auth/google/student-options') {
    const pending = getPendingIdentity(req);
    if (!pending) return sendJson(res, 401, { message: 'Google-koppeling is verlopen' });
    const query = String(requestUrl.searchParams.get('q') || '').trim().toLowerCase();
    if (query.length < 2) return sendJson(res, 200, { matches: [] });
    const db = readMainDb();
    const matches = db.students
      .filter((student) => String(student?.name || '').toLowerCase().includes(query))
      .slice(0, 10)
      .map((student) => ({
        id: student.id,
        displayName: getStudentSearchDisplayName(student),
        classNames: getClassNamesForStudent(db, student.id),
      }));
    return sendJson(res, 200, { matches });
  }

  if (req.method === 'POST' && pathname === '/api/auth/google/link-request') {
    let store = loadAuthStore();
    const pending = getPendingIdentity(req, store);
    if (!pending) return sendJson(res, 401, { message: 'Google-koppeling is verlopen' });
    const body = await parseBody(req);
    const studentId = String(body.studentId || '').trim();
    const db = readMainDb();
    const student = db.students.find((entry) => entry?.id === studentId);
    if (!student) return sendJson(res, 404, { message: 'Leerlingaccount niet gevonden' });

    const existing = findLinkByAccount(store, 'student', studentId);
    if (existing && normalizeEmail(existing.email) === pending.email) {
      try {
        const linked = upsertLink(store, {
          accountType: 'student',
          accountId: studentId,
          email: pending.email,
          sub: pending.sub,
          linkedBy: 'prelinked-email',
        });
        store = removePendingIdentity(linked.store, pending);
        saveAuthStore(store);
        createLoginSession(req, res, sessionsMap, studentId, 'student', false);
        clearPendingCookie(req, res);
        return sendJson(res, 200, { approved: true, loggedIn: true });
      } catch (error) {
        return sendJson(res, 409, { message: error.message });
      }
    }

    store.linkRequests = (store.linkRequests || []).filter(
      (entry) => !(entry?.status === 'pending' && (entry?.sub === pending.sub || entry?.email === pending.email))
    );
    const nowIso = new Date().toISOString();
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
    return sendJson(res, 202, {
      approved: false,
      requestId: request.id,
      message: 'Koppelverzoek verstuurd naar je docent.',
    });
  }

  if (req.method === 'POST' && pathname === '/api/auth/google/pending/complete') {
    let store = loadAuthStore();
    const pending = getPendingIdentity(req, store);
    if (!pending) return sendJson(res, 401, { message: 'Google-koppeling is verlopen' });
    const request = (store.linkRequests || []).find(
      (entry) => entry?.studentId && entry?.sub === pending.sub && entry?.email === pending.email
    );
    if (!request) return sendJson(res, 409, { message: 'Nog geen koppelverzoek gevonden' });
    const link = findLinkByAccount(store, 'student', request.studentId);
    if (
      !link ||
      normalizeEmail(link.email) !== pending.email ||
      (link.sub && link.sub !== pending.sub)
    ) {
      return sendJson(res, 409, { message: 'De koppeling is nog niet goedgekeurd' });
    }
    try {
      const linked = upsertLink(store, {
        accountType: 'student',
        accountId: request.studentId,
        email: pending.email,
        sub: pending.sub,
        linkedBy: request.approvedBy || 'teacher-approval',
      });
      store = removePendingIdentity(linked.store, pending);
      saveAuthStore(store);
      createLoginSession(req, res, sessionsMap, request.studentId, 'student', false);
      clearPendingCookie(req, res);
      return sendJson(res, 200, { loggedIn: true });
    } catch (error) {
      return sendJson(res, 409, { message: error.message });
    }
  }

  if (req.method === 'GET' && pathname === '/api/auth/google/manage') {
    const context = getAuthContext(req, sessionsMap);
    if (!context || !['teacher', 'admin'].includes(context.user.role)) {
      return sendJson(res, 401, { message: 'Niet ingelogd als medewerker' });
    }
    const db = context.db;
    const store = loadAuthStore();
    const students = accessibleStudents(db, context.user).map((student) => {
      const link = findLinkByAccount(store, 'student', student.id);
      return {
        id: student.id,
        name: student.name || '',
        classNames: getClassNamesForStudent(db, student.id),
        googleEmail: link?.email || '',
        googleVerified: Boolean(link?.sub),
      };
    });
    const requests = pendingRequestsForStaff(db, store, context.user).map((request) =>
      sanitizeLinkRequest(db, request)
    );
    const staff = context.user.role === 'admin'
      ? (db.users || [])
        .filter((entry) => ['teacher', 'admin'].includes(entry?.role))
        .map((entry) => {
          const link = findLinkByAccount(store, 'staff', entry.id);
          return {
            id: entry.id,
            name: entry.name || entry.username || '',
            role: entry.role,
            googleEmail: link?.email || '',
            googleVerified: Boolean(link?.sub),
          };
        })
      : [];
    return sendJson(res, 200, {
      role: context.user.role,
      domain: GOOGLE_DOMAIN,
      students,
      staff,
      requests,
    });
  }

  if (req.method === 'POST' && pathname === '/api/auth/google/student-email') {
    const context = getAuthContext(req, sessionsMap);
    if (!context || !['teacher', 'admin'].includes(context.user.role)) {
      return sendJson(res, 401, { message: 'Niet ingelogd als medewerker' });
    }
    const body = await parseBody(req);
    const studentId = String(body.studentId || '').trim();
    const email = normalizeEmail(body.email);
    if (!canStaffManageStudent(context.db, context.user, studentId)) {
      return sendJson(res, 403, { message: 'Je mag alleen leerlingen uit jouw eigen klassen koppelen' });
    }
    if (!isAllowedSchoolEmail(email, GOOGLE_DOMAIN)) {
      return sendJson(res, 400, { message: `Gebruik een @${GOOGLE_DOMAIN} e-mailadres` });
    }
    if (!context.db.students.some((entry) => entry?.id === studentId)) {
      return sendJson(res, 404, { message: 'Leerling niet gevonden' });
    }
    try {
      const currentStore = loadAuthStore();
      const current = findLinkByAccount(currentStore, 'student', studentId);
      const linked = upsertLink(currentStore, {
        accountType: 'student',
        accountId: studentId,
        email,
        sub: current && normalizeEmail(current.email) === email ? current.sub : '',
        linkedBy: context.user.id,
      });
      saveAuthStore(linked.store);
      return sendJson(res, 200, {
        studentId,
        googleEmail: linked.link.email,
        googleVerified: Boolean(linked.link.sub),
      });
    } catch (error) {
      return sendJson(res, 409, { message: error.message });
    }
  }

  if (req.method === 'POST' && pathname === '/api/auth/google/staff-email') {
    const context = getAuthContext(req, sessionsMap);
    if (!context || context.user.role !== 'admin') {
      return sendJson(res, 403, { message: 'Alleen beheerders kunnen medewerkeraccounts koppelen' });
    }
    const body = await parseBody(req);
    const staffId = String(body.staffId || '').trim();
    const email = normalizeEmail(body.email);
    if (!isAllowedSchoolEmail(email, GOOGLE_DOMAIN)) {
      return sendJson(res, 400, { message: `Gebruik een @${GOOGLE_DOMAIN} e-mailadres` });
    }
    if (!context.db.users.some((entry) => entry?.id === staffId && ['teacher', 'admin'].includes(entry?.role))) {
      return sendJson(res, 404, { message: 'Medewerker niet gevonden' });
    }
    try {
      const currentStore = loadAuthStore();
      const current = findLinkByAccount(currentStore, 'staff', staffId);
      const linked = upsertLink(currentStore, {
        accountType: 'staff',
        accountId: staffId,
        email,
        sub: current && normalizeEmail(current.email) === email ? current.sub : '',
        linkedBy: context.user.id,
      });
      saveAuthStore(linked.store);
      return sendJson(res, 200, {
        staffId,
        googleEmail: linked.link.email,
        googleVerified: Boolean(linked.link.sub),
      });
    } catch (error) {
      return sendJson(res, 409, { message: error.message });
    }
  }

  const requestActionMatch = pathname.match(
    /^\/api\/auth\/google\/link-requests\/([\w-]+)\/(approve|deny)$/
  );
  if (req.method === 'POST' && requestActionMatch) {
    const context = getAuthContext(req, sessionsMap);
    if (!context || !['teacher', 'admin'].includes(context.user.role)) {
      return sendJson(res, 401, { message: 'Niet ingelogd als medewerker' });
    }
    let store = loadAuthStore();
    const request = store.linkRequests.find((entry) => entry?.id === requestActionMatch[1]);
    if (!request || request.status !== 'pending') {
      return sendJson(res, 404, { message: 'Openstaand koppelverzoek niet gevonden' });
    }
    if (!canStaffManageStudent(context.db, context.user, request.studentId)) {
      return sendJson(res, 403, { message: 'Dit verzoek hoort niet bij een leerling uit jouw klas' });
    }
    const action = requestActionMatch[2];
    const nowIso = new Date().toISOString();
    if (action === 'deny') {
      request.status = 'denied';
      request.updatedAt = nowIso;
      request.reviewedBy = context.user.id;
      saveAuthStore(store);
      return sendJson(res, 200, { status: 'denied' });
    }
    try {
      const linked = upsertLink(store, {
        accountType: 'student',
        accountId: request.studentId,
        email: request.email,
        sub: request.sub,
        linkedBy: context.user.id,
      });
      store = linked.store;
      const updatedRequest = store.linkRequests.find((entry) => entry?.id === request.id);
      updatedRequest.status = 'approved';
      updatedRequest.updatedAt = nowIso;
      updatedRequest.approvedBy = context.user.id;
      saveAuthStore(store);
      return sendJson(res, 200, { status: 'approved' });
    } catch (error) {
      return sendJson(res, 409, { message: error.message });
    }
  }

  return false;
}

function injectGoogleAssets(req, res, listener) {
  const originalWriteHead = res.writeHead.bind(res);
  const originalEnd = res.end.bind(res);
  let contentType = '';

  res.writeHead = function patchedWriteHead(statusCode, statusMessageOrHeaders, maybeHeaders) {
    const headers =
      typeof statusMessageOrHeaders === 'object' && statusMessageOrHeaders !== null
        ? statusMessageOrHeaders
        : maybeHeaders;
    if (headers && typeof headers === 'object') {
      const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-type');
      if (entry) contentType = String(entry[1] || '');
    }
    if (!contentType) contentType = String(res.getHeader('Content-Type') || '');
    return originalWriteHead(statusCode, statusMessageOrHeaders, maybeHeaders);
  };

  res.end = function patchedEnd(chunk, encoding, callback) {
    const detectedType = contentType || String(res.getHeader('Content-Type') || '');
    if (detectedType.includes('text/html') && chunk != null) {
      let html = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      if (!html.includes('/google-auth.css')) {
        html = html.replace(/<\/head>/i, '    <link rel="stylesheet" href="/google-auth.css" />\n  </head>');
      }
      if (!html.includes('/google-auth.js')) {
        html = html.replace(/<\/body>/i, '    <script src="/google-auth.js"></script>\n  </body>');
      }
      return originalEnd(html, encoding, callback);
    }
    return originalEnd(chunk, encoding, callback);
  };

  return listener(req, res);
}

function wrapRequestListener(listener, sessionsMap) {
  return async function googleAuthRequestListener(req, res) {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (
        requestUrl.pathname.startsWith('/api/auth/google/') ||
        requestUrl.pathname.startsWith('/api/auth/session/')
      ) {
        const handled = await handleCustomApi(req, res, requestUrl, sessionsMap);
        if (handled !== false || res.writableEnded) return;
      }

      if (req.method === 'POST' && requestUrl.pathname === '/api/logout') {
        removeLoginSession(req, res, sessionsMap);
        return sendJson(res, 200, { message: 'Afgemeld' });
      }

      hydrateDelegatedRequest(req, sessionsMap);
      if (!requestUrl.pathname.startsWith('/api/')) {
        return injectGoogleAssets(req, res, listener);
      }
      return listener(req, res);
    } catch (error) {
      console.error('[Google Auth] Interne fout:', error);
      if (!res.headersSent && !res.writableEnded) {
        return sendJson(res, 500, { message: 'Google-inlog kon niet worden verwerkt' });
      }
      if (!res.writableEnded) res.end();
    }
  };
}

http.createServer = function patchedCreateServer(...args) {
  const listenerIndex = typeof args[0] === 'function' ? 0 : 1;
  const listener = args[listenerIndex];
  if (typeof listener !== 'function') {
    global.Map = NativeMap;
    return originalCreateServer(...args);
  }

  // server.js maakt eerst EXACT_THEME_MAP en daarna de sessie-Map aan.
  // Door de tweede Map te bewaren kunnen Google- en persistente sessies de
  // bestaande autorisatielaag gebruiken zonder server.js te wijzigen.
  const sessionsMap = capturedMaps[1] || null;
  global.Map = NativeMap;
  const wrapped = wrapRequestListener(listener, sessionsMap);
  if (listenerIndex === 0) return originalCreateServer(wrapped);
  return originalCreateServer(args[0], wrapped);
};

module.exports = {
  __test: {
    DATA_PATH,
    AUTH_DATA_PATH,
    getBaseUrl,
    getRedirectUri,
    isGoogleConfigured,
  },
};
