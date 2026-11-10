'use strict';

// Student PIN credential management. A PIN can never authenticate an ordinary
// student session. The checkout-only challenge belongs to a later PR.
const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');
const core = require('./google-auth-core');
const security = require('./google-auth-security-core');
const { readJsonSnapshot, mutateJsonLockedAsync } = require('./database-write-coordinator');
const pins = require('./student-pin-core');
const checkout = require('./student-pin-checkout-core');

const originalCreateServer = http.createServer.bind(http);
const DATA_PATH = process.env.BOEKENBAAI_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_DATA_PATH)
  : path.join(__dirname, 'data', 'db.json');
const AUTH_DATA_PATH = process.env.BOEKENBAAI_AUTH_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_AUTH_DATA_PATH)
  : DATA_PATH + '.auth.json';
const PUBLIC_URL = String(process.env.BOEKENBAAI_PUBLIC_URL || '');
const PIN_SECRET = pins.configuredSecret();
const MUTATION_LIMIT = 5;
const MUTATION_WINDOW_MS = 60 * 1000;
const mutationAttempts = new Map();
const networkVerifyAttempts = new Map();
function networkVerifyAllowed(req) {
  // Secondary throttle for a shared client/network. The per-student lockout
  // in the persistent auth store is authoritative across all processes.
  const key = String(req.socket?.remoteAddress || 'unknown').slice(0, 96);
  const now = Date.now();
  if (networkVerifyAttempts.size > 2000) {
    for (const [ip, entry] of networkVerifyAttempts) {
      if (entry.at < now - 10 * 60_000) networkVerifyAttempts.delete(ip);
    }
  }
  const entry = networkVerifyAttempts.get(key);
  const next = entry && entry.at > now - 10 * 60_000
    ? { count: entry.count + 1, at: entry.at }
    : { count: 1, at: now };
  networkVerifyAttempts.set(key, next);
  return next.count <= 300;
}


function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(payload));
}

function cookies(req) {
  const result = Object.create(null);
  for (const part of String(req.headers.cookie || '').split(';')) {
    const n = part.indexOf('=');
    if (n < 1) continue;
    try {
      result[part.slice(0, n).trim()] = decodeURIComponent(part.slice(n + 1).trim());
    } catch (_) {
      // Invalid cookie encoding is not an authentication credential.
    }
  }
  return result;
}

function getToken(req) {
  const bearer = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (bearer && bearer[1].trim() !== 'cookie') return bearer[1].trim();
  return cookies(req).boekenbaai_session || '';
}

function loadDb() {
  const db = readJsonSnapshot(DATA_PATH);
  if (!db || typeof db !== 'object' || Array.isArray(db)) throw Error('db_invalid');
  return db;
}

function loadAuth() {
  const raw = readJsonSnapshot(AUTH_DATA_PATH, { missingValue: core.emptyAuthStore() });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('auth_invalid');
  return core.pruneStore(core.normalizeStore(raw));
}

function resolveContext(db, store, token) {
  if (!token) return null;
  const validated = security.validatePersistedSession(store, token, db);
  return validated.valid ? validated : null;
}

function verifiedGoogleStudent(context, store) {
  if (!context || context.session?.type !== 'student'
    || context.session?.authMethod !== 'google'
    || context.account?.active === false) return null;
  const link = core.findLinkByAccount(store, 'student', context.account.id);
  return link?.sub && link?.email ? link : null;
}

function rateAllow(key) {
  const now = Date.now();
  if (mutationAttempts.size > 2000) {
    for (const [k, history] of mutationAttempts) {
      if (!history.length || history[history.length - 1] < now - MUTATION_WINDOW_MS) {
        mutationAttempts.delete(k);
      }
    }
  }
  const attempts = (mutationAttempts.get(key) || [])
    .filter(time => time >= now - MUTATION_WINDOW_MS);
  attempts.push(now);
  mutationAttempts.set(key, attempts);
  return attempts.length <= MUTATION_LIMIT;
}

async function parseBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024) {
      const error = Error('Payload te groot');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    const raw = Buffer.concat(chunks).toString('utf8');
    const body = raw ? JSON.parse(raw) : {};
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error();
    return body;
  } catch (error) {
    if (error.status) throw error;
    const invalid = Error('Ongeldige JSON');
    invalid.status = 400;
    throw invalid;
  }
}

async function mutateAuth(mutate) {
  return mutateJsonLockedAsync({
    lockPath: DATA_PATH,
    filePath: AUTH_DATA_PATH,
    read: loadAuth,
    mutate: auth => {
      const db = loadDb();
      const next = mutate(db, auth);
      return next || auth;
    },
    waitMs: 1800,
  });
}

function conflict(message = 'Accountgegevens zijn gewijzigd. Probeer opnieuw.') {
  const err = Error(message);
  err.status = 409;
  return err;
}

function checkedContext(db, auth, token) {
  const context = resolveContext(db, auth, token);
  if (!context) throw conflict('Sessie is gewijzigd. Log opnieuw in.');
  return context;
}

async function handleStudentPin(req, res, requestUrl) {
  const route = requestUrl.pathname;
  const isVerify = route === '/api/auth/student-pin/verify' && req.method === 'POST';
  const isStatus = route === '/api/auth/student-pin/status' && req.method === 'GET';
  const isSet = route === '/api/auth/student-pin/set' && req.method === 'POST';
  const isSelfReset = route === '/api/auth/student-pin/reset' && req.method === 'POST';
  const staffReset = route.match(/^\/api\/auth\/student-pin\/students\/([\w-]+)\/reset$/);
  if (!isStatus && !isSet && !isSelfReset && !isVerify
    && !(staffReset && req.method === 'POST')) {
    return sendJson(res, 404, { message: 'Niet gevonden.' });
  }
  if (!isStatus && !security.isSameOriginMutation(
    req, security.getExpectedOrigin(req, PUBLIC_URL))) {
    return sendJson(res, 403, { message: 'Ongeldige aanvraagherkomst.' });
  }

  if (isVerify) {
    if (!networkVerifyAllowed(req)) {
      res.setHeader('Retry-After', '600');
      return sendJson(res, 429, { message: 'Te veel PIN-pogingen. Probeer later opnieuw.' });
    }
    const body = await parseBody(req);
    try {
      const result = await checkout.issueGrant({
        studentId: body.studentId, bookId: body.bookId, pin: body.pin,
      });
      return sendJson(res, 200, result);
    } catch (error) {
      if (error?.status) {
        if (error.status === 429) res.setHeader('Retry-After', '900');
        return sendJson(res, error.status, { message: error.message });
      }
      throw error;
    }
  }

  const token = getToken(req);
  const db = loadDb();
  const store = loadAuth();
  const context = resolveContext(db, store, token);
  if (!context) return sendJson(res, 401, { message: 'Log opnieuw in.' });

  if (isStatus) {
    if (context.session.type !== 'student') {
      return sendJson(res, 403, { message: 'Alleen voor leerlingen.' });
    }
    const current = pins.credentialFor(store, context.account.id);
    return sendJson(res, 200, {
      configured: Boolean(PIN_SECRET),
      hasPin: Boolean(current?.hash && current?.salt
        && current.linkedSub
        && current.linkedSub === core.findLinkByAccount(store, 'student', context.account.id)?.sub),
      canSet: Boolean(PIN_SECRET && verifiedGoogleStudent(context, store)),
    });
  }

  if (!PIN_SECRET) return sendJson(res, 503, {
    message: 'PIN is nog niet geconfigureerd. Neem contact op met de beheerder.',
  });
  const rateKey = context.session.type + ':' + context.account.id;
  if (!rateAllow(rateKey)) {
    res.setHeader('Retry-After', '60');
    return sendJson(res, 429, { message: 'Te veel PIN-wijzigingen. Probeer later opnieuw.' });
  }

  if (isSet) {
    if (!verifiedGoogleStudent(context, store)) {
      return sendJson(res, 403, { message: 'Log eerst in met je eigen Google-schoolaccount.' });
    }
    const body = await parseBody(req);
    if (!pins.validPin(body.pin)) {
      return sendJson(res, 400, { message: 'Kies een PIN van precies zes cijfers.' });
    }
    const studentId = context.account.id;
    const link = verifiedGoogleStudent(context, store);
    const earlier = pins.credentialFor(store, studentId);
    const generation = pins.currentGeneration(earlier);
    const next = await pins.makeCredential(body.pin, studentId, PIN_SECRET, earlier, link.sub);
    await mutateAuth((latestDb, auth) => {
      const latest = checkedContext(latestDb, auth, token);
      const currentLink = verifiedGoogleStudent(latest, auth);
      const existing = pins.credentialFor(auth, studentId);
      if (!currentLink || latest.account.id !== studentId
        || currentLink.sub !== link.sub
        || pins.currentGeneration(existing) !== generation) throw conflict();
      return pins.replaceCredential(auth, next);
    });
    return sendJson(res, 200, { hasPin: true, message: 'Je PIN is opgeslagen.' });
  }

  if (isSelfReset) {
    if (!verifiedGoogleStudent(context, store)) {
      return sendJson(res, 403, { message: 'Log eerst in met je Google-schoolaccount.' });
    }
    await mutateAuth((latestDb, auth) => {
      const latest = checkedContext(latestDb, auth, token);
      if (!verifiedGoogleStudent(latest, auth)
        || latest.account.id !== context.account.id) throw conflict();
      return pins.resetCredential(auth, latest.account.id,
        pins.credentialFor(auth, latest.account.id));
    });
    return sendJson(res, 200, { hasPin: false, message: 'Je PIN is gereset.' });
  }

  const studentId = staffReset[1];
  if (!['teacher', 'admin'].includes(context.account.role)
    || context.session.type !== 'staff'
    || !core.canStaffManageStudent(db, context.account, studentId)) {
    return sendJson(res, 403, { message: 'Geen toestemming om deze PIN te resetten.' });
  }
  await mutateAuth((latestDb, auth) => {
    const latest = checkedContext(latestDb, auth, token);
    if (latest.session.type !== 'staff'
      || !core.canStaffManageStudent(latestDb, latest.account, studentId)
      || !(latestDb.students || []).some(s => s.id === studentId && s.active !== false)) {
      throw conflict('Geen toestemming voor deze leerling.');
    }
    return pins.resetCredential(auth, studentId, pins.credentialFor(auth, studentId));
  });
  return sendJson(res, 200, { message: 'Leerling-PIN is gereset.' });
}

function wrapRequestListener(listener) {
  return async function studentPinListener(req, res) {
    let route;
    try {
      route = new URL(req.url, 'http://localhost');
      if (!route.pathname.startsWith('/api/auth/student-pin/')) return listener(req, res);
      return await handleStudentPin(req, res, route);
    } catch (error) {
      if (res.writableEnded) return;
      if (error?.code === 'DATABASE_WRITE_BUSY' || error?.code === 'DATABASE_WRITE_CONFLICT') {
        return sendJson(res, 409, { message: 'Gegevens zijn tegelijk gewijzigd. Probeer opnieuw.' });
      }
      if (error?.status) return sendJson(res, error.status, { message: error.message });
      console.error('[Student PIN] Aanvraag mislukt:', error?.message || 'interne fout');
      return sendJson(res, 500, { message: 'PIN kon niet worden verwerkt.' });
    }
  };
}

http.createServer = function patchedCreateServer(...args) {
  const listenerIndex = typeof args[0] === 'function' ? 0 : 1;
  if (typeof args[listenerIndex] !== 'function') return originalCreateServer(...args);
  args[listenerIndex] = wrapRequestListener(args[listenerIndex]);
  return originalCreateServer(...args);
};

module.exports = {
  __test: { loadDb, loadAuth, resolveContext, verifiedGoogleStudent, handleStudentPin },
};
