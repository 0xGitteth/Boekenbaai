'use strict';

const syncCore = require('./school-sync-core');
const { applyPeopleImport } = require('./google-first-people-import');

const originalRunSchoolSync = syncCore.runSchoolSync;

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

module.exports = {
  __test: {
    createNewValue: '__new__',
  },
};
