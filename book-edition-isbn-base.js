'use strict';

const {
  normalizeIsbn,
  isValidIsbn10,
  isValidIsbn13,
  toIsbn13,
} = require('./isbn-lookup-core-impl');
const {
  stringifyIdentifierValue,
  getOwnDataDescriptor,
  hasOwnAccessor,
  cloneJsonSafeOwnData,
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
    index === parts.length - 1 ? !/^[0-9Xx]+$/.test(part) : !/^\d+$/.test(part)
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
  if (typeof value === 'symbol') return String(value);
  if (typeof value === 'function') return '[function]';
  if (Array.isArray(value)) {
    try { return JSON.stringify(cloneJsonSafeOwnData(value)); } catch { return '[array]'; }
  }
  if (value && typeof value === 'object') {
    try { return JSON.stringify(cloneJsonSafeOwnData(value)); } catch { return '[object]'; }
  }
  return '';
}

function stableFieldValueToken(value, accessor = false) {
  if (accessor) return 'accessor:';
  if (value === undefined) return 'undefined:';
  if (value === null) return 'null:';
  const type = Array.isArray(value) ? 'array' : typeof value;
  return `${type}:${evidenceValueText(value)}`;
}

function semanticFieldValueToken(value, accessor = false) {
  if (accessor) return 'accessor:';
  const canonical = canonicalizeBookIsbn13(value);
  if (canonical) return `isbn:${canonical}`;
  return stableFieldValueToken(value, false);
}

function readField(source, field) {
  const descriptor = getOwnDataDescriptor(source, field);
  if (descriptor) return { exists: true, accessor: false, value: descriptor.value };
  if (hasOwnAccessor(source, field)) return { exists: true, accessor: true, value: undefined };
  return { exists: false, accessor: false, value: undefined };
}

function createEditionFieldSnapshot(source, emittedEditionIsbn) {
  const record = source && typeof source === 'object' ? source : {};
  const result = {};
  for (const field of ISBN_CANDIDATE_FIELDS) {
    if (field === 'editionIsbn' && arguments.length >= 2) {
      result[field] = stableFieldValueToken(emittedEditionIsbn);
      continue;
    }
    const observation = readField(record, field);
    result[field] = stableFieldValueToken(observation.value, observation.accessor);
  }
  return result;
}

function createEditionSemanticSnapshot(source, emittedEditionIsbn) {
  const record = source && typeof source === 'object' ? source : {};
  const result = {};
  for (const field of ISBN_CANDIDATE_FIELDS) {
    if (field === 'editionIsbn' && arguments.length >= 2) {
      result[field] = semanticFieldValueToken(emittedEditionIsbn);
      continue;
    }
    const observation = readField(record, field);
    result[field] = semanticFieldValueToken(observation.value, observation.accessor);
  }
  return result;
}

function snapshotsEqual(left, right) {
  return Boolean(left && right && ISBN_CANDIDATE_FIELDS.every((field) => left[field] === right[field]));
}

function classifyInvalidOfficialIsbn(value, accessor = false) {
  if (accessor) return 'unsupported_accessor';
  if (!hasPresentOfficialValue(value)) return '';
  const supportedType = typeof value === 'string'
    || typeof value === 'bigint'
    || (typeof value === 'number' && Number.isFinite(value));
  if (!supportedType) return 'unsupported_type';
  if (canonicalizeBookIsbn13(value)) return '';
  if (!normalizeOfficialIsbnInput(value)) return 'invalid_syntax';
  return 'invalid_isbn';
}

module.exports = {
  OFFICIAL_ISBN_FIELDS,
  ISBN_CANDIDATE_FIELDS,
  normalizeOfficialIsbnInput,
  canonicalizeBookIsbn13,
  hasPresentOfficialValue,
  evidenceValueText,
  stableFieldValueToken,
  semanticFieldValueToken,
  readField,
  createEditionFieldSnapshot,
  createEditionSemanticSnapshot,
  snapshotsEqual,
  classifyInvalidOfficialIsbn,
};
