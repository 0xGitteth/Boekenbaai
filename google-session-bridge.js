'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const SESSION_DECLARATION = 'const sessions = new Map();';
const SESSION_REPLACEMENT = 'const sessions = globalThis.__BOEKENBAAI_SESSIONS;';

function installSessionBridge(options = {}) {
  const sessions = options.sessions || new Map();
  const target = path.resolve(
    options.target || process.env.BOEKENBAAI_SERVER_ENTRY || path.join(__dirname, 'server.js')
  );
  globalThis.__BOEKENBAAI_SESSIONS = sessions;

  const originalLoader = Module._extensions['.js'];
  let transformed = false;

  Module._extensions['.js'] = function boekenbaaiSessionLoader(module, filename) {
    if (path.resolve(filename) !== target) {
      return originalLoader(module, filename);
    }

    Module._extensions['.js'] = originalLoader;
    const source = fs.readFileSync(filename, 'utf8');
    const occurrences = source.split(SESSION_DECLARATION).length - 1;
    if (occurrences !== 1) {
      throw new Error(
        `Boekenbaai sessiebrug verwacht exact één sessiedeclaratie, maar vond er ${occurrences}.`
      );
    }
    transformed = true;
    return module._compile(source.replace(SESSION_DECLARATION, SESSION_REPLACEMENT), filename);
  };

  return {
    sessions,
    target,
    wasTransformed() {
      return transformed;
    },
    restore() {
      if (Module._extensions['.js'] !== originalLoader) {
        Module._extensions['.js'] = originalLoader;
      }
    },
  };
}

module.exports = {
  SESSION_DECLARATION,
  SESSION_REPLACEMENT,
  installSessionBridge,
};
