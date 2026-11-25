'use strict';
const crypto=require('node:crypto');
const {interpret,validateSignals,LABELS}=require('./student-choice-open-text');
const {traitsForBook}=require('./student-choice-dialogue');
const {isHidden}=require('./book-catalog-integrity');
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
add('music-interest',1,'music','Waar ben je zelf graag creatief mee bezig?','Wat spreekt je aan?',[
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
add('media-interest',1,'','Wat vind je leuk aan die verhalen of games?','Misschien helpen deze voorbeelden.',[]);
add('book-interest',1,'','Wat sprak je aan in dat boek?','Wat vond je bijvoorbeeld leuk?',[
 ['Het onderwerp',''],['Wat mensen meemaken','people'],['De spanning','danger'],['De humor','humor'],['Dat ik er iets van leerde','facts'],['De wereld waarin het speelt','setting']]);
add('psychology-media',2,'psychology manipulation','Kijk je weleens naar films of series waarin je vooral wilt begrijpen waarom mensen iets doen?','Wat spreekt je bijvoorbeeld aan?',[
 ['Waarom mensen elkaar vertrouwen of bedriegen','psychology secrets'],['De keuzes die iemand maakt','choices'],['Hoe mensen omgaan met elkaar','relationships'],['Waargebeurde verhalen','true']]);
add('history-family',2,'history family','Ben je nieuwsgierig naar hoe mensen vroeger leefden?','Welk onderwerp lijkt je interessant?',[
 ['Hoe gezinnen vroeger leefden','history family'],['Opgroeien in oorlogstijd','war growth'],['Een echt levensverhaal','history true'],['Iemand die iets uit het verleden ontdekt','history discovery']]);
add('nature-world',2,'nature environment','Wat doe je graag buiten?','Waar zou je over kunnen lezen?',[
 ['Wandelen of reizen','nature travel'],['Dieren bekijken','animals nature'],['Een avontuur meemaken','adventure'],['Meer weten over de natuur','nature facts']]);
add('technology-world',2,'technology science future','Welke ontwikkelingen vind je interessant?','Denk bijvoorbeeld aan deze onderwerpen.',[
 ['Robots en computers','technology'],['De ruimte','science'],['Hoe de wereld in de toekomst verandert','future society'],['Uitvindingen','science discovery']]);
add('friends-life',2,'friendship relationships school','Wat vind je interessant aan hoe jongeren met elkaar omgaan?','Wat spreekt je aan?',[
 ['Vrienden die elkaar helpen','friendship'],['Ruzies en vertrouwen','relationships secrets'],['Verliefd worden','relationships'],['Ergens bij willen horen','outsider'],['Eigen keuzes maken','choices growth']]);
add('sport-goals',2,'sport growth challenge','Wat vind je leuk aan de verhalen van sporters?','Waar zou je nieuwsgierig naar zijn?',[
 ['Hoe iemand beter wordt','growth'],['Omgaan met winnen en verliezen','competition'],['Vriendschap in een team','team friendship'],['Het echte leven van sporters','sport true']]);
add('life-facts',2,'empathy health psychology','Lees je soms graag over ervaringen die mensen echt hebben meegemaakt?','Wat zou je aanspreken?',[
 ['Hoe iemand met moeilijke gebeurtenissen omgaat','empathy'],['Een echt levensverhaal','true'],['Beter begrijpen hoe mensen denken','psychology'],['Iets leren over gezondheid','health facts']]);
add('crime-reality',2,'crime disappearance police','Welke misdaadverhalen vind je op televisie of online interessant?','Wat kijk je bijvoorbeeld?',[
 ['Waargebeurde misdaadverhalen','crime true'],['Documentaires over vermissingen','disappearance true'],['Verhalen over criminelen','criminalPerspective'],['Onderzoek naar een misdaad','police puzzles']]);
add('art-stories',2,'art','Volg je ook mensen die creatief bezig zijn?','Wat vind je daarin interessant?',[
 ['Hoe iemand iets leert maken','growth art'],['De verhalen achter muziek','music people'],['Het leven van een kunstenaar','art true'],['Nieuwe ideeën en uitvindingen','discovery technology']]);
add('social-world',2,'society justice','Welke onderwerpen uit het nieuws vind je interessant?','Welke richting spreekt je aan?',[
 ['Mensen die voor hun rechten opkomen','justice'],['Hoe de samenleving werkt','society facts'],['Wat er in andere landen gebeurt','travel society'],['Oorlog en vrede','war history']]);
add('fantasy-life',2,'fantasy magic adventure','Wat vind je leuk aan films die zich in een andere wereld afspelen?','Wat spreekt je aan?',[
 ['Een bijzondere wereld ontdekken','adventure discovery'],['Magie','magic'],['Personages die samen iets meemaken','friendship'],['Gevaren overwinnen','challenge danger']]);
add('war-human',2,'war history','Wat zou je willen weten over mensen die een oorlog hebben meegemaakt?','Waar ligt je interesse?',[
 ['Het dagelijks leven','history people'],['Verzet en moeilijke keuzes','war choices'],['Vlucht en overleven','war survival'],['Waargebeurde ervaringen','true war']]);
add('school-interest',1,'school outsider','Welke onderwerpen uit het leven van jongeren spreken je aan?','Wat zou je graag lezen?',[
 ['Vriendschappen','friendship'],['Erbij horen','outsider'],['Wat iemand thuis meemaakt','family'],['Grappige gebeurtenissen','humor school'],['Eigen keuzes leren maken','growth']]);
add('reading-barrier',2,'','Wat maakt lezen voor jou minder leuk?','Misschien herken je iets hiervan.',[
 ['Lange boeken','', 'short'],['Dat er weinig gebeurt','fast'],['Onderwerpen die me niet interesseren',''],['Ik lees liever waargebeurde verhalen','true']]);
add('feedback',2,'','Wat spreekt je niet aan in deze voorstellen?','Wat zou je anders willen?',[
 ['Een ander onderwerp',''],['Meer spanning','danger'],['Meer humor','humor'],['Meer realistische verhalen','realistic'],['Waargebeurde verhalen','true'],['Een korter boek','','short']]);
add('art-interest',1,'art','Wat maak of teken je graag?','Denk aan wat je zelf leuk vindt om te maken.',[
 ['Personages of stripverhalen','art fantasy'],['Dingen die echt bestaan','art realistic'],['Zelf iets ontwerpen','art discovery'],['Fotografie','art'],['Ik wil iets anders lezen','']]);
add('hobby-focus',1,'','Zou je ook over een van je hobby’s willen lezen?','Je mag ook een ander onderwerp kiezen.',[]);
Q.push(...require('./student-choice-question-bank'));
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
 ...require('./student-choice-media-bank'),
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
  hobbies:validateSignals({prefer:raw.hobbies}).prefer.slice(0,6),
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
  if(!b?.title||isHidden(b)||b.personalLoanOnly===true)continue;
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
function questionForContext(c){
 const q=BY_ID.get(c.current)||BY_ID.get('opening');
 if(q.id==='hobby-focus'){
  const hobbies=c.hobbies;
  const labels={art:'Tekenen of iets maken',sport:'Sport',gaming:'Games',music:'Muziek'};
  const names=hobbies.map(t=>labels[t]||LABELS[t]||t);
  const options=hobbies.map((t,i)=>({id:String(i),label:names[i],prefer:[t],length:''}));
  if(hobbies.length>1)options.push({id:'both',label:hobbies.length===2?'Allebei':'Meerdere daarvan',prefer:hobbies,length:''});
  options.push({id:'other',label:'Liever iets anders',prefer:[],length:''});
  return {...q,prompt:hobbies.length===2?'Zou je ook iets over '+names.map(n=>n.toLocaleLowerCase('nl-NL')).join(' of ')+' willen lezen, of liever iets anders?':hobbies.length===1?'Zou je ook iets over '+names[0].toLocaleLowerCase('nl-NL')+' willen lezen, of liever iets anders?':q.prompt,options};
 }
 if(q.id!=='media-interest')return q;
 const options=c.hypothesis.slice(0,7).map((key,i)=>({id:String(i),label:LABELS[key]||key,prefer:[key],length:''}));
 return {...q,options};
}
function questionView(q){return q?{id:q.id,prompt:q.prompt,examples:q.examples,
 options:q.options.map(({id,label})=>({id,label}))}:null;}
function chooseQuestion(context,signals,books,last=[],force=''){
 const p=signals.prefer, known=new Set([...p,...signals.avoid]);
 const used=new Set([...context.used,context.current]);
 const top=profiles(books,signals);
 const eligible=Q.filter(q=>!used.has(q.id)&&!['opening','media-interest','book-interest','feedback','hobby-focus'].includes(q.id)
  &&(!q.when.length||q.when.some(t=>p.includes(t)))
  &&(!q.requires||q.requires.every(t=>p.includes(t)))
  &&(q.stage<2||context.turns>=2||p.length>=3||(q.stage===2&&q.early===true&&q.when.some(t=>p.includes(t))))
  &&(q.stage!==0||context.turns<=2)
  &&(q.id!=='reading-length'||context.length!=='short')
  &&q.options.some(o=>o.prefer.some(t=>!known.has(t))||o.length));
 const forced=BY_ID.get(force);
 if(forced&&!used.has(forced.id))return forced;
 const ranked=eligible.map(q=>{
  const fresh=q.options.flatMap(o=>o.prefer).filter(t=>!known.has(t));
  let coverage=0;
  for(const t of new Set(fresh)){
   const n=top.filter(b=>b.traits.has(t)).length;
   if(n>0&&n<top.length)coverage+=Math.min(n,top.length-n)/Math.max(1,top.length);
  }
  const recent=context.recent.includes(q.id)?-7:0;
  const groupPenalty=q.group&&[...used].some(id=>BY_ID.get(id)?.group===q.group)?-5:0;
  const link=q.when.some(t=>last.includes(t))?6:q.when.some(t=>p.includes(t))?3:0;
  const stage=q.stage===1?4:q.stage===2?3:q.stage===0?(p.length?1:7):0;
  return {q,score:link+stage+Math.min(4,coverage)+recent+groupPenalty};
 }).sort((a,b)=>b.score-a.score||a.q.id.localeCompare(b.q.id));
 if(!ranked.length)return null;
 // Rotate only among nearly equivalent useful questions.
 const pool=ranked.filter(x=>x.score>=ranked[0].score-2.5&&(!last.length||!ranked[0].q.when.length||x.q.when.some(t=>last.includes(t))||ranked[0].q.when.every(t=>!last.includes(t)))).slice(0,12);
 return pool.sort((a,b)=>tie(context.seed,b.q.id)-tie(context.seed,a.q.id))[0].q;
}
function analyze(text,rawContext={},books=[]){
 const c=cleanContext(rawContext),q=questionForContext(c);
 const value=normalize(text);
 const selected=typeof rawContext?.optionId==='string'?q.options.find(o=>o.id===rawContext.optionId&&normalize(o.label)===value):q.options.find(o=>normalize(o.label)===value);
 let current=validateSignals(c.signals);
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
 if(!selected&&value.length>=5){
  const name=normalize(String(text||'').replace(/^(?:ik vond|ik las|ik heb|ik lees)\s+/i,'').replace(/\s+(?:leuk|gelezen|uitgelezen)$/i,''));
  const matches=(books||[]).filter(b=>b?.id&&!isHidden(b)&&b.personalLoanOnly!==true&&normalize(b.title)===name);
  if(matches.length&&new Set(matches.map(b=>normalize(b.author))).size===1){
   anchor={title:String(matches[0].title).slice(0,200),bookId:matches[0].id};
   hypothesis.push(...[...traitsForBook(matches[0])].filter(([,v])=>v>=1).map(([k])=>k).slice(0,6));
   input='';
  }
 }
 // "Geen idee, maar ..." still contains an answer; don't throw that away.
 const tail=input.match(/(?:geen idee|weet ik niet|idk|mnu)[^.!?]*?\bmaar\b\s*(.+)/i);
 if(tail)input=tail[1];
 // Feedback that explicitly contrasts a rejected direction with a desired
 // one removes the old direction, without inventing a permanent exclusion.
 let feedbackRejected=[];
 if(c.current==='feedback'){
  const contrast=input.match(/^(.*?)(?:\.\s*|,\s*|\s+maar\s+)ik wil (?:juist|liever)\s+(.+)$/i);
  if(contrast&&/\b(?:gaat|gaan|allemaal|te veel)\b/i.test(contrast[1])){
   feedbackRejected=interpret(contrast[1]).prefer;
   current=validateSignals({prefer:current.prefer.filter(t=>!feedbackRejected.includes(t)),avoid:current.avoid});
   input=contrast[2];
  }else if(/\b(?:te veel|minder|te weinig interessant|niet interessant|saai|niet mijn ding)\b/.test(value)){
   const rejected=interpret(input);
   feedbackRejected=[...new Set([...rejected.prefer,...rejected.avoid])];
   if(feedbackRejected.length){
    current=validateSignals({prefer:current.prefer.filter(t=>!feedbackRejected.includes(t)),avoid:current.avoid});
    return {prefer:[],avoid:[],recognized:true,clarify:false,labels:LABELS,advice:{
      kind:'question',reaction:'Dan zoeken we in een andere richting.',clearReference:true,
      context:{...c,signals:current,current:'feedback',uncertain:0},
      question:{...questionView(q),prompt:'Wat zou je in plaats daarvan graag willen lezen?'}}};
   }
  }
 }
 const decline=/^(?:nee|niets|niks|niet echt|geen van beide|geen van deze|geen van die|boeit me niet|interesseert me niet|niet mijn ding|liever iets anders|ik wil iets anders lezen)(?: hoor| eigenlijk| echt| lol| haha| dank je)*$/.test(value);
 const uncertain=/^(?:ik )?(?:weet (?:het )?niet|weet ik niet|geen idee|idk|mnu|maakt niet uit|geen voorkeur|geen flauw idee)(?: eigenlijk| echt| hoor| haha| denk ik| lol)*$/.test(value);
 if(/\b(?:geen dikke boeken|niet zo dik|niet te dik|liever kort|kort boek|korte boeken|weinig pagina s|niet veel pagina s)\b/.test(value))length='short';
 if(/\b(?:dik boek is prima|lange boeken zijn prima|lengte maakt niet uit)\b/.test(value))length='any';
 const contextualAliases={
  'crime-interest':[['waarom ze dat doen','psychology'],['hoe ze gepakt worden','police'],['het leven van criminelen','criminalPerspective']],
  'crime-psychology':[['waarom ze dat doen','psychology'],['hoe ze anderen beïnvloeden','manipulation'],['hoe ze gepakt worden','police']],
  'mystery-interest':[['dat mensen dingen geheimhouden','secrets'],['waar mensen gebleven zijn','disappearance'],['zelf raden','puzzles']],
  'psychology-interest':[['waarom ze dat doen','psychology'],['waarom iemand zo denkt','psychology']],
  'real-fiction':[['waar gebeurd','true'],['als het echt gebeurd is','true'],['verzonnen maar realistisch','realistic']],
  'story-facts':[['iets leren','facts'],['een echt verhaal','true']],
  'animals-story':[['wel echt een verhaal','realistic'],['echt een verhaal','realistic']],
  'sport-interest':[['echte sportverhalen','true'],['het winnen','competition']],
  'fantasy-interest':[['bijzondere krachten','magic']],
 };
 let direct=selected?{...validateSignals({prefer:selected.prefer}),recognized:true,clarify:false}:interpret(input);
 if(c.current==='hobby-focus'&&!selected&&/^(?:ja|ja graag|allebei|beide|allemaal)$/.test(value))direct={...validateSignals({prefer:c.hobbies}),recognized:true,clarify:false};
 // Exact short contextual responses can be resolved without guessing.
 if(!selected&&!direct.recognized&&!direct.avoid?.length){
  const alias=(contextualAliases[c.current]||[]).find(([phrase])=>normalize(phrase)===value);
  if(alias)direct={...validateSignals({prefer:[alias[1]]}),recognized:true,clarify:false};
 }
 if(selected?.length)length=selected.length;
 // Resolve a pronoun only in an animal context, and explicitly confirm
 // the resulting exclusion in the UI. Do not generalize to human loss.
 if(!selected&&/\b(?:ik wil niet dat|ik wil liever niet dat|ik wil geen verhaal waarin)\s+(?:(?:die|het dier|de hond|de kat|een dier|een hond|een kat|mijn hond|mijn kat)\s+(?:doodgaat|dood gaat|sterft|overlijdt))\b/.test(value)
  &&(current.prefer.includes('animals')||/\b(?:dier|hond|kat)\b/.test(value))){
  direct={...validateSignals({prefer:direct.prefer,avoid:[...(direct.avoid||[]),'animalLoss']}),recognized:true,clarify:false};
 }
 const delta=validateSignals(direct);
 const updated=merged(current,delta);
 const hasNew=delta.prefer.some(t=>!current.prefer.includes(t))||delta.avoid.some(t=>!current.avoid.includes(t))||length!==c.length;
 const next={...c,signals:updated,length,hobbies:c.current==='hobby-focus'?[]:c.hobbies,media:[...new Set([...c.media,...media])].slice(-4),
  hypothesis:validateSignals({prefer:[...c.hypothesis,...hypothesis]}).prefer,
  turns:Math.min(7,c.turns+1),used:[...new Set([...c.used,c.current])],uncertain:0};
 const envelope={...direct,labels:LABELS,prefer:delta.prefer,avoid:delta.avoid};
 // Hobbies are not automatically reading preferences. Check whether the
 // pupil actually wants to read about them before using them for ranking.
 if(c.current==='free-time'&&!notReader&&!media.length&&!anchor&&delta.prefer.length&&!delta.avoid.length){
  const ctx={...next,signals:current,hobbies:delta.prefer.slice(0,6),current:'hobby-focus'};
  return {...envelope,advice:{kind:'question',reaction:'',question:questionView(questionForContext(ctx)),context:ctx}};
 }
 if((decline&&!delta.prefer.length&&!delta.avoid.length)||(c.current==='hobby-focus'&&selected?.id==='other')){
  const ctx={...next,signals:current,hobbies:[],hypothesis:[],uncertain:0};
  // A rejected question is not evidence that the pupil dislikes every
  // topic associated with it. Offer a different direction instead.
  const alternatives=['more-interests','watch','opening','free-time'];
  const follow=alternatives.map(id=>BY_ID.get(id)).find(x=>!ctx.used.includes(x.id));
  if(!follow||ctx.turns>=6)return {...envelope,recognized:true,clarify:false,advice:{kind:'offer',reaction:'Dat hoeft ook niet.',context:ctx}};
  return {...envelope,recognized:true,clarify:false,advice:{kind:'question',reaction:'Dan kijken we naar iets anders.',question:questionView(follow),context:{...ctx,current:follow.id}}};
 }
 const bookMention=String(text||'').match(/^(?:ik heb (?:het boek )?(.{2,100}?)\s+(?:gelezen|uitgelezen)|ik las (?:het boek )?(.{2,100}?)|ik vond het boek (.{2,100}?)(?:\s+(?:leuk|heel leuk|geweldig))?|(?:het )?boek (?:heet |is )?(.{2,100}?))[.!]?$/i);
 if(!selected&&!anchor&&bookMention&&!media.length&&!direct.avoid?.length){
  const candidate=bookMention.slice(1).find(Boolean)?.trim();
  if(candidate&&!/\b(?:geen|niet|een boek over|iets over)\b/i.test(candidate))return {...envelope,advice:{kind:'book-search',title:candidate,context:c}};
 }
 if(!selected&&!direct.recognized&&!media.length&&!anchor&&!notReader&&length===c.length){
  if(uncertain||c.uncertain>=1)return {...envelope,advice:{kind:'examples',question:questionView(q),context:{...c,uncertain:Math.min(2,c.uncertain+1)}}};
  return {...envelope,advice:{kind:'clarify',question:questionView(q),context:{...c,uncertain:Math.min(2,c.uncertain+1)}}};
 }
 // A named reference can change the direction even if there is no direct trait.
 const possible=validateSignals({prefer:hypothesis}).prefer;
 let reaction='';
 if((media.length||anchor)&&!next.used.includes('media-interest')&&!next.used.includes('book-interest')){
   // A title is evidence about possible themes, never about the pupil's liking.
   const candidate=anchor?'book-interest':'media-interest';
   const mediaContext={...next,current:candidate};
   const view=questionView(questionForContext(mediaContext));
   return {...envelope,advice:{kind:'question',reaction:'',
    question:{...view,prompt:anchor?'Wat sprak je aan in '+anchor.title+'?':media.length===1?'Wat spreekt je aan in '+media[0]+'?':'Wat vind je interessant aan die games, films of series?'},
    context:mediaContext,...(anchor?{reference:{bookId:anchor.bookId,title:anchor.title}}:{}),hypotheses:possible.map((id,i)=>({id,label:LABELS[id]||id,score:Math.max(1,3-i)}))}};
 }
 if(notReader)reaction='Dan beginnen we bij wat je buiten het lezen leuk vindt.';
 const p=updated.prefer,axisCount=families(p);
 const topicDetail=p.some(t=>['puzzles','disappearance','secrets','police','criminalPerspective','manipulation','magic','competition','team','war','survival'].includes(t));
 const specific=topicDetail||p.some(t=>['manipulation','animalLoss','true','realistic','facts','slow','fast'].includes(t));
 const enough=hasNew&&p.length>=2&&((p.length>=3&&axisCount>=2&&specific)
   ||(next.turns>=2&&specific&&(axisCount>=2||topicDetail))
   ||(next.turns>=2&&axisCount>=3)
   ||(next.turns>=2&&length==='short'&&p.length>=2));
 if(enough&&!notReader)return {...envelope,advice:{kind:'recommend',reaction,context:next,clearReference:feedbackRejected.length>0}};
 if(next.turns>=6)return {...envelope,advice:{kind:'offer',reaction,context:next,clearReference:feedbackRejected.length>0}};
 const follow=chooseQuestion(next,updated,books,delta.prefer,notReader?'free-time':!p.length?'more-interests':'');
 if(!follow)return {...envelope,advice:{kind:'offer',reaction,context:next,clearReference:feedbackRejected.length>0}};
 return {...envelope,advice:{kind:'question',reaction,question:questionView(follow),context:{...next,current:follow.id},clearReference:feedbackRejected.length>0}};
}
module.exports={Q,MEDIA,cleanContext,analyze,questionView};
