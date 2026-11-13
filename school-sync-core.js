'use strict';

const crypto = require('node:crypto');
const authCore = require('./google-auth-core');
const {
  applyPeopleImport,
  normalizeKey,
  normalizeRow,
  extractName,
  extractClassNames,
  getParnassysStudentNumber,
  setParnassysStudentNumber,
} = require('./google-first-people-import');
const { transitionMissingStudent, cancelReturnedStudents } =
  require('./student-exit-workflow');
const { transitionMissingTeacher, cancelReturnedTeachers } =
  require('./teacher-exit-workflow');

function clean(value) {
  return String(value || '').trim();
}

function normalizePersonName(value) {
  return clean(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('nl-NL')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
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

function prepareStudentRows(db, rows, manualMatches = {}, store = {}) {
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
    if (!studentNumber || existingByNumber) {
      prepared.push(row);
      return;
    }

    const exact = (db.students || []).filter(student =>
      student?.id && student.active !== false &&
      normalizePersonName(student.name) === normalizePersonName(name));
    if (exact.length === 1) {
      // The importer gives verified schoolmail/username matches precedence
      // over name. Never pre-bind an account if either explicit identity
      // points elsewhere, as that would override the stronger identifier.
      const sourceUsername=normalizedRowValue(row,
        ['gebruikersnaam','username','user','login']).toLowerCase();
      const sourceEmail=authCore.normalizeEmail(normalizedRowValue(row,
        ['schoolmail','schoolmailadres','school e-mail','schoolemail','email',
          'e-mail','e-mailadres','emailadres','googleemail']));
      const byUsername=sourceUsername ? (db.students||[]).find(student=>
        String(student?.username||'').trim().toLowerCase()===sourceUsername) : null;
      const link=sourceEmail ? (authCore.normalizeStore(store).links||[]).find(entry=>
        entry?.accountType==='student' &&
        authCore.normalizeEmail(entry?.email)===sourceEmail) : null;
      const byEmail=link ? (db.students||[]).find(student=>student.id===link.accountId) : null;
      const conflicts=[byUsername,byEmail].filter(account=>
        account && account.id!==exact[0].id);
      if (conflicts.length) {
        const unique=[exact[0],...conflicts].filter((student,index,array)=>
          array.findIndex(other=>other.id===student.id)===index);
        const permitted=unique.filter(student=>student.active!==false &&
          !getParnassysStudentNumber(student));
        // The explicit administrator decision wins over both the name and
        // the conflicting login identifier, but ONLY for a displayed and
        // still eligible candidate. A stale or forged choice stays blocked.
        const chosenId=clean(manualMatches?.[studentNumber]);
        const chosen=permitted.find(student=>student.id===chosenId);
        if (chosen) {
          setParnassysStudentNumber(chosen,studentNumber);
          prepared.push(row);
          return;
        }
        reviews.push({
          row:index+2,status:'needs-review',name,studentNumber,classes,
          reason:'Naam en gebruikersnaam of schoolmail verwijzen naar verschillende '
            +'leerlingaccounts. Controleer de koppeling handmatig.',
          candidates:permitted.map(student=>({
            id:student.id,name:student.name||'',
            classNames:studentClassNames(db,student),
          })),
        });
        return;
      }
      // The people importer has stricter accent/punctuation matching.
      // Establish the ParnasSys number first for a unique normalized match.
      const oldNumber = getParnassysStudentNumber(exact[0]);
      if (!oldNumber) setParnassysStudentNumber(exact[0], studentNumber);
      if (oldNumber && oldNumber !== studentNumber) {
        reviews.push({
          row:index+2,status:'needs-review',name,studentNumber,classes,
          reason:'Naam komt overeen, maar het bestaande leerlingnummer is anders. '
            +'Controleer dit account voordat je synchroniseert.',
          candidates:[],
        });
        return;
      }
      prepared.push(row);
      return;
    }
    // Two students with the exact same name must NOT both be assumed to
    // have left school. Exact names are intentionally excluded by the fuzzy
    // matcher; report ambiguous exact matches separately for manual pairing.
    const candidates = exact.length > 1
      ? exact.filter(student => !getParnassysStudentNumber(student)).map(student=>({
        id:student.id, name:student.name || '',
        classNames:studentClassNames(db,student),
      }))
      : fuzzyManualCandidates(db, name, classes);
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

    if (candidates.length || exact.length > 1) {
      reviews.push({
        row: index + 2,
        status: 'needs-review',
        name,
        studentNumber,
        classes,
        reason: exact.length > 1
          ? 'Meerdere bestaande leerlingen hebben exact dezelfde naam. Kies de juiste koppeling.'
          : 'Mogelijk dezelfde leerling als een handmatig toegevoegd account.',
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

function processMissingStudents(result, originalDb, incomingNumbers, options,
  legacyResolutions = {}, pendingMatchReviews = []) {
  const activeNumberedBefore = (originalDb.students || []).filter(
    (student) => student?.active !== false && getParnassysStudentNumber(student)
  );
  const missingNumbers = new Set(
    activeNumberedBefore
      .map((student) => getParnassysStudentNumber(student))
      .filter((number) => number && !incomingNumbers.has(number))
  );
  const numberedMissing = (result.db.students || []).filter(
    (student) => student?.active !== false && missingNumbers.has(getParnassysStudentNumber(student))
  );
  // On a verified *full-school* export, existing unnumbered pupils not
  // matched to current rows are presumed to have left school. Fuzzy matches
  // pending manual review remain excluded to avoid deleting live accounts.
  // Admins can explicitly keep individual pupils before final confirmation.
  const potentialMatches = new Set(pendingMatchReviews.flatMap(review =>
    (review.candidates || []).map(candidate => candidate.id)));
  const legacyAccounts = options.fullSchoolSync
    ? (result.db.students || []).filter(student =>
      student?.id && student.active !== false &&
      !getParnassysStudentNumber(student) &&
      !potentialMatches.has(student.id))
    : [];
  const confirmedLegacyExits = [];
  let pendingLegacy = 0;
  let keptLegacy = 0;
  for (const student of legacyAccounts) {
    const rawChoice = legacyResolutions?.[student.id];
    // Only an explicit 'keep' overrides the default. Invalid selections
    // fail closed instead of silently authorizing removal.
    const choice = rawChoice === undefined || rawChoice === null
      ? 'exit' : rawChoice;
    if (choice === 'exit') confirmedLegacyExits.push(student);
    else if (choice === 'keep') keptLegacy++;
    else {
      pendingLegacy++;
      result.summary.needsReview = (result.summary.needsReview || 0) + 1;
    }
    result.results.push({
      status: choice === 'keep' || choice === 'exit'
        ? 'legacy-reviewed' : 'legacy-needs-review',
      id: student.id,
      name: student.name || 'Naam onbekend',
      classes: studentClassNames(result.db, student),
      chosen: choice === 'keep' || choice === 'exit' ? choice : '',
      assumedExit: choice === 'exit' && rawChoice == null,
      reason: 'Niet gekoppeld aan de volledige ParnasSys-export. '
        + 'Standaard uitschrijven; de beheerder kan dit account behouden.',
    });
  }
  const missing = [...numberedMissing, ...confirmedLegacyExits];
  result.summary.legacyAccountsWithoutNumber = legacyAccounts.length;
  result.summary.legacyAccountsNeedsReview = pendingLegacy;
  result.summary.legacyAccountsKept = keptLegacy;
  result.summary.legacyAccountsConfirmedExit = confirmedLegacyExits.length;
  result.summary.legacyAccountsAutoExit = confirmedLegacyExits.filter(
    student => legacyResolutions?.[student.id] == null).length;
  result.summary.missingFromImport = options.fullSchoolSync ? missing.length : 0;
  // Guard the entire cohort being exited, including pupils whose history
  // requires archival rather than deletion.
  result.summary.exitCandidateFingerprint = crypto.createHash('sha256')
    .update(JSON.stringify(missing.map(student=>student.id).sort())).digest('hex');
  result.summary.largeRemovalWarning = Boolean(
    options.fullSchoolSync && missing.length >=
      largeRemovalThreshold((originalDb.students || [])
        .filter(student => student?.active !== false).length)
  );
  result.summary.deactivated = 0;
  result.summary.deactivationBlockedBorrowed = 0;
  result.summary.deletionEligible = 0;
  result.summary.exitTasks = 0;
  result.summary.exitTasksWithBooks = 0;
  result.summary.deleted = 0;
  result.summary.deletionCandidateFingerprint = '';

  if (!options.fullSchoolSync) return;
  const deletionIds=missing.filter(student=>!transitionMissingStudent(result.db,
    result.store,student,{apply:false}).hasData).map(student=>student.id).sort();
  result.summary.deletionCandidateFingerprint=crypto.createHash('sha256')
    .update(JSON.stringify(deletionIds)).digest('hex');
  for (const student of missing) {
    const outcome = transitionMissingStudent(result.db,result.store,student,{
      apply:options.applyDeactivations,actorId:options.actorId,
    });
    if (outcome.hasData) {
      result.summary.exitTasks += 1;
      if (outcome.loans)result.summary.exitTasksWithBooks += 1;
    } else result.summary.deletionEligible += 1;
    if (outcome.action==='deleted')result.summary.deleted += 1;
    if (outcome.action==='archived')result.summary.deactivated += 1;
    result.results.push({
      status:options.applyDeactivations?outcome.action:
        outcome.hasData?'will-archive':'will-delete',
      id:student.id,name:student.name||'',
      studentNumber:getParnassysStudentNumber(student),
      reason:outcome.hasData
        ?'Historische bibliotheekgegevens worden bewaard. '
          +'De leerling verdwijnt uit de huidige klas en er komt een uitschrijftaak.'
        :'Geen bibliotheekgegevens gevonden. Het account mag na bevestiging verwijderd worden.',
    });
  }
}

function prepareTeacherRows(db, rows, manualMatches = {}, store = {}) {
  const prepared = [];
  const reviews = [];
  const accountIdByRow = {};
  const activeTeachers = (db.users || []).filter(u => u.role === 'teacher' && u.active !== false);
  const verifiedLinks = authCore.normalizeStore(store).links || [];
  const addRow = (row, account) => {
    if (account) accountIdByRow[prepared.length] = account.id;
    prepared.push(row);
  };
  rows.forEach((row, index) => {
    const name = personNameFromRow(row);
    const exact = activeTeachers.filter(u =>
      normalizePersonName(u.name) === normalizePersonName(name));
    const username = normalizedRowValue(row,
      ['gebruikersnaam', 'username', 'user', 'login']).toLowerCase();
    const email = authCore.normalizeEmail(normalizedRowValue(row,
      ['schoolmail', 'schoolmailadres', 'school e-mail', 'schoolemail', 'email',
        'e-mail', 'e-mailadres', 'emailadres', 'googleemail']));
    const byUsername = username ? activeTeachers.find(u =>
      String(u.username || '').toLowerCase() === username) : null;
    const link = email ? verifiedLinks.find(entry => entry.accountType === 'staff' &&
      authCore.normalizeEmail(entry.email) === email) : null;
    const byEmail = link ? activeTeachers.find(u => u.id === link.accountId) : null;
    const candidates = [...exact, byUsername, byEmail]
      .filter(Boolean).filter((u, i, all) => all.findIndex(v => v.id === u.id) === i);
    const conflicts =
      (exact.length > 1 && !byUsername && !byEmail) ||
      (exact.length > 0 && byUsername && !exact.some(u => u.id === byUsername.id)) ||
      (exact.length > 0 && byEmail && !exact.some(u => u.id === byEmail.id)) ||
      (byEmail && byUsername && byEmail.id !== byUsername.id);

    if (!conflicts) {
      // A unique normalized-name match is authoritative for account ID only,
      // not for the employee's login. Keep the username supplied by ParnasSys.
      // The importer normally uses stricter accent/punctuation normalization.
      const chosen = byEmail || byUsername || (exact.length === 1 ? exact[0] : null);
      addRow(row, chosen);
      return;
    }

    const key = 'staff:' + (index + 2);
    const choice = manualMatches?.[key];
    // A previously verified schoolmail link cannot be assigned to another
    // employee by a username/name selection.
    const permitted = candidates.filter(u => !byEmail || u.id === byEmail.id);
    const chosen = permitted.find(u => u.id === choice);
    if (chosen) {
      addRow(row, chosen);
      return;
    }
    reviews.push({
      status: 'needs-review', row: index + 2, name, sourceKey: key,
      reason: byEmail && candidates.some(u => u.id !== byEmail.id)
        ? 'Naam en gekoppelde schoolmail verwijzen naar verschillende accounts. '
          + 'Controleer de identiteit voordat je een medewerker uitschrijft.'
        : byUsername && exact.some(u => u.id !== byUsername.id)
          ? 'Naam en gebruikersnaam verwijzen naar verschillende docentaccounts. '
            + 'Selecteer het juiste account.'
          : 'Meerdere docentaccounts hebben dezelfde naam. '
            + 'Kies het juiste bestaande account voordat je synchroniseert.',
      candidates: permitted.map(u => ({ id: u.id, name: u.name || '', username: u.username || '' })),
    });
  });
  return { prepared, reviews, accountIdByRow };
}

function findTeacherByExactName(db, name) {
  const wanted = normalizePersonName(name);
  const matches = (db.users || []).filter(
    (user) => user?.role === 'teacher' && normalizePersonName(user?.name) === wanted
  );
  return matches.length === 1 ? matches[0] : null;
}

function processTeacherDeactivations(result, originalDb, rows, options,
  incomingTeacherIds = new Set(), resolutions = {}, pendingReviews = []) {
  result.summary.teachersWithoutGroups = 0;
  result.summary.missingTeachersFromImport = 0;
  result.summary.teacherDeletionEligible = 0;
  result.summary.teacherExitTasks = 0;
  result.summary.teacherDeleted = 0;
  result.summary.teacherArchived = 0;
  result.summary.teacherExitCandidateFingerprint = '';
  result.summary.teacherDeletionCandidateFingerprint = '';
  result.summary.largeRemovalWarning = false;
  if (!options.fullSchoolSync) return;

  const original = (originalDb.users || []).filter(user=>
    user?.id && user.role==='teacher' && user.active!==false);
  // The complete ParnasSys employee list is authoritative, including old
  // manually created staff accounts. Being assigned no groups must not
  // silently deactivate a current employee.
  const missing = [];
  const remainingCandidates = [];
  const matchingNames = new Set(rows.map(row=>normalizePersonName(
    personNameFromRow(row))).filter(Boolean));
  const successfullyMatchedNames=new Set((result.db.users||[])
    .filter(user=>incomingTeacherIds.has(user.id)&&user.role==='teacher')
    .map(user=>normalizePersonName(user.name)));
  const disputedIds=new Set(pendingReviews.flatMap(review=>
    (review.candidates||[]).map(candidate=>candidate.id)));
  for(const teacher of original){
    if(incomingTeacherIds.has(teacher.id)||disputedIds.has(teacher.id))continue;
    if(matchingNames.has(normalizePersonName(teacher.name)) &&
      !successfullyMatchedNames.has(normalizePersonName(teacher.name))){
      // The row refers to the name but did not match any existing account.
      // Do not auto-remove a person whose identity is unresolved.
      remainingCandidates.push(teacher);
      continue;
    }
    const choice=resolutions?.[teacher.id];
    if(choice!==undefined && !['exit','keep'].includes(choice)){
      result.summary.needsReview=(result.summary.needsReview||0)+1;
      result.results.push({status:'teacher-legacy-needs-review',id:teacher.id,
        name:teacher.name||'',reason:'Ongeldige keuze: controleer dit account opnieuw.'});
      continue;
    }
    if(choice!=='keep')missing.push(teacher);
    result.results.push({
      status:'teacher-legacy-reviewed',id:teacher.id,
      name:teacher.name||'',chosen:choice==='keep'?'keep':'exit',
      classes:teacher.classIds || [],
      reason:'Niet gekoppeld aan volledige medewerkersexport; '
        +'standaard uitschrijven tenzij beheer expliciet behoudt.',
    });
  }
  result.summary.teachersWithUnresolvedIdentity=remainingCandidates.length;
  if(remainingCandidates.length){
    const reviewNames=new Set(result.results.filter(row=>
      row.status==='needs-review').map(row=>normalizePersonName(row.name)));
    for(const teacher of remainingCandidates){
      if(reviewNames.has(normalizePersonName(teacher.name)))continue;
      result.summary.needsReview=(result.summary.needsReview||0)+1;
      reviewNames.add(normalizePersonName(teacher.name));
      result.results.push({
        status:'needs-review',id:teacher.id,name:teacher.name||'',
        reason:'De medewerker staat in de export, maar zijn bestaande account '
          +'kon niet eenduidig worden gekoppeld. Controleer de gegevens.',
        candidates:[],
      });
    }
  }
  result.summary.teacherLegacyAccounts=(result.results||[])
    .filter(x=>x.status==='teacher-legacy-reviewed').length;
  result.summary.missingTeachersFromImport=missing.length;
  result.summary.teachersWithoutGroups=(result.db.users||[])
    .filter(u=>u.role==='teacher'&&u.active!==false
      &&incomingTeacherIds.has(u.id)&&!(u.classIds||[]).length).length;
  result.summary.largeRemovalWarning=missing.length>=
    largeTeacherRemovalThreshold(original.length);
  result.summary.teacherExitCandidateFingerprint=crypto.createHash('sha256')
    .update(JSON.stringify(missing.map(x=>x.id).sort())).digest('hex');
  const deletionIds=[];
  for(const orig of missing){
    const teacher=(result.db.users||[]).find(u=>u.id===orig.id&&
      u.role==='teacher'&&u.active!==false);
    if(!teacher)continue;
    const outcome=transitionMissingTeacher(result.db,result.store,teacher,{
      apply:options.applyDeactivations,actorId:options.actorId,
    });
    if(!outcome.hasData) {
      result.summary.teacherDeletionEligible+=1;
      deletionIds.push(teacher.id);
    } else result.summary.teacherExitTasks+=1;
    if(outcome.action==='deleted')result.summary.teacherDeleted++;
    if(outcome.action==='archived')result.summary.teacherArchived++;
    result.results.push({
      status:options.applyDeactivations?outcome.action:
        outcome.hasData?'would-archive-teacher':'would-delete-teacher',
      id:teacher.id,name:teacher.name||'',
      reason:outcome.hasData
        ?'Historische gegevens blijven bewaard. Het account wordt inactief '
          +'en krijgt een beheerderstaak.'
        :'Geen gekoppelde historische gegevens. Account kan na extra bevestiging '
          +'definitief worden verwijderd.',
    });
  }
  result.summary.teacherDeletionCandidateFingerprint=crypto.createHash('sha256')
    .update(JSON.stringify(deletionIds.sort())).digest('hex');
  result.summary.deactivated=(result.summary.deactivated||0)
    +result.summary.teacherArchived;
  result.summary.deleted=(result.summary.deleted||0)
    +result.summary.teacherDeleted;
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
  if(kind==='teacher'&&options.fullSchoolSync){
    if(!rows.length){
      const error=new Error('Een volledige medewerkersexport mag niet leeg zijn.');
      error.code='INCOMPLETE_PARNASSYS_STAFF';throw error;
    }
    const missingName=rows.findIndex(row=>!personNameFromRow(row));
    if(missingName!==-1){
      const error=new Error('De volledige medewerkersexport bevat een rij zonder '
        +'medewerkernaam (Excelrij '+(missingName+2)+'). '
        +'Controleer dit voordat je accounts uitschrijft.');
      error.code='INCOMPLETE_PARNASSYS_STAFF';throw error;
    }
  }
  // A complete export must have an identity for every listed pupil.
  // Otherwise even a pupil visibly present in Excel could be classified
  // as absent and auto-exited. Blank spacer rows are ignored.
  if (kind==='student' && input.fullSchoolSync) {
    const firstIncomplete = rows.findIndex(row=>
      !studentNumberFromRow(row) &&
      (personNameFromRow(row) || classNamesFromRow(row).length));
    if (firstIncomplete!==-1) {
      const error=new Error('De volledige ParnasSys-export bevat een leerling zonder '
        +'leerlingnummer (Excelrij '+(firstIncomplete+2)+'). '
        +'Controleer het bestand voordat je leerlingen uitschrijft.');
      error.code='INCOMPLETE_PARNASSYS_IDENTITY';
      throw error;
    }
    const firstNameless = rows.findIndex(row =>
      studentNumberFromRow(row) && !personNameFromRow(row));
    if (firstNameless!==-1) {
      const error=new Error('De volledige ParnasSys-export bevat een leerling zonder '
        +'naam (Excelrij '+(firstNameless+2)+'). '
        +'Controleer het bestand voordat je leerlingen uitschrijft.');
      error.code='INCOMPLETE_PARNASSYS_IDENTITY';
      throw error;
    }
  }

  let preparedRows = rows;
  let reviews = [];
  let incomingNumbers = new Set();
  let teacherAccountIdByRow = {};
  if (kind === 'student') {
    const prepared = prepareStudentRows(db, rows, input.manualMatches || {}, store);
    preparedRows = prepared.prepared;
    reviews = prepared.reviews;
    incomingNumbers = prepared.incomingNumbers;
  } else if(options.fullSchoolSync){
    const prepared=prepareTeacherRows(db,rows,input.manualMatches||{},store);
    preparedRows=prepared.prepared;
    reviews=prepared.reviews;
    teacherAccountIdByRow=prepared.accountIdByRow;
  }

  const result = applyPeopleImport({
    kind,
    rows: preparedRows,
    db,
    store,
    domain: input.domain,
    actorId: input.actorId,
    includeUnassignedTeachers: kind==='teacher' && options.fullSchoolSync,
    accountIdByRow: teacherAccountIdByRow,
  });
  recomputeResultCounts(result);
  if(kind==='teacher'&&options.fullSchoolSync){
    const failures=(result.results||[]).filter(row=>
      row.status==='skipped'||row.emailState==='conflict');
    if(failures.length){
      result.summary.needsReview=(result.summary.needsReview||0)+failures.length;
      for(const failure of failures)result.results.push({
        status:'needs-review',
        row:failure.row,
        name:failure.name||'Onbekende medewerker',
        reason:'Deze medewerker is niet eenduidig verwerkt. '
          +(failure.reason||failure.message||'Controleer de export en de accountkoppeling.'),
        candidates:[],
      });
    }
  }
  if (kind==='student') cancelReturnedStudents(result.db);
  else cancelReturnedTeachers(result.db);
  result.summary.needsReview = (result.summary.needsReview||0) + reviews.length;
  result.results.push(...reviews);

  if (kind === 'student') {
    processMissingStudents(result, originalDb, incomingNumbers, options,
      input.legacyResolutions || {}, reviews);
  } else {
    const incomingTeacherIds = new Set(
      (result.results || [])
        .filter((entry) => entry?.id && ['created', 'updated', 'unchanged'].includes(entry?.status))
        .map((entry) => entry.id)
    );
    processTeacherDeactivations(result, originalDb, rows, options, incomingTeacherIds,
      input.teacherResolutions || {}, reviews);
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