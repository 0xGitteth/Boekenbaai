'use strict';
const assert=require('node:assert/strict');
const {groupBooks,keyOf,rankBooks,readKeysAndThemes}=require('../student-choice-recommendations');
const book=(id,title,themes,pages=180)=>({
  id,title,author:'Schrijver '+title,
  themes,status:'available',pageCount:pages,
});
const db={
  books:[
    book('b1','Geheim van de stad',['Mysterie','Spanning']),
    {...book('b1-copy','Geheim van de stad',['Mysterie','Spanning']),status:'borrowed'},
    book('b2','De keuze',['Vriendschap','School']),
    book('b3','Vreemde wereld',['Fantasy','Avontuur']),
    book('b4','Het nieuws',['Waargebeurd','Geschiedenis']),
    book('b5','Grapjes',['Humor']),
    book('b6','Het onderzoek',['Detective','Mysterieuze geheimen']),
    book('b7','De reis',['Avontuur']),
    book('b8','De familie',['Familie']),
  ],readingRecords:[
    {id:'r1',subjectType:'student',subjectId:'s',bookId:'b3',finished:true},
    {id:'r2',subjectType:'student',subjectId:'t',bookId:'b4',finished:true},
  ],examReadingLists:[],
};
assert.equal(groupBooks(db).length,8,'Physical copies do not create extra recommendations');
const first=rankBooks(db,{route:'similar',situation:'secret',mood:'exciting',detail:'puzzles',seed:'a'}, {studentId:'s'});
assert.equal(first.suggestions.length,3);
assert.ok(!first.suggestions.some(x=>x.bookId==='b3'),'Do not recommend previously read work');
assert.ok(first.suggestions.some(x=>x.title==='Geheim van de stad'),'Use actual curated mystery themes');
const second=rankBooks(db,{route:'similar',situation:'secret',mood:'exciting',detail:'puzzles',seed:'a'},
  {studentId:'s',seenKeys:first.suggestions.map(x=>x.key)});
assert.equal(second.suggestions.length,3);
assert.ok(second.suggestions.every(x=>!first.suggestions.some(y=>x.key===y.key)),
  'Identical answers on subsequent visits must offer new works');
const excluded=rankBooks(db,{route:'new',excludeKeys:groupBooks(db).map(x=>x.key)});
assert.equal(excluded.suggestions.length,0);
assert.equal(excluded.exhausted,true);
assert.equal(rankBooks(db,{route:'new',excludeKeys:groupBooks(db).map(x=>x.key),allowRepeats:true})
  .suggestions.length,3,'Only an explicit choice may repeat prior recommendations');
const similar=readKeysAndThemes(db,'s',groupBooks(db));
assert.ok(similar.themes.has('fantasy'));
assert.ok(!similar.themes.has('waargebeurd'),'Other learner reading data excluded');
assert.equal(readKeysAndThemes(db,'t',groupBooks(db)).readKeys.size,1);
const guest=rankBooks(db,{route:'new',seed:'x'});
assert.equal(guest.suggestions.length,3);
assert.ok(!guest.suggestions.some(x=>x.reason.includes('eerder hebt gelezen')),
  'Guest suggestions must not leak private read history');
const surprised=rankBooks(db,{route:'surprise',seed:'different'});
assert.equal(surprised.suggestions.length,3);
assert.equal(new Set(surprised.suggestions.map(item=>item.key)).size,3);
assert.ok(surprised.suggestions.every(item=>item.reason==='Een willekeurige keuze uit de bibliotheek'),
  'Without recorded loans, surprises are random and never use default genre hints');
const borrowedDb={...db,history:[
  {type:'check_out',bookId:'b1'},
  {type:'check_out',bookId:'b1-copy'},
  {type:'check_out_class',bookId:'b1'},
  {type:'check_out',bookId:'b4'},
]};
const mixed=rankBooks(borrowedDb,{route:'surprise',seed:'fixed'});
assert.equal(mixed.suggestions.length,3);
assert.equal(mixed.suggestions[0].title,'Geheim van de stad');
assert.equal(mixed.suggestions[0].reason,'Vaak geleend in Boekenbaai');
assert.equal(mixed.suggestions[1].reason,'Minder vaak geleend in Boekenbaai');
assert.equal(mixed.suggestions[2].reason,'Een willekeurige keuze uit de bibliotheek');
const newSurprises=rankBooks(borrowedDb,{route:'surprise',seed:'fixed'},{
  seenKeys:mixed.suggestions.map(item=>item.key)});
assert.ok(newSurprises.suggestions.every(item=>!mixed.suggestions.some(old=>old.key===item.key)),
  'Repeated surprise sessions must not show earlier proposals');
const personalizedSurprises=rankBooks(borrowedDb,{route:'surprise',seed:'fixed'},{studentId:'s'});
assert.ok(personalizedSurprises.suggestions.every(item=>item.title!=='Vreemde wereld'),
  'Already read titles remain excluded even in surprise mode');
const empty=rankBooks({books:[]},{});
assert.equal(empty.emptyCatalog,true);
assert.equal(empty.suggestions.length,0);
assert.equal(keyOf(db.books[0]),keyOf(db.books[1]));
console.log('Choice rankings, read signal scoping, anti-repeat and empty catalogue tests passed.');
