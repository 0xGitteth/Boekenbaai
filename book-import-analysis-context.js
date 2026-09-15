'use strict';

const { getOwnDataValue, normalizeBookIdentityText } = require('./book-edition-core');
const { isBlankCellValue } = require('./book-import-workbook');
const { addIssue, comparableText, splitMultiValue, valueText, jsonSafeIdentifier } = require('./book-import-analysis-values');

const SPECIAL_FIXED_LOCATION_ALIASES = new Map([
  ['structuurbb', 'SK BB'],
  ['structuur bb', 'SK BB'],
]);
const FIXED_LOCATION_MARKERS = new Set(['vast in de klas', 'klassenboek']);
const OWN_BOOK_MARKERS = new Set(['eigen boek']);
const SEMANTIC_MARKER_FIELDS = new Set(['classes', 'classLoan', 'studentLoan', 'libraryPresence']);

function markerKind(value) {
  const comparable = comparableText(value);
  if (OWN_BOOK_MARKERS.has(comparable)) return 'own_book';
  if (FIXED_LOCATION_MARKERS.has(comparable)) return 'fixed_location';
  return '';
}

function semanticMarkerTokens(value) {
  return splitMultiValue(value)
    .map((token) => ({ token, kind: markerKind(token) }))
    .filter((entry) => entry.kind);
}

function stripSemanticMarkers(value) {
  const tokens = splitMultiValue(value);
  if (!tokens.length) return value;
  const containsMarker = tokens.some((token) => markerKind(token));
  if (!containsMarker) return value;
  return tokens.filter((token) => !markerKind(token)).join('; ');
}

function isPureSemanticMarker(value) {
  const tokens = splitMultiValue(value);
  return Boolean(tokens.length && tokens.every((token) => markerKind(token)));
}

function contextFieldValue(field, value) {
  return SEMANTIC_MARKER_FIELDS.has(field) ? stripSemanticMarkers(value) : value;
}

function collectSemanticMarkers(mapped) {
  const ownBook = [];
  const fixedLocation = [];
  for (const [field, entries] of Object.entries(mapped?.sources || {})) {
    if (!SEMANTIC_MARKER_FIELDS.has(field)) continue;
    for (const entry of entries || []) {
      for (const marker of semanticMarkerTokens(entry.value)) {
        const target = marker.kind === 'own_book' ? ownBook : fixedLocation;
        target.push({ field, header: entry.header, value: marker.token });
      }
    }
  }
  return { ownBook, fixedLocation };
}

function getDataFields(mapped) {
  const fields = Object.create(null);
  for (const [field, entries] of Object.entries(mapped?.sources || {})) {
    const current = mapped?.fields?.[field];
    const currentValue = contextFieldValue(field, current);
    const currentIsMarkerOnly = SEMANTIC_MARKER_FIELDS.has(field) && isPureSemanticMarker(current);
    if (!isBlankCellValue(currentValue) && !currentIsMarkerOnly) {
      fields[field] = currentValue;
      continue;
    }
    for (const entry of entries || []) {
      const cleaned = contextFieldValue(field, entry.value);
      if (isBlankCellValue(cleaned)) continue;
      fields[field] = cleaned;
      break;
    }
  }
  for (const [field, value] of Object.entries(mapped?.fields || {})) {
    if (Object.prototype.hasOwnProperty.call(fields, field)) continue;
    const cleaned = contextFieldValue(field, value);
    const markerOnly = SEMANTIC_MARKER_FIELDS.has(field) && isPureSemanticMarker(value);
    if (isBlankCellValue(cleaned) || markerOnly) continue;
    fields[field] = cleaned;
  }
  return fields;
}

function safeEntityNames(entity) {
  if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return [];
  const names = [];
  for (const key of ['name', 'fullName', 'displayName', 'title', 'code']) {
    const text = normalizeBookIdentityText(getOwnDataValue(entity, key));
    if (text) names.push(text);
  }
  const first = normalizeBookIdentityText(getOwnDataValue(entity, 'firstName'));
  const middle = normalizeBookIdentityText(getOwnDataValue(entity, 'middleName'));
  const last = normalizeBookIdentityText(getOwnDataValue(entity, 'lastName'));
  const combined = [first, middle, last].filter(Boolean).join(' ').trim();
  if (combined) names.push(combined);
  const short = [first, last].filter(Boolean).join(' ').trim();
  if (short) names.push(short);
  return Array.from(new Set(names));
}

function matchEntityByName(value, entities) {
  const target = comparableText(value);
  if (!target) return { status: 'empty', matches: [] };
  const matches = [];
  for (const entity of Array.isArray(entities) ? entities : []) {
    if (!entity || typeof entity !== 'object' || Array.isArray(entity)) continue;
    const names = safeEntityNames(entity);
    if (!names.some((name) => comparableText(name) === target)) continue;
    matches.push({ id: jsonSafeIdentifier(getOwnDataValue(entity, 'id')), name: names[0] || valueText(value) });
  }
  if (matches.length === 1) return { status: 'matched', matches };
  if (matches.length > 1) return { status: 'ambiguous', matches };
  return { status: 'unmatched', matches: [] };
}

function applyContext(mapped, row, options) {
  const f = getDataFields(mapped);
  const classTokens = splitMultiValue(f.classes);
  const studentLoan = valueText(f.studentLoan);
  const classLoan = valueText(f.classLoan);
  const libraryPresence = valueText(f.libraryPresence);
  const markers = collectSemanticMarkers(mapped);

  if (markers.ownBook.length) {
    row.context.ownBook = true;
    row.context.excludeFromSchoolCollection = true;
    if (studentLoan) row.context.studentLoan = { status: 'conflicting', name: studentLoan };
    if (classLoan) row.context.classLoan = { status: 'conflicting', name: classLoan };
    if (markers.fixedLocation.length) {
      row.context.fixedLocation = { status: 'conflicting', label: '', source: 'semantic_marker' };
    }
    if (studentLoan || classLoan || markers.fixedLocation.length) {
      addIssue(row, 'own_book_context_conflict', 'conflict', {
        studentLoan: studentLoan || '',
        classLoan: classLoan || '',
        ownBookMarkers: markers.ownBook,
        fixedLocationMarkers: markers.fixedLocation,
      });
    }
    addIssue(row, 'own_book_excluded', 'info', { markers: markers.ownBook });
    return;
  }

  if (libraryPresence) {
    row.context.libraryPresence = { status: 'needs_review', value: libraryPresence };
    addIssue(row, 'library_presence_needs_review', 'warning', { value: libraryPresence });
  }

  if (classTokens.length) {
    row.context.classContext = classTokens;
    addIssue(row, 'class_context_needs_review', 'warning', { values: classTokens });
  }

  if (markers.fixedLocation.length) {
    row.context.fixedLocation = {
      status: 'needs_review',
      label: classTokens.length === 1 ? classTokens[0] : '',
      source: 'semantic_marker',
    };
    addIssue(row, 'fixed_location_needs_review', 'warning', {
      markers: markers.fixedLocation,
      classContext: classTokens,
    });
  }

  const structureClassLoan = SPECIAL_FIXED_LOCATION_ALIASES.get(comparableText(classLoan));
  const hasRealStudentLoan = Boolean(studentLoan);
  const classLoanIsFixedMlLocation = Boolean(structureClassLoan && row.book.easyReading && !hasRealStudentLoan);
  if (classLoanIsFixedMlLocation) {
    row.context.fixedLocation = { status: 'resolved', label: structureClassLoan, source: 'ml_class_loan_rule' };
    addIssue(row, 'ml_structuurbb_fixed_location', 'info');
  }

  if (classLoan && hasRealStudentLoan) addIssue(row, 'multiple_loan_contexts', 'conflict');
  if (classLoan && !classLoanIsFixedMlLocation) {
    const match = matchEntityByName(classLoan, options.classes);
    if (match.status === 'matched') row.context.classLoan = { status: 'matched', ...match.matches[0] };
    else {
      row.context.classLoan = { status: match.status, name: classLoan };
      addIssue(row, match.status === 'ambiguous' ? 'class_loan_ambiguous' : 'class_loan_unmatched', 'conflict', { value: classLoan });
    }
  }
  if (hasRealStudentLoan) {
    const match = matchEntityByName(studentLoan, options.students);
    if (match.status === 'matched') row.context.studentLoan = { status: 'matched', ...match.matches[0] };
    else {
      row.context.studentLoan = { status: match.status, name: studentLoan };
      addIssue(row, match.status === 'ambiguous' ? 'student_loan_ambiguous' : 'student_loan_unmatched', 'conflict', { value: studentLoan });
    }
  }
}

module.exports = {
  markerKind,
  stripSemanticMarkers,
  isPureSemanticMarker,
  contextFieldValue,
  collectSemanticMarkers,
  getDataFields,
  matchEntityByName,
  applyContext,
};
