'use strict';

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function normalizeImportHeader(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[’‘`´]/g, "'")
    .replace(/[_]+/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function importHeaderKey(value) {
  return normalizeImportHeader(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const FIELD_ALIAS_DEFINITIONS = Object.freeze({
  title: ['titel', 'title', 'boektitel', 'boek titel'],
  author: ['auteur', 'author', 'schrijver', 'auteurs'],
  authorFirst: ['voornaam schrijver', 'voornaam auteur', 'auteur voornaam', 'author first name', 'first name author'],
  authorLast: ['achternaam schrijver', 'achternaam auteur', 'auteur achternaam', 'author last name', 'last name author'],
  isbn: ['isbn', 'isbn nummer', 'isbn-nummer', 'isbn13', 'isbn 13', 'isbn-13', 'editie isbn', 'edition isbn'],
  barcode: ['barcode', 'streepjescode', 'ean', 'ean13', 'ean 13', 'ean-13', 'fysieke barcode', 'exemplaar barcode'],
  ambiguousIdentifier: ['barcode isbn', 'barcode / isbn', 'barcode/isbn', 'isbn barcode', 'isbn / barcode'],
  metadataIsbn: ['metadata isbn', 'metadataisbn', 'intern isbn', 'intern-isbn', 'internisbn', 'isbn inwendig', 'isbn-inwendig'],
  quantity: ['aantal', 'aantal exemplaren', 'quantity', 'exemplaren', 'copies', 'number of copies'],
  description: ['beschrijving', 'description', 'samenvatting', 'summary'],
  publisher: ['uitgever', 'uitgeverij', 'publisher', 'publisher name'],
  publishedYear: ['jaar', 'jaar van uitgave', 'publicatiejaar', 'publishedyear', 'year', 'jaaruitgave', 'published', 'publication year'],
  pageCount: ['paginas', "pagina's", 'pagina’s', 'aantal paginas', "aantal pagina's", 'aantal pagina’s', 'pages', 'pagecount', 'page count'],
  language: ['taal', 'language', 'taalcode', 'language code'],
  coverUrl: ['cover', 'cover url', 'coverurl', 'afbeelding', 'image', 'image url', 'afbeelding url'],
  themes: ["thema's", 'thema’s', 'themas', 'thema'],
  tags: ['tags', 'trefwoorden', 'keywords', 'onderwerpen', 'onderwerp(en)'],
  examMaterial: ['examenmateriaal', 'leeslijst', 'op de leeslijst', 'examlist', 'exam list'],
  easyReading: ['makkelijk lezen', 'makkelijk lezen?', 'makkelijk lezen ?'],
  classes: ['klassen', 'klas', 'klassen context', 'class context'],
  classLoan: ['geleend door klas', 'uitgeleend aan klas', 'class loan', 'geleend klas'],
  studentLoan: ['naam leerling', 'geleend door leerling', 'leerling', 'student name', 'student loan'],
  libraryPresence: ['aanwezig bieb', 'aanwezig bibliotheek', 'in bieb', 'in bibliotheek'],
});

const HEADER_FIELD_MAP = (() => {
  const map = new Map();
  for (const [field, aliases] of Object.entries(FIELD_ALIAS_DEFINITIONS)) {
    for (const alias of aliases) map.set(importHeaderKey(alias), field);
  }
  return map;
})();

function isBlankCellValue(value) {
  return value === null || value === undefined || (typeof value === 'string' && !value.trim());
}

function jsonSafeCellValue(value) {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return String(value);
  return null;
}

function scalarCellText(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return '';
}

function safeRowEntries(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return [];
  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(row); } catch { return []; }
  const entries = [];
  for (const [header, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) continue;
    entries.push([header, descriptor.value]);
  }
  return entries;
}

function worksheetRowNumber(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  let descriptor;
  try { descriptor = Object.getOwnPropertyDescriptor(row, '__rowNum__'); } catch { return null; }
  if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
  return Number.isInteger(descriptor.value) && descriptor.value >= 0 ? descriptor.value : null;
}

function valuesEquivalent(left, right) {
  const a = scalarCellText(left).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  const b = scalarCellText(right).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  return a === b;
}

function mapImportRow(row) {
  const fields = Object.create(null);
  const sources = Object.create(null);
  const unknown = [];
  const ignoredDangerousHeaders = [];

  for (const [header, value] of safeRowEntries(row)) {
    const rawHeader = String(header).trim().toLowerCase();
    const deduplicatedRawHeader = String(header).replace(/_\d+$/, '').trim().toLowerCase();
    const normalizedHeader = normalizeImportHeader(header);
    const deduplicatedNormalizedHeader = normalizeImportHeader(String(header).replace(/_\d+$/, ''));
    const headerKey = importHeaderKey(header);
    if (DANGEROUS_KEYS.has(rawHeader) || DANGEROUS_KEYS.has(deduplicatedRawHeader)
      || DANGEROUS_KEYS.has(normalizedHeader) || DANGEROUS_KEYS.has(deduplicatedNormalizedHeader)
      || DANGEROUS_KEYS.has(headerKey)) {
      ignoredDangerousHeaders.push(header);
      continue;
    }
    const deduplicatedHeaderKey = importHeaderKey(String(header).replace(/_\d+$/, ''));
    const field = HEADER_FIELD_MAP.get(headerKey) || HEADER_FIELD_MAP.get(deduplicatedHeaderKey);
    if (!field) {
      unknown.push({ header, value: jsonSafeCellValue(value) });
      continue;
    }
    if (!sources[field]) sources[field] = [];
    sources[field].push({ header, value: jsonSafeCellValue(value) });
    if (!Object.prototype.hasOwnProperty.call(fields, field) || isBlankCellValue(fields[field])) fields[field] = value;
  }

  const collisions = [];
  for (const [field, candidates] of Object.entries(sources)) {
    const populated = candidates.filter((entry) => !isBlankCellValue(entry.value));
    if (populated.length < 2) continue;
    const distinct = [];
    for (const entry of populated) {
      if (!distinct.some((known) => valuesEquivalent(known.value, entry.value))) distinct.push(entry);
    }
    if (distinct.length > 1) collisions.push({ field, candidates: distinct });
  }

  return { fields, sources, unknown, collisions, ignoredDangerousHeaders, worksheetRowNumber: worksheetRowNumber(row) };
}

function decodeWorkbookInput(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input);
  if (typeof input !== 'string') return null;
  const raw = input.replace(/^data:.*?;base64,/i, '').trim();
  if (!raw) return null;
  try { return Buffer.from(raw, 'base64'); } catch { return null; }
}

function base64PayloadInfo(input) {
  if (typeof input !== 'string') return null;
  let start = 0;
  const prefix = /^data:[^,]{0,4096};base64,/i.exec(input);
  if (prefix) start = prefix[0].length;
  let encodedLength = 0;
  let lastSignificant = '';
  let previousSignificant = '';
  for (let index = start; index < input.length; index += 1) {
    const character = input[index];
    if (/\s/.test(character)) continue;
    encodedLength += 1;
    previousSignificant = lastSignificant;
    lastSignificant = character;
  }
  let padding = 0;
  if (lastSignificant === '=') padding += 1;
  if (previousSignificant === '=') padding += 1;
  const estimatedDecodedLength = Math.max(0, Math.floor((encodedLength * 3) / 4) - padding);
  return { encodedLength, estimatedDecodedLength };
}

function ownDataValue(source, key) {
  if (!source || typeof source !== 'object') return undefined;
  let descriptor;
  try { descriptor = Object.getOwnPropertyDescriptor(source, key); } catch { return undefined; }
  return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor.value : undefined;
}

function worksheetRangeInfo(XLSX, rangeValue) {
  if (typeof rangeValue !== 'string' || !rangeValue.trim()) return null;
  if (XLSX?.utils && typeof XLSX.utils.decode_range === 'function') {
    try {
      const decoded = XLSX.utils.decode_range(rangeValue);
      if (decoded && Number.isInteger(decoded?.s?.r) && Number.isInteger(decoded?.e?.r) && decoded.e.r >= decoded.s.r) {
        return {
          startRow: decoded.s.r + 1,
          endRow: decoded.e.r + 1,
          rowCount: decoded.e.r - decoded.s.r + 1,
        };
      }
    } catch {
      // Fall through to the conservative text parser.
    }
  }
  const endMatch = rangeValue.match(/(?:^|:)\$?[A-Za-z]+\$?(\d+)$/);
  const startMatch = rangeValue.match(/^\$?[A-Za-z]+\$?(\d+)(?::|$)/);
  if (!endMatch || !startMatch) return null;
  const startRow = Number(startMatch[1]);
  const endRow = Number(endMatch[1]);
  if (!Number.isSafeInteger(startRow) || !Number.isSafeInteger(endRow) || startRow < 1 || endRow < startRow) return null;
  return { startRow, endRow, rowCount: endRow - startRow + 1 };
}

function firstSheet(workbook) {
  const sheetName = Array.isArray(workbook?.SheetNames) ? workbook.SheetNames[0] : '';
  const sheets = workbook && workbook.Sheets && typeof workbook.Sheets === 'object' ? workbook.Sheets : null;
  let sheetDescriptor = null;
  try { sheetDescriptor = sheets ? Object.getOwnPropertyDescriptor(sheets, sheetName) : null; } catch { sheetDescriptor = null; }
  if (!sheetName || !sheetDescriptor || !Object.prototype.hasOwnProperty.call(sheetDescriptor, 'value') || !sheetDescriptor.value) return null;
  return { sheetName, sheet: sheetDescriptor.value };
}

function readBookImportWorkbook(XLSX, input, options = {}) {
  if (!XLSX || typeof XLSX.read !== 'function' || !XLSX.utils || typeof XLSX.utils.sheet_to_json !== 'function') return { ok: false, error: 'xlsx_unavailable' };
  const maxBytes = Number.isInteger(options.maxBytes) && options.maxBytes > 0 ? options.maxBytes : 25 * 1024 * 1024;
  const encodedSize = base64PayloadInfo(input);
  if (encodedSize && encodedSize.estimatedDecodedLength > maxBytes) {
    return {
      ok: false,
      error: 'file_too_large',
      encodedLength: encodedSize.encodedLength,
      estimatedByteLength: encodedSize.estimatedDecodedLength,
      maxBytes,
    };
  }
  const buffer = decodeWorkbookInput(input);
  if (!buffer || !buffer.length) return { ok: false, error: 'empty_file' };
  if (buffer.length > maxBytes) return { ok: false, error: 'file_too_large', byteLength: buffer.length, maxBytes };
  const maxRows = Number.isInteger(options.maxRows) && options.maxRows > 0 ? options.maxRows : 20000;
  const initialSheetRows = Math.min(maxRows + 2, Number.MAX_SAFE_INTEGER);

  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', sheets: 0, sheetRows: initialSheetRows });
  } catch {
    return { ok: false, error: 'invalid_workbook' };
  }
  let resolvedSheet = firstSheet(workbook);
  if (!resolvedSheet) return { ok: false, error: 'missing_sheet' };

  let rangeInfo = worksheetRangeInfo(XLSX, ownDataValue(resolvedSheet.sheet, '!fullref'));
  if (rangeInfo && rangeInfo.rowCount > maxRows + 1) {
    return { ok: false, error: 'too_many_rows', sheetName: resolvedSheet.sheetName, worksheetRows: rangeInfo.rowCount, maxRows };
  }

  if (rangeInfo && rangeInfo.endRow > initialSheetRows && rangeInfo.rowCount <= maxRows + 1) {
    try {
      workbook = XLSX.read(buffer, { type: 'buffer', sheets: 0, sheetRows: rangeInfo.endRow });
    } catch {
      return { ok: false, error: 'invalid_workbook' };
    }
    resolvedSheet = firstSheet(workbook);
    if (!resolvedSheet) return { ok: false, error: 'missing_sheet' };
    rangeInfo = worksheetRangeInfo(XLSX, ownDataValue(resolvedSheet.sheet, '!fullref')) || rangeInfo;
    if (rangeInfo && rangeInfo.rowCount > maxRows + 1) {
      return { ok: false, error: 'too_many_rows', sheetName: resolvedSheet.sheetName, worksheetRows: rangeInfo.rowCount, maxRows };
    }
  }

  let rows;
  try { rows = XLSX.utils.sheet_to_json(resolvedSheet.sheet, { defval: '', raw: true }); } catch { return { ok: false, error: 'invalid_sheet' }; }
  if (!Array.isArray(rows) || !rows.length) return { ok: false, error: 'empty_sheet', sheetName: resolvedSheet.sheetName };
  if (rows.length > maxRows) return { ok: false, error: 'too_many_rows', sheetName: resolvedSheet.sheetName, rowCount: rows.length, maxRows };

  const headers = [];
  const seen = new Set();
  for (const row of rows) {
    for (const [header] of safeRowEntries(row)) {
      if (seen.has(header)) continue;
      seen.add(header);
      headers.push(header);
    }
  }
  return { ok: true, sheetName: resolvedSheet.sheetName, headers, rows };
}

module.exports = {
  FIELD_ALIAS_DEFINITIONS,
  normalizeImportHeader,
  importHeaderKey,
  isBlankCellValue,
  scalarCellText,
  jsonSafeCellValue,
  safeRowEntries,
  mapImportRow,
  readBookImportWorkbook,
};
