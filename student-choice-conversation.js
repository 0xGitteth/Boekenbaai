'use strict';
const crypto=require('node:crypto');
const {interpret,validateSignals,LABELS,suggestTopics,ownInterestText,partialInterest}=require('./student-choice-open-text');
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
add('free-time',0,'','Wat doe je graag in je vrije tijd?','Zit hier iets tussen wat je leuk vindt om te doen?',[
 ['Gamen','gaming'],['Sporten','sportPlaying'],['Films of series kijken',''],['Met dieren bezig zijn','animals'],['Muziek luisteren','musicListening'],['Tekenen of iets maken','art'],['Koken of bakken','cooking'],['Buiten bezig zijn','nature']]);
add('watch',0,'','Wat kijk je graag? Films, series of filmpjes bijvoorbeeld.','Wat kijk je bijvoorbeeld graag?',[
 ['Misdaadseries','crime'],['Documentaires','true facts'],['Comedy','humor'],['Sport','sportWatching'],['Fantasy','fantasy'],['Avontuur','adventure']]);
add('more-interests',0,'','Wat vind je nog meer interessant?','Misschien spreekt nog iets anders je aan.',[
 ['Psychologie en gedrag','psychology'],['Geschiedenis','history'],['Technologie','technology'],['Sport','sport'],['Dieren','animals'],['Relaties','relationships'],['Eten en koken','cooking'],['Culturen','cultures'],['Identiteit en diversiteit','identity']]);
add('mystery-interest',1,'mystery disappearance secrets','Wat vind je leuk aan mysteries?','Wat maakt je bijvoorbeeld nieuwsgierig?',[
 ['Mensen die verdwijnen','disappearance'],['Mensen die iets verbergen','secrets'],['Een misdaad die wordt onderzocht','crime puzzles'],['Onverklaarbare gebeurtenissen','unusual'],['Dat ik zelf kan meedenken','puzzles']]);
add('crime-interest',1,'crime criminalPerspective police murder','Wat vind je interessant aan verhalen over misdaad?','Misschien helpt het om te kiezen wat je vooral interessant vindt.',[
 ['Waarom iemand een misdaad pleegt','psychology crime'],['Hoe iemand anderen manipuleert','manipulation'],['Hoe de politie een zaak oplost','police puzzles'],['Het leven van criminelen zelf','criminalPerspective'],['Wat een misdaad met anderen doet','empathy']]);
add('psychology-interest',1,'psychology manipulation','Wat zou je graag beter begrijpen aan mensen?','Waar ben je nieuwsgierig naar?',[
 ['Waarom mensen liegen','psychology secrets'],['Waarom mensen verkeerde keuzes maken','psychology choices'],['Hoe mensen anderen beïnvloeden','manipulation'],['Hoe iemand met moeilijke gebeurtenissen omgaat','empathy growth']]);
add('relationships-interest',1,'friendship relationships family','Over welke dingen uit het leven van anderen wil je lezen?','Welke onderwerpen spreken je aan?',[
 ['Vriendschap en ruzie','friendship'],['Verliefdheid','relationships'],['Problemen thuis','family'],['Erbij horen','outsider'],['Vertrouwen en geheimen','secrets']]);
add('sport-interest',1,'sport','Over welke kant van sport zou je willen lezen?','Wat spreekt je het meeste aan?',[
 ['Wedstrijden','competition'],['Een sporter die iets bereikt','growth challenge'],['De mensen in een team','team'],['Echte sportverhalen','sport true'],['Meer leren over sport','sport facts']]);
add('gaming-interest',1,'gaming','Wat uit games zou je in een boek willen terugzien?','Denk bijvoorbeeld hieraan.',[
 ['Sportgames','sport gaming'],['Games met een verhaal','adventure'],['Games waarin je iets bouwt','technology art'],['Avonturengames','adventure fantasy'],['Games met mysteries','mystery puzzles']]);
add('fantasy-interest',1,'fantasy magic','Wat vind je leuk aan verhalen over verzonnen werelden?','Welke onderwerpen vind je daarin interessant?',[
 ['Bijzondere krachten','magic'],['Andere werelden','fantasy adventure'],['Mythen en legendes','history fantasy'],['Onverklaarbare dingen','unusual'],['Een avontuur','adventure']]);
add('animals-interest',1,'animals nature','Over welke dieren of natuuronderwerpen wil je lezen?','Wat zou je graag lezen?',[
 ['Een verhaal waarin een dier belangrijk is','animals realistic'],['Dieren verzorgen','animals facts'],['Wilde dieren','nature animals'],['Overleven in de natuur','survival nature'],['Het milieu','environment']]);
add('history-interest',1,'history war','Over welke tijd of gebeurtenis van vroeger wil je lezen?','Waar wil je meer over weten?',[
 ['Oorlog en verzet','war'],['Hoe mensen vroeger leefden','history people'],['Echte levensverhalen','history true'],['Ontdekkingen en uitvindingen','history science']]);
add('science-interest',1,'science technology future','Wat wil je graag ontdekken over wetenschap of techniek?','Welke onderwerpen maken je nieuwsgierig?',[
 ['Ruimte en het heelal','science'],['Computers en robots','technology'],['De toekomst','future'],['Het menselijk lichaam','health'],['Uitvindingen','science technology']]);
add('adventure-interest',1,'adventure','Wat voor avonturen vind je interessant?','Waar zou je graag over lezen?',[
 ['Andere landen ontdekken','travel'],['Overleven','survival'],['Onbekende werelden','fantasy'],['Een gevaarlijke missie','danger action'],['Iets wat echt gebeurd is','true']]);
add('humor-interest',1,'humor','Van wat voor grappige verhalen houd je?','Wat voor humor vind je leuk?',[
 ['Grappige situaties op school','humor school'],['Vrienden die iets meemaken','humor friendship'],['Onverwachte gebeurtenissen','humor unusual'],['Absurdistische verhalen','humor fantasy']]);
add('justice-interest',1,'justice','Wat vind je belangrijk aan verhalen over onrecht?','Waar zou je meer over willen lezen?',[
 ['Pesten of buitensluiten','outsider'],['Discriminatie','justice'],['Iemand die onterecht wordt beschuldigd','justice crime'],['Mensen die voor elkaar opkomen','friendship justice']]);
add('music-interest',1,'music','Wat spreekt je aan in muziek?','Wat vind je bijvoorbeeld interessant?',[
 ['Zelf muziek maken','musicMaking'],['Muziek luisteren','musicListening'],['Het leven van artiesten','music people'],['Iemand die zijn talent ontdekt','growth']]);
add('life-interest',1,'empathy growth','Over wat voor ervaringen van anderen wil je lezen?','Welke onderwerpen spreken je aan?',[
 ['Omgaan met verlies','empathy'],['Zelfvertrouwen krijgen','growth'],['Gezondheid','health'],['Vriendschap','friendship'],['Hoe mensen denken','psychology']]);
add('facts-interest',1,'facts','Waar wil je graag iets over leren?','Welke van deze onderwerpen vind je interessant?',[
 ['Geschiedenis','history'],['Wetenschap','science'],['Sport','sport'],['Dieren','animals'],['Criminaliteit','crime'],['Psychologie','psychology']]);
add('money-interest',1,'economics','Wat vind je interessant aan geld of ondernemen?','Waar zou je over willen lezen?',[
 ['Een eigen bedrijf beginnen','economics growth'],['Hoe mensen rijk worden','economics'],['Geld en misdaad','economics crime'],['Hoe geld werkt','economics facts']]);
add('environment-interest',1,'environment','Wat wil je weten over natuur en milieu?','Welke onderwerpen vind je interessant?',[
 ['De toekomst van de aarde','environment future'],['Dieren en hun leefomgeving','animals nature'],['Klimaat en wetenschap','environment science']]);
add('mystery-watch',2,'mystery disappearance','Welke mysteries uit films of series zou je ook willen lezen?','Wat kijk je bijvoorbeeld?',[
 ['Documentaires over vermissingen','true disappearance'],['Detectives','mystery puzzles'],['Misdaadseries','crime'],['Griezelseries','horror'],['Niet echt','']]);
add('crime-psychology',2,'crime criminalPerspective','Wat vind je interessant aan verhalen over mensen die iets verkeerds doen?','Welke richting spreekt je aan?',[
 ['Waarom ze dat doen','psychology'],['Hoe ze anderen beïnvloeden','manipulation'],['Hoe ze gepakt worden','police puzzles'],['Hoe hun leven eruitziet','criminalPerspective']]);
add('secrets-people',2,'secrets','Welke onderwerpen vind je interessant als mensen iets voor elkaar verbergen?','Misschien zit hier iets tussen.',[
 ['Familie en thuis','family'],['Vriendschap en vertrouwen','friendship'],['Gebeurtenissen uit het verleden','history'],['Misdaad','crime']]);
add('sport-media',2,'sport','Over welke sport of sporter zou je willen lezen?','Waar kijk je bijvoorbeeld graag naar?',[
 ['Voetbal','sport'],['Andere wedstrijden','competition'],['Het leven van een sporter','sport true'],['Hoe iemand beter wordt in een sport','growth sport']]);
add('fantasy-other',2,'fantasy magic','Wat uit een verzonnen wereld wil je graag in een boek terugzien?','Wat spreekt je daarin aan?',[
 ['Magie','magic'],['Avonturen','adventure'],['De toekomst','future'],['Onverklaarbare gebeurtenissen','unusual']]);
add('animals-story',2,'animals','Wil je vooral iets over dieren leren of graag een verhaal lezen?','Wat past bij je?',[
 ['Iets over dieren leren','animals facts'],['Een verhaal met dieren','animals realistic'],['Een avontuur in de natuur','nature adventure']]);
add('real-fiction',3,'','Lees je liever iets wat echt gebeurd is of mag het verzonnen zijn?','Allebei kan ook.',[
 ['Waargebeurd','true'],['Verzonnen maar realistisch','realistic'],['Verzonnen met fantasie','fantasy'],['Allebei','']]);
add('story-facts',3,'facts science history sport animals','Wil je er vooral iets van leren of wil je een verhaal lezen?','Allebei kan ook!',[
 ['Meer leren over het onderwerp','facts'],['Een verhaal dat echt gebeurd is','true'],['Een verzonnen verhaal','realistic'],['Allebei','']]);
add('tone',3,'','Waar heb je zin in? Iets spannends, grappigs of rustigs?','Wat past bij waar je nu zin in hebt?',[
 ['Spannend','danger'],['Grappig','humor'],['Rustig','calm'],['Indrukwekkend of ontroerend','empathy'],['Maakt niet uit','']]);
add('pace',3,'danger action adventure','Wanneer blijf je graag doorlezen?','Wat past het beste bij je?',[
 ['Als er snel iets gebeurt','fast'],['Als ik steeds iets meer ontdek','discovery'],['Als ik me in de personen kan verplaatsen','people empathy'],['Maakt niet uit','']]);
add('reading-length',3,'','Hoe dik mag het boek zijn?','Een korter boek kan ook.',[
 ['Liever een kort boek','','short'],['Een dik boek is prima','','any'],['Maakt niet uit','','any']]);
add('media-interest',1,'','Wat vind je leuk aan die verhalen of games?','Misschien helpen deze voorbeelden.',[]);
add('book-interest',1,'','Wat sprak je aan in dat boek?','Wat vond je bijvoorbeeld leuk?',[
 ['Het onderwerp',''],['Wat mensen meemaken','people'],['De spanning','danger'],['De humor','humor'],['Dat ik er iets van leerde','facts'],['De wereld waarin het speelt','setting']]);
add('psychology-media',2,'psychology manipulation','Wat zou je willen begrijpen aan het gedrag van mensen in een verhaal?','Wat spreekt je bijvoorbeeld aan?',[
 ['Waarom mensen elkaar vertrouwen of bedriegen','psychology secrets'],['De keuzes die iemand maakt','choices'],['Hoe mensen omgaan met elkaar','relationships'],['Waargebeurde verhalen','true']]);
add('history-family',2,'history','Wat wil je weten over mensen van vroeger?','Welk onderwerp lijkt je interessant?',[
 ['Hoe gezinnen vroeger leefden','history family'],['Opgroeien in oorlogstijd','war growth'],['Een echt levensverhaal','history true'],['Iemand die iets uit het verleden ontdekt','history discovery']]);
add('nature-world',2,'nature','Wat zou je graag over de natuur willen lezen?','Waar zou je over kunnen lezen?',[
 ['Wandelen of reizen','nature travel'],['Dieren bekijken','animals nature'],['Een avontuur meemaken','adventure'],['Meer weten over de natuur','nature facts']]);
add('technology-world',2,'technology science future','Welke techniek vind je interessant?','Denk bijvoorbeeld aan deze onderwerpen.',[
 ['Robots en computers','technology'],['De ruimte','science'],['Hoe de wereld in de toekomst verandert','future society'],['Uitvindingen','science discovery']]);
add('friends-life',2,'friendship relationships','Wat vind je interessant aan verhalen over vrienden?','Wat spreekt je aan?',[
 ['Vrienden die elkaar helpen','friendship'],['Ruzies en vertrouwen','relationships secrets'],['Verliefd worden','relationships'],['Ergens bij willen horen','outsider'],['Eigen keuzes maken','choices growth']]);
add('sport-goals',2,'sport','Wat wil je lezen over sporters?','Waar zou je nieuwsgierig naar zijn?',[
 ['Hoe iemand beter wordt','growth'],['Omgaan met winnen en verliezen','competition'],['Vriendschap in een team','team friendship'],['Het echte leven van sporters','sport true']]);
add('life-facts',2,'empathy growth','Over welke echte ervaringen wil je lezen?','Wat zou je aanspreken?',[
 ['Hoe iemand met moeilijke gebeurtenissen omgaat','empathy'],['Een echt levensverhaal','true'],['Beter begrijpen hoe mensen denken','psychology'],['Iets leren over gezondheid','health facts']]);
add('crime-reality',2,'crime','Over welke echte misdaadzaken zou je willen lezen?','Wat kijk je bijvoorbeeld?',[
 ['Waargebeurde misdaadverhalen','crime true'],['Documentaires over vermissingen','disappearance true'],['Verhalen over criminelen','criminalPerspective'],['Onderzoek naar een misdaad','police puzzles']]);
add('art-stories',2,'art','Wat wil je lezen over creatieve mensen?','Wat vind je daarin interessant?',[
 ['Hoe iemand iets leert maken','growth art'],['De verhalen achter muziek','music people'],['Het leven van een kunstenaar','art true'],['Nieuwe ideeën en uitvindingen','discovery technology']]);
add('social-world',2,'society justice','Over welk onderwerp uit het nieuws wil je lezen?','Welke richting spreekt je aan?',[
 ['Mensen die voor hun rechten opkomen','justice'],['Hoe de samenleving werkt','society facts'],['Wat er in andere landen gebeurt','travel society'],['Oorlog en vrede','war history']]);
add('fantasy-life',2,'fantasy','Wat maakt een andere wereld leuk in een boek?','Wat spreekt je aan?',[
 ['Een bijzondere wereld ontdekken','adventure discovery'],['Magie','magic'],['Personages die samen iets meemaken','friendship'],['Gevaren overwinnen','challenge danger']]);
add('war-human',2,'war','Wat zou je willen weten over mensen die een oorlog hebben meegemaakt?','Wat zou je daarover willen weten?',[
 ['Het dagelijks leven','history people'],['Verzet en moeilijke keuzes','war choices'],['Vlucht en overleven','war survival'],['Waargebeurde ervaringen','true war']]);
add('school-interest',1,'school','Wat wil je lezen over jongeren?','Wat zou je graag lezen?',[
 ['Vriendschappen','friendship'],['Erbij horen','outsider'],['Wat iemand thuis meemaakt','family'],['Grappige gebeurtenissen','humor school'],['Eigen keuzes leren maken','growth']]);
add('reading-barrier',2,'','Wat vind je minder leuk aan lezen?','Misschien herken je iets hiervan.',[
 ['Lange boeken','', 'short'],['Dat er weinig gebeurt','fast'],['Onderwerpen die me niet interesseren',''],['Ik lees liever waargebeurde verhalen','true']]);
add('feedback',2,'','Wat vind je minder leuk aan deze boeken?','Wat zou je anders willen?',[
 ['Een ander onderwerp',''],['Meer spanning','danger'],['Meer humor','humor'],['Meer realistische verhalen','realistic'],['Waargebeurde verhalen','true'],['Een korter boek','','short']]);
add('art-interest',1,'art','Over welke creatieve dingen zou je willen lezen?','Misschien zit hier iets tussen.',[
 ['Personages of stripverhalen','art fantasy'],['Dingen die echt bestaan','art realistic'],['Zelf iets ontwerpen','art discovery'],['Fotografie','art'],['Ik wil iets anders lezen','']]);
add('hobby-focus',1,'','Zou je ook over een van je hobby’s willen lezen?','Je mag ook een ander onderwerp kiezen.',[]);
const {SUBTOPICS}=require('./student-choice-themes');
const {RULES,findAmbiguities,resolveMeaning,removeAmbiguousWord}=require('./student-choice-ambiguity');
const AMBIGUITIES=new Map(RULES.map(rule=>[rule[0],rule]));
const isAncestor=(ancestor,child)=>{const seen=new Set();for(let p=SUBTOPICS[child];p&&!seen.has(p);p=SUBTOPICS[p]){if(p===ancestor)return true;seen.add(p);}return false;};
const privateRoots=['queerStories','neurodiversity','disability','religions','mentalHealth','culturalIdentity'];
const isPrivateTopic=t=>privateRoots.some(root=>root===t||isAncestor(root,t));
add('clarify-topic',1,'','Bedoel je zoiets?','Zit er iets tussen?',[]);
add('clarify-remainder',1,'','Kun je het andere onderwerp iets beter uitleggen?','Vertel wat je bedoelt of ga verder met de bekende onderwerpen.',[]);
for(const [key,group,prompt,options] of [["drawing","art","Wat teken of schilder je het liefst?",[["Personages of strips","drawing fantasy"],["Dingen die echt bestaan","drawing realistic"],["Nieuwe tekentechnieken leren","drawing facts"]]],["photography","art","Wat vind je interessant aan fotografie?",[["Mensen fotograferen","photography people"],["Dieren of natuur fotograferen","photography nature"],["Leren hoe een camera werkt","photography facts"]]],["design","art","Wat ontwerp je graag?",[["Kleding","design"],["Illustraties of posters","design drawing"],["Spullen of gebouwen","design inventions"]]],["filmmaking","art","Wat vind je interessant aan films maken?",[["Het filmen zelf","filmmaking"],["Verhalen bedenken","filmmaking adventure"],["Montage en techniek","filmmaking technology"]]],["musicMaking","music","Wat zou je over muziek maken willen lezen?",[["Zelf muziek leren maken","musicMaking facts"],["Het leven van muzikanten","musicBiography"],["Teksten schrijven","songLyrics musicMaking"]]],["musicListening","music","Wat uit muziek zou je in een boek willen terugzien?",[["De tekst","songLyrics"],["Het verhaal van een artiest","musicBiography"],["De sfeer","musicListening calm"]]],["sportPlaying","sport","Over welke sport zou je willen lezen?",[["Voetbal","football"],["Fitness","fitness"],["Hardlopen","running"],["Vechtsport","martialArts"],["Dansen","dance"],["Liever over trainen","sportTraining"]]],["sportWatching","sport","Wat vind je leuk aan sport kijken?",[["Een club volgen","sportFans"],["Wedstrijden","sportWatching competition"],["Het leven van sporters","sportBiography"]]],["teamSport","sport","Wat vind je interessant aan een sportteam?",[["Samenwerken","teamSport team"],["Wedstrijden winnen","teamSport competition"],["Vriendschap in het team","teamSport friendship"]]],["individualSport","sport","Wat vind je interessant aan een individuele sport?",[["Trainen","individualSport growth"],["Wedstrijden","individualSport competition"],["Hoe iemand een doel haalt","individualSport challenge"]]],["pets","animals","Over welk huisdier zou je willen lezen?",[["Honden","dogs"],["Katten","cats"],["Kleine huisdieren","smallPets"],["Vogels","petBirds"],["Reptielen","petReptiles"],["Aquariumdieren","aquarium"]]],["wildlife","animals","Over welke wilde dieren zou je meer willen weten?",[["Roofdieren","wildlife facts"],["Dieren in zee","wildlife nature"],["Hoe dieren overleven","wildlife survival"]]],["animalCare","animals","Wat vind je interessant aan het verzorgen van dieren?",[["Dieren helpen","animalCare empathy"],["Werken met dieren","animalCare true"],["Meer leren over verzorging","animalCare facts"]]],["space","science","Wat maakt je nieuwsgierig naar de ruimte?",[["Planeten en sterren","space facts"],["Astronauten","space true"],["Een verzonnen ruimtereis","space adventure"]]],["computing","science","Wat vind je interessant aan computers?",[["Programmeren","computing facts"],["Digitale mysteries","computing mystery"],["Hoe computers werken","computing technology"]]],["inventions","science","Wat vind je interessant aan uitvindingen?",[["Hoe iets werkt","inventions facts"],["Een uitvinder volgen","inventions true"],["Nieuwe dingen bedenken","inventions discovery"]]],["humanBody","science","Wat zou je willen begrijpen aan het menselijk lichaam?",[["Hoe het lichaam werkt","humanBody facts"],["Gezondheid","humanBody health"],["Sport en het lichaam","humanBody sport"]]],["robotics","science","Wat vind je interessant aan robots?",[["Hoe ze werken","robotics facts"],["Wat ze in de toekomst kunnen","robotics future"],["Een verhaal met robots","robotics fantasy"]]],["gameBuilding","gaming","Wat bouw je graag in games?",[["Huizen of steden","gameBuilding design"],["Een eigen wereld","gameBuilding fantasy"],["Dingen die echt werken","gameBuilding inventions"]]],["gameCompetition","gaming","Wat vind je leuk aan competitief gamen?",[["Beter worden","gameCompetition growth"],["Wedstrijden winnen","gameCompetition competition"],["Spelen in een team","gameCompetition team"]]],["gameStory","gaming","Wat vind je leuk aan verhalen in games?",[["De personages","gameStory people"],["De wereld ontdekken","gameStory adventure"],["Mysteries oplossen","gameStory mystery"]]],["gameDevelopment","gaming","Wat zou je willen weten over het maken van games?",[["Programmeren","gameDevelopment computing"],["Werelden ontwerpen","gameDevelopment design"],["Verhalen bedenken","gameDevelopment gameStory"]]],["gameMultiplayer","gaming","Wat vind je leuk aan samen gamen?",[["Samenwerken","gameMultiplayer team"],["Samen iets ontdekken","gameMultiplayer adventure"],["Vriendschap","gameMultiplayer friendship"]]],["courtCases","crime","Wat vind je interessant aan rechtszaken?",[["Hoe bewijs wordt gebruikt","courtCases puzzles"],["De keuzes van de rechter","courtCases justice"],["Een waargebeurde zaak","courtCases true"]]],["crimeVictims","crime","Wat zou je willen weten over mensen die met misdaad te maken krijgen?",[["Hoe ze ermee omgaan","crimeVictims empathy"],["Hoe ze geholpen worden","crimeVictims justice"],["Waargebeurde ervaringen","crimeVictims true"]]],["gangs","crime","Wat vind je interessant aan verhalen over bendes?",[["Waarom iemand erbij gaat","gangs psychology"],["Hoe iemand eruit komt","gangs growth"],["Hoe een bende wordt onderzocht","gangs police"]]]]){
 add('specific-'+key,1,key,prompt,'Misschien helpt een voorbeeld.',options);
 Q[Q.length-1].group=group;
}
for(const [id,parent,,,,prompt,options] of require('./student-choice-topic-details')){
 add('specific-'+id,1,id,prompt,'Zit hier iets tussen?',options);
 Q[Q.length-1].group=parent;
}
Q.push(...require('./student-choice-question-bank'));
// Broad questions introduce one explicitly named direction at a time.
const baseOptions={"opening":[["Misdaad","crime"],["Mysteries","mystery"],["Sport","sport"],["Vriendschap","friendship"],["Fantasie","fantasy"],["Dieren","animals"],["Waargebeurde verhalen","true"],["Wetenschap en techniek","science technology"],["Eten en koken","cooking"],["Culturen en tradities","cultures"],["Identiteit en diversiteit","identity"]],"sport-interest":[["Zelf sporten","sportPlaying"],["Sport kijken","sportWatching"],["Teamsport","teamSport"],["Individuele sport","individualSport"],["Topsport","eliteSport"],["Levensverhalen van sporters","sportBiography"]],"gaming-interest":[["Verhalen en personages","gameStory"],["Bouwen in games","gameBuilding"],["Competitief gamen","gameCompetition"],["Games maken","gameDevelopment"],["Samen gamen","gameMultiplayer"]],"animals-interest":[["Huisdieren","pets"],["Boerderijdieren","farmAnimals"],["Wilde dieren","wildlife"],["Dinosaurussen","dinosaurs"],["Dieren verzorgen","animalCare"],["Meer leren over dieren","animals facts"]],"history-interest":[["Oorlog en verzet","war"],["Hoe mensen vroeger leefden","historicalDailyLife"],["De oudheid","ancientHistory"],["Echte levensverhalen","biography"],["Uitvindingen van vroeger","historicalInventions"]],"science-interest":[["Ruimte en het heelal","space"],["Computers","computing"],["Robots","robotics"],["De toekomst","future"],["Het menselijk lichaam","humanBody"],["Uitvindingen","inventions"]],"art-interest":[["Tekenen en schilderen","drawing"],["Fotografie","photography"],["Ontwerpen","design"],["Films maken","filmmaking"],["Liever iets anders",""]],"technology-world":[["Robots","robotics"],["Computers","computing"],["Ruimte","space"],["Uitvindingen","inventions"],["Bouwen en repareren","practicalTech"]],"art-stories":[["Iets leren maken","art growth"],["Fotografie","photography"],["Tekenen en ontwerpen","drawing design"],["Het leven van een kunstenaar","art true"]],"life-interest":[["Omgaan met verlies","grief"],["Zelfvertrouwen","growth"],["Gezondheid","health"],["Vriendschap","friendship"],["Jezelf leren kennen","identity"]],"money-interest":[["Een bedrijf beginnen","entrepreneurship"],["Sparen en uitgeven","personalFinance"],["Werk en beroepen","careers"],["Hoe geld werkt","economics facts"]],"environment-interest":[["Klimaat","climate"],["Natuur beschermen","conservation"],["Energie","energy"],["Zee en oceanen","ocean"],["De toekomst van de aarde","environment future"]],"justice-interest":[["Pesten","bullying"],["Discriminatie","discrimination"],["Een rechtszaak","courtCases"],["Opkomen voor rechten","activism"]],"relationships-interest":[["Vriendschap en ruzie","friendshipConflict"],["Verliefdheid","firstLove"],["Veranderingen thuis","familyChanges"],["Erbij horen","outsider"],["Vertrouwen en geheimen","secrets"]],"friends-life":[["Vrienden die elkaar helpen","friendship"],["Ruzie tussen vrienden","friendshipConflict"],["Ergens bij horen","outsider"],["Groepsdruk","groupPressure"],["Eigen keuzes maken","choices growth"]],"history-family":[["Hoe gezinnen vroeger leefden","historicalDailyLife family"],["Familiegeschiedenis","familyHistory"],["Een echt levensverhaal","biography"],["Iemand die iets uit het verleden ontdekt","history discovery"]],"crime-interest":[["Waarom iemand een misdaad pleegt","psychology crime"],["Hoe de politie een zaak oplost","police puzzles"],["Het leven van criminelen zelf","criminalPerspective"],["Rechtszaken","courtCases"],["Bendes","gangs"],["Wat een misdaad met anderen doet","crimeVictims"]],"fantasy-interest":[["Bijzondere krachten","magic"],["Andere werelden","fantasy adventure"],["Mythen en legendes","myths"],["Bijzondere wezens","mythicalCreatures"],["Een avontuur","adventure"]],"social-world":[["Mensen die voor hun rechten opkomen","activism"],["Politiek","politics"],["Andere culturen","cultures"],["Nieuws maken","journalism"],["Oorlog en vrede","war history"]]};
for(const q of Q){
 const rows=baseOptions[q.id];
 if(rows)q.options=rows.map(([label,traits],i)=>({id:String(i),label,prefer:traits.split(' ').filter(Boolean),length:''}));
}
const extraChoices={
 'identity':[['Jezelf leren kennen','identity'],['LHBTQIA+ en diversiteit','queerStories'],['Verschillende culturen en afkomst','culturalIdentity'],['Erbij horen','outsider'],['Zelfvertrouwen','growth']],
 'cultures':[['Tradities en feesten','traditions festivals'],['Eten uit andere landen','foodCulture'],['Talen','languages'],['Religies en levensbeschouwingen','religions'],['Een land of gebied','travel'],['Opgroeien tussen culturen','culturalIdentity']],
 'cooking':[['Hartige gerechten koken','savoryCooking'],['Taarten, brood of koekjes bakken','baking'],['Eten uit andere culturen','foodCulture'],['Voeding en ingrediënten','foodScience'],['Werken in een keuken','restaurantWork']],
 'baking':[['Taarten en zoet gebak','sweetBaking'],['Brood bakken','breadMaking'],['Patisserie','pastry'],['Verhalen over bakkers','baking careers']],
 'teamSport':[['Voetbal','football'],['Basketbal','basketball'],['Volleybal','volleyball'],['Hockey','hockey'],['Handbal','handball'],['Samenwerking in teams','teamSport team']],
 'individualSport':[['Hardlopen','running'],['Zwemmen','swimming'],['Turnen','gymnastics'],['Racketsporten zoals tennis','tennis'],['Klimmen','climbing'],['Trainen','sportTraining']]
};
for(const [id,options] of Object.entries(extraChoices)){
 const q=Q.find(q=>q.id==='specific-'+id);
 if(q){if(id==='identity')q.prompt='Over welke onderwerpen rond identiteit zou je willen lezen?';if(id==='cultures')q.prompt='Wat zou je willen ontdekken over andere culturen?';q.options=options.map(([label,traits],i)=>({id:String(i),label,prefer:traits.split(' '),length:''}));}
}
const narrowBase={"sport-media":"sportWatching","sport-goals":"eliteSport","history-family":"historicalDailyLife","art-stories":"art","crime-reality":"crime true","technology-world":"technology","fantasy-life":"fantasy","nature-world":"nature"};
for(const q of Q)if(narrowBase[q.id]){const tags=narrowBase[q.id].split(' ');q.when=[tags[0]];if(tags.length>1)q.requires=tags;}
// Discovery questions are an explicit navigation route, not inferred preferences.
const DISCOVERY_MENU=[
 ['Wat doe je graag in je vrije tijd?','free-time'],
 ['Wat kijk, luister of speel je graag?','watch'],
 ['Waar zou je graag meer over willen weten?','discover-knowledge'],
 ['Wat vind je interessant aan andere mensen?','discover-people'],
 ['Zijn er onderwerpen waarin je jezelf herkent?','discover-identity'],
 ['Wat zou je graag willen leren of meemaken?','discover-experience'],
 ['Ik wil onderwerpen bekijken','discover-topics']
];
add('discover',0,'','Wat vind je leuk of interessant? Dat hoeft niets met boeken te maken te hebben. 😊','Heb je op een van de volgende vragen een antwoord?',[]);
add('discover-menu',0,'','Heb je op een van de volgende vragen een antwoord?','Heb je op een van de volgende vragen een antwoord?',DISCOVERY_MENU.map(([label])=>[label,'']));
add('discover-knowledge',1,'','Waar zou je graag meer over willen weten?','Welke onderwerpen maken je nieuwsgierig?',[
 ['Andere landen en culturen','cultures'],['Wetenschap','science'],['Geschiedenis','history'],['Mensen en hun gedrag','psychology'],['Natuur en dieren','nature'],['Hoe dingen werken','technology'],['Eten en koken','cooking']]);
add('discover-people',1,'','Wat vind je interessant aan andere mensen?','Over welke onderwerpen zou je willen lezen?',[
 ['Liefde en relaties','relationships'],['Vriendschap','friendship'],['Wat mensen meemaken','biography'],['Jezelf zijn en erbij horen','identity'],['Waarom mensen bepaalde dingen doen','psychology'],['Gelijke rechten en onrecht','justice'],['Verschillende culturen','cultures']]);
add('discover-identity',1,'','Zijn er onderwerpen waarin je jezelf herkent? Je hoeft niets persoonlijks te vertellen.','Welk onderwerp zou je interessant vinden in een boek?',[
 ['Jezelf leren kennen','identity'],['LHBTQIA+ personages en verhalen','queerStories'],['Vriendschap en erbij horen','outsider'],['Verschillende culturen en afkomst','culturalIdentity'],['Neurodiversiteit','neurodiversity'],['Leven met een beperking','disability'],['Zelfvertrouwen','growth']]);
add('discover-experience',1,'','Wat zou je graag willen leren of meemaken?','Welke onderwerpen spreken je aan?',[
 ['Een avontuur beleven','adventure'],['Een sport leren','sportPlaying'],['Iets maken of ontwerpen','art'],['Reizen en andere landen ontdekken','travel'],['Koken of bakken','cooking'],['Muziek maken','musicMaking'],['Iets met techniek of computers','technology']]);
add('discover-topics',1,'','Zit hier een onderwerp tussen waar je nieuwsgierig naar bent?','Welke onderwerpen spreken je aan?',[
 ['Mensen en hun gedrag','psychology'],['Liefde en relaties','relationships'],['Jezelf zijn en erbij horen','identity'],['Andere landen en culturen','cultures'],['Sport en hobby’s','sport'],['Dieren en natuur','animals'],['Misdaad en mysteries','mystery'],['Techniek en wetenschap','science'],['Geschiedenis','history'],['Fantasie en avontuur','fantasy']]);
add('discover-topics-more',1,'','Misschien spreekt een van deze andere onderwerpen je aan?','Welke onderwerpen spreken je aan?',[
 ['Muziek','music'],['Kunst en creatieve hobby’s','art'],['Eten, koken en bakken','cooking'],['Games','gaming'],['Gezondheid en het lichaam','health'],['Maatschappij en gelijke rechten','society'],['Geld en beroepen','economics'],['Waargebeurde verhalen','true'],['Humor','humor'],['Spanning','danger']]);
add('discovery-feedback',1,'','Wat spreekt je aan in deze boeken?','Welke kenmerken spreken je aan?',[]);
add('discover-index',1,'','Kies een onderwerp','Kies een onderwerp',[]);
const DISCOVERY_IDS=new Set(['discover-index','discovery-feedback','discover','discover-menu','discover-knowledge','discover-people','discover-identity','discover-experience','discover-topics','discover-topics-more']);
const BY_ID=new Map(Q.map(q=>[q.id,q]));
const INDEX_ROOTS=Object.keys(LABELS).filter(id=>!SUBTOPICS[id]||!Object.hasOwn(LABELS,SUBTOPICS[id])).sort((a,b)=>LABELS[a].localeCompare(LABELS[b],'nl'));
const indexChildren=id=>Object.keys(SUBTOPICS).filter(t=>SUBTOPICS[t]===id&&Object.hasOwn(LABELS,t)).sort((a,b)=>LABELS[a].localeCompare(LABELS[b],'nl'));
function indexQuestion(c){
 const parent=c.indexParent,items=parent?indexChildren(parent):INDEX_ROOTS;
 const page=Math.min(c.indexPage,Math.max(0,Math.ceil(items.length/7)-1));
 const options=items.slice(page*7,page*7+7).map(t=>({id:'topic:'+t,label:LABELS[t],prefer:[],length:''}));
 if(parent)options.unshift({id:'select:'+parent,label:'Lees graag over '+LABELS[parent],prefer:[parent],length:''});
 if(page>0)options.push({id:'prev',label:'Vorige onderwerpen',prefer:[],length:''});
 if((page+1)*7<items.length)options.push({id:'next',label:'Meer onderwerpen',prefer:[],length:''});
 if(parent)options.push({id:'up',label:'Terug naar bredere onderwerpen',prefer:[],length:''});
 return {...BY_ID.get('discover-index'),prompt:parent?'Wat vind je interessant aan '+LABELS[parent]+'?':'Welke onderwerpen spreken je aan?',examples:'Kies een onderwerp of bekijk meer mogelijkheden.',options};
}
const MEDIA=[
 ['GTA',['gta','grand theft auto'],['crime','action','adventure']],
 ['FIFA / EA Sports FC',['fifa','ea sports fc','fc 26','fc 27'],['sport','competition']],
 ['Mocro Maffia',['mocro maffia'],['crime','criminalPerspective']],
 ['Pizzamaffia',['pizzamaffia'],['crime','family']],
 ['Minecraft',['minecraft'],['gameBuilding','adventure','survival','gameMultiplayer']],
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
  hobbies:validateSignals({prefer:raw.hobbies}).prefer,
  discovery:raw.discovery===true,
  priority:validateSignals({prefer:raw.priority}).prefer,
  required:validateSignals({prefer:raw.required}).prefer,
  indexParent:typeof raw.indexParent==='string'&&Object.hasOwn(LABELS,raw.indexParent)?raw.indexParent:'',
  indexPage:Math.max(0,Math.min(100,Number.isInteger(raw.indexPage)?raw.indexPage:0)),
  discoveryReturn:BY_ID.has(raw.discoveryReturn)&&raw.discoveryReturn!=='discovery-feedback'?raw.discoveryReturn:'discover',
  discoveryTraits:validateSignals({prefer:raw.discoveryTraits}).prefer.slice(0,8),
  clarifyCandidates:validateSignals({prefer:raw.clarifyCandidates}).prefer.slice(0,3),
  clarifyKnown:validateSignals({prefer:raw.clarifyKnown}).prefer.slice(0,24),
  clarifyAmbiguity:AMBIGUITIES.has(raw.clarifyAmbiguity)?raw.clarifyAmbiguity:'',
  clarifyNegative:raw.clarifyNegative===true,
  clarifyQueue:Array.isArray(raw.clarifyQueue)?raw.clarifyQueue.filter(x=>x&&AMBIGUITIES.has(x.id)).slice(0,7).map(x=>({id:x.id,negative:x.negative===true})):[],
  clarifyTentative:validateSignals({prefer:raw.clarifyTentative}).prefer,
  clarifyReplace:raw.clarifyReplace===true,
  clarifyAvoid:validateSignals({avoid:raw.clarifyAvoid}).avoid,
  skipped:validateSignals({prefer:raw.skipped}).prefer.slice(0,8),
  clarifyFrom:BY_ID.has(raw.clarifyFrom)&&!['clarify-topic','clarify-remainder'].includes(raw.clarifyFrom)?raw.clarifyFrom:'opening',
  hypothesis:validateSignals({prefer:raw.hypothesis}).prefer,
  uncertain:Math.max(0,Math.min(2,Number.isInteger(raw.uncertain)?raw.uncertain:0))};
}
function merged(a,b){
 const p=new Set(a.prefer),v=new Set(a.avoid);
 for(const k of b.prefer||[]){for(const old of v)if(old===k||isAncestor(old,k))v.delete(old);p.add(k);}
 for(const k of b.avoid||[]){for(const t of p)if(t===k||isAncestor(k,t))p.delete(t);v.add(k);}
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
function families(p){const expanded=new Set(p);for(const t of p){let parent=SUBTOPICS[t];while(parent&&!expanded.has(parent)){expanded.add(parent);parent=SUBTOPICS[parent];}}return FAMILY.filter(f=>f.some(t=>expanded.has(t))).length;}
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
 if(q.id==='discover-index')return indexQuestion(c);
 if(q.id==='discover')return BY_ID.get('discover-menu');
 if(q.id==='discovery-feedback')return {...q,options:[...c.discoveryTraits.map((t,i)=>({id:String(i),label:LABELS[t]||t,prefer:[t],length:''})),{id:'cover',label:'Vooral de omslag of het verhaal zelf',prefer:[],length:''},{id:'unknown',label:'Weet ik niet',prefer:[],length:''}]};
 if(q.id==='clarify-remainder'){
  const names=c.clarifyKnown.filter(t=>!c.clarifyKnown.some(k=>isAncestor(t,k))).map(t=>LABELS[t]||t).join(', ');
  const possible=c.clarifyTentative.filter(t=>!c.clarifyTentative.some(k=>isAncestor(t,k)));
  const prompt=possible.length?'Ik heb '+names+' begrepen. Bedoel je dat '+possible.map(t=>LABELS[t]||t).join(', ')+' je ook aanspreekt?':'Ik herken '+names+'. Kun je het andere onderwerp iets beter uitleggen?';
  return {...q,prompt,examples:prompt,options:[...(possible.length?[{id:'yes',label:'Ja, ook dat',prefer:possible,length:''}]:[]),{id:'skip',label:'Ga verder met wat je al weet',prefer:[],length:''}]};
 }
 if(q.id==='clarify-topic'){
  const rule=AMBIGUITIES.get(c.clarifyAmbiguity);
  if(rule){const prompt=c.clarifyNegative?'Welk van deze onderwerpen bedoel je dat je liever wilt vermijden?':rule[2];const visible=rule[3].slice(0,rule[4]||rule[3].length);const options=visible.map(([trait,label],i)=>({id:String(i),label,prefer:[trait],length:''}));if(visible.length===2)options.push({id:'both',label:'Allebei',prefer:visible.map(x=>x[0]),length:''});options.push({id:'skip',label:'Laat maar',prefer:[],length:''});return {...q,prompt,examples:prompt,options};}
  const topics=[...new Set([...c.clarifyKnown,...c.clarifyCandidates])].slice(0,5);
  const options=topics.map((t,i)=>({id:String(i),label:LABELS[t]||t,prefer:[t],length:''}));
  if(c.clarifyKnown.length&&c.clarifyCandidates.length===1&&topics.length>1)options.push({id:'all',label:'Ja, die bedoel ik '+(topics.length===2?'allebei':'allemaal'),prefer:topics,length:''});
  return {...q,options};
 }
 if(q.id==='hobby-focus'){
  const hobbies=c.hobbies;
  const labels={art:'Tekenen of iets maken',sport:'Sport',gaming:'Games',music:'Muziek'};
  const names=hobbies.map(t=>labels[t]||LABELS[t]||t);
  const options=hobbies.map((t,i)=>({id:String(i),label:names[i],prefer:[t],length:''}));
  if(hobbies.length>1)options.push({id:'both',label:hobbies.length===2?'Allebei':'Allemaal',prefer:hobbies,length:''});
  options.push({id:'other',label:'Liever iets anders',prefer:[],length:''});
  return {...q,multiple:hobbies.length>2,prompt:hobbies.length===2?'Zou je ook iets over '+names.map(n=>n.toLocaleLowerCase('nl-NL')).join(' of ')+' willen lezen?':hobbies.length===1?'Zou je daar ook iets over willen lezen?':'Over welke hiervan zou je ook iets willen lezen? Je mag meerdere kiezen.',options};
 }
 if(q.id!=='media-interest')return q;
 const options=c.hypothesis.slice(0,7).map((key,i)=>({id:String(i),label:LABELS[key]||key,prefer:[key],length:''}));
 return {...q,options};
}
function questionView(q){return q?{id:q.id,prompt:q.prompt,examples:q.examples,
 options:q.options.map(({id,label})=>({id,label})),...(q.multiple?{multiple:true}:{})}:null;}
function chooseQuestion(context,signals,books,last=[],force=''){
 const p=signals.prefer, known=new Set([...p,...signals.avoid]);
 const focused=p.filter(t=>!p.some(child=>isAncestor(t,child)));
 const used=new Set([...context.used,context.current]);
 const top=profiles(books,signals);
 const excluded=new Set([...signals.avoid,...context.skipped]);
 const eligible=Q.filter(q=>!used.has(q.id)&&!q.when.some(t=>excluded.has(t)||[...excluded].some(parent=>isAncestor(parent,t)))&&!(q.requires||[]).some(t=>excluded.has(t))&&!DISCOVERY_IDS.has(q.id)&&!['opening','media-interest','book-interest','feedback','hobby-focus','clarify-topic','extended-reflection-1'].includes(q.id)
  &&(!q.when.length||q.when.some(t=>focused.includes(t)))
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
  const link=(q.when.some(t=>last.includes(t))?8:q.when.some(t=>p.includes(t))?3:0)+(q.when.some(t=>context.priority.includes(t))?3:0);
  const stage=q.stage===1?4:q.stage===2?3:q.stage===0?(p.length?1:7):0;
  return {q,score:link+stage+Math.min(4,coverage)+recent+groupPenalty};
 }).sort((a,b)=>b.score-a.score||a.q.id.localeCompare(b.q.id));
 if(!ranked.length)return null;
 // Rotate only among nearly equivalent useful questions.
 const precise=ranked.filter(x=>x.q.when.some(t=>last.includes(t)&&focused.includes(t)&&SUBTOPICS[t]));
 const recentTopicMatches=precise.length?precise:ranked.filter(x=>x.q.when.some(t=>last.includes(t)&&focused.includes(t)));
 const candidates=recentTopicMatches.length?recentTopicMatches:ranked;
 const pool=candidates.filter(x=>x.score>=candidates[0].score-2.5).slice(0,12);
 return pool.sort((a,b)=>tie(context.seed,b.q.id)-tie(context.seed,a.q.id))[0].q;
}
function explicitReadingHint(value){return /\b(?:lees|lezen|boek|boeken)\b/.test(value);}
function analyze(text,rawContext={},books=[]){
 let c=cleanContext(rawContext),q=questionForContext(c);
 const value=normalize(text);
 const navigation=rawContext?.navigation;
 const navigate=(id,kind='question',reaction='')=>{const ctx={...c,current:id,discovery:true,uncertain:0};return {prefer:[],avoid:[],recognized:false,clarify:false,labels:LABELS,advice:{kind,reaction,question:questionView(questionForContext(ctx)),context:ctx}};};
 if(navigation==='questions'||navigation==='examples'){
  if(navigation==='questions'&&['discover','opening','discover-menu'].includes(c.current))return navigate('discover-menu','examples');
  if(c.current==='discover')return navigate('discover-menu','examples');
  return {prefer:[],avoid:[],recognized:false,clarify:false,labels:LABELS,advice:{kind:'examples',question:questionView(q),context:c}};
 }
 if(navigation==='menu')return navigate('discover-menu','examples');
 if(navigation==='index'){c={...c,indexParent:'',indexPage:0};return navigate('discover-index','examples');}
 if(navigation==='book-feedback'){
  // Votes are session-only; only actual public catalogue books may contribute hypotheses.
  const votes=Array.isArray(rawContext.bookVotes)?rawContext.bookVotes.slice(0,8):[];
  const seen=new Set(),positive=[],maybe=[];
  for(const v of votes){if(!v||!['like','maybe','dislike'].includes(v.vote)||seen.has(v.bookId))continue;const b=books.find(b=>b.id===v.bookId&&!isHidden(b)&&b.personalLoanOnly!==true);if(!b)continue;seen.add(v.bookId);if(v.vote==='like')positive.push(b);else if(v.vote==='maybe')maybe.push(b);}
  const chosen=positive.length?positive:maybe;
  if(!chosen.length)return navigate('discover-menu','examples','Geen probleem! We weten nog niet welke boeken je aanspreken.');
  const scores=new Map();for(const b of chosen)for(const [trait,confidence] of traitsForBook(b)){if(confidence<0.7||c.signals.avoid.includes(trait)||c.signals.avoid.some(k=>isAncestor(k,trait)))continue;scores.set(trait,(scores.get(trait)||0)+1+confidence/4);}
  const supported=validateSignals({prefer:[...scores.keys()]}).prefer;
  const specific=[...scores].filter(([t])=>supported.includes(t)&&!supported.some(k=>isAncestor(t,k))).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,6).map(([t])=>t);
  const ctx={...c,current:'discovery-feedback',discovery:true,discoveryReturn:c.current==='discovery-feedback'?c.discoveryReturn:c.current,discoveryTraits:specific,uncertain:0};
  const question=questionView(questionForContext(ctx));
  question.prompt=chosen.length===1?'Wat spreekt je aan in '+String(chosen[0].title).slice(0,150)+'?':'Wat spreekt je aan in de boeken die je misschien leuk vindt?';
  return {prefer:[],avoid:[],recognized:false,clarify:false,labels:LABELS,advice:{kind:'question',question,context:ctx}};
 }
 if(navigation==='topics')return navigate(c.current==='discover-topics'?'discover-topics-more':'discover-topics','question');
 let selected=typeof rawContext?.optionId==='string'?q.options.find(o=>o.id===rawContext.optionId&&normalize(o.label)===value):q.options.find(o=>normalize(o.label)===value);
 if(c.current==='discover-index'&&selected){
  const id=selected.id;
  if(id==='next'||id==='prev'){c={...c,indexPage:Math.max(0,c.indexPage+(id==='next'?1:-1))};return navigate('discover-index','examples');}
  if(id==='up'){c={...c,indexParent:SUBTOPICS[c.indexParent]&&Object.hasOwn(LABELS,SUBTOPICS[c.indexParent])?SUBTOPICS[c.indexParent]:'',indexPage:0};return navigate('discover-index','examples');}
  if(id.startsWith('topic:')){const t=id.slice(6);if(indexChildren(t).length){c={...c,indexParent:t,indexPage:0};return navigate('discover-index','examples');}selected={...selected,prefer:[t]};}
 }
 if(c.current==='hobby-focus'&&Array.isArray(rawContext?.optionIds)){
  const ids=[...new Set(rawContext.optionIds)].slice(0,24);
  const picks=ids.map(id=>q.options.find(o=>o.id===id&&/^\d+$/.test(id)));
  if(picks.length&&picks.every(Boolean))selected={prefer:validateSignals({prefer:picks.flatMap(o=>o.prefer)}).prefer,length:''};
 }
 if(c.current==='discovery-feedback'&&(selected?.id==='cover'||selected?.id==='unknown'||/^(?:weet ik niet|geen idee|alleen de omslag)$/.test(value)))return navigate(c.discoveryReturn==='discover'?'discover-menu':c.discoveryReturn,'question','Prima! We gaan verder met wat we al weten.');
 if(c.current==='discover-menu'&&selected){const target=DISCOVERY_MENU[Number(selected.id)]?.[1];if(target)return navigate(target);}
 let resolvedAmbiguity=null;
 let pendingReplacement=false;
 if(c.current==='clarify-remainder'){
  const answered=selected?.id==='yes'?selected.prefer:selected?.id==='skip'||/^(?:nee|weet ik niet|geen idee|laat maar)$/.test(value)?[]:interpret(text).prefer;
  if(!selected&&!answered.length&&!/^(?:nee|weet ik niet|geen idee|laat maar)$/.test(value)&&c.uncertain<1)return {prefer:[],avoid:[],recognized:false,clarify:true,labels:LABELS,advice:{kind:'examples',question:questionView(q),reaction:'Dat herken ik nog niet. We kunnen ook verder met wat ik al weet.',context:{...c,uncertain:c.uncertain+1}}};
  pendingReplacement=c.clarifyReplace;
  resolvedAmbiguity={traits:[],negative:false,known:c.clarifyKnown,avoid:c.clarifyAvoid};
  selected={prefer:validateSignals({prefer:[...c.clarifyKnown,...answered]}).prefer,length:''};
  c={...c,current:c.clarifyFrom,clarifyKnown:[],clarifyTentative:[],clarifyAvoid:[],clarifyReplace:false,clarifyFrom:'opening',uncertain:0};q=questionForContext(c);
 }
 if(c.current==='clarify-topic'&&c.clarifyAmbiguity){
  const rule=AMBIGUITIES.get(c.clarifyAmbiguity);
  const meaning=resolveMeaning(rule,text);
  const both=q.options.find(o=>o.id==='both');
  const bothAnswer=both&&/^(?:(?:ik vind|ik bedoel|ik wil|het zijn) )?(?:het )?(?:allebei|beide)(?: leuk| interessant| graag| wel| bedoel ik)?$/.test(value);
  const traits=selected?.prefer?.length?selected.prefer:meaning?[meaning]:bothAnswer?both.prefer:[];
  // An unrecognized explanation does not discard other queued topics. Retry
  // twice, then skip only this meaning and preserve what was understood.
  const skip=!traits.length&&(c.uncertain>=2||/^(?:laat maar|sla over)$/.test(value));
  if(traits.length||skip){
   if(c.clarifyQueue.length){
    const [next,...queue]=c.clarifyQueue;
    const ctx={...c,clarifyAmbiguity:next.id,clarifyNegative:next.negative,clarifyQueue:queue,clarifyKnown:validateSignals({prefer:[...c.clarifyKnown,...(c.clarifyNegative?[]:traits)]}).prefer,clarifyAvoid:validateSignals({avoid:[...c.clarifyAvoid,...(c.clarifyNegative?traits:[])]}).avoid,uncertain:0};
    return {prefer:[],avoid:[],recognized:false,clarify:true,labels:LABELS,advice:{kind:'examples',question:questionView(questionForContext(ctx)),context:ctx}};
   }
   pendingReplacement=c.clarifyReplace;
   resolvedAmbiguity={traits,negative:c.clarifyNegative,known:c.clarifyKnown,avoid:c.clarifyAvoid};
   selected={prefer:c.clarifyNegative?c.clarifyKnown:[...c.clarifyKnown,...traits],length:''};
  }else{
   return {prefer:[],avoid:[],recognized:false,clarify:true,labels:LABELS,advice:{kind:'examples',reaction:'Ik begrijp nog niet precies wat je bedoelt. Kies gerust een antwoord, of zeg: laat maar.',question:questionView(q),context:{...c,uncertain:c.uncertain+1}}};
  }
 }
 if(c.current==='clarify-topic'){
  const previous=c.clarifyFrom;
  c={...c,current:previous,clarifyCandidates:[],clarifyKnown:[],clarifyFrom:'opening',clarifyAmbiguity:'',clarifyNegative:false,clarifyAvoid:[],clarifyQueue:[],clarifyReplace:false};
  q=questionForContext(c);
 }
 let current=validateSignals(c.signals);
 let input=ownInterestText(text), media=[],hypothesis=[],length=c.length;
 const readingException=input.match(/^\s*(?:ik\s+)?(?:vind\s+lezen\s+niet\s+leuk|hou\s+niet\s+van\s+lezen|lees\s+niet\s+graag|haat\s+lezen|vind\s+boeken\s+saai|lezen\s+is\s+saai)\s*,?\s*(?:behalve|maar\s+wel)\s+(.+)$/i);
 if(readingException)input='Ik lees graag '+readingException[1];
 const ownValue=normalize(input);
 const notReader=!readingException&&/\b(?:haat lezen|lezen is saai|lees niet graag|niet van lezen|geen zin om te lezen|boeken saai|meeste boeken saai)\b/.test(value);
 // Media mentions suggest possible directions, never book preferences by themselves.
 for(const [name,aliases,traits] of MEDIA){
  if(aliases.some(a=>(' '+ownValue+' ').includes(' '+a+' '))){
   media.push(name);hypothesis.push(...traits);
   for(const alias of aliases)input=input.replace(new RegExp('\\b'+alias.replace(/[.*+?^$(){}|[\]\\]/g,'\\$&')+'\\b','gi'),' ');
  }
 }
 // A real catalogue title is an anchor for a question, not an inferred liking.
 let anchor=null;
 if(!selected&&value.length>=5){
  const name=normalize(String(input||'').replace(/^(?:ik vond|ik las|ik heb|ik lees)\s+/i,'').replace(/\s+(?:leuk|gelezen|uitgelezen)$/i,''));
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
   current=validateSignals({prefer:current.prefer.filter(t=>!feedbackRejected.some(k=>t===k||isAncestor(k,t))),avoid:current.avoid});
   input=contrast[2];
  }else if(/\b(?:te veel|minder|te weinig interessant|niet interessant|saai|niet mijn ding)\b/.test(value)){
   const rejected=interpret(input);
   feedbackRejected=[...new Set([...rejected.prefer,...rejected.avoid])];
   if(feedbackRejected.length){
    current=validateSignals({prefer:current.prefer.filter(t=>!feedbackRejected.some(k=>t===k||isAncestor(k,t))),avoid:current.avoid});
    return {prefer:[],avoid:[],recognized:true,clarify:false,labels:LABELS,advice:{
      kind:'question',reaction:'Oké! Dan zoeken we iets anders.',clearReference:true,
      context:{...c,signals:current,current:'feedback',uncertain:0},
      question:{...questionView(q),prompt:'Wat zou je in plaats daarvan graag willen lezen?'}}};
   }
  }
 }
 const decline=/^(?:(?:eigenlijk|gewoon) )?(?:nee|niets|niks|helemaal niks|helemaal niets|niet echt|geen van beide|geen van deze|geen van die|boeit me niet|interesseert me niet|niet mijn ding|liever iets anders|ik wil iets anders lezen)(?: daarvan| hoor| eigenlijk| echt| lol| haha| dank je)*$/.test(value);
 const uncertain=/^(?:ik )?(?:weet (?:het )?niet|weet ik niet|weet ik veel|geen idee|idk|mnu|maakt (?:me )?niet uit|geen voorkeur|geen flauw idee)(?: eigenlijk| echt| hoor| haha| denk ik| lol)*$/.test(value);
 if(/\b(?:geen dikke boeken|niet zo dik|niet te dik|liever kort|kort boek|korte boeken|weinig pagina s|niet veel pagina s)\b/.test(value))length='short';
 if(/\b(?:dik boek is prima|lange boeken zijn prima|lengte maakt niet uit)\b/.test(value))length='any';
 const contextualAliases={
  'media-interest':c.media.includes('Minecraft')?[['bouwen','gameBuilding'],['vooral bouwen','gameBuilding'],['samen spelen','gameMultiplayer'],['de wereld ontdekken','adventure']]:[],
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
 let correction=false;
 // Explicit correction: remove only the mistaken direction, not unrelated
 // preferences or a permanent exclusion.
 const corrected=input.match(/^\s*(?:nee[, ]+)?(?:ik bedoel|ik bedoelde|bedoel eigenlijk)\s+(.+)/i);
 if(!selected&&corrected){
  const revised=interpret(corrected[1]);
  if(revised.recognized&&revised.prefer.length){
   const old=q.when.filter(t=>!revised.prefer.includes(t));
   current=validateSignals({prefer:current.prefer.filter(t=>!old.some(k=>k===t||isAncestor(k,t))),avoid:current.avoid});
   input=corrected[1];correction=true;
  }
 }
 if(!selected&&(q.when.includes('sportPlaying')||q.when.includes('sport')||current.prefer.includes('sportPlaying'))
   &&/^(?:nee )?(?:ik )?kijk (?:alleen|liever)(?: maar)?(?: naar (?:voetbal|sport))?$/.test(value)){
  current=validateSignals({prefer:current.prefer.filter(t=>t!=='sportPlaying'),avoid:current.avoid});
  input='sport kijken';correction=true;
 }
 let direct=selected?{...validateSignals({prefer:selected.prefer}),recognized:true,clarify:false}:interpret(input);
 if(resolvedAmbiguity)direct={...validateSignals({prefer:selected.prefer,avoid:[...resolvedAmbiguity.avoid,...(resolvedAmbiguity.negative?resolvedAmbiguity.traits:[])]}),recognized:true,clarify:false};
 if(c.current==='hobby-focus'&&!selected&&/^(?:ja|ja graag|zeker|jawel)$/.test(value)&&c.hobbies.length>1){
  return {prefer:[],avoid:[],recognized:true,clarify:false,labels:LABELS,advice:{kind:'examples',reaction:'Leuk! Waar zou je dan het liefst over lezen?',question:{...questionView(q),examples:'Kies gerust wat bij je past.'},context:c}};
 }
 if(c.current==='hobby-focus'&&!selected&&/^(?:ja|ja graag|zeker|jawel|allebei|beide|allemaal)$/.test(value))direct={...validateSignals({prefer:c.hobbies}),recognized:true,clarify:false};
 // Exact short contextual responses can be resolved without guessing.
 let resolvedContextAlias=false;
 if(!selected&&!direct.recognized&&!direct.avoid?.length){
  const alias=(contextualAliases[c.current]||[]).find(([phrase])=>normalize(phrase)===value);
  if(alias){direct={...validateSignals({prefer:[alias[1]]}),recognized:true,clarify:false};resolvedContextAlias=true;}
 }
 if(selected?.length)length=selected.length;
 // Resolve a pronoun only in an animal context, and explicitly confirm
 // the resulting exclusion in the UI. Do not generalize to human loss.
 if(!selected&&/\b(?:ik wil niet dat|ik wil liever niet dat|ik wil geen verhaal waarin)\s+(?:(?:die|het dier|de hond|de kat|een dier|een hond|een kat|mijn hond|mijn kat)\s+(?:doodgaat|dood gaat|sterft|overlijdt))\b/.test(value)
  &&(current.prefer.some(t=>t==='animals'||isAncestor('animals',t))||/\b(?:dier|hond|kat)\b/.test(value))){
  direct={...validateSignals({prefer:direct.prefer,avoid:[...(direct.avoid||[]),'animalLoss']}),recognized:true,clarify:false};
 }
 const activityContext=['discover','free-time','watch','media-interest'].includes(c.current)||(!explicitReadingHint(value)&&/\b(?:ik hou van|ik houd van|ik doe graag|ik speel graag|ik sport graag|ik vind het leuk om|mijn hobby)\b/.test(value)&&c.current==='opening');
 if(activityContext&&!selected&&c.current==='free-time'&&/\b(?:sporten|ik sport)\b/.test(value)&&!/\b(?:sport kijken|kijk sport|sport zelf niet|niet sporten|geen sport)\b/.test(value)&&direct.prefer.includes('sport'))direct={...direct,prefer:validateSignals({prefer:[...direct.prefer,'sportPlaying']}).prefer};
 const readingClauses=[];
 let readingScope=false;
 for(const sentence of input.split(/[.!?;\n]/)){
  readingScope=false;
  for(const part of sentence.split(/\b(?:maar|echter)\b/i)){
   const hasReading=/\b(?:lees|lezen|boek|boeken)\b/i.test(part);
   const continuation=readingScope&&/^\s*(?:niet|geen|zonder|wel|liever|ook)\b/i.test(part);
   if(hasReading||continuation)readingClauses.push(part);
   readingScope=hasReading||continuation;
  }
 }
 const explicitReading=Boolean(readingException)||/\b(?:ik lees|lees graag|boeken? (?:over|met|waarin)|wil lezen|wil .*? lezen|zou .*? lezen|iets .*? lezen|ik (?:wil|zoek) (?:een |het |wat )?(?:[a-z]+ ){0,3}(?:verhaal|verhalen|boek|boeken))\b/.test(value)||readingClauses.some(part=>/\b(?:wil|liever|graag|zonder)\b/i.test(part));
 const activityRefusal=activityContext&&readingClauses.some(part=>/\b(?:niet|geen|zonder|hekel)\b/i.test(part));
 const ambiguities=!selected&&!resolvedContextAlias&&!media.length&&!anchor&&!notReader&&!uncertain&&!decline?findAmbiguities(input).filter(x=>!x.negative||x.reading||explicitReading):[];
 const ambiguity=ambiguities[0]||null;
 // Keep explicit book exclusions separate from activity likes/dislikes.
 const readingExclusions=(activityRefusal||explicitReading)?validateSignals({avoid:[...readingClauses.flatMap(part=>interpret(part).avoid),...(direct.avoid||[]).filter(t=>t==='animalLoss')]}).avoid:[];
 // A preference about playing or watching is not a reading exclusion.
 if(activityContext&&!explicitReading&&!selected){
  if(/\b(?:sport|sporten|voetbal|voetballen) zelf niet\b/.test(value)&&/\b(?:kijk|kijken|volg|volgen)\b/.test(value)){
   direct={...direct,prefer:validateSignals({prefer:[...direct.prefer.filter(t=>t!=='sportPlaying'&&t!=='sport'),'sportWatching']}).prefer,avoid:[]};
  }
 }
 if(!selected&&explicitReading&&readingClauses.length){
  const readingSignals=validateSignals({prefer:readingClauses.flatMap(part=>interpret(part).prefer),avoid:readingClauses.flatMap(part=>interpret(part).avoid)});
  if(readingSignals.prefer.length||readingSignals.avoid.length)direct={...readingSignals,recognized:true,clarify:false};
 }
 if((activityRefusal||explicitReading)&&readingExclusions.length){
  const readingSignals=validateSignals({prefer:readingClauses.flatMap(part=>interpret(part).prefer),avoid:readingExclusions});
  direct={...readingSignals,recognized:true,clarify:false};
 }else if(activityRefusal&&!readingClauses.some(part=>interpret(part).prefer.length)&&!ambiguity&&!/\b(?:maar|liever)\s+(?:wel|iets over)\b/.test(value)){
  const ctx={...c,signals:current,length,used:[...new Set([...c.used,c.current])],hobbies:[],uncertain:0,turns:Math.min(7,c.turns+1)};
  const alternative=['more-interests','opening','watch','free-time'].map(id=>BY_ID.get(id)).find(q=>!ctx.used.includes(q.id));
  if(!alternative||ctx.turns>=6)return {prefer:[],avoid:[],recognized:true,clarify:false,labels:LABELS,advice:{kind:'offer',reaction:'Ook goed!',context:ctx}};
  return {prefer:[],avoid:[],recognized:true,clarify:false,labels:LABELS,advice:{kind:'question',reaction:'Geen probleem! Dan zoeken we iets anders.',question:questionView(alternative),context:{...ctx,current:alternative.id}}};
 }
 const privateDisclosure=!selected&&/\b(?:ik ben|ik heb|ik denk dat ik|ik voel me)\b/.test(value)&&direct.prefer.some(isPrivateTopic);
 if(privateDisclosure&&explicitReading){
  const requests=input.split(/[.!?;]|\b(?:maar|en)\s+(?=(?:ik\s+)?(?:wil|zou|lees|zoek)\b)/i).filter(part=>/\b(?:wil|zou|lees|zoek)\b.*\b(?:lees|lezen|boek|boeken)\b|\bik lees\b/i.test(part));
  // Strip a preceding disclosure even inside one sentence. Only an actual
  // reading request may contribute a sensitive preference.
  const requested=interpret(requests.map(part=>part.replace(/^.*?\b(?=(?:ik\s+)?(?:wil|zou|lees|zoek)\b)/i,'')).join('. '));
  direct=requested;
 }
 if(privateDisclosure&&(!explicitReading||!direct.recognized)){
  const ctx={...c,signals:current,length,current:'more-interests',uncertain:0};
  return {prefer:[],avoid:[],recognized:false,clarify:true,labels:LABELS,advice:{kind:'question',reaction:'Je hoeft niets persoonlijks te vertellen om een boek te kiezen.',question:{...questionView(BY_ID.get('more-interests')),prompt:'Over welk onderwerp zou je graag iets lezen?'},context:ctx}};
 }
 const replaceTopics=pendingReplacement||(!selected&&/\b(?:ik wil|ik zoek|ik lees|liever|ik zou)\b.*\b(?:alleen|uitsluitend|enkel|niets anders dan)\b.*\b(?:over|boeken?|lezen)\b|\b(?:ik wil|ik zoek)\b.*\b(?:over|boeken?)\b.*\b(?:alleen|uitsluitend|enkel)\b/.test(value));
 const partial=!selected&&!media.length&&!anchor&&!notReader&&!uncertain&&!decline&&!ambiguity&&!privateDisclosure&&c.uncertain===0?partialInterest(input):null;
 // Keep known subjects as provisional until the unanswered part is addressed.
 // Typos with existing suggestions still use the original typo confirmation.
 if(partial&&(!direct.recognized||partial.unknown||partial.possible.length)&&!direct.avoid?.length){
  const from=explicitReading?'opening':activityContext?'free-time':c.current;
  const ctx={...c,current:'clarify-remainder',clarifyFrom:from,clarifyKnown:partial.known.prefer,clarifyTentative:partial.possible,clarifyAvoid:partial.known.avoid,clarifyReplace:replaceTopics,length,uncertain:0};
  return {prefer:[],avoid:[],recognized:false,clarify:true,labels:LABELS,advice:{kind:'examples',question:questionView(questionForContext(ctx)),context:ctx}};
 }
 const delta=validateSignals(direct);
 const emphasized=input.match(/\b(?:vooral|het liefst|meer van|liever over|favoriet is)\s+([^.!?;]+)/i);
 const priority=validateSignals({prefer:[...(emphasized?interpret(emphasized[1]).prefer:[]),...c.priority]}).prefer;
 if(c.discovery&&(uncertain||decline)&&!selected&&!delta.prefer.length&&!delta.avoid.length&&!media.length&&!anchor&&!c.signals.prefer.length&&c.current!=='clarify-topic'){
  if(c.current==='discover')return navigate('discover-menu','examples','Geen probleem!');
  if(c.current==='discover-menu')return navigate('discover-topics','question','Misschien helpt het als je onderwerpen ziet.');
  if(c.current==='discover-topics')return navigate('discover-topics-more','question');
  if(c.current==='discover-topics-more')return {prefer:[],avoid:[],recognized:false,clarify:false,labels:LABELS,advice:{kind:'offer',reaction:'Geen probleem!',context:c}};
  if(c.uncertain===0&&q.options.length&&!decline)return {prefer:[],avoid:[],recognized:false,clarify:false,labels:LABELS,advice:{kind:'examples',question:questionView(q),context:{...c,uncertain:1}}};
  if(!c.used.includes('discover-topics')){c={...c,used:[...new Set([...c.used,c.current])],hobbies:[]};return navigate('discover-topics','question','Dan bekijken we andere onderwerpen.');}
 }
 // Resolve homonyms before the ordinary typo or follow-up selector. The
 // selected meaning is still subject to the original hobby/reading consent.
 if(!selected&&!media.length&&!anchor&&!notReader&&!uncertain&&!decline){
  if(ambiguity&&(!ambiguity.negative||ambiguity.reading||explicitReading)){
   const [id,,,meanings]=ambiguity.rule;
   const related=ambiguities.flatMap(x=>x.rule[3].map(m=>m[0]));
   const isRelated=t=>related.some(k=>t===k||isAncestor(t,k)||isAncestor(k,t));
   const remaining=interpret(ambiguities.reduce((s,x)=>removeAmbiguousWord(s,x.rule),input));
   const known=delta.prefer.filter(t=>!isRelated(t)||remaining.prefer.includes(t));
   const avoid=delta.avoid.filter(t=>!isRelated(t)||remaining.avoid.includes(t));
   const hobby=!explicitReading&&(activityContext||/\b(?:ik hou van|ik houd van|ik doe graag|ik vind het leuk om|mijn hobby)\b/.test(value));
   const from=explicitReading&&activityContext?'opening':hobby&&(!activityContext||c.current==='opening')?'free-time':c.current;
   const ctx={...c,signals:current,current:'clarify-topic',clarifyFrom:from,clarifyAmbiguity:id,clarifyNegative:ambiguity.negative,clarifyQueue:ambiguities.slice(1).map(x=>({id:x.rule[0],negative:x.negative})),clarifyReplace:replaceTopics,clarifyKnown:known,clarifyAvoid:avoid,clarifyCandidates:[],uncertain:0,length};
   return {prefer:[],avoid:[],recognized:false,clarify:true,labels:LABELS,advice:{kind:'examples',question:questionView(questionForContext(ctx)),context:ctx}};
  }
 }
 // Mixed known/uncertain input: show likely topics without treating guesses
 // or the known half of the answer as a confirmed preference.
 if(!selected&&!media.length&&!anchor&&!notReader&&!uncertain&&!decline&&c.uncertain===0&&!delta.avoid.length&&length===c.length&&!/\b(?:niet|geen|zonder|hekel)\b/.test(value)){
  const possibleGuesses=suggestTopics(input);
  const guesses=possibleGuesses.filter(t=>!delta.prefer.includes(t)&&!delta.prefer.some(k=>isAncestor(t,k))&&!possibleGuesses.some(k=>isAncestor(t,k)));
  if(guesses.length){
   const known=delta.prefer.filter(t=>!delta.prefer.some(k=>isAncestor(t,k))).slice(0,3);
   const ctx={...c,current:'clarify-topic',clarifyFrom:c.current,clarifyKnown:known,clarifyCandidates:guesses,uncertain:1};
   return {prefer:[],avoid:[],recognized:false,clarify:true,labels:LABELS,advice:{kind:'examples',reaction:known.length?'Een deel snap ik al! Bedoel je dit?':'Hmm, ik twijfel een beetje 🤔',question:questionView(questionForContext(ctx)),context:ctx}};
  }
 }
 if(replaceTopics&&delta.prefer.length){current=validateSignals({prefer:[],avoid:current.avoid});feedbackRejected.push('replacement');}
 const updated=merged(current,delta);
 const conjunction=!selected&&explicitReading?input.match(/^(.+?)\b(?:met|waarin)\s+(.+)$/i):null;
 const leaf=xs=>xs.filter(t=>!xs.some(k=>isAncestor(t,k))&&!(t==='people'&&xs.some(k=>k!=='people'&&Object.hasOwn(SUBTOPICS,k))));
 const left=conjunction?leaf(interpret(conjunction[1]).prefer):[],right=conjunction?leaf(interpret(conjunction[2]).prefer):[];
 const newRequired=left.length&&right.length&&right.some(t=>!left.includes(t))&&!/\b(?:of|misschien|bijvoorbeeld|liefst|eventueel|zonder|geen|niet)\b/i.test(conjunction[2])?validateSignals({prefer:[...left,...right]}).prefer:[];
 const required=validateSignals({prefer:[...(replaceTopics?[]:c.required),...newRequired]}).prefer.filter(t=>updated.prefer.includes(t)&&!updated.avoid.some(a=>a===t||isAncestor(a,t)));
 const hasNew=delta.prefer.some(t=>!current.prefer.includes(t))||delta.avoid.some(t=>!current.avoid.includes(t))||length!==c.length;
 const next={...c,signals:updated,length,priority,required,skipped:c.skipped.filter(t=>!delta.prefer.includes(t)),hobbies:c.current==='hobby-focus'?[]:c.hobbies,media:[...new Set([...c.media,...media])].slice(-4),
  hypothesis:validateSignals({prefer:[...c.hypothesis,...hypothesis]}).prefer,
  turns:Math.min(7,c.turns+1),used:[...new Set([...c.used,c.current])],uncertain:0};
 const envelope={...direct,labels:LABELS,prefer:delta.prefer,avoid:delta.avoid};
 // Hobbies are not automatically reading preferences. Check whether the
 // pupil actually wants to read about them before using them for ranking.
 if(activityContext&&!explicitReading&&!activityRefusal&&!notReader&&!media.length&&!anchor&&delta.prefer.length){
  const detailed=delta.prefer.filter(t=>!delta.prefer.some(k=>isAncestor(t,k)));
  const ctx={...next,signals:resolvedAmbiguity?merged(current,{prefer:[],avoid:delta.avoid}):current,hobbies:detailed,current:'hobby-focus'};
  const serious=detailed.some(t=>['grief','mentalHealth','bullying','discrimination','crimeVictims','animalLoss','empathy','crime','war','murder','disasters'].includes(t));
  return {...envelope,prefer:[],avoid:resolvedAmbiguity?delta.avoid:[],advice:{kind:'question',reaction:serious?'Dank je!':c.current==='media-interest'?'Ah, duidelijk!':'Oh, leuk!',question:questionView(questionForContext(ctx)),context:ctx}};
 }
 if((decline&&!delta.prefer.length&&!delta.avoid.length)||(c.current==='hobby-focus'&&selected?.id==='other')){
  const ctx={...next,signals:current,hobbies:[],hypothesis:[],skipped:[...new Set([...c.skipped,...q.when,...c.hobbies])].slice(0,8),uncertain:0};
  // A rejected question is not evidence that the pupil dislikes every
  // topic associated with it. Offer a different direction instead.
  const alternatives=['more-interests','watch','opening','free-time'];
  const follow=alternatives.map(id=>BY_ID.get(id)).find(x=>!ctx.used.includes(x.id));
  if(!follow||ctx.turns>=6)return {...envelope,recognized:true,clarify:false,advice:{kind:'offer',reaction:'Helemaal prima!',context:ctx}};
  return {...envelope,recognized:true,clarify:false,advice:{kind:'question',reaction:'Ook goed! We zoeken gewoon verder.',question:questionView(follow),context:{...ctx,current:follow.id}}};
 }
 const bookMention=String(text||'').match(/^(?:ik heb (?:het boek )?(.{2,100}?)\s+(?:gelezen|uitgelezen)|ik las (?:het boek )?(.{2,100}?)|ik vond het boek (.{2,100}?)(?:\s+(?:leuk|heel leuk|geweldig))?|(?:het )?boek (?:heet |is )?(.{2,100}?))[.!]?$/i);
 if(!selected&&!anchor&&bookMention&&!media.length&&!direct.avoid?.length){
  const candidate=bookMention.slice(1).find(Boolean)?.trim();
  if(candidate&&!/\b(?:geen|niet|een boek over|iets over)\b/i.test(candidate))return {...envelope,advice:{kind:'book-search',title:candidate,context:c}};
 }
 if(!selected&&!direct.recognized&&!media.length&&!anchor&&!notReader&&length===c.length){
  if(uncertain||c.uncertain>=1){
   if(c.uncertain>=2)return {...envelope,advice:{kind:'offer',reaction:'Geen probleem. We hoeven niet alles te weten!',context:c}};
   return {...envelope,advice:{kind:'examples',question:questionView(q),context:{...c,uncertain:Math.min(2,c.uncertain+1)}}};
  }
  return {...envelope,advice:{kind:'clarify',reaction:'Oeps, die snap ik nog niet helemaal 😅 Wat bedoel je precies?',question:questionView(q),context:{...c,uncertain:Math.min(2,c.uncertain+1)}}};
 }
 // A named reference can change the direction even if there is no direct trait.
 const possible=validateSignals({prefer:hypothesis}).prefer;
 let reaction=correction?'Ohhh, zo! Ik had je verkeerd begrepen.':'';
 if((media.length||anchor)&&!next.used.includes('media-interest')&&!next.used.includes('book-interest')){
   // A title is evidence about possible themes, never about the pupil's liking.
   const candidate=anchor?'book-interest':'media-interest';
   const mediaContext={...next,current:candidate,signals:activityContext&&!explicitReading?merged(current,{prefer:[],avoid:delta.avoid}):updated};
   const view=questionView(questionForContext(mediaContext));
   return {...envelope,advice:{kind:'question',reaction:'',
    question:{...view,prompt:anchor?'Wat sprak je aan in '+anchor.title+'?':media.length===1?'Wat spreekt je aan in '+media[0]+'?':'Wat vind je interessant aan die games, films of series?'},
    context:mediaContext,...(anchor?{reference:{bookId:anchor.bookId,title:anchor.title}}:{}),hypotheses:possible.map((id,i)=>({id,label:LABELS[id]||id,score:Math.max(1,3-i)}))}};
 }
 if(notReader)reaction='Geen leesfan? Uitdaging geaccepteerd!';
 else if(!reaction&&hasNew&&next.turns%3===0&&!updated.avoid.length&&!updated.prefer.some(t=>['grief','mentalHealth','bullying','discrimination','crimeVictims','animalLoss','empathy','murder','crime','war'].includes(t)))reaction=['Ah, duidelijk!','Oké, dat helpt!','Dan weet ik al wat meer.'][Math.floor(tie(c.seed,String(next.turns))*3)];
 if(DISCOVERY_IDS.has(c.current)&&c.current!=='discover'&&delta.prefer.length){
  const focused=delta.prefer.filter(t=>!delta.prefer.some(k=>isAncestor(t,k)));
  const target=focused.length===1?BY_ID.get('specific-'+focused[0]):null;
  if(target&&!next.used.includes(target.id))return {...envelope,advice:{kind:'question',reaction,question:questionView(target),context:{...next,current:target.id}}};
 }
 const p=updated.prefer,axisCount=families(p);
 const topicDetail=p.some(t=>SUBTOPICS[t]||['puzzles','disappearance','secrets','police','criminalPerspective','manipulation','magic','competition','team','war','survival'].includes(t));
 const specific=topicDetail||p.some(t=>['manipulation','animalLoss','true','realistic','facts','slow','fast'].includes(t));
 const subjects=p.filter(t=>!p.some(k=>isAncestor(t,k))&&!['realistic','true','facts','fast','slow','calm','humor','danger','action','twist','dialogue','setting','puzzles','adventure'].includes(t));
 const hasStyle=p.some(t=>['realistic','true','facts','fast','slow','calm','humor','danger','action','twist','dialogue','setting','puzzles'].includes(t));
 if(c.discovery&&subjects.length>=3&&!hasStyle&&!next.used.includes('story-facts')){const style=BY_ID.get('story-facts');return {...envelope,advice:{kind:'question',reaction:'Ik weet nu wat je interessant vindt.',question:questionView(style),context:{...next,current:style.id}}};}
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
function privateQuestion(id){const q=BY_ID.get(id);return !!q&&[...q.when,...(q.requires||[])].some(isPrivateTopic);}
function privateReadingRequest(choices){const signals=validateSignals(choices?.openSignals);return [...signals.prefer,...signals.avoid].some(isPrivateTopic)||bounded(choices?.questionIds,40).some(privateQuestion);}
module.exports={Q,MEDIA,cleanContext,analyze,questionView,privateReadingRequest,privateQuestion};
