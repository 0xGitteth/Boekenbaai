'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { buildStudentReadingProfile, addWeekdays, safeCover } = require('../student-reading-profile');
const db={
  students:[{id:'s1',borrowedBooks:[{bookId:'active',borrowedAt:'2026-11-09T12:00:00Z'}]}],
  books:[
    {id:'one',title:'Eén',author:'Auteur A',tags:['fantasy'],pageCount:120,coverUrl:'https://example.org/cover.jpg'},
    {id:'two',title:'Twee',author:'Auteur B',tags:['thriller'],pageCount:88},
    {id:'active',title:'Drie',author:'Auteur C',pageCount:200},
  ],
  readingRecords:[
    {id:'r1',subjectId:'s1',subjectType:'student',bookId:'one',title:'Eén',author:'Auteur A',
      loanBorrowedAt:'2026-11-02T12:00:00Z',reportedAt:'2026-11-06T12:00:00Z',finished:true,revision:2,
      changes:[{previous:false,finished:true}]},
    {id:'r2',subjectId:'s1',subjectType:'student',bookId:'two',title:'Twee',author:'Auteur B',
      loanBorrowedAt:'2026-11-05T12:00:00Z',reportedAt:'2026-11-09T12:00:00Z',finished:false,revision:1},
    {id:'someone-else',subjectId:'s2',subjectType:'student',bookId:'two',finished:true},
  ],
  history:[{id:'log1',type:'check_out',studentId:'s1',bookId:'one',timestamp:'2026-11-02T12:00:05Z'}],
  examReadingLists:[
    {studentId:'s1',externalSource:true,manualStatus:'gelezen',title:'Eigen roman',
      author:'Schrijver Z',pageCount:145,genre:'fictie'},
    {studentId:'s1',externalSource:true,manualStatus:'gelezen',title:'Eén',
      author:'Auteur A',pageCount:120,genre:'fantasy'},
  ],
};
const data=buildStudentReadingProfile(db,'s1',{now:new Date('2026-11-11T12:00:00Z')});
assert.equal(data.statistics.registeredLoanPeriods,3,'Recorded loan + active, not duplicate checkout');
assert.equal(data.statistics.readTitles,2);
assert.equal(data.statistics.selfReportedExternalReadTitles,1);
assert.equal(data.statistics.readPagesKnown,265);
assert.equal(data.statistics.topGenres[0].name,'fantasy');
assert.equal(data.statistics.weekdaysWithLoans,8,'Overlapping weekdays count only once');
assert.equal(data.recent[0].kind,'current');
assert.equal(data.recent.find(x=>x.recordId==='r1').edited,true);
assert.equal(data.history.length,3);
assert.ok(!data.history.some(x=>x.recordId==='someone-else'),'Never leak other students');
assert.deepEqual(buildStudentReadingProfile(db,'s1',{page:0,pageSize:2}).history.map(x=>x.id),
  data.history.slice(0,2).map(x=>x.id));
assert.equal(buildStudentReadingProfile(db,'s1',{page:0,pageSize:2}).nextPage,1);
assert.equal(buildStudentReadingProfile(db,'not-found'),null);
const dates=new Set();assert.equal(addWeekdays(dates,'invalid','2026-11-05'),false);
assert.equal(safeCover({coverUrl:'javascript:alert(1)'}),'');
assert.equal(safeCover({
  localCoverUrl:'/api/covers/1234.jpg',
  coverUrl:'https://unreachable.example/old.jpg',
}),'/api/covers/1234.jpg',
  'The cached cover must be preferred over a broken external URL');
assert.equal(safeCover({
  localCoverUrl:'javascript:alert(1)',
  coverUrl:'https://example.org/fallback.jpg',
}),'https://example.org/fallback.jpg',
  'An unsafe cached URL must fall back to the validated external URL');
assert.ok(safeCover({coverUrl:'/covers/local.jpg'}));
// Exercise the real browser renderBook code with a separately hosted
// frontend. The local cache must load from the configured API origin.
const ui=fs.readFileSync(path.join(__dirname,'../public/student-reading-profile.js'),'utf8');
const start=ui.indexOf('  function renderBook(entry) {');
const finish=ui.indexOf('  function showTab(type)',start);
assert.ok(start>0&&finish>start,'Cannot locate the reading-profile renderer');
const make=(tag,_className,text)=>{
  const element={tag,textContent:text||'',children:[],listeners:{},src:'',
    append(...children){this.children.push(...children);},
    addEventListener(type,listener){this.listeners[type]=listener;},
    setAttribute(){},
  };
  return element;
};
const renderBook=vm.runInNewContext(
  '(function(){'+ui.slice(start,finish)+'return renderBook;})()',
  {make,route:p=>'https://api.boekenbaai.example'+p,
    status:()=>['Uitgelezen','read'],fmt:()=>'',edit:()=>{}});
const coverCard=renderBook({title:'Testboek',author:'Auteur',kind:'returned',
  coverUrl:'/api/covers/'+('a'.repeat(64))+'.jpg'});
assert.equal(coverCard.children[0].src,
  'https://api.boekenbaai.example/api/covers/'+('a'.repeat(64))+'.jpg');
const remoteCard=renderBook({title:'Testboek',author:'Auteur',kind:'returned',
  coverUrl:'https://images.example/cover.jpg'});
assert.equal(remoteCard.children[0].src,'https://images.example/cover.jpg',
  'External cover URLs must not be rewritten to the API origin');
console.log('Student reading overview, cached-cover API routing and statistics: OK');
