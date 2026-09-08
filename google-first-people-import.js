'use strict';

const crypto = require('crypto');
const core = require('./google-auth-core');

const EMAIL_KEYS = [
  'schoolmail',
  'schoolmailadres',
  'school e-mail',
  'schoolemail',
  'email',
  'e-mail',
  'e-mailadres',
  'emailadres',
  'googleemail',
];
const USERNAME_KEYS = ['gebruikersnaam', 'username', 'user', 'login'];
const NAME_KEYS = ['naam', 'name', 'volledigenaam', 'volledige naam', 'full name', 'fullname'];
const FIRST_NAME_KEYS = ['roepnaam', 'voornaam', 'firstname', 'first name'];
const MIDDLE_NAME_KEYS = ['voorvoegsel', 'tussenvoegsel', 'middlename', 'middle name'];
const LAST_NAME_KEYS = ['achternaam', 'lastname', 'last name'];
const CLASS_KEYS = [
  'huidige groep',
  'huidigegroep',
  'gekoppelde groepen',
  'gekoppeldegroepen',
  'klassen',
  'klas(sen)',
  'klas',
  'klasnaam',
  'groep',
  'groepen',
  'class',
  'classes',
];
const STUDENT_NUMBER_KEYS = [
  'leerlingnummer',
  'leerling nummer',
  'leerlingnr',
  'leerling nr',
  'studentnummer',
  'student number',
];
const GRADE_KEYS = ['leerjaar', 'grade', 'niveau'];
const PARNASSYS_STUDENT_MARKERS = ['leerlingnummer', 'huidige groep', 'huidige status'];
const PARNASSYS_TEACHER_MARKERS = ['gekoppelde groepen', 'rollen'];

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeRow(row) {
  const normalized = {};
  for (const [key, value] of Object.entries(row || {})) {
    normalized[normalizeKey(key)] = value;
  }
  return normalized;
}

function readFirst(row, keys) {
  for (const key of keys) {
    const normalizedKey = normalizeKey(key);
    if (!Object.prototype.hasOwnProperty.call(row, normalizedKey)) continue;
    const value = String(row[normalizedKey] ?? '').trim();
    if (value) return value;
  }
  return '';
}

function hasAnyKey(row, keys) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(row, normalizeKey(key)));
}

function parseMultiValue(value) {
  if (Array.isArray(value)) return value.flatMap(parseMultiValue);
  if (value === undefined || value === null) return [];
  return String(value)
    .split(/[;,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function extractClassNames(row) {
  const values = [];
  for (const key of CLASS_KEYS) {
    const normalizedKey = normalizeKey(key);
    if (!Object.prototype.hasOwnProperty.call(row, normalizedKey)) continue;
    values.push(...parseMultiValue(row[normalizedKey]));
  }
  const seen = new Set();
  return values.filter((value) => {
    const key = normalizeName(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractName(row) {
  const fullName = readFirst(row, NAME_KEYS);
  const firstName = readFirst(row, FIRST_NAME_KEYS);
  const middleName = readFirst(row, MIDDLE_NAME_KEYS);
  const lastName = readFirst(row, LAST_NAME_KEYS);
  const combined = [firstName, middleName, lastName]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const resolvedFullName = fullName || combined;
  const fallbackParts = resolvedFullName.split(/\s+/).filter(Boolean);
  const fallbackMiddle = fallbackParts.length > 2 ? fallbackParts.slice(1, -1).join(' ') : '';
  return {
    fullName: resolvedFullName,
    firstName: firstName || fallbackParts[0] || '',
    middleName: middleName || fallbackMiddle,
    lastName: lastName || (fallbackParts.length > 1 ? fallbackParts[fallbackParts.length - 1] : ''),
  };
}

function normalizeName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('nl-NL');
}

function normalizeExternalId(value) {
  return String(value || '').trim();
}

function getParnassysStudentNumber(student) {
  return normalizeExternalId(
    student?.parnassysStudentNumber ||
    student?.externalIds?.parnassys ||
    ''
  );
}

function setParnassysStudentNumber(student, value) {
  const number = normalizeExternalId(value);
  if (!number) return false;
  const before = getParnassysStudentNumber(student);
  student.parnassysStudentNumber = number;
  student.externalIds = student.externalIds && typeof student.externalIds === 'object'
    ? student.externalIds
    : {};
  student.externalIds.parnassys = number;
  return before !== number;
}

function slugUsername(value) {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 48);
  return slug || 'account';
}

function allAccounts(db) {
  return [...(db.students || []), ...(db.users || [])];
}

function usernameTaken(db, username, exceptId = '') {
  const wanted = String(username || '').trim().toLowerCase();
  if (!wanted) return false;
  return allAccounts(db).some(
    (entry) => entry?.id !== exceptId && String(entry?.username || '').trim().toLowerCase() === wanted
  );
}

function uniqueUsername(db, preferred, exceptId = '') {
  const base = slugUsername(preferred);
  if (!usernameTaken(db, base, exceptId)) return base;
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!usernameTaken(db, candidate, exceptId)) return candidate;
  }
  return `${base}-${crypto.randomBytes(4).toString('hex')}`;
}

function internalPasswordHash() {
  return crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex');
}

function findClassByName(db, name) {
  const wanted = normalizeName(name);
  return (db.classes || []).find((entry) => normalizeName(entry?.name) === wanted) || null;
}

function ensureClass(db, name) {
  const cleanName = String(name || '').trim();
  const existing = findClassByName(db, cleanName);
  if (existing) {
    if (!Array.isArray(existing.teacherIds)) existing.teacherIds = [];
    if (!Array.isArray(existing.studentIds)) existing.studentIds = [];
    return { classRecord: existing, created: false };
  }
  const classRecord = {
    id: crypto.randomUUID(),
    name: cleanName,
    teacherIds: [],
    studentIds: [],
  };
  if (!Array.isArray(db.classes)) db.classes = [];
  db.classes.push(classRecord);
  return { classRecord, created: true };
}

function findAccountByLink(db, store, kind, email) {
  const wantedEmail = core.normalizeEmail(email);
  if (!wantedEmail) return null;
  const accountType = kind === 'teacher' ? 'staff' : 'student';
  const link = (core.normalizeStore(store).links || []).find(
    (entry) =>
      entry?.accountType === accountType &&
      core.normalizeEmail(entry?.email) === wantedEmail
  );
  if (!link) return null;
  if (kind === 'teacher') {
    return (db.users || []).find((entry) => entry?.id === link.accountId && entry?.role === 'teacher') || null;
  }
  return (db.students || []).find((entry) => entry?.id === link.accountId) || null;
}

function findStudentByNumber(db, studentNumber) {
  const wanted = normalizeExternalId(studentNumber);
  if (!wanted) return null;
  return (db.students || []).find((entry) => getParnassysStudentNumber(entry) === wanted) || null;
}

function findExistingAccount(db, store, kind, { email, username, name, studentNumber }) {
  if (kind === 'student' && studentNumber) {
    const byStudentNumber = findStudentByNumber(db, studentNumber);
    if (byStudentNumber) return { account: byStudentNumber, matchedBy: 'student-number' };
  }

  const byLink = findAccountByLink(db, store, kind, email);
  if (byLink) return { account: byLink, matchedBy: 'schoolmail' };

  const collection = kind === 'teacher'
    ? (db.users || []).filter((entry) => entry?.role === 'teacher')
    : (db.students || []);

  if (username) {
    const wantedUsername = username.toLowerCase();
    const byUsername = collection.find(
      (entry) => String(entry?.username || '').trim().toLowerCase() === wantedUsername
    );
    if (byUsername) return { account: byUsername, matchedBy: 'username' };
  }

  if (name) {
    const wantedName = normalizeName(name);
    const byName = collection.filter(
      (entry) => entry?.active !== false && normalizeName(entry?.name) === wantedName
    );
    if (byName.length === 1) {
      if (
        kind === 'student' &&
        studentNumber &&
        getParnassysStudentNumber(byName[0]) &&
        getParnassysStudentNumber(byName[0]) !== normalizeExternalId(studentNumber)
      ) {
        return { account: null, matchedBy: 'student-number-conflict', conflict: true };
      }
      return { account: byName[0], matchedBy: 'name' };
    }
    if (byName.length > 1) return { account: null, matchedBy: 'ambiguous-name', ambiguous: true };
  }

  return { account: null, matchedBy: null };
}

function removeAccountFromClasses(db, kind, accountId, keepClassIds) {
  const keep = new Set(keepClassIds || []);
  for (const classRecord of db.classes || []) {
    if (kind === 'teacher') {
      classRecord.teacherIds = Array.isArray(classRecord.teacherIds) ? classRecord.teacherIds : [];
      if (!keep.has(classRecord.id)) {
        classRecord.teacherIds = classRecord.teacherIds.filter((id) => id !== accountId);
      }
    } else {
      classRecord.studentIds = Array.isArray(classRecord.studentIds) ? classRecord.studentIds : [];
      if (!keep.has(classRecord.id)) {
        classRecord.studentIds = classRecord.studentIds.filter((id) => id !== accountId);
      }
    }
  }
}

function assignClasses(db, kind, account, classNames, authoritative) {
  if (!authoritative) {
    const existingIds = Array.isArray(account.classIds) ? account.classIds : [];
    return { classIds: existingIds, newClasses: 0, changed: false };
  }
  const originalIds = Array.isArray(account.classIds) ? [...account.classIds] : [];
  const classIds = [];
  let newClasses = 0;
  for (const name of classNames) {
    const ensured = ensureClass(db, name);
    if (ensured.created) newClasses += 1;
    const classRecord = ensured.classRecord;
    classIds.push(classRecord.id);
    if (kind === 'teacher') {
      if (!classRecord.teacherIds.includes(account.id)) classRecord.teacherIds.push(account.id);
    } else if (!classRecord.studentIds.includes(account.id)) {
      classRecord.studentIds.push(account.id);
    }
  }
  removeAccountFromClasses(db, kind, account.id, classIds);
  account.classIds = classIds;
  const changed = originalIds.length !== classIds.length || originalIds.some((id) => !classIds.includes(id));
  return { classIds, newClasses, changed };
}

function linkSchoolEmail(store, accountType, accountId, email, actorId) {
  const before = core.findLinkByAccount(store, accountType, accountId);
  const beforeEmail = core.normalizeEmail(before?.email);
  const result = core.upsertLink(store, {
    accountType,
    accountId,
    email,
    sub: beforeEmail === core.normalizeEmail(email) ? before?.sub || '' : '',
    linkedBy: actorId || 'people-import',
  });
  const changed = beforeEmail !== core.normalizeEmail(result.link.email);
  if (changed) {
    result.store.sessions = result.store.sessions.filter(
      (entry) => !(entry?.userId === accountId && entry?.type === accountType)
    );
  }
  return { ...result, changed, verified: Boolean(result.link.sub) };
}

function appendImportHistory(db, kind, summary) {
  if (!Array.isArray(db.history)) db.history = [];
  const label = kind === 'teacher' ? 'docenten' : 'leerlingen';
  db.history.push({
    id: crypto.randomUUID(),
    type: `${kind === 'teacher' ? 'teachers' : 'students'}_google_first_imported`,
    timestamp: new Date().toISOString(),
    message: `${summary.created} ${label} toegevoegd, ${summary.updated} bijgewerkt via schoolimport`,
  });
}

function isParnassysRow(kind, row) {
  return kind === 'teacher'
    ? hasAnyKey(row, PARNASSYS_TEACHER_MARKERS)
    : hasAnyKey(row, PARNASSYS_STUDENT_MARKERS);
}

function assertUniqueStudentNumbers(rows) {
  const seen = new Map();
  for (let index = 0; index < rows.length; index += 1) {
    const row = normalizeRow(rows[index]);
    const studentNumber = normalizeExternalId(readFirst(row, STUDENT_NUMBER_KEYS));
    if (!studentNumber) continue;
    if (seen.has(studentNumber)) {
      const error = new Error(
        `Het leerlingenbestand bevat leerlingnummer ${studentNumber} meerdere keren (regels ${seen.get(studentNumber) + 2} en ${index + 2}). Controleer het bronbestand voordat je importeert.`
      );
      error.code = 'DUPLICATE_STUDENT_NUMBER';
      throw error;
    }
    seen.set(studentNumber, index);
  }
}

function applyPeopleImport(input) {
  const kind = input?.kind === 'teacher' ? 'teacher' : 'student';
  const domain = core.normalizeDomain(input?.domain || 'koraaledu.nl');
  const actorId = String(input?.actorId || '').trim();
  const db = input?.db && typeof input.db === 'object' ? input.db : {};
  let store = core.normalizeStore(input?.store);
  const rows = Array.isArray(input?.rows) ? input.rows : [];

  if (!Array.isArray(db.students)) db.students = [];
  if (!Array.isArray(db.users)) db.users = [];
  if (!Array.isArray(db.classes)) db.classes = [];
  if (!Array.isArray(db.history)) db.history = [];

  if (kind === 'student') assertUniqueStudentNumbers(rows);

  core.setLocalOnlyStaffAccountIds(
    db.users.filter((entry) => entry?.role === 'admin').map((entry) => entry.id)
  );

  const summary = {
    kind,
    totalRows: rows.length,
    parnassysRows: 0,
    created: 0,
    updated: 0,
    linked: 0,
    verified: 0,
    missingEmail: 0,
    invalidEmail: 0,
    ambiguous: 0,
    conflicts: 0,
    skipped: 0,
    ignored: 0,
    newClasses: 0,
    studentNumbersStored: 0,
    matchedByStudentNumber: 0,
  };
  const results = [];

  rows.forEach((rawRow, index) => {
    const rowNumber = index + 2;
    const row = normalizeRow(rawRow);
    const parnassys = isParnassysRow(kind, row);
    if (parnassys) summary.parnassysRows += 1;

    const nameParts = extractName(row);
    const name = nameParts.fullName;
    const email = core.normalizeEmail(readFirst(row, EMAIL_KEYS));
    const providedUsername = readFirst(row, USERNAME_KEYS);
    const classNames = extractClassNames(row);
    const classesAuthoritative = hasAnyKey(row, CLASS_KEYS);
    const grade = readFirst(row, GRADE_KEYS);
    const gradeAuthoritative = hasAnyKey(row, GRADE_KEYS);
    const studentNumber = kind === 'student'
      ? normalizeExternalId(readFirst(row, STUDENT_NUMBER_KEYS))
      : '';

    if (kind === 'teacher' && parnassys && !classNames.length) {
      summary.ignored += 1;
      results.push({
        row: rowNumber,
        name: name || '(onbekend)',
        status: 'ignored',
        reason: 'Geen gekoppelde groep; voor deze medewerker is geen Boekenbaai-account nodig.',
      });
      return;
    }

    if (!name) {
      summary.skipped += 1;
      results.push({ row: rowNumber, status: 'skipped', reason: 'Naam ontbreekt.' });
      return;
    }

    if (kind === 'student' && parnassys && !studentNumber) {
      summary.skipped += 1;
      results.push({
        row: rowNumber,
        name,
        status: 'skipped',
        reason: 'ParnasSys-leerlingnummer ontbreekt.',
      });
      return;
    }

    const match = findExistingAccount(db, store, kind, {
      email: core.isAllowedSchoolEmail(email, domain) ? email : '',
      username: providedUsername,
      name,
      studentNumber,
    });

    if (match.ambiguous) {
      summary.ambiguous += 1;
      summary.skipped += 1;
      results.push({
        row: rowNumber,
        name,
        studentNumber,
        status: 'skipped',
        reason: 'Meerdere bestaande accounts hebben exact dezelfde naam. Koppeling wordt niet gegokt.',
      });
      return;
    }
    if (match.conflict) {
      summary.conflicts += 1;
      summary.skipped += 1;
      results.push({
        row: rowNumber,
        name,
        studentNumber,
        status: 'skipped',
        reason: 'Deze naam bestaat al met een ander ParnasSys-leerlingnummer.',
      });
      return;
    }

    let account = match.account;
    const wasCreated = !account;
    const beforeName = account?.name || '';
    const beforeFirstName = account?.firstName || '';
    const beforeMiddleName = account?.middleName || '';
    const beforeLastName = account?.lastName || '';
    const beforeUsername = account?.username || '';
    const beforeGrade = account?.grade || '';
    const beforeSource = account?.source || '';
    const beforeActive = account?.active;
    const beforeInactiveAt = account?.inactiveAt ?? null;
    const beforeInactiveReason = account?.inactiveReason ?? null;
    let numberChanged = false;
    let linkChanged = false;

    if (!account) {
      const usernameSeed = providedUsername || (email ? email.split('@')[0] : studentNumber || name);
      const username = uniqueUsername(db, usernameSeed);
      if (kind === 'teacher') {
        account = {
          id: crypto.randomUUID(),
          role: 'teacher',
          name,
          firstName: nameParts.firstName,
          middleName: nameParts.middleName,
          lastName: nameParts.lastName,
          username,
          passwordHash: internalPasswordHash(),
          mustChangePassword: false,
          classIds: [],
          active: true,
          source: parnassys ? 'parnassys' : 'manual-import',
        };
        db.users.push(account);
      } else {
        account = {
          id: crypto.randomUUID(),
          name,
          firstName: nameParts.firstName,
          middleName: nameParts.middleName,
          lastName: nameParts.lastName,
          username,
          passwordHash: internalPasswordHash(),
          mustChangePassword: false,
          grade: grade || '',
          borrowedBooks: [],
          classIds: [],
          active: true,
          source: parnassys ? 'parnassys' : 'manual-import',
        };
        if (studentNumber) {
          setParnassysStudentNumber(account, studentNumber);
          numberChanged = true;
        }
        db.students.push(account);
      }
    } else {
      account.name = name;
      account.firstName = nameParts.firstName || account.firstName || '';
      account.middleName = nameParts.middleName || '';
      account.lastName = nameParts.lastName || account.lastName || '';
      if (providedUsername && !usernameTaken(db, providedUsername, account.id)) {
        account.username = providedUsername;
      } else if (!account.username) {
        account.username = uniqueUsername(db, email ? email.split('@')[0] : studentNumber || name, account.id);
      }
      if (kind === 'student' && gradeAuthoritative) account.grade = grade;
      if (kind === 'student' && studentNumber) numberChanged = setParnassysStudentNumber(account, studentNumber);
      if (kind === 'teacher') account.role = 'teacher';
      if (parnassys) account.source = 'parnassys';
      account.mustChangePassword = false;
      account.active = true;
      account.inactiveAt = null;
      account.inactiveReason = null;
    }

    if (kind === 'student' && studentNumber) {
      if (numberChanged) summary.studentNumbersStored += 1;
      if (match.matchedBy === 'student-number') summary.matchedByStudentNumber += 1;
    }

    const classResult = assignClasses(db, kind, account, classNames, classesAuthoritative);
    summary.newClasses += classResult.newClasses;

    let emailState = 'missing';
    let emailMessage = '';
    if (!email) {
      summary.missingEmail += 1;
      emailMessage = kind === 'student'
        ? 'Geen schoolmail nodig: de leerling koppelt het Google-account bij de eerste login via mentorbevestiging.'
        : 'Geen schoolmail opgegeven.';
    } else if (!core.isAllowedSchoolEmail(email, domain)) {
      summary.invalidEmail += 1;
      emailState = 'invalid';
      emailMessage = `Schoolmail moet eindigen op @${domain}.`;
    } else {
      try {
        const accountType = kind === 'teacher' ? 'staff' : 'student';
        const linked = linkSchoolEmail(store, accountType, account.id, email, actorId);
        store = linked.store;
        linkChanged = linked.changed;
        emailState = linked.verified ? 'verified' : 'prelinked';
        if (linked.changed) summary.linked += 1;
        if (linked.verified) summary.verified += 1;
        emailMessage = linked.verified
          ? 'Google-account is al geverifieerd.'
          : 'Schoolmail staat klaar voor de eerste Google-login.';
      } catch (error) {
        summary.conflicts += 1;
        emailState = 'conflict';
        emailMessage = error.message;
      }
    }

    const changed = wasCreated ||
      beforeName !== account.name ||
      beforeFirstName !== (account.firstName || '') ||
      beforeMiddleName !== (account.middleName || '') ||
      beforeLastName !== (account.lastName || '') ||
      beforeUsername !== (account.username || '') ||
      beforeGrade !== (account.grade || '') ||
      beforeSource !== (account.source || '') ||
      beforeActive === false ||
      beforeInactiveAt !== (account.inactiveAt ?? null) ||
      beforeInactiveReason !== (account.inactiveReason ?? null) ||
      numberChanged ||
      classResult.changed ||
      linkChanged;

    results.push({
      row: rowNumber,
      id: account.id,
      name: account.name,
      studentNumber: kind === 'student' ? getParnassysStudentNumber(account) : '',
      classes: classNames,
      matchedBy: match.matchedBy || (wasCreated ? 'new' : ''),
      status: wasCreated ? 'created' : changed ? 'updated' : 'unchanged',
      emailState,
      message: emailMessage,
    });
  });

  summary.created = results.filter((entry) => entry?.status === 'created').length;
  summary.updated = results.filter((entry) => entry?.status === 'updated').length;
  if (summary.created || summary.updated) appendImportHistory(db, kind, summary);
  return { db, store, summary, results };
}

module.exports = {
  EMAIL_KEYS,
  CLASS_KEYS,
  STUDENT_NUMBER_KEYS,
  normalizeKey,
  normalizeRow,
  extractClassNames,
  extractName,
  getParnassysStudentNumber,
  setParnassysStudentNumber,
  findStudentByNumber,
  applyPeopleImport,
};