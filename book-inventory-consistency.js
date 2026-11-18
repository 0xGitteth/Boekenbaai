'use strict';
const {bookIsBorrowed}=require('./book-loan-policy');
function claimIndex(db) {
  const claims=new Map();
  for(const student of db?.students||[]) {
    for(const entry of Array.isArray(student?.borrowedBooks)?student.borrowedBooks:[]) {
      const id=typeof entry==='string'?entry:entry?.bookId;
      if(!id||typeof id!=='string')continue;
      if(!claims.has(id))claims.set(id,new Set());
      claims.get(id).add(student.id);
    }
  }
  return claims;
}
function displayedBorrowed(book,claims) {
  return bookIsBorrowed(book)||Boolean(claims?.get(book?.id)?.size);
}
function inventoryDiagnostics(db) {
  const claims=claimIndex(db);
  const entries=[];
  for(const book of db.books||[]) {
    const ids=[...(claims.get(book.id)||[])];
    const reasons=[];
    if(book.status!=='borrowed'&&bookIsBorrowed(book))
      reasons.push('status_available_but_assigned');
    if(book.status!=='borrowed'&&ids.length)
      reasons.push('status_available_but_student_loan');
    if(book.status==='borrowed'&&!book.borrowedBy&&!book.borrowedByClassId&&!ids.length)
      reasons.push('borrowed_without_current_borrower');
    if(book.borrowedBy&&ids.length&&!ids.includes(book.borrowedBy))
      reasons.push('borrower_mismatch');
    if(ids.length>1)reasons.push('multiple_students_claim_same_copy');
    if(book.borrowedBy&&book.borrowedByClassId)
      reasons.push('student_and_class_borrower_conflict');
    if(reasons.length)entries.push({
      bookId:book.id,title:book.title||'',status:book.status||'',
      reasons,studentClaims:ids.length,
    });
  }
  return {summary:{booksWithConflicts:entries.length,
    byReason:Object.fromEntries([...new Set(entries.flatMap(e=>e.reasons))]
      .map(reason=>[reason,entries.filter(e=>e.reasons.includes(reason)).length]))},
    entries};
}
module.exports={claimIndex,displayedBorrowed,inventoryDiagnostics};
