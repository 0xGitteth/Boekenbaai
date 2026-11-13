'use strict';

const { getOwnDataValue, normalizeBookIdentityText, isPlaceholderAuthor } = require('./book-edition-core');
const { isBlankCellValue } = require('./book-import-workbook');
const { addIssue, comparableText, splitMultiValue, splitTagValue, valueText, jsonSafeIdentifier } = require('./book-import-analysis-values');

const SPECIAL_FIXED_LOCATION_ALIASES = new Map([
  ['structuurbb', 'SK BB'],
  ['structuur bb', 'SK BB'],
]);
const FIXED_LOCATION_MARKERS = new Set(['vast in de klas', 'klassenboek']);
const OWN_BOOK_MARKERS = new Set(['eigen boek']);

function markerKind(value) {
  const comparable = comparableText(value);
  if (OWN_BOOK_MARKERS.has(comparable)) return 'own_book';
  if (FIXED_LOCATION_MARKERS.has(comparable)) return 'fixed_location';
  return '';
}

function semanticValueTokens(_field, value) {
  return splitTagValue(value);
}

function semanticMarkerTokens(value, field = '') {
  return semanticValueTokens(field, value)
    .map((token) => ({ token, kind: markerKind(token) }))
    .filter((entry) => entry.kind);
}

function stripDelimitedSemanticMarkers(value) {
  const text = valueText(value);
  if (!text) return value;

  const values = [];
  const delimiters = [];
  const delimiterPattern = /[;,\n\r]+/g;
  let start = 0;
  let match;
  while ((match = delimiterPattern.exec(text))) {
    values.push(text.slice(start, match.index));
    delimiters.push(match[0]);
    start = match.index + match[0].length;
  }
  values.push(text.slice(start));

  const keptIndexes = [];
  let removedMarker = false;
  for (let index = 0; index < values.length; index += 1) {
    if (markerKind(values[index])) {
      removedMarker = true;
      continue;
    }
    if (normalizeBookIdentityText(values[index])) keptIndexes.push(index);
  }
  if (!removedMarker) return value;
  if (!keptIndexes.length) return '';

  let result = values[keptIndexes[0]].trimStart();
  for (let index = 1; index < keptIndexes.length; index += 1) {
    const previousIndex = keptIndexes[index - 1];
    const currentIndex = keptIndexes[index];
    const between = delimiters.slice(previousIndex, currentIndex);
    const delimiter = between.find((candidate) => /[;\n\r]/.test(candidate)) || between[0] || '; ';
    result += delimiter + values[currentIndex];
  }
  return result.trim();
}

function stripSemanticMarkers(value, field = '') {
  const tokens = semanticValueTokens(field, value);
  if (!tokens.length) return value;
  const containsMarker = tokens.some((token) => markerKind(token));
  if (!containsMarker) return value;
  if (field === 'tags' || field === 'themes') {
    return tokens.filter((token) => !markerKind(token)).join('; ');
  }
  return stripDelimitedSemanticMarkers(value);
}

function isPureSemanticMarker(value, field = '') {
  const tokens = semanticValueTokens(field, value);
  return Boolean(tokens.length && tokens.every((token) => markerKind(token)));
}

function contextFieldValue(field, value) {
  return stripSemanticMarkers(value, field);
}

function collectSemanticMarkers(mapped) {
  const ownBook = [];
  const fixedLocation = [];
  for (const [field, entries] of Object.entries(mapped?.sources || {})) {
    for (const entry of entries || []) {
      for (const marker of semanticMarkerTokens(entry.value, field)) {
        const target = marker.kind === 'own_book' ? ownBook : fixedLocation;
        target.push({ field, header: entry.header, value: marker.token });
      }
    }
  }
  for (const entry of mapped?.unknown || []) {
    for (const marker of semanticMarkerTokens(entry.value)) {
      const target = marker.kind === 'own_book' ? ownBook : fixedLocation;
      target.push({ field: 'unknown', header: entry.header, value: marker.token });
    }
  }
  return { ownBook, fixedLocation };
}

function getDataFields(mapped) {
  const fields = Object.create(null);
  for (const [field, entries] of Object.entries(mapped?.sources || {})) {
    const current = mapped?.fields?.[field];
    const currentValue = contextFieldValue(field, current);
    const currentIsMarkerOnly = isPureSemanticMarker(current, field);
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
    const markerOnly = isPureSemanticMarker(value, field);
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

// Exact ParnasSys class names are authoritative. These aliases are limited
// to documented codes used by the school's book worksheet; never infer a
// class from a similar-looking string or select among multiple matches.
const CLASS_CODE_ALIASES = new Map([
  ['structuurbb', ['Bovenbouw structuur', 'SK BB']],
  ['skobpro', ['Onderbouw structuur pro-basis']],
  ['skobkt', ['Onderbouw structuur KT']],
  ['ondbkt', ['Onderbouw BKT']],
  ['t3', ['VMBO theoretisch 3']],
  ['t4', ['VMBO theoretisch 4']],
  ['bk3', ['VMBO basis-kader 3']],
  ['bk4', ['VMBO basis-kader 4']],
]);

function matchClassByName(value, classes) {
  const direct = matchEntityByName(value, classes);
  if (direct.status !== 'unmatched') return direct;
  const aliases = CLASS_CODE_ALIASES.get(comparableText(value)) || [];
  const results = new Map();
  for (const alias of aliases) {
    const matched = matchEntityByName(alias, classes);
    for (const candidate of matched.matches) if (candidate.id) results.set(candidate.id, candidate);
  }
  if (results.size === 1) return { status: 'matched', matches: [...results.values()] };
  if (results.size > 1) return { status: 'ambiguous', matches: [...results.values()] };
  return direct;
}

function candidateStudentInClass(name, student, classId, classes) {
  if (!student || student.active === false || student.status === 'inactive') return false;
  const memberships = new Set(Array.isArray(student.classIds) ? student.classIds : []);
  if (student.classId) memberships.add(student.classId);
  for (const klass of classes || []) {
    if (Array.isArray(klass.studentIds) && klass.studentIds.includes(student.id)) memberships.add(klass.id);
  }
  if (!memberships.has(classId)) return false;
  const target = comparableText(name);
  const first = comparableText(student.firstName ||
    String(student.name || '').trim().split(/\s+/)[0]);
  return safeEntityNames(student).some(candidate => comparableText(candidate) === target)
    || (Boolean(first) && first === target);
}

function matchStudentWithClass(value, classHint, students, classes) {
  if (!classHint) return matchEntityByName(value, students);
  const group = matchClassByName(classHint, classes);
  if (group.status !== 'matched') return { status: group.status, matches: [], classMatch: group };
  const matches = (Array.isArray(students) ? students : []).filter(person =>
    candidateStudentInClass(value, person, group.matches[0].id, classes))
    .map(person => ({ id: jsonSafeIdentifier(person.id),
      name: safeEntityNames(person)[0] || valueText(value) }))
    .filter(person => person.id);
  if (matches.length === 1) return { status: 'matched', matches, classMatch: group };
  return { status: matches.length ? 'ambiguous' : 'unmatched', matches, classMatch: group };
}

function applyContext(mapped, row, options) {
  const f = getDataFields(mapped);
  const classTokens = splitMultiValue(f.classes);
  const rawStudentLoan = valueText(f.studentLoan);
  const studentLoan = isPlaceholderAuthor(rawStudentLoan) ? '' : rawStudentLoan;
  const classLoan = valueText(f.classLoan);
  const fixedClass = valueText(f.fixedClass);
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

  if (fixedClass) {
    const locations = splitMultiValue(fixedClass);
    if (locations.length === 1) {
      const match = matchClassByName(locations[0], options.classes);
      row.context.fixedLocation = {
        status: 'resolved',
        label: match.status === 'matched' ? match.matches[0].name : locations[0],
        raw: fixedClass,
        source: 'explicit_fixed_class',
      };
    } else {
      row.context.fixedLocation = { status: 'needs_review', label: fixedClass,
        source: 'explicit_fixed_class' };
      addIssue(row, 'fixed_location_needs_review', 'warning', { value: fixedClass });
    }
  } else if (markers.fixedLocation.length) {
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
  const classLoanIsFixedMlLocation = Boolean(!fixedClass && structureClassLoan
    && row.book.easyReading && !hasRealStudentLoan);
  if (classLoanIsFixedMlLocation) {
    row.context.fixedLocation = { status: 'resolved', label: structureClassLoan, source: 'ml_class_loan_rule' };
    addIssue(row, 'ml_structuurbb_fixed_location', 'info');
  }

  // When a named pupil is present, the class identifies their cohort;
  // it is not a second simultaneous borrower. Store it as source context
  // and require an unambiguous current class membership before matching.
  if (classLoan && hasRealStudentLoan)
    row.context.studentClassHint = { label: classLoan, source: 'Geleend door klas' };
  if (classLoan && !classLoanIsFixedMlLocation && !hasRealStudentLoan) {
    const match = matchClassByName(classLoan, options.classes);
    if (match.status === 'matched') row.context.classLoan = { status: 'matched', ...match.matches[0] };
    else {
      row.context.classLoan = { status: match.status, name: classLoan };
      addIssue(row, match.status === 'ambiguous' ? 'class_loan_ambiguous' : 'class_loan_unmatched', 'conflict', { value: classLoan });
    }
  }
  if (hasRealStudentLoan) {
    const match = matchStudentWithClass(studentLoan, classLoan, options.students, options.classes);
    if (match.status === 'matched') row.context.studentLoan = { status: 'matched', ...match.matches[0] };
    else {
      row.context.studentLoan = { status: match.status, name: studentLoan };
      addIssue(row, match.status === 'ambiguous' ? 'student_loan_ambiguous' : 'student_loan_unmatched', 'conflict', {
        value: studentLoan, classHint: classLoan || null,
      });
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
  matchClassByName,
  matchStudentWithClass,
  applyContext,
};
