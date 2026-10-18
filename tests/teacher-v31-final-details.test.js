'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f),'utf8');
const teacher = read('public/teacher-modern.js');
const classJs = read('public/student-management.js');
const mailJs = read('public/book-import-mail-settings.js');
const markup = read('public/staff.html');
const teacherCss = read('public/teacher-v31-polish.css');
const adminCss = read('public/admin-modern.css');
const backend = read('server.js');
new vm.Script(teacher.replaceAll('import.meta', '({ env: {} })'));
new vm.Script(mailJs.replaceAll('import.meta', '({ env: {} })'));

// Dashboard content must form independent left and right vertical stacks.
assert.match(teacher,/leftColumn\.append\(classesCard, recent\)/);
assert.match(teacher,/rightColumn\.append\(taskCard\)/);
assert.match(teacher,/grid\.append\(leftColumn, rightColumn\)/);
assert.doesNotMatch(teacher,/bb-teacher-v31-start-loan/);
assert.match(teacher,/if \(ownClasses\.length > 5\)/);
assert.match(teacher,/Bekijk alle /);
assert.match(teacherCss,/\.bb-teacher-v31-dashboard-column\s*\{\s*display: grid/);
assert.match(teacherCss,/\.bb-teacher-v31-dashboard-column\s*\{[^}]*align-content: start/);
// The staff class picker has always been selected by number of linked classes.
// With one class it prints a label; with multiple classes it renders a select.
assert.match(classJs,/if \(classes\.length === 1\)/);
assert.match(classJs,/const wrapper = make\('label', \{ className: 'student-management__class-picker' \}\)/);
assert.match(classJs,/select\.addEventListener\('change', \(\) => setActiveClass\(select\.value\)\)/);
// Date input and header must match the rest of the app.
assert.match(teacherCss,/#staff-loan-due\s*\{[^}]*font-family: system-ui/);
assert.match(teacherCss,/#staff-loan-due::-webkit-datetime-edit/);
assert.match(teacherCss,/\.hero--staff \.hero__content h1\s*\{\s*transform: translateY\(3px\)/);
assert.match(adminCss,/\.hero--staff \.hero__content h1\s*\{\s*transform: translateY\(3px\)/);
assert.match(teacherCss,/\.hero--staff \.hero__illustration\s*\{\s*margin-left: 18px/);
assert.match(adminCss,/\.hero--staff \.hero__illustration\s*\{\s*margin-left: 18px/);
// Entirely different recipient forms must be in the logical order.
const account = markup.slice(markup.indexOf('id="book-import-mail-preferences-panel"'),
  markup.indexOf('id="admin-mail-notifications-panel"'));
assert.ok(account.indexOf('id="book-import-mail-request-form"') <
  account.indexOf('id="book-import-mail-mode-form"'));
assert.ok(account.indexOf('id="book-import-mail-code-form"') <
  account.indexOf('id="book-import-mail-mode-form"'));
assert.match(account,/id="book-import-mail-localpart"/);
assert.match(account, /id="book-import-mail-request-address" type="hidden"/);
assert.match(account, /@koraal\.nl/);
assert.match(account, /option value="alternate" hidden disabled/);
assert.match(backend,/if \(!wanted \|\| !wanted\.endsWith\('@koraal\.nl'\)\)/);

// Execute real email-settings controller with a fake DOM and server to verify
// verified status controls the destination and input composes the full domain.
const idList=['book-import-mail-preferences-panel','book-import-mail-status',
 'book-import-mail-mode-form','book-import-mail-mode','book-import-mail-school',
 'book-import-mail-alternate','book-import-mail-request-form',
 'book-import-mail-request-address','book-import-mail-localpart',
 'book-import-mail-code-form','book-import-mail-code',
 'book-import-mail-pending','book-import-mail-config'];
const nodes=Object.fromEntries(idList.map(id=>[id,{
  id, hidden:false,value:'', textContent:'', handlers:{},
  addEventListener(type,callback){this.handlers[type]=callback;},
  classList:{contains(){return false;}},
  focus(){this.focused=true;},
}]));
const alternateOption={hidden:true,disabled:true,textContent:''};
nodes['book-import-mail-mode'].querySelector=()=>alternateOption;
const documentEvents={};
const actions=[];
let data={
  mode:'school',schoolEmail:'docent@koraaledu.nl',
  alternateEmail:'',pendingEmail:'',deliveryConfigured:true,
};
const context=vm.createContext({
  window:{BOEKENBAAI_API_BASE:'https://api.example.test',
    addEventListener(){}},
  document:{getElementById(id){return nodes[id]||null;},
    querySelector(){return null;},
    addEventListener(type,cb){documentEvents[type]=cb;},
    hidden:false},
  localStorage:{getItem(){return 'teacher-token';}},
  fetch: async (url,options) => {
    assert.equal(url,'https://api.example.test/api/staff/book-import-mail-preferences');
    assert.equal(options.headers.Authorization,'Bearer teacher-token');
    if (options.method === 'POST') {
      const action=JSON.parse(options.body);
      actions.push(action);
      if (action.action === 'request_alternative') data.pendingEmail=action.email;
      if (action.action === 'confirm_alternative') {
        data.alternateEmail=data.pendingEmail;
        data.pendingEmail='';
        data.mode='alternate';
      }
      return {ok:true,async json(){return {...data};}};
    }
    return {ok:true,async json(){return {...data};}};
  },
  Error, console,
});
const wait=()=>new Promise(resolve=>setImmediate(resolve));
async function run() {
  new vm.Script(mailJs.replaceAll('import.meta','({ env: {} })')).runInContext(context);
  await wait();
  assert.equal(alternateOption.hidden,true);
  assert.equal(alternateOption.disabled,true);
  assert.equal(nodes['book-import-mail-request-form'].hidden,false);
  assert.equal(nodes['book-import-mail-mode'].value,'school');
  const submitRequest=nodes['book-import-mail-request-form'].handlers.submit;
  assert.equal(typeof submitRequest,'function');
  const event={preventDefault(){}};
  nodes['book-import-mail-localpart'].value='voornaam.achternaam';
  submitRequest(event);
  await wait();await wait();
  assert.equal(actions[0].email,'voornaam.achternaam@koraal.nl');
  assert.equal(nodes['book-import-mail-request-address'].value,
    'voornaam.achternaam@koraal.nl');
  assert.equal(alternateOption.hidden,true,'Pending is not verified');
  nodes['book-import-mail-code'].value='12345678';
  nodes['book-import-mail-code-form'].handlers.submit(event);
  await wait();await wait();
  assert.equal(alternateOption.hidden,false);
  assert.equal(alternateOption.disabled,false);
  nodes['book-import-mail-localpart'].value='niet goed@ander.nl';
  const before=actions.length;
  submitRequest(event);
  await wait();
  assert.equal(actions.length,before,'Invalid localpart must not send an email');
  assert.match(nodes['book-import-mail-status'].textContent, /vóór @koraal\.nl/);
  nodes['book-import-mail-localpart'].value='me';
  submitRequest(event);
  await wait();await wait();
  assert.equal(actions.at(-1).email,'me@koraal.nl');
}
run().then(()=>console.log('Docenten v3.1: class dropdown, stacked cards, date, header and mail domain verified.'))
.catch(e=>{console.error(e);process.exitCode=1;});
