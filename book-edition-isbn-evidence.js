'use strict';

const {
  normalizeBookIdentityText,
  compareStableText,
  getOwnDataValue,
  cloneJsonSafeOwnData,
} = require('./book-edition-utils');
const {
  OFFICIAL_ISBN_FIELDS,
  ISBN_CANDIDATE_FIELDS,
  canonicalizeBookIsbn13,
  evidenceValueText,
  stableFieldValueToken,
  semanticFieldValueToken,
  readField,
  createEditionFieldSnapshot,
  createEditionSemanticSnapshot,
  classifyInvalidOfficialIsbn,
} = require('./book-edition-isbn-base');

function normalizeEvidenceInvalidFields(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  const seen = new Set();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const field = OFFICIAL_ISBN_FIELDS.includes(getOwnDataValue(entry, 'field'))
      ? getOwnDataValue(entry, 'field') : '';
    const rawValue = normalizeBookIdentityText(getOwnDataValue(entry, 'value'));
    const reason = normalizeBookIdentityText(getOwnDataValue(entry, 'reason')) || 'invalid_isbn';
    if (!field || !rawValue) continue;
    const key = JSON.stringify([field, rawValue, reason]);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ field, value: rawValue, reason });
  }
  return result.sort((a, b) => compareStableText(JSON.stringify(a), JSON.stringify(b)));
}

function normalizeEvidenceCandidateSources(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  const seen = new Set();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const field = getOwnDataValue(entry, 'field');
    if (!ISBN_CANDIDATE_FIELDS.includes(field)) continue;
    const rawValue = normalizeBookIdentityText(getOwnDataValue(entry, 'value'));
    const canonicalIsbn = canonicalizeBookIsbn13(getOwnDataValue(entry, 'canonicalIsbn') || rawValue);
    if (!rawValue || !canonicalIsbn) continue;
    const key = JSON.stringify([field, canonicalIsbn]);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ field, value: rawValue, canonicalIsbn });
  }
  return result.sort((a, b) => compareStableText(
    JSON.stringify([a.field, a.value, a.canonicalIsbn]),
    JSON.stringify([b.field, b.value, b.canonicalIsbn]),
  ));
}

function getPreviousEvidence(source) {
  const value = getOwnDataValue(source, 'editionIsbnEvidence');
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function fieldWasEdited(previous, source, field) {
  if (!previous) return true;
  const current = readField(source, field);
  const currentSemantic = semanticFieldValueToken(current.value, current.accessor);
  const previousSemantic = getOwnDataValue(previous, 'fieldSemanticSnapshot');
  if (previousSemantic && typeof previousSemantic === 'object') {
    return currentSemantic !== getOwnDataValue(previousSemantic, field);
  }
  const previousRaw = getOwnDataValue(previous, 'fieldSnapshot');
  if (previousRaw && typeof previousRaw === 'object') {
    return stableFieldValueToken(current.value, current.accessor) !== getOwnDataValue(previousRaw, field);
  }
  return true;
}

function getEditionIsbnEvidence(book) {
  const source = book && typeof book === 'object' && !Array.isArray(book) ? book : {};
  const previous = getPreviousEvidence(source);
  const previousSources = normalizeEvidenceCandidateSources(getOwnDataValue(previous, 'candidateSources'));
  const previousInvalid = normalizeEvidenceInvalidFields(getOwnDataValue(previous, 'invalidOfficialFields'));
  const candidateSources = [];
  const invalidOfficialFields = [];

  for (const field of ISBN_CANDIDATE_FIELDS) {
    const edited = fieldWasEdited(previous, source, field);
    const priorForField = previousSources.filter((entry) => entry.field === field);
    const observation = readField(source, field);
    const canonical = observation.accessor ? '' : canonicalizeBookIsbn13(observation.value);

    if (!edited && priorForField.length) {
      candidateSources.push(...priorForField.map((entry) => ({ ...entry })));
    } else if (edited && canonical) {
      candidateSources.push({
        field,
        value: normalizeBookIdentityText(observation.value),
        canonicalIsbn: canonical,
      });
    } else if (!previous && canonical) {
      candidateSources.push({
        field,
        value: normalizeBookIdentityText(observation.value),
        canonicalIsbn: canonical,
      });
    }

    if (OFFICIAL_ISBN_FIELDS.includes(field)) {
      const priorInvalid = previousInvalid.filter((entry) => entry.field === field);
      const reason = classifyInvalidOfficialIsbn(observation.value, observation.accessor);
      if (!edited && priorInvalid.length) {
        invalidOfficialFields.push(...priorInvalid.map((entry) => ({ ...entry })));
      } else if (reason) {
        invalidOfficialFields.push({
          field,
          value: observation.accessor ? '[accessor]' : evidenceValueText(observation.value),
          reason,
        });
      }
    }
  }

  const normalizedSources = normalizeEvidenceCandidateSources(candidateSources);
  const normalizedInvalid = normalizeEvidenceInvalidFields(invalidOfficialFields);
  const candidates = Array.from(new Set(normalizedSources.map((entry) => entry.canonicalIsbn))).sort(compareStableText);
  const canonicalIsbn = candidates.length === 1 && normalizedInvalid.length === 0 ? candidates[0] : '';
  return {
    candidates,
    candidateSources: normalizedSources,
    invalidOfficialFields: normalizedInvalid,
    hasConflictingCandidates: candidates.length > 1,
    hasInvalidOfficialFields: normalizedInvalid.length > 0,
    canonicalIsbn,
    fieldSnapshot: createEditionFieldSnapshot(source, canonicalIsbn),
    fieldSemanticSnapshot: createEditionSemanticSnapshot(source, canonicalIsbn),
  };
}

function resetEditionIsbnEvidence(book) {
  const source = cloneJsonSafeOwnData(book && typeof book === 'object' ? book : {}) || {};
  delete source.editionIsbnEvidence;
  return source;
}

function getCanonicalEditionIsbnCandidates(book) {
  return [...getEditionIsbnEvidence(book).candidates];
}
function resolveCanonicalEditionIsbn(book) { return getEditionIsbnEvidence(book).canonicalIsbn; }
function isbnValuesMatch(left, right) {
  const a = canonicalizeBookIsbn13(left); const b = canonicalizeBookIsbn13(right);
  return Boolean(a && b && a === b);
}

module.exports = {
  getEditionIsbnEvidence,
  resetEditionIsbnEvidence,
  getCanonicalEditionIsbnCandidates,
  resolveCanonicalEditionIsbn,
  isbnValuesMatch,
};
