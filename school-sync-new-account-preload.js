'use strict';

const syncCore = require('./school-sync-core');
const { applyPeopleImport } = require('./google-first-people-import');

const originalRunSchoolSync = syncCore.runSchoolSync;

function duplicateSourceIdentity(input = {}) {
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const seen = new Map();
  const kind = input.kind === 'teacher' ? 'teacher' : 'student';

  for (let index = 0; index < rows.length; index += 1) {
    const rawIdentity = kind === 'student'
      ? syncCore.studentNumberFromRow(rows[index])
      : syncCore.personNameFromRow(rows[index]);
    const identity = kind === 'student'
      ? String(rawIdentity || '').trim()
      : syncCore.normalizePersonName(rawIdentity);
    if (!identity) continue;
    if (seen.has(identity)) {
      return {
        kind,
        identity,
        firstRow: seen.get(identity) + 2,
        secondRow: index + 2,
        displayName: kind === 'teacher' ? String(rawIdentity || '').trim() : '',
      };
    }
    seen.set(identity, index);
  }
  return null;
}

function assertUniqueSourceIdentities(input = {}) {
  const duplicate = duplicateSourceIdentity(input);
  if (!duplicate) return;
  const error = new Error(
    duplicate.kind === 'student'
      ? `Het leerlingenbestand bevat leerlingnummer ${duplicate.identity} meerdere keren (regels ${duplicate.firstRow} en ${duplicate.secondRow}). Controleer de ParnasSys-export voordat je synchroniseert.`
      : `Het medewerkersbestand bevat ${duplicate.displayName || 'dezelfde medewerkernaam'} meerdere keren (regels ${duplicate.firstRow} en ${duplicate.secondRow}). Boekenbaai kan zonder personeelsnummer niet veilig bepalen of dit dezelfde persoon is. Controleer de ParnasSys-export.`
  );
  error.code = 'DUPLICATE_SOURCE_IDENTITY';
  error.duplicate = duplicate;
  throw error;
}

syncCore.runSchoolSync = function runSchoolSyncWithExplicitNewAccount(input = {}) {
  assertUniqueSourceIdentities(input);
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
    duplicateSourceIdentity,
    assertUniqueSourceIdentities,
  },
};
