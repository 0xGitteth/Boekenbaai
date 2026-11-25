'use strict';
const {currentStudentClassIds}=require('./student-class-membership');
const {isActiveTeacher}=require('./reading-change-notifications');
// Conservative, contextual moderation. These lists are maintained separately
// from the reading vocabulary; trends are not inherently abusive.
const TREND_SOURCE='VRT Karrewiet shortlist 23-11-2026; NOS Kinderwoord 2025; Onze Taal 2026';
const TREND_WORDS=[
 '67','6 7','six seven','sixseven','erg of mnu','huss huss huss','skibidi','skibidi toilet',
 'sigma','rizz','brainrot','brain rot','cooked','aura','clock it','faah','tuff','peak','wesh',
 'lowkey','bro','bruh','ohio','pookie','tralalero tralala','bombardiro crocodilo',
];
const normalize=s=>String(s??'').normalize('NFKD').replace(/[\u0300-\u036f\u200b-\u200f\u2060\ufeff]/g,'').toLocaleLowerCase('nl-NL').replace(/[^a-z0-9]+/g,' ').trim();
// Many trendy words are genuine interjections or evaluative language.
// Recognize the full list, but only clear standalone memes can count as noise.
const trends=new Set(TREND_WORDS.map(normalize));
const memeOnly=new Set(['67','6 7','six seven','sixseven','erg of mnu','huss huss huss','skibidi','skibidi toilet','tralalero tralala','bombardiro crocodilo']);
// Match entire meme-only messages, not a meme embedded in real reading text.
const foldMemeWord=word=>word.replace(/([a-z])\1+/g,'$1');
const memePhrases=[...memeOnly].map(phrase=>phrase.split(' ').map(foldMemeWord))
 .sort((a,b)=>b.length-a.length);
const fillerWords=new Set(['bro','bruh','wesh','lol','lmao','lmfao','xd','omg'].map(foldMemeWord));
function isMemeFiller(word){
 return fillerWords.has(foldMemeWord(word))
   ||/^(?:ha){2,}h?$|^a(?:ha){2,}h?$|^(?:he){2,}h?$|^(?:hi){2,}h?$/.test(foldMemeWord(word));
}
function memeMessage(value){
 const words=value.split(' ').filter(w=>w&&!isMemeFiller(w)).map(foldMemeWord);
 let matched=false;
 for(let i=0;i<words.length;){
  const phrase=memePhrases.find(p=>p.every((w,j)=>words[i+j]===w));
  if(!phrase)return false;
  matched=true;i+=phrase.length;
 }
 return matched;
}
function isTrend(text){const value=normalize(text);return trends.has(value)||memeMessage(value);}
const neutral=new Set(['mnu','maakt niet uit','geen idee','weet ik niet','idk','sws','isg','erg','ja','nee','ok','oke']);
const insults='klootzak|klootviool|teringlijer|tyfuslijer|kankerlijer|kankerhoer|kankermongool|mongool|debiel|achterlijke|achterlijk|idioot|stomkop|sukkel|hoer|bitch|fucker|motherfucker|asshole|retard|lul|kutwijf|kutbot|kankerbot';
const directed=new RegExp('\\b(?:jij bent|je bent|jij|jullie zijn|jullie|jij domme|hey|vieze|domme|stomme|vuile|fucking|kut) (?:een |echt |zo |heel |domme |stomme |vieze |vuile )?(?:'+insults+')\\b');
const standalone=new RegExp('^(?:(?:'+insults+'|fuck|kut|tyfus|tering|kanker|stfu|sybau|kys|wtf|fuck you|fuck off|hou je bek|hou je muil|hou je kankerbek|rot op|flikker op|shut up)(?: |$))+$');
const commands=/\b(?:negeer (?:alle |je |de )?(?:regels|instructies)|ignore (?:all |previous |your )?instructions|system prompt|jailbreak|doe alsof je chatgpt bent|vergeet (?:je|alle) regels)\b/;
function classify(text,books=[]){
 const value=normalize(text);
 if(!value||neutral.has(value))return 'normal';
 // Exact existing titles are valid references even when a title is coarse.
 if(books.some(b=>b?.catalogHidden!==true&&normalize(b?.title)===value))return 'normal';
 // A report of bullying, a quotation or discussion of a word should not
 // become a disciplinary incident. Do not guess intent in these contexts.
 // Quotation marks alone do not excuse abuse. Genuine reported speech
 // is ambiguous; do not impose an automatic sanction.
 if(/\b(?:zei|zeiden|riep|riepen|schreef|schreven|noemde|noemden|schold|scholden)\b.*\b(?:tegen mij|naar mij|tegen me|naar me)\b/.test(value))return 'normal';
 if(/["“”„«»]/u.test(String(text))&&/\b(?:zei|zeiden|riep|riepen|schreef|schreven|noemde|noemden|boek|titel|woord|betekent|citaat|personage)\b/.test(value))return 'normal';
 if(/\b(?:ik word uitgescholden|ik werd uitgescholden|ze noemen me|hij noemde me|zij noemde me|iemand zei tegen mij|tegen mij gezegd|ik word gepest|wat betekent|het woord|boek heet|boek met de titel|een boek over)\b/.test(value))return 'normal';
 const withoutFiller=value.split(' ').filter(w=>!isMemeFiller(w)).join(' ');
 if(directed.test(value)||standalone.test(withoutFiller)||/\b(?:hou je (?:bek|muil|kankerbek)|fuck you|fuck off|shut the fuck up|stfu|sybau|kys|kill yourself)\b/.test(value))
  return 'abuse';
 if(commands.test(value))return 'disruption';
 // No unknown-word/typo heuristic. Only a complete known meme or a repeated
 // meme sequence counts as off-topic. Numbers in actual book requests pass.
 if(memeMessage(value))
  return 'meme';
 return 'normal';
}
function state(db,id){
 const row=(Array.isArray(db.studentChoiceModeration)?db.studentChoiceModeration:[]).find(x=>x?.studentId===id);
 return {blocked:row?.blocked===true,warned:row?.warned===true,noise:Number.isInteger(row?.noise)?Math.max(0,Math.min(2,row.noise)):0,
  reason:row?.reason||null,updatedAt:row?.updatedAt||null};
}
function write(db,id,next,now){
 const entries=Array.isArray(db.studentChoiceModeration)?db.studentChoiceModeration:[];
 db.studentChoiceModeration=[...entries.filter(x=>x?.studentId!==id),{studentId:id,...next,updatedAt:now}];
}
function apply(db,id,text,now=new Date().toISOString()){
 const before=state(db,id);
 if(before.blocked)return {kind:'blocked',changed:false};
 const kind=classify(text,db.books||[]);
 if(kind==='normal'){
  if(before.noise)write(db,id,{...before,noise:0},now);
  return {kind:'normal',changed:before.noise>0};
 }
 if(kind==='meme'&&before.noise===0&&!before.warned){
  write(db,id,{...before,noise:1},now);
  return {kind:'redirect',changed:true};
 }
 const next={...before,noise:0,reason:kind,warned:true,blocked:before.warned};
 write(db,id,next,now);
 return {kind:next.blocked?'blocked':'warning',changed:true};
}
function mayUnlock(db,actor,id){
 if(!isActiveTeacher(actor))return false;
 const student=(db.students||[]).find(s=>s?.id===id&&s.active!==false&&s.status!=='inactive');
 if(!student)return false;
 const ids=new Set(currentStudentClassIds(db,student));
 return (db.classes||[]).some(c=>ids.has(c.id)&&Array.isArray(c.teacherIds)&&c.teacherIds.includes(actor.id));
}
function unlock(db,actor,id,now=new Date().toISOString()){
 if(!mayUnlock(db,actor,id))return {status:403,changed:false};
 const before=state(db,id);
 if(!before.blocked&&!before.warned&&!before.noise)return {status:200,changed:false,state:before};
 write(db,id,{blocked:false,warned:false,noise:0,reason:null,unlockedBy:actor.id},now);
 return {status:200,changed:true,state:state(db,id)};
}
module.exports={TREND_SOURCE,TREND_WORDS,isTrend,classify,state,apply,mayUnlock,unlock};
