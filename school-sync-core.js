'use strict';

const {
  applyPeopleImport,
  normalizeKey,
  normalizeRow,
  extractName,
  extractClassNames,
  getParnassysStudentNumber,
  setParnassysStudentNumber,
} = require('./google-first-people-import');

function clean(value) {
  return String(value || '').trim();
}

function normalizePersonName(value) {
  return clean(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('nl-NL')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizedRowValue(row, keys) {
  const normalized = normalizeRow(row);
  for (const key of keys) {
    const value = clean(normalized[normalizeKey(key)]);
    if (value) return value;
  }
  return '';
}

function normalizedRowHasKey(row, keys) {
  const normalized = normalizeRow(row);
  return keys.some((key) => Object.prototype.hasOwnProperty.call(normalized, normalizeKey(key)));
}

function studentNumberFromRow(row) {
  return normalizedRowValue(row, [
    'Leerlingnummer',
    'Leerling nummer',
    'Leerlingnr',
    'Studentnummer',
  ]);
}

function personNameFromRow(row) {
  return extractName(normalizeRow(row)).fullName;
}

function classNamesFromRow(row) {
  return extractClassNames(normalizeRow(row));
}

function validateSchoolSyncRows(kind, rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  const hasStudentNumber = rows.some((row) => normalizedRowHasKey(row, [
    'Leerlingnummer',
    'Leerling nummer',
    'Leerlingnr',
    'Studentnummer',
  ]));
  const hasCurrentGroup = rows.some((row) => normalizedRowHasKey(row, [
    'Huidige groep',
    'Huidigegroep',
  ]));
  const hasLinkedGroups = rows.some((row) => normalizedRowHasKey(row, [
    'Gekoppelde groepen',
  ]));

  if (kind === 'student') {
    if (hasLinkedGroups && !(hasStudentNumber && hasCurrentGroup)) {
      const error = new Error('Dit lijkt een ParnasSys-medewerkersbestand. Upload hier de leerlingenexport met Leerlingnummer en Huidige groep.');
      error.code = 'WRONG_PARNASSYS_EXPORT';
      throw error;
    }
    if (!hasStudentNumber || !hasCurrentGroup) {
      const error = new Error('Dit bestand wordt niet herkend als ParnasSys-leerlingenexport. Verwachte kolommen zijn onder andere Leerlingnummer en Huidige groep.');
      error.code = 'UNKNOWN_PARNASSYS_EXPORT';
      throw error;
    }
    return;
  }

  if (hasStudentNumber && !hasLinkedGroups) {
    const error = new Error('Dit lijkt een ParnasSys-leerlingenbestand. Upload hier de medewerkersexport met Gekoppelde groepen.');
    error.code = 'WRONG_PARNASSYS_EXPORT';
    throw error;
  }
  if (!hasLinkedGroups || hasStudentNumber) {
    const error = new Error('Dit bestand wordt niet herkend als ParnasSys-medewerkersexport. De kolom Gekoppelde groepen is vereist.');
    error.code = 'UNKNOWN_PARNASSYS_EXPORT';
    throw error;
  }
}

function personParts(value) {
  const parts = normalizePersonName(value).split(' ').filter(Boolean);
  return {
    first: parts[0] || '',
    last: parts.length > 1 ? parts[parts.length - 1] : parts[0] || '',
    full: parts.join(' '),
  };
}

function editDistance(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const old = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diagonal = old;
    }
  }
  return previous[b.length];
}

function namesAreClose(left, right) {
  const a = personParts(left);
  const b = personParts(right);
  if (!a.full || !b.full) return false;
  if (a.full === b.full) return true;
  const firstDistance = editDistance(a.first, b.first);
  const lastDistance = editDistance(a.last, b.last);
  const firstClose = firstDistance <= (Math.max(a.first.length, b.first.length) >= 8 ? 2 : 1);
  const lastClose = lastDistance <= (Math.max(a.last.length, b.last.length) >= 8 ? 2 : 1);
  return (a.last === b.last && firstClose) || (a.first === b.first && lastClose);
}

function studentClassIds(db, student) {
  const ids = new Set(Array.isArray(student?.classIds) ? student.classIds.filter(Boolean) : []);
  for (const klass of db.classes || []) {
    if (Array.isArray(klass?.studentIds) && klass.studentIds.includes(student?.id)) ids.add(klass.id);
  }
  return Array.from(ids);
}

function studentClassNames(db, student) {
  const ids = new Set(studentClassIds(db, student));
  return (db.classes || [])
    .filter((klass) => ids.has(klass.id))
    .map((klass) => clean(klass?.name))
    .filter(Boolean);
}

function sameClass(left, right) {
  const wanted = new Set((right || []).map(normalizePersonName).filter(Boolean));
  return (left || []).some((entry) => wanted.has(normalizePersonName(entry)));
}

function fuzzyManualCandidates(db, name, targetClasses = []) {
  const exact = normalizePersonName(name);
  const candidates = (db.students || [])
    .filter((student) => student?.id && student?.active !== false && !getParnassysStudentNumber(student))
    .filter((student) => normalizePersonName(student?.name) !== exact)
    .filter((student) => namesAreClose(student?.name, name))
    .map((student) => ({
      id: student.id,
      name: student.name || '',
      classNames: studentClassNames(db, student),
    }))
    .sort((left, right) => {
      const leftSame = sameClass(left.classNames, targetClasses) ? 1 : 0;
      const rightSame = sameClass(right.classNames, targetClasses) ? 1 : 0;
      if (leftSame !== rightSame) return rightSame - leftSame;
      return left.name.localeCompare(right.name, 'nl');
    });
  return candidates.slice(0, 5);
}

function findUniqueExactStudent(db, name) {
  const wanted = normalizePersonName(name);
  if (!wanted) return null;
  const matches = (db.students || []).filter(
    (student) => student?.active !== false && normalizePersonName(student?.name) === wanted
  );
  return matches.length === 1 ? matches[0] : null;
}

function activeBorrowedBooks(db, student) {
  const ids = new Set(Array.isArray(student?.borrowedBooks) ? student.borrowedBooks.filter(Boolean) : []);
  return (db.books || []).filter(
    (book) => ids.has(book?.id) || (book?.status === 'borrowed' && book?.borrowedBy === student?.id)
  );
}

function removeStudentFromClasses(db, studentId) {
  for (const klass of db.classes || []) {
    klass.studentIds = Array.isArray(klass?.studentIds) ? klass.studentIds : [];
    klass.studentIds = klass.studentIds.filter((id) => id !== studentId);
  }
  const student = (db.students || []).find((entry) => entry?.id === studentId);
  if (student) student.classIds = [];
}

function removeTeacherFromClasses(db, teacherId) {
  for (const klass of db.classes || []) {
    klass.teacherIds = Array.isArray(klass?.teacherIds) ? klass.teacherIds : [];
    klass.teacherIds = klass.teacherIds.filter((id) => id !== teacherId);
  }
  const teacher = (db.users || []).find((entry) => entry?.id === teacherId);
  if (teacher) teacher.classIds = [];
}

function revokeAccountSessions(store, accountType, accountId) {
  const type = accountType === 'staff' ? 'staff' : 'student';
  store.sessions = (store.sessions || []).filter(
    (entry) => !(entry?.type === type && entry?.userId === accountId)
  );
}

function deactivateStudent(db, store, student, actorId, reason) {
  const now = new Date().toISOString();
  student.active = false;
  student.inactiveAt = now;
  student.inactiveReason = reason || 'not-in-school-sync';
  student.inactiveBy = actorId || 'school-sync';
  removeStudentFromClasses(db, student.id);
  revokeAccountSessions(store, 'student', student.id);
  for (const request of store.linkRequests || []) {
    if (request?.studentId === student.id && request?.status === 'pending') {
      request.status = 'superseded';
      request.updatedAt = now;
    }
  }
  for (const transfer of db.studentTransferRequests || []) {
    if (transfer?.studentId === student.id && ['pending', 'rejected'].includes(transfer?.status)) {
      transfer.status = 'cancelled';
      transfer.escalatedToAdmin = false;
      transfer.updatedAt = now;
    }
  }
}

function deactivateTeacher(db, store, teacher, actorId, reason) {
  const now = new Date().toISOString();
  teacher.active = false;
  teacher.inactiveAt = now;
  teacher.inactiveReason = reason || 'no-linked-groups';
  teacher.inactiveBy = actorId || 'school-sync';
  removeTeacherFromClasses(db, teacher.id);
  revokeAccountSessions(store, 'staff', teacher.id);
  for (const request of store.linkRequests || []) {
    if (request?.staffId === teacher.id && request?.status === 'pending') {
      request.status = 'superseded';
      request.updatedAt = now;
    }
  }
}

function recomputeResultCounts(result) {
  const statuses = (result.results || []).map((entry) => entry?.status);
  result.summary.created = statuses.filter((status) => status === 'created').length;
  result.summary.updated = statuses.filter((status) => status === 'updated').length;
  result.summary.unchanged = statuses.filter((status) => status === 'unchanged').length;
}

function prepareStudentRows(db, rows, manualMatches = {}) {
  const prepared = [];
  const reviews = [];
  const incomingNumbers = new Set();

  rows.forEach((row, index) => {
    const studentNumber = studentNumberFromRow(row);
    const name = personNameFromRow(row);
    const classes = classNamesFromRow(row);
    if (studentNumber) incomingNumbers.add(studentNumber);

    const existingByNumber = studentNumber
      ? (db.students || []).find((student) => getParnassysStudentNumber(student) === studentNumber)
      : null;
    if (!studentNumber || existingByNumber || findUniqueExactStudent(db, name)) {
      prepared.push(row);
      return;
    }

    const candidates = fuzzyManualCandidates(db, name, classes);
    const forcedId = clean(manualMatches?.[studentNumber]);
    if (forcedId) {
      const forced = (db.students || []).find(
        (student) => student?.id === forcedId && student?.active !== false
      );
      const allowed = candidates.some((candidate) => candidate.id === forcedId);
      if (forced && allowed && !getParnassysStudentNumber(forced)) {
        setParnassysStudentNumber(forced, studentNumber);
        prepared.push(row);
        return;
      }
    }

    if (candidates.length) {
      reviews.push({
        row: index + 2,
        status: 'needs-review',
        name,
        studentNumber,
        classes,
        reason: 'Mogelijk dezelfde leerling als een handmatig toegevoegd account.',
        candidates,
      });
      return;
    }

    prepared.push(row);
  });

  return { prepared, reviews, incomingNumbers };
}

function largeRemovalThreshold(activeCount) {
  return Math.max(10, Math.ceil(Math.max(0, activeCount) * 0.2));
}

function largeTeacherRemovalThreshold(activeCount) {
  return Math.max(3, Math.ceil(Math.max(0, activeCount) * 0.2));
}

function processMissingStudents(result, originalDb, incomingNumbers, options) {
  const activeNumberedBefore = (originalDb.students || []).filter(
    (student) => student?.active !== false && getParnassysStudentNumber(student)
  );
  const missingNumbers = new Set(
    activeNumberedBefore
      .map((student) => getParnassysStudentNumber(student))
      .filter((number) => number && !incomingNumbers.has(number))
  );
  const missing = (result.db.students || []).filter(
    (student) => student?.active !== false && missingNumbers.has(getParnassysStudentNumber(student))
  );

  result.summary.missingFromImport = options.fullSchoolSync ? missing.length : 0;
  result.summary.largeRemovalWarning = Boolean(
    options.fullSchoolSync && missing.length >= largeRemovalThreshold(activeNumberedBefore.length)
  );
  result.summary.deactivated = 0;
  result.summary.deactivationBlockedBorrowed = 0;

  if (!options.fullSchoolSync) return;

  for (const student of missing) {
    const borrowed = activeBorrowedBooks(result.db, student);
    if (options.applyDeactivations && borrowed.length) {
      result.summary.deactivationBlockedBorrowed += 1;
      result.results.push({
        status: 'deactivation-blocked',
        id: student.id,
        name: student.name || '',
        studentNumber: getParnassysStudentNumber(student),
        reason: 'Niet in de schoollijst, maar heeft nog boeken in bezit.',
        borrowedBooks: borrowed.map((book) => ({ id: book.id, title: book.title || 'Onbekend boek' })),
      });
      continue;
    }

    if (options.applyDeactivations) {
      deactivateStudent(result.db, result.store, student, options.actorId, 'not-in-parnassys-school-list');
      result.summary.deactivated += 1;
    }
    result.results.push({
      status: options.applyDeactivations ? 'deactivated' : 'missing-from-import',
      id: student.id,
      name: student.name || '',
      studentNumber: getParnassysStudentNumber(student),
      reason: options.applyDeactivations
        ? 'Niet meer in de volledige ParnasSys-schoollijst en daarom inactief gemaakt.'
        : 'Staat niet in deze volledige ParnasSys-schoollijst.',
    });
  }
}

function findTeacherByExactName(db, name) {
  const wanted = normalizePersonName(name);
  const matches = (db.users || []).filter(
    (user) => user?.role === 'teacher' && normalizePersonName(user?.name) === wanted
  );
  return matches.length === 1 ? matches[0] : null;
}

function processTeacherDeactivations(result, originalDb, rows, options, incomingTeacherIds = new Set()) {
  const incomingNames = new Set();
  const explicitNoGroups = [];
  for (const row of rows) {
    const name = personNameFromRow(row);
    if (name) incomingNames.add(normalizePersonName(name));
    if (name && classNamesFromRow(row).length === 0) explicitNoGroups.push(name);
  }

  const explicitIds = new Set();
  for (const name of explicitNoGroups) {
    const teacher = findTeacherByExactName(result.db, name);
    if (teacher && teacher.active !== false && teacher.source === 'parnassys') {
      explicitIds.add(teacher.id);
    }
  }

  const missingIds = new Set();
  const activeParnassysBefore = (originalDb.users || []).filter(
    (teacher) =>
      teacher?.role === 'teacher' &&
      teacher?.active !== false &&
      teacher?.source === 'parnassys'
  );
  if (options.fullSchoolSync) {
    for (const teacher of activeParnassysBefore) {
      if (
        !incomingTeacherIds.has(teacher.id) &&
        !incomingNames.has(normalizePersonName(teacher?.name))
      ) {
        missingIds.add(teacher.id);
      }
    }
  }

  const ids = new Set([...explicitIds, ...missingIds]);
  result.summary.teachersWithoutGroups = explicitIds.size;
  result.summary.missingTeachersFromImport = options.fullSchoolSync ? missingIds.size : 0;
  result.summary.largeRemovalWarning = Boolean(
    options.fullSchoolSync &&
    missingIds.size >= largeTeacherRemovalThreshold(activeParnassysBefore.length)
  );
  result.summary.deactivated = result.summary.deactivated || 0;

  for (const id of ids) {
    const teacher = (result.db.users || []).find((entry) => entry?.id === id && entry?.role === 'teacher');
    if (!teacher || teacher.active === false) continue;
    const missingFromImport = missingIds.has(id);
    const inactiveReason = missingFromImport
      ? 'not-in-parnassys-school-list'
      : 'no-linked-parnassys-groups';
    if (options.applyDeactivations) {
      deactivateTeacher(result.db, result.store, teacher, options.actorId, inactiveReason);
      result.summary.deactivated += 1;
    }
    result.results.push({
      status: options.applyDeactivations ? 'deactivated' : 'would-deactivate',
      id: teacher.id,
      name: teacher.name || '',
      reason: missingFromImport
        ? options.applyDeactivations
          ? 'Niet meer in de volledige ParnasSys-medewerkerslijst en daarom inactief gemaakt.'
          : 'Staat niet in deze volledige ParnasSys-medewerkerslijst.'
        : options.applyDeactivations
          ? 'Geen gekoppelde ParnasSys-groep; docentaccount is inactief gemaakt.'
          : 'Geen gekoppelde ParnasSys-groep; dit docentaccount wordt bij synchroniseren inactief.',
    });
  }
}

function runSchoolSync(input = {}) {
  const kind = input.kind === 'teacher' ? 'teacher' : 'student';
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const db = input.db && typeof input.db === 'object' ? input.db : {};
  const store = input.store && typeof input.store === 'object' ? input.store : {};
  const originalDb = JSON.parse(JSON.stringify(db));
  const options = {
    fullSchoolSync: Boolean(input.fullSchoolSync),
    applyDeactivations: Boolean(input.applyDeactivations),
    actorId: clean(input.actorId),
  };

  validateSchoolSyncRows(kind, rows);

  let preparedRows = rows;
  let reviews = [];
  let incomingNumbers = new Set();
  if (kind === 'student') {
    const prepared = prepareStudentRows(db, rows, input.manualMatches || {});
    preparedRows = prepared.prepared;
    reviews = prepared.reviews;
    incomingNumbers = prepared.incomingNumbers;
  }

  const result = applyPeopleImport({
    kind,
    rows: preparedRows,
    db,
    store,
    domain: input.domain,
    actorId: input.actorId,
  });
  recomputeResultCounts(result);
  result.summary.needsReview = reviews.length;
  result.results.push(...reviews);

  if (kind === 'student') {
    processMissingStudents(result, originalDb, incomingNumbers, options);
  } else {
    const incomingTeacherIds = new Set(
      (result.results || [])
        .filter((entry) => entry?.id && ['created', 'updated', 'unchanged'].includes(entry?.status))
        .map((entry) => entry.id)
    );
    processTeacherDeactivations(result, originalDb, rows, options, incomingTeacherIds);
  }

  return result;
}

module.exports = {
  normalizePersonName,
  editDistance,
  namesAreClose,
  fuzzyManualCandidates,
  studentNumberFromRow,
  personNameFromRow,
  classNamesFromRow,
  activeBorrowedBooks,
  validateSchoolSyncRows,
  runSchoolSync,
};