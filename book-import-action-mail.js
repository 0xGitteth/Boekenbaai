'use strict';
// Action emails use existing task records. They never include names, book
// titles, classes, account addresses or student identifiers in mail bodies.
const crypto = require('node:crypto');
const mail = require('./book-import-reminder-mail');
const admin = require('./book-import-admin-mail');
const { taskStage, settingsFor } = require('./book-import-followups');
const authCore = require('./google-auth-core');
const DAY_MS = mail.DAY_MS;
const REMINDER_DAYS = 7;
const NOTIFICATION_PATH = '/staff.html#teacher-dashboard';
function validTime(input, now) {
  const value = Date.parse(String(input || ''));
  return Number.isFinite(value) && value <= now + 300000 && value > 0 ? value : null;
}
function collectEvents(db, links, now = Date.now()) {
  const events = [];
  const classMap = new Map((db.classes || []).filter(x=>x?.id).map(x=>[x.id,x]));
  const teachers = new Map((db.users || []).filter(x=>x?.role === 'teacher' && x.active !== false
    && x.isActive !== false && x.disabled !== true && x.status !== 'inactive')
    .map(x=>[x.id,x]));
  const teacherIdsForClass = id => (classMap.get(id)?.teacherIds || [])
    .filter(id=>teachers.has(id));
  const push = (type, id, date, category, targets, link = NOTIFICATION_PATH, cycle = null) => {
    const at = validTime(date, now);
    if (!id || !at) return;
    const period = now - at >= REMINDER_DAYS * DAY_MS ? 'reminder' : 'initial';
    const unique = [...new Set(targets)].filter(Boolean);
    if (!unique.length) return;
    events.push({ key: [type,id,cycle || at,period].join(':'), type, category,
      at, period, targets: unique, link });
  };
  for (const request of db.studentTransferRequests || []) {
    if (!request?.id || !(db.students || []).some(student =>
      student.id === request.studentId && student.active !== false && student.status !== 'inactive')) continue;
    if (request.escalatedToAdmin && ['rejected', 'pending'].includes(request.status)) {
      push('transfer_escalation', request.id, request.updatedAt || request.createdAt,
        'transfers', ['admin']);
    } else if (request.status === 'pending') {
      const receivingTeachers = teacherIdsForClass(request.toClassId);
      // A deleted or inactive destination mentor cannot handle the request.
      // Keep the pending transfer visible to administration instead.
      push('transfer_incoming', request.id, request.createdAt,
        'transfers', receivingTeachers.length
          ? receivingTeachers.map(id=>'teacher:'+id) : ['admin']);
    }
  }
  const studentClassIds = student => {
    const set = new Set(student?.classIds || []);
    for (const klass of classMap.values()) if ((klass.studentIds||[]).includes(student.id))set.add(klass.id);
    return [...set];
  };
  // Pending Google identities expire; never notify mentors about a request
  // that the authentication workflow already considers obsolete.
  const activeAuth = authCore.pruneStore(links, now);
  for (const request of activeAuth.linkRequests || []) {
    if (!request?.id || request.status !== 'pending') continue;
    const student = (db.students || []).find(s=>s.id===request.studentId && s.active!==false && s.status !== 'inactive');
    if (!student) {
      // Only real, pending staff-link requests from the existing OAuth
      // workflow are routed to central administration.
      if (request.accountType === 'staff' && request.staffId
        && (db.users || []).some(user => user.id === request.staffId
          && user.role === 'teacher')) {
        push('staff_link', request.id, request.createdAt, 'google', ['admin']);
      }
      continue;
    }
    const ids = studentClassIds(student)
      .flatMap(id=>teacherIdsForClass(id)).map(id=>'teacher:'+id);
    push('student_link',request.id,request.createdAt,'google',
      ids.length?ids:['admin']);
  }
  const config = settingsFor(db);
  const classes = new Set(classMap.keys());
  const books = new Set((db.books || []).map(x=>x?.id).filter(Boolean));
  for (const task of db.bookImportFollowups || []) {
    if (!task?.id) continue;
    if (taskStage(task,config,now,classes,books)==='admin_review') {
      const created = validTime(task.createdAt, now);
      const ageBasedEscalation = created !== null
        && task.status !== 'admin_review'
        && Boolean(task.classId && classes.has(task.classId) && books.has(task.bookId));
      // For automatic age-based escalation, the admin task begins at the
      // configured threshold, not at the original teacher-task creation.
      // Explicit reassignment or missing entities use the action timestamp.
      const escalatedAt = ageBasedEscalation
        ? new Date(created + config.escalationDays * DAY_MS).toISOString()
        : task.escalatedAt || task.updatedAt || task.createdAt;
      push('book_escalation', task.id, escalatedAt,
        'books', ['admin'], '/staff.html#book-import-followups-panel',
        ageBasedEscalation ? task.createdAt : null);
    }
  }
  return events;
}
function recipientGroups(db, links, now = Date.now(), domain = 'koraaledu.nl') {
  const settings = admin.adminSettings(db);
  const adminAddresses = settings.recipients.filter(x => x.verifiedAt);
  const users = new Map((db.users||[]).filter(x=>x?.role==='teacher').map(x=>[x.id,x]));
  const result = new Map();
  for (const event of collectEvents(db,links,now)) {
    for (const target of event.targets) {
      if (target === 'admin') {
        for (const recipient of adminAddresses) {
          if (recipient.categories?.[event.category] !== true) continue;
          add('admin:' + recipient.email, recipient.email, event);
        }
      } else if (target.startsWith('teacher:')) {
        const userId = target.slice(8);
        if (!users.has(userId)) continue;
        const pref = mail.prefsFor(db,userId);
        if (pref.mode === 'off') continue;
        const to = pref.mode === 'alternate' ? pref.alternateEmail
          : mail.schoolEmailFor(links,userId,domain);
        if (mail.validEmail(to)) add('teacher:'+userId,to,event);
      }
    }
  }
  function add(id,to,event) {
    if (!result.has(id))result.set(id,{id,to,events:[]});
    const row=result.get(id);
    if (!row.events.some(x=>x.key===event.key))row.events.push(event);
  }
  return [...result.values()];
}
function emailForActions(count, link, events = []) {
  const categories = [...new Set(events.map(event => event.category))];
  const labels = { transfers: 'klaswissels', google: 'Google-koppelingen',
    books: 'boekcontroles' };
  const summary = categories.map(key => labels[key]).filter(Boolean);
  return 'Er ' + (count === 1 ? 'staat 1 actie' : 'staan '+count+' acties')
    + ' klaar in Boekenbaai waarvoor je aandacht nodig is.\n'
    + (summary.length ? 'Onderwerpen: ' + summary.join(', ') + '.\n' : '') + '\n'
    + 'Bekijk en behandel de openstaande verzoeken in het beveiligde portaal:\n'
    + link + '\n\n'
    + 'Deze e-mail bevat geen leerlingnamen of andere persoonsgegevens.\n'
    + 'Als de acties inmiddels zijn afgehandeld hoef je niets te doen.\n\nBoekenbaai';
}
async function dispatchActions({db,links,folder,env=process.env,now=Date.now(),fetchImpl,currentState,shouldStop=()=>false}) {
  const cfg=mail.configuration(env);
  const result={ready:cfg.ready,claimed:0,accepted:0,failed:0,recipients:0};
  if (!cfg.ready)return result;
  for (const person of recipientGroups(db,links,now,cfg.schoolDomain)) {
    if(shouldStop())break;
    await mail.withRecipientLock(folder,person.id,async()=>{
      const latest=currentState?currentState():{db,links};
      const current=recipientGroups(latest.db,latest.links,now,cfg.schoolDomain)
        .find(row=>row.id===person.id && row.to===person.to);
      if(!current || shouldStop())return;
      const allowed=new Set(current.events.map(event=>event.key));
      const validEvents=person.events.filter(event=>allowed.has(event.key));
      if(!validEvents.length)return;
      const claimed=[];
      for(const event of validEvents) {
        const key=crypto.createHash('sha256').update(JSON.stringify([
          'boekenbaai-action-v1',person.id,event.key,
        ])).digest('hex');
        if(mail.claimOnce(folder,key))claimed.push(key);
      }
      if(!claimed.length)return;
      result.claimed+=claimed.length;
      result.recipients++;
      const accepted=await mail.bridgeSend({
        config:cfg,to:person.to,
        id:crypto.createHash('sha256').update(claimed.join('|')).digest('hex'),
        subject:'Boekenbaai: acties die jouw aandacht nodig hebben',
        body:emailForActions(validEvents.length,cfg.base + (
          validEvents.every(event => event.category === 'books')
            ? '/staff.html#book-import-followups-panel' : NOTIFICATION_PATH
        ),validEvents),
        now:Date.now(),fetchImpl,
      });
      result[accepted?'accepted':'failed']+=claimed.length;
    });
  }
  return result;
}
module.exports={collectEvents,recipientGroups,emailForActions,dispatchActions,REMINDER_DAYS};
