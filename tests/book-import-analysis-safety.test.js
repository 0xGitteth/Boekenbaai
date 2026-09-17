'use strict';

const assert = require('assert');
const { analyzeBookImportRows, analyzeBookImportWorkbook } = require('../book-import-analysis');
const { mapImportRow, readBookImportWorkbook } = require('../book-import-workbook');

const ISBN = '9780306406157';
const ISBN_ALT = '9780439554930';
const codes = (row) => new Set(row.issues.map((issue) => issue.code));

module.exports = async function runSafetyTests() {
  const malicious = { Titel: 'Veilig', Auteur: 'A Auteur', 'ISBN-nummer': ISBN };
  Object.defineProperty(malicious, '__proto___1', { value: 'evil', enumerable: true, configurable: true });
  Object.defineProperty(malicious, 'getter', { get() { throw new Error('must not run'); }, enumerable: true });
  const mapped = mapImportRow(malicious);
  assert.deepStrictEqual(mapped.ignoredDangerousHeaders, ['__proto___1']);
  assert.strictEqual(mapped.unknown.some((entry) => entry.header === 'getter'), false);
  assert.strictEqual({}.evil, undefined);

  const invalid = await analyzeBookImportRows([
    { Titel: 'Boolean ISBN', Auteur: 'A Auteur', 'ISBN-nummer': true },
    { Titel: 'Aantal', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Aantal: {} },
    { Titel: 'Meerdere', Auteur: 'A Auteur', 'ISBN-nummer': ISBN_ALT, Barcode: 'PHYS-1', Aantal: 2 },
  ]);
  assert.strictEqual(invalid.rows[0].status, 'conflict');
  assert.ok(codes(invalid.rows[0]).has('unsupported_identifier_type'));
  assert.strictEqual(invalid.rows[1].status, 'conflict');
  assert.ok(codes(invalid.rows[1]).has('invalid_quantity'));
  assert.strictEqual(invalid.rows[2].status, 'conflict');
  assert.ok(codes(invalid.rows[2]).has('barcode_with_multiple_copies'));

  const malformedQuantities = await analyzeBookImportRows([
    { Titel: 'Hex aantal', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Aantal: '0x10' },
    { Titel: 'Exponent aantal', Auteur: 'B Auteur', 'ISBN-nummer': ISBN_ALT, Aantal: '1e3' },
  ]);
  for (const quantityRow of malformedQuantities.rows) {
    assert.strictEqual(quantityRow.status, 'conflict');
    assert.ok(codes(quantityRow).has('invalid_quantity'));
    assert.strictEqual(quantityRow.book.quantity.value, 1);
    assert.strictEqual(quantityRow.book.quantity.valid, false);
  }

  const malformedNumericMetadata = await analyzeBookImportRows([{
    Titel: 'Numeriek bronformaat', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Jaar: '0x7e4', Paginas: '1e3',
  }]);
  assert.strictEqual(malformedNumericMetadata.rows[0].book.publishedYear, null);
  assert.strictEqual(malformedNumericMetadata.rows[0].book.pageCount, null);
  assert.ok(codes(malformedNumericMetadata.rows[0]).has('invalid_published_year'));
  assert.ok(codes(malformedNumericMetadata.rows[0]).has('invalid_page_count'));

  const likelyBadIsbn = await analyzeBookImportRows([{
    Titel: 'Geen barcode', Auteur: 'A Auteur', 'Barcode / ISBN': '9780306406158',
  }]);
  assert.strictEqual(likelyBadIsbn.rows[0].book.barcode, '');
  assert.ok(codes(likelyBadIsbn.rows[0]).has('isbn_repair_suggested'));
  assert.ok(!codes(likelyBadIsbn.rows[0]).has('ambiguous_identifier_interpreted_as_barcode'));

  const duplicate = await analyzeBookImportRows([
    { Titel: 'A', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Barcode: 'PHYS-1' },
    { Titel: 'B', Auteur: 'B Auteur', 'ISBN-nummer': ISBN_ALT, Barcode: 'PHYS-1' },
  ]);
  assert.strictEqual(duplicate.rows[0].status, 'conflict');
  assert.strictEqual(duplicate.rows[1].status, 'conflict');
  assert.ok(codes(duplicate.rows[0]).has('duplicate_physical_barcode'));

  const runtimeDuplicate = await analyzeBookImportRows([
    { Titel: 'Runtime A', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Barcode: '123-456' },
    { Titel: 'Runtime B', Auteur: 'B Auteur', 'ISBN-nummer': ISBN_ALT, Barcode: '123456' },
  ]);
  assert.strictEqual(runtimeDuplicate.rows[0].status, 'conflict');
  assert.strictEqual(runtimeDuplicate.rows[1].status, 'conflict');
  assert.ok(codes(runtimeDuplicate.rows[0]).has('duplicate_physical_barcode'));
  assert.ok(codes(runtimeDuplicate.rows[1]).has('duplicate_physical_barcode'));

  const junk = await analyzeBookImportRows([{ Titel: 'hh' }]);
  assert.strictEqual(junk.rows[0].status, 'skipped');
  assert.strictEqual(junk.rows[0].context.skipReason, 'junk');
  assert.deepStrictEqual(junk.rows[0].issues, []);
  assert.strictEqual(junk.summary.physicalCopies, 0);

  let skippedLookupCalls = 0;
  const ownBook = await analyzeBookImportRows([{ Titel: 'Boek', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, 'naam leerling': 'eigen boek' }], {
    lookupIsbn: async () => { skippedLookupCalls += 1; return null; },
  });
  assert.strictEqual(ownBook.rows[0].status, 'skipped');
  assert.strictEqual(skippedLookupCalls, 0);

  const ownBookWithBadSource = await analyzeBookImportRows([{
    Titel: 'Privé bronfout', Auteur: 'A Auteur', 'ISBN-nummer': 'bad', 'naam leerling': 'eigen boek',
  }]);
  assert.strictEqual(ownBookWithBadSource.rows[0].context.excludeFromSchoolCollection, true);
  assert.strictEqual(ownBookWithBadSource.rows[0].status, 'skipped');
  assert.ok(codes(ownBookWithBadSource.rows[0]).has('invalid_or_unrecognized_isbn'));

  const conflictingOwnBook = { Titel: 'Tegenstrijdig eigen boek', Auteur: 'A Auteur', 'ISBN-nummer': ISBN };
  Object.defineProperty(conflictingOwnBook, 'naam leerling', { value: 'eigen boek', enumerable: true });
  Object.defineProperty(conflictingOwnBook, 'naam leerling_1', { value: 'Sam Test', enumerable: true });
  const conflictingOwnBookResult = await analyzeBookImportRows([conflictingOwnBook], {
    students: [{ id: 's1', name: 'Sam Test' }],
  });
  assert.strictEqual(conflictingOwnBookResult.rows[0].context.excludeFromSchoolCollection, true);
  assert.strictEqual(conflictingOwnBookResult.rows[0].status, 'conflict');
  assert.ok(codes(conflictingOwnBookResult.rows[0]).has('own_book_context_conflict'));
  assert.strictEqual(conflictingOwnBookResult.rows[0].context.studentLoan.name, 'Sam Test');

  const ownAndFixed = await analyzeBookImportRows([{
    Titel: 'Dubbele betekenis', Auteur: 'A Auteur', 'ISBN-nummer': ISBN_ALT, 'naam leerling': 'eigen boek; Klassenboek',
  }]);
  assert.strictEqual(ownAndFixed.rows[0].context.excludeFromSchoolCollection, true);
  assert.strictEqual(ownAndFixed.rows[0].context.fixedLocation.status, 'conflicting');
  assert.strictEqual(ownAndFixed.rows[0].status, 'conflict');
  assert.ok(codes(ownAndFixed.rows[0]).has('own_book_context_conflict'));

  const bigId = await analyzeBookImportRows([{ Titel: 'Big', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, 'naam leerling': 'Sam Test' }], {
    students: [{ id: 12345678901234567890n, name: 'Sam Test' }],
  });
  assert.strictEqual(bigId.rows[0].context.studentLoan.id, '12345678901234567890');
  assert.doesNotThrow(() => JSON.stringify(bigId));

  const workbookRow = { Titel: 'Werkboek', Auteur: 'A Auteur', 'ISBN-nummer': ISBN };
  Object.defineProperty(workbookRow, '__rowNum__', { value: 5, enumerable: false });
  let workbookReadOptions = null;
  const fakeXlsx = {
    read(_input, readOptions) {
      workbookReadOptions = readOptions;
      return { SheetNames: ['Boeken'], Sheets: { Boeken: { fake: true } } };
    },
    utils: { sheet_to_json() { return [workbookRow]; } },
  };
  const workbook = await analyzeBookImportWorkbook(fakeXlsx, Buffer.from('fake'));
  assert.strictEqual(workbook.ok, true);
  assert.strictEqual(workbook.workbook.sheetName, 'Boeken');
  assert.strictEqual(workbook.rows[0].sourceRowNumber, 6);
  assert.strictEqual(workbookReadOptions.sheets, 0);
  assert.strictEqual(workbookReadOptions.sheetRows, 20002);

  let materializedOversizedSheet = false;
  const oversizedRange = readBookImportWorkbook({
    read(_input, readOptions) {
      assert.strictEqual(readOptions.sheetRows, 4);
      return { SheetNames: ['B'], Sheets: { B: { '!fullref': 'A1:A100' } } };
    },
    utils: {
      decode_range() { return { s: { r: 0 }, e: { r: 99 } }; },
      sheet_to_json() { materializedOversizedSheet = true; return []; },
    },
  }, Buffer.from('x'), { maxRows: 2 });
  assert.strictEqual(oversizedRange.error, 'too_many_rows');
  assert.strictEqual(materializedOversizedSheet, false, 'Oversized worksheet ranges must be rejected before JSON materialization');

  const tooMany = readBookImportWorkbook({
    read() { return { SheetNames: ['B'], Sheets: { B: {} } }; },
    utils: { sheet_to_json() { return new Array(3).fill({ Titel: 'x' }); } },
  }, Buffer.from('x'), { maxRows: 2 });
  assert.strictEqual(tooMany.error, 'too_many_rows');

  const rows = [];
  for (let i = 0; i < 10000; i += 1) {
    const row = {
      Titel: i % 97 === 0 ? 'hh' : `Boek ${i}`,
      Auteur: i % 13 === 0 ? 'nvt' : `Auteur ${i % 37}`,
      'Voornaam schrijver': i % 13 === 0 ? 'Voor' : '',
      'Achternaam schrijver': i % 13 === 0 ? 'Naam' : '',
      'ISBN-nummer': i % 29 === 0 ? true : ISBN,
      Klassen: i % 31 === 0 ? 'eigen boek' : '',
      Aantal: i % 211 === 0 ? {} : 1,
    };
    if (i % 101 === 0) Object.defineProperty(row, '__proto___1', { value: 'x', enumerable: true });
    rows.push(row);
  }
  const stress = await analyzeBookImportRows(rows, { maxCopies: 20000 });
  assert.strictEqual(stress.ok, true);
  assert.strictEqual(stress.rows.length, 10000);
  assert.doesNotThrow(() => JSON.stringify(stress));
};
