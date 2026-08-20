'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');

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
const GOOGLE_DOMAIN = normalizeDomain(process.env.BOEKENBAAI_GOOGLE_DOMAIN || 'koraaledu.nl');
const AUTH_SECRET = process.env.BOEKENBAAI_AUTH_SECRET || GOOGLE_CLIENT_SECRET || '';
const CONFIGURED_PUBLIC_URL = String(process.env.BOEKENBAAI_PUBLIC_URL || '').replace(/\/$/, '');
const CONFIGURED_REDIRECT_URI = String(process.env.BOEKENBAAI_GOOGLE_REDIRECT_URI || '').trim();
const OAUTH_NONCE_COOKIE = 'boekenbaai_oauth_nonce';

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeDomain(value) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/^@/, '')
    : '';
}

function normalizeName(value) {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('nl-NL')
    : '';
}

function isAllowedSchoolEmail(email) {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf('@');
  return at > 0 && normalized.slice(at + 1) === GOOGLE_DOMAIN;
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function findLoginHint(type, enteredName) {
  const wanted = normalizeName(enteredName);
  if (!wanted) return '';

  const db = readJson(DATA_PATH, {});
  const accountType = type === 'staff' ? 'staff' : 'student';
  const candidates = type === 'staff'
    ? (Array.isArray(db.users) ? db.users : []).filter((entry) =>
        ['teacher', 'admin'].includes(entry?.role) &&
        (normalizeName(entry?.name) === wanted || normalizeName(entry?.username) === wanted)
      )
    : (Array.isArray(db.students) ? db.students : []).filter((entry) =>
        normalizeName(entry?.name) === wanted || normalizeName(entry?.username) === wanted
      );

  if (candidates.length !== 1 || !candidates[0]?.id) return '';

  const store = readJson(AUTH_DATA_PATH, {});
  const links = Array.isArray(store.links) ? store.links : [];
  const link = links.find(
    (entry) => entry?.accountType === accountType && entry?.accountId === candidates[0].id
  );
  const email = normalizeEmail(link?.email);
  return isAllowedSchoolEmail(email) ? email : '';
}

function isHttpsRequest(req) {
  const forwarded = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (forwarded) return forwarded === 'https';
  return Boolean(req.socket?.encrypted);
}

function getBaseUrl(req) {
  if (CONFIGURED_PUBLIC_URL) return CONFIGURED_PUBLIC_URL;
  const host = req.headers.host || 'localhost';
  const protocol = isHttpsRequest(req) ? 'https' : 'http';
  return `${protocol}://${host}`;
}

function getRedirectUri(req) {
  return CONFIGURED_REDIRECT_URI || `${getBaseUrl(req)}/api/auth/google/callback`;
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

function createSignedState(payload) {
  const encoded = Buffer.from(JSON.stringify(payload || {})).toString('base64url');
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function handleGoogleStart(req, res, requestUrl) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !AUTH_SECRET || !GOOGLE_DOMAIN) {
    return false;
  }

  const type = requestUrl.searchParams.get('type') === 'staff' ? 'staff' : 'student';
  const remember = type === 'staff' && requestUrl.searchParams.get('remember') === '1';
  const enteredName = requestUrl.searchParams.get('name') || '';
  const loginHint = findLoginHint(type, enteredName);
  const nonce = crypto.randomBytes(20).toString('base64url');
  const state = createSignedState({ type, remember, nonce, iat: Date.now() });

  res.setHeader(
    'Set-Cookie',
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
  if (loginHint) {
    authorize.searchParams.set('login_hint', loginHint);
  } else {
    authorize.searchParams.set('prompt', 'select_account');
  }

  res.statusCode = 302;
  res.setHeader('Location', authorize.toString());
  res.setHeader('Cache-Control', 'no-store');
  res.end();
  return true;
}

function injectHintScript(req, res, listener) {
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

http.createServer = function patchedCreateServer(...args) {
  const listenerIndex = typeof args[0] === 'function' ? 0 : 1;
  const listener = args[listenerIndex];
  if (typeof listener !== 'function') return originalCreateServer(...args);

  const wrapped = function googleLoginHintListener(req, res) {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (
      req.method === 'GET' &&
      requestUrl.pathname === '/api/auth/google/start' &&
      handleGoogleStart(req, res, requestUrl)
    ) {
      return;
    }
    return injectHintScript(req, res, listener);
  };

  const nextArgs = [...args];
  nextArgs[listenerIndex] = wrapped;
  return originalCreateServer(...nextArgs);
};

module.exports = {
  __test: {
    findLoginHint,
  },
};
