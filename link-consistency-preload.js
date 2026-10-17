'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const core = require('./google-auth-core');
const { readJsonSnapshot, mutateJsonLocked } = require('./database-write-coordinator');

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

function loadStore(authPath = AUTH_DATA_PATH) {
  const raw = readJsonSnapshot(authPath, { missingValue: core.emptyAuthStore() });
  return core.pruneStore(core.normalizeStore(raw));
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

// The change of a Google address is already committed by the handler.
// Re-read current pending requests under the shared lock so another session
// update cannot make this mandatory supersession silently fail as stale.
function reconcileLinkRequests(beforeStore, { dataPath = DATA_PATH,
  authPath = AUTH_DATA_PATH } = {}) {
  return mutateJsonLocked({
    lockPath: dataPath, filePath: authPath,
    read: () => loadStore(authPath),
    mutate: latest => {
      if (!supersedeChangedAccountRequests(beforeStore, latest)) return false;
      return core.pruneStore(core.normalizeStore(latest));
    },
  });
}


function wrapRequestListener(listener) {
  return function linkConsistencyListener(req, res) {
    let pathname = '';
    try {
      pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
    } catch (error) {
      return listener(req, res);
    }
    // Pending requests are now superseded within the link-update commit.
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
  __test: { supersedeChangedAccountRequests, reconcileLinkRequests },
};
