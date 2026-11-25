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
 technology:['techniek','computers','robots','technologie','programmeren'],
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
const normalize=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[’‘]/g,"'");
const PHRASES={
 mystery:['iets ontdekt wat niemand anders weet','iets ontdekt dat niemand anders weet','een geheim ontdekken','achter een geheim komt','uitzoeken wat er gebeurd is','erachter komen wat er is gebeurd'],
 puzzles:['zelf raden wie het heeft gedaan','zelf uitvogelen wie','zelf bedenken wat er gebeurd is'],
 realistic:['zou kunnen gebeuren','in het echt kan gebeuren'],
 humor:['waar ik om kan lachen','moet lachen','veel grappen'],
 fast:['veel dingen gebeuren','geen lange aanloop','meteen spannend wordt'],
 relationships:['verliefd worden','op iemand verliefd'],
 identity:['jezelf kunnen zijn','jezelf leren kennen','ontdekken wie je bent'],
 facts:['meer te weten komen','iets nieuws leren'],
 danger:['op het puntje van je stoel','spannend blijft'],
 culturalIdentity:['opgroeien met twee culturen','tussen verschillende culturen opgroeien']
};
for(const [id,phrases] of Object.entries(PHRASES))if(TERMS[id])TERMS[id].push(...phrases);
// Remove other people's preferences, not statements about fictional people.
// Only explicit subjects of preference predicates trigger this rule.
function ownInterestText(input){
 return String(input||'').split(/([.!?;]|\b(?:maar|echter)\b|\ben ik\b)/i).filter((part,i)=>i%2||!/^\s*(?:(?:mijn|m'n|mn|me)\s+(?:moeder|vader|ouders|broer|zus|vriend|vriendin|vrienden|mentor|docent|opa|oma|klasgenoot)|(?:hij|zij|ze|die))\s+(?:houdt? van|vind(?:t|en)?|leest|lezen|doet|speelt|kijkt|luistert|heeft interesse in)\b/i.test(part)).join(' ').replace(/\ben ik\b/gi,'ik');
}
function validateSignals(input){
 const filter=a=>[...new Set((Array.isArray(a)?a:[]).filter(k=>typeof k==='string'&&Object.hasOwn(TERMS,k)))].slice(0,24);
 const avoid=filter(input?.avoid);
 return {prefer:filter(input?.prefer).filter(k=>!avoid.includes(k)),avoid};
}
function interpret(text){
 if(typeof text!=='string'||!text.trim()||text.length>500)return {prefer:[],avoid:[],recognized:false,clarify:true};
 const normalized=normalize(ownInterestText(text))
  .replace(/\b(?:gwn|gw|gewoon)\b/g,' ')
  .replace(/\b(?:nie|niett|niettt)\b/g,'niet')
  .replace(/\b(?:geeen|gee[n]+)\b/g,'geen')
  .replace(/\b(?:zndr)\b/g,'zonder')
  .replace(/\b(?:wrm)\b/g,'waarom')
  .replace(/\b(?:eig|eigenlk)\b/g,'eigenlijk')
  .replace(/\b(?:vind k|vin ik|vindt ik)\b/g,'vind ik')
  .replace(/\b(?:k hou|k houd)\b/g,'ik hou')
  .replace(/\b(?:wou|wil k)\b/g,'wil')
  .replace(/\b(?:interesant|interessand)\b/g,'interessant')
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
// Small, conservative typo suggestions. These are never applied as preferences.
const EXACT_TOPIC_WORDS=new Set(Object.values(TERMS).flatMap(terms=>terms.flatMap(term=>term.split(' '))));
const TYPO_IGNORE=new Set(['lezen','boeken','graag','liever','leuke','leuker','interessant','vinden','precies','thema','verhalen','eigenlijk','vooral','alleen']);
function suggestTopics(text){
 const words=normalize(text).replace(/[^a-z0-9 ]/g,' ').trim().split(/\s+/);
 if(!words.length||words.length>16)return [];
 function distance(a,b){
  let previous=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
   const row=[i];
   for(let j=1;j<=b.length;j++)row[j]=Math.min(row[j-1]+1,previous[j]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1));
   previous=row;
  }
  return previous[b.length];
 }
 const candidates=new Map();
 // Curated possible directions for ambiguous activities, not assumed meanings.
 const hints={urbex:['photography','historicalDailyLife','travel']};
 for(const word of words)for(const key of hints[word]||[])candidates.set(key,1);
 for(const word of words.filter(w=>w.length>=5&&!EXACT_TOPIC_WORDS.has(w)&&!TYPO_IGNORE.has(w))){
  for(const [key,variants] of Object.entries(TERMS)){
   for(const variant of variants){
    if(!/^[a-z]{5,}$/.test(variant)||Math.abs(word.length-variant.length)>1)continue;
    if(word!==variant&&distance(word,variant)===1)candidates.set(key,1);
   }
  }
 }
 return [...candidates.keys()].slice(0,3);
}
module.exports={interpret,validateSignals,LABELS,suggestTopics,ownInterestText};
