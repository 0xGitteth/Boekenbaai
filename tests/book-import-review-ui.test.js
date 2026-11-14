'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Execute the actual field-display function without a browser or mocking the
// rest of the admin page. Corrections shown to a teacher must correspond to
// the values that the server will actually import.
const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-book-import-review.js'), 'utf8');
const start = script.indexOf('    function fieldValue(row, field) {');
const end = script.indexOf('    function updateCorrection(', start);
assert.ok(start >= 0 && end > start, 'Could not locate review field rendering');
const fieldValue = new Function(script.slice(start, end) + '\nreturn fieldValue;')();

// Toggle a row to skipped and back without erasing typed but not yet saved
// corrections. The server receives skip-only entries while it is skipped.
const toggleStart = script.indexOf('  function toggleSkippedRow(');
const toggleEnd = script.indexOf('  const make = ', toggleStart);
assert.ok(toggleStart >= 0 && toggleEnd > toggleStart, 'Skip state helper missing');
const toggleSkippedRow = new Function(script.slice(toggleStart, toggleEnd)
  + '\nreturn toggleSkippedRow;')();
const changed = new Map([[2, { index: 2, fields: { title: 'Gecorrigeerd', author: 'Ander' } }]]);
const pending = new Map();
toggleSkippedRow(changed, pending, 2, true);
assert.deepStrictEqual(changed.get(2), { index: 2, skip: true });
toggleSkippedRow(changed, pending, 2, false);
assert.deepStrictEqual(changed.get(2).fields, { title: 'Gecorrigeerd', author: 'Ander' });
assert.strictEqual(pending.size, 0);
toggleSkippedRow(changed, pending, 3, true);
toggleSkippedRow(changed, pending, 3, false);
assert.strictEqual(changed.has(3), false);

const metadataOnly = {
  book: { editionIsbn: '9780306406157', manualThemes: [], themes: ['Pesten', 'Natuur'] },
  identifierAnalysis: {},
};
assert.strictEqual(fieldValue(metadataOnly, 'themes'), 'Pesten; Natuur',
  'Metadata-only theme selection must be visible to administrators');
assert.strictEqual(fieldValue({
  ...metadataOnly, book: { ...metadataOnly.book, manualThemes: ['Mysterie'] },
}, 'themes'), 'Mysterie',
'Teacher-selected themes must override metadata themes');
assert.strictEqual(fieldValue({ book: {}, identifierAnalysis: {
  legacy: { raw: '978123X-invalid' },
}}, 'editionIsbn'), '978123X-invalid');
assert.strictEqual(fieldValue({ book: {}, identifierAnalysis: {
  ambiguous: { raw: '9780987-invalid' },
}}, 'editionIsbn'), '9780987-invalid');
assert.strictEqual(fieldValue({ book: {}, identifierAnalysis: {
  explicit: { raw: '978wrong' }, legacy: { raw: 'other' },
}}, 'editionIsbn'), '978wrong');
assert.ok(script.includes('const known = remotePending?.id === current.id ? remotePending : stage;'),
  'Pending same-revision drafts must use their cached full response instead of refetching every poll');
assert.ok(script.includes('Ongeldig ISBN: ') && script.includes('Thema’s: '),
  'The displayed review cards must include previously hidden identifiers and themes');
// Execute the real existing-book theme submission guard: changing title,
// barcode or description without touching the theme pills must not overwrite
// metadata-imported (possibly freeform) themes.
const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const changedStart = appSource.indexOf('    const themeSelectionChanged = ');
const changedEnd = appSource.indexOf('    if (bookId) {', changedStart);
assert.ok(changedStart >= 0 && changedEnd > changedStart);
const getSentManualThemes = new Function(
  'bookId', 'adminBookInitialThemeKeys', 'adminSelectedThemeKeys', 'selectedThemes', 'payload',
  appSource.slice(changedStart, changedEnd) + '\nreturn payload.manualThemes;'
);
assert.strictEqual(getSentManualThemes(
  'book-1', new Set(['pesten']), new Set(['pesten']), ['Pesten'], {}
), undefined, 'An unrelated edit should preserve original imported metadata');
assert.deepStrictEqual(getSentManualThemes(
  'book-1', new Set(['pesten']), new Set(), [], {}
), [], 'Explicitly clearing the last selected pill must send an empty theme override');
assert.deepStrictEqual(getSentManualThemes(
  'book-1', new Set(['pesten']), new Set(['mysterie']), ['Mysterie'], {}
), ['Mysterie'], 'A changed theme selection should replace the imported themes');
assert.deepStrictEqual(getSentManualThemes(
  '', null, new Set(), [], {}
), [], 'Creating a book should still send the selected theme values');


assert.strictEqual(fieldValue({ book: { easyReading: true }, provenance: {
  easyReading: { source: 'excel', raw: 'nee' },
}}, 'easyReading'), 'nee', 'Show raw Excel ML input instead of disguising it as ja');
assert.strictEqual(fieldValue({ book: { easyReading: true }, provenance: {} }, 'easyReading'), 'ja');
assert.strictEqual(fieldValue({ book: { suitableForExamList: false }, provenance: {
  suitableForExamList: { source: 'excel', header: 'Examenmateriaal', raw: 'Engels' },
}}, 'examMaterial'), 'Engels', 'Derived English language must not hide the original Excel value');
assert.strictEqual(fieldValue({ book: { suitableForExamList: false }, provenance: {
  suitableForExamList: { source: 'excel', header: 'Examenmateriaal', raw: 'strip' },
}}, 'examMaterial'), 'strip', 'Derived comic tags must not hide the original Excel value');
assert.strictEqual(fieldValue({ book: { suitableForExamList: true }, provenance: {} },
  'examMaterial'), 'Ja');

assert.ok(script.includes("'Makkelijk lezen: ' + (row.book?.easyReading ? 'ja' : 'nee')"),
  'Show the effective ML value alongside its original Excel value');

assert.ok(script.includes("button('Excel-titel behouden'"),
  'An administrator must have a clear action to choose the Excel title on a metadata conflict');
assert.ok(script.includes('iedere ingevulde waarde Makkelijk lezen'),
  'Make the deliberately nonstandard every-nonblank ML rule explicit in the editor');

// PR4 inventory review decisions must survive a shared session, but edits
// to ISBN or skip state must discard any now-inapplicable approval.
assert.ok(script.includes("inventoryResolutions: [...inventoryResolutions.values()]"),
  'Submit the explicit inventory choices with correction-review requests');
assert.ok(script.includes('inventoryResolutions.delete(oldIsbn)'),
  'Changing the ISBN must discard stale retention decisions');
assert.ok(script.includes('inventoryResolutions.delete(row.book.editionIsbn)'),
  'Skipping an ISBN row must not leave an invisible unresolved choice');
assert.ok(script.includes("stage.inventoryResolutions || []"),
  'Reload retained choices from the server after remote review');
assert.ok(script.includes('dec.canKeepExisting === true'),
  'The retain option must be hidden unless the planner explicitly permits a clean stock reduction');

// Execute the actual stock-resolution handler with warning state already
// accepted. Only changing an Excel field may invalidate accepted warnings;
// choosing to keep existing stock changes no book content.
const resolutionStart = script.indexOf('    function updateInventoryResolution(');
const resolutionEnd = script.indexOf('    function editRow(', resolutionStart);
assert.ok(resolutionStart >= 0 && resolutionEnd > resolutionStart,
  'Could not locate real inventory resolution handler');
const runInventoryChoice = new Function('accepted', 'requiresRecheck', `
  let warningsAccepted = accepted;
  let mustRecheckWarnings = requiresRecheck;
  const inventoryResolutions = new Map();
  const currentApplyButton = { disabled: false };
  ${script.slice(resolutionStart, resolutionEnd)}
  updateInventoryResolution('9780306406157', true);
  const afterSelect = {
    accepted: warningsAccepted,
    requiresRecheck: mustRecheckWarnings,
    disabled: currentApplyButton.disabled,
    action: inventoryResolutions.get('9780306406157')?.action,
  };
  updateInventoryResolution('9780306406157', false);
  return { afterSelect, afterClear: {
    accepted: warningsAccepted, requiresRecheck: mustRecheckWarnings,
    disabled: currentApplyButton.disabled,
    empty: inventoryResolutions.size === 0,
  } };
`);
const acceptedChoice = runInventoryChoice(true, false);
assert.deepStrictEqual(acceptedChoice.afterSelect, {
  accepted: true, requiresRecheck: false,
  disabled: true, action: 'keep_existing',
});
assert.deepStrictEqual(acceptedChoice.afterClear, {
  accepted: true, requiresRecheck: false, disabled: true, empty: true,
});
const pendingFieldEdits = runInventoryChoice(false, true);
assert.strictEqual(pendingFieldEdits.afterSelect.requiresRecheck, true,
  'Changing a stock decision may never unlock pending Excel corrections');
assert.strictEqual(pendingFieldEdits.afterSelect.accepted, false);

console.log('Review UI metadata themes, ISBN sources and remote cache regressions passed');


// Large administrative syncs must show only genuine exceptions by default.
// Clear Excel proposals are already selected and belong in a collapsed,
// inspectable detail section, not at the start of a 70-row manual queue.
{
  const sectionStart = script.indexOf('    function renderAssignmentReconciliation() {');
  const sectionEnd = script.indexOf('    // Rebuilding a long review', sectionStart);
  assert.ok(sectionStart >= 0 && sectionEnd > sectionStart,
    'Missing administrative exception-first review UI');
  const reviewUi = script.slice(sectionStart, sectionEnd);
  const manual = reviewUi.indexOf('const exceptions = differences.filter(diff => !diff.automatic);');
  const auto = reviewUi.indexOf('const proposals = differences.filter(diff => diff.automatic);');
  const manualRender = reviewUi.indexOf('renderReviewGroup(exceptions, \'manual\')');
  const automaticRender = reviewUi.indexOf('renderReviewGroup(proposals, \'automatic\')');
  assert.ok(manual >= 0 && auto > manual && manualRender > auto
    && automaticRender > manualRender,
  'Unresolved exceptions must appear before the optional automatic proposals');
  assert.match(reviewUi, /const suggested = make\('details', 'bb-review__suggested'\)/);
  assert.match(reviewUi, /suggested.open = automaticExpanded/);
  assert.match(reviewUi, /const openChoices = differences.filter\(diff =>/);
  assert.match(reviewUi, /choices.set\(diff.id, \{ id: diff.id, action: 'keep' \}\)/);
  assert.match(reviewUi, /assignmentResolutions: \[\.\.\.choices.values\(\)\]/,
    'Bulk keep must pass the complete choices through the review endpoint first');
  assert.match(reviewUi, /window.confirm\('Voor ' \+ openChoices.length/,
    'Bulk keeping unresolved issues requires an explicit administrator confirmation');
  assert.match(reviewUi, /applyButton.disabled = !summary.readyToApply \|\| hasUnreviewedChanges\(\)/,
    'No unresolved or unreviewed choice can be applied');
}


// The combined importer may only ask for warning acknowledgement after
// rendering actual workbook diagnostics, not generic stock blocking reasons.
{
  const start=script.indexOf('    function renderUnifiedSync() {');
  const end=script.indexOf('    function renderAssignmentReconciliation()',start);
  assert.ok(start>=0 && end>start,'Unified review renderer missing');
  const combined=script.slice(start,end);
  const listing=combined.indexOf('const sourceWarnings=(stage.rows||[]).map(');
  const displayed=combined.indexOf('results.append(notice);',listing);
  const acceptance=combined.indexOf("const acceptLabel=make('label','bb-review__check');");
  assert.ok(listing>=0 && displayed>listing && acceptance>displayed,
    'Source warnings and affected Excel rows must be visible before acknowledgement');
  assert.ok(combined.includes("issue.severity==='warning'||issue.severity==='conflict'"),
    'Warning and conflict diagnostics must be present');
  assert.ok(combined.includes("'Excelrij '+row.sourceRowNumber"),
    'Every issue must identify its Excel row');
  assert.ok(combined.includes('issueLabels[issue.code]'),
    'The actual issue code must be shown with a clear human-readable description');
  assert.ok(combined.includes('String(issue.raw).slice(0,160)'),
    'Show the invalid input value when the parser provides it');
  assert.ok(combined.includes("invalid_published_year:'Ongeldig uitgavejaar'"),
    'An invalid publication year must be disclosed before acceptance');
}


// In metadata-only imports, conflicts such as an invalid page count must
// provide a source editor on the affected worksheet row.
{
  const start=script.indexOf('    function renderUnifiedSync() {');
  const end=script.indexOf('    function renderAssignmentReconciliation()',start);
  const combined=script.slice(start,end);
  const metadata=combined.slice(combined.indexOf('for(const issue of metadataPlan.issues)'),
    combined.indexOf('for(const item of blocked)'));
  assert.match(metadata,/issue\.worksheetRows/);
  assert.match(metadata,/source\.sourceRowNumber/);
  assert.ok(metadata.includes("'Excelrij '+source.sourceRowNumber+' corrigeren'"));
  assert.match(metadata,/editRow\(source,card,\{/);
  assert.match(metadata,/onlyFields:\[editField\],metadataIssueId:issue\.id/);
  assert.match(script,/if \(options\.onlyFields && !options\.onlyFields\.includes\(field\)\) continue/);
  assert.match(script,/metadataResolutions\.delete\(options\.metadataIssueId\)/);
}
