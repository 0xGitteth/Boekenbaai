'use strict';

const { getOwnDataValue, normalizeBookIdentityText } = require('./book-edition-core');
const { addIssue, comparableText, splitMultiValue, valueText, jsonSafeIdentifier } = require('./book-import-analysis-values');

const SPECIAL_FIXED_LOCATION_ALIASES = new Map([
  ['structuurbb', 'SK BB'],
  ['structuur bb', 'SK BB'],
]);
const FIXED_LOCATION_MARKERS = new Set(['vast in de klas', 'klassenboek']);
const OWN_BOOK_MARKERS = new Set(['eigen boek']);

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
  const f = mapped.fields;
  const classTokens = splitMultiValue(f.classes);
  const presenceTokens = splitMultiValue(f.libraryPresence);
  const studentLoan = valueText(f.studentLoan);
  const classLoan = valueText(f.classLoan);
  const studentMarker = comparableText(studentLoan);

  const markerTokens = [...classTokens, ...presenceTokens].map((token) => comparableText(token));
  if (OWN_BOOK_MARKERS.has(studentMarker) || markerTokens.some((token) => OWN_BOOK_MARKERS.has(token))) {
    row.context.ownBook = true;
    row.context.excludeFromSchoolCollection = true;
    addIssue(row, 'own_book_excluded', 'info');
    return;
  }

  const ordinaryClassTokens = classTokens.filter((token) => {
    const comparable = comparableText(token);
    return !OWN_BOOK_MARKERS.has(comparable) && !FIXED_LOCATION_MARKERS.has(comparable);
  });
  if (ordinaryClassTokens.length) {
    row.context.classContext = ordinaryClassTokens;
    addIssue(row, 'class_context_needs_review', 'warning', { values: ordinaryClassTokens });
  }

  const fixedStudentMarker = FIXED_LOCATION_MARKERS.has(studentMarker);
  const fixedOtherMarker = markerTokens.some((token) => FIXED_LOCATION_MARKERS.has(token));
  const hasFixedMarker = fixedStudentMarker || fixedOtherMarker;
  if (hasFixedMarker) {
    row.context.fixedLocation = {
      status: 'needs_review',
      label: classLoan || (ordinaryClassTokens.length === 1 ? ordinaryClassTokens[0] : ''),
      source: 'excel_marker',
    };
    addIssue(row, 'fixed_location_needs_review', 'warning', {
      marker: fixedStudentMarker ? studentLoan : 'fixed_location_marker',
      classContext: ordinaryClassTokens,
      classLoanValue: classLoan || '',
    });
  }

  const structureClassLoan = SPECIAL_FIXED_LOCATION_ALIASES.get(comparableText(classLoan));
  const hasRealStudentLoan = Boolean(studentLoan && !OWN_BOOK_MARKERS.has(studentMarker) && !FIXED_LOCATION_MARKERS.has(studentMarker));
  const classLoanIsFixedMlLocation = Boolean(structureClassLoan && row.book.easyReading && !hasRealStudentLoan);
  if (classLoanIsFixedMlLocation) {
    row.context.fixedLocation = { status: 'resolved', label: structureClassLoan, source: 'ml_class_loan_rule' };
    addIssue(row, 'ml_structuurbb_fixed_location', 'info');
  }

  if (classLoan && hasRealStudentLoan) addIssue(row, 'multiple_loan_contexts', 'conflict');
  if (classLoan && !classLoanIsFixedMlLocation && !hasFixedMarker) {
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

module.exports = { matchEntityByName, applyContext };
