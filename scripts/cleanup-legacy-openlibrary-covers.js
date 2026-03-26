#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { rewriteLegacyOpenLibraryArchiveCoverUrl } = require('../lib/cover-url');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const fileArg = args.find((arg) => arg.startsWith('--file='));

const defaultPath = process.env.BOEKENBAAI_DATA_PATH
  ? path.resolve(process.cwd(), process.env.BOEKENBAAI_DATA_PATH)
  : path.join(__dirname, '..', 'data', 'db.json');
const dataPath = fileArg ? path.resolve(process.cwd(), fileArg.slice('--file='.length)) : defaultPath;

if (!fs.existsSync(dataPath)) {
  console.error(`Data-bestand niet gevonden: ${dataPath}`);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
} catch (error) {
  console.error(`Kon data-bestand niet lezen/parsen: ${error.message}`);
  process.exit(1);
}

const books = Array.isArray(data.books) ? data.books : [];
let rewrites = 0;

for (const book of books) {
  if (!book || typeof book !== 'object') continue;
  const current = book.coverUrl;
  const rewritten = rewriteLegacyOpenLibraryArchiveCoverUrl(current);
  if (typeof current === 'string' && typeof rewritten === 'string' && current.trim() && current.trim() !== rewritten) {
    rewrites += 1;
    if (apply) {
      book.coverUrl = rewritten;
    }
  }
}

if (apply && rewrites > 0) {
  fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

const mode = apply ? 'APPLY' : 'DRY-RUN';
console.log(`[${mode}] Bestand: ${dataPath}`);
console.log(`[${mode}] Aantal herschreven coverUrl-velden: ${rewrites}`);
if (!apply) {
  console.log('[DRY-RUN] Voeg --apply toe om wijzigingen op te slaan.');
}
