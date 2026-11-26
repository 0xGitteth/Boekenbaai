'use strict';
const assert=require('node:assert/strict');
const {getCheck,recordCheck,shouldProbe,trialView,applyTrial,catalogue,editionViews}=require('../book-enrichment-trial');
const {normalizeRecord}=require('../book-boekenbase');
const isbn='9789086960088';
const book={id:'one',metadataIsbn:isbn,title:'Hittegolf',author:'Test Auteur',tags:['Eigen'],
  importProvenance:{fieldSources:{publisher:{sourceType:'manual'}}}};
const copy={...book,id:'two',description:'Door docent geschreven',imprint:'Bestaand label',importProvenance:{fieldSources:{}}};
let db={books:[book,copy],students:[{id:'preserve'}],history:[{id:'loan'}]};
const data={isbn,title:book.title,author:book.author,publisher:'Uitgever',description:'Een spannend verhaal.',
  coverUrl:'https://example.org/front.jpg',publishedYear:2020,tags:['Paarden','Vriendschap'],
  imprint:'Nieuw label',nurCode:'282',nurCategory:'Fictie 7-9 jaar',seriesTitle:'Serie',seriesNumber:'8'};
assert.equal(shouldProbe(db,book),true);
recordCheck(db,book,{status:'found',metadata:data});
assert.equal(book.coverUrl,undefined,'Preview never modifies the catalogue');
assert.equal(shouldProbe(db,copy),false,'A second copy shares verified ISBN research');
assert.equal(shouldProbe(db,copy,true),true);
assert.equal(catalogue(db).length,1);
assert.equal(editionViews(db,book).length,2);
db=JSON.parse(JSON.stringify(db));
const current=db.books[0],second=db.books[1];
assert.equal(shouldProbe(db,current),false,'Restart retains source results');
const view=trialView(db,current);
assert.ok(view.changes.some(c=>c.field==='coverUrl'));
assert.ok(!view.changes.some(c=>c.field==='publisher'),'Manual empty field stays empty');
assert.ok(!trialView(db,second).changes.some(c=>c.field==='description'));
assert.ok(!trialView(db,second).changes.some(c=>c.field==='imprint'));
assert.equal(view.sourceDetails.keywordCount,2);
assert.equal(view.sourceDetails.nurCategory,data.nurCategory);
assert.equal(applyTrial(db,current,'invalid').ok,false);
assert.equal(applyTrial(db,current,view.revision).ok,true);
assert.deepEqual(current.tags,['Eigen']);
assert.deepEqual(current.enrichmentTags,data.tags);
assert.equal(current.imprint,data.imprint);
assert.equal(current.nurCategory,data.nurCategory);
assert.equal(current.nurCode,data.nurCode);
assert.equal(current.seriesTitle,data.seriesTitle);
assert.equal(current.seriesNumber,data.seriesNumber);
assert.ok(!current.enrichmentTags.includes(data.nurCategory));
assert.equal(current.coverUrl,data.coverUrl);
assert.equal(current.importProvenance.fieldSources.coverUrl.sourceDetail,'boekenbase');
assert.equal(second.coverUrl,undefined,'Approval is per physical copy');
assert.equal(applyTrial(db,current,view.revision).ok,false,'Cannot apply stale preview twice');
assert.deepEqual(db.students,[{id:'preserve'}]);
assert.deepEqual(db.history,[{id:'loan'}]);
recordCheck(db,current,{status:'timeout'});
assert.equal(getCheck(db,current).status,'found','Failed repeat retains earlier result');
assert.equal(getCheck(db,current).lastError,'timeout');
const changed={...current,title:'Andere titel'};
assert.equal(shouldProbe(db,changed),true,'Changed bibliographic identity is new research');
recordCheck(db,changed,{status:'found',metadata:data});
assert.equal(getCheck(db,changed).status,'identity_mismatch');
const fresh={...current,id:'new',metadataIsbn:'9789083316642'};
recordCheck(db,fresh,{status:'network_error'});
assert.equal(shouldProbe(db,fresh),true,'Temporary failure remains eligible');
recordCheck(db,fresh,{status:'not_found'});
assert.equal(shouldProbe(db,fresh),false,'A confirmed negative result is remembered');
// Exercise the actual adapter rather than a handcrafted normalized object.
const liveBook={id:'live',metadataIsbn:isbn,title:'Testtitel',author:'Test Auteur',
  coverUrl:'https://example.org/old.jpg',coverCrop:{x:0.1,y:0.2,width:0.7,height:0.7},
  importProvenance:{fieldSources:{coverUrl:{sourceType:'metadata'}}}};
const liveDb={books:[liveBook]};
const liveData=normalizeRecord({isbn13:isbn,title:liveBook.title,
  contributors:[{role:'A01',name:liveBook.author}],nur_main:'282',
  nur_main_name:'Fictie 7-9 jaar',keywords:['Paarden'],
  assets:[{kind:'vrk',url:'https://example.org/new.jpg'}]},isbn);
recordCheck(liveDb,liveBook,{status:'found',metadata:liveData});
const failed=new Set([liveBook.coverUrl]);
const liveView=trialView(liveDb,liveBook,failed);
assert.equal(liveView.sourceDetails.nurCategory,'Fictie 7-9 jaar');
assert.equal(liveView.sourceDetails.keywordCount,1);
assert.equal(applyTrial(liveDb,liveBook,liveView.revision,failed).ok,true);
assert.deepEqual(liveBook.enrichmentTags,['Paarden']);
assert.equal(liveBook.nurCategory,'Fictie 7-9 jaar');
assert.equal(liveBook.coverCrop,null);
assert.equal(liveBook.coverUrl,'https://example.org/new.jpg');
console.log('Persistent trial previews, safe approval and retry policy passed.');
