'use strict';

const {
  normalizeIsbn,
  isValidIsbn10,
  isValidIsbn13,
  toIsbn13,
} = require('./isbn-lookup-core-impl');
const {
  normalizeBookIdentityText,
  stringifyIdentifierValue,
  compareStableText,
} = require('./book-edition-utils');

const OFFICIAL_ISBN_FIELDS = Object.freeze(['editionIsbn', 'isbn13']);
const ISBN_CANDIDATE_FIELDS = Object.freeze(['editionIsbn', 'metadataIsbn', 'isbn13']);

function normalizeOfficialIsbnInput(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return '';
    return String(value);
  }
  if (typeof value === 'bigint') {
    if (value < 0n) return '';
    return String(value);
  }
  if (typeof value !== 'string') return '';

  const raw = value.normalize('NFC').trim();
  if (!raw) return '';
  if (/^\d{13}$/.test(raw) || /^\d{9}[0-9Xx]$/.test(raw)) return raw;

  const hasHyphen = raw.includes('-');
  const hasWhitespace = /\s/.test(raw);
  if (hasHyphen === hasWhitespace) return '';

  const normalizedSeparators = hasWhitespace ? raw.replace(/\s+/g, ' ') : raw;
  const separator = hasHyphen ? '-' : ' ';
  const parts = normalizedSeparators.split(separator);
  if (parts.some((part) => !part)) return '';
  if (parts.some((part, index) => (
    index === parts.length - 1
      ? !/^[0-9Xx]+$/.test(part)
      : !/^\d+$/.test(part)
  ))) return '';

  const joined = parts.join('');
  if (joined.length === 13) {
    if (parts.length !== 5 || !/^(?:978|979)$/.test(parts[0]) || !/^\d$/.test(parts[4])) return '';
    return normalizedSeparators;
  }
  if (joined.length === 10) {
    if (parts.length !== 4 || !/^[0-9Xx]$/.test(parts[3])) return '';
    return normalizedSeparators;
  }
  return '';
}

function canonicalizeBookIsbn13(value) {
  const acceptedInput = normalizeOfficialIsbnInput(value);
  if (!acceptedInput) return '';
  const normalized = normalizeIsbn(acceptedInput);
  if (isValidIsbn10(normalized)) return toIsbn13(normalized);
  if (isValidIsbn13(normalized) && /^(?:978|979)/.test(normalized)) return normalized;
  return '';
}

function hasPresentOfficialValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function evidenceValueText(value) {
  const scalar = stringifyIdentifierValue(value);
  if (scalar) return scalar.normalize('NFC').trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    try { return JSON.stringify(value); } catch { return '[array]'; }
  }
  if (value && typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return '[object]'; }
  }
  if (typeof value === 'symbol') return String(value);
  if (typeof value === 'function') return '[function]';
  return '';
}

function stableFieldValueToken(value) {
  if (value === undefined) return 'undefined:';
  if (value === null) return 'null:';
  const type = Array.isArray(value) ? 'array' : typeof value;
  return `${type}:${evidenceValueText(value)}`;
}

function createEditionFieldSnapshot(source, emittedEditionIsbn = source?.editionIsbn) {
  const record = source && typeof source === 'object' ? source : {};
  return {
    editionIsbn: stableFieldValueToken(emittedEditionIsbn),
    metadataIsbn: stableFieldValueToken(record.metadataIsbn),
    isbn13: stableFieldValueToken(record.isbn13),
  };
}

function snapshotsEqual(left, right) {
  return Boolean(
    left && right
    && left.editionIsbn === right.editionIsbn
    && left.metadataIsbn === right.metadataIsbn
    && left.isbn13 === right.isbn13
  );
}

function classifyInvalidOfficialIsbn(value) {
  if (!hasPresentOfficialValue(value)) return '';
  const supportedType = typeof value === 'string'
    || typeof value === 'bigint'
    || (typeof value === 'number' && Number.isFinite(value));
  if (!supportedType) return 'unsupported_type';
  if (canonicalizeBookIsbn13(value)) return '';
  if (!normalizeOfficialIsbnInput(value)) return 'invalid_syntax';
  return 'invalid_isbn';
}

function normalizeEvidenceInvalidFields(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const field = OFFICIAL_ISBN_FIELDS.includes(entry.field) ? entry.field : '';
    const rawValue = evidenceValueText(entry.value);
    const reason = normalizeBookIdentityText(entry.reason) || 'invalid_isbn';
    if (!field || !rawValue) continue;
    const key = JSON.stringify([field, rawValue, reason]);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ field, value: rawValue, reason });
  }
  return result.sort((left, right) => compareStableText(
    JSON.stringify([left.field, left.value, left.reason]),
    JSON.stringify([right.field, right.value, right.reason]),
  ));
}

function normalizeEvidenceCandidateSources(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  const seen = new Set();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || !ISBN_CANDIDATE_FIELDS.includes(entry.field)) continue;
    const rawValue = stringifyIdentifierValue(entry.value).normalize('NFC').trim();
    const canonicalIsbn = canonicalizeBookIsbn13(rawValue);
    if (!rawValue || !canonicalIsbn) continue;
    const key = JSON.stringify([entry.field, canonicalIsbn]);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ field: entry.field, value: rawValue, canonicalIsbn });
  }
  return result.sort((left, right) => compareStableText(
    JSON.stringify([left.field, left.value, left.canonicalIsbn]),
    JSON.stringify([right.field, right.value, right.canonicalIsbn]),
  ));
}

function getEditionIsbnEvidence(book) {
  const source = book && typeof book === 'object' ? book : {};
  const evidenceSource = source.editionIsbnEvidence;
  const currentSnapshot = createEditionFieldSnapshot(source);
  const reusePreviousEvidence = Boolean(
    evidenceSource
      && typeof evidenceSource === 'object'
      && snapshotsEqual(evidenceSource.fieldSnapshot, currentSnapshot)
  );
  const previous = reusePreviousEvidence ? evidenceSource : {};
  const candidates = new Set();

  for (const candidate of Array.isArray(previous.candidates) ? previous.candidates : []) {
    const canonical = canonicalizeBookIsbn13(candidate);
    if (canonical) candidates.add(canonical);
  }

  const candidateSources = normalizeEvidenceCandidateSources(previous.candidateSources);
  const candidateSourceKeys = new Set(candidateSources.map((entry) => (
    JSON.stringify([entry.field, entry.canonicalIsbn])
  )));

  for (const field of ISBN_CANDIDATE_FIELDS) {
    const canonical = canonicalizeBookIsbn13(source[field]);
    if (!canonical) continue;
    candidates.add(canonical);
    if (field === 'editionIsbn' && reusePreviousEvidence) continue;
    const rawValue = stringifyIdentifierValue(source[field]).normalize('NFC').trim();
    const key = JSON.stringify([field, canonical]);
    if (!candidateSourceKeys.has(key)) {
      candidateSourceKeys.add(key);
      candidateSources.push({ field, value: rawValue, canonicalIsbn: canonical });
    }
  }
  candidateSources.sort((left, right) => compareStableText(
    JSON.stringify([left.field, left.value, left.canonicalIsbn]),
    JSON.stringify([right.field, right.value, right.canonicalIsbn]),
  ));

  const invalidOfficialFields = normalizeEvidenceInvalidFields(previous.invalidOfficialFields);
  const invalidKeys = new Set(invalidOfficialFields.map((entry) => JSON.stringify(entry)));
  for (const field of OFFICIAL_ISBN_FIELDS) {
    const reason = classifyInvalidOfficialIsbn(source[field]);
    if (!reason) continue;
    const entry = { field, value: evidenceValueText(source[field]), reason };
    const key = JSON.stringify(entry);
    if (!invalidKeys.has(key)) {
      invalidKeys.add(key);
      invalidOfficialFields.push(entry);
    }
  }
  invalidOfficialFields.sort((left, right) => compareStableText(
    JSON.stringify([left.field, left.value, left.reason]),
    JSON.stringify([right.field, right.value, right.reason]),
  ));

  const sortedCandidates = Array.from(candidates).sort(compareStableText);
  const canonicalIsbn = sortedCandidates.length === 1 && invalidOfficialFields.length === 0
    ? sortedCandidates[0]
    : '';
  return {
    candidates: sortedCandidates,
    candidateSources,
    invalidOfficialFields,
    hasConflictingCandidates: sortedCandidates.length > 1,
    hasInvalidOfficialFields: invalidOfficialFields.length > 0,
    canonicalIsbn,
    fieldSnapshot: createEditionFieldSnapshot(source, canonicalIsbn),
  };
}

function resetEditionIsbnEvidence(book) {
  const source = book && typeof book === 'object' ? { ...book } : {};
  delete source.editionIsbnEvidence;
  return source;
}

function getCanonicalEditionIsbnCandidates(book) {
  return [...getEditionIsbnEvidence(book).candidates];
}

function resolveCanonicalEditionIsbn(book) {
  return getEditionIsbnEvidence(book).canonicalIsbn;
}

function isbnValuesMatch(left, right) {
  const leftCanonical = canonicalizeBookIsbn13(left);
  const rightCanonical = canonicalizeBookIsbn13(right);
  return Boolean(leftCanonical && rightCanonical && leftCanonical === rightCanonical);
}

module.exports = {
  OFFICIAL_ISBN_FIELDS,
  ISBN_CANDIDATE_FIELDS,
  normalizeOfficialIsbnInput,
  canonicalizeBookIsbn13,
  hasPresentOfficialValue,
  evidenceValueText,
  createEditionFieldSnapshot,
  snapshotsEqual,
  classifyInvalidOfficialIsbn,
  getEditionIsbnEvidence,
  resetEditionIsbnEvidence,
  getCanonicalEditionIsbnCandidates,
  resolveCanonicalEditionIsbn,
  isbnValuesMatch,
};
