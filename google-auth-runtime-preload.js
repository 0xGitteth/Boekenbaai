'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');
const core = require('./google-auth-core');
const { verifyGoogleIdToken } = require('./google-id-token');
const { installSessionBridge } = require('./google-session-bridge');

const sessionsMap = new Map();
const sessionBridge = installSessionBridge({ sessions: sessionsMap });
const originalCreateServer = http.createServer.bind(http);

const DEFAULT_DATA_PATH = path.join(__dirname, 'data', 'db.json');
const DATA_PATH = process.env.BOEKENBAAI_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_DATA_PATH)
  : DEFAULT_DATA_PATH;
const AUTH_DATA_PATH = process.env.BOEKENBAAI_AUTH_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_AUTH_DATA_PATH)
  : `${DATA_PATH}.auth.json`;

const GOOGLE_CLIENT_ID = process.env.BOEKENBAAI_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.BOEKENBAAI_GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_DOMAIN = core.normalizeDomain(process.env.BOEKENBAAI_GOOGLE_DOMAIN || 'koraaledu.nl');
const AUTH_SECRET = process.env.BOEKENBAAI_AUTH_SECRET || GOOGLE_CLIENT_SECRET || '';
const CONFIGURED_PUBLIC_URL = String(process.env.BOEKENBAAI_PUBLIC_URL || '').replace(/\/$/, '');
const CONFIGURED_REDIRECT_URI = String(process.env.BOEKENBAAI_GOOGLE_REDIRECT_URI || '').trim();

const SESSION_COOKIE = 'boekenbaai_session';
const SESSION_HINT_COOKIE = 'boekenbaai_auth_hint';
const OAUTH_NONCE_COOKIE = 'boekenbaai_oauth_nonce';
const PENDING_COOKIE = 'boekenbaai_google_pending';
const SESSION_SENTINEL = 'cookie';

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

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
  if (!Array.isArray(db.users)) db.users = [];
  if (!Array.isArray(db.students)) db.students = [];
  if (!Array.isArray(db.classes)) db.classes = [];
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
  ensureParentDirectory(AUTH_DATA_PATH);
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

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path || '/'}`];
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
  const values = current ? (Array.isArray(current) ? current : [current]) : [];
  res.setHeader('Set-Cookie', [...values, cookie]);
}

function setSessionCookies(req, res, token, remember) {
  const secure = useSecureCookies(req);
  const maxAge = remember ? Math.floor(core.THIRTY_DAYS_MS / 1000) : undefined;
  appendSetCookie(res, serializeCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    maxAge,
  }));
  appendSetCookie(res, serializeCookie(SESSION_HINT_COOKIE, '1', {
    httpOnly: false,
    secure,
    sameSite: 'Lax',
    maxAge,
  }));
}

function clearCookie(req, res, name, httpOnly = true) {
  appendSetCookie(res, serializeCookie(name, '', {
    httpOnly,
    secure: useSecureCookies(req),
    sameSite: 'Lax',
    maxAge: 0,
  }));
}

function clearAuthCookies(req, res) {
  clearCookie(req, res, SESSION_COOKIE, true);
  clearCookie(req, res, SESSION_HINT_COOKIE, false);
  clearCookie(req, res, OAUTH_NONCE_COOKIE, true);
  clearCookie(req, res, PENDING_COOKIE, true);
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
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      body += chunk.toString();
      if (body.length > 256 * 1024) {
        settled = true;
        reject(new Error('Payload te groot'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Kon JSON niet lezen'));
      }
    });
    req.on('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

function getBaseUrl(req) {
  if (CONFIGURED_PUBLIC_URL) return CONFIGURED_PUBLIC_URL;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim();
  return `${isHttpsRequest(req) ? 'https' : 'http'}://${host}`;
}

function getRedirectUri(req) {
  return CONFIGURED_REDIRECT_URI || `${getBaseUrl(req)}/api/auth/google/callback`;
}

function getBearerToken(req) {
  const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function findAccount(db, type, id) {
  if (type === 'student') {
    const student = db.students.find((entry) => entry?.id === id);
    return student ? { ...student, role: 'student' } : null;
  }
  return db.users.find(
    (entry) => entry?.id === id && ['teacher', 'admin'].includes(entry?.role)
  ) || null;
}

function getSessionContextByToken(token) {
  if (!token || token === SESSION_SENTINEL) return null;
  let session = sessionsMap.get(token) || null;
  if (!session) {
    const persistent = core.resolveSession(loadAuthStore(), token);
    if (persistent) {
      session = {
        userId: persistent.userId,
        type: persistent.type,
        createdAt: persistent.createdAt,
      };
      sessionsMap.set(token, session);
    }
  }
  if (!session) return null;
  const db = readMainDb();
  const user = findAccount(db, session.type === 'student' ? 'student' : 'staff', session.userId);
  return user ? { token, session, user, db } : null;
}

function getAuthContext(req) {
  const bearer = getBearerToken(req);
  if (bearer && bearer !== SESSION_SENTINEL) {
    const context = getSessionContextByToken(bearer);
    if (context) return context;
  }
  const cookieToken = parseCookies(req)[SESSION_COOKIE] || '';
  return cookieToken ? getSessionContextByToken(cookieToken) : null;
}

function hydrateDelegatedRequest(req) {
  const context = getAuthContext(req);
  if (!context) return null;
  const bearer = getBearerToken(req);
  if (!bearer || bearer === SESSION_SENTINEL || bearer !== context.token) {
    req.headers.authorization = `Bearer ${context.token}`;
  }
  return context;
}

function createLoginSession(req, res, userId, type, remember) {
  const token = crypto.randomBytes(32).toString('base64url');
  const createdAt = Date.now();
  sessionsMap.set(token, { userId, type, createdAt });
  const result = core.upsertSession(loadAuthStore(), token, {
    userId,
    type,
    remember,
    now: createdAt,
  });
  saveAuthStore(result.store);
  setSessionCookies(req, res, token, remember);
  return token;
}

function removeLoginSession(req, res) {
  const bearer = getBearerToken(req);
  const cookieToken = parseCookies(req)[SESSION_COOKIE] || '';
  const candidates = new Set(
    [bearer !== SESSION_SENTINEL ? bearer : '', cookieToken].filter(Boolean)
  );
  let store = loadAuthStore();
  for (const token of candidates) {
    sessionsMap.delete(token);
    store = core.removeSession(store, token);
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

function normalizeName(value) {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('nl-NL')
    : '';
}

function getAccountCandidates(db, type, enteredName, accountId = '') {
  if (accountId) {
    const account = findAccount(db, type === 'staff' ? 'staff' : 'student', accountId);
    return account ? [account] : [];
  }
  const wanted = normalizeName(enteredName);
  if (!wanted) return [];
  if (type === 'staff') {
    return db.users.filter(
      (entry) =>
        ['teacher', 'admin'].includes(entry?.role) &&
        (normalizeName(entry?.name) === wanted || normalizeName(entry?.username) === wanted)
    );
  }
  return db.students.filter(
    (entry) => normalizeName(entry?.name) === wanted || normalizeName(entry?.username) === wanted
  );
}

function findLoginHint(type, enteredName, accountId = '') {
  const db = readMainDb();
  const candidates = getAccountCandidates(db, type, enteredName, accountId);
  if (candidates.length !== 1 || !candidates[0]?.id) return '';
  const accountType = type === 'staff' ? 'staff' : 'student';
  const link = core.findLinkByAccount(loadAuthStore(), accountType, candidates[0].id);
  const email = core.normalizeEmail(link?.email);
  return core.isAllowedSchoolEmail(email, GOOGLE_DOMAIN) ? email : '';
}

async function exchangeGoogleCode(code, redirectUri) {
  if (typeof globalThis.__BOEKENBAAI_EXCHANGE_GOOGLE_CODE === 'function') {
    return globalThis.__BOEKENBAAI_EXCHANGE_GOOGLE_CODE(code, redirectUri);
  }
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
    signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(7000) : undefined,
  });
  if (!response.ok) throw new Error(`Google token exchange mislukt (${response.status})`);
  const payload = await response.json();
  if (!payload?.id_token) throw new Error('Google leverde geen ID-token terug');
  return payload.id_token;
}

async function verifyGoogleIdentity(idToken, expectedNonce) {
  if (typeof globalThis.__BOEKENBAAI_VERIFY_GOOGLE_ID_TOKEN === 'function') {
    return globalThis.__BOEKENBAAI_VERIFY_GOOGLE_ID_TOKEN(idToken, {
      clientId: GOOGLE_CLIENT_ID,
      domain: GOOGLE_DOMAIN,
      expectedNonce,
    });
  }
  return verifyGoogleIdToken(idToken, {
    clientId: GOOGLE_CLIENT_ID,
    domain: GOOGLE_DOMAIN,
    expectedNonce,
  });
}

function resolveLinkedAccount(db, store, accountType, identity) {
  const link = core.findLinkByIdentity(store, accountType, identity);
  if (!link) return { account: null, store };
  const account = findAccount(db, accountType, link.accountId);
  if (!account) return { account: null, store };
  if (link.sub === identity.sub && core.normalizeEmail(link.email) === identity.email) {
    return { account, store };
  }
  const updated = core.upsertLink(store, {
    accountType,
    accountId: account.id,
    email: identity.email,
    sub: identity.sub,
    linkedBy: link.linkedBy || 'google-login',
  });
  return { account, store: updated.store };
}

function createPendingIdentity(req, res, identity) {
  const token = crypto.randomBytes(28).toString('base64url');
  const now = Date.now();
  const store = loadAuthStore();
  store.pendingIdentities = store.pendingIdentities.filter(
    (entry) => entry?.sub !== identity.sub && core.normalizeEmail(entry?.email) !== identity.email
  );
  store.pendingIdentities.push({
    tokenHash: core.tokenHash(token),
    sub: identity.sub,
    email: identity.email,
    name: identity.name,
    givenName: identity.givenName,
    createdAt: now,
    expiresAt: now + core.PENDING_IDENTITY_MAX_AGE_MS,
  });
  saveAuthStore(store);
  appendSetCookie(res, serializeCookie(PENDING_COOKIE, token, {
    httpOnly: true,
    secure: useSecureCookies(req),
    sameSite: 'Lax',
    maxAge: Math.floor(core.PENDING_IDENTITY_MAX_AGE_MS / 1000),
  }));
}

function getPendingIdentity(req, store = loadAuthStore()) {
  const token = parseCookies(req)[PENDING_COOKIE] || '';
  if (!token) return null;
  const hash = core.tokenHash(token);
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
  const classIds = new Set(core.getStudentClassIds(db, studentId));
  return db.classes
    .filter((klass) => classIds.has(klass.id))
    .map((klass) => klass.name)
    .filter(Boolean);
}

function getStudentSearchDisplayName(student) {
  const first = String(student?.firstName || student?.name || '').trim().split(/\s+/)[0] || '';
  const fallback = String(student?.name || '').trim().split(/\s+/).filter(Boolean);
  const last = String(student?.lastName || '').trim() || (fallback.length > 1 ? fallback[fallback.length - 1] : '');
  return last ? `${first} ${last.charAt(0).toUpperCase()}.` : first;
}

function accessibleStudents(db, user) {
  return db.students.filter((student) => core.canStaffManageStudent(db, user, student.id));
}

function pendingRequestsForStaff(db, store, user) {
  return store.linkRequests.filter(
    (request) =>
      request?.status === 'pending' &&
      request?.studentId &&
      core.canStaffManageStudent(db, user, request.studentId)
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

function findLatestIdentityRequest(store, pending) {
  return store.linkRequests
    .filter(
      (entry) => entry?.sub === pending.sub && core.normalizeEmail(entry?.email) === pending.email
    )
    .sort((left, right) => {
      const leftTime = Date.parse(left?.createdAt || '') || 0;
      const rightTime = Date.parse(right?.createdAt || '') || 0;
      return rightTime - leftTime;
    })[0] || null;
}

function verifiedLinkConflicts(link, email, sub) {
  return Boolean(
    link?.sub &&
    (link.sub !== sub || core.normalizeEmail(link.email) !== core.normalizeEmail(email))
  );
}

function handleGoogleStart(req, res, requestUrl) {
  const type = requestUrl.searchParams.get('type') === 'staff' ? 'staff' : 'student';
  const remember = type === 'staff' && requestUrl.searchParams.get('remember') === '1';
  if (!isGoogleConfigured()) {
    return redirect(res, makeOauthErrorRedirect(type, 'not-configured'));
  }

  const nonce = crypto.randomBytes(20).toString('base64url');
  const state = core.createSignedState({ type, remember, nonce, iat: Date.now() }, AUTH_SECRET);
  appendSetCookie(res, serializeCookie(OAUTH_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: useSecureCookies(req),
    sameSite: 'Lax',
    maxAge: 10 * 60,
  }));

  const authorize = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorize.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  authorize.searchParams.set('redirect_uri', getRedirectUri(req));
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('scope', 'openid email profile');
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('nonce', nonce);
  authorize.searchParams.set('hd', GOOGLE_DOMAIN);
  const loginHint = findLoginHint(
    type,
    requestUrl.searchParams.get('name') || '',
    requestUrl.searchParams.get('accountId') || ''
  );
  if (loginHint) authorize.searchParams.set('login_hint', loginHint);
  else authorize.searchParams.set('prompt', 'select_account');
  return redirect(res, authorize.toString());
}

async function handleGoogleCallback(req, res, requestUrl) {
  const state = core.verifySignedState(requestUrl.searchParams.get('state'), AUTH_SECRET);
  const type = state?.type === 'staff' ? 'staff' : 'student';
  const nonceCookie = parseCookies(req)[OAUTH_NONCE_COOKIE] || '';
  if (!state || !state.nonce || state.nonce !== nonceCookie) {
    return redirect(res, makeOauthErrorRedirect(type, 'state-error'));
  }
  clearCookie(req, res, OAUTH_NONCE_COOKIE, true);

  if (requestUrl.searchParams.get('error')) {
    return redirect(res, makeOauthErrorRedirect(type, 'oauth-error'));
  }
  const code = requestUrl.searchParams.get('code') || '';
  if (!code) return redirect(res, makeOauthErrorRedirect(type, 'oauth-error'));

  try {
    const idToken = await exchangeGoogleCode(code, getRedirectUri(req));
    const identity = await verifyGoogleIdentity(idToken, state.nonce);
    const db = readMainDb();
    let store = loadAuthStore();
    const resolved = resolveLinkedAccount(db, store, type, identity);
    store = resolved.store;

    if (resolved.account) {
      saveAuthStore(store);
      createLoginSession(req, res, resolved.account.id, type, Boolean(state.remember));
      clearCookie(req, res, PENDING_COOKIE, true);
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

async function handleCustomApi(req, res, requestUrl) {
  const pathname = requestUrl.pathname;

  if (req.method === 'GET' && pathname === '/api/auth/google/config') {
    return sendJson(res, 200, {
      enabled: isGoogleConfigured(),
      domain: GOOGLE_DOMAIN,
      rememberDays: 30,
    });
  }

  if (req.method === 'GET' && pathname === '/api/auth/google/start') {
    return handleGoogleStart(req, res, requestUrl);
  }

  if (req.method === 'GET' && pathname === '/api/auth/google/callback') {
    return handleGoogleCallback(req, res, requestUrl);
  }

  if (req.method === 'POST' && pathname === '/api/auth/session/persist') {
    const context = getAuthContext(req);
    if (!context || !['teacher', 'admin'].includes(context.user.role)) {
      return sendJson(res, 401, { message: 'Niet ingelogd als medewerker' });
    }
    const result = core.upsertSession(loadAuthStore(), context.token, {
      userId: context.session.userId,
      type: 'staff',
      remember: true,
    });
    saveAuthStore(result.store);
    setSessionCookies(req, res, context.token, true);
    return sendJson(res, 200, { remembered: true, days: 30 });
  }

  if (req.method === 'GET' && pathname === '/api/auth/session/status') {
    const context = getAuthContext(req);
    return sendJson(res, 200, {
      authenticated: Boolean(context),
      role: context?.user?.role || null,
    });
  }

  if (req.method === 'GET' && pathname === '/api/auth/google/pending') {
    const store = loadAuthStore();
    const pending = getPendingIdentity(req, store);
    if (!pending) {
      return sendJson(res, 404, { message: 'Geen openstaande Google-koppeling' });
    }
    const request = findLatestIdentityRequest(store, pending);
    const link = request?.studentId
      ? core.findLinkByAccount(store, 'student', request.studentId)
      : null;
    const approved = Boolean(
      request?.status === 'approved' &&
      link &&
      core.normalizeEmail(link.email) === pending.email &&
      link.sub === pending.sub
    );
    return sendJson(res, 200, {
      email: pending.email,
      googleName: pending.name || '',
      requestStatus: approved ? 'approved' : request?.status || 'not-requested',
      studentId: request?.studentId || null,
      canComplete: approved,
    });
  }

  if (req.method === 'GET' && pathname === '/api/auth/google/student-options') {
    const pending = getPendingIdentity(req);
    if (!pending) {
      return sendJson(res, 401, { message: 'Google-koppeling is verlopen' });
    }
    const query = String(requestUrl.searchParams.get('q') || '').trim().toLocaleLowerCase('nl-NL');
    if (query.length < 2) return sendJson(res, 200, { matches: [] });
    const db = readMainDb();
    const matches = db.students
      .filter((student) => normalizeName(student?.name).includes(query))
      .slice(0, 10)
      .map((student) => ({
        id: student.id,
        displayName: getStudentSearchDisplayName(student),
        classNames: getClassNamesForStudent(db, student.id),
      }));
    return sendJson(res, 200, { matches });
  }

  if (req.method === 'POST' && pathname === '/api/auth/google/link-request') {
    const body = await parseBody(req);
    const studentId = String(body.studentId || '').trim();
    const db = readMainDb();
    if (!db.students.some((entry) => entry?.id === studentId)) {
      return sendJson(res, 404, { message: 'Leerlingaccount niet gevonden' });
    }

    let store = loadAuthStore();
    const pending = getPendingIdentity(req, store);
    if (!pending) {
      return sendJson(res, 401, { message: 'Google-koppeling is verlopen' });
    }
    const existing = core.findLinkByAccount(store, 'student', studentId);
    if (verifiedLinkConflicts(existing, pending.email, pending.sub)) {
      return sendJson(res, 409, {
        message: 'Dit leerlingaccount is al aan een ander geverifieerd Google-account gekoppeld.',
      });
    }

    if (existing && !existing.sub && core.normalizeEmail(existing.email) === pending.email) {
      const linked = core.upsertLink(store, {
        accountType: 'student',
        accountId: studentId,
        email: pending.email,
        sub: pending.sub,
        linkedBy: 'prelinked-email',
      });
      store = removePendingIdentity(linked.store, pending);
      saveAuthStore(store);
      createLoginSession(req, res, studentId, 'student', false);
      clearCookie(req, res, PENDING_COOKIE, true);
      return sendJson(res, 200, { approved: true, loggedIn: true });
    }

    const nowIso = new Date().toISOString();
    for (const entry of store.linkRequests) {
      if (
        entry?.status === 'pending' &&
        (entry?.sub === pending.sub || core.normalizeEmail(entry?.email) === pending.email)
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
    return sendJson(res, 202, {
      approved: false,
      requestId: request.id,
      message: 'Koppelverzoek verstuurd naar je docent.',
    });
  }

  if (req.method === 'POST' && pathname === '/api/auth/google/pending/complete') {
    let store = loadAuthStore();
    const pending = getPendingIdentity(req, store);
    if (!pending) {
      return sendJson(res, 401, { message: 'Google-koppeling is verlopen' });
    }
    const request = findLatestIdentityRequest(store, pending);
    if (!request || request.status !== 'approved') {
      return sendJson(res, 409, { message: 'De koppeling is nog niet goedgekeurd' });
    }
    const link = core.findLinkByAccount(store, 'student', request.studentId);
    if (!link || core.normalizeEmail(link.email) !== pending.email || link.sub !== pending.sub) {
      return sendJson(res, 409, {
        message: 'De goedgekeurde koppeling komt niet overeen met dit Google-account',
      });
    }
    store = removePendingIdentity(store, pending);
    saveAuthStore(store);
    createLoginSession(req, res, request.studentId, 'student', false);
    clearCookie(req, res, PENDING_COOKIE, true);
    return sendJson(res, 200, { loggedIn: true });
  }

  if (req.method === 'GET' && pathname === '/api/auth/google/manage') {
    const context = getAuthContext(req);
    if (!context || !['teacher', 'admin'].includes(context.user.role)) {
      return sendJson(res, 401, { message: 'Niet ingelogd als medewerker' });
    }
    const store = loadAuthStore();
    const students = accessibleStudents(context.db, context.user).map((student) => {
      const link = core.findLinkByAccount(store, 'student', student.id);
      return {
        id: student.id,
        name: student.name || '',
        classNames: getClassNamesForStudent(context.db, student.id),
        googleEmail: link?.email || '',
        googleVerified: Boolean(link?.sub),
      };
    });
    const requests = pendingRequestsForStaff(context.db, store, context.user).map(
      (request) => sanitizeLinkRequest(context.db, request)
    );
    const staff = context.user.role === 'admin'
      ? context.db.users
        .filter((entry) => ['teacher', 'admin'].includes(entry?.role))
        .map((entry) => {
          const link = core.findLinkByAccount(store, 'staff', entry.id);
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
    const body = await parseBody(req);
    const context = getAuthContext(req);
    if (!context || !['teacher', 'admin'].includes(context.user.role)) {
      return sendJson(res, 401, { message: 'Niet ingelogd als medewerker' });
    }
    const studentId = String(body.studentId || '').trim();
    const email = core.normalizeEmail(body.email);
    if (!core.canStaffManageStudent(context.db, context.user, studentId)) {
      return sendJson(res, 403, {
        message: 'Je mag alleen leerlingen uit jouw eigen klassen koppelen',
      });
    }
    if (!core.isAllowedSchoolEmail(email, GOOGLE_DOMAIN)) {
      return sendJson(res, 400, { message: `Gebruik een @${GOOGLE_DOMAIN} e-mailadres` });
    }
    if (!context.db.students.some((entry) => entry?.id === studentId)) {
      return sendJson(res, 404, { message: 'Leerling niet gevonden' });
    }
    try {
      const store = loadAuthStore();
      const current = core.findLinkByAccount(store, 'student', studentId);
      const linked = core.upsertLink(store, {
        accountType: 'student',
        accountId: studentId,
        email,
        sub: current && core.normalizeEmail(current.email) === email ? current.sub : '',
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
    const body = await parseBody(req);
    const context = getAuthContext(req);
    if (!context || context.user.role !== 'admin') {
      return sendJson(res, 403, { message: 'Alleen beheerders kunnen medewerkeraccounts koppelen' });
    }
    const staffId = String(body.staffId || '').trim();
    const email = core.normalizeEmail(body.email);
    if (!core.isAllowedSchoolEmail(email, GOOGLE_DOMAIN)) {
      return sendJson(res, 400, { message: `Gebruik een @${GOOGLE_DOMAIN} e-mailadres` });
    }
    if (!context.db.users.some(
      (entry) => entry?.id === staffId && ['teacher', 'admin'].includes(entry?.role)
    )) {
      return sendJson(res, 404, { message: 'Medewerker niet gevonden' });
    }
    try {
      const store = loadAuthStore();
      const current = core.findLinkByAccount(store, 'staff', staffId);
      const linked = core.upsertLink(store, {
        accountType: 'staff',
        accountId: staffId,
        email,
        sub: current && core.normalizeEmail(current.email) === email ? current.sub : '',
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

  const actionMatch = pathname.match(
    /^\/api\/auth\/google\/link-requests\/([\w-]+)\/(approve|deny)$/
  );
  if (req.method === 'POST' && actionMatch) {
    const context = getAuthContext(req);
    if (!context || !['teacher', 'admin'].includes(context.user.role)) {
      return sendJson(res, 401, { message: 'Niet ingelogd als medewerker' });
    }
    let store = loadAuthStore();
    const request = store.linkRequests.find((entry) => entry?.id === actionMatch[1]);
    if (!request || request.status !== 'pending') {
      return sendJson(res, 404, { message: 'Openstaand koppelverzoek niet gevonden' });
    }
    if (!core.canStaffManageStudent(context.db, context.user, request.studentId)) {
      return sendJson(res, 403, {
        message: 'Dit verzoek hoort niet bij een leerling uit jouw klas',
      });
    }

    const nowIso = new Date().toISOString();
    if (actionMatch[2] === 'deny') {
      request.status = 'denied';
      request.updatedAt = nowIso;
      request.reviewedBy = context.user.id;
      saveAuthStore(store);
      return sendJson(res, 200, { status: 'denied' });
    }

    const existing = core.findLinkByAccount(store, 'student', request.studentId);
    if (verifiedLinkConflicts(existing, request.email, request.sub)) {
      return sendJson(res, 409, {
        message: 'Dit leerlingaccount is al aan een ander geverifieerd Google-account gekoppeld.',
      });
    }
    try {
      const linked = core.upsertLink(store, {
        accountType: 'student',
        accountId: request.studentId,
        email: request.email,
        sub: request.sub,
        linkedBy: context.user.id,
      });
      store = linked.store;
      const updated = store.linkRequests.find((entry) => entry?.id === request.id);
      updated.status = 'approved';
      updated.updatedAt = nowIso;
      updated.approvedBy = context.user.id;
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
    const entry = headers && typeof headers === 'object'
      ? Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-type')
      : null;
    if (entry) contentType = String(entry[1] || '');
    if (!contentType) contentType = String(res.getHeader('Content-Type') || '');
    return originalWriteHead(statusCode, statusMessageOrHeaders, maybeHeaders);
  };

  res.end = function patchedEnd(chunk, encoding, callback) {
    const detected = contentType || String(res.getHeader('Content-Type') || '');
    if (detected.includes('text/html') && chunk != null) {
      let html = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      if (!html.includes('/google-auth.css')) {
        html = html.replace(
          /<\/head>/i,
          '    <link rel="stylesheet" href="/google-auth.css" />\n  </head>'
        );
      }
      if (!html.includes('/google-auth.js')) {
        html = html.replace(
          /<\/body>/i,
          '    <script src="/google-auth.js"></script>\n  </body>'
        );
      }
      if (!html.includes('/google-login-hint.js')) {
        html = html.replace(
          /<\/body>/i,
          '    <script src="/google-login-hint.js"></script>\n  </body>'
        );
      }
      return originalEnd(html, encoding, callback);
    }
    return originalEnd(chunk, encoding, callback);
  };

  return listener(req, res);
}

function wrapRequestListener(listener) {
  return async function googleAuthRuntimeListener(req, res) {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (
        requestUrl.pathname.startsWith('/api/auth/google/') ||
        requestUrl.pathname.startsWith('/api/auth/session/')
      ) {
        const handled = await handleCustomApi(req, res, requestUrl);
        if (handled !== false || res.writableEnded) return;
      }

      if (req.method === 'POST' && requestUrl.pathname === '/api/logout') {
        removeLoginSession(req, res);
        return sendJson(res, 200, { message: 'Afgemeld' });
      }

      hydrateDelegatedRequest(req);
      if (!requestUrl.pathname.startsWith('/api/')) {
        return injectGoogleAssets(req, res, listener);
      }
      return listener(req, res);
    } catch (error) {
      console.error('[Google Auth] Interne fout:', error?.message || error);
      if (!res.headersSent && !res.writableEnded) {
        return sendJson(res, 500, { message: 'Google-inlog kon niet worden verwerkt' });
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
    sessionsMap,
    sessionBridge,
    findLoginHint,
    findLatestIdentityRequest,
    verifiedLinkConflicts,
    getRedirectUri,
    isGoogleConfigured,
  },
};
