'use strict';

const crypto = require('crypto');
const core = require('./google-auth-core');

const EMAIL_KEYS = [
  'schoolmail',
  'schoolmailadres',
  'school_email',
  'schoolemail',
  'email',
  'e-mail',
  'e-mailadres',
  'emailadres',
  'googleemail',
  'google_email',
];
const USERNAME_KEYS = ['gebruikersnaam', 'username', 'user', 'login'];
const NAME_KEYS = ['naam', 'name', 'volledigenaam', 'volledige_naam', 'full_name', 'fullname'];
const FIRST_NAME_KEYS = ['voornaam', 'firstname', 'first_name'];
const MIDDLE_NAME_KEYS = ['tussenvoegsel', 'voorvoegsel', 'middlename', 'middle_name'];
const LAST_NAME_KEYS = ['achternaam', 'lastname', 'last_name'];
const CLASS_KEYS = [
  'klassen',
  'klas(sen)',
  'klas',
  'klasnaam',
  'groep',
  'groepen',
  'class',
  'classes',
];
const GRADE_KEYS = ['leerjaar', 'grade', 'niveau'];

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '')
    .replace(/_/g, '');
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
    const key = value.toLocaleLowerCase('nl-NL');
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
  const combined = [firstName, middleName, lastName].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const resolvedFullName = fullName || combined;
  return {
    fullName: resolvedFullName,
    firstName: firstName || (resolvedFullName ? resolvedFullName.split(/\s+/)[0] : ''),
    middleName,
    lastName: lastName || '',
  };
}

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('nl-NL');
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
  const existing = findClassByName(db, name);
  if (existing) {
    if (!Array.isArray(existing.teacherIds)) existing.teacherIds = [];
    if (!Array.isArray(existing.studentIds)) existing.studentIds = [];
    return { classRecord: existing, created: false };
  }
  const classRecord = {
    id: crypto.randomUUID(),
    name: String(name || '').trim(),
    teacherIds: [],
    studentIds: [],
  };
  if (!Array.isArray(db.classes)) db.classes = [];
  db.classes.push(classRecord);
  return { classRecord, created: true };
}

function findAccountByLink(db, store, kind, email) {
  if (!email) return null;
  const accountType = kind === 'teacher' ? 'staff' : 'student';
  const link = core.findLinkByIdentity(store, accountType, { email, sub: '' });
  if (!link) return null;
  if (kind === 'teacher') {
    return (db.users || []).find((entry) => entry?.id === link.accountId && entry?.role === 'teacher') || null;
  }
  return (db.students || []).find((entry) => entry?.id === link.accountId) || null;
}

function findExistingAccount(db, store, kind, { email, username, name }) {
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
    const byName = collection.filter((entry) => normalizeName(entry?.name) === wantedName);
    if (byName.length === 1) return { account: byName[0], matchedBy: 'name' };
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
    return { classIds: existingIds, newClasses: 0 };
  }
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
  return { classIds, newClasses };
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
    message: `${summary.created} ${label} toegevoegd, ${summary.updated} bijgewerkt en ${summary.linked} schoolaccounts gekoppeld via Google-first import`,
  });
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

  core.setLocalOnlyStaffAccountIds(
    db.users.filter((entry) => entry?.role === 'admin').map((entry) => entry.id)
  );

  const summary = {
    kind,
    totalRows: rows.length,
    created: 0,
    updated: 0,
    linked: 0,
    verified: 0,
    missingEmail: 0,
    invalidEmail: 0,
    ambiguous: 0,
    skipped: 0,
    newClasses: 0,
  };
  const results = [];

  rows.forEach((rawRow, index) => {
    const rowNumber = index + 2;
    const row = normalizeRow(rawRow);
    const nameParts = extractName(row);
    const name = nameParts.fullName;
    const email = core.normalizeEmail(readFirst(row, EMAIL_KEYS));
    const providedUsername = readFirst(row, USERNAME_KEYS);
    const classNames = extractClassNames(row);
    const classesAuthoritative = hasAnyKey(row, CLASS_KEYS);
    const grade = readFirst(row, GRADE_KEYS);
    const gradeAuthoritative = hasAnyKey(row, GRADE_KEYS);

    if (!name) {
      summary.skipped += 1;
      results.push({ row: rowNumber, status: 'skipped', reason: 'Naam ontbreekt.' });
      return;
    }

    const match = findExistingAccount(db, store, kind, {
      email: core.isAllowedSchoolEmail(email, domain) ? email : '',
      username: providedUsername,
      name,
    });
    if (match.ambiguous) {
      summary.ambiguous += 1;
      summary.skipped += 1;
      results.push({
        row: rowNumber,
        name,
        email,
        status: 'skipped',
        reason: 'Meerdere bestaande accounts hebben exact dezelfde naam. Voeg schoolmail of gebruikersnaam toe.',
      });
      return;
    }

    let account = match.account;
    const wasCreated = !account;
    if (!account) {
      const usernameSeed = providedUsername || (email ? email.split('@')[0] : name);
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
        };
        db.students.push(account);
      }
      summary.created += 1;
    } else {
      account.name = name;
      account.firstName = nameParts.firstName || account.firstName || '';
      account.middleName = nameParts.middleName || '';
      account.lastName = nameParts.lastName || account.lastName || '';
      if (providedUsername && !usernameTaken(db, providedUsername, account.id)) {
        account.username = providedUsername;
      } else if (!account.username) {
        account.username = uniqueUsername(db, email ? email.split('@')[0] : name, account.id);
      }
      if (kind === 'student' && gradeAuthoritative) account.grade = grade;
      if (kind === 'teacher') account.role = 'teacher';
      account.mustChangePassword = false;
      summary.updated += 1;
    }

    const classResult = assignClasses(db, kind, account, classNames, classesAuthoritative);
    summary.newClasses += classResult.newClasses;

    let emailState = 'missing';
    let emailMessage = '';
    if (!email) {
      summary.missingEmail += 1;
      emailMessage = 'Geen schoolmail opgegeven; account is wel verwerkt maar kan nog niet via Google inloggen.';
    } else if (!core.isAllowedSchoolEmail(email, domain)) {
      summary.invalidEmail += 1;
      emailState = 'invalid';
      emailMessage = `Schoolmail moet eindigen op @${domain}.`;
    } else {
      try {
        const accountType = kind === 'teacher' ? 'staff' : 'student';
        const linked = linkSchoolEmail(store, accountType, account.id, email, actorId);
        store = linked.store;
        summary.linked += 1;
        if (linked.verified) summary.verified += 1;
        emailState = linked.verified ? 'verified' : 'prelinked';
      } catch (error) {
        emailState = 'conflict';
        emailMessage = error?.message || 'Schoolmail kon niet worden gekoppeld.';
      }
    }

    results.push({
      row: rowNumber,
      id: account.id,
      name: account.name,
      username: account.username,
      email,
      classes: classNames,
      matchedBy: match.matchedBy,
      status: wasCreated ? 'created' : 'updated',
      emailState,
      message: emailMessage,
    });
  });

  appendImportHistory(db, kind, summary);
  return { db, store, summary, results };
}

module.exports = {
  applyPeopleImport,
  normalizeRow,
  extractName,
  extractClassNames,
  uniqueUsername,
};
