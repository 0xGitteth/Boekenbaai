'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'public');
const css = fs.readFileSync(path.join(root, 'portal-typography-v52.css'), 'utf8');
for (const name of ['index.html', 'staff.html']) {
  const html = fs.readFileSync(path.join(root, name), 'utf8');
  assert.match(html, /portal-typography-v52\.css/);
  assert.match(html, /family=Fredoka/);
  assert.match(html, /family=Nunito/);
  assert.ok(html.indexOf('portal-typography-v52.css') < html.indexOf('portal-compact-six-v48.css'),
    'Keep shared catalogue CSS last to retain six column layout tests');
}
assert.match(css, /@layer boekenbaai-typografie/);
assert.match(css, /font-family:"Nunito",system-ui,sans-serif!important/);
assert.match(css, /\.bb-student-brand-text/);
assert.match(css, /\.bb-login-wordmark > span:last-child/);
assert.match(css, /\.hero--staff \.hero__content h1/);
assert.match(css, /font-family:"Fredoka","Nunito",system-ui,sans-serif!important/);
assert.doesNotMatch(css, /grid-template-columns/);
const nOpen = (css.match(/\{/g) || []).length;
const nClose = (css.match(/\}/g) || []).length;
assert.equal(nOpen, nClose);
console.log('Nunito/Fredoka portal typography and existing catalogue grid integration OK');
