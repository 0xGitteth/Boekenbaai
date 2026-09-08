'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const core = require('./google-auth-core');

const DEFAULT_DATA_PATH = path.join(__dirname, 'data', 'db.json');
const DATA_PATH = process.env.BOEKENBAAI_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_DATA_PATH)
  : DEFAULT_DATA_PATH;
const AUTH_DATA_PATH = process.env.BOEKENBAAI_AUTH_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_AUTH_DATA_PATH)
  : `${DATA_PATH}.auth.json`;
const WATCH_PATHS = new Set([
  '/api/auth/google/student-email',
  '/api/auth/google/staff-email',
]);
const originalCreateServer = http.createServer.bind(http);

function loadStore() {
  try {
    return core.pruneStore(core.normalizeStore(JSON.parse(fs.readFileSync(AUTH_DATA_PATH, 'utf8'))));
  } catch (error) {
    if (error?.code === 'ENOENT') return core.emptyAuthStore();
    throw error;
  }
}

function saveStore(store) {
  const safe = core.pruneStore(core.normalizeStore(store));
  fs.mkdirSync(path.dirname(AUTH_DATA_PATH), { recursive: true });
  const tmp = `${AUTH_DATA_PATH}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(safe, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, AUTH_DATA_PATH);
}

function emailMap(store) {
  const result = new Map();
  for (const link of core.normalizeStore(store).links || []) {
    if (!link?.accountType || !link?.accountId) continue;
    result.set(`${link.accountType}:${link.accountId}`, core.normalizeEmail(link.email));
  }
  return result;
}

function supersedeChangedAccountRequests(beforeStore, afterStore) {
  const before = emailMap(beforeStore);
  const after = emailMap(afterStore);
  const changed = new Set();
  for (const [key, value] of after.entries()) {
    if ((before.get(key) || '') !== (value || '')) changed.add(key);
  }
  if (!changed.size) return false;
  const now = new Date().toISOString();
  let mutated = false;
  for (const request of afterStore.linkRequests || []) {
    if (request?.status !== 'pending') continue;
    const key = request?.studentId
      ? `student:${request.studentId}`
      : request?.staffId
        ? `staff:${request.staffId}`
        : '';
    if (!changed.has(key)) continue;
    request.status = 'superseded';
    request.updatedAt = now;
    mutated = true;
  }
  return mutated;
}

function watchResponse(res, beforeStore) {
  const originalEnd = res.end.bind(res);
  let processed = false;
  res.end = function linkConsistencyEnd(chunk, encoding, callback) {
    if (!processed) {
      processed = true;
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try {
          const latest = loadStore();
          if (supersedeChangedAccountRequests(beforeStore, latest)) saveStore(latest);
        } catch (error) {
          console.error('[Google link consistency]', error?.message || error);
        }
      }
    }
    return originalEnd(chunk, encoding, callback);
  };
}

function wrapRequestListener(listener) {
  return function linkConsistencyListener(req, res) {
    let pathname = '';
    try {
      pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
    } catch (error) {
      return listener(req, res);
    }
    if (String(req.method || '').toUpperCase() === 'POST' && WATCH_PATHS.has(pathname)) {
      watchResponse(res, loadStore());
    }
    return listener(req, res);
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
  __test: { supersedeChangedAccountRequests },
};
