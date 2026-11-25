'use strict';

// Adaptive question selection using the real catalogue, without a language
// model or fixed genre filter. Only observed catalogue evidence is scored.
const crypto=require('node:crypto');
const {isHidden}=require('./book-catalog-integrity');
const normalize=x=>String(x||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
  .toLocaleLowerCase('nl-NL').replace(/[^a-z0-9]+/g,' ').trim();
const Q=(id,dimension,prompt,options)=>({id,dimension,prompt,options:options.map(([id,label,traits])=>({
  id,label,traits:traits.split(' ').filter(Boolean),
}))});
// Different questions must explore meaningful preferences, not the same
// filter dressed up as dialogue. Answers never disclose book plots.
const QUESTIONS=[
  Q('curiosity-1','curiosity','Wat zou jij het liefst willen uitzoeken?',[
    ['secret','Waarom iemand iets geheimhoudt','mystery secrets'],['choice','Waarom iemand een moeilijke keuze maakt','choices people'],['unknown','Waarom iets onverwachts gebeurt','discovery unusual'],['real','Wat er echt is gebeurd','true facts']]),
  Q('curiosity-2','curiosity','Wat zou je nieuwsgieriger maken?',[
    ['lie','Iemand lijkt niet de waarheid te vertellen','mystery secrets people'],['place','Op een bekende plek gebeurt iets vreemds','unusual fantasy mystery'],['future','Een idee verandert de toekomst','science discovery'],['person','Iemand doet iets wat niemand verwacht','people choices']]),
  Q('curiosity-3','curiosity','Stel dat je ergens achter kunt komen. Wat kies je?',[
    ['clue','Waar een geheimzinnige aanwijzing naartoe leidt','mystery puzzles'],['why','Waarom twee mensen ruzie kregen','relationships choices'],['how','Hoe iets bijzonders werkt','facts science'],['past','Wat mensen vroeger hebben meegemaakt','history true']]),
  Q('curiosity-4','curiosity','Wat vind je interessanter aan een onverwachte ontdekking?',[
    ['truth','Dat de waarheid langzaam duidelijk wordt','mystery puzzles'],['impact','Dat mensen anders met elkaar omgaan','people relationships'],['danger','Dat er meteen iets moet gebeuren','action danger'],['world','Dat je iets over een onbekende wereld leert','fantasy discovery']]),
  Q('curiosity-5','curiosity','Welk raadsel zou jij eerder willen oplossen?',[
    ['someone','Wat iemand eigenlijk bedoelt','people mystery'],['place','Wat er op een vreemde plek aan de hand is','unusual fantasy'],['event','Hoe een echte gebeurtenis kon plaatsvinden','true facts'],['device','Waarom een uitvinding niet werkt','science puzzles']]),

  Q('choices-1','choices','Twee vrienden moeten iets beslissen. Wat zou je vooral willen weten?',[
    ['trust','Of ze elkaar nog kunnen vertrouwen','relationships secrets'],['decision','Welke keuze ze maken','choices people'],['risk','Wat er mis kan gaan','danger action'],['change','Of hun vriendschap verandert','friendship people']]),
  Q('choices-2','choices','Iemand krijgt een kans die maar één keer voorbij komt. Wat maakt dat interessant?',[
    ['brave','Of diegene de sprong durft te wagen','adventure choices'],['sacrifice','Wat diegene ervoor moet opgeven','choices relationships'],['success','Of het uiteindelijk lukt','challenge action'],['surprise','Wat die kans onverwacht verandert','discovery unusual']]),
  Q('choices-3','choices','Als iemand een fout maakt, wat zou je verder willen volgen?',[
    ['repair','Hoe diegene het weer goedmaakt','relationships people'],['truth','Of iemand ontdekt wat er is gebeurd','secrets mystery'],['new','Of diegene een nieuwe kans krijgt','choices growth'],['trouble','Welke problemen daardoor ontstaan','danger action']]),
  Q('choices-4','choices','Wat zou je interessanter vinden bij een moeilijke beslissing?',[
    ['friends','Kiezen tussen twee vrienden','friendship relationships'],['rules','De regels volgen of iets veranderen','justice choices'],['adventure','Veilig blijven of iets nieuws proberen','adventure danger'],['future','Kiezen wat je later wilt worden','growth realistic']]),
  Q('choices-5','choices','Welke verandering bij een persoon zou je willen volgen?',[
    ['confidence','Iemand die leert voor zichzelf op te komen','growth people'],['loyalty','Iemand die leert wie te vertrouwen is','relationships secrets'],['ability','Iemand die ontdekt waar die goed in is','growth challenge'],['world','Iemand die in een onbekende omgeving terechtkomt','discovery adventure']]),

  Q('setting-1','setting','Waar zou je het liefst iets bijzonders meemaken?',[
    ['near','Op een plek die je zelf goed kent','realistic school'],['nature','Buiten, ver weg van de stad','nature adventure'],['other','In een wereld die niet bestaat','fantasy unusual'],['past','In een andere tijd','history discovery']]),
  Q('setting-2','setting','Welke plek roept bij jou de meeste vragen op?',[
    ['school','Een school waar iets merkwaardigs gebeurt','school mystery'],['forest','Een verlaten plek midden in de natuur','nature mystery'],['city','Een drukke stad vol onbekende mensen','urban people'],['future','Een wereld met nieuwe technologie','science unusual']]),
  Q('setting-3','setting','Je mag één omgeving ontdekken. Welke kies je?',[
    ['known','Het dagelijks leven van iemand zoals jij','realistic people'],['wild','Een onbekend landschap','nature adventure'],['space','Een andere planeet of de toekomst','science fantasy'],['historic','Een periode uit het verleden','history true']]),
  Q('setting-4','setting','Wat trekt je meer aan in de plek waar iets gebeurt?',[
    ['familiar','Dat alles herkenbaar is','realistic school'],['mysterious','Dat er iets niet lijkt te kloppen','mystery unusual'],['big','Dat je er veel kunt ontdekken','adventure discovery'],['real','Dat de plek echt bestaat','true facts']]),
  Q('setting-5','setting','In welk soort omgeving wil je iemand volgen?',[
    ['home','Thuis of op school','school family'],['team','Bij een groep die samen iets doet','team friendship'],['far','Tijdens een verre reis','adventure nature'],['invented','In een verzonnen wereld','fantasy magic']]),

  Q('people-1','people','Wie zou je het liefst volgen?',[
    ['outsider','Iemand die er niet helemaal bij hoort','outsider growth'],['friends','Twee vrienden die samen iets meemaken','friendship relationships'],['team','Een groep met een gezamenlijk doel','team challenge'],['alone','Iemand die het alleen moet uitzoeken','independent mystery']]),
  Q('people-2','people','Welke situatie tussen mensen vind je het interessantst?',[
    ['trust','Niet zeker weten wie je kunt vertrouwen','secrets relationships'],['help','Iemand helpen die het moeilijk heeft','friendship empathy'],['compete','Met anderen ergens de beste in willen zijn','competition sport'],['belong','Ergens bij willen horen','outsider growth']]),
  Q('people-3','people','Wat vind je boeiend aan iemand die anders is dan de rest?',[
    ['thoughts','Hoe diegene over dingen denkt','people growth'],['friends','Hoe anderen reageren','relationships outsider'],['strength','Wat diegene bijzonder goed kan','challenge growth'],['secret','Wat diegene voor anderen verborgen houdt','mystery secrets']]),
  Q('people-4','people','Als er iets misgaat, met wie zou je dan willen meekijken?',[
    ['friends','Vrienden die elkaar helpen','friendship empathy'],['detective','Iemand die aanwijzingen onderzoekt','puzzles mystery'],['hero','Iemand die meteen in actie komt','action adventure'],['ordinary','Een gewoon persoon die iets onverwachts meemaakt','realistic unusual']]),
  Q('people-5','people','Welk verhaal over samenwerken klinkt aantrekkelijker?',[
    ['rescue','Samen een probleem oplossen','team challenge'],['secret','Samen een geheim onderzoeken','friendship mystery'],['game','Samen een wedstrijd proberen te winnen','team competition'],['family','Samen thuis iets moeilijks meemaken','family relationships']]),

  Q('tension-1','tension','Wat zou je liever meemaken in een verhaal?',[
    ['danger','Iemand moet snel uit een gevaarlijke situatie komen','danger action'],['uncertain','Je weet nog niet wat er aan de hand is','mystery secrets'],['fun','Er loopt iets ontzettend grappig mis','humor people'],['quiet','Je ontdekt langzaam hoe iemand zich voelt','empathy calm']]),
  Q('tension-2','tension','Wat maakt dat je verder wilt weten hoe iets afloopt?',[
    ['cliff','Er staat veel op het spel','danger action'],['clues','Er zijn steeds nieuwe aanwijzingen','puzzles mystery'],['person','Je leeft mee met iemand','empathy relationships'],['laugh','De gebeurtenissen zijn grappig','humor people']]),
  Q('tension-3','tension','Wat vind je fijner als er spanning ontstaat?',[
    ['chase','Dat er meteen iets gebeurt','action fast'],['think','Dat je zelf kunt meedenken','puzzles mystery'],['surprise','Dat er onverwacht iets verandert','unusual discovery'],['light','Dat er ook ruimte is voor humor','humor calm']]),
  Q('tension-4','tension','Welke uitdaging zou je het liefst volgen?',[
    ['survive','Iemand moet zich uit een lastige situatie redden','survival danger'],['prove','Iemand wil laten zien wat die kan','competition growth'],['trust','Iemand moet een ander durven vertrouwen','relationships choices'],['understand','Iemand wil een vreemd verschijnsel begrijpen','science puzzles']]),
  Q('tension-5','tension','Als een verhaal een verrassing heeft, welke spreekt je dan aan?',[
    ['twist','Wat je dacht blijkt helemaal niet te kloppen','secrets mystery'],['chance','Iemand krijgt ineens een bijzondere kans','discovery adventure'],['joke','Iets loopt op een grappige manier anders','humor'],['meeting','Twee mensen blijken met elkaar verbonden','relationships people']]),

  Q('pace-1','pace','Hoe wil je dat gebeurtenissen elkaar opvolgen?',[
    ['speed','Er gebeurt vanaf het begin veel','fast action'],['clue','Af en toe een nieuwe aanwijzing','puzzles mystery'],['person','Je leert mensen rustig kennen','calm people'],['mix','Een beetje van allebei','balanced']]),
  Q('pace-2','pace','Wat maakt je nieuwsgierig in de eerste minuten?',[
    ['event','Er gebeurt meteen iets onverwachts','fast unusual'],['question','Er is een vraag waarop je het antwoord wilt','mystery puzzles'],['talk','Iemand zegt iets dat veel betekent','dialogue people'],['place','Je ziet een onbekende omgeving voor je','discovery setting']]),
  Q('pace-3','pace','Welke manier van ontdekken lijkt jou leuker?',[
    ['steps','Stap voor stap aanwijzingen verzamelen','puzzles calm'],['move','Van de ene gebeurtenis in de andere','fast action'],['people','Langzaam begrijpen wat iemand voelt','empathy calm'],['explore','Steeds nieuwe plekken leren kennen','adventure discovery']]),
  Q('pace-4','pace','Wanneer blijft je aandacht het beste bij een verhaal?',[
    ['actions','Als mensen veel doen','action fast'],['talk','Als mensen veel met elkaar praten','dialogue people'],['questions','Als ik zelf iets kan proberen te raden','puzzles mystery'],['new','Als ik steeds iets nieuws ontdek','discovery facts']]),

  Q('tone-1','tone','Welk gevoel zou je het liefst hebben tijdens het lezen?',[
    ['excite','Nieuwsgierig naar wat er mis kan gaan','danger mystery'],['happy','Je kunt af en toe lachen','humor'],['relate','Je herkent gevoelens van iemand','empathy realistic'],['wonder','Je ontdekt iets bijzonders','discovery fantasy']]),
  Q('tone-2','tone','Wat past beter bij het verhaal waar je nu zin in hebt?',[
    ['dark','Een geheim dat langzaam duidelijk wordt','mystery secrets'],['funny','Grappige situaties tussen mensen','humor friendship'],['warm','Vrienden die elkaar helpen','friendship empathy'],['big','Een groot avontuur','adventure action']]),
  Q('tone-3','tone','Welke gebeurtenis raakt jou het meest?',[
    ['injustice','Iemand wordt oneerlijk behandeld','justice people'],['loyalty','Iemand komt voor een vriend op','friendship empathy'],['victory','Iemand overwint een moeilijke uitdaging','challenge growth'],['truth','Iemand vertelt eindelijk de waarheid','secrets relationships']]),
  Q('tone-4','tone','Wat moet er zeker af en toe in het verhaal zitten?',[
    ['funny','Iets om om te lachen','humor'],['surprising','Een onverwachte gebeurtenis','unusual discovery'],['thoughtful','Iets waar je over kunt nadenken','choices people'],['action','Een spannende gebeurtenis','action danger']]),

  Q('reality-1','reality','Wat lijkt je interessant om te ontdekken?',[
    ['true','Hoe iets in het echt is gebeurd','true facts'],['possible','Wat iemand in het gewone leven meemaakt','realistic people'],['impossible','Wat er zou gebeuren als iets onmogelijks kon','fantasy unusual'],['future','Wat nieuwe uitvindingen mogelijk maken','science discovery']]),
  Q('reality-2','reality','Wat zou je eerder aan iemand willen navertellen?',[
    ['event','Een bijzondere gebeurtenis die echt heeft plaatsgevonden','true history'],['person','Een keuze van iemand die je begrijpt','people relationships'],['idea','Een slim idee dat een probleem oplost','science puzzles'],['world','Een verrassende verzonnen wereld','fantasy discovery']]),
  Q('reality-3','reality','Als je nieuwe informatie tegenkomt, wat boeit je het meest?',[
    ['history','Hoe het vroeger was','history facts'],['nature','Hoe dieren of de natuur werken','nature facts'],['technology','Hoe techniek werkt','science facts'],['life','Hoe andere mensen leven','true people']]),
  Q('reality-4','reality','Welke vraag zou je graag beantwoord zien?',[
    ['how','Hoe werkt dat eigenlijk?','facts science'],['why','Waarom deed iemand dat?','people choices'],['what','Wat als dit echt zou kunnen?','fantasy unusual'],['where','Wat is daar te ontdekken?','nature adventure']]),

  Q('interests-1','interests','Wat zou je eerder willen ontdekken?',[
    ['technology','Wat mensen met techniek kunnen bedenken','science technology'],['nature','Wat er in de natuur kan gebeuren','nature discovery'],['competition','Hoe iemand zich voorbereidt op een wedstrijd','sport competition'],['history','Wat iemand vroeger heeft meegemaakt','history true']]),
  Q('interests-2','interests','Stel je krijgt een middag om iets te proberen. Wat kies je?',[
    ['solve','Een lastig raadsel oplossen','puzzles mystery'],['build','Iets ontwerpen of bouwen','technology science'],['challenge','Een bijzondere uitdaging aangaan','challenge sport'],['explore','Een onbekende plek bezoeken','adventure nature']]),
  Q('interests-3','interests','Wat voor prestaties zou je willen volgen?',[
    ['team','Samen als groep iets voor elkaar krijgen','team friendship'],['sport','Een sportief doel bereiken','sport competition'],['make','Iets nieuws maken','science technology'],['help','Iemand echt helpen','empathy people']]),
  Q('interests-4','interests','Welke ontdekking zou je bijblijven?',[
    ['animal','Iets verrassends over dieren','nature animals'],['history','Een geheim uit het verleden','history mystery'],['science','Een onverwachte wetenschappelijke vondst','science discovery'],['person','Een nieuw inzicht over een ander','people empathy']]),

  Q('style-1','style','Wat vind je prettiger in de manier waarop iets wordt verteld?',[
    ['talk','Je hoort mensen met elkaar praten','dialogue people'],['actions','Je volgt wat iemand doet','action fast'],['thought','Je ontdekt wat iemand denkt','empathy people'],['details','Je krijgt veel te weten over de omgeving','discovery setting']]),
  Q('style-2','style','Vanuit welk gezichtspunt wil je een situatie ontdekken?',[
    ['one','Met één persoon mee en begrijpen wat die voelt','people empathy'],['friends','Meekijken met een paar vrienden','friendship team'],['investigator','Met iemand die alles onderzoekt','puzzles mystery'],['facts','Van verschillende kanten feiten ontdekken','facts true']]),
  Q('style-3','style','Wat zou je eerder nieuwsgierig houden?',[
    ['chat','Een gesprek waarin iemand iets verraadt','dialogue secrets'],['plan','Een plan dat stap voor stap wordt uitgevoerd','challenge puzzles'],['event','Een gebeurtenis die alles verandert','action unusual'],['reflect','Een gedachte die je herkent','people realistic']]),
  Q('style-4','style','Wat vind je leuk aan de manier waarop je iets ontdekt?',[
    ['guess','Zelf vooruit kunnen denken','mystery puzzles'],['visual','Je de plek goed kunnen voorstellen','setting discovery'],['feel','Begrijpen wat iemand voelt','empathy relationships'],['learn','Nieuwe dingen te weten komen','facts true']]),

  Q('conflict-1','conflict','Welke botsing tussen mensen klinkt interessanter?',[
    ['secret','Iemand vertelt niet de hele waarheid','secrets mystery'],['unfair','Iemand wordt onterecht beschuldigd','justice people'],['team','Een groep is het niet met elkaar eens','team choices'],['rival','Twee mensen willen hetzelfde winnen','competition challenge']]),
  Q('conflict-2','conflict','Als er iets fout loopt, wat wil je dan weten?',[
    ['cause','Wie het heeft veroorzaakt','mystery puzzles'],['effect','Wat de gevolgen voor iedereen zijn','people choices'],['solution','Hoe het opgelost wordt','challenge action'],['change','Wat iemand hiervan leert','growth empathy']]),
  Q('conflict-3','conflict','Welk probleem zou jij graag zien opgelost?',[
    ['missing','Iets belangrijks is verdwenen','mystery secrets'],['danger','Iemand is in gevaar','danger survival'],['friend','Twee vrienden begrijpen elkaar niet','relationships friendship'],['unknown','Niemand begrijpt hoe iets werkt','science puzzles']]),
  Q('conflict-4','conflict','Wat zou je het meest bezighouden?',[
    ['honest','Of iemand eerlijk durft te zijn','secrets choices'],['brave','Of iemand iets moeilijks durft te doen','challenge growth'],['safe','Of iedereen veilig blijft','survival danger'],['fair','Of mensen eerlijk worden behandeld','justice realistic']]),
];
const ALL=new Map(QUESTIONS.map(q=>[q.id,q]));
const CATALOGUE_CACHE=new Map();
const TRAIT_WORDS={
  mystery:['spanning','mysterie','geheim','detective','raadsel','spannend','thriller','onderzoek','mystery','clue'],
  secrets:['geheim','liegen','bedrog','verdacht','verraden','verborgen','leugen','secret','mysterie'],
  puzzles:['raadsel','puzzel','onderzoek','detective','code','mysterie','riddle','enigma','speuren'],
  people:['leven','jongeren','mensen','persoon','personage','vriendschap','relaties','coming of age','identiteit'],
  choices:['dilemma','keuze','besliss','moeilijk','verantwoordelijk','consequentie'],
  relationships:['relaties','vriendschap','vriend','liefde','familie','vertrouwen','relatie'],
  friendship:['vriendschap','vriend','samen','vrienden'],
  family:['familie','gezin','ouders','broer','zus','moeder','vader'],
  empathy:['gevoel','verdriet','hoop','psychische','verlies','liefde','troost','emotie'],
  growth:['opgroeien','identiteit','zelfvertrouwen','ontwikkel','puberteit','coming of age','volwassen'],
  outsider:['buitenbeentje','erbij horen','pesten','anders zijn','eenzaam','outsider'],
  team:['team','samenwerken','groep','vrienden','ploeg'],
  independent:['alleen','zelfstandig','eenzaam','solitair'],
  realistic:['realistisch','school','maatschappij','alledaags','het echte leven','vriendschap'],
  school:['school','klas','student','leerling','pesten','middelbare'],
  urban:['stad','straat','wijk','buurt','urban'],
  nature:['natuur','bos','zee','wildernis','dieren','milieu','ecologie','buitenleven'],
  animals:['dieren','hond','kat','paard','wildlife','animal'],
  adventure:['avontuur','reis','ontdekken','expeditie','reisverhaal','quest','verkenning'],
  discovery:['ontdekken','ontdekking','avontuur','geheim','onderzoek','leren','reizen'],
  unusual:['vreemd','onverklaarbaar','magie','bovennatuurlijk','fantasie','fantasy','mysterie'],
  fantasy:['fantasy','fantasie','magie','heks','tover','draken','mythisch','magical'],
  magic:['magie','tovenaar','heks','betover','sprookje'],
  science:['wetenschap','techniek','uitvinding','ruimtevaart','science fiction','sci fi','technologie','experiment'],
  technology:['technologie','techniek','computer','programmeren','uitvinding','robot','hack','digitaal'],
  history:['geschiedenis','historisch','oorlog','vroeger','verleden','historie','geschied'],
  true:['waargebeurd','echt gebeurd','non fictie','biografie','documentair','memoires','autobiografie'],
  facts:['feiten','informatief','non fictie','wetenschap','educatief','kennis','achtergrond'],
  action:['actie','achtervolg','gevecht','snel','actievol','avontuur','ontsnappen'],
  danger:['spanning','gevaar','spannend','thriller','horror','overleven','dreiging','angst'],
  survival:['overleven','overleving','ramp','gevaar','natuurgeweld','survival'],
  competition:['wedstrijd','competitie','kampioen','wedstrijdsport','winnen','toernooi','uitdaging'],
  sport:['sport','voetbal','basketbal','topsport','hardlopen','atletiek','skate','wedstrijd'],
  challenge:['uitdaging','prestatie','doel','wedstrijd','missie','strijd'],
  justice:['onrecht','rechtvaardig','discriminatie','racisme','maatschappij','ongelijkheid'],
  humor:['humor','grappig','komedie','lach','absurd','funny','comic'],
  calm:['rustig','gevoel','leven','ontspannen','alledaags'],
  fast:['actie','snel','spannend','achtervolging','avontuur','tempo'],
  balanced:['avontuur','realistisch','vriendschap'],
  dialogue:['gesprek','dialoog','chat','brieven','berichten','whatsapp'],
  setting:['wereld','landschap','omgeving','ruimte','beschrijving'],
  murder:['moord','moorden','moordenaar','vermoord','vermoorden'],
  horror:['horror','griezel','griezelen','griezelig','eng'],
};
// Word-boundary matching prevents 'sport' inside 'transport' and 'leven'
// inside 'overleven'. Accept only known Dutch inflections, never arbitrary
// substrings of a different word. This applies to ISBN source tags AND prose.
const SUFFIXES=['e','en','s','es','t','d','de','den','er','ers','ster',
  'ers','ste','sten','ing','ingen','ig','ige','igen','heid','heden',
  'je','jes','tje','tjes','ief','ieve','ieven','elijk','elijke','elijken'];
const corpus=raw=>{
  const text=normalize(raw);
  return {phrase:' '+text+' ',words:new Set(text.split(' ').filter(Boolean))};
};
// Compile once: normalizing every keyword for every book on every request
// otherwise stalls the Node event loop for large school catalogues.
const COMPILED_TRAITS=Object.entries(TRAIT_WORDS).map(([trait,words])=>
  [trait,words.map(normalize)]);
const TRAIT_CACHE=new Map();
const TRAIT_CACHE_LIMIT=5000;
function hasEvidence(source,value){
  if(!value)return false;
  if(value.includes(' '))return source.phrase.includes(' '+value+' ');
  if(source.words.has(value))return true;
  if(value.length<5)return false;
  return SUFFIXES.some(suffix=>source.words.has(value+suffix));
}
function traitsForBook(book){
  const safe=value=>Array.isArray(value)?value:[];
  const signature=JSON.stringify([
    book.title||'',book.description||'',safe(book.themes),
    safe(book.manualThemes),safe(book.importedThemes),safe(book.tags),
    safe(book.enrichmentTags),
  ]);
  const key=crypto.createHash('sha256').update(signature).digest('hex');
  const cached=TRAIT_CACHE.get(key);
  if(cached)return new Map(cached);

  // Use the same effective theme precedence as attachDerivedThemeFields:
  // explicit manual themes override imported ones, and an explicit empty
  // theme list remains empty. Never revive obsolete imported theme labels.
  const effectiveThemes=Array.isArray(book.themes)?book.themes
    :safe(book.manualThemes).length?safe(book.manualThemes)
      :safe(book.importedThemes);
  const curated=[
    ...effectiveThemes,...safe(book.tags),...safe(book.enrichmentTags),
  ].join(' ');
  const copy=corpus(curated),description=corpus(book.description||''),
    title=corpus(book.title||'');
  const matched=new Map();
  for(const [trait,words] of COMPILED_TRAITS){
    let confidence=0;
    for(const word of words){
      if(hasEvidence(copy,word))confidence=Math.max(confidence,3);
      else if(hasEvidence(description,word))confidence=Math.max(confidence,1);
      else if(hasEvidence(title,word))confidence=Math.max(confidence,0.7);
    }
    if(confidence)matched.set(trait,confidence);
  }
  TRAIT_CACHE.set(key,[...matched]);
  if(TRAIT_CACHE.size>TRAIT_CACHE_LIMIT)
    TRAIT_CACHE.delete(TRAIT_CACHE.keys().next().value);
  return matched;
}
// Ranking visits all public works repeatedly across PIN sessions. Keep the
// complete content-addressed profile snapshot so catalogs larger than the
// individual trait cache do not recompute every book on each request.
const RANK_PROFILE_CACHE=new Map();
function profilesForWorks(works){
  const list=Array.isArray(works)?works:[];
  const digest=crypto.createHash('sha256').update(JSON.stringify(
    list.map(work=>[work.key,work.themes,work.tags,work.description])
  )).digest('hex');
  const found=RANK_PROFILE_CACHE.get(digest);
  if(found)return found;
  const profiles=new Map(list.map(work=>[work.key,traitsForBook(work)]));
  RANK_PROFILE_CACHE.set(digest,profiles);
  if(RANK_PROFILE_CACHE.size>2)
    RANK_PROFILE_CACHE.delete(RANK_PROFILE_CACHE.keys().next().value);
  return profiles;
}
function validatedAnswers(input){
  if(!Array.isArray(input))return [];
  const result=[],seen=new Set();
  for(const value of input.slice(0,12)){
    const q=ALL.get(value?.questionId),id=value?.optionId;
    if(!q||seen.has(q.id))continue;
    if(id!=='skip'&&!q.options.some(o=>o.id===id))continue;
    result.push({questionId:q.id,optionId:id});seen.add(q.id);
  }
  return result.slice(0,7);
}
function preferenceWeights(answers){
  const weights=new Map();
  for(const answer of validatedAnswers(answers)){
    const q=ALL.get(answer.questionId),option=q.options.find(x=>x.id===answer.optionId);
    if(!option)continue;
    for(const trait of option.traits)weights.set(trait,(weights.get(trait)||0)+1);
  }
  return weights;
}
function scoreTraits(traits,weights){
  let value=0;const matched=[];
  for(const [trait,weight] of weights){
    const evidence=traits.get(trait)||0;
    if(evidence){value+=evidence*weight;matched.push({trait,weight:weight*evidence});}
  }
  return {value,matched:matched.sort((a,b)=>b.weight-a.weight).map(x=>x.trait)};
}
function seedFloat(seed,id){
  return crypto.createHash('sha256').update(String(seed||'')+'|'+id)
    .digest().readUInt32BE(0)/4294967295;
}
function selection(db,{answers=[],excludeQuestionIds=[],seed='',route='new'}={}){
  const accepted=validatedAnswers(answers);
  const asked=new Set(accepted.map(x=>x.questionId));
  const excluded=new Set((Array.isArray(excludeQuestionIds)?excludeQuestionIds:[])
    .filter(x=>typeof x==='string').slice(-100));
  const weights=preferenceWeights(accepted);
  // Public catalogue profiles are content-addressed: cached only while
  // metadata stays identical. Pupil answers are never cached or shared.
  const books=(Array.isArray(db?.books)?db.books:[])
    .filter(b=>b&&b.title&&!isHidden(b)).slice(0,15000);
  const catalogueSignature=crypto.createHash('sha256').update(JSON.stringify(
    books.map(b=>[b.id,b.title,b.author,b.themes,b.manualThemes,
      b.importedThemes,b.tags,b.enrichmentTags,b.description])
  )).digest('hex');
  let profiles=CATALOGUE_CACHE.get(catalogueSignature);
  if(!profiles){
    const works=new Map();
    for(const book of books){
      const k=normalize(book.title)+'|'+normalize(book.author);
      if(!works.has(k))works.set(k,new Map());
      const profile=works.get(k);
      for(const [trait,evidence] of traitsForBook(book))
        profile.set(trait,Math.max(evidence,profile.get(trait)||0));
    }
    profiles=[...works.values()];
    CATALOGUE_CACHE.set(catalogueSignature,profiles);
    if(CATALOGUE_CACHE.size>2)
      CATALOGUE_CACHE.delete(CATALOGUE_CACHE.keys().next().value);
  }
  const works={size:profiles.length};
  const scored=profiles.map(t=>scoreTraits(t,weights).value);
  const top=profiles.map((t,i)=>({traits:t,score:scored[i]}))
    .sort((a,b)=>b.score-a.score).slice(0,Math.min(24,profiles.length));
  const askedDimensions=new Map();
  for(const answer of accepted){
    const dimension=ALL.get(answer.questionId).dimension;
    askedDimensions.set(dimension,(askedDimensions.get(dimension)||0)+1);
  }
  const previous=ALL.get(accepted.at(-1)?.questionId);
  const previousOption=previous?.options.find(o=>o.id===accepted.at(-1)?.optionId);
  const branch={
    mystery:['curiosity','conflict','tension','style'],secrets:['choices','people','curiosity'],
    people:['choices','people','tone','style'],friendship:['choices','people','tone'],
    fantasy:['setting','reality','tone'],unusual:['curiosity','setting','reality'],
    action:['pace','tension','conflict'],danger:['tension','pace','choices'],
    facts:['reality','interests','style'],science:['setting','reality','interests'],
    sport:['interests','choices','pace'],nature:['setting','interests','reality'],
    humor:['tone','people','pace'],empathy:['people','tone','choices'],
    history:['reality','setting','curiosity'],true:['reality','interests','people'],
    puzzles:['curiosity','conflict','style'],adventure:['setting','pace','choices'],
    growth:['people','choices','tone'],relationships:['people','choices','conflict'],
  };
  const nextAxes=new Set((previousOption?.traits||[]).flatMap(t=>branch[t]||[]));
  const topScore=Math.max(...scored,0);
  const matches=scored.filter(x=>x>=Math.max(3,topScore-2)).length;
  const confident=accepted.filter(a=>a.optionId!=='skip').length>=4
    &&topScore>=8&&matches>=3&&matches<=Math.max(3,Math.floor(works.size/2));
  const noEvidence=profiles.length<3||profiles.every(p=>p.size===0);
  const done=accepted.length>=7||(accepted.length>=4&&confident)
    ||(accepted.length>=5&&noEvidence);
  if(done)return {done:true,questionsAnswered:accepted.length,confident,
    catalogueWorks:works.size};
  const pool=QUESTIONS.filter(q=>!asked.has(q.id)
    &&(askedDimensions.get(q.dimension)||0)<2);
  const candidates=pool.length?pool:QUESTIONS.filter(q=>!asked.has(q.id));
  const choose=candidates.map(q=>{
    const coverage=top.map(p=>{
      const counts=q.options.map(o=>o.traits.reduce((sum,t)=>
        sum+(p.traits.get(t)||0),0));
      return counts.length?Math.max(...counts):0;
    });
    const evidence=coverage.filter(v=>v>0).length;
    const dimensionCount=askedDimensions.get(q.dimension)||0;
    const distinct=new Set(top.filter((_,i)=>coverage[i]>0).map(p=>
      q.options.map(o=>o.traits.reduce((sum,t)=>sum+(p.traits.get(t)||0),0))
        .indexOf(Math.max(...q.options.map(o=>o.traits.reduce((sum,t)=>sum+(p.traits.get(t)||0),0)))))).size;
    const jump=nextAxes.has(q.dimension)?4:0;
    const startBonus=accepted.length===0
      ?(['curiosity','choices','conflict','setting'].includes(q.dimension)?6:-7):0;
    const fresh=excluded.has(q.id)?-8:2;
    const utility=Math.min(6,evidence)*0.9+distinct*1.2+jump+startBonus+fresh
      -dimensionCount*5+seedFloat(seed,q.id)*2;
    return {q,utility};
  }).sort((a,b)=>b.utility-a.utility);
  return {done:false,questionsAnswered:accepted.length,
    question:choose[0]?.q||null,catalogueWorks:works.size,
    confident:false};
}
module.exports={QUESTIONS,traitsForBook,validatedAnswers,preferenceWeights,
  scoreTraits,selection,profilesForWorks};
