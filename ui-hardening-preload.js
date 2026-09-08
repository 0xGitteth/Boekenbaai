'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { URL } = require('url');

const SCRIPT_PATH = path.join(__dirname, 'public', 'release-ui-hardening.js');
const originalCreateServer = http.createServer.bind(http);

function serveScript(res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(fs.readFileSync(SCRIPT_PATH, 'utf8'));
}

function injectScript(req, res, listener) {
  const originalEnd = res.end.bind(res);
  res.end = function hardenedUiEnd(chunk, encoding, callback) {
    let enc = encoding;
    let cb = callback;
    if (typeof encoding === 'function') {
      cb = encoding;
      enc = undefined;
    }
    let nextChunk = chunk;
    const contentType = String(res.getHeader('Content-Type') || '').toLowerCase();
    if (chunk != null && (!contentType || contentType.includes('text/html'))) {
      let html = Buffer.isBuffer(chunk) ? chunk.toString(enc || 'utf8') : String(chunk);
      if (!html.includes('/release-ui-hardening.js')) {
        const tag = '<script src="/release-ui-hardening.js"></script>';
        if (html.includes('<script src="/admin-modern.js"></script>')) {
          html = html.replace('<script src="/admin-modern.js"></script>', `${tag}\n  <script src="/admin-modern.js"></script>`);
        } else {
          html = html.replace(/<\/body>/i, `  ${tag}\n</body>`);
        }
      }
      nextChunk = html;
      if (!res.headersSent) res.removeHeader('Content-Length');
    }
    if (enc !== undefined) return originalEnd(nextChunk, enc, cb);
    return originalEnd(nextChunk, cb);
  };
  return listener(req, res);
}

function wrapRequestListener(listener) {
  return function uiHardeningListener(req, res) {
    let requestUrl;
    try {
      requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch (error) {
      return listener(req, res);
    }
    if (req.method === 'GET' && requestUrl.pathname === '/release-ui-hardening.js') {
      return serveScript(res);
    }
    if (['/staff', '/staff.html'].includes(requestUrl.pathname)) {
      return injectScript(req, res, listener);
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
