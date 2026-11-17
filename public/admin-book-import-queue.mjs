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

/**
 * Identify the actual, still unresolved checks in the guided wizard.
 * Informational warnings and safely deferred administration are not blockers.
 * The count of book cards is intentionally independent of pending decisions.
 */
export function unresolvedGuidedGroups(queue=[],assignmentChoices=new Map(),
  metadataChoices=new Map(),skippedRows=new Set()) {
  return queue.map((group,index)=>{
    const rows=group.rows instanceof Map?[...group.rows.values()]:[];
    const activeRows=rows.filter(row=>!skippedRows.has(row?.index));
    // An explicit skip is not an outstanding decision while the new
    // analysis is still being calculated. It remains separately reversible.
    if(rows.length&&!activeRows.length)return null;
    const activeIndexes=new Set(activeRows.map(row=>row.index));
    const activeWorksheetRows=new Set(activeRows.map(row=>row.sourceRowNumber));
    const relevantRow=rowIndex=>!Number.isInteger(rowIndex)
      ||!rows.length||activeIndexes.has(rowIndex);
    const reasons=[];
    if((group.stock||[]).some(item=>item.action==='blocked'
      &&relevantRow(item.index)))
      reasons.push('ISBN of voorraad');
    if((group.assignments||[]).some(item=>relevantRow(item.rowIndex)
      &&(assignmentChoices.get(item.id)?.action||item.choice||'pending')==='pending'))
      reasons.push('Uitlening of vaste locatie');
    if((group.metadata||[]).some(item=>
      (!Array.isArray(item.worksheetRows)||!item.worksheetRows.length
        ||item.worksheetRows.some(number=>activeWorksheetRows.has(number)))
      &&!['keep','apply','excel'].includes(metadataChoices.get(item.id)?.action)))
      reasons.push('Boekgegevens');
    if(!reasons.length)return null;
    const first=activeRows.find(row=>row?.book?.title)||activeRows[0];
    const worksheetRows=[...new Set(activeRows.map(row=>row?.sourceRowNumber)
      .filter(value=>Number.isInteger(value)))].sort((a,b)=>a-b);
    return {index,key:group.key,
      title:first?.book?.title||group.stock?.[0]?.title
        ||group.assignments?.[0]?.title||'Boek zonder titel',
      worksheetRows,reasons};
  }).filter(Boolean);
}
