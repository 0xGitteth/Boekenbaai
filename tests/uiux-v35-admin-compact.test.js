'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'public/uiux-v32.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public/uiux-v32.css'), 'utf8');
new vm.Script(script, { filename: 'uiux-v32.js' });
const start = script.indexOf("    const statsToolbar = make('section', 'bb-v35-stats-toolbar');");
const end = script.indexOf('    const metrics = overview.querySelector', start);
assert.ok(start > 0 && end > start, 'The stats replacement must happen before metric decoration.');
const make = (tag, className) => ({
  tag, className, children: [], attrs: {}, parent: null,
  append(node) {
    if (node.parent) node.parent.children =
      node.parent.children.filter(item => item !== node);
    this.children.push(node);
    node.parent = this;
  },
  setAttribute(key, value) { this.attrs[key] = value; },
});
const title = make('h3');
const description = make('p');
const statsControls = make('div');
statsControls.id = 'bb-admin-v31-stats';
const liveButton = make('button');
let presses = 0;
liveButton.click = () => { presses++; };
statsControls.append(liveButton);
const oldCard = make('section', 'bb-admin-v31-card--stats');
oldCard.append(title);
oldCard.append(description);
oldCard.append(statsControls);
oldCard.querySelector = selector => ({
  h3: title, p: description, '#bb-admin-v31-stats': statsControls,
})[selector];
oldCard.remove = () => { oldCard.removed = true; };
let toolbar = null;
const grid = { after(node) { toolbar = node; } };
vm.runInNewContext(script.slice(start, end), {
  make, stats: oldCard, grid,
});
assert.ok(oldCard.removed, 'The old stretched card must leave the DOM.');
assert.equal(toolbar.className, 'bb-v35-stats-toolbar');
assert.equal(toolbar.attrs['aria-label'], 'Schoolstatistieken');
assert.equal(toolbar.children[0].children[0], title);
assert.equal(toolbar.children[0].children[1], description);
assert.equal(toolbar.children[1], statsControls);
assert.equal(statsControls.children[0], liveButton, 'Move the live control, never clone it.');
liveButton.click();
assert.equal(presses, 1, 'The original button keeps its attached handler.');

// Both cards must have their own intrinsic height, including the single-column
// mobile/tablet layout. Do not re-introduce a 275px minimum for empty tasks.
const toolbarRule = styles.match(/body\.bb-admin-v31\.bb-v32-active #admin-dashboard \.bb-v32-dashboard > \.bb-v35-stats-toolbar\s*\{([^}]+)\}/);
assert.ok(toolbarRule, 'The new toolbar has its own scoped CSS.');
assert.match(toolbarRule[1], /height:\s*auto/);
assert.match(toolbarRule[1], /min-height:\s*0/);
assert.match(toolbarRule[1], /align-self:\s*start/);
const taskRule = styles.match(/body\.bb-admin-v31\.bb-v32-active #admin-dashboard \.bb-v32-admin-grid\.bb-admin-v31-grid > \.bb-admin-v31-card--actions\s*\{([^}]+)\}/);
assert.ok(taskRule, 'A layout override for the task card is needed.');
assert.match(taskRule[1], /align-self:\s*start/);
assert.match(taskRule[1], /min-height:\s*0/);
assert.match(styles, /\.bb-admin-v31-card--actions\.bb-admin-v31-card--empty-actions\s*\{[^}]*height:\s*fit-content/);
assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.bb-v35-stats-toolbar\s*\{/);
console.log('Admin v3.5: school stats controls preserved, compact cards at responsive sizes.');
