'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {bookMatchSuggestions}=require('../book-import-match-suggestions');
const {analyzeReviewedImport}=require('../book-import-review');
const ISBN='9780306406157',OTHER='9780439554930';

function row(extra={}){
  return {index:0,sourceRowNumber:25,status:'unresolved',
    book:{title:'Mijn boek',author:'Jan Jansen',editionIsbn:''},
    identifierAnalysis:{explicit:{raw:'9780306406156'}},issues:[],...extra};
}
(async()=>{
  const current=[
    {id:'copy-private-1',title:'Mijn boek',author:'Jan Jansen',
      editionIsbn:ISBN,status:'borrowed',borrowedBy:'student-secret',
      borrowedByClassId:'class-secret',barcode:'printed-secret',
      coverUrl:'https://example.org/book.jpg'},
    {id:'copy-private-2',title:'Mijn boek',author:'Jan Jansen',editionIsbn:ISBN},
    {id:'copy-else',title:'Mijn boek 2',author:'Someone Else',editionIsbn:OTHER},
  ];
  const matches=bookMatchSuggestions(row(),current);
  assert.equal(matches.length,1);
  assert.deepEqual(matches[0].sources,[]);
  assert.equal(matches[0].editionIsbn,ISBN);
  assert.equal(matches[0].copies,2);
  assert.equal(matches[0].origin,'existing');
  for(const secret of ['student-secret','class-secret','copy-private-1','printed-secret'])
    assert.ok(!JSON.stringify(matches).includes(secret),'Do not expose '+secret);

  const online=bookMatchSuggestions(row({
    onlineMatchCandidates:[
      {title:'Mijn boek',author:'Jan Jansen',editionIsbn:OTHER,
        coverUrl:'https://example.org/other.jpg',sources:['Google Books']},
    ],
  }),current);
  assert.equal(online.length,2);
  assert.ok(online.some(candidate=>candidate.origin==='online'
    &&candidate.editionIsbn===OTHER));
  const withoutInventory=bookMatchSuggestions(row({
    onlineMatchCandidates:[{title:'Mijn boek',author:'Jan Jansen',
      editionIsbn:OTHER,sources:['Google Books']}],
  }),[]);
  assert.equal(withoutInventory[0].origin,'online',
    'Books not yet in Boekenbaai can be proposed from public catalogues');

  assert.deepEqual(bookMatchSuggestions(row({status:'skipped'}),current),[]);
  assert.deepEqual(bookMatchSuggestions(row({
    book:{title:'Mijn boek',author:'Jan Jansen',editionIsbn:ISBN},
    status:'ready',
  }),current),[],'Do not show extra proposals for accepted exact ISBNs');
  assert.equal(bookMatchSuggestions(row({
    book:{title:'Mijn boek',author:'J. Jansen',editionIsbn:ISBN},
    status:'conflict',issues:[{code:'author_sources_differ',severity:'conflict'}],
  }),current)[0].editionIsbn,ISBN,
  'A trustworthy ISBN still finds the existing book when author data is wrong');

  const titleOnly=bookMatchSuggestions(row({
    book:{title:'Mijn boek',author:'Someone Else',editionIsbn:''},
  }),current);
  assert.ok(titleOnly.some(candidate=>candidate.identityWarning===true),
    'Tentative title-only matches must be visibly flagged');

  const many=Array.from({length:100},(_,i)=>({
    title:'Mijn boek',author:'Jan Jansen',editionIsbn:ISBN,
    id:'copy-'+i,
  }));
  assert.equal(bookMatchSuggestions(row(),many)[0].copies,100,
    'Many physical copies must be summarized, not repeated');

  // Repeated uploads and subsequent corrections use the same analyzer and
  // the normal review/apply boundary. Candidate data alone cannot bypass
  // a missing ISBN or create an imported book.
  const original=[{Titel:'Mijn boek',Auteur:'Jan Jansen',
    'ISBN-nummer':'9780306406156',Aantal:1}];
  const result=await analyzeReviewedImport(original,[],{
    mode:'unified_sync',existingBooks:current,
    lookupTitleAuthor:async()=>({
      found:true,title:'Mijn boek',author:'Jan Jansen',
      isbnSearchCandidates:[OTHER],
      source:'googlebooks-title-author',
    }),
  });
  assert.ok(result.ok);
  assert.equal(result.rows[0].book.editionIsbn,'');
  assert.equal(result.rows[0].status,'unresolved');
  assert.ok(result.rows[0].matchSuggestions.some(candidate=>
    candidate.editionIsbn===ISBN &&candidate.origin==='existing'));
  assert.ok(result.rows[0].matchSuggestions.some(candidate=>
    candidate.editionIsbn===OTHER&&candidate.origin==='online'));
  assert.equal(result.decisions.summary.readyToApply,false);

  const correction=await analyzeReviewedImport(original,[{
    index:0,fields:{editionIsbn:ISBN},
  }],{existingBooks:current});
  assert.equal(correction.rows[0].book.editionIsbn,ISBN,
    'The suggested selection must follow ordinary teacher corrections');
  assert.equal(original[0]['ISBN-nummer'],'9780306406156',
    'Correcting a proposal never rewrites the original Excel file');

  // UI wiring: actual controls, correct ISBN, compact custom editor and a
  // responsive design rather than a decorative mockup.
  const ui=fs.readFileSync(path.join(__dirname,
    '../public/admin-book-import-review.js'),'utf8');
  const css=fs.readFileSync(path.join(__dirname,
    '../public/admin-book-import-review.css'),'utf8');
  for(const fragment of [
    'row.matchSuggestions','bb-match-review__compare',
    'Dit is het juiste boek','Andere editie bekijken',
    'Zelf corrigeren','onlyFields:[\'title\',\'author\',\'editionIsbn\']',
    "updateCorrection(row.index,'editionIsbn',candidate.editionIsbn)",
    'Controle opnieuw berekenen',
  ])assert.ok(ui.includes(fragment),'Missing working card control '+fragment);
  assert.ok(css.includes('.bb-match-review__card'));
  assert.ok(css.includes('max-width:720px'),'Responsive breakpoint must exist');
  console.log('Import suggestion candidates and visual review controls OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
