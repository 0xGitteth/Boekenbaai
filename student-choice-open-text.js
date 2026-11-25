'use strict';
// Bounded Dutch vocabulary, not a language model. No raw answer is saved.
// Recognition is provisional until the pupil confirms the interpretation.
const TERMS={
 mystery:['mysterie','mysteries','raadsel','raadsels','detective','detectives','mystery','mysterieuze','geheim','geheimen','misterie','misteries','mysteri','detectief'],
 danger:['spannend','spannende','spanning','gevaar','gevaarlijk','thriller','thrillers','spanend','spanende','thriler','triller','thrilerboek'],
 puzzles:['puzzelen','puzzel','puzzels','aanwijzingen','zelf oplossen','zelf meedenken','raadsel oplossen','speuren','zelf aanwijzingen','zelf ontdekken wie','zelf ontdekken wat','zelf achterhalen','zelf uitzoeken','zelf bedenken wie','meedenken'],
 realistic:['realistisch','realistische','echt kan gebeuren','echt kunnen gebeuren','herkenbaar','herkenbare'],
 true:['waargebeurd','waargebeurde','echt gebeurd','echte sportverhalen','echte verhalen','documentaires','documentaire','non fictie','non-fictie'],
 fantasy:['fantasy','fantasie','magie','draken','tovenaars','fantacy','fantasi','fentasy'],
 humor:['grappig','grappige','humor','lachen','komedie','grapig','grapige','humour','funny','comedy'],
 friendship:['vriendschap','vrienden','vriendinnen'],
 relationships:['liefde','romantiek','relaties','verliefd'],
 school:['school','klas','middelbare school'],
 action:['actie','achtervolgingen','gevechten'],
 adventure:['avontuur','avonturen','avontuurlijk'],
 sport:['sport','sporten','voetbal','basketbal','voetballen','voetball','soccer','fitness','hardlopen','zwemmen','volleybal','volleyballen','hockey','hockeyen','tennis','tennissen','turnen','kickboksen','boksen','wielrennen','atletiek','handbal','badminton','dansen'],
 animals:['dieren','honden','paarden','katten'],
 nature:['natuur','bos','wildernis'],
 science:['wetenschap','ruimtevaart','wetenschappelijk'],
 technology:['techniek','computers','robots','technologie','gamen','programmeren'],
 history:['geschiedenis','historische','vroeger'],
 facts:['informatief','informatie','feiten','iets leren'],
 people:['personages','mensen','personen','problemen die ze meemaken'],
 calm:['rustig','rustige','ontspannend'],
 fast:['snel tempo','veel gebeurt','meteen iets gebeurt'],
 twist:['plotwending','plotwendingen','plot twist','plottwist','verrassend einde','onverwacht einde','aan het einde verrast','verrast worden','verrassing aan het einde','pas op het einde'],
 slow:['langzaam opgebouwde spanning','langzaam opbouwt','spanning langzaam','rustig op gang','langzame spanning'],
 team:['team','teamgenoten','samenwerken','teamwerk'],
 competition:['wedstrijd','wedstrijden','competitie','kampioenschap','toernooi'],
 murder:['moord','moorden','moordenaar','moordenaars','vermoord','vermoorden'],
 horror:['horror','eng','enge','griezel','griezelen','horrorr','horor','scary'],
};
const LABELS={mystery:'mysteries',danger:'spanning',puzzles:'zelf raadsels oplossen',
 realistic:'realistische verhalen',true:'waargebeurde verhalen',fantasy:'fantasie',
 humor:'humor',friendship:'vriendschap',relationships:'liefde of relaties',school:'school',
 action:'actie',adventure:'avontuur',sport:'sport',animals:'dieren',nature:'natuur',
 science:'wetenschap',technology:'techniek',history:'geschiedenis',facts:'informatie',
 people:'personages',calm:'rustige verhalen',fast:'een snel tempo',twist:'onverwachte wendingen',slow:'langzaam opgebouwde spanning',team:'samenwerking',competition:'wedstrijden',murder:'moord',horror:'horror'};
Object.assign(TERMS,{
 choices:['moeilijke keuze','moeilijke keuzes','beslissingen','keuzes'],
 challenge:['uitdaging','uitdagingen','iets bereiken','presteren'],
 unusual:['onverklaarbaar','onverklaarbare gebeurtenissen','vreemde dingen','onverklaarbare dingen'],
 discovery:['ontdekkingen','iets ontdekken','steeds iets meer ontdek'],
 setting:['de wereld waarin het speelt','de omgeving','de wereld van het verhaal'],
});
Object.assign(LABELS,{choices:'moeilijke keuzes',challenge:'uitdagingen',unusual:'onverklaarbare gebeurtenissen',discovery:'ontdekkingen'});
const {THEMES}=require('./student-choice-themes');
for(const [key,[label,terms]] of Object.entries(THEMES)){TERMS[key]=[...(TERMS[key]||[]),...terms];LABELS[key]=label;}
const normalize=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function validateSignals(input){
 const filter=a=>[...new Set((Array.isArray(a)?a:[]).filter(k=>typeof k==='string'&&Object.hasOwn(TERMS,k)))].slice(0,12);
 const avoid=filter(input?.avoid);
 return {prefer:filter(input?.prefer).filter(k=>!avoid.includes(k)),avoid};
}
function interpret(text){
 if(typeof text!=='string'||!text.trim()||text.length>500)return {prefer:[],avoid:[],recognized:false,clarify:true};
 const normalized=normalize(text)
  .replace(/\b(?:gwn|gw|gewoon)\b/g,' ')
  .replace(/\b(?:nie|niett|niettt)\b/g,'niet')
  .replace(/\b(?:geeen|gee[n]+)\b/g,'geen')
  .replace(/\b(?:zndr)\b/g,'zonder')
  .replace(/\b(?:wrm)\b/g,'waarom')
  .replace(/\b(?:eig|eigenlk)\b/g,'eigenlijk')
  .replace(/\s+/g,' ').trim();
 // Questions, double negations, uncertainty and idiomatic negations are
 // not treated as facts about the learner. Ask them to confirm instead.
 if(/\b(?:niet alleen|niet dat|niet geen|geen hekel|weet niet|weet ik niet|geen idee|maakt niet uit|mnu|misschien)\b/.test(normalized))
  return {prefer:[],avoid:[],recognized:false,clarify:true};
 const signals=new Map();
 // Punctuation and contrast words reset negation scope. A comma/and/or
 // after a negative clause may still list things to avoid; confirmation
 // is always required and the learner can correct the interpretation.
 for(const clause of normalized.split(/[.!?;]|\b(?:maar|echter|liever)\b|,\s*wel\b/)){
  const words=clause.replace(/[^a-z0-9-]+/g,' ').trim().split(/\s+/);
  for(const [trait,variants] of Object.entries(TERMS)){
   for(const variant of variants){
    const parts=variant.split(' ');
    for(let i=0;i<=words.length-parts.length;i++){
     if(!parts.every((w,j)=>words[i+j]===w))continue;
     const before=words.slice(0,i);
     const after=words.slice(i+parts.length);
     const afterText=after.join(' ');
     const negativeBefore=before.some(w=>['geen','niet','zonder','vermijd','behalve','hekel'].includes(w));
     // A coordinated list before a trailing dislike predicate is ambiguous:
     // "horror en moord niet leuk" must never label horror positive.
     if(/^(?:en|of)\b.*\b(?:niet leuk|niet fijn|wil ik niet|hoeft niet)\b/.test(afterText))
       return {prefer:[],avoid:[],recognized:false,clarify:true};
     const lastWel=before.lastIndexOf('wel');
     const preceding=lastWel>=0?before.slice(lastWel+1):before;
     const negative=preceding.some(w=>['geen','niet','zonder','vermijd','behalve','hekel'].includes(w))
       ||/^(?:vind ik )?(?:niet leuk|niet fijn|hoeft niet|wil ik niet)/.test(afterText);
     // Don't silently split an unmarked negative list at a comma.
     if(negativeBefore&&lastWel<0&&before.includes('ook')&&before.includes('niet'))
       return {prefer:[],avoid:[],recognized:false,clarify:true};
     signals.set(trait,negative?'avoid':'prefer');
    }
   }
  }
 }
 const result=validateSignals({prefer:[...signals].filter(([,v])=>v==='prefer').map(([k])=>k),avoid:[...signals].filter(([,v])=>v==='avoid').map(([k])=>k)});
 return {...result,recognized:signals.size>0,clarify:signals.size===0};
}
module.exports={interpret,validateSignals,LABELS};
