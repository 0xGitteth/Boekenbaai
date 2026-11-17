'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../public/staff.html'),'utf8');
const extract=(begin,end)=>{
  const a=source.indexOf(begin),b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a,'Missing JS block '+begin);
  return source.slice(a,b);
};
const factory=new Function([
  'const normalizeRenderedCoverUrl=value=>value||"";',
  'const normalizedDisplayCoverCrop=()=>null;',
  extract('function normalizeGroupKeyPart(', 'function pickRepresentativeBook('),
  extract('function pickRepresentativeBook(','function groupBooksByTitleAuthor('),
  extract('function groupBooksByTitleAuthor(','function bookLocationSummary('),
  'return {getBookGroupKey,groupBooksByTitleAuthor};',
].join('\n'));
const {getBookGroupKey,groupBooksByTitleAuthor}=factory();
const resolveEditionMetadataKey=new Function([
  "const normalizeBarcode=value=>String(value??'').replace(/[^0-9X]/gi,'');",
  extract('function catalogEditionIsbn(', 'function catalogStoredEdition('),
  extract('function resolveBookMetadataKey(', 'function generateTemporaryPassword('),
  'return resolveBookMetadataKey;',
].join('\n'))();
assert.equal(resolveEditionMetadataKey({
  barcode:'1001',editionIsbn:'9789001561383',metadataIsbn:'',
}), '9789001561383',
  'An internal barcode must not override the verified edition for metadata lookup');
assert.equal(resolveEditionMetadataKey({
  barcode:'1001',editionIsbn:'',metadataIsbn:'0306406152',
}), '9780306406157','A valid metadata ISBN-10 must become ISBN-13');
assert.equal(resolveEditionMetadataKey({
  barcode:'9789026997471',editionIsbn:'',metadataIsbn:'',
}), '9789026997471',
  'Older physical books may still use the print barcode for metadata');
const original=[
 {id:'lijsters',title:'Het web',author:'Johan Heyink',
  barcode:'9789001561330',editionIsbn:'',metadataIsbn:'',
  publisher:'Wolters-Noordhoff',status:'borrowed',borrowedBy:'pupil-1'},
 {id:'warendorf',title:'Het web',author:'Johan Heyink',
  barcode:'9789026997471',editionIsbn:'9789026997471',metadataIsbn:'',
  publisher:'Van Holkema & Warendorf',status:'available'},
];
const previous=groupBooksByTitleAuthor(original);
assert.equal(previous.length,1,
  'Different publishers of the same work must display as one catalog card');
assert.deepEqual(previous[0].copies.map(copy=>copy.id),['lijsters','warendorf'],
  'The two physical records must stay separate inside the work card');
assert.equal(previous[0].editionCount,2);
assert.equal(previous[0].availableCopies,1);
assert.equal(previous[0].borrowedCopies,1);
assert.equal(getBookGroupKey(original[0]),getBookGroupKey(original[1]));
const corrected=structuredClone(original);
corrected[0].editionIsbn='9789001561383';
corrected[0].barcode='9789001561383';
const correctedGroup=groupBooksByTitleAuthor(corrected);
assert.equal(correctedGroup.length,1);
assert.equal(correctedGroup[0].editionCount,2,
  'Correcting one ISBN does not merge the physical editions or create a duplicate card');
assert.equal(correctedGroup[0].copies[0].editionIsbn,'9789001561383');
assert.equal(correctedGroup[0].copies[1].editionIsbn,'9789026997471');
const sameEdition=[corrected[0],{
  ...corrected[0],id:'second-physical-copy',barcode:'COPY-105',
  status:'available',borrowedBy:null,
}];
assert.equal(groupBooksByTitleAuthor(sameEdition).length,1);
assert.equal(groupBooksByTitleAuthor(sameEdition)[0].editionCount,1,
  'Two physical copies sharing the same ISBN are one edition');
const differentPublisher=[{...original[0],barcode:'wrong1'},
  {...original[0],id:'second',barcode:'wrong2',publisher:'Ander huis'}];
assert.equal(groupBooksByTitleAuthor(differentPublisher).length,1);
assert.equal(groupBooksByTitleAuthor(differentPublisher)[0].editionCount,2,
  'Unnumbered physical editions of one work stay distinguishable by publisher');
assert.match(html,/id="admin-book-edition-isbn"/);
assert.match(source,/adminBookEditionIsbn\.value = book\.editionIsbn \|\| ''/);
assert.match(source,/editionIsbn: editionIsbnValue/);
assert.match(source,/bookDetailState\.editCopySelector/,
  'The physical-copy selector must update the selected record for editing');
assert.match(html,/id="book-detail-edit-copy"/,
  'The staff book detail view must offer a single copy picker');
assert.doesNotMatch(source,/bookCopyEditor/,
  'A second unsynchronized copy picker would risk editing a wrong copy');
assert.match(source,/openBookDetail\(chosenBook\)/);
console.log('Edition-aware catalog groups and administrator copy editing OK');
