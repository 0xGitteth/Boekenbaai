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
const boek = fs.readFileSync(path.join(root, 'public/logo/boekenbaai-book-mark-v31.svg'), 'utf8');

new vm.Script(js, { filename: 'public/admin-modern.js' });
assert.match(dok, /<svg\s/);
assert.match(dok, /viewBox="0 0 859 279"/);
for (const color of ['#083f88', '#ddb725', '#00b4f1']) {
  assert.ok(dok.includes(color), 'Het Dok wordmark must retain its brand colour ' + color);
}
assert.match(boek, /<svg\s/);
assert.match(boek, /stroke="#fff"/);
assert.match(css, /logo\/boekenbaai-book-mark-v31\.svg/);

// The school logo is to the right of the Boekenbaai wordmark,
// never reordered to the beginning of the page header.
assert.match(css, /hero--staff \.hero__illustration \{[\s\S]*?order: 0;/);
assert.doesNotMatch(css, /hero--staff \.hero__illustration \{[\s\S]*?order: -1;/);
assert.match(js, /logo\.src = 'logo\/het-dok-header-v31\.svg'/);
assert.match(js, /logo\.src = 'logo\/het-dok-logo\.svg'/);
assert.match(js, /logo\.alt = 'Het Dok'/);
assert.match(js, /if \(intro\) intro\.textContent = '';/);
assert.match(js, /if \(intro\) intro\.textContent = 'Houd zicht op de voortgang/);
assert.match(html, /href="index\.html">Terug naar leerlingen<\/a>/);
assert.match(css, /body\[data-page='staff'\]:has\(#staff-meta:not\(\.hidden\)\) \.hero--staff \.hero__link/);

// No fixed-height empty task card. History should stack immediately below
// the actual account tasks, not be forced down by Snel naar.
assert.match(js, /class="bb-admin-v31-column"/);
assert.match(js, /bb-admin-v31-card--actions/);
assert.match(js, /bb-admin-v31-card--activity/);
assert.match(js, /bb-admin-v31-card--quick/);
assert.match(js, /bb-admin-v31-card--stats/);
assert.match(js, /classList\.toggle\('bb-admin-v31-card--empty-actions', !pending\.length\)/);
assert.match(css, /bb-admin-v31-column \{[\s\S]*?align-content: start;/);
assert.match(css, /\.bb-admin-v31-card \{[\s\S]*?min-height: 0;/);
assert.doesNotMatch(css, /\.bb-admin-v31-card \{[^}]*min-height: 290px/);
assert.match(css, /\.bb-admin-v31-quick-icon/);
assert.match(css, /\.bb-admin-v31-quick-open/);
assert.match(js, /make\('span', \{ className: 'bb-admin-v31-quick-icon'/);
assert.match(js, /make\('span', \{ className: 'bb-admin-v31-quick-open'/);

// Auth, role and existing admin functionality stay in their original modules.
for (const id of ['admin-stats-button', 'history-clear-button', 'logout-button', 'admin-book-cancel']) {
  assert.ok(html.includes('id="' + id + '"'), id + ' must remain available');
}
assert.match(css, /#bb-admin-v31-activity #history-actions:not\(\.hidden\)/);
assert.match(css, /@media \(max-width: 480px\)/);
assert.match(css, /@media \(max-width: 760px\)/);
assert.match(css, /prefers-reduced-motion/);
console.log('Beheer header-, logo-, empty-state- and viewport-regression checks passed.');
