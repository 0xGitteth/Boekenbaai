'use strict';
const assert=require('node:assert/strict');
const {nearlySameBookText,sameBookIdentity,smallPageDifference}=
  require('../book-import-autonomy');

assert.equal(nearlySameBookText('P.S. ik hou van je','PS ik hou van je'),true);
assert.equal(nearlySameBookText('Bickerton Neveis','Bickerton Neves'),true);
assert.equal(nearlySameBookText('Carrý Slee','Carry Slee'),true);
assert.equal(nearlySameBookText('Jan Terlouw','Jan Terlouuw'),true);
assert.equal(nearlySameBookText('Up','Us'),false,
  'Very short book titles cannot use fuzzy identity');
assert.equal(nearlySameBookText('Harry Potter 1','Harry Potter 2'),false,
  'Edition numbers must be exact');
assert.equal(nearlySameBookText('Het geheim van het bos',
  'Het geheim van de zee'),false,
  'Materially different stories may not be silently combined');
assert.equal(sameBookIdentity({title:'Oorlogswinter',author:'Jan Terlouw'},
  {title:'Oorlogs-winter',author:'Jan Térlouw'}),true);
assert.equal(sameBookIdentity({title:'Oorlogswinter',author:'Jan Terlouw'},
  {title:'Oorlogswinter',author:'Jan Vermeer'}),false);
assert.equal(smallPageDifference(210,214),true);
assert.equal(smallPageDifference(210,240),false);
assert.equal(smallPageDifference(null,240),false);
console.log('Import autonomy: minor typos, identity and insignificant page variants OK');
