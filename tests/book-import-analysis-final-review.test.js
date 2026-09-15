'use strict';

const assert = require('assert');
const XLSX = require('xlsx');
const { analyzeBookImportRows } = require('../book-import-analysis');
const { readBookImportWorkbook } = require('../book-import-workbook');

const ISBN = '9780306406157';
const ISBN_ALT = '9780439554930';

module.exports = async function runFinalReviewTests() {
  let titleAuthorLookups = 0;
  const conflictingSuggestions = await analyzeBookImportRows([{
    Titel: 'Dubbele suggestie',
    Auteur: 'A Auteur',
    'ISBN-nummer': '978030640615',
    'Intern ISBN': '978043955493',
  }], {
    lookupTitleAuthor: async () => {
      titleAuthorLookups += 1;
      return { title: 'Dubbele suggestie', author: 'A Auteur', isbn13: ISBN, found: true, source: 'test' };
    },
  });
  const suggestionRow = conflictingSuggestions.rows[0];
  assert.strictEqual(suggestionRow.status, 'conflict');
  assert.strictEqual(suggestionRow.book.editionIsbn, '');
  assert.strictEqual(titleAuthorLookups, 0, 'Conflicting source repair suggestions must block automatic metadata resolution');
  const suggestionConflict = suggestionRow.issues.find((issue) => issue.code === 'conflicting_isbn_repair_suggestions');
  assert.ok(suggestionConflict);
  assert.deepStrictEqual(suggestionConflict.suggestedIsbns, [ISBN, ISBN_ALT].sort());

  const rows = [['Titel', 'Auteur', 'ISBN-nummer']];
  for (let index = 0; index < 100; index += 1) rows.push([`Boek ${index}`, 'A Auteur', ISBN]);
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Boeken');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  let sheetToJsonCalled = false;
  const guardedXlsx = {
    read: (...args) => XLSX.read(...args),
    utils: {
      ...XLSX.utils,
      sheet_to_json: (...args) => {
        sheetToJsonCalled = true;
        return XLSX.utils.sheet_to_json(...args);
      },
    },
  };
  const limited = readBookImportWorkbook(guardedXlsx, buffer, { maxRows: 2 });
  assert.strictEqual(limited.ok, false);
  assert.strictEqual(limited.error, 'too_many_rows');
  assert.strictEqual(sheetToJsonCalled, false, 'Real SheetJS row limiting should reject oversized sheets before JSON materialization');
};
