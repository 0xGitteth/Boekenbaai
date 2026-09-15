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

  const junk = await analyzeBookImportRows([{ Titel: 'hh' }]);
  assert.strictEqual(junk.rows[0].status, 'skipped');
  assert.strictEqual(junk.rows[0].context.skipReason, 'junk');
  assert.deepStrictEqual(junk.rows[0].issues, []);
  assert.strictEqual(junk.summary.physicalCopies, 0);

  let skippedLookupCalls = 0;
  const ownBook = await analyzeBookImportRows([{ Titel: 'Boek', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Notitie: 'eigen boek' }], {
    lookupIsbn: async () => { skippedLookupCalls += 1; return null; },
  });
  assert.strictEqual(ownBook.rows[0].status, 'skipped');
  assert.strictEqual(skippedLookupCalls, 0);

  const bigId = await analyzeBookImportRows([{ Titel: 'Big', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, 'naam leerling': 'Sam Test' }], {
    students: [{ id: 12345678901234567890n, name: 'Sam Test' }],
  });
  assert.strictEqual(bigId.rows[0].context.studentLoan.id, '12345678901234567890');
  assert.doesNotThrow(() => JSON.stringify(bigId));

  const workbookRow = { Titel: 'Werkboek', Auteur: 'A Auteur', 'ISBN-nummer': ISBN };
  Object.defineProperty(workbookRow, '__rowNum__', { value: 5, enumerable: false });
  const fakeXlsx = {
    read() { return { SheetNames: ['Boeken'], Sheets: { Boeken: { fake: true } } }; },
    utils: { sheet_to_json() { return [workbookRow]; } },
  };
  const workbook = await analyzeBookImportWorkbook(fakeXlsx, Buffer.from('fake'));
  assert.strictEqual(workbook.ok, true);
  assert.strictEqual(workbook.workbook.sheetName, 'Boeken');
  assert.strictEqual(workbook.rows[0].sourceRowNumber, 6);
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
