'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');
const core = require('./google-auth-core');
const { accountCredentialFingerprint } = require('./google-auth-security-core');
const {
  hashPassword,
  verifyPassword,
  burnPasswordAttempt,
  validateNewPassword,
  LoginFailureLimiter,
} = require('./local-password-security-core');

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
const SESSION_SENTINEL = 'cookie';
const MAX_BODY_BYTES = 64 * 1024;
const MAX_CONCURRENT_PASSWORD_WORK = 4;

const originalCreateServer = http.createServer.bind(http);
const failureLimiter = new LoginFailureLimiter();
let activePasswordWork = 0;

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
  return db;
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, filePath);
  } finally {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch (error) {
      // Best effort cleanup; het echte bestand is nooit via deze tempnaam bereikbaar.
    }
  }
}

function saveMainDb(db) {
  writeJsonAtomic(DATA_PATH, db);
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
  writeJsonAtomic(AUTH_DATA_PATH, normalized);
  return normalized;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled || tooLarge) return;
      body += chunk.toString();
      if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
        tooLarge = true;
        body = '';
      }
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      if (tooLarge) return reject(Object.assign(new Error('Payload te groot'), { code: 'BODY_TOO_LARGE' }));
      if (!body) return resolve({});
      try {
        return resolve(JSON.parse(body));
      } catch (error) {
        return reject(Object.assign(new Error('Ongeldige JSON'), { code: 'INVALID_JSON' }));
      }
    });
    req.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
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

function serializeCookie(name, value, { httpOnly = true } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
  if (httpOnly) parts.push('HttpOnly');
  return parts;
}

function appendSetCookie(res, cookie) {
  const current = res.getHeader('Set-Cookie');
  const values = current ? (Array.isArray(current) ? current : [current]) : [];
  res.setHeader('Set-Cookie', [...values, cookie]);
}

function setLocalSessionCookies(req, res, token) {
  const secureSuffix = useSecureCookies(req) ? '; Secure' : '';
  appendSetCookie(res, `${serializeCookie(SESSION_COOKIE, token, { httpOnly: true })}${secureSuffix}`);
  appendSetCookie(res, `${serializeCookie(SESSION_HINT_COOKIE, '1', { httpOnly: false })}${secureSuffix}`);
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function sendRateLimit(res, status) {
  res.setHeader('Retry-After', String(status.retryAfterSeconds || 60));
  return sendJson(res, 429, {
    message: 'Te veel mislukte inlogpogingen. Wacht even en probeer daarna opnieuw.',
    retryAfterSeconds: status.retryAfterSeconds || 60,
  });
}

function normalizeIdentity(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('nl-NL');
}

function getClientRateKey(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const remote = String(req.socket?.remoteAddress || '').trim();
  const material = `${remote}\u0000${forwarded || remote || 'unknown'}`;
  return crypto.createHash('sha256').update(material).digest('hex').slice(0, 32);
}

function findAdminByName(db, name) {
  const wanted = normalizeIdentity(name);
  if (!wanted) return null;
  const matches = db.users.filter(
    (entry) =>
      entry?.role === 'admin' &&
      (normalizeIdentity(entry?.name) === wanted || normalizeIdentity(entry?.username) === wanted)
  );
  return matches.length === 1 ? matches[0] : null;
}

function findAdminByUsername(db, username) {
  const wanted = normalizeIdentity(username);
  if (!wanted) return null;
  const matches = db.users.filter(
    (entry) => entry?.role === 'admin' && normalizeIdentity(entry?.username) === wanted
  );
  return matches.length === 1 ? matches[0] : null;
}

async function withPasswordWork(res, work) {
  if (activePasswordWork >= MAX_CONCURRENT_PASSWORD_WORK) {
    res.setHeader('Retry-After', '2');
    sendJson(res, 429, { message: 'Inloggen is even druk. Probeer het over een paar seconden opnieuw.' });
    return { handled: true, value: null };
  }
  activePasswordWork += 1;
  try {
    return { handled: false, value: await work() };
  } finally {
    activePasswordWork -= 1;
  }
}

function ensureUnchangedAccount(db, accountId, expectedHash) {
  const current = db.users.find((entry) => entry?.id === accountId && entry?.role === 'admin');
  if (!current || String(current.passwordHash || '') !== String(expectedHash || '')) return null;
  return current;
}

function createAdminSession(req, res, admin) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const result = core.upsertSession(loadAuthStore(), token, {
    userId: admin.id,
    type: 'staff',
    remember: false,
    now,
  });
  saveAuthStore(result.store);
  setLocalSessionCookies(req, res, token);
  return token;
}

async function authenticateAdmin(req, res, { name = '', username = '', password = '' } = {}) {
  const clientKey = getClientRateKey(req);
  const limit = failureLimiter.status(clientKey);
  if (!limit.allowed) {
    req.resume();
    return sendRateLimit(res, limit);
  }

  const suppliedPassword = typeof password === 'string' ? password : String(password || '');
  const db = readMainDb();
  const admin = name ? findAdminByName(db, name) : findAdminByUsername(db, username);

  const expensive = await withPasswordWork(res, async () => {
    if (!admin) {
      await burnPasswordAttempt(suppliedPassword);
      return { admin: null, verification: { ok: false, needsUpgrade: false } };
    }
    const verification = await verifyPassword(suppliedPassword, admin.passwordHash || '');
    return { admin, verification };
  });
  if (expensive.handled) return undefined;

  const { admin: matchedAdmin, verification } = expensive.value;
  if (!matchedAdmin || !verification.ok) {
    failureLimiter.recordFailure(clientKey);
    return sendJson(res, 401, { message: 'Onjuiste inloggegevens' });
  }

  const originalHash = String(matchedAdmin.passwordHash || '');
  let currentDb = readMainDb();
  let currentAdmin = ensureUnchangedAccount(currentDb, matchedAdmin.id, originalHash);
  if (!currentAdmin) {
    return sendJson(res, 409, { message: 'Het account is ondertussen gewijzigd. Probeer opnieuw in te loggen.' });
  }

  if (verification.needsUpgrade) {
    const upgraded = await withPasswordWork(res, () => hashPassword(suppliedPassword));
    if (upgraded.handled) return undefined;
    currentDb = readMainDb();
    currentAdmin = ensureUnchangedAccount(currentDb, matchedAdmin.id, originalHash);
    if (!currentAdmin) {
      return sendJson(res, 409, { message: 'Het account is ondertussen gewijzigd. Probeer opnieuw in te loggen.' });
    }
    currentAdmin.passwordHash = upgraded.value;
    saveMainDb(currentDb);
  }

  // Lees na een eventuele migratie nogmaals zodat de sessiefingerprint exact
  // overeenkomt met wat uiteindelijk op schijf staat.
  const finalDb = readMainDb();
  const finalAdmin = finalDb.users.find(
    (entry) => entry?.id === matchedAdmin.id && entry?.role === 'admin'
  );
  if (!finalAdmin) {
    return sendJson(res, 409, { message: 'Het beheeraccount bestaat niet meer.' });
  }

  createAdminSession(req, res, finalAdmin);
  failureLimiter.clearKey(clientKey);
  return sendJson(res, 200, {
    token: SESSION_SENTINEL,
    user: {
      id: finalAdmin.id,
      name: finalAdmin.name || finalAdmin.username || 'Boekenbaai Beheer',
      username: finalAdmin.username || '',
      role: 'admin',
      mustChangePassword: Boolean(finalAdmin.mustChangePassword),
    },
  });
}

function getBearerToken(req) {
  const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function activeToken(req) {
  const bearer = getBearerToken(req);
  if (bearer && bearer !== SESSION_SENTINEL) return bearer;
  return parseCookies(req)[SESSION_COOKIE] || '';
}

function resolveAdminSession(req) {
  const token = activeToken(req);
  if (!token) return null;
  const store = loadAuthStore();
  const session = core.resolveSession(store, token);
  if (!session || session.type !== 'staff') return null;
  const db = readMainDb();
  const admin = db.users.find((entry) => entry?.id === session.userId && entry?.role === 'admin');
  if (!admin) return null;
  return { token, store, session, db, admin };
}

async function changeAdminPassword(req, res) {
  const context = resolveAdminSession(req);
  if (!context) {
    return sendJson(res, 403, {
      message: 'Wachtwoordbeheer is alleen beschikbaar voor Boekenbaai Beheer.',
    });
  }

  const body = await parseBody(req);
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
  if (!currentPassword || !newPassword) {
    return sendJson(res, 400, { message: 'Vul je huidige en nieuwe wachtwoord in.' });
  }
  const validation = validateNewPassword(newPassword);
  if (!validation.ok) return sendJson(res, 400, { message: validation.message });
  if (currentPassword === newPassword) {
    return sendJson(res, 400, { message: 'Kies een ander nieuw wachtwoord.' });
  }

  const originalHash = String(context.admin.passwordHash || '');
  const verified = await withPasswordWork(res, () => verifyPassword(currentPassword, originalHash));
  if (verified.handled) return undefined;
  if (!verified.value.ok) {
    return sendJson(res, 400, { message: 'Huidig wachtwoord klopt niet.' });
  }

  const nextHash = await withPasswordWork(res, () => hashPassword(validation.password));
  if (nextHash.handled) return undefined;

  const freshDb = readMainDb();
  const freshAdmin = ensureUnchangedAccount(freshDb, context.admin.id, originalHash);
  if (!freshAdmin) {
    return sendJson(res, 409, { message: 'Het account is ondertussen gewijzigd. Log opnieuw in.' });
  }
  freshAdmin.passwordHash = nextHash.value;
  freshAdmin.mustChangePassword = false;
  saveMainDb(freshDb);

  // Andere sessies houden hun oude fingerprint en worden daardoor door de
  // buitenste securitylaag bij hun eerstvolgende request automatisch geweigerd.
  // Alleen deze actieve sessie krijgt de nieuwe credential fingerprint.
  const latestStore = loadAuthStore();
  const currentHash = core.tokenHash(context.token);
  const currentSession = latestStore.sessions.find((entry) => entry?.tokenHash === currentHash);
  if (!currentSession) {
    return sendJson(res, 409, { message: 'Je sessie is gewijzigd. Log opnieuw in met je nieuwe wachtwoord.' });
  }
  currentSession.accountFingerprint = accountCredentialFingerprint(freshAdmin);
  currentSession.authMethod = 'password';
  saveAuthStore(latestStore);

  return sendJson(res, 200, {
    message: 'Wachtwoord gewijzigd.',
    mustChangePassword: false,
  });
}

async function handleLocalPasswordRoute(req, res, requestUrl) {
  if (req.method === 'POST' && requestUrl.pathname === '/api/login-by-name') {
    let body;
    try {
      body = await parseBody(req);
    } catch (error) {
      return sendJson(res, error?.code === 'BODY_TOO_LARGE' ? 413 : 400, { message: error.message });
    }
    if (body.type !== 'staff') {
      await withPasswordWork(res, () => burnPasswordAttempt(body.password || ''));
      return sendJson(res, 401, { message: 'Onjuiste inloggegevens' });
    }
    if (!String(body.name || '').trim() || typeof body.password !== 'string' || !body.password) {
      return sendJson(res, 400, { message: 'Naam en wachtwoord zijn verplicht' });
    }
    return authenticateAdmin(req, res, {
      name: body.name,
      password: body.password,
    });
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/login') {
    let body;
    try {
      body = await parseBody(req);
    } catch (error) {
      return sendJson(res, error?.code === 'BODY_TOO_LARGE' ? 413 : 400, { message: error.message });
    }
    if (!String(body.username || '').trim() || typeof body.password !== 'string' || !body.password) {
      return sendJson(res, 400, { message: 'Gebruikersnaam en wachtwoord zijn verplicht' });
    }
    return authenticateAdmin(req, res, {
      username: body.username,
      password: body.password,
    });
  }

  if (req.method === 'PATCH' && requestUrl.pathname === '/api/account/password') {
    try {
      return await changeAdminPassword(req, res);
    } catch (error) {
      if (error?.code === 'BODY_TOO_LARGE') {
        return sendJson(res, 413, { message: error.message });
      }
      if (error?.code === 'INVALID_JSON') {
        return sendJson(res, 400, { message: error.message });
      }
      throw error;
    }
  }

  return false;
}

function wrapRequestListener(listener) {
  return async function localPasswordSecurityListener(req, res) {
    let requestUrl;
    try {
      requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch (error) {
      return listener(req, res);
    }

    try {
      const handled = await handleLocalPasswordRoute(req, res, requestUrl);
      if (handled !== false || res.writableEnded) return handled;
      return listener(req, res);
    } catch (error) {
      console.error('[Local Password Security] Interne fout:', error?.message || error);
      if (!res.headersSent && !res.writableEnded) {
        return sendJson(res, 503, { message: 'Lokale inlog is tijdelijk niet beschikbaar.' });
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
    failureLimiter,
    getClientRateKey,
    findAdminByName,
    findAdminByUsername,
    activeToken,
    resolveAdminSession,
  },
};
