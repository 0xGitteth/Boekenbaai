'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const books = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-book-import-review.js'), 'utf8');
const school = fs.readFileSync(path.join(__dirname, '..', 'public', 'school-sync-finalize.js'), 'utf8');

function extract(source, begin, end) {
  const from = source.indexOf(begin);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, 'Missing production scroll-handling function: ' + begin);
  return source.slice(from, to);
}

// Execute the real book-review render wrapper with fake old/new row geometry.
// Replacing all children can reset the browser's scrollY before the new list
// appears, but the selected row should end up at its old viewport position.
{
  const code = extract(books, '    function render() {', '    function renderContents() {');
  function verifyBookRender({ replacementExists, focused, expectedY, nestedList = false }) {
    let focusedAgain = null;
    const control = {
      closest() { return focused ? oldRow : null; },
    };
    const oldRow = {
      dataset: { reviewRowKey: 'difference:test-id' },
      getBoundingClientRect() { return { top: 180 }; },
      querySelectorAll() { return [control]; },
    };
    const newControl = { focus(options) { focusedAgain = options; } };
    const newRow = {
      dataset: { reviewRowKey: 'difference:test-id' },
      getBoundingClientRect() { return { top: 1100 }; },
      querySelectorAll() { return [newControl]; },
    };
    const scrolls = [];
    const fakeWindow = {
      scrollY: 840,
      scrollTo(options) { scrolls.push(options); this.scrollY = options.top; },
    };
    let rendered = false;
    const previousList = { scrollTop: 320, contains() { return false; } };
    const replacementList = { scrollTop: 0 };
    const fakeResults = {
      querySelector(selector) {
        assert.equal(selector, '.bb-review__rowlist');
        return nestedList ? (rendered ? replacementList : previousList) : null;
      },
      querySelectorAll() { return replacementExists ? [newRow] : []; },
    };
    const render = new Function('window', 'document', 'results', 'renderContents',
      code + '\nreturn render;')(
      fakeWindow, { activeElement: control }, fakeResults,
      () => { fakeWindow.scrollY = 0; rendered = true; }
    );
    render();
    assert.equal(fakeWindow.scrollY, expectedY);
    assert.equal(scrolls.at(-1).behavior, 'instant');
    if (focused && replacementExists) assert.deepEqual(focusedAgain, { preventScroll: true });
    if (nestedList) assert.equal(replacementList.scrollTop, 320,
      'The separately scrollable book list must keep its own position');
  }

  verifyBookRender({ replacementExists: true, focused: true, expectedY: 920 });
  verifyBookRender({ replacementExists: false, focused: true, expectedY: 840 });
  verifyBookRender({ replacementExists: true, focused: false, expectedY: 840 });
  verifyBookRender({ replacementExists: true, focused: false, expectedY: 840, nestedList: true });
  assert.match(books, /card\.dataset\.reviewRowKey = 'difference:' \+ diff\.id/);
  assert.match(books, /card\.dataset\.reviewRowKey = 'book:' \+ row\.index/);
  assert.match(books, /rememberResponse\(payload, true\);\n        setNotice\('Correcties en waarschuwingen zijn opnieuw gecontroleerd/,
    'Rechecking the book import must not return to page one');
}

// Run the actual shared student/teacher position helpers with replaced rows.
{
  const code = extract(school, '  function captureReviewPosition(', '  function renderReviewRows(');
  const scrolls = [];
  const fakeWindow = { scrollY: 730,
    scrollTo(options) { scrolls.push(options); this.scrollY = options.top; } };
  const { captureReviewPosition, restoreReviewPosition } =
    new Function('window', code + '\nreturn { captureReviewPosition, restoreReviewPosition };')(fakeWindow);
  const originalRow = {
    dataset: { schoolSyncKey: 'match:student:123' },
    getBoundingClientRect() { return { top: 240 }; },
  };
  const selected = { closest() { return originalRow; } };
  const currentRow = {
    dataset: { schoolSyncKey: 'match:student:123' },
    getBoundingClientRect() { return { top: 970 }; },
    querySelector() { return { focus(options) { assert.deepEqual(options, { preventScroll: true }); } }; },
  };
  let rows = [originalRow];
  const host = {
    contains(row) { return row === originalRow; },
    querySelectorAll() { return rows; },
  };
  const captured = captureReviewPosition(host, selected);
  assert.equal(captured.scrollY, 730);
  assert.equal(captured.rowIndex, 0);
  rows = [currentRow];
  fakeWindow.scrollY = 0;
  restoreReviewPosition(host, captured);
  assert.equal(fakeWindow.scrollY, 730, 'Keep the selected pupil at its prior viewport position');

  // Once a match has been resolved, the old row may disappear entirely.
  // The next row should take its place without scrolling to the page top.
  rows = [{
    ...currentRow,
    dataset: { schoolSyncKey: 'match:student:456' },
  }];
  fakeWindow.scrollY = 0;
  restoreReviewPosition(host, captured);
  assert.equal(fakeWindow.scrollY, 730);

  rows = [];
  fakeWindow.scrollY = 0;
  restoreReviewPosition(host, captured);
  assert.equal(fakeWindow.scrollY, 730, 'Fallback to the old scrollY if no review rows remain');
  assert.equal(captureReviewPosition(host, null), null);
  assert.equal(scrolls.every(item => item.behavior === 'instant'), true);
}

// The actual async school preview must leave the old list in place while a
// pupil/teacher decision is recalculated. It must freeze stale controls and
// restore the chosen row only after the new preview is rendered.
(async () => {
  const code = extract(school, '    async function runPreview(control) {', '    async function applySync() {');
  const fileData = 'encoded-xlsx';
  const state = {
    student: {
      fileData, manualMatches: { pupil: '__new__' },
      legacyResolutions: { old: 'keep' }, teacherResolutions: {},
      revision: 0, preview: null,
    },
  };
  const resultsControls = [{ disabled: false }, { disabled: false }];
  let clearCount = 0;
  const results = {
    replaceChildren() { clearCount += 1; },
    querySelectorAll() { return resultsControls; },
  };
  const message = { textContent: '' };
  const previewButton = { disabled: false };
  const full = { checkbox: { checked: true } };
  const captured = { scrollY: 850, rowKey: 'legacy-student:old', rowIndex: 0, rowTop: 230 };
  let releaseRequest;
  let sentBody = null;
  let rendered = 0;
  let restored = 0;
  const runPreview = new Function(
    'syncState', 'kind', 'message', 'results', 'full', 'previewButton',
    'api', 'renderPreview', 'applySync', 'captureReviewPosition',
    'restoreReviewPosition', 'window',
    code + '\nreturn runPreview;'
  )(
    state, 'student', message, results, full, previewButton,
    async (_url, options) => {
      sentBody = options.body;
      return new Promise(resolve => { releaseRequest = resolve; });
    },
    () => { rendered += 1; },
    () => {},
    () => captured,
    (_results, anchor) => { assert.strictEqual(anchor, captured); restored += 1; },
    { scrollTo() {} }
  );

  const selectedControl = { closest() {} };
  const pending = runPreview(selectedControl);
  assert.equal(clearCount, 0, 'Keep the old list visible while calculating');
  assert.equal(resultsControls.every(el => el.disabled), true, 'Freeze stale choices');
  assert.equal(previewButton.disabled, true);
  assert.deepEqual(sentBody.manualMatches, { pupil: '__new__' });
  assert.deepEqual(sentBody.legacyResolutions, { old: 'keep' });
  const response = { summary: { needsReview: 0 }, results: [] };
  releaseRequest(response);
  await pending;
  assert.strictEqual(state.student.preview, response);
  assert.equal(rendered, 1);
  assert.equal(restored, 1);
  assert.equal(previewButton.disabled, false);

  // The three types of ParnasSys choices must pass the actual control as the
  // anchor to the recalculation (matches, legacy pupils, departed teachers).
  assert.equal((school.match(/await rerun\(select\);/g) || []).length, 3);
  assert.match(school, /row\.dataset\.schoolSyncKey='legacy-teacher:'\+teacher\.id/);
  assert.match(school, /row\.dataset\.schoolSyncKey = 'legacy-student:' \+ student\.id/);
  console.log('Import review scrolling stays stable for books, pupils and staff.');
})().catch(error => { console.error(error); process.exitCode = 1; });
