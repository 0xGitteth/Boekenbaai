'use strict';

const crypto = require('crypto');

const DEFAULT_RESULT_LIMIT = 8;
const MAX_QUERY_LENGTH = 80;

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('nl-NL')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function searchTokens(value) {
  const normalized = normalizeSearchText(value);
  return normalized ? normalized.split(' ').filter(Boolean) : [];
}

function queryMatchesName(name, query) {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length < 2 || normalizedQuery.length > MAX_QUERY_LENGTH) return false;

  const nameParts = searchTokens(name);
  const queryParts = searchTokens(normalizedQuery);
  if (!nameParts.length || !queryParts.length) return false;

  // Twee letters zijn alleen bruikbaar voor een echte tweeletter-naam. Zo kan
  // "mi" niet meteen Mike, Mirsad, Mila, ... opsommen, terwijl "Bo" wel werkt.
  if (normalizedQuery.length === 2 && queryParts.length === 1) {
    return nameParts.includes(queryParts[0]);
  }

  // Zoek op het begin van naamdelen in plaats van willekeurige substrings.
  // Zowel "git" als "bak" kan dus "Gitte van Bakel" vinden, maar "itte" niet.
  return queryParts.every(
    (part) => part.length >= 2 && nameParts.some((namePart) => namePart.startsWith(part))
  );
}

function cleanDisplayPart(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function rawName(student) {
  return cleanDisplayPart(student?.name || [student?.firstName, student?.middleName, student?.lastName].filter(Boolean).join(' '));
}

function preferredFirstName(student) {
  const explicit = cleanDisplayPart(student?.firstName);
  if (explicit) return explicit;
  const name = rawName(student);
  return name ? name.split(/\s+/)[0] : 'Leerling';
}

function preferredLastName(student) {
  const explicit = cleanDisplayPart(student?.lastName);
  if (explicit) return explicit;
  const parts = rawName(student).split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

function surnameCandidate(student, letters) {
  const firstName = preferredFirstName(student);
  const lastName = preferredLastName(student);
  if (!lastName) return firstName;
  const length = Math.max(1, Math.min(Number(letters) || 1, lastName.length));
  const prefix = lastName.slice(0, length);
  return `${firstName} ${prefix}${length < lastName.length ? '.' : ''}`;
}

function sameDisplay(left, right) {
  return normalizeSearchText(left) === normalizeSearchText(right);
}

function classesForStudent(studentId, classes) {
  return (Array.isArray(classes) ? classes : [])
    .filter((entry) => Array.isArray(entry?.studentIds) && entry.studentIds.includes(studentId))
    .map((entry) => cleanDisplayPart(entry?.name))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, 'nl'));
}

function shortStableCode(id) {
  return crypto.createHash('sha256').update(String(id || '')).digest('base64url').slice(0, 4).toUpperCase();
}

function createStudentDisplayName(student, students, classes) {
  const allStudents = Array.isArray(students) ? students : [];
  const lastName = preferredLastName(student);

  if (lastName) {
    for (let letters = 1; letters <= lastName.length; letters += 1) {
      const candidate = surnameCandidate(student, letters);
      const collision = allStudents.some(
        (other) =>
          other?.id !== student?.id &&
          sameDisplay(candidate, surnameCandidate(other, letters))
      );
      if (!collision) return candidate;
    }
  }

  const fullCandidate = lastName
    ? `${preferredFirstName(student)} ${lastName}`
    : preferredFirstName(student);
  const exactColliders = allStudents.filter(
    (other) => other?.id !== student?.id && sameDisplay(fullCandidate, rawName(other) || preferredFirstName(other))
  );
  if (!exactColliders.length) return fullCandidate;

  // Alleen bij werkelijk identieke namen is extra context nodig. Gebruik dan
  // liefst de klas in de zichtbare labeltekst; klas/leerjaar worden nooit als
  // losse metadata aan het publieke endpoint teruggegeven.
  const ownClasses = classesForStudent(student?.id, classes);
  for (const className of ownClasses) {
    const classIsUnique = exactColliders.every(
      (other) => !classesForStudent(other?.id, classes).includes(className)
    );
    if (classIsUnique) return `${fullCandidate} (${className})`;
  }

  return `${fullCandidate} (${shortStableCode(student?.id)})`;
}

function searchableStudentName(student) {
  return [student?.name, student?.firstName, student?.middleName, student?.lastName]
    .filter(Boolean)
    .join(' ');
}

function buildStudentMatches(db, query, limit = DEFAULT_RESULT_LIMIT) {
  const students = Array.isArray(db?.students) ? db.students : [];
  const classes = Array.isArray(db?.classes) ? db.classes : [];
  return students
    .filter((entry) => entry?.id && queryMatchesName(searchableStudentName(entry), query))
    .map((entry) => {
      const displayName = createStudentDisplayName(entry, students, classes);
      return {
        id: entry.id,
        name: displayName,
        displayName,
        type: 'student',
      };
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName, 'nl'))
    .slice(0, Math.max(1, Math.min(Number(limit) || DEFAULT_RESULT_LIMIT, DEFAULT_RESULT_LIMIT)));
}

function buildStaffMatches(db, query, limit = DEFAULT_RESULT_LIMIT) {
  const users = Array.isArray(db?.users) ? db.users : [];
  const candidates = users.filter(
    (entry) =>
      entry?.id &&
      ['teacher', 'admin'].includes(entry?.role) &&
      cleanDisplayPart(entry?.name) &&
      queryMatchesName(entry.name, query)
  );
  const nameCounts = new Map();
  for (const entry of candidates) {
    const normalized = normalizeSearchText(entry.name);
    nameCounts.set(normalized, (nameCounts.get(normalized) || 0) + 1);
  }

  return candidates
    .map((entry) => {
      const normalized = normalizeSearchText(entry.name);
      const baseName = cleanDisplayPart(entry.name);
      const displayName = nameCounts.get(normalized) > 1
        ? `${baseName} (${shortStableCode(entry.id)})`
        : baseName;
      return {
        id: entry.id,
        name: displayName,
        displayName,
        type: 'staff',
      };
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName, 'nl'))
    .slice(0, Math.max(1, Math.min(Number(limit) || DEFAULT_RESULT_LIMIT, DEFAULT_RESULT_LIMIT)));
}

class DirectoryRateLimiter {
  constructor({
    windowMs = 60 * 1000,
    browserMax = 30,
    networkMax = 120,
    globalMax = 1200,
  } = {}) {
    this.windowMs = windowMs;
    this.browserMax = browserMax;
    this.networkMax = networkMax;
    this.globalMax = globalMax;
    this.browserEvents = new Map();
    this.networkEvents = new Map();
    this.globalEvents = [];
  }

  _pruneList(events, cutoff) {
    return (events || []).filter((time) => time > cutoff);
  }

  _pruneMap(map, cutoff) {
    for (const [key, events] of map.entries()) {
      const fresh = this._pruneList(events, cutoff);
      if (fresh.length) map.set(key, fresh);
      else map.delete(key);
    }
  }

  _retryAfter(events, now) {
    const first = events[0] || now;
    return Math.max(1, Math.ceil((first + this.windowMs - now) / 1000));
  }

  checkAndRecord({ browserKey, networkKey }, now = Date.now()) {
    const cutoff = now - this.windowMs;
    this.globalEvents = this._pruneList(this.globalEvents, cutoff);
    this._pruneMap(this.browserEvents, cutoff);
    this._pruneMap(this.networkEvents, cutoff);

    const browserEvents = this.browserEvents.get(browserKey) || [];
    const networkEvents = this.networkEvents.get(networkKey) || [];
    if (browserEvents.length >= this.browserMax) {
      return { allowed: false, scope: 'browser', retryAfterSeconds: this._retryAfter(browserEvents, now) };
    }
    if (networkEvents.length >= this.networkMax) {
      return { allowed: false, scope: 'network', retryAfterSeconds: this._retryAfter(networkEvents, now) };
    }
    if (this.globalEvents.length >= this.globalMax) {
      return { allowed: false, scope: 'global', retryAfterSeconds: this._retryAfter(this.globalEvents, now) };
    }

    browserEvents.push(now);
    networkEvents.push(now);
    this.browserEvents.set(browserKey, browserEvents);
    this.networkEvents.set(networkKey, networkEvents);
    this.globalEvents.push(now);
    return { allowed: true, scope: null, retryAfterSeconds: 0 };
  }
}

module.exports = {
  DEFAULT_RESULT_LIMIT,
  MAX_QUERY_LENGTH,
  normalizeSearchText,
  searchTokens,
  queryMatchesName,
  preferredFirstName,
  preferredLastName,
  createStudentDisplayName,
  buildStudentMatches,
  buildStaffMatches,
  DirectoryRateLimiter,
};
