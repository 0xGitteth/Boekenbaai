'use strict';
const assert = require('assert');
const c = require('../book-edition-core');
const eq = assert.deepStrictEqual;
let result;

// Conflicting evidence survives normalize/retry/JSON/cosmetic formatting.
let shaped = c.normalizeBookIdentityShape({ title:'Book', author:'Author', editionIsbn:'9780306406157', metadataIsbn:'9783161484100' });
assert.strictEqual(shaped.editionIsbn, '');
eq(shaped.editionIsbnEvidence.candidates,['9780306406157','9783161484100']);
let retry = c.normalizeBookIdentityShape(JSON.parse(JSON.stringify(shaped)));
eq(retry.editionIsbnEvidence.candidates,['9780306406157','9783161484100']);
let reformatted = c.normalizeBookIdentityShape({ ...retry, metadataIsbn:'978-3-16-148410-0' });
eq(reformatted.editionIsbnEvidence.candidates,['9780306406157','9783161484100']);
assert.strictEqual(c.groupBookCopiesByEdition([reformatted]).conflicts[0].type,'conflicting_edition_isbns');

// A real semantic correction resolves stale evidence.
let corrected = c.normalizeBookIdentityShape({ ...retry, metadataIsbn:'9780306406157' });
assert.strictEqual(corrected.editionIsbn,'9780306406157');
eq(corrected.editionIsbnEvidence.candidates,['9780306406157']);

// Derived editionIsbn is never promoted into a new source after editing the real source.
let fromIsbn13 = c.normalizeBookIdentityShape({ title:'T', author:'A', isbn13:'9780306406157' });
assert.strictEqual(fromIsbn13.editionIsbn,'9780306406157');
let changedIsbn13 = c.normalizeBookIdentityShape({ ...fromIsbn13, isbn13:'9783161484100' });
assert.strictEqual(changedIsbn13.editionIsbn,'9783161484100');
eq(changedIsbn13.editionIsbnEvidence.candidates,['9783161484100']);
let fromMetadata = c.normalizeBookIdentityShape({ title:'T', author:'A', metadataIsbn:'9780306406157' });
let changedMetadata = c.normalizeBookIdentityShape({ ...fromMetadata, metadataIsbn:'9783161484100' });
assert.strictEqual(changedMetadata.editionIsbn,'9783161484100');

// Invalid official ISBNs survive retries until genuinely corrected/reset.
shaped = c.normalizeBookIdentityShape({ title:'Book',author:'Author',editionIsbn:'--9780306406157',metadataIsbn:'9780306406157' });
assert.strictEqual(shaped.editionIsbn,'');
assert.strictEqual(shaped.editionIsbnEvidence.invalidOfficialFields[0].reason,'invalid_syntax');
retry = c.normalizeBookIdentityShape(JSON.parse(JSON.stringify(shaped)));
assert.strictEqual(retry.editionIsbnEvidence.invalidOfficialFields.length,1);
const reset = c.resetEditionIsbnEvidence(retry);
assert.ok(!Object.hasOwn(reset,'editionIsbnEvidence'));
assert.strictEqual(c.normalizeBookIdentityShape(reset).editionIsbn,'9780306406157');

// Unsupported official-field values, including accessors, are explicit conflicts.
for (const unsupported of [true,false,NaN,Infinity,[],[9780306406157],{}, {value:'9780306406157'}]) {
  const r=c.groupBookCopiesByEdition([{title:'T',author:'A',editionIsbn:unsupported}]);
  assert.strictEqual(r.conflicts[0].type,'invalid_official_isbn');
}
let isbnGetterHit=false;
const getterBook={title:'T',author:'A'};
Object.defineProperty(getterBook,'isbn13',{enumerable:true,get(){isbnGetterHit=true;throw new Error('no')}});
result=c.groupBookCopiesByEdition([getterBook]);
assert.strictEqual(isbnGetterHit,false);
assert.strictEqual(result.conflicts[0].type,'invalid_official_isbn');
assert.strictEqual(result.conflicts[0].invalidFields[0].reason,'unsupported_accessor');

// BigInt identifiers and arbitrary top-level BigInt data are JSON-safe; cycles/accessors don't crash.
const cyclic={title:'T',author:'A',metadataIsbn:9780306406157n,custom:7n}; cyclic.self=cyclic;
let unrelatedGetterHit=false;
Object.defineProperty(cyclic,'secret',{enumerable:true,get(){unrelatedGetterHit=true;throw new Error('no')}});
result=c.groupBookCopiesByEdition([cyclic]);
assert.doesNotThrow(()=>JSON.stringify(result));
assert.strictEqual(unrelatedGetterHit,false);
assert.strictEqual(result.groups[0].copies[0].metadataIsbn,'9780306406157');
assert.strictEqual(result.groups[0].copies[0].custom,'7');

// JSON-safe emission must not make invalid official ISBN evidence look edited on retry.
for (const [field, unsupported, reason] of [
  ['isbn13', NaN, 'unsupported_type'],
  ['editionIsbn', NaN, 'unsupported_type'],
  ['isbn13', Symbol('bad'), 'unsupported_type'],
  ['isbn13', function bad() {}, 'unsupported_type'],
]) {
  const raw={title:'T',author:'A'};
  Object.defineProperty(raw,field,{value:unsupported,enumerable:true,configurable:true,writable:true});
  const first=c.normalizeBookIdentityShape(raw);
  const firstInvalid=JSON.parse(JSON.stringify(first.editionIsbnEvidence.invalidOfficialFields));
  const normalizedAgain=c.normalizeBookIdentityShape(first);
  eq(normalizedAgain.editionIsbnEvidence.invalidOfficialFields,firstInvalid,`${field} evidence survives normalize`);
  const grouped=c.groupBookCopiesByEdition([raw]);
  assert.strictEqual(grouped.conflicts[0].type,'invalid_official_isbn');
  const regrouped=c.groupBookCopiesByEdition([JSON.parse(JSON.stringify(grouped.groups[0].copies[0]))]);
  assert.strictEqual(regrouped.conflicts[0].type,'invalid_official_isbn',`${field} evidence survives regroup`);
  assert.strictEqual(regrouped.conflicts[0].invalidFields[0].reason,reason);
}

// Unedited source provenance remains the original reportable ISBN representation.
for (const originalValue of ['978-0-306-40615-7','0-306-40615-2','978 0 306 40615 7']) {
  const first=c.normalizeBookIdentityShape({title:'T',author:'A',editionIsbn:originalValue});
  const originalSources=JSON.parse(JSON.stringify(first.editionIsbnEvidence.candidateSources));
  const normalizedAgain=c.normalizeBookIdentityShape(first);
  eq(normalizedAgain.editionIsbnEvidence.candidateSources,originalSources,`source value survives normalize: ${originalValue}`);
  const grouped=c.groupBookCopiesByEdition([first]);
  eq(grouped.groups[0].copies[0].editionIsbnEvidence.candidateSources,originalSources,`source value survives grouping: ${originalValue}`);
  const regrouped=c.groupBookCopiesByEdition([JSON.parse(JSON.stringify(grouped.groups[0].copies[0]))]);
  eq(regrouped.groups[0].copies[0].editionIsbnEvidence.candidateSources,originalSources,`source value survives JSON regroup: ${originalValue}`);
}

// No input mutation; normalized clean record is idempotent.
const input={id:'l',title:'L',author:'A',metadataIsbn:'bad',borrowedBy:'student-1'};
const before=JSON.stringify(input); result=c.groupBookCopiesByEdition([input]); assert.strictEqual(JSON.stringify(input),before);
const clean=c.normalizeBookIdentityShape({title:'T',author:'A',metadataIsbn:'9780306406157'});
eq(c.normalizeBookIdentityShape(clean),clean);

console.log('book edition final regressions b passed');
