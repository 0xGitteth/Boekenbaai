'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'public/admin-modern.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/admin-modern.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/staff.html'), 'utf8');

new vm.Script(js, { filename: 'public/admin-modern.js' });

const nav = [
  ['overview', 'Start'],
  ['books', 'Boeken'],
  ['people', 'Personen en klassen'],
  ['loans', 'Uitlenen en innemen'],
  ['tasks', 'Taken'],
  ['imports', 'Importeren'],
  ['settings', 'Instellingen'],
];
for (const [key, label] of nav) {
  assert.match(js, new RegExp('\\[\\x27' + key + '\\x27, \\x27' + label + '\\x27,'),
    'De zeven goedgekeurde navigatieonderdelen moeten aanwezig zijn: ' + label);
}
assert.match(js, /bb-admin-v31-sidebar/);
assert.match(js, /aria-current', 'page'/);
assert.match(js, /closeMobileNavigation/);
assert.match(js, /sidebar\.inert = closed/);
assert.match(js, /addEventListener\('change', syncMobileNavigation\)/);
assert.match(js, /\['students', 'Leerlingen'\], \['teachers', 'Docenten'\], \['classes', 'Klassen'\]/);
assert.match(js, /ArrowRight/);
assert.match(js, /aria-labelledby', 'bb-people-tab-/);

// All relocated components are the real DOM nodes, not copies of form markup.
const mounts = [
  ['.teacher-layout__overview', 'bb-admin-v31-catalog'],
  ['staff-loan-panel', 'bb-admin-v31-loans'],
  ['book-import-followups-panel', 'bb-admin-v31-tasks'],
  ['history-panel', 'bb-admin-v31-activity'],
  ['admin-mail-notifications-panel', 'bb-admin-v31-settings'],
];
for (const [source, destination] of mounts) {
  assert.ok(js.includes("mountSharedPanel('" + source + "', '" + destination + "')"),
    'Ontbrekende verhuizing ' + source);
}
assert.match(js, /marker\.after\(element\)/,
  'Bij rolwisseling moeten gedeelde componenten terug naar hun oorspronkelijke plek.');
assert.match(js, /document\.body\.classList\.toggle\('bb-admin-v31', active\)/,
  'Beheerlay-out mag alleen actief zijn na admin-login.');
assert.match(js, /legacySection\.hidden = true/,
  'Het lege tweede boekenoverzicht mag niet zichtbaar zijn.');
assert.match(js, /staff-book-overview-toggle/,
  'De bestaande inklapfunctie voor de catalogus moet blijven werken.');
assert.match(js, /admin-stats-button/,
  'Bestaande schoolstatistieken moeten bereikbaar blijven.');
assert.match(js, /admin-book-cancel/,
  'Bewerken moet afbreekbaar blijven.');
assert.match(js, /book-detail-edit/,
  'Bewerken vanuit boekdetails moet het juiste formulier openen.');
assert.match(app, /adminBookCancelButton\?\.addEventListener\('click', \(event\) => \{[\s\S]*?resetAdminBookForm\(\)/,
  'Annuleren moet de volledige interne boekenformulierstatus resetten.');
assert.match(app, /function resetAdminBookForm\(\)[\s\S]*?selectedBookId = null;/,
  'Een geannuleerde bewerking mag niet een oud boek geselecteerd houden.');

for (const id of [
  'admin-book-form', 'admin-book-cancel', 'admin-book-list', 'staff-book-overview-content',
  'staff-book-overview-toggle', 'admin-stats-button', 'staff-loan-panel',
  'history-panel', 'book-import-followups-panel', 'admin-mail-notifications-panel',
  'student-import-form', 'teacher-import-form', 'book-grid',
]) {
  assert.ok(html.includes('id="' + id + '"'), 'Vereiste bestaande interfacekoppeling ontbreekt: ' + id);
}
assert.match(css, /body\.bb-admin-v31/);
assert.match(css, /--bb-navy: #102f64/);
assert.match(css, /--bb-canvas: #f0f4fa/);
assert.match(css, /grid-template-columns: 230px minmax\(0, 1fr\)/);
assert.match(css, /@media \(max-width: 760px\)/);
assert.match(css, /prefers-reduced-motion/);

console.log('Beheer v3.1 functiebehoud- en navigatietests geslaagd.');
