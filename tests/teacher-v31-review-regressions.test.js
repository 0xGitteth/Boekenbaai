'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const js = fs.readFileSync(path.join(__dirname, '..', 'public/teacher-modern.js'), 'utf8');

const addrStart = js.indexOf('  const configuredBase = ');
const addrEnd = js.indexOf('  const el = (', addrStart);
const fnStart = js.indexOf('  function clearClassSummary() {');
const fnEnd = js.indexOf('  function sync() {', fnStart);
assert.ok(addrStart >= 0 && addrEnd > addrStart && fnStart >= 0 && fnEnd > fnStart);
const configSource = js.slice(addrStart, addrEnd).replaceAll('import.meta', '({ env: {} })');
const logic = js.slice(fnStart, fnEnd);

class Element {
  constructor(tag, className = '', text = '') {
    this.tag = tag;
    this.className = className;
    this.textContent = text;
    this.children = [];
    this.parent = null;
  }
  append(node) { this.children.push(node); node.parent = this; }
  replaceChildren(...nodes) {
    this.children = [];
    for (const node of nodes) this.append(node);
  }
  querySelector(selector) {
    if (selector === 'h2') return this.children.find(x => x.tag === 'h2');
    if (selector === 'strong') return this.children.find(x => x.tag === 'strong');
    return null;
  }
  querySelectorAll(selector) {
    const classes = selector.split(',').map(s => s.trim().replace('.', ''));
    return this.children.filter(x => classes.some(name => x.className.split(' ').includes(name)));
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this);
  }
}
function element(tag, cls, text) { return new Element(tag, cls, text); }

async function check() {
  const metrics = new Element('div');
  const card = new Element('section');
  const heading = new Element('h2');
  const startPanel = new Element('section');
  startPanel.append(heading);
  // Teacher A was previously shown before teacher B signed in.
  card.append(element('button', 'bb-teacher-v31-row', 'Vorige docent, klas A'));
  const calls = [];
  let rejectFirst = true;
  let deferFollowups = false;
  let heldFollowupReject = null;
  let signalHeldFollowup = null;
  const ctx = vm.createContext({
    requestId: 0, active: true, importTaskCount: null,
    refreshTaskMetric() {
      const strong = metrics.children[3]?.querySelector('strong');
      if (strong) strong.replaceChildren({
        textContent: String(ctx.importTaskCount ?? '—'),
      });
    },
    window: { BOEKENBAAI_API_BASE: 'https://api.example.test/' },
    document: {
      querySelector() { return { content: '' }; },
      createTextNode(s) { return { textContent: s }; },
      getElementById(id) {
        return ({
          'bb-teacher-v31-metrics': metrics,
          'bb-teacher-v31-classes-summary': card,
          'staff-name': { textContent: 'Docent B' },
        })[id] ?? null;
      },
    },
    localStorage: { getItem() { return 'tokenB'; } },
    panels: { start: startPanel },
    el: element,
    addAction(parent, name, subtitle) {
      parent.append(element('button', 'bb-teacher-v31-row', name + ': ' + subtitle));
    },
    fetch: async (url, options) => {
      calls.push({url, options});
      if (rejectFirst) throw Error('Backend tijdelijk offline');
      if (url.endsWith('/api/staff/loans')) return {
        ok: true, async json() {
          return {classes: [{id:'B',name:'Nieuw klas B'}],
            students:[{id:'s1',active:true,classIds:['B']}],loans:[]};
        },
      };
      if (url.endsWith('/api/staff/book-import-followups')) {
        if (deferFollowups) return new Promise((_resolve, reject) => {
          heldFollowupReject = reject;
          signalHeldFollowup?.();
        });
        return { ok:true, async json() { return { summary: {open:3} }; } };
      }
      throw Error('Onverwacht endpoint: '+url);
    },
    Date, Set, Error, String,
  });
  new vm.Script(configSource + '\n' + logic +
    '\nthis.run = updateStart; this.clearClasses = clearClassSummary;')
    .runInContext(ctx);

  const failed = ctx.run();
  // Ensure the previous teacher's classes are gone immediately, not only after fetch.
  assert.equal(card.querySelectorAll('.bb-teacher-v31-row').length, 0);
  await failed;
  assert.equal(card.querySelectorAll('.bb-teacher-v31-row').length, 0);
  assert.equal(card.querySelectorAll('.bb-teacher-v31-classes-state').length, 1);
  assert.match(card.children.at(-1).textContent, /tijdelijk niet beschikbaar/);
  assert.equal(calls[0].url, 'https://api.example.test/api/staff/loans');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer tokenB');

  rejectFirst = false;
  await ctx.run();
  assert.equal(card.querySelectorAll('.bb-teacher-v31-classes-state').length, 0,
    'Error/empty state of previous account may not persist');
  assert.equal(card.querySelectorAll('.bb-teacher-v31-row').length, 1);
  assert.match(card.children.at(-1).textContent, /Nieuw klas B/);
  assert.equal(calls[1].url, 'https://api.example.test/api/staff/loans');
  assert.equal(calls[2].url, 'https://api.example.test/api/staff/book-import-followups');
  assert.equal(metrics.children.length, 4);
  assert.equal(metrics.children[0].querySelector('strong').textContent, '1');
  assert.equal(metrics.children[3].querySelector('strong').children[0].textContent, '3');

  // Codex P2 reproduction: request A has fetched classes but still awaits
  // book-follow-up tasks. Logout must invalidate it even when tasks reject.
  deferFollowups = true;
  const waitForTask = new Promise(resolve => { signalHeldFollowup = resolve; });
  const stale = ctx.run();
  await waitForTask;
  assert.equal(typeof heldFollowupReject, 'function', 'Task request is held in-flight');
  ++ctx.requestId;
  ctx.active = false;
  ctx.clearClasses();
  assert.equal(card.querySelectorAll('.bb-teacher-v31-row').length, 0);
  heldFollowupReject(new Error('Follow-ups server offline'));
  await stale;
  assert.equal(card.querySelectorAll('.bb-teacher-v31-row').length, 0,
    'An invalidated request must not restore previous teacher classes');
  assert.equal(card.querySelectorAll('.bb-teacher-v31-classes-state').length, 0);

  // A newer dashboard refresh must also win over an older task failure,
  // even if the role stays active throughout.
  ctx.active = true;
  deferFollowups = true;
  const waitForOldTask = new Promise(resolve => { signalHeldFollowup = resolve; });
  const outdated = ctx.run();
  await waitForOldTask;
  const rejectOutdated = heldFollowupReject;
  deferFollowups = false;
  await ctx.run();
  assert.equal(card.querySelectorAll('.bb-teacher-v31-row').length, 1);
  rejectOutdated(new Error('Old tasks failed late'));
  await outdated;
  assert.equal(card.querySelectorAll('.bb-teacher-v31-row').length, 1,
    'An outdated rejected follow-up must not remove fresh classes');

  // Logout always clears the class list and invalidates in-flight responses.
  assert.match(js, /\+\+requestId;\s*clearClassSummary\(\);\s*closeMenu\(\);/);
  assert.match(js, /if \(current !== requestId \|\| !active\) return;/);
}
check().then(() => console.log('Docenten P2 API-base en accountwissel regressies geslaagd.'))
  .catch(error => { console.error(error); process.exitCode = 1; });
