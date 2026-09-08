'use strict';

const http = require('http');

const originalCreateServer = http.createServer.bind(http);
const preloadFlag = `--require=${__filename}`;
const nodeOptions = String(process.env.NODE_OPTIONS || '').trim();
if (!nodeOptions.includes(__filename)) {
  process.env.NODE_OPTIONS = [nodeOptions, preloadFlag].filter(Boolean).join(' ');
}

function wrapRequestListener(listener) {
  return function responseSafetyListener(req, res) {
    const originalRemoveHeader = res.removeHeader.bind(res);
    res.removeHeader = function safeRemoveHeader(name) {
      if (res.headersSent) return undefined;
      return originalRemoveHeader(name);
    };
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

module.exports = { wrapRequestListener };
