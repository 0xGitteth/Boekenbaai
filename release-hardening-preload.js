'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const core = require('./google-auth-core');

const DEFAULT_DATA_PATH = path.join(__dirname, 'data', 'db.json');
const DATA_PATH = process.env.BOEKENBAAI_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_DATA_PATH)
  : DEFAULT_DATA_PATH;
const AUTH_DATA_PATH = process.env.BOEKENBAAI_AUTH_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_AUTH_DATA_PATH)
  : `${DATA_PATH}.auth.json`;
const MAX_BUFFERED_BODY_BYTES = 21 * 1024 * 1024;
const revokedRuntimeTokenHashes = new Set();
const originalCreateServer = http.createServer.bind(http);

function parseBearer(req) {
  const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(payload));
}

function normalizeKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('nl-NL')
    .replace(/[^a-z0-9]+/g, '');
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

function rowLookup(row) {
  const map = new Map();
  for (const [key, value] of Object.entries(row || {})) map.set(normalizeKey(key), value);
  return map;
}

function firstRowValue(row, keys) {
  const lookup = rowLookup(row);
  for (const key of keys) {
    const value = String(lookup.get(normalizeKey(key)) || '').trim();
    if (value) return value;
  }
  return '';
}

function hasRowKey(row, keys) {
  const lookup = rowLookup(row);
  return keys.some((key) => lookup.has(normalizeKey(key)));
}

function deriveNameParts(fullName) {
  const clean = String(fullName || '').trim().replace(/\s+/g, ' ');
  const parts = clean.split(' ').filter(Boolean);
  return {
    first: parts[0] || '',
    middle: parts.length > 2 ? parts.slice(1, -1).join(' ') : '',
    last: parts.length > 1 ? parts[parts.length - 1] : '',
  };
}

function accountByStoredEmail(input, email) {
  const normalized = core.normalizeEmail(email);
  if (!normalized) return null;
  const accountType = input.kind === 'teacher' ? 'staff' : 'student';
  const links = core.normalizeStore(input.store).links || [];
  const link = links.find(
    (entry) => entry?.accountType === accountType && core.normalizeEmail(entry?.email) === normalized
  );
  if (!link) return null;
  if (input.kind === 'teacher') {
    return (input.db?.users || []).find(
      (entry) => entry?.id === link.accountId && entry?.role === 'teacher'
    ) || null;
  }
  return (input.db?.students || []).find((entry) => entry?.id === link.accountId) || null;
}

function prepareImportRows(input) {
  return (Array.isArray(input.rows) ? input.rows : []).map((source) => {
    const row = { ...(source || {}) };
    const fullName = firstRowValue(row, ['Naam', 'Volledige naam']);
    const firstName = firstRowValue(row, ['Voornaam', 'Roepnaam']);
    const middleName = firstRowValue(row, ['Voorvoegsel', 'Tussenvoegsel']);
    const lastName = firstRowValue(row, ['Achternaam']);
    if (fullName && (!firstName || !lastName)) {
      const parts = deriveNameParts(fullName);
      if (!firstName && parts.first) row.Voornaam = parts.first;
      if (!middleName && parts.middle) row.Voorvoegsel = parts.middle;
      if (!lastName && parts.last) row.Achternaam = parts.last;
    }

    const email = firstRowValue(row, [
      'Schoolmail',
      'School e-mail',
      'E-mailadres',
      'Emailadres',
      'Email',
      'Mailadres',
    ]);
    const username = firstRowValue(row, ['Gebruikersnaam', 'Username', 'Login']);
    if (email && !username) {
      const account = accountByStoredEmail(input, email);
      if (account?.username) row.Gebruikersnaam = account.username;
    }
    return row;
  });
}

function collectRemovedSessionHashes(beforeStore, afterStore) {
  const after = new Set((afterStore?.sessions || []).map((entry) => entry?.tokenHash).filter(Boolean));
  for (const entry of beforeStore?.sessions || []) {
    if (entry?.tokenHash && !after.has(entry.tokenHash)) revokedRuntimeTokenHashes.add(entry.tokenHash);
  }
}

function linkEmailMap(store) {
  const map = new Map();
  for (const link of core.normalizeStore(store).links || []) {
    if (!link?.accountType || !link?.accountId) continue;
    map.set(`${link.accountType}:${link.accountId}`, core.normalizeEmail(link.email));
  }
  return map;
}

function supersedeStaleRequests(beforeStore, afterStore) {
  const beforeEmails = linkEmailMap(beforeStore);
  const afterEmails = linkEmailMap(afterStore);
  const changed = new Set();
  for (const [key, email] of afterEmails.entries()) {
    if ((beforeEmails.get(key) || '') !== (email || '')) changed.add(key);
  }
  if (!changed.size) return;
  const now = new Date().toISOString();
  for (const request of afterStore.linkRequests || []) {
    if (request?.status !== 'pending') continue;
    const key = request?.studentId
      ? `student:${request.studentId}`
      : request?.staffId
        ? `staff:${request.staffId}`
        : '';
    if (!key || !changed.has(key)) continue;
    request.status = 'superseded';
    request.updatedAt = now;
  }
}

function teacherNameFromRow(row) {
  const direct = firstRowValue(row, ['Naam', 'Volledige naam']);
  if (direct) return direct;
  return [
    firstRowValue(row, ['Roepnaam', 'Voornaam']),
    firstRowValue(row, ['Voorvoegsel', 'Tussenvoegsel']),
    firstRowValue(row, ['Achternaam']),
  ].filter(Boolean).join(' ');
}

function teacherHasNoLinkedGroups(row) {
  if (!hasRowKey(row, ['Gekoppelde groepen'])) return false;
  return !firstRowValue(row, ['Gekoppelde groepen']);
}

function reconcileUngroupedTeachers(input, result) {
  if (input.kind !== 'teacher') return;
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const now = new Date().toISOString();
  for (const row of rows) {
    if (!teacherHasNoLinkedGroups(row)) continue;
    const wanted = normalizeName(teacherNameFromRow(row));
    if (!wanted) continue;
    const matches = (result.db.users || []).filter(
      (entry) => entry?.role === 'teacher' && normalizeName(entry?.name) === wanted
    );
    if (matches.length !== 1) continue;
    const teacher = matches[0];
    if (teacher.active === false && !(teacher.classIds || []).length) continue;
    teacher.active = false;
    teacher.inactiveAt = now;
    teacher.inactiveReason = 'no-linked-parnassys-groups';
    teacher.inactiveBy = String(input.actorId || 'school-sync');
    teacher.classIds = [];
    for (const klass of result.db.classes || []) {
      klass.teacherIds = Array.isArray(klass?.teacherIds)
        ? klass.teacherIds.filter((id) => id !== teacher.id)
        : [];
    }
    result.store.sessions = (result.store.sessions || []).filter(
      (entry) => !(entry?.type === 'staff' && entry?.userId === teacher.id)
    );
    for (const request of result.store.linkRequests || []) {
      if (request?.staffId === teacher.id && request?.status === 'pending') {
        request.status = 'superseded';
        request.updatedAt = now;
      }
    }
  }
}

function installImportHardening() {
  const people = require('./google-first-people-import');
  const originalApply = people.applyPeopleImport;
  people.applyPeopleImport = function hardenedApplyPeopleImport(input = {}) {
    const beforeStore = core.normalizeStore(input.store);
    const preparedInput = { ...input, rows: prepareImportRows(input) };
    const result = originalApply(preparedInput);
    reconcileUngroupedTeachers(preparedInput, result);
    supersedeStaleRequests(beforeStore, result.store);
    collectRemovedSessionHashes(beforeStore, result.store);
    return result;
  };

  const syncCore = require('./school-sync-core');
  const originalSync = syncCore.runSchoolSync;
  syncCore.runSchoolSync = function hardenedRunSchoolSync(input = {}) {
    const beforeStore = core.normalizeStore(input.store);
    const result = originalSync(input);
    collectRemovedSessionHashes(beforeStore, result.store);
    return result;
  };
}

installImportHardening();

function shouldBufferBody(req, pathname) {
  if (String(req.method || '').toUpperCase() !== 'POST') return false;
  if (pathname === '/api/mentor/students') return true;
  if (/^\/api\/mentor\/students\/[\w-]+\/transfer$/.test(pathname)) return true;
  if (pathname === '/api/admin/google-first/import') return true;
  return ['/api/admin/school-sync/preview', '/api/admin/school-sync/apply'].includes(pathname);
}

function replayBufferedRequest(req, body, listener) {
  const originalOn = req.on.bind(req);
  const originalOnce = req.once.bind(req);
  const originalAddListener = req.addListener.bind(req);
  const replay = (event, callback, once = false) => {
    if (event === 'data') {
      if (body.length) callback(body);
      return req;
    }
    if (event === 'end') {
      callback();
      return req;
    }
    return once ? originalOnce(event, callback) : originalOn(event, callback);
  };
  req.on = (event, callback) => replay(event, callback, false);
  req.addListener = (event, callback) => {
    if (event === 'data' || event === 'end') return replay(event, callback, false);
    return originalAddListener(event, callback);
  };
  req.once = (event, callback) => replay(event, callback, true);
  return listener(req);
}

function bufferRequest(req, res, listener) {
  const chunks = [];
  let size = 0;
  let failed = false;
  req.on('data', (chunk) => {
    if (failed) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BUFFERED_BODY_BYTES) {
      failed = true;
      return;
    }
    chunks.push(buffer);
  });
  req.on('end', () => {
    if (failed) {
      sendJson(res, 413, { message: 'Payload te groot' });
      return;
    }
    replayBufferedRequest(req, Buffer.concat(chunks), listener);
  });
  req.on('error', (error) => {
    if (!res.writableEnded) sendJson(res, 400, { message: error?.message || 'Verzoek kon niet worden gelezen.' });
  });
}

function rejectRevokedRuntimeBearer(req, res) {
  const bearer = parseBearer(req);
  if (!bearer || bearer === 'cookie') return false;
  if (!revokedRuntimeTokenHashes.has(core.tokenHash(bearer))) return false;
  sendJson(res, 401, { message: 'Sessie is verlopen' });
  return true;
}

function wrapRequestListener(listener) {
  return function releaseHardeningListener(req, res) {
    let pathname = '';
    try {
      pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
    } catch (error) {
      return listener(req, res);
    }
    try {
      if (rejectRevokedRuntimeBearer(req, res)) return undefined;
      if (shouldBufferBody(req, pathname)) {
        return bufferRequest(req, res, (preparedReq) => listener(preparedReq, res));
      }
      return listener(req, res);
    } catch (error) {
      console.error('[Release hardening]', error?.message || error);
      if (!res.headersSent && !res.writableEnded) {
        return sendJson(res, 500, { message: 'De bewerking kon niet veilig worden verwerkt.' });
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
    prepareImportRows,
    deriveNameParts,
    supersedeStaleRequests,
    reconcileUngroupedTeachers,
    revokedRuntimeTokenHashes,
    shouldBufferBody,
  },
};
