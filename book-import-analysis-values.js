'use strict';

const {
  canonicalizeBookIsbn13,
  normalizeBookIdentityText,
  normalizeBookIdentityComparable,
} = require('./book-edition-core');
const { isBlankCellValue, scalarCellText } = require('./book-import-workbook');

const JUNK_ONLY_TOKENS = new Set(['hh']);
const YES_VALUES = new Set(['ja', 'yes', 'true', '1', 'x']);
const NO_VALUES = new Set(['nee', 'no', 'false', '0']);

function addIssue(row, code, severity = 'warning', details = {}) {
  row.issues.push({ code, severity, ...details });
}

function valueText(value) {
  return scalarCellText(value).normalize('NFC').trim();
}

function comparableText(value) {
  return normalizeBookIdentityComparable(valueText(value));
}

function splitMultiValue(value) {
  const text = valueText(value);
  if (!text) return [];
  return text.split(/[;\n\r]+/).map((entry) => normalizeBookIdentityText(entry)).filter(Boolean);
}

function splitTagValue(value) {
  const text = valueText(value);
  if (!text) return [];
  return text.split(/[;,\n\r]+/).map((entry) => normalizeBookIdentityText(entry)).filter(Boolean);
}

function jsonSafeIdentifier(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'bigint') return String(value);
  return null;
}

function parseQuantity(value) {
  if (isBlankCellValue(value)) return { value: 1, valid: true, supplied: false };
  if (!['string', 'number', 'bigint'].includes(typeof value)) return { value: 1, valid: false, supplied: true };
  const text = valueText(value);
  if (!text) return { value: 1, valid: false, supplied: true };
  const numeric = Number(text.replace(',', '.'));
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 1000) return { value: 1, valid: false, supplied: true };
  return { value: numeric, valid: true, supplied: true };
}

function normalizeYear(value) {
  if (isBlankCellValue(value)) return null;
  const text = valueText(value);
  const numeric = Number(text);
  if (Number.isInteger(numeric) && numeric >= 1000 && numeric <= 3000) return numeric;
  const match = text.match(/(?:^|\D)(\d{4})(?:\D|$)/);
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 1000 && year <= 3000 ? year : null;
}

function normalizePageCount(value) {
  if (isBlankCellValue(value)) return null;
  const numeric = Number(valueText(value));
  return Number.isInteger(numeric) && numeric > 0 && numeric <= 100000 ? numeric : null;
}

function normalizeLanguage(value) {
  const raw = comparableText(value);
  if (!raw) return '';
  const map = new Map([
    ['nederlands', 'nl'], ['dutch', 'nl'], ['nl', 'nl'],
    ['engels', 'en'], ['english', 'en'], ['en', 'en'],
    ['duits', 'de'], ['german', 'de'], ['de', 'de'],
    ['frans', 'fr'], ['french', 'fr'], ['fr', 'fr'],
    ['spaans', 'es'], ['spanish', 'es'], ['es', 'es'],
  ]);
  return map.get(raw) || normalizeBookIdentityText(value);
}

function parseEasyReading(value) {
  const raw = comparableText(value);
  if (!raw) return { value: false, nonstandard: false };
  const standard = new Set(['ja', 'yes', 'true', '1', 'x', 'ml', 'makkelijk lezen']);
  return { value: true, nonstandard: !standard.has(raw) };
}

function parseExamMaterial(value) {
  const raw = comparableText(value);
  if (!raw) return { suitableForExamList: false, languageHint: '', formatHint: '', warning: '' };
  if (YES_VALUES.has(raw)) return { suitableForExamList: true, languageHint: '', formatHint: '', warning: '' };
  if (NO_VALUES.has(raw)) return { suitableForExamList: false, languageHint: '', formatHint: '', warning: '' };
  if (raw === 'strip') return { suitableForExamList: false, languageHint: '', formatHint: 'comic', warning: '' };
  if (raw === 'engels' || raw === 'english') return { suitableForExamList: false, languageHint: 'en', formatHint: '', warning: '' };
  return { suitableForExamList: false, languageHint: '', formatHint: '', warning: 'unexpected_exam_material_value' };
}

function isbn13CheckDigit(firstTwelve) {
  if (!/^\d{12}$/.test(firstTwelve)) return '';
  let sum = 0;
  for (let index = 0; index < 12; index += 1) sum += Number(firstTwelve[index]) * (index % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

function isSupportedIdentifierType(value) {
  if (typeof value === 'string' || typeof value === 'bigint') return true;
  return typeof value === 'number' && Number.isFinite(value) && Number.isSafeInteger(value);
}

function compactIdentifierText(value) {
  return scalarCellText(value).normalize('NFKC').trim().replace(/[\s-]+/g, '');
}

function looksLikeIsbnCandidate(value) {
  if (!isSupportedIdentifierType(value)) return false;
  const compact = compactIdentifierText(value);
  return /^\d{8}[0-9Xx]$/.test(compact)
    || /^\d{9}[0-9Xx]$/.test(compact)
    || /^(?:978|979)\d{9}$/.test(compact)
    || /^(?:978|979)\d{10}$/.test(compact);
}

function analyzeIdentifier(value) {
  const raw = scalarCellText(value);
  if (isBlankCellValue(value)) return { raw, canonical: '', repair: null, suggestion: null, unsupportedType: false };
  if (!isSupportedIdentifierType(value)) return { raw, canonical: '', repair: null, suggestion: null, unsupportedType: true };
  const direct = canonicalizeBookIsbn13(value);
  if (direct) return { raw, canonical: direct, repair: null, suggestion: null, unsupportedType: false };

  const trimmed = raw.normalize('NFKC').trim();
  const compact = compactIdentifierText(raw);
  if (/^\d{8}[0-9Xx]$/.test(trimmed)) {
    const restored = `0${trimmed}`;
    const canonical = canonicalizeBookIsbn13(restored);
    if (canonical) return { raw, canonical, repair: { kind: 'leading_zero_restored', from: raw, to: restored, canonical, confidence: 'high' }, suggestion: null, unsupportedType: false };
  }
  const unformatted = trimmed === compact;
  if (unformatted && /^(?:978|979)\d{9}$/.test(compact)) {
    const candidate = `${compact}${isbn13CheckDigit(compact)}`;
    const canonical = canonicalizeBookIsbn13(candidate);
    if (canonical) return { raw, canonical: '', repair: null, suggestion: { kind: 'missing_check_digit', from: raw, to: candidate, canonical, confidence: 'medium' }, unsupportedType: false };
  }
  if (unformatted && /^(?:978|979)\d{10}$/.test(compact)) {
    const candidate = `${compact.slice(0, 12)}${isbn13CheckDigit(compact.slice(0, 12))}`;
    const canonical = canonicalizeBookIsbn13(candidate);
    if (canonical && candidate !== compact) return { raw, canonical: '', repair: null, suggestion: { kind: 'check_digit', from: raw, to: candidate, canonical, confidence: 'medium' }, unsupportedType: false };
  }
  return { raw, canonical: '', repair: null, suggestion: null, unsupportedType: false };
}

module.exports = {
  JUNK_ONLY_TOKENS,
  addIssue,
  valueText,
  comparableText,
  splitMultiValue,
  splitTagValue,
  jsonSafeIdentifier,
  parseQuantity,
  normalizeYear,
  normalizePageCount,
  normalizeLanguage,
  parseEasyReading,
  parseExamMaterial,
  looksLikeIsbnCandidate,
  analyzeIdentifier,
};
