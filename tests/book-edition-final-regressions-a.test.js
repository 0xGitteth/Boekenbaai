'use strict';
const assert = require('assert');
const c = require('../book-edition-core');
const eq = assert.deepStrictEqual;

// Canonical ISBN parsing rejects arbitrary cleanup but accepts plausible ISBN formatting.
for (const [input, expected] of [
  ['0-306-40615-2','9780306406157'], ['0 306 40615 2','9780306406157'],
  ['978-0-306-40615-7','9780306406157'], ['978 0 306 40615 7','9780306406157'],
  [9780306406157,'9780306406157'], [9780306406157n,'9780306406157'],
  ['copy-9780306406157',''], ['ISBN 9780306406157',''], ['-9780306406157',''], ['9780306406157-',''],
  ['978-03-0640615-7',''], ['4006381333931',''], [-9780306406157,''],
]) assert.strictEqual(c.canonicalizeBookIsbn13(input), expected, String(input));

// Placeholder/fallback authors and safe structured author reads.
eq(c.normalizeAuthorList(['nvt'], 'Kluun'), ['Kluun']);
eq(c.normalizeAuthorList([{ displayName: 'nvt', name: 'Kluun' }]), ['Kluun']);
eq(c.normalizeAuthorList([null, ' ', {}], 'Kluun'), ['Kluun']);
let getterHit = false;
const authorWithGetter = {};
Object.defineProperty(authorWithGetter, 'displayName', { enumerable: true, get(){ getterHit = true; throw new Error('no'); } });
Object.defineProperty(authorWithGetter, 'name', { enumerable: true, value: 'Safe Name' });
eq(c.normalizeAuthorList([authorWithGetter]), ['Safe Name']);
assert.strictEqual(getterHit, false);

// Legacy identity remains structured and collision-resistant.
assert.notStrictEqual(
  c.getLegacyEditionKey({ title:'B', authors:['A & B','C'], metadataIsbn:'x' }),
  c.getLegacyEditionKey({ title:'B', authors:['A','B & C'], metadataIsbn:'x' }),
);
assert.strictEqual(
  c.getLegacyEditionKey({ title:'B', authors:['A','B'], metadataIsbn:'x' }),
  c.getLegacyEditionKey({ title:'B', authors:['B','A'], metadataIsbn:'x' }),
);
assert.notStrictEqual(
  c.getLegacyEditionKey({ title:'a||b', author:'c', metadataIsbn:'d' }),
  c.getLegacyEditionKey({ title:'a', author:'b', metadataIsbn:'c||d' }),
);
for (const weak of [{}, {title:'T'}, {author:'A'}, {metadataIsbn:'x'}, {author:'A',metadataIsbn:'x'}]) {
  assert.strictEqual(c.getLegacyEditionKey(weak), null);
}
assert.strictEqual(c.legacyIdentifierValuesMatch('school-123','copy-123'), false);
assert.strictEqual(c.legacyIdentifierValuesMatch(123,'123'), true);

// Numeric titles survive.
let result = c.groupBookCopiesByEdition([{ title:1984, author:'George Orwell', metadataIsbn:'legacy-1984' }]);
assert.strictEqual(result.groups[0].title, '1984');

// ISBN-10 and ISBN-13 equivalent copies group; different editions remain separate.
result = c.groupBookCopiesByEdition([
  {id:'a', title:'Voorbeeld', author:'Auteur', metadataIsbn:'0-306-40615-2'},
  {id:'b', title:'voorbeeld', author:'Auteur', metadataIsbn:'9780306406157'},
  {id:'c', title:'Voorbeeld', author:'Auteur', metadataIsbn:'9783161484100'},
]);
assert.strictEqual(result.groups.length, 2);
eq(result.groups[0].copies.map(x=>x.id), ['a','b']);

// Same ISBN/different title stays an explicit stable conflict and preserves source indexes.
const conflict = [
  {title:'A', author:'Z', metadataIsbn:'9789463361729'},
  {title:'B', author:'B', metadataIsbn:'9789463361729'},
  {title:'A', author:'A', metadataIsbn:'9789463361729'},
];
const forward = c.groupBookCopiesByEdition(conflict);
const reverse = c.groupBookCopiesByEdition([...conflict].reverse());
assert.strictEqual(forward.conflicts[0].type, 'same_isbn_different_title');
eq(forward.conflicts[0].inputIndexes,[0,1,2]);
eq(forward.groups.map(g=>g.key).sort(), reverse.groups.map(g=>g.key).sort());

// Shared physical barcode never decides edition identity; circulation fields don't affect identity.
result = c.groupBookCopiesByEdition([
 {id:'a',title:'A',author:'Auth',barcode:'12345',metadataIsbn:'9780306406157'},
 {id:'b',title:'B',author:'Auth',barcode:'12345',metadataIsbn:'9783161484100'},
]);
assert.strictEqual(result.groups.length,2);
const k1=c.getEditionKey({title:'T',author:'A',metadataIsbn:'9780306406157',borrowedBy:'s1'});
const k2=c.getEditionKey({title:'T',author:'A',metadataIsbn:'9780306406157',borrowedBy:'s2'});
assert.strictEqual(k1,k2); assert.ok(!k1.includes('s1'));
console.log('book edition final regressions a passed');
