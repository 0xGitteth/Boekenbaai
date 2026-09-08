'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');
const { AsyncLocalStorage } = require('async_hooks');
const XLSX = require('xlsx');
const core = require('./google-auth-core');
const { verifyGoogleIdToken } = require('./google-id-token');
const { accountCredentialFingerprint } = require('./google-auth-security-core');
const { runSchoolSync } = require('./school-sync-core');

const DEFAULT_DATA_PATH = path.join(__dirname, 'data', 'db.json');
const DATA_PATH = process.env.BOEKENBAAI_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_DATA_PATH)
  : DEFAULT_DATA_PATH;
const AUTH_DATA_PATH = process.env.BOEKENBAAI_AUTH_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_AUTH_DATA_PATH)
  : `${DATA_PATH}.auth.json`;
const AUTH_SECRET = process.env.BOEKENBAAI_AUTH_SECRET || process.env.BOEKENBAAI_GOOGLE_CLIENT_SECRET || '';
const GOOGLE_DOMAIN = core.normalizeDomain(process.env.BOEKENBAAI_GOOGLE_DOMAIN || 'koraaledu.nl');
const CONFIGURED_PUBLIC_URL = String(process.env.BOEKENBAAI_PUBLIC_URL || '').replace(/\/$/, '');
const STATIC_SOURCE_DIR = path.join(__dirname, 'public');
const SESSION_COOKIE = 'boekenbaai_session';
const SESSION_HINT_COOKIE = 'boekenbaai_auth_hint';
const PENDING_COOKIE = 'boekenbaai_google_pending';
const SELECTED_ACCOUNT_COOKIE = 'boekenbaai_google_selected_account';
const SELECTION_MAX_AGE_MS = 15 * 60 * 1000;
const PENDING_MAX_AGE_MS = core.PENDING_IDENTITY_MAX_AGE_MS || 30 * 60 * 1000;
const MAX_BODY_BYTES = 20 * 1024 * 1024;
const originalCreateServer = http.createServer.bind(http);
const requestContext = new AsyncLocalStorage();

function readJsonStrict(filePath, { missingValue, label }) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT' && missingValue !== undefined) return missingValue;
    if (error instanceof SyntaxError) {
      const wrapped = new Error(`${label || 'JSON-bestand'} is beschadigd.`);
      wrapped.code = 'CORRUPT_JSON';
      throw wrapped;
    }
    throw error;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

function readMainDb() {
  const db = readJsonStrict(DATA_PATH, { label: 'Boekenbaai database' });
  if (!db || typeof db !== 'object' || Array.isArray(db)) throw new Error('Boekenbaai database heeft een ongeldig formaat.');
  if (!Array.isArray(db.users)) db.users = [];
  if (!Array.isArray(db.students)) db.students = [];
  if (!Array.isArray(db.classes)) db.classes = [];
  if (!Array.isArray(db.books)) db.books = [];
  if (!Array.isArray(db.history)) db.history = [];
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
    try {
      result[key] = decodeURIComponent(raw);
    } catch (error) {
      result[key] = raw;
    }
  }
  return result;
}

function useSecureCookies(req) {
  if (CONFIGURED_PUBLIC_URL) {
    try {
      return new URL(CONFIGURED_PUBLIC_URL).protocol === 'https:';
    } catch (error) {
      // Val terug op de requestinformatie.
    }
  }
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return forwarded ? forwarded === 'https' : Boolean(req.socket?.encrypted);
}

function serializeCookie(name, value, { httpOnly = true, secure = false, maxAge } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
  if (maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function appendSetCookie(res, cookie) {
  const current = res.getHeader('Set-Cookie');
  const values = current ? (Array.isArray(current) ? current : [current]) : [];
  res.setHeader('Set-Cookie', [...values, cookie]);
}

function clearCookie(req, res, name, httpOnly = true) {
  appendSetCookie(res, serializeCookie(name, '', {
    httpOnly,
    secure: useSecureCookies(req),
    maxAge: 0,
  }));
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

function selectedAccountState(req) {
  const signed = parseCookies(req)[SELECTED_ACCOUNT_COOKIE] || '';
  if (!signed || !AUTH_SECRET) return null;
  const state = core.verifySignedState(signed, AUTH_SECRET, { maxAgeMs: SELECTION_MAX_AGE_MS });
  if (!state || !state.accountId || !['student', 'staff'].includes(state.type)) return null;
  return { type: state.type, accountId: String(state.accountId).trim() };
}

function pendingIdentity(req, store = loadAuthStore()) {
  const token = parseCookies(req)[PENDING_COOKIE] || '';
  if (!token) return null;
  const hash = core.tokenHash(token);
  return store.pendingIdentities.find(
    (entry) => entry?.tokenHash === hash && Number(entry?.expiresAt) > Date.now()
  ) || null;
}

function resolveAdmin(req) {
  const token = parseCookies(req)[SESSION_COOKIE] || '';
  if (!token) return null;
  const store = loadAuthStore();
  const session = core.resolveSession(store, token);
  if (!session || session.type !== 'staff') return null;
  const db = readMainDb();
  const user = db.users.find((entry) => entry?.id === session.userId && entry?.role === 'admin');
  return user ? { db, store, user, token } : null;
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('nl-NL')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function compareNames(left, right) {
  const a = normalizeName(left).split(' ').filter(Boolean);
  const b = normalizeName(right).split(' ').filter(Boolean);
  if (!a.length || !b.length) return 'unknown';
  if (a.join(' ') === b.join(' ')) return 'match';
  return a[0] === b[0] && a[a.length - 1] === b[b.length - 1] ? 'match' : 'warning';
}

function installVerifierCapture() {
  const key = '__BOEKENBAAI_VERIFY_GOOGLE_ID_TOKEN';
  let delegate = typeof globalThis[key] === 'function' ? globalThis[key] : verifyGoogleIdToken;
  const wrapper = async (...args) => {
    const identity = await delegate(...args);
    const context = requestContext.getStore();
    if (context) context.googleIdentity = identity;
    return identity;
  };
  try {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      enumerable: false,
      get() {
        return wrapper;
      },
      set(next) {
        delegate = typeof next === 'function' ? next : verifyGoogleIdToken;
      },
    });
  } catch (error) {
    globalThis[key] = wrapper;
  }
}

installVerifierCapture();

function createStaffPendingIdentity(req, res, requestUrl, identity) {
  const selection = selectedAccountState(req);
  if (!selection || selection.type !== 'staff' || !identity?.sub || !identity?.email) return false;
  const db = readMainDb();
  const teacher = db.users.find(
    (entry) => entry?.id === selection.accountId && entry?.role === 'teacher' && entry?.active !== false
  );
  if (!teacher) return false;
  if (!core.isAllowedSchoolEmail(identity.email, GOOGLE_DOMAIN)) return false;

  let store = loadAuthStore();
  const byIdentity = core.findLinkByIdentity(store, 'staff', identity);
  if (byIdentity && byIdentity.accountId !== teacher.id) {
    res.setHeader('Location', '/staff.html?googleAuth=account-mismatch');
    return true;
  }
  const current = core.findLinkByAccount(store, 'staff', teacher.id);
  if (current?.sub && (current.sub !== identity.sub || core.normalizeEmail(current.email) !== core.normalizeEmail(identity.email))) {
    res.setHeader('Location', '/staff.html?googleAuth=account-mismatch');
    return true;
  }

  const token = crypto.randomBytes(28).toString('base64url');
  const now = Date.now();
  const oauthState = core.verifySignedState(requestUrl.searchParams.get('state'), AUTH_SECRET) || {};
  store.pendingIdentities = store.pendingIdentities.filter(
    (entry) => entry?.sub !== identity.sub && core.normalizeEmail(entry?.email) !== core.normalizeEmail(identity.email)
  );
  store.pendingIdentities.push({
    tokenHash: core.tokenHash(token),
    sub: String(identity.sub),
    email: core.normalizeEmail(identity.email),
    name: String(identity.name || ''),
    givenName: String(identity.givenName || ''),
    staffId: teacher.id,
    remember: Boolean(oauthState.remember),
    createdAt: now,
    expiresAt: now + PENDING_MAX_AGE_MS,
  });
  saveAuthStore(store);
  appendSetCookie(res, serializeCookie(PENDING_COOKIE, token, {
    httpOnly: true,
    secure: useSecureCookies(req),
    maxAge: Math.floor(PENDING_MAX_AGE_MS / 1000),
  }));
  res.setHeader('Location', '/staff.html?googleAuth=link-required');
  return true;
}

function guardGoogleCallback(req, res, requestUrl, context) {
  if (requestUrl.pathname !== '/api/auth/google/callback') return;
  const originalEnd = res.end.bind(res);
  let ending = false;
  res.end = function finalizeCallbackEnd(...args) {
    if (ending) return originalEnd(...args);
    ending = true;
    try {
      const location = String(res.getHeader('Location') || '');
      if (location.includes('googleAuth=staff-unlinked')) {
        createStaffPendingIdentity(req, res, requestUrl, context.googleIdentity);
      }
    } catch (error) {
      console.error('[Staff Google link] Callback kon niet worden voorbereid:', error?.message || error);
      res.setHeader('Location', '/staff.html?googleAuth=oauth-error');
    }
    return originalEnd(...args);
  };
}

function findLatestStaffRequest(store, pending) {
  return (store.linkRequests || [])
    .filter(
      (entry) =>
        entry?.accountType === 'staff' &&
        entry?.staffId &&
        String(entry?.sub || '') === String(pending?.sub || '') &&
        core.normalizeEmail(entry?.email) === core.normalizeEmail(pending?.email)
    )
    .sort((a, b) => (Date.parse(b?.updatedAt || b?.createdAt || '') || 0) - (Date.parse(a?.updatedAt || a?.createdAt || '') || 0))[0] || null;
}

function createStaffLinkRequest(req, res) {
  const selection = selectedAccountState(req);
  if (!selection || selection.type !== 'staff') {
    return sendJson(res, 404, { message: 'Geen beveiligde docentselectie beschikbaar.' });
  }
  const db = readMainDb();
  const teacher = db.users.find(
    (entry) => entry?.id === selection.accountId && entry?.role === 'teacher' && entry?.active !== false
  );
  if (!teacher) return sendJson(res, 404, { message: 'Het gekozen docentaccount bestaat niet meer.' });

  let store = loadAuthStore();
  const pending = pendingIdentity(req, store);
  if (!pending || pending.staffId !== teacher.id) {
    return sendJson(res, 401, { message: 'Google-koppeling is verlopen. Log opnieuw in.' });
  }
  const identityConflict = core.findLinkByIdentity(store, 'staff', pending);
  if (identityConflict && identityConflict.accountId !== teacher.id) {
    return sendJson(res, 409, { message: 'Dit Google-account is al aan een andere medewerker gekoppeld.' });
  }
  const currentLink = core.findLinkByAccount(store, 'staff', teacher.id);
  if (currentLink?.sub && (currentLink.sub !== pending.sub || core.normalizeEmail(currentLink.email) !== pending.email)) {
    return sendJson(res, 409, { message: 'Dit docentaccount is al aan een ander Google-account gekoppeld.' });
  }

  const existing = findLatestStaffRequest(store, pending);
  if (existing && ['pending', 'approved'].includes(existing.status)) {
    clearCookie(req, res, SELECTED_ACCOUNT_COOKIE, true);
    return sendJson(res, 200, {
      status: existing.status,
      requestId: existing.id,
      staffId: teacher.id,
    });
  }

  const nowIso = new Date().toISOString();
  for (const entry of store.linkRequests) {
    if (
      entry?.status === 'pending' &&
      (String(entry?.sub || '') === String(pending.sub || '') || core.normalizeEmail(entry?.email) === pending.email)
    ) {
      entry.status = 'superseded';
      entry.updatedAt = nowIso;
    }
  }
  const request = {
    id: crypto.randomUUID(),
    accountType: 'staff',
    staffId: teacher.id,
    email: pending.email,
    sub: pending.sub,
    googleName: pending.name || '',
    status: 'pending',
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  store.linkRequests.push(request);
  saveAuthStore(store);
  clearCookie(req, res, SELECTED_ACCOUNT_COOKIE, true);
  return sendJson(res, 202, {
    status: 'pending',
    requestId: request.id,
    staffId: teacher.id,
    message: 'Koppelverzoek verstuurd naar Boekenbaai Beheer.',
  });
}

function staffPendingStatus(req, res) {
  const store = loadAuthStore();
  const pending = pendingIdentity(req, store);
  if (!pending?.staffId) return sendJson(res, 404, { message: 'Geen openstaande docentkoppeling.' });
  const request = findLatestStaffRequest(store, pending);
  const link = core.findLinkByAccount(store, 'staff', pending.staffId);
  const approved = Boolean(
    request?.status === 'approved' &&
    link?.sub === pending.sub &&
    core.normalizeEmail(link?.email) === pending.email
  );
  return sendJson(res, 200, {
    staffId: pending.staffId,
    email: pending.email,
    googleName: pending.name || '',
    requestStatus: approved ? 'approved' : request?.status || 'not-requested',
    canComplete: approved,
  });
}

function createStaffSession(req, res, teacher, remember) {
  const token = crypto.randomBytes(32).toString('base64url');
  const result = core.upsertSession(loadAuthStore(), token, {
    userId: teacher.id,
    type: 'staff',
    remember: Boolean(remember),
    now: Date.now(),
  });
  const session = result.store.sessions.find((entry) => entry?.tokenHash === core.tokenHash(token));
  if (session) {
    session.accountFingerprint = accountCredentialFingerprint(teacher);
    session.authMethod = 'google';
  }
  saveAuthStore(result.store);
  const maxAge = remember ? 30 * 24 * 60 * 60 : undefined;
  const secure = useSecureCookies(req);
  appendSetCookie(res, serializeCookie(SESSION_COOKIE, token, { httpOnly: true, secure, maxAge }));
  appendSetCookie(res, serializeCookie(SESSION_HINT_COOKIE, '1', { httpOnly: false, secure, maxAge }));
}

function completeStaffPending(req, res) {
  let store = loadAuthStore();
  const pending = pendingIdentity(req, store);
  if (!pending?.staffId) return sendJson(res, 401, { message: 'Google-koppeling is verlopen.' });
  const request = findLatestStaffRequest(store, pending);
  if (!request || request.status !== 'approved') {
    return sendJson(res, 409, { message: 'Boekenbaai Beheer heeft de koppeling nog niet goedgekeurd.' });
  }
  const link = core.findLinkByAccount(store, 'staff', pending.staffId);
  if (!link || link.sub !== pending.sub || core.normalizeEmail(link.email) !== pending.email) {
    return sendJson(res, 409, { message: 'De goedgekeurde koppeling komt niet overeen met dit Google-account.' });
  }
  const db = readMainDb();
  const teacher = db.users.find(
    (entry) => entry?.id === pending.staffId && entry?.role === 'teacher' && entry?.active !== false
  );
  if (!teacher) return sendJson(res, 404, { message: 'Docentaccount niet gevonden.' });

  store.pendingIdentities = store.pendingIdentities.filter((entry) => entry?.tokenHash !== pending.tokenHash);
  saveAuthStore(store);
  createStaffSession(req, res, teacher, pending.remember);
  clearCookie(req, res, PENDING_COOKIE, true);
  return sendJson(res, 200, { loggedIn: true, role: 'teacher' });
}

function listStaffLinkRequests(req, res) {
  const context = resolveAdmin(req);
  if (!context) return sendJson(res, 403, { message: 'Alleen Boekenbaai Beheer kan docentkoppelingen beoordelen.' });
  const requests = (context.store.linkRequests || [])
    .filter((entry) => entry?.accountType === 'staff' && entry?.staffId && entry?.status === 'pending')
    .map((entry) => {
      const teacher = context.db.users.find((user) => user?.id === entry.staffId && user?.role === 'teacher');
      return {
        id: entry.id,
        staffId: entry.staffId,
        staffName: teacher?.name || 'Onbekende docent',
        email: entry.email || '',
        googleName: entry.googleName || '',
        nameMatch: compareNames(teacher?.name, entry.googleName),
        createdAt: entry.createdAt,
      };
    });
  return sendJson(res, 200, { requests });
}

function reviewStaffLinkRequest(req, res, requestId, action) {
  const context = resolveAdmin(req);
  if (!context) return sendJson(res, 403, { message: 'Alleen Boekenbaai Beheer kan docentkoppelingen beoordelen.' });
  let store = context.store;
  const request = store.linkRequests.find(
    (entry) => entry?.id === requestId && entry?.accountType === 'staff' && entry?.status === 'pending'
  );
  if (!request) return sendJson(res, 404, { message: 'Openstaand docentkoppelverzoek niet gevonden.' });
  const teacher = context.db.users.find(
    (entry) => entry?.id === request.staffId && entry?.role === 'teacher' && entry?.active !== false
  );
  if (!teacher) return sendJson(res, 404, { message: 'Docentaccount niet gevonden.' });
  const nowIso = new Date().toISOString();
  if (action === 'deny') {
    request.status = 'denied';
    request.updatedAt = nowIso;
    request.reviewedBy = context.user.id;
    saveAuthStore(store);
    return sendJson(res, 200, { status: 'denied' });
  }
  try {
    const linked = core.upsertLink(store, {
      accountType: 'staff',
      accountId: teacher.id,
      email: request.email,
      sub: request.sub,
      linkedBy: context.user.id,
    });
    store = linked.store;
    store.sessions = store.sessions.filter((entry) => !(entry?.type === 'staff' && entry?.userId === teacher.id));
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

function decodeWorkbookRows(file) {
  const raw = String(file || '').replace(/^data:.*?;base64,/, '');
  if (!raw) throw new Error('Geen Excelbestand ontvangen.');
  const workbook = XLSX.read(Buffer.from(raw, 'base64'), { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Het Excelbestand bevat geen werkblad.');
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
  if (!rows.length) throw new Error('Het Excelbestand bevat geen gegevensrijen.');
  return rows;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function schoolSyncPreview(context, body, apply) {
  const kind = body.kind === 'teacher' ? 'teacher' : body.kind === 'student' ? 'student' : '';
  if (!kind) throw new Error('Kies leerlingen of docenten.');
  const rows = decodeWorkbookRows(body.file);
  const result = runSchoolSync({
    kind,
    rows,
    db: clone(context.db),
    store: clone(context.store),
    domain: GOOGLE_DOMAIN,
    actorId: context.user.id,
    fullSchoolSync: Boolean(body.fullSchoolSync),
    applyDeactivations: Boolean(apply),
    manualMatches: body.manualMatches && typeof body.manualMatches === 'object' ? body.manualMatches : {},
  });

  if (
    apply &&
    result.summary.largeRemovalWarning &&
    !body.confirmLargeRemoval
  ) {
    const error = new Error(`Deze synchronisatie zou ${result.summary.missingFromImport} leerlingen inactief maken. Bevestig dit eerst expliciet.`);
    error.code = 'LARGE_REMOVAL_CONFIRMATION';
    error.summary = result.summary;
    throw error;
  }

  if (apply) {
    writeJsonAtomic(DATA_PATH, result.db);
    writeJsonAtomic(AUTH_DATA_PATH, core.pruneStore(result.store));
  }
  return {
    preview: !apply,
    kind,
    summary: result.summary,
    results: result.results,
  };
}

function servePublicAsset(res, filename) {
  const filePath = path.join(STATIC_SOURCE_DIR, filename);
  const content = fs.readFileSync(filePath, 'utf8');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(content);
}

function injectFinalizeAssets(req, res, requestUrl, listener) {
  if (!['/staff', '/staff.html'].includes(requestUrl.pathname)) return listener(req, res);
  const originalEnd = res.end.bind(res);
  res.end = function finalizedStaffHtml(chunk, encoding, callback) {
    let enc = encoding;
    let cb = callback;
    if (typeof encoding === 'function') {
      cb = encoding;
      enc = undefined;
    }
    let nextChunk = chunk;
    const type = String(res.getHeader('Content-Type') || '').toLowerCase();
    if (chunk != null && (!type || type.includes('text/html'))) {
      let html = Buffer.isBuffer(chunk) ? chunk.toString(enc || 'utf8') : String(chunk);
      for (const script of ['/staff-google-link.js', '/school-sync-finalize.js']) {
        if (!html.includes(script)) html = html.replace(/<\/body>/i, `  <script src="${script}"></script>\n</body>`);
      }
      nextChunk = html;
      if (!res.headersSent) res.removeHeader('Content-Length');
    }
    if (enc !== undefined) return originalEnd(nextChunk, enc, cb);
    return originalEnd(nextChunk, cb);
  };
  return listener(req, res);
}

async function handleCustomRoute(req, res, requestUrl) {
  const pathname = requestUrl.pathname;
  if (req.method === 'GET' && pathname === '/staff-google-link.js') {
    servePublicAsset(res, 'staff-google-link.js');
    return true;
  }
  if (req.method === 'GET' && pathname === '/school-sync-finalize.js') {
    servePublicAsset(res, 'school-sync-finalize.js');
    return true;
  }
  if (req.method === 'POST' && pathname === '/api/auth/google/staff-auto-link-request') {
    createStaffLinkRequest(req, res);
    return true;
  }
  if (req.method === 'GET' && pathname === '/api/auth/google/staff-pending') {
    staffPendingStatus(req, res);
    return true;
  }
  if (req.method === 'POST' && pathname === '/api/auth/google/staff-pending/complete') {
    completeStaffPending(req, res);
    return true;
  }
  if (req.method === 'GET' && pathname === '/api/auth/google/staff-link-requests') {
    listStaffLinkRequests(req, res);
    return true;
  }
  const staffAction = pathname.match(/^\/api\/auth\/google\/staff-link-requests\/([\w-]+)\/(approve|deny)$/);
  if (req.method === 'POST' && staffAction) {
    reviewStaffLinkRequest(req, res, staffAction[1], staffAction[2]);
    return true;
  }
  if (req.method === 'POST' && ['/api/admin/school-sync/preview', '/api/admin/school-sync/apply'].includes(pathname)) {
    const context = resolveAdmin(req);
    if (!context) {
      sendJson(res, 403, { message: 'Alleen Boekenbaai Beheer kan schoolgegevens synchroniseren.' });
      return true;
    }
    try {
      const body = await parseBody(req);
      const payload = schoolSyncPreview(context, body, pathname.endsWith('/apply'));
      sendJson(res, 200, payload);
    } catch (error) {
      if (error?.code === 'LARGE_REMOVAL_CONFIRMATION') {
        sendJson(res, 409, {
          code: 'large-removal-confirmation',
          message: error.message,
          summary: error.summary,
        });
      } else {
        sendJson(res, error?.code === 'BODY_TOO_LARGE' ? 413 : 400, { message: error.message });
      }
    }
    return true;
  }
  return false;
}

function wrapRequestListener(listener) {
  return function finalizeSchoolAuthListener(req, res) {
    let requestUrl;
    try {
      requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch (error) {
      return listener(req, res);
    }
    const context = { googleIdentity: null };
    return requestContext.run(context, async () => {
      try {
        const handled = await handleCustomRoute(req, res, requestUrl);
        if (handled) return undefined;
        guardGoogleCallback(req, res, requestUrl, context);
        return injectFinalizeAssets(req, res, requestUrl, listener);
      } catch (error) {
        console.error('[Boekenbaai finalize] Interne fout:', error?.message || error);
        if (!res.headersSent && !res.writableEnded) {
          return sendJson(res, 500, { message: 'De bewerking kon niet worden afgerond.' });
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
    compareNames,
    selectedAccountState,
    decodeWorkbookRows,
    schoolSyncPreview,
  },
};
