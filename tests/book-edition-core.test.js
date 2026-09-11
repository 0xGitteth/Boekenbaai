'use strict';
const assert = require('assert');
const c = require('../book-edition-core');
const eq = (a, b, m) => assert.deepStrictEqual(a, b, m);

// ISBN syntax + canonicalization.
for (const [value, expected] of [
  ['0-306-40615-2', '9780306406157'],
  ['0 306 40615 2', '9780306406157'],
  ['978-0-306-40615-7', '9780306406157'],
  ['978 0 306 40615 7', '9780306406157'],
  ['978   0 306 40615 7', '9780306406157'],
  [9780306406157, '9780306406157'],
  ['copy-9780306406157', ''],
  ['ISBN 9780306406157', ''],
  ['-9780306406157', ''],
  ['--9780306406157', ''],
  ['9780306406157-', ''],
  ['978-03-0640615-7', ''],
  ['4006381333931', ''],
  [-9780306406157, ''],
]) assert.strictEqual(c.canonicalizeBookIsbn13(value), expected, String(value));

// Durable conflicting ISBN evidence.
let evidence = c.getEditionIsbnEvidence({
  editionIsbn: '9780306406157',
  metadataIsbn: '9783161484100',
});
eq(evidence.candidates, ['9780306406157', '9783161484100']);
assert.strictEqual(evidence.hasConflictingCandidates, true);
assert.strictEqual(evidence.canonicalIsbn, '');
let shaped = c.normalizeBookIdentityShape({
  id: 'conflict',
  title: 'Book',
  author: 'Author',
  editionIsbn: '9780306406157',
  metadataIsbn: '9783161484100',
});
assert.strictEqual(shaped.editionIsbn, '');
eq(shaped.editionIsbnEvidence.candidates, ['9780306406157', '9783161484100']);
const reshaped = c.normalizeBookIdentityShape(shaped);
eq(reshaped.editionIsbnEvidence, shaped.editionIsbnEvidence, 'Conflict evidence must survive normalization');
let regrouped = c.groupBookCopiesByEdition([reshaped]);
assert.strictEqual(regrouped.conflicts[0].type, 'conflicting_edition_isbns');
eq(regrouped.conflicts[0].editionIsbns, ['9780306406157', '9783161484100']);

// Invalid official ISBN remains a durable source error.
shaped = c.normalizeBookIdentityShape({
  id: 'bad', title: 'Book', author: 'Author', editionIsbn: '--9780306406157', metadataIsbn: '9780306406157',
});
assert.strictEqual(shaped.editionIsbn, '');
assert.strictEqual(shaped.editionIsbnEvidence.invalidOfficialFields.length, 1);
assert.strictEqual(shaped.editionIsbnEvidence.invalidOfficialFields[0].reason, 'invalid_syntax');
regrouped = c.groupBookCopiesByEdition([shaped]);
assert.strictEqual(regrouped.conflicts[0].type, 'invalid_official_isbn');
assert.strictEqual(regrouped.groups[0].hasIdentityConflict, true);
assert.strictEqual(regrouped.groups[0].copies[0].editionIsbn, '');
regrouped = c.groupBookCopiesByEdition(regrouped.groups[0].copies);
assert.strictEqual(regrouped.conflicts[0].type, 'invalid_official_isbn', 'Invalid ISBN must survive regrouping');

// Explicit ISBN corrections supersede stale evidence while unrelated edits do not.
// Use a fresh conflicting example for correction.
const staleConflict = c.normalizeBookIdentityShape({
  title: 'Book', author: 'Author', editionIsbn: '9780306406157', metadataIsbn: '9783161484100',
});
const unrelatedEdit = c.normalizeBookIdentityShape({ ...staleConflict, title: 'Book revised' });
eq(unrelatedEdit.editionIsbnEvidence.candidates, ['9780306406157', '9783161484100']);
const corrected = c.normalizeBookIdentityShape({ ...staleConflict, metadataIsbn: '9780306406157' });
assert.strictEqual(corrected.editionIsbn, '9780306406157');
eq(corrected.editionIsbnEvidence.candidates, ['9780306406157']);
assert.strictEqual(c.getEditionKey(corrected), 'isbn13||9780306406157');
// A correction flow can also explicitly accept an already-present source value.
const invalidPlusMetadata = c.normalizeBookIdentityShape({
  title: 'Book', author: 'Author', editionIsbn: 'bad-value', metadataIsbn: '9780306406157',
});
assert.strictEqual(c.getEditionKey(invalidPlusMetadata), null);
const resetSource = c.resetEditionIsbnEvidence(invalidPlusMetadata);
assert.ok(!Object.hasOwn(resetSource, 'editionIsbnEvidence'));
assert.ok(Object.hasOwn(invalidPlusMetadata, 'editionIsbnEvidence'), 'Reset helper must not mutate input');
const acceptedExistingMetadata = c.normalizeBookIdentityShape(resetSource);
assert.strictEqual(acceptedExistingMetadata.editionIsbn, '9780306406157');
assert.strictEqual(c.getEditionKey(acceptedExistingMetadata), 'isbn13||9780306406157');

// Present but unsupported official-field types are conflicts, not missing values.
for (const unsupported of [true, false, NaN, Infinity, [], [9780306406157], {}, { value: '9780306406157' }]) {
  const invalid = c.groupBookCopiesByEdition([{ title: 'T', author: 'A', editionIsbn: unsupported }]);
  assert.strictEqual(invalid.conflicts[0].type, 'invalid_official_isbn');
  assert.strictEqual(invalid.conflicts[0].invalidFields[0].reason, 'unsupported_type');
  const retry = c.groupBookCopiesByEdition(invalid.groups[0].copies);
  assert.strictEqual(retry.conflicts[0].type, 'invalid_official_isbn');
}

// Unsupported values in `isbn13` follow the same rule.
const unsupportedIsbn13 = c.groupBookCopiesByEdition([{ title: 'T', author: 'A', isbn13: { nope: true } }]);
assert.strictEqual(unsupportedIsbn13.conflicts[0].type, 'invalid_official_isbn');
assert.strictEqual(unsupportedIsbn13.conflicts[0].invalidFields[0].field, 'isbn13');

// Numeric-only titles such as 1984 survive identity and display normalization.
const numericTitle = c.groupBookCopiesByEdition([{ title: 1984, author: 'George Orwell', metadataIsbn: 'legacy-1984' }]);
assert.strictEqual(numericTitle.groups[0].title, '1984');
assert.ok(numericTitle.groups[0].key.includes('1984'));
const numericTitleWithIsbn = c.groupBookCopiesByEdition([{ title: 1984, author: 'George Orwell', metadataIsbn: '9780306406157' }]);
assert.strictEqual(numericTitleWithIsbn.groups[0].title, '1984');

// Invalid checksum official field is also preserved, not treated as absent.
regrouped = c.groupBookCopiesByEdition([
  { id: 'bad-check', title: 'Book', author: 'Author', editionIsbn: '9780306406158' },
  { id: 'bad-check-2', title: 'Book', author: 'Author', editionIsbn: '9780306406159' },
]);
assert.strictEqual(regrouped.groups.length, 2);
assert.ok(regrouped.conflicts.every((entry) => entry.type === 'invalid_official_isbn'));

// Placeholders never beat a real fallback author.
eq(c.normalizeAuthorList(['nvt'], 'Kluun'), ['Kluun']);
eq(c.normalizeAuthorList(['N.V.T.'], 'Kluun'), ['Kluun']);
eq(c.normalizeAuthorList(['niet van toepassing'], 'Kluun'), ['Kluun']);
eq(c.normalizeAuthorList([{ displayName: 'nvt', name: 'Kluun' }]), ['Kluun']);
eq(c.normalizeAuthorList([{ displayName: '   ', name: 'Kluun' }]), ['Kluun']);
eq(c.normalizeAuthorList([null, ' ', {}], 'Kluun'), ['Kluun']);
shaped = c.normalizeBookIdentityShape({ author: 'Kluun', authors: ['nvt'] });
assert.strictEqual(shaped.author, 'Kluun');
eq(shaped.authors, ['Kluun']);

// Structured authors remain structured in identity keys.
assert.notStrictEqual(
  c.getLegacyEditionKey({ title: 'B', authors: ['A & B', 'C'], metadataIsbn: 'x' }),
  c.getLegacyEditionKey({ title: 'B', authors: ['A', 'B & C'], metadataIsbn: 'x' }),
);
assert.strictEqual(
  c.getLegacyEditionKey({ title: 'B', authors: ['A', 'B'], metadataIsbn: 'x' }),
  c.getLegacyEditionKey({ title: 'B', authors: ['B', 'A'], metadataIsbn: 'x' }),
);

// Delimiter collisions and numeric legacy IDs stay distinct.
assert.notStrictEqual(
  c.getLegacyEditionKey({ title: 'a||b', author: 'c', metadataIsbn: 'd' }),
  c.getLegacyEditionKey({ title: 'a', author: 'b', metadataIsbn: 'c||d' }),
);
assert.notStrictEqual(
  c.getLegacyEditionKey({ title: 'B', author: 'A', metadataIsbn: 123 }),
  c.getLegacyEditionKey({ title: 'B', author: 'A', metadataIsbn: 456 }),
);
assert.strictEqual(c.legacyIdentifierValuesMatch('school-123', 'copy-123'), false);
assert.strictEqual(c.legacyIdentifierValuesMatch(123, '123'), true);

// Too-weak legacy evidence stays unresolved.
for (const weak of [{}, { title: 'T' }, { author: 'A' }, { metadataIsbn: 'x' }, { author: 'A', metadataIsbn: 'x' }]) {
  assert.strictEqual(c.getLegacyEditionKey(weak), null);
}
let result = c.groupBookCopiesByEdition([null, { id: 'u1' }, 'junk', { id: 'u2' }, {}]);
eq(result.conflicts.map((entry) => entry.inputIndexes[0]), [1, 3, 4]);
eq(result.groups.map((group) => group.key), ['unresolved-input||1', 'unresolved-input||3', 'unresolved-input||4']);

// Representative choice is independent of copy order and casing.
const upper = { title: 'TITLE', authors: ['Alice'] };
const lower = { title: 'title', authors: ['alice'] };
const representativeA = c.pickRepresentativeBook([upper, lower]);
const representativeB = c.pickRepresentativeBook([lower, upper]);
eq({ title: representativeA.title, authors: representativeA.authors }, { title: representativeB.title, authors: representativeB.authors });
const missingAuthor = { id: '2', title: 'Same', author: '' };
const knownAuthor = { id: '1', title: 'Same', author: 'Known Author' };
assert.strictEqual(c.pickRepresentativeBook([missingAuthor, knownAuthor]).author, 'Known Author');

// Equivalent ISBNs group; different editions stay separate.
result = c.groupBookCopiesByEdition([
  { id: 'a', title: 'Voorbeeld', author: 'Auteur', metadataIsbn: '0-306-40615-2' },
  { id: 'b', title: 'voorbeeld', author: 'Auteur', metadataIsbn: '9780306406157' },
  { id: 'c', title: 'Voorbeeld', author: 'Auteur', metadataIsbn: '9783161484100' },
]);
assert.strictEqual(result.groups.length, 2);
assert.deepStrictEqual(result.conflicts, []);
assert.deepStrictEqual(result.groups[0].copies.map((copy) => copy.id), ['a', 'b']);

// Same ISBN/different title is stable and maps back to source rows even without IDs.
const conflict = [
  { title: 'A', author: 'Z', metadataIsbn: '9789463361729' },
  { title: 'B', author: 'B', metadataIsbn: '9789463361729' },
  { title: 'A', author: 'A', metadataIsbn: '9789463361729' },
];
const forward = c.groupBookCopiesByEdition(conflict);
const reverse = c.groupBookCopiesByEdition([...conflict].reverse());
assert.strictEqual(forward.conflicts[0].type, 'same_isbn_different_title');
eq(forward.conflicts[0].inputIndexes, [0, 1, 2]);
eq(forward.conflicts[0].copyIds, []);
eq(forward.groups.map((group) => group.key).sort(), reverse.groups.map((group) => group.key).sort());

// Shared physical barcode never decides edition identity.
result = c.groupBookCopiesByEdition([
  { id: 'a', title: 'A', author: 'Auth', barcode: '12345', metadataIsbn: '9780306406157' },
  { id: 'b', title: 'B', author: 'Auth', barcode: '12345', metadataIsbn: '9783161484100' },
]);
assert.strictEqual(result.groups.length, 2);

// Privacy/circulation fields never enter the identity key.
const key1 = c.getEditionKey({ title: 'T', author: 'A', metadataIsbn: '9780306406157', borrowedBy: 'student-1', borrowedByClassId: 'class-1' });
const key2 = c.getEditionKey({ title: 'T', author: 'A', metadataIsbn: '9780306406157', borrowedBy: 'student-2', borrowedByClassId: 'class-2' });
assert.strictEqual(key1, key2);
assert.ok(!key1.includes('student') && !key1.includes('class'));

// Internal temporary fields never leak, and input isn't mutated.
const input = { id: 'l', title: 'L', author: 'A', metadataIsbn: 'bad', borrowedBy: 'student-1' };
const before = JSON.stringify(input);
result = c.groupBookCopiesByEdition([input]);
assert.strictEqual(JSON.stringify(input), before);
for (const group of result.groups) {
  assert.ok(!Object.hasOwn(group, 'firstSeenIndex'));
  for (const copy of group.copies) {
    assert.ok(!Object.hasOwn(copy, '__identityOrder'));
    assert.ok(!Object.hasOwn(copy, '__editionIsbnEvidence'));
  }
}

// Idempotence: normalizing a clean canonical record is stable.
const clean = c.normalizeBookIdentityShape({ title: 'T', author: 'A', metadataIsbn: '9780306406157' });
eq(c.normalizeBookIdentityShape(clean), clean);

console.log('book-edition-core tests passed');
