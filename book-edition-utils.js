'use strict';

function normalizeBookIdentityText(value) {
  if (typeof value === 'string') return value.normalize('NFC').trim().replace(/\s+/g, ' ');
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

function getOwnDataDescriptor(source, key) {
  if (!source || (typeof source !== 'object' && typeof source !== 'function')) return null;
  let descriptor;
  try { descriptor = Object.getOwnPropertyDescriptor(source, key); } catch { return null; }
  return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor : null;
}

function getOwnDataValue(source, key) {
  const descriptor = getOwnDataDescriptor(source, key);
  return descriptor ? descriptor.value : undefined;
}

function hasOwnAccessor(source, key) {
  if (!source || (typeof source !== 'object' && typeof source !== 'function')) return false;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    return Boolean(descriptor && !Object.prototype.hasOwnProperty.call(descriptor, 'value'));
  } catch {
    return true;
  }
}

function cloneJsonSafeOwnData(value, seen = new WeakMap()) {
  if (value === null) return null;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return value;
  if (type === 'number') return Number.isFinite(value) ? value : null;
  if (type === 'bigint') return String(value);
  if (type === 'undefined' || type === 'symbol' || type === 'function') return undefined;
  if (type !== 'object') return undefined;
  if (seen.has(value)) return '[Circular]';

  if (Array.isArray(value)) {
    const result = [];
    seen.set(value, result);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = getOwnDataDescriptor(value, String(index));
      const cloned = descriptor ? cloneJsonSafeOwnData(descriptor.value, seen) : undefined;
      result.push(cloned === undefined ? null : cloned);
    }
    return result;
  }

  const result = {};
  seen.set(value, result);
  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { return result; }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) continue;
    const cloned = cloneJsonSafeOwnData(descriptor.value, seen);
    if (cloned !== undefined) {
      Object.defineProperty(result, key, { value: cloned, enumerable: true, configurable: true, writable: true });
    }
  }
  return result;
}

module.exports = {
  normalizeBookIdentityText,
  normalizeBookIdentityComparable,
  stringifyIdentifierValue,
  normalizeLegacyIdentifier,
  compareStableText,
  encodeIdentityTuple,
  getOwnDataDescriptor,
  getOwnDataValue,
  hasOwnAccessor,
  cloneJsonSafeOwnData,
};
