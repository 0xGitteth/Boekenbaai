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
const original=[
 {id:'lijsters',title:'Het web',author:'Johan Heyink',
  barcode:'9789001561330',editionIsbn:'',metadataIsbn:'',
  publisher:'Wolters-Noordhoff',status:'borrowed',borrowedBy:'pupil-1'},
 {id:'warendorf',title:'Het web',author:'Johan Heyink',
  barcode:'9789026997471',editionIsbn:'9789026997471',metadataIsbn:'',
  publisher:'Van Holkema & Warendorf',status:'available'},
];
const previous=groupBooksByTitleAuthor(original);
assert.equal(previous.length,2,
  'Different publisher/ISBN editions of Het web have separate catalog cards');
assert.deepEqual(previous.map(group=>group.copies.map(copy=>copy.id)),
  [['lijsters'],['warendorf']]);
assert.notEqual(getBookGroupKey(original[0]),getBookGroupKey(original[1]));
const corrected=structuredClone(original);
corrected[0].editionIsbn='9789001561383';
corrected[0].barcode='9789001561383';
assert.equal(groupBooksByTitleAuthor(corrected).length,2,
  'The corrected ISBN remains separate from the other physical edition');
const sameEdition=[corrected[0],{
  ...corrected[0],id:'second-physical-copy',barcode:'COPY-105',
  status:'available',borrowedBy:null,
}];
assert.equal(groupBooksByTitleAuthor(sameEdition).length,1,
  'Two genuine physical copies sharing an edition ISBN remain one edition');
const differentPublisher=[{...original[0],barcode:'wrong1'},
  {...original[0],id:'second',barcode:'wrong2',publisher:'Ander huis'}];
assert.equal(groupBooksByTitleAuthor(differentPublisher).length,2,
  'Legacy items without an ISBN must be differentiated by their publisher');
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
