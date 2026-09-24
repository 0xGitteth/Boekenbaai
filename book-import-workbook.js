'use strict';

const { inflateRawSync } = require('node:zlib');

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

function duplicateBaseHeader(entries, header) {
  const match = String(header).match(/^(.*)_(\d+)$/);
  if (!match || !match[1]) return '';
  const duplicateIndex = Number(match[2]);
  if (!Number.isSafeInteger(duplicateIndex) || duplicateIndex < 1 || duplicateIndex >= entries.length) return '';
  const headers = new Set(entries.map(([candidate]) => String(candidate)));
  if (!headers.has(match[1])) return '';
  for (let index = 1; index < duplicateIndex; index += 1) {
    if (!headers.has(`${match[1]}_${index}`)) return '';
  }
  return match[1];
}

function mapImportRow(row) {
  const fields = Object.create(null);
  const sources = Object.create(null);
  const unknown = [];
  const ignoredDangerousHeaders = [];
  const entries = safeRowEntries(row);

  for (const [header, value] of entries) {
    const rawHeaderText = String(header);
    const rawHeader = rawHeaderText.trim().toLowerCase();
    const potentialDeduplicatedHeader = rawHeaderText.replace(/_\d+$/, '');
    const deduplicatedRawHeader = potentialDeduplicatedHeader.trim().toLowerCase();
    const normalizedHeader = normalizeImportHeader(header);
    const deduplicatedNormalizedHeader = normalizeImportHeader(potentialDeduplicatedHeader);
    const headerKey = importHeaderKey(header);
    if (DANGEROUS_KEYS.has(rawHeader) || DANGEROUS_KEYS.has(deduplicatedRawHeader)
      || DANGEROUS_KEYS.has(normalizedHeader) || DANGEROUS_KEYS.has(deduplicatedNormalizedHeader)
      || DANGEROUS_KEYS.has(headerKey)) {
      ignoredDangerousHeaders.push(header);
      continue;
    }
    const actualDuplicateBase = duplicateBaseHeader(entries, header);
    const deduplicatedHeaderKey = actualDuplicateBase ? importHeaderKey(actualDuplicateBase) : '';
    const field = HEADER_FIELD_MAP.get(headerKey) || (deduplicatedHeaderKey ? HEADER_FIELD_MAP.get(deduplicatedHeaderKey) : undefined);
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
  let previous = '';
  let last = '';
  for (let index = start; index < input.length; index += 1) {
    const char = input[index];
    if (/\s/.test(char)) continue;
    encodedLength += 1;
    previous = last;
    last = char;
  }
  let padding = 0;
  if (last === '=') padding += 1;
  if (previous === '=') padding += 1;
  const estimatedDecodedLength = Math.max(0, Math.floor((encodedLength * 3) / 4) - padding);
  return { encodedLength, estimatedDecodedLength };
}

function base64RawInputInfo(input, maxBytes, options = {}) {
  if (typeof input !== 'string') return null;
  const prefixProbe = input.slice(0, Math.min(input.length, 4128));
  const prefix = /^data:[^,]{0,4096};base64,/i.exec(prefixProbe);
  const prefixLength = prefix ? prefix[0].length : 0;
  const encodedProduct = Math.ceil(maxBytes / 3) * 4;
  const maxEncodedLength = Number.isSafeInteger(encodedProduct)
    ? encodedProduct
    : Number.MAX_SAFE_INTEGER;
  const defaultOverhead = Math.max(64, Math.min(1024 * 1024, Math.ceil(maxEncodedLength / 8)));
  const maxOverheadBytes = Number.isSafeInteger(options.maxBase64OverheadBytes) && options.maxBase64OverheadBytes >= 0
    ? options.maxBase64OverheadBytes
    : defaultOverhead;
  const rawLimitSum = prefixLength + maxEncodedLength + maxOverheadBytes;
  const maxRawLength = Number.isSafeInteger(rawLimitSum) ? rawLimitSum : Number.MAX_SAFE_INTEGER;
  return {
    rawLength: input.length,
    prefixLength,
    maxEncodedLength,
    maxOverheadBytes,
    maxRawLength,
  };
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

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_DIGITAL_SIGNATURE = 0x05054b50;

function isZipContainer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
  const signature = buffer.readUInt32LE(0);
  return signature === ZIP_LOCAL_FILE_HEADER
    || signature === ZIP_END_OF_CENTRAL_DIRECTORY
    || signature === 0x08074b50;
}

function findZipEndOfCentralDirectory(buffer) {
  if (buffer.length < 22) return -1;
  const earliest = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= earliest; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== ZIP_END_OF_CENTRAL_DIRECTORY) continue;
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === buffer.length) return offset;
  }
  return -1;
}

function workbookArchiveLimits(options, maxBytes) {
  const fourfold = maxBytes <= Number.MAX_SAFE_INTEGER / 4 ? maxBytes * 4 : Number.MAX_SAFE_INTEGER;
  const defaultExpandedBytes = Math.max(maxBytes, Math.min(fourfold, 100 * 1024 * 1024));
  return {
    maxExpandedBytes: Number.isSafeInteger(options.maxExpandedBytes) && options.maxExpandedBytes > 0
      ? options.maxExpandedBytes
      : defaultExpandedBytes,
    maxArchiveEntries: Number.isSafeInteger(options.maxArchiveEntries) && options.maxArchiveEntries > 0
      ? options.maxArchiveEntries
      : 4096,
    maxCompressionRatio: typeof options.maxCompressionRatio === 'number'
      && Number.isFinite(options.maxCompressionRatio) && options.maxCompressionRatio > 0
      ? options.maxCompressionRatio
      : 1000,
  };
}

function archiveLimitError(reason, details = {}) {
  return { ok: false, error: 'file_too_large', reason, ...details };
}

function invalidArchive(reason) {
  return { ok: false, error: 'invalid_workbook', reason };
}

function boundedInflateRaw(compressedData, limits, remainingExpandedBytes) {
  const expansionLimit = Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, remainingExpandedBytes + 1));
  const ratioProduct = compressedData.length * limits.maxCompressionRatio;
  const ratioLimit = Math.max(1, Math.min(
    Number.MAX_SAFE_INTEGER,
    Number.isFinite(ratioProduct) ? Math.floor(ratioProduct) + 1 : Number.MAX_SAFE_INTEGER,
  ));
  const maxOutputLength = Math.min(expansionLimit, ratioLimit);
  try {
    return {
      ok: true,
      result: inflateRawSync(compressedData, { info: true, maxOutputLength }),
    };
  } catch (error) {
    if (error && error.code === 'ERR_BUFFER_TOO_LARGE') {
      if (ratioLimit < expansionLimit) {
        return archiveLimitError('archive_compression_ratio', {
          compressedByteLength: compressedData.length,
          maxCompressionRatio: limits.maxCompressionRatio,
        });
      }
      return archiveLimitError('archive_expansion_limit', {
        maxExpandedBytes: limits.maxExpandedBytes,
      });
    }
    return invalidArchive('invalid_zip_stream');
  }
}

function inspectZipExpansion(buffer, options, maxBytes) {
  if (!isZipContainer(buffer)) return { ok: true, isZip: false };

  const eocdOffset = findZipEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) return invalidArchive('invalid_zip_directory');

  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const centralDiskNumber = buffer.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const limits = workbookArchiveLimits(options, maxBytes);

  if (diskNumber !== 0 || centralDiskNumber !== 0 || entriesOnDisk !== totalEntries) {
    return invalidArchive('multi_disk_zip_not_supported');
  }
  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    return archiveLimitError('zip64_archive_not_bounded', {
      maxExpandedBytes: limits.maxExpandedBytes,
    });
  }
  if (totalEntries > limits.maxArchiveEntries) {
    return archiveLimitError('archive_entry_limit', {
      archiveEntries: totalEntries,
      maxArchiveEntries: limits.maxArchiveEntries,
    });
  }

  const centralEnd = centralOffset + centralSize;
  if (!Number.isSafeInteger(centralEnd) || centralEnd > eocdOffset || centralEnd > buffer.length) {
    return invalidArchive('invalid_zip_directory');
  }

  const entries = [];
  let offset = centralOffset;
  let declaredCompressedBytes = 0;
  let declaredExpandedBytes = 0;
  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > centralEnd || buffer.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_HEADER) {
      return invalidArchive('invalid_zip_directory');
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const crc = buffer.readUInt32LE(offset + 16);
    const compressedBytes = buffer.readUInt32LE(offset + 20);
    const expandedBytes = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);

    if (compressedBytes === 0xffffffff || expandedBytes === 0xffffffff || localHeaderOffset === 0xffffffff) {
      return archiveLimitError('zip64_archive_not_bounded', {
        maxExpandedBytes: limits.maxExpandedBytes,
      });
    }

    const nextOffset = offset + 46 + fileNameLength + extraLength + commentLength;
    if (!Number.isSafeInteger(nextOffset) || nextOffset > centralEnd) {
      return invalidArchive('invalid_zip_directory');
    }

    declaredCompressedBytes += compressedBytes;
    declaredExpandedBytes += expandedBytes;
    if (!Number.isSafeInteger(declaredCompressedBytes) || !Number.isSafeInteger(declaredExpandedBytes)) {
      return archiveLimitError('archive_expansion_limit', { maxExpandedBytes: limits.maxExpandedBytes });
    }
    if (declaredExpandedBytes > limits.maxExpandedBytes) {
      return archiveLimitError('archive_expansion_limit', {
        expandedByteLength: declaredExpandedBytes,
        maxExpandedBytes: limits.maxExpandedBytes,
      });
    }

    entries.push({
      flags,
      method,
      crc,
      compressedBytes,
      expandedBytes,
      localHeaderOffset,
      fileName: buffer.subarray(offset + 46, offset + 46 + fileNameLength),
    });
    offset = nextOffset;
  }

  if (offset < centralEnd) {
    if (offset + 6 > centralEnd || buffer.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_DIGITAL_SIGNATURE) {
      return invalidArchive('invalid_zip_directory');
    }
    const signatureLength = buffer.readUInt16LE(offset + 4);
    if (offset + 6 + signatureLength !== centralEnd) return invalidArchive('invalid_zip_directory');
  } else if (offset !== centralEnd) {
    return invalidArchive('invalid_zip_directory');
  }

  let actualCompressedBytes = 0;
  let actualExpandedBytes = 0;
  let previousDataEnd = -1;
  const localOrderEntries = entries.slice().sort((left, right) => left.localHeaderOffset - right.localHeaderOffset);
  for (const entry of localOrderEntries) {
    if (entry.flags & 0x0001) return invalidArchive('encrypted_zip_not_supported');
    if (entry.method !== 0 && entry.method !== 8) return invalidArchive('unsupported_zip_compression');
    if (entry.localHeaderOffset + 30 > centralOffset
      || buffer.readUInt32LE(entry.localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER) {
      return invalidArchive('invalid_zip_local_header');
    }

    const localFlags = buffer.readUInt16LE(entry.localHeaderOffset + 6);
    const localMethod = buffer.readUInt16LE(entry.localHeaderOffset + 8);
    const localCrc = buffer.readUInt32LE(entry.localHeaderOffset + 14);
    const localCompressedBytes = buffer.readUInt32LE(entry.localHeaderOffset + 18);
    const localExpandedBytes = buffer.readUInt32LE(entry.localHeaderOffset + 22);
    const localFileNameLength = buffer.readUInt16LE(entry.localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(entry.localHeaderOffset + 28);
    const dataStart = entry.localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const dataEnd = dataStart + entry.compressedBytes;

    if (localFlags !== entry.flags || localMethod !== entry.method
      || !Number.isSafeInteger(dataStart) || !Number.isSafeInteger(dataEnd)
      || dataStart > centralOffset || dataEnd > centralOffset) {
      return invalidArchive('invalid_zip_local_header');
    }
    if (entry.localHeaderOffset < previousDataEnd || dataStart < previousDataEnd) {
      return invalidArchive('overlapping_zip_entries');
    }
    previousDataEnd = dataEnd;
    const localFileName = buffer.subarray(
      entry.localHeaderOffset + 30,
      entry.localHeaderOffset + 30 + localFileNameLength,
    );
    if (!localFileName.equals(entry.fileName)) return invalidArchive('zip_filename_mismatch');

    const usesDataDescriptor = Boolean(entry.flags & 0x0008);
    if (!usesDataDescriptor
      && (localCompressedBytes !== entry.compressedBytes || localExpandedBytes !== entry.expandedBytes)) {
      return invalidArchive('zip_size_mismatch');
    }
    if (!usesDataDescriptor && localCrc !== entry.crc) {
      return invalidArchive('zip_local_crc_mismatch');
    }

    const compressedData = buffer.subarray(dataStart, dataEnd);
    let expandedData = null;
    let actualExpanded = 0;
    let consumedCompressed = entry.compressedBytes;

    if (entry.method === 0) {
      if (entry.compressedBytes !== entry.expandedBytes) return invalidArchive('zip_size_mismatch');
      expandedData = compressedData;
      actualExpanded = compressedData.length;
    } else {
      const remainingExpandedBytes = Math.max(0, limits.maxExpandedBytes - actualExpandedBytes);
      const inflated = boundedInflateRaw(compressedData, limits, remainingExpandedBytes);
      if (!inflated.ok) return inflated;
      consumedCompressed = inflated.result.engine.bytesWritten;
      expandedData = inflated.result.buffer;
      actualExpanded = expandedData.length;
      if (consumedCompressed !== entry.compressedBytes) return invalidArchive('zip_compressed_size_mismatch');
      if (actualExpanded !== entry.expandedBytes) {
        if (actualExpandedBytes + actualExpanded > limits.maxExpandedBytes) {
          return archiveLimitError('archive_expansion_limit', {
            expandedByteLength: actualExpandedBytes + actualExpanded,
            maxExpandedBytes: limits.maxExpandedBytes,
          });
        }
        return invalidArchive('zip_expanded_size_mismatch');
      }
    }

    if (!expandedData || crc32(expandedData) !== entry.crc) {
      return invalidArchive('zip_crc_mismatch');
    }

    actualCompressedBytes += consumedCompressed;
    actualExpandedBytes += actualExpanded;
    if (actualExpandedBytes > limits.maxExpandedBytes) {
      return archiveLimitError('archive_expansion_limit', {
        expandedByteLength: actualExpandedBytes,
        maxExpandedBytes: limits.maxExpandedBytes,
      });
    }
    if (actualExpanded > 0) {
      const entryRatio = consumedCompressed > 0 ? actualExpanded / consumedCompressed : Number.POSITIVE_INFINITY;
      if (entryRatio > limits.maxCompressionRatio) {
        return archiveLimitError('archive_compression_ratio', {
          compressionRatio: entryRatio,
          maxCompressionRatio: limits.maxCompressionRatio,
          expandedByteLength: actualExpanded,
          compressedByteLength: consumedCompressed,
        });
      }
    }
  }

  if (actualExpandedBytes > 0) {
    const totalRatio = actualCompressedBytes > 0
      ? actualExpandedBytes / actualCompressedBytes
      : Number.POSITIVE_INFINITY;
    if (totalRatio > limits.maxCompressionRatio) {
      return archiveLimitError('archive_compression_ratio', {
        compressionRatio: totalRatio,
        maxCompressionRatio: limits.maxCompressionRatio,
        expandedByteLength: actualExpandedBytes,
        compressedByteLength: actualCompressedBytes,
      });
    }
  }

  return {
    ok: true,
    isZip: true,
    archiveEntries: entries.length,
    expandedByteLength: actualExpandedBytes,
    compressedEntryByteLength: actualCompressedBytes,
  };
}

function readBookImportWorkbook(XLSX, input, options = {}) {
  if (!XLSX || typeof XLSX.read !== 'function' || !XLSX.utils || typeof XLSX.utils.sheet_to_json !== 'function') return { ok: false, error: 'xlsx_unavailable' };
  const maxBytes = Number.isInteger(options.maxBytes) && options.maxBytes > 0 ? options.maxBytes : 25 * 1024 * 1024;
  const directByteLength = Buffer.isBuffer(input)
    ? input.length
    : (input instanceof Uint8Array ? input.byteLength : null);
  if (directByteLength !== null && directByteLength > maxBytes) {
    return { ok: false, error: 'file_too_large', byteLength: directByteLength, maxBytes };
  }
  const rawEncodedInput = base64RawInputInfo(input, maxBytes, options);
  if (rawEncodedInput && rawEncodedInput.rawLength > rawEncodedInput.maxRawLength) {
    return {
      ok: false,
      error: 'file_too_large',
      reason: 'encoded_input_overhead',
      rawEncodedLength: rawEncodedInput.rawLength,
      maxRawEncodedLength: rawEncodedInput.maxRawLength,
      maxBytes,
    };
  }
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
  const archiveInspection = inspectZipExpansion(buffer, options, maxBytes);
  if (!archiveInspection.ok) return archiveInspection;
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
