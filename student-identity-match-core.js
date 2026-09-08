'use strict';

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('nl-NL')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokens(value) {
  const normalized = normalizeName(value);
  return normalized ? normalized.split(' ').filter(Boolean) : [];
}

function comparableFirstName(student) {
  const explicit = normalizeName(student?.firstName);
  if (explicit) return explicit.split(' ')[0] || '';
  return tokens(student?.name)[0] || '';
}

function comparableLastName(student) {
  const explicit = normalizeName(student?.lastName);
  if (explicit) return explicit;
  const parts = tokens(student?.name);
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

function compareStudentGoogleName(student, googleName) {
  const studentName = normalizeName(
    student?.name || [student?.firstName, student?.middleName, student?.lastName].filter(Boolean).join(' ')
  );
  const google = normalizeName(googleName);
  if (!studentName || !google) {
    return {
      status: 'unknown',
      matches: false,
      warning: false,
    };
  }
  if (studentName === google) {
    return {
      status: 'match',
      matches: true,
      warning: false,
    };
  }

  const googleTokens = new Set(tokens(google));
  const firstName = comparableFirstName(student);
  const lastName = comparableLastName(student);
  const firstMatches = Boolean(firstName && googleTokens.has(firstName));
  const lastMatches = Boolean(
    lastName && (
      googleTokens.has(lastName) ||
      tokens(lastName).every((part) => googleTokens.has(part))
    )
  );

  if (firstMatches && (!lastName || lastMatches)) {
    return {
      status: 'likely-match',
      matches: true,
      warning: false,
    };
  }

  return {
    status: 'mismatch',
    matches: false,
    warning: true,
  };
}

module.exports = {
  normalizeName,
  compareStudentGoogleName,
};
