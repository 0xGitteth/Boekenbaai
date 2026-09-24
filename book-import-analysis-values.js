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

function parseBoundedDecimalInteger(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  let numeric;
  if (typeof value === 'number') {
    numeric = value;
  } else if (typeof value === 'bigint') {
    if (value < BigInt(min) || value > BigInt(max)) return null;
    numeric = Number(value);
  } else if (typeof value === 'string') {
    const text = value.normalize('NFKC').trim();
    if (!/^\d+$/.test(text)) return null;
    numeric = Number(text);
  } else {
    return null;
  }
  if (!Number.isSafeInteger(numeric) || numeric < min || numeric > max) return null;
  return numeric;
}

function parseQuantity(value) {
  if (isBlankCellValue(value)) return { value: 1, valid: true, supplied: false };
  const numeric = parseBoundedDecimalInteger(value, { min: 1, max: 1000 });
  if (numeric === null) return { value: 1, valid: false, supplied: true };
  return { value: numeric, valid: true, supplied: true };
}

function normalizeYear(value) {
  if (isBlankCellValue(value)) return null;
  if (typeof value === 'number' || typeof value === 'bigint') {
    return parseBoundedDecimalInteger(value, { min: 1000, max: 3000 });
  }
  if (typeof value !== 'string') return null;
  const text = value.normalize('NFC').trim();
  if (/^\d{4}$/.test(text)) {
    const year = Number(text);
    return year >= 1000 && year <= 3000 ? year : null;
  }
  const match = text.match(/(?:^|\D)(\d{4})(?:\D|$)/);
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 1000 && year <= 3000 ? year : null;
}

function normalizePageCount(value) {
  if (isBlankCellValue(value)) return null;
  return parseBoundedDecimalInteger(value, { min: 1, max: 100000 });
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

function normalizeRuntimeBarcode(value) {
  if (value == null) return '';
  const trimmed = String(value).trim();
  if (!trimmed) return '';
  const hasTrailingX = /x$/i.test(trimmed);
  const digitsOnly = trimmed.replace(/[^0-9]/g, '');
  if (!digitsOnly && !hasTrailingX) return '';
  return hasTrailingX ? `${digitsOnly}X` : digitsOnly;
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

function isbnLabelInfo(value) {
  const text = scalarCellText(value).normalize('NFKC').trim();
  const match = /^isbn(?:(?:\s*[-\u2010-\u2015 ]?\s*)(?:10|13))?(?=\s|:|[-\u2010-\u2015]|$)(?:\s*:\s*|\s+|\s*[-\u2010-\u2015]\s*)?(.*)$/i.exec(text);
  if (!match) return { labelled: false, text };
  return { labelled: true, text: String(match[1] ?? '').trim() };
}

function compactIdentifierText(value) {
  return isbnLabelInfo(value).text.replace(/[\s-]+/g, '');
}

function looksLikeIsbnCandidate(value) {
  if (!isSupportedIdentifierType(value)) return false;
  const label = isbnLabelInfo(value);
  if (label.labelled) return true;
  const compact = compactIdentifierText(value);
  return /^\d{8}[0-9Xx]$/.test(compact)
    || /^\d{9}[0-9Xx]$/.test(compact)
    || /^(?:978|979)\d{7,10}[0-9Xx]$/.test(compact);
}

function analyzeIdentifier(value) {
  const raw = scalarCellText(value);
  if (isBlankCellValue(value)) return { raw, canonical: '', repair: null, suggestion: null, unsupportedType: false };
  if (!isSupportedIdentifierType(value)) return { raw, canonical: '', repair: null, suggestion: null, unsupportedType: true };
  const labelled = isbnLabelInfo(raw);
  const trimmed = labelled.text;
  const direct = canonicalizeBookIsbn13(trimmed);
  if (direct) return { raw, canonical: direct, repair: null, suggestion: null, unsupportedType: false };

  const compact = compactIdentifierText(trimmed);
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
  normalizeRuntimeBarcode,
  looksLikeIsbnCandidate,
  analyzeIdentifier,
};
