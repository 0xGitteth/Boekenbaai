'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const SESSION_DECLARATION = 'const sessions = new Map();';
const SESSION_REPLACEMENT = 'const sessions = globalThis.__BOEKENBAAI_SESSIONS;';
const GLOBAL_SESSION_KEY = '__BOEKENBAAI_SESSIONS';

function installSessionBridge(options = {}) {
  const sessions = options.sessions || new Map();
  const target = path.resolve(
    options.target || process.env.BOEKENBAAI_SERVER_ENTRY || path.join(__dirname, 'server.js')
  );
  if (Object.prototype.hasOwnProperty.call(globalThis, GLOBAL_SESSION_KEY)) {
    throw new Error('Boekenbaai sessiebrug is al geïnstalleerd.');
  }
  globalThis[GLOBAL_SESSION_KEY] = sessions;

  const originalLoader = Module._extensions['.js'];
  let transformed = false;
  let restored = false;

  function restoreLoader() {
    if (!restored && Module._extensions['.js'] !== originalLoader) {
      Module._extensions['.js'] = originalLoader;
    }
    restored = true;
  }

  function clearGlobalReference() {
    if (globalThis[GLOBAL_SESSION_KEY] === sessions) {
      delete globalThis[GLOBAL_SESSION_KEY];
    }
  }

  Module._extensions['.js'] = function boekenbaaiSessionLoader(module, filename) {
    if (path.resolve(filename) !== target) {
      return originalLoader(module, filename);
    }

    restoreLoader();
    const source = fs.readFileSync(filename, 'utf8');
    const occurrences = source.split(SESSION_DECLARATION).length - 1;
    if (occurrences !== 1) {
      clearGlobalReference();
      throw new Error(
        `Boekenbaai sessiebrug verwacht exact één sessiedeclaratie, maar vond er ${occurrences}.`
      );
    }

    transformed = true;
    try {
      return module._compile(source.replace(SESSION_DECLARATION, SESSION_REPLACEMENT), filename);
    } finally {
      clearGlobalReference();
    }
  };

  return {
    sessions,
    target,
    wasTransformed() {
      return transformed;
    },
    restore() {
      restoreLoader();
      clearGlobalReference();
    },
  };
}

module.exports = {
  SESSION_DECLARATION,
  SESSION_REPLACEMENT,
  installSessionBridge,
};
