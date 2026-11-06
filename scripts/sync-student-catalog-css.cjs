// The student library deliberately reuses the staff catalogue's real CSS,
// instead of maintaining a visually approximate second implementation.
// Run from the repo root; --check validates the committed generated asset.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const names = ['catalog-v36.css','catalog-v37.css','catalog-v38.css','catalog-v39.css','catalog-v40.css'];
const get = name => fs.readFileSync(path.join(root,'public',name),'utf8');
const transform = source => source.replaceAll('body[data-page="staff"]','body[data-page="student"] #student-collection');
const header = [
  '/* AUTO-GENERATED from live staff catalog CSS (v36..v41). */',
  '/* Do not modify the mirrored section by hand; run node scripts/sync-student-catalog-css.cjs. */',
];
for (const name of names) header.push('\n/* SOURCE ' + name + ' */\n' + transform(get(name)));
const staffCards = get('portal-unified-v41.css');
const start = staffCards.indexOf('/* Staff and admin now use the same airy, white cards as students.');
const end = staffCards.indexOf('@media (max-width:760px) {',start);
if (start < 0 || end < start) throw new Error('Cannot locate canonical unified staff card CSS');
header.push('\n/* SOURCE portal-unified-v41.css: unified staff book-card section */\n'
  + transform(staffCards.slice(start,end)));
const studentOnly = "\n/* Student-only controls retain their real scan and loan actions in the copied\n   staff UI; no staff-only buttons or admin data are introduced here. */\nbody[data-page=\"student\"] .bb-student-content {max-width:1450px;}\nbody[data-page=\"student\"] #student-collection .panel__header {\n  display:flex;align-items:center;margin:0 0 13px;padding:0;\n}\nbody[data-page=\"student\"] #student-collection .panel__header h2 {\n  margin:0;color:#143764;font-size:17px;font-weight:850;\n}\nbody[data-page=\"student\"] #student-collection .bb-cat-search-row {\n  grid-template-columns:minmax(0,1fr) auto minmax(220px,24%);\n  align-items:center;gap:11px;\n}\nbody[data-page=\"student\"] #student-collection .bb-cat-scan-button {\n  min-height:43px;min-width:136px;padding:8px 14px;\n  border:1px solid #173968;border-radius:9px;background:#102f64;\n  color:#fff;font:750 13px/1.2 system-ui,-apple-system,\"Segoe UI\",sans-serif;\n  white-space:nowrap;\n}\nbody[data-page=\"student\"] #student-collection .bb-cat-scan-button:hover {background:#21467b;}\nbody[data-page=\"student\"] #student-collection .bb-cat-scan-button:focus-visible,\nbody[data-page=\"student\"] #student-collection :is(.bb-cat-reset,.bb-cat-advanced-toggle):focus-visible {\n  outline:3px solid #80aef2;outline-offset:2px;\n}\nbody[data-page=\"student\"] #student-collection .bb-student-scan-panel {\n  margin:15px 0 0;border:1px solid #d5e4f7;background:#f7faff;\n}\nbody[data-page=\"student\"] #student-collection .bb-cat-results #summary {\n  display:block;margin:0;padding:0;background:transparent;box-shadow:none;\n  border:0;min-width:0;\n}\nbody[data-page=\"student\"] #student-collection .bb-cat-results #summary strong {\n  display:inline;color:#214e80;font-weight:850;\n}\nbody[data-page=\"student\"] #student-collection .bb-cat-advanced[open] .bb-cat-toggle-copy strong::after {content:\"\";}\n/* In contrast to staff's limited permissions, student access to a book is\n   still enforced by the existing JS role checks and the server. */\nbody[data-page=\"student\"] #student-collection .bb-student-card-action {\n  background:#102f64;border:1px solid #173968;color:#fff;\n}\n@media (max-width:1060px) {\n  body[data-page=\"student\"] #student-collection .bb-cat-search-row {\n    grid-template-columns:minmax(0,1fr) auto;\n  }\n  body[data-page=\"student\"] #student-collection .bb-cat-sort {grid-column:1/-1;justify-content:flex-start;}\n}\n@media (max-width:510px) {\n  body[data-page=\"student\"] #student-collection .bb-cat-search-row {grid-template-columns:1fr;}\n  body[data-page=\"student\"] #student-collection .bb-cat-scan-button {width:100%;min-height:44px;}\n  body[data-page=\"student\"] #student-collection .bb-cat-sort {grid-column:1;}\n  body[data-page=\"student\"] #student-collection .bb-cat-filter-panel {padding:15px 13px 17px;}\n}\n@media (max-width:760px) {\n  body[data-page=\"student\"] #student-collection #book-grid > .book-card {padding:9px;gap:6px;}\n}\n@media (forced-colors:active) {\n  body[data-page=\"student\"] #student-collection #book-grid > .book-card--easy-reading {border:2px solid Highlight;}\n  body[data-page=\"student\"] #student-collection #book-grid > .book-card:focus-visible {outline:3px solid Highlight;outline-offset:3px;}\n}\n";
header.push('\n/* Student-only controls */\n' + studentOnly);
const output = header.join('\n');
const destination = path.join(root,'public','student-catalog-from-staff-v42.css');
if (process.argv.includes('--check')) {
  if (!fs.existsSync(destination) || fs.readFileSync(destination,'utf8') !== output) {
    console.error('Student catalog CSS no longer mirrors current staff styles. Regenerate it.');
    process.exitCode=1;
  } else {
    console.log('Student catalogue mirrors the source-of-truth staff CSS.');
  }
} else {
  fs.writeFileSync(destination,output);
  console.log('Regenerated public/student-catalog-from-staff-v42.css');
}
