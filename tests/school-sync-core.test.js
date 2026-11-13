'use strict';

const assert = require('assert');
const core = require('../google-auth-core');
const { runSchoolSync } = require('../school-sync-core');

function baseDb() {
  return {
    books: [],
    students: [],
    users: [
      { id: 'admin', role: 'admin', name: 'Boekenbaai Beheer', username: 'admin', passwordHash: 'x' },
    ],
    classes: [],
    history: [],
    studentTransferRequests: [],
  };
}

(function testFuzzyManualStudentNeedsExplicitReviewAndThenBinds() {
  const db = baseDb();
  db.classes.push({ id: 'class-a', name: 'Klas A', studentIds: ['manual-1'], teacherIds: [] });
  db.students.push({
    id: 'manual-1',
    name: 'Mohammed El Amrani',
    username: 'mohammed',
    passwordHash: 'x',
    classIds: ['class-a'],
    borrowedBooks: [],
    active: true,
    source: 'manual',
  });
  const rows = [{
    Leerlingnummer: '70001',
    'Huidige groep': 'Klas A',
    Roepnaam: 'Mohamed',
    Voorvoegsel: 'El',
    Achternaam: 'Amrani',
    'Huidige status': 'Volgt onderwijs',
  }];

  const preview = runSchoolSync({
    kind: 'student',
    db: JSON.parse(JSON.stringify(db)),
    store: core.emptyAuthStore(),
    rows,
    fullSchoolSync: true,
  });
  assert.strictEqual(preview.summary.needsReview, 1);
  assert.strictEqual(preview.summary.created, 0, 'Twijfelgeval mag niet stilletjes een tweede account maken');
  const review = preview.results.find((entry) => entry.status === 'needs-review');
  assert.strictEqual(review.studentNumber, '70001');
  assert.strictEqual(review.candidates[0].id, 'manual-1');

  const matched = runSchoolSync({
    kind: 'student',
    db: JSON.parse(JSON.stringify(db)),
    store: core.emptyAuthStore(),
    rows,
    fullSchoolSync: true,
    manualMatches: { '70001': 'manual-1' },
  });
  assert.strictEqual(matched.summary.needsReview, 0);
  assert.strictEqual(matched.db.students.length, 1);
  assert.strictEqual(matched.db.students[0].id, 'manual-1');
  assert.strictEqual(matched.db.students[0].parnassysStudentNumber, '70001');
})();

(function testUnchangedIsNotReportedAsUpdated() {
  const db = baseDb();
  db.classes.push({ id: 'class-a', name: 'Klas A', studentIds: ['student-1'], teacherIds: [] });
  db.students.push({
    id: 'student-1',
    name: 'Sanne Jansen',
    firstName: 'Sanne',
    middleName: '',
    lastName: 'Jansen',
    username: '70002',
    passwordHash: 'x',
    classIds: ['class-a'],
    borrowedBooks: [],
    active: true,
    source: 'parnassys',
    parnassysStudentNumber: '70002',
    externalIds: { parnassys: '70002' },
  });
  const result = runSchoolSync({
    kind: 'student',
    db,
    store: core.emptyAuthStore(),
    rows: [{
      Leerlingnummer: '70002',
      'Huidige groep': 'Klas A',
      Roepnaam: 'Sanne',
      Achternaam: 'Jansen',
      'Huidige status': 'Volgt onderwijs',
    }],
    fullSchoolSync: true,
  });
  assert.strictEqual(result.summary.updated, 0);
  assert.strictEqual(result.summary.unchanged, 1);
})();

(function testEmptyMissingStudentDeletedOnlyOnConfirmedApply() {
  const db = baseDb();
  db.classes.push({ id: 'class-a', name: 'Klas A', studentIds: ['keep', 'leave'], teacherIds: [] });
  db.students.push(
    {
      id: 'keep', name: 'Blijft Leerling', firstName: 'Blijft', lastName: 'Leerling', username: '1', passwordHash: 'x',
      classIds: ['class-a'], borrowedBooks: [], active: true, source: 'parnassys',
      parnassysStudentNumber: '1', externalIds: { parnassys: '1' },
    },
    {
      id: 'leave', name: 'Vertrekt Leerling', firstName: 'Vertrekt', lastName: 'Leerling', username: '2', passwordHash: 'x',
      classIds: ['class-a'], borrowedBooks: [], active: true, source: 'parnassys',
      parnassysStudentNumber: '2', externalIds: { parnassys: '2' },
    }
  );
  const rows = [{
    Leerlingnummer: '1', 'Huidige groep': 'Klas A', Roepnaam: 'Blijft', Achternaam: 'Leerling', 'Huidige status': 'Volgt onderwijs',
  }];

  const preview = runSchoolSync({ kind: 'student', db: JSON.parse(JSON.stringify(db)), store: core.emptyAuthStore(), rows, fullSchoolSync: true });
  assert.strictEqual(preview.summary.missingFromImport, 1);
  assert.strictEqual(preview.db.students.find((entry) => entry.id === 'leave').active, true);

  const applied = runSchoolSync({
    kind: 'student', db: JSON.parse(JSON.stringify(db)), store: core.emptyAuthStore(), rows,
    fullSchoolSync: true, applyDeactivations: true, actorId: 'admin',
  });
  assert.strictEqual(applied.db.students.some(entry => entry.id === 'leave'), false);
  assert.deepStrictEqual(applied.db.classes[0].studentIds,['keep']);
  assert.strictEqual(applied.summary.deactivated, 0);
  assert.strictEqual(applied.summary.deleted,1);
  assert.strictEqual(applied.summary.deletionEligible,1);
})();

(function testMissingStudentWithBorrowedBookCreatesExitTask() {
  const db = baseDb();
  db.classes.push({ id: 'class-a', name: 'Klas A', studentIds: ['leave'], teacherIds: [] });
  db.students.push({
    id: 'leave', name: 'Boek Leerling', username: '2', passwordHash: 'x', classIds: ['class-a'],
    borrowedBooks: ['book-1'], active: true, source: 'parnassys', parnassysStudentNumber: '2', externalIds: { parnassys: '2' },
  });
  db.books.push({ id: 'book-1', title: 'Nog thuis', status: 'borrowed', borrowedBy: 'leave' });
  const result = runSchoolSync({
    kind: 'student', db, store: core.emptyAuthStore(), rows: [], fullSchoolSync: true,
    applyDeactivations: true, actorId: 'admin',
  });
  assert.strictEqual(result.db.students[0].active, false,
    'Former pupils are no longer active even if a book needs returning');
  assert.deepStrictEqual(result.db.students[0].classIds,[]);
  assert.deepStrictEqual(result.db.classes[0].studentIds,[]);
  assert.strictEqual(result.db.books[0].borrowedBy,'leave',
    'Current loan stays intact until explicitly returned');
  assert.strictEqual(result.summary.deactivationBlockedBorrowed,0);
  assert.strictEqual(result.summary.exitTasks,1);
  assert.strictEqual(result.summary.exitTasksWithBooks,1);
  assert.strictEqual(result.db.studentExitTasks[0].status,'open');
})();

(function testNoHistoryPupilIsDeletedAndReadingRecordsRetained() {
  const db=baseDb();
  db.classes.push({id:'old',name:'Structuur BB',studentIds:['empty','read'],teacherIds:['t1']});
  db.students.push(
    {id:'empty',name:'Zonder Data',active:true,classIds:['old'],
      username:'1',passwordHash:'x',borrowedBooks:[],
      parnassysStudentNumber:'1',externalIds:{parnassys:'1'}},
    {id:'read',name:'Met Data',active:true,classIds:['old'],
      username:'2',passwordHash:'x',borrowedBooks:[],
      parnassysStudentNumber:'2',externalIds:{parnassys:'2'}},
  );
  db.readingRecords=[{id:'r1',subjectType:'student',subjectId:'read',
    bookId:'copy1',finished:true}];
  const result=runSchoolSync({kind:'student',db,
    store:core.emptyAuthStore(),rows:[],fullSchoolSync:true,
    applyDeactivations:true,actorId:'admin'});
  assert.strictEqual(result.summary.deletionEligible,1);
  assert.strictEqual(result.summary.deleted,1);
  assert.strictEqual(result.summary.exitTasks,1);
  assert.deepStrictEqual(result.db.students.map(s=>s.id),['read']);
  assert.strictEqual(result.db.students[0].active,false);
  assert.deepStrictEqual(result.db.classes[0].studentIds,[]);
  assert.strictEqual(result.db.studentExitTasks[0].lastClasses[0].name,'Structuur BB');
  assert.strictEqual(result.db.readingRecords[0].subjectId,'read');
})();

(function testLegacyAccountsWithoutParnassysNumberCannotDisappearFromPreview() {
  const initial=baseDb();
  initial.classes.push({id:'former-class',name:'Structuur BB',
    studentIds:['still-here','left-school','has-history'],
    teacherIds:['teacher-1']});
  initial.students.push(
    {id:'still-here',name:'Sam Meijer',username:'sam',passwordHash:'x',
      active:true,classIds:['former-class'],borrowedBooks:[]},
    {id:'left-school',name:'Vertrokken Leerling',username:'left',passwordHash:'x',
      active:true,classIds:['former-class'],borrowedBooks:[]},
    {id:'has-history',name:'Met Leesgegevens',username:'history',passwordHash:'x',
      active:true,classIds:['former-class'],borrowedBooks:[]},
  );
  initial.readingRecords=[{id:'rr1',subjectType:'student',subjectId:'has-history',
    bookId:'b1',finished:true}];
  const rows=[{Leerlingnummer:'3003','Huidige groep':'Structuur BB',
    Roepnaam:'Sam',Achternaam:'Meijer'}];
  const preview=runSchoolSync({kind:'student',db:structuredClone(initial),
    store:core.emptyAuthStore(),rows,fullSchoolSync:true});
  assert.strictEqual(preview.summary.missingFromImport,2,
    'Unmatched old accounts default to exit on a complete school list');
  assert.strictEqual(preview.summary.legacyAccountsWithoutNumber,2);
  assert.strictEqual(preview.summary.legacyAccountsAutoExit,2);
  assert.strictEqual(preview.summary.legacyAccountsNeedsReview,0);
  assert.strictEqual(preview.summary.needsReview,0,
    'Unmatched old accounts must not require 59 separate decisions');
  assert.strictEqual(preview.results.filter(x=>x.status==='legacy-reviewed'
    && x.chosen==='exit' && x.assumedExit).length,2);
  assert.strictEqual(preview.summary.deletionEligible,1);
  assert.strictEqual(preview.summary.exitTasks,1);
  assert.strictEqual(preview.db.students.length,3,
    'Preview must not delete old accounts');
  assert.strictEqual(preview.db.students.find(x=>x.id==='still-here').parnassysStudentNumber,'3003',
    'Exact current match receives the ParnasSys number and is not flagged as departed');

  const decisions={
    'left-school':'exit',
    'has-history':'keep',
  };
  const second=runSchoolSync({kind:'student',db:structuredClone(initial),
    store:core.emptyAuthStore(),rows,fullSchoolSync:true,
    legacyResolutions:decisions});
  assert.strictEqual(second.summary.needsReview,0);
  assert.strictEqual(second.summary.missingFromImport,1);
  assert.strictEqual(second.summary.deletionEligible,1);
  assert.strictEqual(second.summary.legacyAccountsKept,1);
  assert.strictEqual(second.summary.legacyAccountsAutoExit,0,
    'An explicit exit or keep is not counted as an automatic assumption');
  assert.strictEqual(second.results.filter(x=>x.status==='legacy-reviewed').length,2);
  const result=runSchoolSync({kind:'student',db:structuredClone(initial),
    store:core.emptyAuthStore(),rows,fullSchoolSync:true,
    applyDeactivations:true,actorId:'admin',legacyResolutions:decisions});
  assert.strictEqual(result.summary.deleted,1);
  assert.strictEqual(result.db.students.some(x=>x.id==='left-school'),false);
  assert.strictEqual(result.db.students.find(x=>x.id==='has-history').active,true);
  assert.strictEqual(result.db.readingRecords[0].subjectId,'has-history');
  assert.strictEqual(result.db.classes[0].studentIds.includes('left-school'),false);
  assert.strictEqual(result.db.classes[0].studentIds.includes('still-here'),true);

  const archived=runSchoolSync({kind:'student',db:structuredClone(initial),
    store:core.emptyAuthStore(),rows,fullSchoolSync:true,
    applyDeactivations:true,actorId:'admin',
    legacyResolutions:{'left-school':'keep','has-history':'exit'}});
  assert.strictEqual(archived.summary.exitTasks,1);
  assert.strictEqual(archived.db.students.find(x=>x.id==='has-history').active,false);
  assert.strictEqual(archived.db.studentExitTasks[0].lastClasses[0].name,'Structuur BB');
  assert.strictEqual(archived.db.readingRecords[0].subjectId,'has-history');

  const defaultApplied=runSchoolSync({kind:'student',db:structuredClone(initial),
    store:core.emptyAuthStore(),rows,fullSchoolSync:true,
    applyDeactivations:true,actorId:'admin'});
  assert.strictEqual(defaultApplied.summary.deleted,1);
  assert.strictEqual(defaultApplied.summary.exitTasks,1);
  assert.strictEqual(defaultApplied.db.students.some(x=>x.id==='left-school'),false);
  assert.strictEqual(defaultApplied.db.students.find(x=>x.id==='has-history').active,false);
  assert.strictEqual(defaultApplied.db.readingRecords[0].subjectId,'has-history');
  assert.strictEqual(defaultApplied.db.classes[0].studentIds.includes('has-history'),false);
  assert.strictEqual(defaultApplied.db.studentExitTasks[0].lastClasses[0].name,'Structuur BB');

  const partial=runSchoolSync({kind:'student',db:structuredClone(initial),
    store:core.emptyAuthStore(),rows,fullSchoolSync:false,
    applyDeactivations:true,actorId:'admin'});
  assert.strictEqual(partial.summary.legacyAccountsAutoExit,0);
  assert.strictEqual(partial.summary.deleted,0);
  assert.strictEqual(partial.db.students.length,3);
  assert.strictEqual(partial.db.students.find(x=>x.id==='left-school').active,true);

  const malformed=runSchoolSync({kind:'student',db:structuredClone(initial),
    store:core.emptyAuthStore(),rows,fullSchoolSync:true,
    legacyResolutions:{'left-school':'unknown','has-history':'keep'}});
  assert.strictEqual(malformed.summary.needsReview,1,
    'Invalid client resolution does not authorize deletion');
})();

(function testExactDuplicateNamesRequirePairingBeforeAnyDefaultExit() {
  const db=baseDb();
  db.classes=[{id:'klass1',name:'Klas A',studentIds:['sam1','sam2'],teacherIds:[]}];
  db.students=[
    {id:'sam1',name:'Sam Jansen',username:'sam1',passwordHash:'x',
      active:true,classIds:['klass1'],borrowedBooks:[]},
    {id:'sam2',name:'Sam Jansen',username:'sam2',passwordHash:'x',
      active:true,classIds:['klass1'],borrowedBooks:[]},
  ];
  const rows=[{Leerlingnummer:'91001','Huidige groep':'Klas A',
    Roepnaam:'Sam',Achternaam:'Jansen'}];
  const preview=runSchoolSync({kind:'student',db:structuredClone(db),
    store:core.emptyAuthStore(),rows,fullSchoolSync:true});
  assert.strictEqual(preview.summary.needsReview,1);
  assert.strictEqual(preview.summary.legacyAccountsAutoExit,0);
  assert.strictEqual(preview.summary.missingFromImport,0);
  const review=preview.results.find(x=>x.status==='needs-review');
  assert.deepStrictEqual(review.candidates.map(x=>x.id),['sam1','sam2'],
    'Both exact-name candidates must be available to pair explicitly');
  const chosen=runSchoolSync({kind:'student',db:structuredClone(db),
    store:core.emptyAuthStore(),rows,fullSchoolSync:true,
    manualMatches:{'91001':'sam1'}});
  assert.strictEqual(chosen.summary.needsReview,0);
  assert.strictEqual(chosen.db.students.find(x=>x.id==='sam1').parnassysStudentNumber,'91001');
  assert.strictEqual(chosen.summary.legacyAccountsAutoExit,1,
    'Only the other unmatched account can be scheduled for exit');
})();

(function testTeacherMultipleGroupsAndNoGroupDeactivation() {
  const db = baseDb();
  db.classes.push({ id: 'old-class', name: 'Oude klas', studentIds: [], teacherIds: ['old-teacher'] });
  db.users.push({
    id: 'old-teacher', role: 'teacher', name: 'Praktijk Docent', username: 'praktijk', passwordHash: 'x',
    classIds: ['old-class'], active: true, source: 'parnassys',
  });
  const rows = [
    { Roepnaam: 'Gitte', Voorvoegsel: 'van', Achternaam: 'Bakel', Rollen: 'Leerkracht', 'Gekoppelde groepen': 'Klas A; Klas B' },
    { Roepnaam: 'Praktijk', Achternaam: 'Docent', Rollen: 'Vakdocent', 'Gekoppelde groepen': '' },
  ];
  const result = runSchoolSync({
    kind: 'teacher', db, store: core.emptyAuthStore(), rows, fullSchoolSync: true,
    applyDeactivations: true, actorId: 'admin',
  });
  const gitte = result.db.users.find((entry) => entry.name === 'Gitte van Bakel');
  assert.ok(gitte);
  assert.strictEqual(gitte.classIds.length, 2);
  const old = result.db.users.find((entry) => entry.id === 'old-teacher');
  assert.strictEqual(old.active,true,
    'A teacher present in the complete export is still employed without class assignment');
  assert.deepStrictEqual(old.classIds,[]);
})();

(function testFullTeacherExportRemovesLegacyStaffButPreservesAuditedTeachers() {
  const db=baseDb();
  db.classes=[{id:'old',name:'Structuur BB',studentIds:[],
    teacherIds:['manual-out','history-out','still-employed']}];
  db.users.push(
    {id:'manual-out',role:'teacher',name:'Vertrokken Docent',
      username:'left',passwordHash:'x',active:true,source:'manual-import',classIds:['old']},
    {id:'history-out',role:'teacher',name:'Docent met Historie',
      username:'hist',passwordHash:'x',active:true,source:'manual-import',classIds:['old']},
    {id:'still-employed',role:'teacher',name:'Actuele Docent',
      username:'current',passwordHash:'x',active:true,source:'manual-import',classIds:['old']},
  );
  db.history.push({type:'book_returned',performedBy:'history-out',date:'2025-02-01'});
  const rows=[{Roepnaam:'Actuele',Achternaam:'Docent',
    Gebruikersnaam:'current','Gekoppelde groepen':''}];
  const before=runSchoolSync({kind:'teacher',db:structuredClone(db),
    store:core.emptyAuthStore(),rows,fullSchoolSync:true});
  assert.strictEqual(before.summary.missingTeachersFromImport,2);
  assert.strictEqual(before.summary.teacherDeletionEligible,1);
  assert.strictEqual(before.summary.teacherExitTasks,1);
  assert.strictEqual(before.summary.teacherDeleted,0,'Preview is not a mutation');
  assert.strictEqual(before.db.users.length,4);
  assert.strictEqual(before.summary.teachersWithoutGroups,1);
  assert.strictEqual(before.summary.needsReview,0);

  const applied=runSchoolSync({kind:'teacher',db:structuredClone(db),
    store:core.emptyAuthStore(),rows,fullSchoolSync:true,
    applyDeactivations:true,actorId:'admin'});
  assert.strictEqual(applied.summary.teacherDeleted,1);
  assert.strictEqual(applied.summary.teacherArchived,1);
  assert.strictEqual(applied.db.users.some(u=>u.id==='manual-out'),false);
  assert.strictEqual(applied.db.users.find(u=>u.id==='history-out').active,false);
  assert.deepStrictEqual(applied.db.users.find(u=>u.id==='history-out').classIds,[]);
  assert.deepStrictEqual(applied.db.classes[0].teacherIds,[],
    'All former/current teacher rights follow the new full export with no groups');
  assert.strictEqual(applied.db.users.find(u=>u.id==='still-employed').active,true);
  assert.strictEqual(applied.db.teacherExitTasks.length,1);
  assert.strictEqual(applied.db.teacherExitTasks[0].lastClasses[0].name,'Structuur BB');
  assert.strictEqual(applied.db.history[0].performedBy,'history-out');

  const partial=runSchoolSync({kind:'teacher',db:structuredClone(db),
    store:core.emptyAuthStore(),rows,fullSchoolSync:false,applyDeactivations:true});
  assert.strictEqual(partial.summary.teacherDeleted,0);
  assert.strictEqual(partial.summary.teacherArchived,0);
  assert.strictEqual(partial.db.users.length,4);
})();

(function testTeacherCanBeKeptWhenMissingFromFullExport() {
  const db=baseDb();
  db.users.push({id:'old',role:'teacher',name:'Docent zonder export',
    username:'old',passwordHash:'x',active:true,classIds:[]});
  const rows=[{Roepnaam:'Huidige',Achternaam:'Docent',
    'Gekoppelde groepen':'Klas A'}];
  const preview=runSchoolSync({kind:'teacher',db:structuredClone(db),
    store:core.emptyAuthStore(),rows,fullSchoolSync:true,
    teacherResolutions:{old:'keep'}});
  assert.strictEqual(preview.summary.missingTeachersFromImport,0);
  assert.strictEqual(preview.summary.needsReview,0);
  assert.strictEqual(preview.results.find(row=>row.id==='old').chosen,'keep');
  const applied=runSchoolSync({kind:'teacher',db:structuredClone(db),
    store:core.emptyAuthStore(),rows,fullSchoolSync:true,
    applyDeactivations:true,teacherResolutions:{old:'keep'}});
  assert.strictEqual(applied.db.users.find(u=>u.id==='old').active,true);
})();

(function testDuplicateTeacherNameRequiresExplicitIdentity() {
  const db=baseDb();
  db.users.push(
    {id:'a',role:'teacher',name:'Alex Jansen',username:'alex1',
      passwordHash:'x',active:true,classIds:[]},
    {id:'b',role:'teacher',name:'Alex Jansen',username:'alex2',
      passwordHash:'x',active:true,classIds:[]},
  );
  const rows=[{Roepnaam:'Alex',Achternaam:'Jansen','Gekoppelde groepen':'Klas A'}];
  const preview=runSchoolSync({kind:'teacher',db:structuredClone(db),
    store:core.emptyAuthStore(),rows,fullSchoolSync:true});
  assert.strictEqual(preview.summary.needsReview,1);
  assert.strictEqual(preview.summary.missingTeachersFromImport,0);
  assert.deepStrictEqual(preview.results.find(x=>x.status==='needs-review')
    .candidates.map(x=>x.id),['a','b']);
  const chosen=runSchoolSync({kind:'teacher',db:structuredClone(db),
    store:core.emptyAuthStore(),rows,fullSchoolSync:true,
    manualMatches:{'staff:2':'a'}});
  assert.strictEqual(chosen.summary.needsReview,0);
  assert.strictEqual(chosen.summary.missingTeachersFromImport,1);
  assert.strictEqual(chosen.summary.teacherDeletionEligible,1);
  assert.strictEqual(chosen.db.users.find(u=>u.id==='a').active,true);
})();

(function testConflictingTeacherIdentityPreventsAutomaticOffboarding() {
  const db=baseDb();
  db.users.push(
    {id:'a',role:'teacher',name:'Sam Jansen',username:'sam-a',
      passwordHash:'x',active:true,classIds:[]},
    {id:'b',role:'teacher',name:'Alex de Vries',username:'sam-b',
      passwordHash:'x',active:true,classIds:[]},
  );
  const row={Roepnaam:'Sam',Achternaam:'Jansen',
    Gebruikersnaam:'sam-b','Gekoppelde groepen':'Klas A'};
  const first=runSchoolSync({kind:'teacher',db:structuredClone(db),
    store:core.emptyAuthStore(),rows:[row],fullSchoolSync:true});
  assert.strictEqual(first.summary.needsReview,1);
  assert.strictEqual(first.summary.missingTeachersFromImport,0,
    'A name conflicting with another account username may not cause automatic departure');
  assert.deepStrictEqual(first.results.find(x=>x.status==='needs-review')
    .candidates.map(x=>x.id),['a','b']);
  const chosen=runSchoolSync({kind:'teacher',db:structuredClone(db),
    store:core.emptyAuthStore(),rows:[row],fullSchoolSync:true,
    manualMatches:{'staff:2':'a'}});
  assert.strictEqual(chosen.summary.needsReview,0);
  assert.strictEqual(chosen.summary.missingTeachersFromImport,1);
  assert.strictEqual(chosen.db.users.find(x=>x.id==='a').active,true);
})();

(function testAccentVariantMatchesSameTeacherAccount() {
  const db=baseDb();
  db.users.push({id:'jose',role:'teacher',name:'José Jansen',
    username:'jose',passwordHash:'x',active:true,classIds:[]});
  const rows=[{Roepnaam:'Jose',Achternaam:'Jansen',
    'Gekoppelde groepen':'Klas A'}];
  const result=runSchoolSync({kind:'teacher',db:structuredClone(db),
    store:core.emptyAuthStore(),rows,fullSchoolSync:true});
  assert.strictEqual(result.summary.created,0);
  assert.strictEqual(result.summary.missingTeachersFromImport,0);
  assert.strictEqual(result.summary.needsReview,0);
  assert.strictEqual(result.db.users.find(u=>u.id==='jose').name,'Jose Jansen');
  assert.strictEqual(result.db.users.length,2,'Existing account ID must be retained');
})();

(function testVerifiedSchoolmailConflictIsNotOverriddenByManualUsername() {
  const db=baseDb();
  db.users.push(
    {id:'a',role:'teacher',name:'Sam Jansen',username:'sam-a',
      passwordHash:'x',active:true,classIds:[]},
    {id:'b',role:'teacher',name:'Alex de Vries',username:'sam-b',
      passwordHash:'x',active:true,classIds:[]},
  );
  const store=core.upsertLink(core.emptyAuthStore(),{
    accountType:'staff',accountId:'b',email:'alex@koraaledu.nl',
    sub:'verified-google-b',linkedBy:'test',
  }).store;
  const row={Roepnaam:'Sam',Achternaam:'Jansen',
    Gebruikersnaam:'sam-a',Schoolmail:'alex@koraaledu.nl',
    'Gekoppelde groepen':'Klas A'};
  const conflict=runSchoolSync({kind:'teacher',db:structuredClone(db),
    store,rows:[row],fullSchoolSync:true,
    manualMatches:{'staff:2':'a'}});
  assert.strictEqual(conflict.summary.needsReview,1,
    'Selection of A cannot override Google email already verified to B');
  assert.strictEqual(conflict.summary.missingTeachersFromImport,0,
    'Both candidate accounts protected until conflict resolved');
  const selected=runSchoolSync({kind:'teacher',db:structuredClone(db),
    store,rows:[row],fullSchoolSync:true,
    manualMatches:{'staff:2':'b'}});
  assert.strictEqual(selected.summary.needsReview,0);
  assert.strictEqual(selected.summary.missingTeachersFromImport,1);
  assert.strictEqual(selected.db.users.find(u=>u.id==='b').name,'Sam Jansen');
})();

(function testExistingTeacherWithoutGroupAndNewNonTeacherWithoutGroup() {
  const db=baseDb();
  db.classes.push({id:'former-class',name:'Oude klas',
    teacherIds:['already-employed'],studentIds:[]});
  db.users.push({id:'already-employed',role:'teacher',name:'Praktijk Docent',
    username:'praktijk',passwordHash:'x',active:true,classIds:['former-class'],
    source:'manual-import'});
  const rows=[
    {Roepnaam:'Praktijk',Achternaam:'Docent',Gebruikersnaam:'praktijk',
      Rollen:'Vakdocent','Gekoppelde groepen':''},
    {Roepnaam:'Administratief',Achternaam:'Medewerker',Rollen:'Administratie',
      'Gekoppelde groepen':''},
  ];
  const result=runSchoolSync({kind:'teacher',db:structuredClone(db),
    store:core.emptyAuthStore(),rows,fullSchoolSync:true,
    applyDeactivations:true,actorId:'admin'});
  assert.equal(result.summary.needsReview,0);
  assert.equal(result.summary.missingTeachersFromImport,0);
  assert.equal(result.summary.teachersWithoutGroups,1);
  assert.equal(result.db.users.find(x=>x.id==='already-employed').active,true);
  assert.deepStrictEqual(result.db.users.find(x=>x.id==='already-employed').classIds,[]);
  assert.deepStrictEqual(result.db.classes[0].teacherIds,[]);
  assert.equal(result.db.users.some(x=>x.name==='Administratief Medewerker'),false,
    'Non-teaching staff without a class must not get teacher accounts');
})();

(function testPreserveNewUsernameWhenIdentityMatchesExactName() {
  const db=baseDb();
  db.users.push({id:'staff-old',role:'teacher',name:'Sam Jansen',
    username:'old.login',passwordHash:'x',active:true,classIds:[]});
  const rows=[{Roepnaam:'Sam',Achternaam:'Jansen',
    Gebruikersnaam:'new.login','Gekoppelde groepen':'Klas A'}];
  const result=runSchoolSync({kind:'teacher',db:structuredClone(db),
    store:core.emptyAuthStore(),rows,fullSchoolSync:true,
    applyDeactivations:true,actorId:'admin'});
  assert.equal(result.summary.needsReview,0);
  assert.equal(result.summary.missingTeachersFromImport,0);
  assert.equal(result.summary.created,0);
  assert.equal(result.db.users.find(u=>u.id==='staff-old').username,'new.login',
    'Full sync must respect a newly supplied unused ParnasSys username');
})();

(function testManualSelectedVerifiedEmailAccountIsNotOverriddenByUsername() {
  const db=baseDb();
  db.users.push(
    {id:'staff-a',role:'teacher',name:'Sam Jansen',username:'old-a',
      passwordHash:'x',active:true,classIds:[]},
    {id:'staff-b',role:'teacher',name:'Sam Jansen',username:'old-b',
      passwordHash:'x',active:true,classIds:[]},
  );
  const store=core.upsertLink(core.emptyAuthStore(),{
    accountType:'staff',accountId:'staff-b',email:'sam.b@koraaledu.nl',
    sub:'verified-staff-b',linkedBy:'test',
  }).store;
  const row={Roepnaam:'Sam',Achternaam:'Jansen',
    Gebruikersnaam:'old-a',Schoolmail:'sam.b@koraaledu.nl',
    'Gekoppelde groepen':'Klas A'};
  const review=runSchoolSync({kind:'teacher',db:structuredClone(db),store,
    rows:[row],fullSchoolSync:true,
    manualMatches:{'staff:2':'staff-a'}});
  assert.equal(review.summary.needsReview,1);
  assert.equal(review.summary.missingTeachersFromImport,0);
  const chosen=runSchoolSync({kind:'teacher',db:structuredClone(db),store,
    rows:[row],fullSchoolSync:true,manualMatches:{'staff:2':'staff-b'}});
  assert.equal(chosen.summary.needsReview,0);
  assert.equal(chosen.summary.missingTeachersFromImport,1);
  assert.deepStrictEqual(chosen.db.users.find(u=>u.id==='staff-b').classIds.length,1);
  assert.deepStrictEqual(chosen.db.users.find(u=>u.id==='staff-a').classIds,[]);
  assert.equal(chosen.db.users.find(u=>u.id==='staff-a').name,'Sam Jansen');
  assert.equal(chosen.db.users.find(u=>u.id==='staff-b').username,'old-b',
    'Taken username must not be reassigned from staff A');
})();

(function testIncompleteStaffExportRejectsMassOutflow() {
  const db=baseDb();
  db.users.push({id:'old',role:'teacher',name:'Old Teacher',
    username:'old',passwordHash:'x',active:true,classIds:[]});
  for(const rows of [[],[{Roepnaam:'',Achternaam:'',
    'Gekoppelde groepen':'Klas A'}]]){
    assert.throws(()=>runSchoolSync({kind:'teacher',
      db:structuredClone(db),store:core.emptyAuthStore(),rows,
      fullSchoolSync:true,applyDeactivations:true}),
    /medewerkersexport|medewerkernaam/i);
  }
})();

(function testRenamedTeacherMatchedByUsernameStaysActive() {
  const db = baseDb();
  db.classes.push({ id: 'class-a', name: 'Klas A', studentIds: [], teacherIds: ['teacher-1'] });
  db.users.push({
    id: 'teacher-1', role: 'teacher', name: 'Sanne Jansen', username: 's.jansen', passwordHash: 'x',
    classIds: ['class-a'], active: true, source: 'parnassys',
  });

  const result = runSchoolSync({
    kind: 'teacher',
    db,
    store: core.emptyAuthStore(),
    rows: [{
      Roepnaam: 'Sanne',
      Achternaam: 'De Vries',
      Gebruikersnaam: 's.jansen',
      'Gekoppelde groepen': 'Klas A',
    }],
    fullSchoolSync: true,
    applyDeactivations: true,
    actorId: 'admin',
  });

  const teacher = result.db.users.find((entry) => entry.id === 'teacher-1');
  assert.ok(teacher);
  assert.strictEqual(teacher.name, 'Sanne De Vries');
  assert.strictEqual(teacher.active, true, 'Een gematchte docent met alleen een naamswijziging mag niet als verdwenen worden gedeactiveerd');
  assert.deepStrictEqual(teacher.classIds, ['class-a']);
})();

(function testWrongParnassysExportTypeIsRejectedBeforeMutation() {
  assert.throws(
    () => runSchoolSync({
      kind: 'teacher',
      db: baseDb(),
      store: core.emptyAuthStore(),
      rows: [{ Leerlingnummer: '123', 'Huidige groep': 'Klas A', Roepnaam: 'Pupil', Achternaam: 'Een' }],
      fullSchoolSync: true,
      applyDeactivations: true,
    }),
    /leerlingenbestand/i,
    'Een leerlingenexport mag nooit als medewerkersexport worden verwerkt'
  );

  assert.throws(
    () => runSchoolSync({
      kind: 'student',
      db: baseDb(),
      store: core.emptyAuthStore(),
      rows: [{ Roepnaam: 'Docent', Achternaam: 'Een', 'Gekoppelde groepen': 'Klas A' }],
      fullSchoolSync: true,
      applyDeactivations: true,
    }),
    /medewerkersbestand/i,
    'Een medewerkersexport mag nooit als leerlingenexport worden verwerkt'
  );
})();

console.log('School sync core tests geslaagd.');
