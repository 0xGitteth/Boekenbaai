'use strict';

// Pure assessment: no IO, network requests, clocks, or writes to the supplied DB.
// An edition match is NEVER proof of a physical copy's identity.
const crypto = require('node:crypto');
const {canonicalizeBookIsbn13} = require('./book-edition-core');
const {listDeferredAssignmentTasks} = require('./book-import-assignment-tasks');
const {circulationRevision} = require('./book-import-followups');
const {latestImportForTask} = require('./book-import-task-reconciliation');
const list = value => Array.isArray(value) ? value : [];
const norm = value => String(value ?? '').trim();
const folded = value => norm(value).normalize('NFKC').toLocaleLowerCase('nl-NL').replace(/\s+/g, ' ');
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
const digest = value => crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
function edition(book) {
  const values = [book.editionIsbn, book.metadataIsbn, book.isbn, book.barcode]
    .map(canonicalizeBookIsbn13).filter(Boolean);
  return new Set(values).size === 1 ? values[0] : '';
}
function editionKey(isbn, title, author) {
  const t=folded(title),a=folded(author);
  return isbn&&t&&a?JSON.stringify([isbn,t,a]):null;
}
function catalogIndex(books) {
  const byEdition=new Map(),byId=new Map();
  for(const book of books){
    const key=editionKey(edition(book),book.title,book.author);
    if(key){if(!byEdition.has(key))byEdition.set(key,[]);byEdition.get(key).push(book);}
    if(!byId.has(book.id))byId.set(book.id,[]);
    byId.get(book.id).push(book);
  }
  return {byEdition,byId};
}
function sourceKey(task, family) {
  const report = task.batchId || task.reportId;
  if (!report || !Number.isSafeInteger(task.worksheetRow) || task.worksheetRow < 1) return null;
  // Cross-import row numbers and ISBNs cannot establish physical identity.
  if (family === 'physical') return digest([family, report, task.worksheetRow,
    task.title, task.author, task.excelIdentifier, task.editionIsbn, task.bookId ?? null,
    task.barcode ?? null, task.sourcePrintedBarcode ?? null,
    task.sourceQuantity ?? null, task.sourceEvidence ?? null]);
  if (family === 'administration' && task.differenceId && task.original)
    return digest([family, report, task.differenceId, task.worksheetRow,
      task.bookId, task.kind, task.original, task.sourceRow ?? null, task.loanHistoryMode ?? null]);
  return null;
}
function assessTask(db, task, family, catalog) {
  const key=editionKey(canonicalizeBookIsbn13(task.editionIsbn),task.title,task.author);
  const matches=key?catalog.byEdition.get(key)||[]:[];
  // Bound repeated evidence in the response even for very large edition groups.
  const matchingIds=matches.slice(0,20).map(book=>book.id);
  const copyMatches=task.bookId?catalog.byId.get(task.bookId)||[]:[];
  const copy = copyMatches.length === 1 ? copyMatches[0] : null;
  const result = {
    id: task.id, family, title: task.title || (family === 'accounts' ? 'Accountcontrole' : 'Boekcontrole'),
    revision: task.revision || 1, source: {
      reportId: task.batchId || task.reportId || null, worksheetRow: task.worksheetRow || null,
      fileName: task.fileName || '', reason: task.reason || task.kind || 'physical_identity',
    },
    category: 'attention', rule: 'insufficient_evidence',
    explanation: 'De oorspronkelijke onzekerheid is niet aantoonbaar opgelost. Beoordeling blijft nodig.',
    evidence: [], proposedAction: null, requiresSeparateConfirmation: family !== 'metadata',
    current: {bookId: copy?.id || null, matchingEditionCount: matches.length,
      matchingBookIds: matchingIds, candidateListTruncated:matches.length>matchingIds.length},
    dependencies: {taskRevision: task.revision || 1,
      circulationRevision: copy ? circulationRevision(db, copy.id) : null},
  };
  if (family === 'accounts' || family === 'classes') {
    result.explanation = 'Account- en klasbeslissingen vereisen afzonderlijke beoordeling. De voorcontrole wijzigt geen personen of koppelingen.';
    return result;
  }
  if (task.sourceEvidence?.issues?.length) result.evidence.push({
    type: 'original_diagnostics', value: task.sourceEvidence.issues,
  });
  if (task.reason) result.evidence.push({type: 'original_reason', value: task.reason});
  if (matches.length) {
    result.evidence.push({type: 'edition_match', isbn: canonicalizeBookIsbn13(task.editionIsbn), bookIds: matchingIds, totalMatches:matches.length});
    result.category = 'proposal';
    result.rule = 'edition_found_copy_unproven';
    result.explanation = 'Deze ISBN-editie staat in de collectie. Dat bewijst niet dat het oorspronkelijke exemplaar of bronconflict is hersteld.';
    result.proposedAction = 'Vergelijk het bedoelde exemplaar en de oorspronkelijke melding met de gevonden registratie.';
  }
  if (task.bookId && !copy) {
    result.category = 'attention'; result.rule = 'missing_or_ambiguous_copy';
    result.explanation = 'Het gekoppelde exemplaar ontbreekt of de interne identiteit is dubbel. Niet automatisch afsluiten of opnieuw aanmaken.';
    result.proposedAction = null;
  }
  if (copy && family === 'administration' && task.kind === 'location'
      && task.original && typeof task.original.after === 'string'
      && norm(task.original.after) && norm(copy.fixedLocation) === norm(task.original.after)
      && matches.includes(copy)) {
    result.category = 'proposal'; result.rule = 'location_target_present';
    result.explanation = 'De voorgestelde vaste locatie staat al bij het gekoppelde exemplaar. Controleer of hiermee de oorspronkelijke taak is afgehandeld.';
    result.evidence.push({type: 'current_location', value: copy.fixedLocation});
    result.proposedAction = 'Na afzonderlijke bevestiging alleen de taak afsluiten; geen locatie wijzigen.';
  }
  // A changed circulation counter is evidence of later activity, not proof
  // that a stale import's borrower should be restored or its task closed.
  if (copy && task.original?.circulationRevision !== undefined
      && task.original.circulationRevision !== circulationRevision(db, copy.id)) {
    result.category = 'attention'; result.rule = 'later_circulation_activity';
    result.explanation = 'Na deze import is de uitleenregistratie veranderd. De oude keuze mag niet automatisch worden uitgevoerd.';
    result.proposedAction = 'Beoordeel de actuele uitleenregistratie opnieuw.';
  }
  if(family==='physical'){
    const later=latestImportForTask(db,task);
    if(later){
      result.current.newerImport=later;
      result.evidence.push({type:'later_import_review',value:later});
      // Repeated source rows are informative, but do not prove the physical
      // copy or its quantity. No automatic-candidate classification here.
      if(result.rule!=='later_circulation_activity'
        &&result.rule!=='missing_or_ambiguous_copy'
        &&later.authorConfirmed&&later.sourceIdentifierConfirmed
        &&['unchanged','reconciled','add_copies','combined'].includes(later.rowStatus)){
        result.category='proposal';
        result.rule='newer_import_still_needs_copy_proof';
        result.explanation='Een latere import heeft dezelfde bronrij verwerkt, '
          +'maar de fysieke exemplaarkoppeling is nog niet bewezen.';
        result.proposedAction='Controleer het fysieke exemplaar-ID, het '
          +'oorspronkelijke aantal en eventuele uitlening voordat de taak sluit.';
      }
    }
  }
  return result;
}
function buildTaskPreflight(db) {
  const catalog=catalogIndex(list(db.books));
  const storedAssignments=new Map(list(db.bookImportAssignmentTasks).map(task=>[task.id,task]));
  const source = [
    ...list(db.bookImportDeferredBookChecks).filter(t => t?.status === 'open').map(t => [t, 'physical']),
    ...listDeferredAssignmentTasks(db).tasks.map(t => [
      storedAssignments.get(t.id) || t, 'administration']),
    ...list(db.bookImportFollowups).filter(t => t && !['completed','cancelled'].includes(t.status)).map(t => [t, 'classes']),
    ...['studentExitTasks','teacherExitTasks'].flatMap(key => list(db[key]).filter(t => t?.status === 'open').map(t => [{...t, kind:key}, 'accounts'])),
  ];
  const completedSources = new Map();
  const auditKeys=new Set(list(db.bookImportDeferredBookTaskHistory).map(entry=>
    JSON.stringify([entry.taskId,entry.action,entry.timestamp,entry.actorId])));
  for (const task of list(db.bookImportDeferredBookChecks)) {
    if (task?.status !== 'completed' || task.resolution !== 'manual_done' || !task.completedAt) continue;
    const audit = auditKeys.has(JSON.stringify([task.id,'manual_done',task.completedAt,task.completedBy]));
    const key = sourceKey(task, 'physical');
    if (key && audit && task.completedBy) completedSources.set(key, task);
  }
  const seen = new Map();
  const idCounts = new Map();
  for (const [task, family] of source) {
    const key = family + ':' + task.id;
    idCounts.set(key, (idCounts.get(key) || 0) + 1);
  }
  const tasks = source.map(([task, family]) => {
    const result = assessTask(db, task, family, catalog);
    const key = sourceKey(task, family);
    if (!task.id || idCounts.get(family + ':' + task.id) !== 1) {
      result.category = 'attention'; result.rule = 'invalid_task_identity';
      result.explanation = 'De taakidentiteit ontbreekt of komt meerdere keren voor. Eerst technisch onderzoeken.';
      return result;
    }
    if (key && completedSources.has(key)) {
      const completed = completedSources.get(key);
      result.category = 'automatic_candidate'; result.rule = 'source_event_already_reviewed';
      result.explanation = 'Dezelfde brongebeurtenis is aantoonbaar handmatig afgehandeld, met bijbehorende logregistratie.';
      result.proposedAction = 'Alleen deze achterhaalde melding afsluiten; de handmatige beoordeling blijft bewaard.';
      result.duplicateOf = completed.id;
      result.evidence.push({type:'completed_source_event', taskId:completed.id,
        completedAt:completed.completedAt, fingerprint:key});
      result.requiresSeparateConfirmation = true;
    } else if (key && seen.has(key)) {
      result.category = 'automatic_candidate'; result.rule = 'duplicate_source_event';
      result.explanation = 'Dezelfde brongebeurtenis, rij en inhoud zijn dubbel opgeslagen. Eén taak kan de melding blijven vertegenwoordigen.';
      result.proposedAction = 'Alleen deze dubbele taak afsluiten en verwijzen naar de behouden taak.';
      result.duplicateOf = seen.get(key);
      result.evidence.push({type:'identical_source_event', fingerprint:key, retainedTaskId:result.duplicateOf});
      // Even task-only cleanup stays preview-only until category/scope approval.
      result.requiresSeparateConfirmation = true;
    } else if (key) seen.set(key, task.id);
    // Skipped Excel rows create one task per source row, often before ANY
    // physical copy ID exists. Two messages with the exact SAME batch,
    // worksheet row, content and diagnostics are duplicate notifications,
    // not two verified physical copies. Never infer duplicate copies from
    // matching ISBNs across different source events.
    if (family === 'physical' && result.category === 'automatic_candidate') {
      const referenced = task.bookId ? catalog.byId.get(task.bookId) || [] : [];
      if (!task.batchId || !Number.isSafeInteger(task.worksheetRow)
        || task.worksheetRow < 1 || (task.bookId && referenced.length !== 1)) {
        result.category = 'proposal';
        result.rule = 'source_notification_identity_unproven';
        result.explanation = 'Deze meldingen lijken overeen te komen, maar de '
          + 'oorspronkelijke import en Excelrij of de opgegeven fysieke '
          + 'boekidentiteit zijn niet betrouwbaar vastgesteld.';
        result.proposedAction = 'Controleer eerst de oorspronkelijke importmelding.';
        result.requiresSeparateConfirmation = true;
      }
    }
    return result;
  });
  const counts = {automatic_candidate:0, proposal:0, attention:0};
  for (const task of tasks) counts[task.category]++;
  // Recomputed from live data on every read. Hash is not an authorization token.
  return {version:1, mode:'preview', writesAllowed:false,
    fingerprint:digest({tasks:source, books:db.books || [], counters:db.bookImportLoanActivityCounters || {},
      reports:list(db.bookImportReports).map(r=>({
        id:r.id,importedAt:r.importedAt,fileName:r.fileName,rows:r.rows})),
      students:db.students || [], classes:db.classes || []}),
    coverage:{included:['physical','administration','classes','studentExitTasks','teacherExitTasks'],
      excluded:['Google-koppelverzoeken en andere accountverzoeken uit de aparte authenticatieopslag'],
      externalResearchPerformed:false},
    summary:{open:tasks.length, ...counts,
      automaticallyResolved:list(db.taskAutoClosureHistory).length,
      uniqueSourceEvents:tasks.length-counts.automatic_candidate},
    recentAutoResolutions:list(db.taskAutoClosureHistory).slice(-15).reverse()
      .map(item=>({taskId:item.taskId,retainedTaskId:item.retainedTaskId,
        rule:item.rule,at:item.at})),tasks};
}
module.exports = {buildTaskPreflight};
