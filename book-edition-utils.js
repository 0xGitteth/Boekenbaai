'use strict';

function normalizeBookIdentityText(value) {
  if (typeof value === 'string') {
    return value.normalize('NFC').trim().replace(/\s+/g, ' ');
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'bigint') return String(value);
  return '';
}

function normalizeBookIdentityComparable(value) {
  return normalizeBookIdentityText(value).toLocaleLowerCase('nl-NL');
}

function stringifyIdentifierValue(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'bigint') return String(value);
  return '';
}

function normalizeLegacyIdentifier(value) {
  return normalizeBookIdentityComparable(stringifyIdentifierValue(value));
}

function compareStableText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function encodeIdentityTuple(parts) {
  return JSON.stringify(parts);
}

module.exports = {
  normalizeBookIdentityText,
  normalizeBookIdentityComparable,
  stringifyIdentifierValue,
  normalizeLegacyIdentifier,
  compareStableText,
  encodeIdentityTuple,
};
