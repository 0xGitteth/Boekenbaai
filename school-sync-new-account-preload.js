'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const syncCore = require('./school-sync-core');
const { applyPeopleImport } = require('./google-first-people-import');

const originalRunSchoolSync = syncCore.runSchoolSync;
const originalCreateServer = http.createServer.bind(http);
const PUBLIC_SYNC_SCRIPT = path.join(__dirname, 'public', 'school-sync-finalize.js');

syncCore.runSchoolSync = function runSchoolSyncWithExplicitNewAccount(input = {}) {
  if (input.kind !== 'student') return originalRunSchoolSync(input);
  const manualMatches = input.manualMatches && typeof input.manualMatches === 'object'
    ? input.manualMatches
    : {};
  const createNewNumbers = new Set(
    Object.entries(manualMatches)
      .filter(([, value]) => value === '__new__')
      .map(([number]) => String(number || '').trim())
      .filter(Boolean)
  );
  if (!createNewNumbers.size) return originalRunSchoolSync(input);

  const normalRows = [];
  const createRows = [];
  for (const row of Array.isArray(input.rows) ? input.rows : []) {
    const number = syncCore.studentNumberFromRow(row);
    if (number && createNewNumbers.has(number)) createRows.push(row);
    else normalRows.push(row);
  }
  const normalMatches = { ...manualMatches };
  for (const number of createNewNumbers) delete normalMatches[number];

  const result = originalRunSchoolSync({
    ...input,
    rows: normalRows,
    manualMatches: normalMatches,
  });
  if (!createRows.length) return result;

  const imported = applyPeopleImport({
    kind: 'student',
    rows: createRows,
    db: result.db,
    store: result.store,
    domain: input.domain,
    actorId: input.actorId,
  });
  result.db = imported.db;
  result.store = imported.store;
  result.results.push(...imported.results);
  result.summary.newClasses = (result.summary.newClasses || 0) + (imported.summary.newClasses || 0);
  result.summary.studentNumbersStored =
    (result.summary.studentNumbersStored || 0) + (imported.summary.studentNumbersStored || 0);
  result.summary.created = result.results.filter((entry) => entry?.status === 'created').length;
  result.summary.updated = result.results.filter((entry) => entry?.status === 'updated').length;
  result.summary.unchanged = result.results.filter((entry) => entry?.status === 'unchanged').length;
  result.summary.needsReview = result.results.filter((entry) => entry?.status === 'needs-review').length;
  return result;
};

const EXTRA_UI = `
;(() => {
  'use strict';
  function addNewAccountChoice() {
    document.querySelectorAll('.school-sync__review-row select').forEach((select) => {
      if (Array.from(select.options).some((option) => option.value === '__new__')) return;
      select.append(new Option('Geen match, maak een nieuw leerlingaccount', '__new__'));
    });
  }
  function install() {
    addNewAccountChoice();
    const observer = new MutationObserver(addNewAccountChoice);
    observer.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
`;

function sendSyncScript(res) {
  const source = fs.readFileSync(PUBLIC_SYNC_SCRIPT, 'utf8');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(`${source}\n${EXTRA_UI}`);
}

function wrapRequestListener(listener) {
  return function schoolSyncNewAccountListener(req, res) {
    let pathname = '';
    try {
      pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
    } catch (error) {
      return listener(req, res);
    }
    if (req.method === 'GET' && pathname === '/school-sync-finalize.js') {
      return sendSyncScript(res);
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
  __test: {
    createNewValue: '__new__',
  },
};
