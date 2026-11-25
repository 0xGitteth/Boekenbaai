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
const manuallyRead={...db,examReadingLists:[{
  studentId:'s',externalSource:false,manualStatus:'gelezen',
  title:'Geheim van de stad',author:'Schrijver Geheim van de stad',
}]};
const historySignals=readKeysAndThemes(manuallyRead,'s',groupBooks(manuallyRead));
assert.ok(historySignals.readKeys.has(keyOf(db.books[0])),
  'A manually read catalogue book must be included in read signals');
assert.ok(historySignals.themes.has('mysterie'));
assert.ok(!rankBooks(manuallyRead,{route:'similar',seed:'manual'},{studentId:'s'})
  .suggestions.some(x=>x.title==='Geheim van de stad'),
  'Read catalogue titles must not be recommended again');
assert.equal(readKeysAndThemes(manuallyRead,'t',groupBooks(manuallyRead)).readKeys.size,1,
  'Reading signals must remain restricted to the active learner');

const scarceDb={books:[
  book('v1','Beschikbaar 1',['Avontuur']),
  book('v2','Beschikbaar 2',['Avontuur']),
  ...Array.from({length:6},(_,i)=>({
    ...book('z'+i,'Uitgeleend '+i,['Mysterie']),status:'borrowed',
  })),
]};
const scarce=rankBooks(scarceDb,{route:'surprise',seed:'0'});
assert.equal(scarce.suggestions.length,3);
assert.ok(scarce.suggestions.slice(0,2).every(x=>x.available>0),
  'Every available title must be selected before unavailable suggestions');


// The second, situation-specific answer must affect the actual top result.
// This is not just a conversational UI with unchanged recommendations.
const adaptiveDb={books:[
  {id:'a',title:'Het raadsel',author:'A',themes:['Detective','Mysterie'],pageCount:180,status:'available'},
  {id:'b',title:'De gevolgen',author:'B',themes:['Psychische gezondheid','Identiteit'],pageCount:180,status:'available'},
  {id:'c',title:'Magie in het bos',author:'C',themes:['Fantasy','Magie'],pageCount:220,status:'available'},
  {id:'d',title:'De uitvinder',author:'D',themes:['Sciencefiction','Technologie'],pageCount:240,status:'available'},
  {id:'e',title:'Lachen op school',author:'E',themes:['Humor','School & Opgroeien'],pageCount:120,status:'available'},
  {id:'f',title:'Vroeger',author:'F',themes:['Geschiedenis','Oorlog'],pageCount:190,status:'available'},
  {id:'g',title:'Een echte ervaring',author:'G',themes:['Waargebeurd','Biografie'],pageCount:180,status:'available'},
]};
const top=(situation,detail)=>rankBooks(adaptiveDb,{route:'new',situation,detail,seed:'fixed'})
  .suggestions[0].title;
assert.equal(top('secret','puzzles'),'Het raadsel');
assert.equal(top('secret','people'),'De gevolgen',
  'Changing the second answer must select a different book, even for the same first answer');
assert.equal(top('worlds','magic'),'Magie in het bos');
assert.equal(top('worlds','scifi'),'De uitvinder',
  'Fantasy and science fiction interests must lead to different books');
assert.equal(top('funny','schoolhumor'),'Lachen op school');
assert.equal(top('true','history'),'Vroeger');
assert.equal(top('true','lives'),'Een echte ervaring');
assert.equal(top('friends','choices'),'De gevolgen');
assert.equal(top('none','realistic'),'Lachen op school');
assert.equal(top('none','none')!==undefined,true,
  'Unknown choices must not block recommendations');
assert.equal(rankBooks(adaptiveDb,{route:'new',situation:'secret',detail:'unsafe-value'})
  .suggestions.length,3,
  'Invalid input is neutralized and cannot break rankings');
assert.ok(rankBooks(adaptiveDb,{route:'new',situation:'secret',detail:'puzzles'})
  .suggestions[0].reason.includes('Detective'),
  'Reasons should come from actual catalogue themes, not fabricated story descriptions');


// The third answer must measurably influence rank, not just chat wording.
const nuanceCrime=rankBooks(adaptiveDb,{
  route:'new',situation:'secret',detail:'puzzles',nuance:'crime',seed:'deep',
}).suggestions[0].title;
const nuanceTechnology=rankBooks(adaptiveDb,{
  route:'new',situation:'secret',detail:'puzzles',nuance:'tech_secret',seed:'deep',
}).suggestions[0].title;
assert.equal(nuanceCrime,'Het raadsel');
assert.equal(nuanceTechnology,'De uitvinder',
  'Different third answers must produce different recommendations');
const lensScience=rankBooks(adaptiveDb,{
  route:'new',situation:'none',detail:'none',nuance:'none',lens:'science',seed:'deep',
}).suggestions[0].title;
assert.equal(lensScience,'De uitvinder',
  'Fourth-answer perspective must influence the same neutral starting choices');
const invalidDeep=rankBooks(adaptiveDb,{
  route:'new',situation:'none',detail:'none',nuance:'untrusted',lens:'untrusted',
});
assert.equal(invalidDeep.suggestions.length,3,'Unknown deep answers stay neutral');
const borrowedByReference={
  books:[
    {id:'loan',title:'Al geleend',author:'A',themes:['Detective'],
      status:'available',borrowedBy:null,borrowedByClassId:null},
    {id:'missing',title:'Vermist',author:'B',themes:['Detective'],
      status:'available',catalogHidden:true},
    {id:'free',title:'Wel beschikbaar',author:'C',themes:['Detective'],
      status:'available'},
  ],
  students:[{id:'borrower',borrowedBooks:[{bookId:'loan'}]}],
};
const observed=groupBooks(borrowedByReference);
assert.equal(observed.find(x=>x.title==='Al geleend').available,0,
  'Stale book status must not produce a false available recommendation');
assert.equal(observed.some(x=>x.title==='Vermist'),false,
  'Hidden copies must not be suggested');
assert.equal(observed.find(x=>x.title==='Wel beschikbaar').available,1);

const empty=rankBooks({books:[]},{});
assert.equal(empty.emptyCatalog,true);
assert.equal(empty.suggestions.length,0);
assert.equal(keyOf(db.books[0]),keyOf(db.books[1]));

// Physical editions can have distinct nonempty blurbs. Their pooled work
// must retain *all* substantiated traits independent of copy order.
{
  const copies=[
    {id:'plain-copy',title:'Het raadselhuis',author:'Schrijver',
      description:'Een verhaal over het leven van een scholier.',status:'available'},
    {id:'detective-copy',title:'Het raadselhuis',author:'Schrijver',
      description:'Een detective volgt aanwijzingen over een geheim.',
      status:'available'},
  ];
  const pooled=groupBooks({books:copies})[0];
  assert.match(pooled.description,/leven van een scholier/);
  assert.match(pooled.description,/detective volgt aanwijzingen/);
  const backwards=groupBooks({books:[...copies].reverse()})[0];
  const dialogue=require('../student-choice-dialogue');
  assert.deepEqual(
    [...dialogue.traitsForBook(pooled).entries()].sort(),
    [...dialogue.traitsForBook(backwards).entries()].sort(),
    'Recommendation traits must not depend on physical-copy order');
  const cached=dialogue.profilesForWorks([pooled]);
  assert.strictEqual(cached,dialogue.profilesForWorks([pooled]),
    'Stable catalogue work traits must reuse one content-addressed snapshot');
  assert.notStrictEqual(cached,dialogue.profilesForWorks([{
    ...pooled,description:'Een kookboek over gezonde recepten',
  }]),'Changed catalogue metadata must invalidate the old profile snapshot');
}
// Choosing "Meer zoals dit" is not permission to mine reading history.
// The separate, explicitly consented 'similar' route may still use history.
{
  const reference={id:'ref',title:'Het kampioenschap',author:'A',
    status:'available',themes:['Sport']};
  const like={id:'like',title:'Een sportwedstrijd',author:'B',
    status:'available',themes:['Sport','Competitie']};
  const unrelated=[0,1,2,3].map(i=>({
    id:'family-'+i,title:'Gezinsverhaal '+i,author:'C',
    status:'available',themes:['Familie','Humor','Vriendschap'],
  }));
  const db2={books:[reference,like,...unrelated,{
    id:'finished',title:'Ooit gelezen',author:'D',status:'available',
    themes:['Familie','Humor','Vriendschap'],
  }],
    students:[{id:'reader',borrowedBooks:[]}],
    readingRecords:[{subjectType:'student',subjectId:'reader',
      bookId:'finished',finished:true}]};
  const withoutConsent=rankBooks(db2,{
    route:'new',referenceBookId:'ref',excludeKeys:[keyOf(reference)],
  },{studentId:'reader'});
  assert.equal(withoutConsent.suggestions[0].bookId,'like',
    'Actually shared sport traits outrank unrelated historical interests');
  assert.ok(withoutConsent.suggestions.every(item=>
    !/eerder hebt gelezen/.test(item.reason)),
    'The independent reference action may not claim consent to reading history');
  assert.ok(withoutConsent.suggestions.some(item=>
    /ander boek uit de bibliotheek/.test(item.reason.toLowerCase())),
    'Unrelated fallbacks must not falsely claim they match the chosen reference');
}

console.log('Choice rankings, read signal scoping, anti-repeat and empty catalogue tests passed.');

// Explicit interest outweighs generic anchor overlap, and open answers
// do not silently replace a known requested exclusion with random books.
const openDb={books:[
 book('ref','Drakenwereld',['Fantasy']),
 book('fant1','Andere wereld',['Fantasy']),
 book('fant2','Magische reis',['Fantasy']),
 book('science','De wetenschap',['Wetenschap','Informatief']),
 book('myst','Het raadsel',['Mysterie','Detective']),
 {...book('crime','De misdaad',['Mysterie']),description:'Een moord in de stad.'},
]};
assert.equal(rankBooks(openDb,{route:'new',referenceBookId:'ref',referencePreference:'informatie'}).suggestions[0].bookId,'science');
const open=rankBooks(openDb,{route:'new',openSignals:{prefer:['mystery'],avoid:['murder']}});
assert.deepEqual(open.suggestions.map(x=>x.bookId),['myst']);

// A rejected individual title is never a genre exclusion, but stays rejected even when repeats are requested.
{
 const books=[book('h1','Hondenverhaal',['Dieren']),book('h2','Nog een hondenverhaal',['Dieren'])];
 const result=rankBooks({books},{route:'new',openSignals:{prefer:['animals']},bookVotes:[{key:keyOf(books[0]),vote:'dislike'}],allowRepeats:true});
 assert.deepEqual(result.suggestions.map(x=>x.bookId),['h2']);
 const missing=rankBooks({books},{route:'new',openSignals:{prefer:['hamsters']}});
 assert.ok(missing.missingTopics.some(x=>x.id==='hamsters'));
}

// Explicit content combinations must not return single-feature books as matches.
{
 const books=[{id:'thriller',title:'Het geheim',author:'A',description:'Een spannende thriller.'},{id:'rep',title:'Liefde',author:'B',description:'Een verhaal met LHBTQIA+ personages.'},{id:'both',title:'De zoektocht',author:'C',description:'Een spannende thriller met LHBTQIA+ personages.'}];
 const choice={route:'new',openSignals:{prefer:['danger','queerRepresentation'],avoid:[]},required:['danger','queerRepresentation']};
 assert.deepEqual(rankBooks({books},choice).suggestions.map(x=>x.bookId),['both']);
 const missing=rankBooks({books:books.slice(0,2)},choice);
 assert.equal(missing.suggestions.length,0);
 assert.equal(missing.missingCombination.length,2);
}
