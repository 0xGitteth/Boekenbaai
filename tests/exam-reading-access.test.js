'use strict';
const assert = require('node:assert/strict');
const { CLASS_LEVELS, classifyClass, examReadingAccess } = require('../exam-reading-access');
assert.equal(Object.keys(CLASS_LEVELS).length, 13);
const expected = {
  'Alternatieve ontwikkelingstrajecten':'mixed',
  'Arbeid':'upper',
  'Bovenbouw structuur':'upper',
  'DP 80 instroom':'mixed',
  'Onderbouw BKT':'lower',
  'Onderbouw pro-basis':'lower',
  'Onderbouw structuur KT':'lower',
  'Onderbouw structuur pro-basis':'lower',
  'OZA':'mixed',
  'VMBO basis-kader 3':'upper',
  'VMBO basis-kader 4':'upper',
  'VMBO theoretisch 3':'upper',
  'VMBO theoretisch 4':'upper',
};
for(const [name, level] of Object.entries(expected)) {
  assert.equal(classifyClass(name),level,name);
  assert.equal(classifyClass('  '+name.toUpperCase()+'  '),level);
}
assert.equal(classifyClass('Onbekende klas'),'unknown');
const db={classes:Object.entries(expected).map(([name],i)=>({id:String(i),name,studentIds:[]}))};
const access=(classNames, override, options={})=>{
 const ids=classNames.map(n=>db.classes.find(c=>c.name===n).id);
 return examReadingAccess(db,{id:'s',classIds:ids,...(override===undefined?{}:{examReadingEligibleOverride:override}),...options});
};
assert.equal(access(['Arbeid']).eligible,true);
assert.equal(access(['VMBO theoretisch 3']).eligible,true);
assert.equal(access(['Onderbouw BKT']).eligible,false);
assert.equal(access(['OZA']).eligible,false,'Mixed classrooms must not grant access by default');
assert.equal(access(['OZA'],true).eligible,true);
assert.equal(access(['OZA'],false).eligible,false);
assert.equal(access(['Onderbouw BKT'],true).eligible,false,'Overrides must not grant access to lower-only classes');
assert.equal(access(['OZA','Onderbouw BKT'],true).eligible,true);
assert.equal(access(['OZA','VMBO basis-kader 4']).eligible,true);
assert.equal(access(['Arbeid'],undefined,{active:false}).eligible,false);
assert.equal(examReadingAccess(db,{id:'s',classIds:[]}).eligible,false);
db.classes[8].studentIds=['s'];
assert.equal(examReadingAccess(db,{id:'s',classIds:[],examReadingEligibleOverride:true}).eligible,true,'Legacy inverse membership is recognized');
console.log('Exam reading access mapping, mixed decisions and classroom transitions: OK');
