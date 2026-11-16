// Pure selectors for the teacher-facing staged import review.
// Administrative conflicts may be deferred ONLY when the server has
// explicitly marked their source row as safely postponed.
const ADMINISTRATION_ONLY_ISSUES=new Set([
  'student_loan_unmatched','student_loan_ambiguous',
  'class_loan_unmatched','class_loan_ambiguous',
  'fixed_location_needs_review',
]);

export function deferredAdministrativeRows(differences=[]){
  return new Set(differences.filter(diff=>
    diff.autoDeferred===true
    ||(diff.kind==='issue'&&diff.choice==='later'))
    .map(diff=>diff.rowIndex));
}
export function requiresBookReview(issue,rowIndex,deferredRows){
  if(!issue||!['conflict','warning'].includes(issue.severity))
    return false;
  if(deferredRows.has(rowIndex)&&ADMINISTRATION_ONLY_ISSUES.has(issue.code))
    return false;
  return issue.severity==='conflict'
    ||issue.reviewLevel!=='informational';
}
export function countUnresolvedBookWarnings(actionable,deferredRows){
  return (actionable||[]).reduce((total,item)=>total+
    (item.issues||[]).filter(issue=>
      requiresBookReview(issue,item.index,deferredRows)).length,0);
}
