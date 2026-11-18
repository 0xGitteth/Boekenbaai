'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const {
  studentLoanIds,isUnavailable,isHidden,readStatus,catalogProjection,availabilityConflicts,
  selectAvailableCopy,
}=require('../book-catalog-integrity');
const {studentClassIds,mayManageStudent}=require('../book-loan-policy');

const book=(id,fields={})=>({id,title:'Boek '+id,status:'available',
  borrowedBy:null,borrowedByClassId:null,...fields});
const db={
  books:[book('available'),book('status',{status:'borrowed'}),
    book('direct',{borrowedBy:'s2'}),book('class',{borrowedByClassId:'c2'}),
    book('roster'),book('missing',{catalogHidden:true})],
  students:[{id:'s1',classIds:['old'],borrowedBooks:[{bookId:'roster'}]},
    {id:'s2',classIds:[],borrowedBooks:[]}],
  classes:[{id:'old',studentIds:[],teacherIds:['old-mentor']},
    {id:'new',studentIds:['s1'],teacherIds:['new-mentor']}],
  bookImportAssignmentTasks:[{id:'task-1',bookId:'direct',kind:'loan',status:'open'}],
};
const owners=studentLoanIds(db);
assert.equal(readStatus(db.books[0],owners),'available');
for(const b of db.books.slice(1,5))
  assert.equal(readStatus(b,owners),'borrowed',b.id);
assert.equal(db.books[2].status,'available',
  'Read-only conservative projection must not mutate the database');
assert.equal(catalogProjection(db.books[2],owners).status,'borrowed');
assert.equal(isHidden(db.books[5]),true);
assert.equal(isUnavailable(db.books[2],owners),true);
assert.equal(isUnavailable(db.books[4],owners),true);
assert.equal(selectAvailableCopy([db.books[4], db.books[0]],owners)?.id,'available',
  'Borrowed student reference must be skipped when selecting among matching copies');
assert.equal(selectAvailableCopy([db.books[5]],owners),null,
  'A missing or disabled physical copy cannot be selected for checkout');
const problems=availabilityConflicts(db);
assert.deepEqual(problems.map(p=>p.bookId).sort(),['class','direct','roster','status']);
assert.equal(problems.find(p=>p.bookId==='direct').evidence.deferredLoanTaskCount,1);
assert.equal(problems.every(p=>p.requiresReview),true);
assert.deepEqual(studentClassIds(db,db.students[0]),['new'],
  'Current class roster overrides a stale account class for access checks');
assert.equal(mayManageStudent(db,{id:'old-mentor',role:'teacher'},db.students[0]),false);
assert.equal(mayManageStudent(db,{id:'new-mentor',role:'teacher'},db.students[0]),true);
db.classes[1].studentIds=[];
assert.deepEqual(studentClassIds(db,db.students[0]),['old'],
  'Account class should still work when no roster membership exists');

const server=read('server.js'),app=read('public/app.js');
const staff=read('public/staff.html');
const teacherGoogle=read('public/google-auth.js');
const adminGoogle=read('public/staff-google-link.js');
const navigation=read('public/admin-workspaces.js');
assert.match(server,/catalogProjection\(book,loanOwners\)/);
assert.match(server,/filter\(book=>user\?\.role==='admin'\|\|!isHidden\(book\)\)/);
assert.match(server,/requestUrl\.pathname==='\/api\/admin\/catalog-integrity'/);
assert.match(server,/readStatus\(book,loanOwners\)/);
assert.match(server,/isUnavailable\(book,studentLoanIds\(db\)\) \|\| isHidden\(book\)/);
assert.match(server,/catalogHidden: typeof body\.catalogHidden==='boolean'/);
assert.match(server,/return selectAvailableCopy\(books, loanOwners\)/);
assert.match(server,/mustBeBorrowed && !isUnavailable\(book, loanOwners\)/);
assert.match(server,/book\.borrowedBy === studentId && !book\.borrowedByClassId/);
assert.match(server,/if \(isUnavailable\(target, studentLoanIds\(db\)\)\)/);
assert.match(server,/!isUnavailable\(entry, loanOwners\) && !isHidden\(entry\)/);
assert.match(server,/catalogHidden: preserveHidden && template\.catalogHidden === true/);
assert.match(staff,/id="admin-book-catalog-hidden"/);
assert.doesNotMatch(staff,/src="admin-catalog-integrity\.js"/);
assert.match(app,/adminBookCatalogHidden\.checked = book\.catalogHidden===true/);
assert.match(app,/catalogHidden: Boolean\(adminBookCatalogHidden\?\.checked\)/);
assert.match(read('student-choice-recommendations.js'),/isHidden\(book\)/);
assert.match(teacherGoogle,/Geen openstaande koppelverzoeken/);
assert.match(teacherGoogle,/teacher-google-link-request-panel/);
assert.match(teacherGoogle,/\[data-teacher-view="account"\]/);
assert.match(adminGoogle,/Geen openstaande koppelverzoeken/);
assert.match(navigation,/id='admin-staff-link-requests-host'/);
assert.match(read('public/teacher-modern.js'),/teacher-google-link-request-panel/);

assert.match(server,/requiresReconciliation: !verifiedStudentLoan/);
assert.match(server,/catalogHidden: isHidden\(book\)/);
assert.match(server,/personalLoanOnly:user\?\.role==='student'&&isHidden\(book\)/);
assert.match(server,/isHidden\(book\)&&!isOwnLoan/);
assert.match(server,/const bulkLoanOwners=studentLoanIds\(db\)/);
assert.match(app,/book\.personalLoanOnly!==true && book\.catalogHidden!==true/);
assert.match(read('public/staff-loans.js'),/if \(loan\.requiresReconciliation\)/);
assert.match(read('public/staff-loans.js'),/item\.catalogHidden!==true/);
assert.match(read('public/teacher-modern.js'),/boekenbaai:google-link-requests-refresh/);
assert.match(read('public/google-auth.js'),/createTeacherGoogleRequests\(data\)/);
assert.match(read('public/google-auth.js'),/refreshTeacherGoogleRequests/);
console.log('Urgent library fixes: current class precedence, safe loan availability, hidden copies and permanent Google requests OK');
