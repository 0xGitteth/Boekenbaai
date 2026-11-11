'use strict';
const assert = require('node:assert/strict');
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
assert.ok(safeCover({coverUrl:'/covers/local.jpg'}));
console.log('Student reading overview and statistics: OK');
