'use strict';
const assert = require('assert');
const c = require('../book-edition-core');

const A = '9780306406157';
const A10 = '0-306-40615-2';
const A_FMT = '978-0-306-40615-7';
const B = '9783161484100';
const B_FMT = '978-3-16-148410-0';
const fields = ['editionIsbn','metadataIsbn','isbn13'];
const values = [undefined, A, B, 'bad-value', 9780306406157n, true];

function recordFor(combo) {
  const r={title:'T',author:'A'};
  fields.forEach((f,i)=>{ if(combo[i]!==undefined) r[f]=combo[i]; });
  return r;
}
function evidenceSig(x){
  const e=x.editionIsbnEvidence;
  return JSON.stringify({c:e.candidates,s:e.candidateSources,i:e.invalidOfficialFields});
}

let count=0;
for (const x of values) for (const y of values) for (const z of values) {
  const raw=recordFor([x,y,z]);
  let first;
  assert.doesNotThrow(()=>{ first=c.normalizeBookIdentityShape(raw); });
  assert.doesNotThrow(()=>JSON.stringify(first));
  const viaJson=JSON.parse(JSON.stringify(first));
  const retry=c.normalizeBookIdentityShape(viaJson);
  assert.strictEqual(evidenceSig(retry), evidenceSig(first), `retry drift ${String(x)}|${String(y)}|${String(z)}`);
  assert.deepStrictEqual(c.normalizeBookIdentityShape(retry), retry, `idempotence ${String(x)}|${String(y)}|${String(z)}`);
  const grouped=c.groupBookCopiesByEdition([viaJson]);
  assert.doesNotThrow(()=>JSON.stringify(grouped));
  const expectedConflict = first.editionIsbnEvidence.candidates.length>1 || first.editionIsbnEvidence.invalidOfficialFields.length>0;
  if (expectedConflict) assert.ok(grouped.conflicts.length>0, `lost conflict ${String(x)}|${String(y)}|${String(z)}`);
  count++;
}

// Semantic-equivalent formatting never resolves existing conflict evidence.
for (const otherField of ['metadataIsbn','isbn13']) {
  let r=c.normalizeBookIdentityShape({title:'T',author:'A',editionIsbn:A,[otherField]:B});
  const beforeCandidates=JSON.stringify(r.editionIsbnEvidence.candidates);
  const beforeInvalid=JSON.stringify(r.editionIsbnEvidence.invalidOfficialFields);
  r=c.normalizeBookIdentityShape({...r,[otherField]:B_FMT});
  assert.strictEqual(JSON.stringify(r.editionIsbnEvidence.candidates),beforeCandidates, `${otherField} formatting erased candidates`);
  assert.strictEqual(JSON.stringify(r.editionIsbnEvidence.invalidOfficialFields),beforeInvalid, `${otherField} formatting changed invalid evidence`);
}

// ISBN-10/13 semantic equivalence is stable.
let r=c.normalizeBookIdentityShape({title:'T',author:'A',metadataIsbn:A10});
let r2=c.normalizeBookIdentityShape({...r,metadataIsbn:A_FMT});
assert.deepStrictEqual(r2.editionIsbnEvidence.candidates,[A]);

// Editing a real source does not accidentally promote the previously-derived editionIsbn.
for (const sourceField of ['metadataIsbn','isbn13']) {
  let original=c.normalizeBookIdentityShape({title:'T',author:'A',[sourceField]:A});
  assert.strictEqual(original.editionIsbn,A);
  let changed=c.normalizeBookIdentityShape({...original,[sourceField]:B});
  assert.strictEqual(changed.editionIsbn,B, `derived editionIsbn contaminated ${sourceField} correction`);
  assert.deepStrictEqual(changed.editionIsbnEvidence.candidates,[B]);
  assert.deepStrictEqual(c.normalizeBookIdentityShape(changed),changed);
}

// A genuine correction of one side of a conflict resolves it.
r=c.normalizeBookIdentityShape({title:'T',author:'A',editionIsbn:A,metadataIsbn:B});
r2=c.normalizeBookIdentityShape({...r,metadataIsbn:A});
assert.strictEqual(r2.editionIsbn,A);
assert.deepStrictEqual(r2.editionIsbnEvidence.candidates,[A]);

console.log(`book edition state machine passed (${count} base combinations)`);
