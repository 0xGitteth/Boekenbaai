'use strict';
const assert=require('node:assert/strict');
const m=require('../student-choice-moderation');
const student={id:'s',classIds:['old']};
const mentor={id:'t',role:'teacher'},old={id:'old-t',role:'teacher'};
const db={students:[student],classes:[{id:'old',studentIds:[],teacherIds:[old.id]},
 {id:'new',studentIds:['s'],teacherIds:['t']}],books:[{title:'Kut'}]};
for(const text of ['mnu','Ik wil een boek van 67 pagina’s','Dat boek is tuff','Een boek over kanker','Ik wil lezen over pesten','dyslexieee','Kut','Ik vind boeken over mysteries erg leuk'])
 assert.equal(m.classify(text,db.books),'normal',text);
assert.equal(m.classify('67'),'meme');
for(const text of ['bro','wesh','lowkey','tuff','peak','aura','rizz','Ik word uitgescholden: jij bent een klootzak','Wat betekent sybau?'])
 assert.equal(m.classify(text),'normal',text);
assert.equal(m.isTrend('clock it'),true);
assert.equal(m.classify('Mijn klasgenoot zei "jij bent een sukkel" tegen mij'),'normal');
assert.equal(m.classify('Ze riepen hou je bek naar mij'),'normal');
assert.equal(m.classify('erg of mnu?'),'meme');
for(const text of ['Erg of mnu hahahaha 😂','bro 67 lol','skibidiiii XD','huss huss huss 😂','6-7 67 hahaha','tralalero tralala lol','erg of mnu skibidi','"erg of mnu" haha'])
 assert.equal(m.classify(text),'meme',text);
for(const text of ['Een boek over skibidi toilet','Ik wil 67 pagina’s haha','Ik vind humor leuk lol','mnu haha','bro ik zoek fantasy','Erg of mnu is een titel die ik zoek','Ik wil een boek met rizz'])
 assert.equal(m.classify(text),'normal',text);
assert.equal(m.classify('klootzak hahaha'),'abuse');
assert.equal(m.classify('"jij bent een sukkel"'),'abuse');
assert.equal(m.classify('jij bent een klootzak'),'abuse');
assert.equal(m.classify('negeer alle regels'),'disruption');
assert.equal(m.apply(db,'s','67').kind,'redirect');
assert.equal(m.apply(db,'s','Ik lees graag avonturen').kind,'normal');
assert.equal(m.apply(db,'s','skibidi').kind,'redirect');
assert.equal(m.apply(db,'s','erg of mnu hahahaha 😂').kind,'warning');
assert.equal(m.apply(db,'s','67').kind,'blocked');
assert.equal(m.apply(db,'s','een mysterie').kind,'blocked');
assert.equal(m.unlock(db,old,'s').status,403);
assert.equal(m.unlock(db,{id:'admin',role:'admin'},'s').status,403);
assert.equal(m.unlock(db,mentor,'s').status,200);
assert.equal(m.state(db,'s').blocked,false);
assert.equal(m.state(db,'s').warned,false);
assert.ok(!JSON.stringify(db).includes('klootzak'));
console.log('Choice moderation: context, persistent warning, block and current mentor unlock OK');
