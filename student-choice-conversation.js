'use strict';
const crypto=require('node:crypto');
const {interpret,validateSignals,LABELS}=require('./student-choice-open-text');
const {traitsForBook}=require('./student-choice-dialogue');
// Every fallback answer has an explicit, validated mapping. No AI service,
// inferred personal attributes, free-text logging or fabricated book facts.
const Q=[];
function add(id,stage,when,prompt,examples,options){
 Q.push({id,stage,when:when.split(' ').filter(Boolean),prompt,examples,
 options:options.map(([label,traits,length],i)=>({id:String(i),label,prefer:traits.split(' ').filter(Boolean),length:length||''}))});
}
add('opening',0,'','Waar lees je graag over?','Misschien helpt het als ik een paar onderwerpen noem.',[
 ['Misdaad en mysteries','crime mystery'],['Sport','sport'],['Vriendschap en relaties','friendship relationships'],['Fantasie en avontuur','fantasy adventure'],['Dieren en natuur','animals nature'],['Waargebeurde verhalen','true'],['Wetenschap en techniek','science technology']]);
add('free-time',0,'','Wat doe je graag als je niet op school bent?','Zit hier iets tussen wat je leuk vindt om te doen?',[
 ['Gamen','gaming'],['Sporten','sport'],['Films of series kijken',''],['Met dieren bezig zijn','animals'],['Muziek luisteren','music'],['Tekenen of iets maken','art']]);
add('watch',0,'','Wat kijk je graag aan films, series of filmpjes?','Wat kijk je bijvoorbeeld graag?',[
 ['Misdaadseries','crime'],['Documentaires','true facts'],['Comedy','humor'],['Sport','sport'],['Fantasy','fantasy'],['Avontuur','adventure']]);
add('more-interests',0,'','Zijn er nog andere onderwerpen die je interessant vindt?','Misschien spreekt nog iets anders je aan.',[
 ['Psychologie en gedrag','psychology'],['Geschiedenis','history'],['Technologie','technology'],['Sport','sport'],['Dieren','animals'],['Relaties','relationships']]);
add('mystery-interest',1,'mystery disappearance secrets','Wat vind je leuk aan mysteries?','Wat maakt je bijvoorbeeld nieuwsgierig?',[
 ['Mensen die verdwijnen','disappearance'],['Mensen die iets verbergen','secrets'],['Een misdaad die wordt onderzocht','crime puzzles'],['Onverklaarbare gebeurtenissen','unusual'],['Dat ik zelf kan meedenken','puzzles']]);
add('crime-interest',1,'crime police criminalPerspective murder','Wat vind je interessant aan verhalen over misdaad?','Misschien helpt het om te kiezen wat je vooral interessant vindt.',[
 ['Waarom iemand een misdaad pleegt','psychology crime'],['Hoe iemand anderen manipuleert','manipulation'],['Hoe de politie een zaak oplost','police puzzles'],['Het leven van criminelen zelf','criminalPerspective'],['Wat een misdaad met anderen doet','empathy']]);
add('psychology-interest',1,'psychology manipulation','Wat zou je graag beter begrijpen aan mensen?','Waar ben je nieuwsgierig naar?',[
 ['Waarom mensen liegen','psychology secrets'],['Waarom mensen verkeerde keuzes maken','psychology choices'],['Hoe mensen anderen beïnvloeden','manipulation'],['Hoe iemand met moeilijke gebeurtenissen omgaat','empathy growth']]);
add('relationships-interest',1,'friendship relationships family','Waarover lees je graag als het over andere mensen gaat?','Welke onderwerpen spreken je aan?',[
 ['Vriendschap en ruzie','friendship'],['Verliefdheid','relationships'],['Problemen thuis','family'],['Erbij horen','outsider'],['Vertrouwen en geheimen','secrets']]);
add('sport-interest',1,'sport competition team','Wat vind je leuk aan sport?','Wat spreekt je het meeste aan?',[
 ['Wedstrijden','competition'],['Een sporter die iets bereikt','growth challenge'],['De mensen in een team','team'],['Echte sportverhalen','sport true'],['Meer leren over sport','sport facts']]);
add('gaming-interest',1,'gaming technology','Welke games speel je graag?','Wat vind je leuk om te spelen?',[
 ['Sportgames','sport gaming'],['Games met een verhaal','adventure'],['Games waarin je iets bouwt','technology art'],['Avonturengames','adventure fantasy'],['Games met mysteries','mystery puzzles']]);
add('fantasy-interest',1,'fantasy magic unusual','Wat vind je leuk aan verhalen over verzonnen werelden?','Welke onderwerpen vind je daarin interessant?',[
 ['Bijzondere krachten','magic'],['Andere werelden','fantasy adventure'],['Mythen en legendes','history fantasy'],['Onverklaarbare dingen','unusual'],['Een avontuur','adventure']]);
add('animals-interest',1,'animals nature','Wat vind je interessant aan dieren of natuur?','Wat zou je graag lezen?',[
 ['Een verhaal waarin een dier belangrijk is','animals realistic'],['Dieren verzorgen','animals facts'],['Wilde dieren','nature animals'],['Overleven in de natuur','survival nature'],['Het milieu','environment']]);
add('history-interest',1,'history war','Welke periode of gebeurtenis uit het verleden vind je interessant?','Waar wil je meer over weten?',[
 ['Oorlog en verzet','war'],['Hoe mensen vroeger leefden','history people'],['Echte levensverhalen','history true'],['Ontdekkingen en uitvindingen','history science']]);
add('science-interest',1,'science technology future','Wat zou je graag willen begrijpen of ontdekken?','Welke onderwerpen maken je nieuwsgierig?',[
 ['Ruimte en het heelal','science'],['Computers en robots','technology'],['De toekomst','future'],['Het menselijk lichaam','health'],['Uitvindingen','science technology']]);
add('adventure-interest',1,'adventure survival travel','Wat voor avonturen vind je interessant?','Waar zou je graag over lezen?',[
 ['Andere landen ontdekken','travel'],['Overleven','survival'],['Onbekende werelden','fantasy'],['Een gevaarlijke missie','danger action'],['Iets wat echt gebeurd is','true']]);
add('humor-interest',1,'humor','Waar moet je zelf meestal om lachen?','Wat voor humor vind je leuk?',[
 ['Grappige situaties op school','humor school'],['Vrienden die iets meemaken','humor friendship'],['Onverwachte gebeurtenissen','humor unusual'],['Absurdistische verhalen','humor fantasy']]);
add('justice-interest',1,'justice society outsider','Wat vind je belangrijk aan verhalen over onrecht?','Waar zou je meer over willen lezen?',[
 ['Pesten of buitensluiten','outsider'],['Discriminatie','justice'],['Iemand die onterecht wordt beschuldigd','justice crime'],['Mensen die voor elkaar opkomen','friendship justice']]);
add('music-interest',1,'music art','Waar ben je zelf graag creatief mee bezig?','Wat spreekt je aan?',[
 ['Muziek maken of luisteren','music'],['Tekenen en ontwerpen','art'],['Fotografie','art'],['Iemand die zijn talent ontdekt','growth']]);
add('life-interest',1,'empathy growth health','Wat vind je interessant aan de dingen die mensen meemaken?','Welke onderwerpen spreken je aan?',[
 ['Omgaan met verlies','empathy'],['Zelfvertrouwen krijgen','growth'],['Gezondheid','health'],['Vriendschap','friendship'],['Hoe mensen denken','psychology']]);
add('facts-interest',1,'facts true','Zijn er onderwerpen waar je graag meer over leert?','Welke van deze onderwerpen vind je interessant?',[
 ['Geschiedenis','history'],['Wetenschap','science'],['Sport','sport'],['Dieren','animals'],['Criminaliteit','crime'],['Psychologie','psychology']]);
add('money-interest',1,'economics','Wat vind je interessant aan geld of ondernemen?','Waar zou je over willen lezen?',[
 ['Een eigen bedrijf beginnen','economics growth'],['Hoe mensen rijk worden','economics'],['Geld en misdaad','economics crime'],['Hoe geld werkt','economics facts']]);
add('environment-interest',1,'environment','Wat maakt jou nieuwsgierig aan het milieu?','Welke onderwerpen vind je interessant?',[
 ['De toekomst van de aarde','environment future'],['Dieren en hun leefomgeving','animals nature'],['Klimaat en wetenschap','environment science']]);
add('mystery-watch',2,'mystery disappearance crime','Kijk je ook graag films of series over zulke onderwerpen? Zo ja, welke?','Wat kijk je bijvoorbeeld?',[
 ['Documentaires over vermissingen','true disappearance'],['Detectives','mystery puzzles'],['Misdaadseries','crime'],['Griezelseries','horror'],['Niet echt','']]);
add('crime-psychology',2,'crime psychology manipulation','Wat vind je interessanter aan mensen die iets verkeerds doen?','Welke richting spreekt je aan?',[
 ['Waarom ze dat doen','psychology'],['Hoe ze anderen beïnvloeden','manipulation'],['Hoe ze gepakt worden','police puzzles'],['Hoe hun leven eruitziet','criminalPerspective']]);
add('secrets-people',2,'secrets family','Welke onderwerpen vind je interessant als mensen iets voor elkaar verbergen?','Misschien zit hier iets tussen.',[
 ['Familie en thuis','family'],['Vriendschap en vertrouwen','friendship'],['Gebeurtenissen uit het verleden','history'],['Misdaad','crime']]);
add('sport-media',2,'sport gaming','Volg je ook bepaalde sporten, clubs of spelers?','Waar kijk je bijvoorbeeld graag naar?',[
 ['Voetbal','sport'],['Andere wedstrijden','competition'],['Het leven van een sporter','sport true'],['Hoe iemand beter wordt in een sport','growth sport']]);
add('fantasy-other',2,'fantasy magic','Zijn er films, games of series met zo’n wereld die je leuk vindt?','Wat spreekt je daarin aan?',[
 ['Magie','magic'],['Avonturen','adventure'],['De toekomst','future'],['Onverklaarbare gebeurtenissen','unusual']]);
add('animals-story',2,'animals nature','Wil je vooral iets over dieren leren of graag een verhaal lezen?','Welke richting past beter?',[
 ['Iets over dieren leren','animals facts'],['Een verhaal met dieren','animals realistic'],['Een avontuur in de natuur','nature adventure']]);
add('real-fiction',3,'','Lees je liever iets wat echt gebeurd is of mag het verzonnen zijn?','Allebei kan ook.',[
 ['Waargebeurd','true'],['Verzonnen maar realistisch','realistic'],['Verzonnen met fantasie','fantasy'],['Allebei','']]);
add('story-facts',3,'facts science history sport animals','Wil je er vooral iets van leren of wil je een verhaal lezen?','Beide zijn mogelijk.',[
 ['Meer leren over het onderwerp','facts'],['Een verhaal dat echt gebeurd is','true'],['Een verzonnen verhaal','realistic'],['Allebei','']]);
add('tone',3,'','Hoe mag een boek voor jou aanvoelen?','Wat past bij waar je nu zin in hebt?',[
 ['Spannend','danger'],['Grappig','humor'],['Rustig','calm'],['Indrukwekkend of ontroerend','empathy'],['Maakt niet uit','']]);
add('pace',3,'danger action adventure','Wanneer blijf je graag doorlezen?','Wat past het beste bij je?',[
 ['Als er snel iets gebeurt','fast'],['Als ik steeds iets meer ontdek','discovery'],['Als ik me in de personen kan verplaatsen','people empathy'],['Maakt niet uit','']]);
add('reading-length',3,'','Hoeveel zin heb je om te lezen?','Een korter boek kan ook.',[
 ['Liever een kort boek','','short'],['Een dik boek is prima','','any'],['Maakt niet uit','','any']]);
const BY_ID=new Map(Q.map(q=>[q.id,q]));
const MEDIA=[
 ['GTA',['gta','grand theft auto'],['crime','action','adventure']],
 ['FIFA / EA Sports FC',['fifa','ea sports fc','fc 26','fc 27'],['sport','competition']],
 ['Mocro Maffia',['mocro maffia'],['crime','criminalPerspective']],
 ['Pizzamaffia',['pizzamaffia'],['crime','family']],
 ['Minecraft',['minecraft'],['adventure','survival','art']],
 ['Fortnite',['fortnite'],['action','survival','team']],
 ['Roblox',['roblox'],['gaming']],
 ['Harry Potter',['harry potter'],['fantasy','magic','friendship']],
 ['Wednesday',['wednesday'],['mystery','fantasy','school']],
 ['Stranger Things',['stranger things'],['mystery','unusual','friendship']],
 ['The Last of Us',['the last of us'],['survival','adventure']],
 ['One Piece',['one piece'],['adventure','friendship']],
 ['Pokémon',['pokemon'],['animals','adventure','fantasy']],
 ['Spider-Man',['spider man','spiderman'],['action','fantasy']],
 ['Avatar',['avatar the last airbender'],['fantasy','magic','adventure']],
 ['Enola Holmes',['enola holmes'],['mystery','puzzles']],
];
const normalize=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const bounded=(xs,n=20)=>Array.isArray(xs)?[...new Set(xs.filter(x=>typeof x==='string'&&x.length<=80))].slice(-n):[];
function cleanContext(raw={}){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))raw={};
 const current=BY_ID.has(raw.current)?raw.current:'opening';
 return {signals:validateSignals(raw.signals),current,used:bounded(raw.used,30).filter(x=>BY_ID.has(x)),
  recent:bounded(raw.recent,40).filter(x=>BY_ID.has(x)),
  turns:Math.max(0,Math.min(7,Number.isInteger(raw.turns)?raw.turns:0)),
  seed:typeof raw.seed==='string'?raw.seed.slice(0,50):'',
  length:raw.length==='short'?'short':'any',
  media:bounded(raw.media,4).filter(name=>MEDIA.some(m=>m[0]===name)),
  hypothesis:validateSignals({prefer:raw.hypothesis}).prefer,
  uncertain:Math.max(0,Math.min(2,Number.isInteger(raw.uncertain)?raw.uncertain:0))};
}
function merged(a,b){
 const p=new Set(a.prefer),v=new Set(a.avoid);
 for(const k of b.prefer||[]){v.delete(k);p.add(k);}
 for(const k of b.avoid||[]){p.delete(k);v.add(k);}
 return validateSignals({prefer:[...p],avoid:[...v]});
}
const FAMILY=[
 ['crime','mystery','disappearance','secrets','puzzles','police','criminalPerspective','murder'],
 ['psychology','manipulation','empathy','growth','people','outsider','justice','choices'],
 ['family','relationships','friendship','team','school'],
 ['sport','competition','challenge'],
 ['nature','animals','survival','environment','travel'],
 ['science','technology','gaming','future','facts','health','economics'],
 ['history','war','society'],
 ['fantasy','magic','unusual','adventure'],
 ['music','art'],
 ['realistic','true'],['action','danger','horror','humor','fast','slow','calm','twist','discovery']
];
function families(p){return FAMILY.filter(f=>f.some(t=>p.includes(t))).length;}
function tie(seed,id){return crypto.createHash('sha256').update(seed+'|'+id).digest().readUInt32BE(0)/4294967295;}
function profiles(books,signals){
 // Public catalogue only. The normal trait cache avoids repeated metadata parsing.
 const seen=new Set(),rows=[];
 for(const b of (Array.isArray(books)?books:[])){
  if(!b?.title||b.catalogHidden===true||b.personalLoanOnly===true)continue;
  const key=normalize(b.title)+'|'+normalize(b.author);
  if(seen.has(key))continue;seen.add(key);
  const traits=traitsForBook(b);
  if(signals.avoid.some(t=>traits.has(t)))continue;
  const score=signals.prefer.reduce((sum,t)=>sum+(traits.get(t)||0),0);
  rows.push({traits,score});
  if(rows.length>=5000)break;
 }
 return rows.sort((a,b)=>b.score-a.score).slice(0,24);
}
function questionView(q){return q?{id:q.id,prompt:q.prompt,examples:q.examples,
 options:q.options.map(({id,label})=>({id,label}))}:null;}
function chooseQuestion(context,signals,books,last=[],force=''){
 const p=signals.prefer, known=new Set([...p,...signals.avoid]);
 const used=new Set([...context.used,context.current]);
 const top=profiles(books,signals);
 const eligible=Q.filter(q=>!used.has(q.id)&&q.id!=='opening'
  &&(!q.when.length||q.when.some(t=>p.includes(t)||context.hypothesis.includes(t)))
  &&(q.stage!==3||context.turns>=2||p.length>=3)
  &&(q.stage!==0||context.turns<=2)
  &&(q.id!=='reading-length'||context.length!=='short')
  &&q.options.some(o=>o.prefer.some(t=>!known.has(t))||o.length));
 const forced=BY_ID.get(force);
 if(forced&&!used.has(forced.id))return forced;
 return eligible.map(q=>{
  const fresh=q.options.flatMap(o=>o.prefer).filter(t=>!known.has(t));
  let coverage=0;
  for(const t of new Set(fresh)){
   const n=top.filter(b=>b.traits.has(t)).length;
   if(n>0&&n<top.length)coverage+=Math.min(n,top.length-n)/Math.max(1,top.length);
  }
  const recent=context.recent.includes(q.id)?-4:0;
  const link=q.when.some(t=>last.includes(t))?6:q.when.some(t=>p.includes(t))?3:0;
  const stage=q.stage===1?4:q.stage===2?3:q.stage===0?(p.length?1:7):0;
  return {q,score:link+stage+Math.min(4,coverage)+recent+tie(context.seed,q.id)*2};
 }).sort((a,b)=>b.score-a.score)[0]?.q||null;
}
function analyze(text,rawContext={},books=[]){
 const c=cleanContext(rawContext),q=BY_ID.get(c.current);
 const value=normalize(text);
 const selected=typeof rawContext?.optionId==='string'?q.options.find(o=>o.id===rawContext.optionId&&normalize(o.label)===value):null;
 const current=validateSignals(c.signals);
 let input=String(text||''), media=[],hypothesis=[],length=c.length;
 const notReader=/\b(?:haat lezen|lezen is saai|lees niet graag|niet van lezen|geen zin om te lezen|boeken saai|meeste boeken saai)\b/.test(value);
 // Media mentions suggest possible directions, never book preferences by themselves.
 for(const [name,aliases,traits] of MEDIA){
  if(aliases.some(a=>(' '+value+' ').includes(' '+a+' '))){
   media.push(name);hypothesis.push(...traits);
   for(const alias of aliases)input=input.replace(new RegExp('\\b'+alias.replace(/[.*+?^$(){}|[\]\\]/g,'\\$&')+'\\b','gi'),' ');
  }
 }
 // A real catalogue title is an anchor for a question, not an inferred liking.
 let anchor=null;
 if(!media.length&&value.length>=5){
  const name=normalize(input.replace(/^(?:ik vond|ik las|ik heb|ik lees)\s+/i,'').replace(/\s+(?:leuk|gelezen|uitgelezen)$/i,''));
  const matches=(books||[]).filter(b=>b?.id&&b.catalogHidden!==true&&b.personalLoanOnly!==true&&normalize(b.title)===name);
  if(matches.length&&new Set(matches.map(b=>normalize(b.author))).size===1){
   anchor={title:String(matches[0].title).slice(0,200),bookId:matches[0].id};
   hypothesis.push(...[...traitsForBook(matches[0])].filter(([,v])=>v>=1).map(([k])=>k).slice(0,6));
   input='';
  }
 }
 // "Geen idee, maar ..." still contains an answer; don't throw that away.
 const tail=input.match(/(?:geen idee|weet ik niet|idk|mnu)[^.!?]*?\bmaar\b\s*(.+)/i);
 if(tail)input=tail[1];
 const uncertain=/^(?:ik )?(?:weet (?:het )?niet|weet ik niet|geen idee|idk|mnu|maakt niet uit|geen voorkeur|geen flauw idee)(?: eigenlijk| echt| hoor| haha| denk ik| lol)*$/.test(value);
 if(/\b(?:geen dikke boeken|niet zo dik|niet te dik|liever kort|kort boek|korte boeken|weinig pagina s|niet veel pagina s)\b/.test(value))length='short';
 if(/\b(?:dik boek is prima|lange boeken zijn prima|lengte maakt niet uit)\b/.test(value))length='any';
 const direct=selected?{...validateSignals({prefer:selected.prefer}),recognized:true,clarify:false}:interpret(input);
 if(selected?.length)length=selected.length;
 const delta=validateSignals(direct);
 const updated=merged(current,delta);
 const hasNew=delta.prefer.some(t=>!current.prefer.includes(t))||delta.avoid.some(t=>!current.avoid.includes(t))||length!==c.length;
 const next={...c,signals:updated,length,media:[...new Set([...c.media,...media])].slice(-4),
  hypothesis:validateSignals({prefer:[...c.hypothesis,...hypothesis]}).prefer,
  turns:Math.min(7,c.turns+1),used:[...new Set([...c.used,c.current])],uncertain:0};
 const envelope={...direct,labels:LABELS,prefer:delta.prefer,avoid:delta.avoid};
 if(!selected&&!direct.recognized&&!media.length&&!anchor&&!notReader&&length===c.length){
  if(uncertain)return {...envelope,advice:{kind:'examples',question:questionView(q),context:{...c,uncertain:Math.min(2,c.uncertain+1)}}};
  return {...envelope,advice:{kind:'clarify',question:questionView(q),context:{...c,uncertain:Math.min(2,c.uncertain+1)}}};
 }
 // A named reference can change the direction even if there is no direct trait.
 const possible=validateSignals({prefer:hypothesis}).prefer;
 let reaction='';
 if(media.length||anchor){
  reaction=media.length===1?'Wat leuk dat je '+media[0]+' noemt.':anchor?'Wat sprak je aan in '+anchor.title+'?':'Wat spreekt je aan in die games of series?';
  const follow=chooseQuestion(next,updated,books,possible);
  if(possible.length){
   // Present a tentative, open question before inferring anything from media.
   const labels=possible.slice(0,3).map(t=>LABELS[t]||t);
   const candidate=follow||BY_ID.get('more-interests');
   const view=questionView(candidate);
   return {...envelope,advice:{kind:'question',reaction:media.length?reaction:'',
    question:{...view,prompt:anchor?reaction:media.length===1?'Wat vind je leuk aan '+media[0]+'?':'Wat vind je leuk aan die games of series?'},
    context:{...next,current:candidate.id},hypotheses:possible.map((id,i)=>({id,label:LABELS[id]||id,score:Math.max(1,3-i)}))}};
  }
 }
 if(notReader)reaction='Dan beginnen we bij wat je buiten het lezen leuk vindt.';
 const p=updated.prefer,axisCount=families(p);
 const focused=p.some(t=>['psychology','manipulation','criminalPerspective','police','disappearance','secrets','puzzles','magic','competition','team','war','survival','true','realistic','animalLoss'].includes(t));
 const enough=p.length>=3&&axisCount>=2&&focused || next.turns>=2&&hasNew&&p.length>=2&&axisCount>=2;
 if(enough&&!notReader)return {...envelope,advice:{kind:'recommend',reaction,context:next}};
 if(next.turns>=6)return {...envelope,advice:{kind:'offer',reaction,context:next}};
 const follow=chooseQuestion(next,updated,books,delta.prefer,notReader?'free-time':!p.length?'opening':'');
 if(!follow)return {...envelope,advice:{kind:'offer',reaction,context:next}};
 return {...envelope,advice:{kind:'question',reaction,question:questionView(follow),context:{...next,current:follow.id}}};
}
module.exports={Q,MEDIA,cleanContext,analyze,questionView};
