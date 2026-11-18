'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {currentStudentClassIds,inconsistentClassMembership}
  =require('../student-current-classes');
const {studentClassIds,publicBook,bookIsHidden,bookIsBorrowed}
  =require('../book-loan-policy');
const {claimIndex,displayedBorrowed,inventoryDiagnostics}
  =require('../book-inventory-consistency');
const db={classes:[
  {id:'old-class',name:'Oude klas',studentIds:[]},
  {id:'new-class',name:'Nieuwe klas',studentIds:['pupil']},
],students:[
  {id:'pupil',classIds:['old-class'],
    borrowedBooks:[{bookId:'book-1'}]},
],books:[
  {id:'book-1',title:'Testboek',status:'available',borrowedBy:null,
    borrowedByClassId:null,catalogHidden:false},
  {id:'book-2',title:'Zoekgeraakt',status:'available',catalogHidden:true},
]};
const pupil=db.students[0];
assert.deepEqual(currentStudentClassIds(db,pupil),['new-class']);
assert.deepEqual(studentClassIds(db,pupil),['new-class']);
assert.equal(inconsistentClassMembership(db,pupil),true);
assert.deepEqual(pupil.classIds,['old-class'],'Roster read must never rewrite account');
const legacy={classes:[{id:'old-class',studentIds:[]}],students:[]};
assert.deepEqual(currentStudentClassIds(legacy,pupil),['old-class'],
  'Do not discard legacy membership unless a positive mentor roster exists');
const double={classes:[
  {id:'one',studentIds:['pupil']},{id:'two',studentIds:['pupil']},
],students:[]};
assert.deepEqual(currentStudentClassIds(double,pupil),['one','two'],
  'True mixed-class pupils remain in both classes');
const claims=claimIndex(db);
assert.equal(claims.get('book-1').has('pupil'),true);
assert.equal(bookIsBorrowed(db.books[0]),false);
assert.equal(displayedBorrowed(db.books[0],claims),true,
  'Never advertise an actively claimed physical copy as available');
assert.equal(db.books[0].status,'available','Read-only availability cannot mutate the DB');
assert.equal(bookIsHidden(db.books[1]),true);
assert.equal(bookIsHidden(db.books[0]),false);
const response=publicBook({...db.books[0],status:'borrowed',borrowedBy:'pupil'});
assert.equal(response.status,'borrowed');
assert.equal(response.borrowedBy,undefined,'Never expose borrower IDs in the public catalog');
const inspection=inventoryDiagnostics(db);
assert.equal(inspection.summary.booksWithConflicts,1);
assert.deepEqual(inspection.entries[0].reasons,['status_available_but_student_loan']);
db.books[0].borrowedBy='pupil';
assert.equal(inventoryDiagnostics(db).entries[0].reasons.includes('status_available_but_assigned'),true);
assert.equal(bookIsBorrowed(db.books[0]),true);
const text=file=>fs.readFileSync(path.join(__dirname,'..','public',file),'utf8');
const google=text('google-auth.js');
const staff=text('staff-google-link.js');
const app=text('app.js');
const html=text('staff.html');
const teacher=text('teacher-modern.js');
assert.match(google,/Geen openstaande koppelverzoeken/);
assert.match(google,/teacher-google-link-requests/);
assert.match(google,/\[data-teacher-view="tasks"\]/);
assert.match(google,/\[data-teacher-view="account"\]/);
assert.match(staff,/Geen openstaande koppelverzoeken/);
assert.match(staff,/await renderAdminRequests\(\)/);
assert.match(app,/adminBookCatalogHidden\.checked = book\.catalogHidden === true/);
assert.match(app,/catalogHidden: Boolean\(adminBookCatalogHidden\?\.checked\)/);
assert.match(html,/id="admin-book-catalog-hidden"/);
assert.match(teacher,/data\.teacherView = name/);
console.log('Urgent fixes: effective roster, active loan claims, privacy, catalog visibility control and stable Google request areas OK');
