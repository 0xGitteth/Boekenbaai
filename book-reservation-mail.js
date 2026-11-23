'use strict';

// Only verified school-linked accounts receive reservation mail. Delivery is
// at-most-once per ready event and recipient through the existing Google Apps
// Script bridge. Failed/missing email never hides an in-app notification.
const crypto=require('node:crypto');
const auth=require('./google-auth-core');
const mail=require('./book-import-reminder-mail');
const {recipientsForStudent}=require('./reading-change-notifications');

function recipientMessages(db,links,domain='koraaledu.nl'){
  const recipients=[];
  const teachers=new Map((db.users||[]).filter(u=>u?.role==='teacher'
    &&u.active!==false&&u.status!=='inactive').map(u=>[u.id,u]));
  const activeStudent=id=>(db.students||[]).find(s=>s.id===id
    &&s.active!==false&&s.status!=='inactive');
  for(const booking of db.bookReservations||[]){
    if(booking.status!=='ready'||!booking.readyAt||!booking.readyBookId)continue;
    const student=activeStudent(booking.studentId);
    if(!student)continue;
    const link=auth.findLinkByAccount(links,'student',student.id);
    // A provisional, unverified school-address link is not enough to send
    // personal reservation details about a minor. A verified Google subject
    // must be tied to the pupil account; in-app alerts remain available.
    const studentEmail=link?.sub&&auth.isAllowedSchoolEmail(link.email,domain)
      ?mail.validEmail(link.email):'';
    const readyId=booking.id+':'+booking.readyAt;
    if(studentEmail)recipients.push({
      key:readyId+':student:'+student.id,to:studentEmail,
      subject:'Boekenbaai: je gereserveerde boek is beschikbaar',
      body:'Je gereserveerde boek "'+booking.title
        +'" is teruggebracht en ligt voor je klaar.\n'
        +'Log in op Boekenbaai om het boek te lenen.\n'
        +'Je reservering blijft maximaal 7 dagen beschikbaar.\n\n'
        +'https://boekenbaai.nl\n\nBoekenbaai',
    });
    for(const id of recipientsForStudent(db,student)){
      if(!teachers.has(id))continue;
      const pref=mail.prefsFor(db,id);
      if(pref.mode==='off')continue;
      const email=pref.mode==='alternate'
        ?mail.validEmail(pref.alternateEmail)
        :mail.schoolEmailFor(links,id,domain);
      if(!email)continue;
      recipients.push({
        key:readyId+':teacher:'+id,to:email,
        subject:'Boekenbaai: reservering voor leerling beschikbaar',
        body:'Voor '+String(student.name||'een leerling')
          +' staat het gereserveerde boek "'+booking.title
          +'" klaar.\nBekijk de reservering in het docentenportaal.\n'
          +'De reservering blijft maximaal 7 dagen beschikbaar.\n\n'
          +'https://boekenbaai.nl/staff.html\n\nBoekenbaai',
      });
    }
  }
  return recipients;
}
async function dispatchReservationMail({db,links,folder,env=process.env,
  fetchImpl,now=Date.now(),currentState,shouldStop=()=>false}){
  const cfg=mail.configuration(env);
  const result={ready:cfg.ready,recipients:0,claimed:0,accepted:0,failed:0};
  if(!cfg.ready)return result;
  for(const recipient of recipientMessages(db,links,cfg.schoolDomain)){
    if(shouldStop())break;
    const recipientId=crypto.createHash('sha256').update(recipient.key).digest('hex');
    await mail.withRecipientLock(folder,'reservation:'+recipient.key,async()=>{
      const latest=currentState?currentState():{db,links};
      const current=recipientMessages(latest.db,latest.links,cfg.schoolDomain)
        .find(row=>row.key===recipient.key&&row.to===recipient.to);
      if(!current||shouldStop()||!mail.claimOnce(folder,recipientId))return;
      result.claimed++;result.recipients++;
      const accepted=await mail.bridgeSend({
        config:cfg,id:recipientId,to:recipient.to,subject:recipient.subject,
        body:recipient.body,now,fetchImpl,
      });
      if(accepted)result.accepted++;else result.failed++;
    });
  }
  return result;
}
module.exports={recipientMessages,dispatchReservationMail};
