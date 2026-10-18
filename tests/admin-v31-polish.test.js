'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'public/admin-modern.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/admin-modern.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/staff.html'), 'utf8');
const dok = fs.readFileSync(path.join(root, 'public/logo/het-dok-header-v31.svg'), 'utf8');
const book = fs.readFileSync(path.join(root, 'public/logo/boekenbaai-book-mark-v31.svg'), 'utf8');

new vm.Script(js, { filename: 'public/admin-modern.js' });

// The logo SVG has transparency and a legible light fill on the navy header.
assert.match(dok, /<svg\s/);
assert.match(dok, /viewBox="0 0 859 279"/);
assert.match(dok, /fill="#f5f9ff"/);
for (const color of ['#ddb725', '#00b4f1']) {
  assert.ok(dok.includes(color), 'Het Dok brand color missing: ' + color);
}
assert.doesNotMatch(dok, /<rect\b|background=/);
assert.match(book, /<svg\s/);
assert.match(css, /logo\/boekenbaai-book-mark-v31\.svg/);

// The legacy staff hero forces actions to width:100%; override it.
assert.match(css, /hero--staff \.hero__content \{[\s\S]*?flex: 0 0 auto;/);
assert.match(css, /hero--staff \.hero__illustration \{[\s\S]*?order: 0;/);
assert.match(css, /hero--staff \.hero__illustration \{[\s\S]*?background: transparent;/);
assert.match(css, /hero--staff \.hero__actions \{[\s\S]*?margin: 0 0 0 auto;[\s\S]*?width: auto;/);
assert.match(css, /hero--staff \.hero__actions \{[\s\S]*?justify-content: flex-end;/);
assert.match(js, /logo\.src = 'logo\/het-dok-header-v31\.svg'/);
assert.match(js, /logo\.dataset\.v31OriginalSrc/);
assert.match(js, /logo\.setAttribute\('src', logo\.dataset\.v31OriginalSrc\)/);
assert.match(html, /href="index\.html">Terug naar leerlingen<\/a>/);
assert.match(css, /body\[data-page='staff'\]:has\(#staff-meta:not\(\.hidden\)\) \.hero--staff \.hero__link/);

// Start contains no duplicate shortcuts or add-book button.
const overview = js.slice(js.indexOf('function createOverviewView()'), js.indexOf('function createPeopleView('));
assert.doesNotMatch(overview, /Snel naar|bb-admin-v31-quick|data-v31-add-book|Nieuw boek|showBookEditor/);
assert.match(overview, /bb-admin-v31-card--actions/);
assert.match(overview, /bb-admin-v31-card--stats/);
assert.match(overview, /bb-admin-v31-card--activity/);
assert.match(overview, /bb-admin-v31-activity-actions/);
assert.match(js, /bb-admin-v31-open-editor/);
assert.match(js, /showBookEditor\(true\)/);
assert.match(css, /bb-admin-v31-column \{[\s\S]*?align-content: start;/);
assert.match(css, /\.bb-admin-v31-card \{[\s\S]*?min-height: 0;/);

// Reuse the original privileged logbook button, restore on role change.
assert.match(js, /mountSharedPanel\('history-actions', 'bb-admin-v31-activity-actions'\)/);
assert.match(js, /marker\.after\(element\)/);
assert.match(css, /#bb-admin-v31-activity #history-panel > \.panel__header \{[\s\S]*?display: none !important;/);
assert.match(css, /#bb-admin-v31-activity-actions #history-actions:not\(\.hidden\)/);
for (const id of ['admin-stats-button', 'history-clear-button', 'logout-button', 'admin-book-cancel']) {
  assert.ok(html.includes('id="' + id + '"'), id + ' must remain available');
}
assert.match(css, /@media \(max-width: 480px\)/);
assert.match(css, /@media \(max-width: 760px\)/);
assert.match(css, /prefers-reduced-motion/);

console.log('Beheer v3.1 final header, dashboard and logbook regressions passed.');
