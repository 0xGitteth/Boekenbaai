'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { URL } = require('url');

const SCRIPT_PATH = path.join(__dirname, 'public', 'schoolmail-domain-helper.js');
const SCRIPT_URL = '/schoolmail-domain-helper.js';
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
  res.end = function schoolmailDomainHtmlEnd(chunk, encoding, callback) {
    let nextChunk = chunk;
    const actualEncoding = typeof encoding === 'string' ? encoding : undefined;
    const actualCallback = typeof encoding === 'function' ? encoding : callback;
    const contentType = String(res.getHeader('Content-Type') || '').toLowerCase();

    if (chunk != null && (!contentType || contentType.includes('text/html'))) {
      let html = Buffer.isBuffer(chunk) ? chunk.toString(actualEncoding || 'utf8') : String(chunk);
      if (!html.includes(SCRIPT_URL)) {
        html = html.replace(/<\/body>/i, `    <script src="${SCRIPT_URL}"></script>\n  </body>`);
        nextChunk = html;
        if (!res.headersSent) res.removeHeader('Content-Length');
      }
    }

    return originalEnd(nextChunk, actualEncoding, actualCallback);
  };
  return listener(req, res);
}

function wrapListener(listener) {
  return function schoolmailDomainListener(req, res) {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && requestUrl.pathname === SCRIPT_URL) {
      return serveScript(res);
    }

    if (!requestUrl.pathname.startsWith('/api/')) {
      return injectScript(req, res, listener);
    }
    return listener(req, res);
  };
}

http.createServer = function patchedCreateServer(...args) {
  const listenerIndex = typeof args[0] === 'function' ? 0 : 1;
  const listener = args[listenerIndex];
  if (typeof listener !== 'function') return originalCreateServer(...args);
  const wrapped = wrapListener(listener);
  if (listenerIndex === 0) return originalCreateServer(wrapped);
  return originalCreateServer(args[0], wrapped);
};

module.exports = { __test: { SCRIPT_URL } };
