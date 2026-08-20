'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');

const DEFAULT_DATA_PATH = path.join(__dirname, 'data', 'db.json');
const DATA_PATH = process.env.BOEKENBAAI_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_DATA_PATH)
  : DEFAULT_DATA_PATH;
const AUTH_DATA_PATH = process.env.BOEKENBAAI_AUTH_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_AUTH_DATA_PATH)
  : `${DATA_PATH}.auth.json`;

const originalCreateServer = http.createServer.bind(http);

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

function readDatabase() {
  const raw = fs.readFileSync(DATA_PATH, 'utf8');
  const db = JSON.parse(raw);
  if (!db || typeof db !== 'object' || Array.isArray(db)) {
    throw new Error('Boekenbaai database heeft een ongeldig formaat.');
  }
  if (!Array.isArray(db.users)) db.users = [];
  if (!Array.isArray(db.students)) db.students = [];
  return db;
}

function getSelectedAccount(db, type, accountId) {
  const id = String(accountId || '').trim();
  if (!id) return null;
  if (type === 'student') {
    const account = db.students.find((entry) => entry?.id === id);
    return account ? { id: account.id, role: 'student', authMode: 'google' } : null;
  }
  const account = db.users.find(
    (entry) => entry?.id === id && ['teacher', 'admin'].includes(entry?.role)
  );
  if (!account) return null;
  return {
    id: account.id,
    role: account.role,
    authMode: account.role === 'admin' ? 'password' : 'google',
  };
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, filePath);
}

function removeAdminGoogleLinks() {
  let raw;
  try {
    raw = fs.readFileSync(AUTH_DATA_PATH, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  const store = JSON.parse(raw);
  if (!store || typeof store !== 'object' || Array.isArray(store)) {
    throw new Error('Auth-opslag heeft een ongeldig formaat.');
  }
  if (!Array.isArray(store.links)) return;

  const db = readDatabase();
  const adminIds = new Set(
    db.users.filter((entry) => entry?.role === 'admin' && entry?.id).map((entry) => entry.id)
  );
  if (!adminIds.size) return;

  const before = store.links.length;
  store.links = store.links.filter(
    (link) => !(link?.accountType === 'staff' && adminIds.has(link?.accountId))
  );
  if (store.links.length !== before) {
    writeJsonAtomic(AUTH_DATA_PATH, store);
  }
}

function modeErrorRedirect(type, code) {
  const page = type === 'staff' ? '/staff.html' : '/index.html';
  return `${page}?googleAuth=${encodeURIComponent(code)}`;
}

function wrapRequestListener(listener) {
  return function loginFlowPolicyListener(req, res) {
    let requestUrl;
    try {
      requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch (error) {
      return listener(req, res);
    }

    try {
      if (req.method === 'GET' && requestUrl.pathname === '/api/auth/login-mode') {
        const type = requestUrl.searchParams.get('type') === 'staff' ? 'staff' : 'student';
        const accountId = requestUrl.searchParams.get('accountId') || '';
        const account = getSelectedAccount(readDatabase(), type, accountId);
        if (!account) {
          return sendJson(res, 404, { message: 'Kies een geldig account uit de lijst.' });
        }
        return sendJson(res, 200, {
          accountId: account.id,
          authMode: account.authMode,
        });
      }

      if (req.method === 'GET' && requestUrl.pathname === '/api/auth/google/start') {
        const type = requestUrl.searchParams.get('type') === 'staff' ? 'staff' : 'student';
        const accountId = requestUrl.searchParams.get('accountId') || '';
        const account = getSelectedAccount(readDatabase(), type, accountId);
        if (!account) {
          return redirect(res, modeErrorRedirect(type, 'select-account'));
        }
        if (account.authMode !== 'google') {
          return redirect(res, modeErrorRedirect(type, 'local-only'));
        }
        return listener(req, res);
      }

      if (req.method === 'GET' && requestUrl.pathname === '/api/auth/google/callback') {
        // Beheeraccounts zijn bewust lokale nood-/overdrachtsaccounts. Verwijder
        // eventuele oude of per ongeluk aangemaakte Google-links voordat de
        // Google-runtime een identiteit kan omzetten naar een medewerkerssessie.
        removeAdminGoogleLinks();
      }

      return listener(req, res);
    } catch (error) {
      console.error('[Login policy] Interne fout:', error?.message || error);
      if (!res.headersSent && !res.writableEnded) {
        return sendJson(res, 500, { message: 'Inlogbeleid kon niet worden gecontroleerd.' });
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
    readDatabase,
    getSelectedAccount,
    removeAdminGoogleLinks,
  },
};
