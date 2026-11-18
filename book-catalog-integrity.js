'use strict';

// Pure read-time reconciliation. Do not change live loan records in this helper.
// A current borrower reference is enough to mark a copy NOT AVAILABLE, but
// never enough to infer a return, write history or change the recorded borrower.
function studentLoanIds(db) {
  const owners=new Map();
  for(const student of db?.students||[]) {
    for(const entry of Array.isArray(student?.borrowedBooks)?student.borrowedBooks:[]) {
      const id=entry?.bookId;
      if(!id)continue;
      if(!owners.has(id))owners.set(id,new Set());
      owners.get(id).add(student.id);
    }
  }
  return owners;
}
function isUnavailable(book,referenceOwners) {
  if(!book)return true;
  return book.status==='borrowed'
    ||Boolean(book.borrowedBy)
    ||Boolean(book.borrowedByClassId)
    ||Boolean(referenceOwners?.has(book.id));
}
function isHidden(book) {
  return book?.catalogHidden===true;
}
// Group and barcode checkout must use the same conservative availability
// decision as the single-copy checkout endpoint.
function selectAvailableCopy(books, referenceOwners) {
  return (Array.isArray(books) ? books : [])
    .find(book => !isUnavailable(book, referenceOwners) && !isHidden(book)) || null;
}
function readStatus(book,owners) {
  return isUnavailable(book,owners)?'borrowed':'available';
}
function catalogProjection(book,owners) {
  return {...book,status:readStatus(book,owners)};
}
function availabilityConflicts(db) {
  const owners=studentLoanIds(db);
  const tasks=(db?.bookImportAssignmentTasks||[]).filter(x=>
    x?.status==='open'&&x?.kind==='loan');
  return (db?.books||[]).flatMap(book=>{
    const direct=Boolean(book.borrowedBy||book.borrowedByClassId);
    const referenced=owners.has(book.id);
    const rawBorrowed=book.status==='borrowed';
    const mismatch=rawBorrowed ? !direct&&!referenced : direct||referenced;
    if(!mismatch)return [];
    return [{
      bookId:book.id,title:book.title,editionIsbn:book.editionIsbn||null,
      recordedStatus:book.status,effectiveStatus:readStatus(book,owners),
      evidence:{
        directBorrower:direct,studentLoanReference:referenced,
        borrowerCount:owners.get(book.id)?.size||0,
        deferredLoanTaskCount:tasks.filter(t=>t.bookId===book.id).length,
      },
      requiresReview:true,
    }];
  });
}
module.exports={studentLoanIds,isUnavailable,isHidden,readStatus,catalogProjection,availabilityConflicts,selectAvailableCopy};
