'use strict';
const assert=require('node:assert/strict');
const {Q,MEDIA,analyze,cleanContext}=require('../student-choice-conversation');
const {validateSignals}=require('../student-choice-open-text');
const {rankBooks}=require('../student-choice-recommendations');
const books=[
 {id:'a',title:'De verdwenen jongen',author:'A',themes:['Mysterie','Vermissing'],description:'Een jongen is spoorloos. De rechercheur zoekt aanwijzingen.',pageCount:150},
 {id:'b',title:'De bende',author:'B',themes:['Misdaad','Criminaliteit'],description:'Een jonge crimineel en een drugsbende.',pageCount:140},
 {id:'c',title:'Een moeilijk geheim',author:'C',themes:['Familie','Psychologie'],description:'Een familie verzwijgt een geheim. Manipulatie en menselijk gedrag.',pageCount:120},
 {id:'d',title:'De wedstrijd',author:'D',themes:['Sport','Voetbal'],description:'Een voetballer en zijn team. Wedstrijd en zelfvertrouwen.',pageCount:110},
 {id:'e',title:'De bijzondere kracht',author:'E',themes:['Fantasy','Magie'],description:'Een meisje ontdekt magische krachten.',pageCount:220},
 {id:'f',title:'De hond',author:'F',themes:['Dieren'],description:'Een hond en zijn baasje beleven een avontuur.',pageCount:100},
 {id:'g',title:'Het verlies',author:'G',themes:['Dieren'],description:'De hond sterft. Een verhaal over rouw.',pageCount:130},
 {id:'h',title:'De aarde',author:'H',themes:['Natuur','Wetenschap'],description:'Klimaat en milieu. Informatie en feiten.',pageCount:175},
 {id:'i',title:'Het verzet',author:'I',themes:['Geschiedenis','Oorlog'],description:'Een waargebeurd verhaal over verzet en oorlog.',pageCount:160},
 {id:'j',title:'De wijk',author:'J',themes:['Misdaad','Psychologie'],description:'Een moord leidt tot politieonderzoek en manipulatie.',pageCount:230},
 {id:'hidden',title:'Verborgen',author:'X',catalogHidden:true,themes:['Misdaad'],description:'Misdaad'}
];
const run=(text,ctx={})=>analyze(text,ctx,books);
assert.equal(new Set(Q.map(q=>q.id)).size,Q.length);
assert.ok(Q.length>=550&&Q.length<=850);
assert.ok(MEDIA.length>=200);
for(const [name,aliases,traits] of MEDIA){assert.ok(aliases.length,name);assert.deepEqual(validateSignals({prefer:traits}).prefer,traits,name);}
for(const q of Q)for(const option of q.options){
 assert.deepEqual(validateSignals({prefer:option.prefer}).prefer,option.prefer,q.id+' / '+option.label);
 const r=run(option.label,{current:q.id,optionId:option.id});
 if(['free-time','watch'].includes(q.id)&&option.prefer.length){
  assert.deepEqual(r.advice.context.signals.prefer,[],q.id+' / '+option.label);
  assert.equal(r.advice.question?.id,'hobby-focus',q.id+' / '+option.label);
 }else assert.deepEqual(r.prefer,option.prefer,q.id+' / '+option.label);
}
// Reproduce the reported specific horse conversation, including the
// actual displayed answer and option identifier.
const horseQuestion=run('paarden',{current:'opening',seed:'production-horse'});
assert.equal(horseQuestion.advice.question.id,'specific-horses');
const careOption=horseQuestion.advice.question.options.find(o=>o.label==='Paarden verzorgen');
assert.ok(careOption);
const careAnswer=run(careOption.label,{...horseQuestion.advice.context,optionId:careOption.id});
assert.ok(careAnswer.advice.context.signals.prefer.includes('horseCare'));
assert.ok(!careAnswer.advice.context.signals.prefer.includes('animalCare'));
const first=run('Mysteries',{seed:'example'});
assert.equal(first.advice.kind,'question');
assert.ok(first.advice.question.prompt);
assert.ok(!first.advice.question.prompt.includes('Bijvoorbeeld'));
const unsure=run('geen idee eigenlijk',first.advice.context);
assert.equal(unsure.advice.kind,'examples');
assert.equal(unsure.advice.question.id,first.advice.question.id);
const pick=unsure.advice.question.options[0];
const selected=run(pick.label,{...unsure.advice.context,optionId:pick.id});
assert.notEqual(selected.advice.kind,'clarify');
assert.notEqual(selected.advice.kind,'examples');
const unknown=run('xqzabcdef',first.advice.context);
assert.equal(unknown.advice.kind,'clarify');
assert.equal(run('xqzabcdef',unknown.advice.context).advice.kind,'examples');
assert.equal(run('Ik heb Het gouden kompas gelezen').advice.kind,'book-search');
assert.notEqual(run('Ik heb zelf twee honden').advice.kind,'book-search');
// Real reported conversation: drawing and sport must not be interpreted
// as interest in music. Hobbies are confirmed before recommending books.
for(let i=0;i<100;i++){
 const hobbies=run('Ik vind het leuk om te sporten en te tekenen',{current:'free-time',seed:'real-hobbies-'+i});
 assert.equal(hobbies.advice.question.id,'hobby-focus');
 assert.deepEqual(new Set(hobbies.advice.context.hobbies),new Set(['sportPlaying','drawing']));
 assert.deepEqual(hobbies.advice.context.signals.prefer,[]);
 assert.match(hobbies.advice.question.prompt,/sport.*tekenen|tekenen.*sport/i);
 assert.match(hobbies.advice.reaction,/Oh, leuk!/);
 const yes=run('Ja',hobbies.advice.context);
 assert.equal(yes.advice.kind,'examples');
 assert.deepEqual(yes.advice.context.signals.prefer,[]);
 const both=run('Allebei',hobbies.advice.context);
 assert.ok(both.advice.context.signals.prefer.includes('drawing'));
 assert.ok(both.advice.context.signals.prefer.includes('sportPlaying'));
 const art=run('tekenen en schilderen',hobbies.advice.context);
 assert.ok(!art.advice.context.signals.prefer.includes('music'));
 assert.ok(!/muzikant|muziek|liedjes/i.test(art.advice.question?.prompt||''));
 const sport=run('zelf sporten',hobbies.advice.context);
 assert.ok(!/muzikant|muziek|liedjes/i.test(sport.advice.question?.prompt||''));
 const nope=run('Niets?',hobbies.advice.context);
 assert.equal(nope.advice.kind,'question');
 assert.notEqual(nope.advice.question.id,'hobby-focus');
 assert.deepEqual(nope.advice.context.signals.prefer,[]);
 const other=run('Liever iets anders',hobbies.advice.context);
 assert.notEqual(other.advice.question?.id,'hobby-focus');
 const mixed=run('Ik vind sporten en tekenen leuk',{seed:'mixed-'+i});
 assert.ok(!/muzikant|muziek|liedjes/i.test(mixed.advice.question?.prompt||''));
 const rejected=run('Niks eigenlijk',{current:'extended-music-2',signals:{prefer:['sport','art'],avoid:[]},seed:'decline-'+i});
 assert.equal(rejected.advice.kind,'question');
 assert.notEqual(rejected.advice.question.id,'extended-music-2');
 assert.deepEqual(rejected.advice.context.signals.prefer,['sport','art']);
}
assert.ok(run('Ik doe aan fitness',{current:'free-time'}).advice.context.hobbies.includes('fitness'));
const hobby=run('Ik haat lezen',{seed:'hobby'});
assert.equal(hobby.advice.kind,'question');
assert.equal(hobby.advice.question.id,'free-time');
const media=run('GTA en FIFA',hobby.advice.context);
assert.equal(media.advice.kind,'question');
assert.equal(media.advice.question.id,'media-interest');
assert.ok(media.advice.hypotheses.some(x=>x.id==='crime'));
assert.ok(media.advice.hypotheses.some(x=>x.id==='sport'));
assert.ok(!media.advice.context.signals.prefer.includes('crime'),'Named media is not proof of interest');
const mediaUncertain=run('idk',media.advice.context);
assert.equal(mediaUncertain.advice.kind,'examples');
const crimeOption=mediaUncertain.advice.question.options.find(x=>x.label==='criminaliteit en misdaad');
assert.ok(crimeOption);
const mediaConfirmed=run(crimeOption.label,{...mediaUncertain.advice.context,optionId:crimeOption.id});
assert.equal(mediaConfirmed.advice.question?.id,'hobby-focus');
assert.deepEqual(mediaConfirmed.advice.context.signals.prefer,[]);
assert.ok(run('ja',mediaConfirmed.advice.context).advice.context.signals.prefer.includes('crime'));
const serious=run('Geen idee maar ik kijk documentaires over vermiste mensen');
assert.ok(serious.advice.context.signals.prefer.includes('disappearance'));
assert.ok(serious.advice.context.signals.prefer.includes('true'));
const animal=run('Ik wil niet dat die doodgaat',{signals:{prefer:['animals'],avoid:[]}});
assert.ok(animal.avoid.includes('animalLoss'));
const dogHobby=run('honden',{current:'free-time'});
const dogReading=run('ja',dogHobby.advice.context);
assert.ok(dogReading.advice.context.signals.prefer.includes('dogs'));
assert.ok(run('Ik wil niet dat die doodgaat',dogReading.advice.context).avoid.includes('animalLoss'));
assert.ok(run('Ik wil niet dat die doodgaat',{signals:{prefer:['cats'],avoid:[]}}).avoid.includes('animalLoss'));
assert.ok(!run('Ik wil geen boek over een moeder die doodgaat').avoid.includes('animalLoss'));
assert.ok(!run('Ik wil niet dat die doodgaat').avoid.includes('animalLoss'));
// A precise topic is independent of the surrounding family.
for(const [answer,topic] of [['fotografie','photography'],['ruimtevaart','space'],['wilde dieren','wildlife'],['sport kijken','sportWatching'],['gameontwikkeling','gameDevelopment'],['muziek luisteren','musicListening']]){
 const r=run(answer,{seed:'precise-'+topic});
 assert.ok(r.advice.context.signals.prefer.includes(topic),answer);
 assert.equal(r.advice.question?.id,'specific-'+topic,answer);
}
const typo=run('fotograffie',{current:'opening'});
assert.equal(typo.advice.kind,'examples');
assert.equal(typo.advice.question.id,'clarify-topic');
assert.deepEqual(typo.advice.context.signals.prefer,[]);
const photo=typo.advice.question.options.find(o=>o.label==='fotografie');
assert.ok(photo);
const confirmedPhoto=run(photo.label,{...typo.advice.context,optionId:photo.id});
assert.ok(confirmedPhoto.advice.context.signals.prefer.includes('photography'));
const hobbyTypo=run('fotograffie',{current:'free-time'});
const hobbyPhoto=hobbyTypo.advice.question.options.find(o=>o.label==='fotografie');
const confirmedHobby=run(hobbyPhoto.label,{...hobbyTypo.advice.context,optionId:hobbyPhoto.id});
assert.equal(confirmedHobby.advice.question.id,'hobby-focus');
assert.deepEqual(confirmedHobby.advice.context.signals.prefer,[]);
assert.ok(confirmedHobby.advice.context.hobbies.includes('photography'));
const correctedSport=run('Nee ik kijk alleen',{current:'specific-sportPlaying',signals:{prefer:['sportPlaying','sport'],avoid:[]}});
assert.ok(correctedSport.advice.context.signals.prefer.includes('sportWatching'));
assert.ok(!correctedSport.advice.context.signals.prefer.includes('sportPlaying'));
assert.match(correctedSport.advice.reaction,/verkeerd/);
const unknownTopic=run('quadrobics',{current:'free-time'});
assert.equal(unknownTopic.advice.kind,'clarify');
assert.match(unknownTopic.advice.reaction,/bedoel je/i);
const minecraft=run('Minecraft',{current:'free-time'});
assert.ok(minecraft.advice.hypotheses.some(x=>x.id==='gameBuilding'));
const build=run('vooral bouwen',minecraft.advice.context);
assert.equal(build.advice.question?.id,'hobby-focus');
assert.deepEqual(build.advice.context.signals.prefer,[]);
assert.ok(run('ja',build.advice.context).advice.context.signals.prefer.includes('gameBuilding'));
const partial=run('Ik vind sport en fotograffie leuk',{current:'free-time'});
assert.equal(partial.advice.question.id,'clarify-topic');
assert.deepEqual(partial.advice.context.signals.prefer,[]);
assert.ok(partial.advice.question.options.some(x=>x.label==='sport'));
assert.ok(partial.advice.question.options.some(x=>x.label==='fotografie'));
const partialAll=partial.advice.question.options.find(x=>x.id==='all');
assert.ok(partialAll);
const partialHobbies=run(partialAll.label,{...partial.advice.context,optionId:partialAll.id});
assert.equal(partialHobbies.advice.question.id,'hobby-focus');
assert.deepEqual(partialHobbies.advice.context.signals.prefer,[]);
const cosplay=run('cosplay',{current:'free-time'});
assert.equal(cosplay.advice.question.id,'hobby-focus');
assert.ok(cosplay.advice.context.hobbies.includes('cosplay'));
assert.ok(run('geocaching',{current:'free-time'}).advice.context.hobbies.includes('geocaching'));
const watchOnly=run('Ik kijk voetbal maar sport zelf niet',{current:'free-time'});
assert.equal(watchOnly.advice.question.id,'hobby-focus');
assert.ok(watchOnly.advice.context.hobbies.includes('sportWatching'));
assert.ok(!watchOnly.advice.context.hobbies.includes('sportPlaying'));
const noGameReading=run('Ik game wel maar wil daar niet over lezen',{current:'free-time'});
assert.deepEqual(noGameReading.advice.context.signals.prefer,[]);
assert.deepEqual(noGameReading.advice.context.signals.avoid,[]);
assert.notEqual(noGameReading.advice.question?.id,'hobby-focus');
for(const current of ['free-time','watch','media-interest']){
 for(const [answer,trait] of [['Ik wil geen boeken over horror','horror'],['Ik wil niet lezen over moord','murder'],['Ik game graag maar wil geen boeken over horror','horror']]){
  const result=run(answer,{current});
  assert.ok(result.avoid.includes(trait),current+' '+answer);
  assert.ok(result.advice.context.signals.avoid.includes(trait));
  assert.ok(!result.advice.context.signals.prefer.includes('gaming'));
 }
}
// Sentence boundaries and media follow-ups must preserve explicit exclusions.
for(const current of ['free-time','watch','media-interest']){
 for(const answer of ['Ik wil geen boeken over horror. Ik lees graag over sport','Ik wil geen boeken over horror! Ik lees graag over sport','Ik wil geen boeken over horror; ik lees graag over sport','Ik wil geen boeken over horror\nIk lees graag over sport','Ik wil geen boeken over horror maar ik lees graag over sport']){
  const result=run(answer,{current});
  assert.ok(result.advice.context.signals.prefer.includes('sport'),answer);
  assert.ok(result.advice.context.signals.avoid.includes('horror'),answer);
  assert.ok(!result.advice.context.signals.avoid.includes('sport'),answer);
 }
 const mixedMedia=run('Ik kijk Stranger Things maar wil geen boek met moord',{current});
 assert.ok(mixedMedia.avoid.includes('murder'));
 assert.ok(mixedMedia.advice.context.signals.avoid.includes('murder'));
 assert.ok(!mixedMedia.advice.context.signals.prefer.includes('horror'));
}
// A reading exclusion may be abbreviated before the explicit reading clause.
// Other people's statements must never erase a pupil's subsequent answer.
for(const current of ['opening','discover','free-time','watch','media-interest']){
 for(const answer of ['Ik wil geen moord maar wel lezen over voetbal','Ik wil liever geen moord maar ik lees graag over voetbal','Geen moord maar liever boeken over voetbal']){
  const result=run(answer,{current});
  assert.ok(result.advice.context.signals.prefer.includes('football'),current+' '+answer);
  assert.ok(result.advice.context.signals.avoid.includes('murder'),current+' '+answer);
 }
 const other=run('Mijn moeder leest graag over paarden, ik lees graag over voetbal',{current});
 assert.ok(other.advice.context.signals.prefer.includes('football'),current);
 assert.ok(!other.advice.context.signals.prefer.includes('horses'),current);
 assert.ok(!other.advice.context.clarifyAmbiguity,current);
 const notHobby=run('Ik hou niet van katten maar ik lees graag over honden',{current});
 assert.ok(notHobby.advice.context.signals.prefer.includes('dogs'),current);
 assert.ok(!notHobby.advice.context.signals.avoid.includes('cats'),current);
}
const activityAndReading=run('Ik game graag. Ik lees graag over sport',{current:'free-time'});
assert.ok(activityAndReading.advice.context.signals.prefer.includes('sport'));
assert.ok(!activityAndReading.advice.context.signals.prefer.includes('gaming'));
let repeatedUnknown=run('qzxqzxqz',{current:'opening'});
for(let i=0;i<2;i++)repeatedUnknown=run('qzxqzxqz',repeatedUnknown.advice.context);
assert.equal(repeatedUnknown.advice.kind,'offer');
const subjects=require('../student-choice-topic-details');
const {SUBTOPICS}=require('../student-choice-themes');
assert.ok(Object.keys(SUBTOPICS).length>=250);
assert.equal(new Set(Q.filter(q=>q.id.startsWith('extended-')).map(q=>q.group)).size,30);
assert.equal(Q.filter(q=>q.id.startsWith('extended-')).length,270);
for(const [id,parent,label,aliases,evidence] of subjects){
 assert.equal(SUBTOPICS[id],parent);
 assert.ok(Q.some(q=>q.id==='specific-'+id&&q.when.includes(id)));
 assert.ok(aliases.length&&evidence.length,label);
 assert.ok(require('../student-choice-open-text').interpret(aliases[0]).prefer.includes(id),label);
}
const preciseCatalogue=[
 {id:'general',title:'Kunst in beeld',author:'A',themes:['Kunst','Geschiedenis','Informatief'],description:'Over kunstgeschiedenis.'},
 {id:'photo',title:'Foto maken',author:'B',themes:['Fotografie'],description:'Leer fotograferen.'},
 {id:'music',title:'Muzikanten',author:'C',themes:['Muziek'],description:'Het leven van een zanger.'}
];
const exactRank=rankBooks({books:preciseCatalogue},{route:'new',openSignals:{prefer:['art','history','facts','photography'],avoid:[]},seed:'precise-rank'});
assert.equal(exactRank.suggestions[0]?.bookId,'photo');
const ranked=rankBooks({books},{route:'new',openSignals:{prefer:['animals'],avoid:['animalLoss']},seed:'animal'});
assert.ok(ranked.suggestions.some(b=>b.bookId==='f'));
assert.ok(!ranked.suggestions.some(b=>b.bookId==='g'));
const safeSurprise=rankBooks({books:[books[6],books[5],books[9]]},{route:'surprise',openSignals:{prefer:['crime'],avoid:['animalLoss','murder']},seed:'safe-surprise'});
assert.deepEqual(safeSurprise.suggestions.map(x=>x.bookId),['f']);
const feedback=run('Gaat allemaal over politie. Ik wil juist lezen over criminelen zelf',{current:'feedback',signals:{prefer:['crime','police'],avoid:[]}});
assert.ok(feedback.advice.context.signals.prefer.includes('criminalPerspective'));
assert.ok(!feedback.advice.context.signals.prefer.includes('police'));
for(const complaint of ['Deze boeken gaan te veel over politie','Ik wil minder politie']){
 const r=run(complaint,{current:'feedback',signals:{prefer:['crime','police'],avoid:[]}});
 assert.equal(r.advice.kind,'question');assert.equal(r.advice.clearReference,true);
 assert.ok(!r.prefer.includes('police'));assert.ok(!r.advice.context.signals.prefer.includes('police'));
}
const typedBook=run('De bijzondere kracht');
assert.equal(typedBook.advice.reference.bookId,'e');
assert.equal(run('geen dikke boeken',{signals:{prefer:['crime','psychology'],avoid:[]}}).advice.context.length,'short');
assert.deepEqual(cleanContext({signals:{prefer:['madeup']},used:['fake'],turns:999}).signals,{prefer:[],avoid:[]});
assert.equal(cleanContext({turns:999}).turns,7);
// Reproducible synthetic conversations, using the real planner, exact option
// mapping, uncertainty fallback, and varied topic/seed combinations. This
// measures logic and repetition, not real pupils' language comprehension.
// Verify subject boundaries over many seeded first questions.
const topicChecks=[['tekenen',/muziek|muzikant|liedjes/i],['muziek',/tekenen|fotografie|schilderen/i],['techniek',/welke games speel|gamepersonages|online spelen/i],['geschiedenis',/oorlog.*meegemaakt|oorlogsgeschiedenis/i],['vriendschap',/liefdesverhaal|verliefd|romantiek/i],['natuur',/klimaatverandering|veranderend klimaat/i],['spanning',/griezel|enge verhalen|geesten/i],['sport',/nieuwe klas|schoolproject|muzikant/i]];
for(const [topic,forbidden] of topicChecks)for(let i=0;i<100;i++){
 const result=run(topic,{seed:'subject-'+topic+'-'+i});
 assert.ok(!forbidden.test(result.advice.question?.prompt||''),topic+': '+result.advice.question?.prompt);
}
for(const question of Q.filter(x=>x.group)){
 assert.ok(question.when.every(t=>validateSignals({prefer:[t]}).prefer.includes(t)),question.id);
 assert.ok((question.requires||[]).every(t=>validateSignals({prefer:[t]}).prefer.includes(t)),question.id);
}
// Ambiguous Dutch interests must never be silently assigned to one meaning.
const {RULES}=require('../student-choice-ambiguity');
for(const [id,word,prompt,meanings,visibleCount] of RULES){
 const phrase=word.split('|')[0];
 for(const current of ['opening','free-time']){
  const ambiguous=run('Ik hou van '+phrase,{current,seed:id});
  assert.equal(ambiguous.advice.kind,'examples',id);
  assert.equal(ambiguous.advice.question.prompt,prompt);
  assert.deepEqual(ambiguous.advice.context.signals.prefer,[],id);
  for(const [trait,label] of meanings){
   const option=ambiguous.advice.question.options.find(o=>o.label===label);
   if(meanings.findIndex(m=>m[0]===trait)<(visibleCount||meanings.length))assert.ok(option,id+' '+label);
   const resolved=run(option?label:meanings.find(m=>m[0]===trait)[2][0],{...ambiguous.advice.context,...(option?{optionId:option.id}:{})});
   assert.equal(resolved.advice.question?.id,'hobby-focus',id+' '+label);
   assert.ok(resolved.advice.context.hobbies.includes(trait),id+' '+label);
   assert.deepEqual(resolved.advice.context.signals.prefer,[]);
   const confirmed=run('ja',resolved.advice.context);
   assert.ok(confirmed.advice.context.signals.prefer.includes(trait),id+' '+label);
  }
 }
}
const fish=run('Ik hou van vissen',{current:'free-time'});
const fishResolved=run('vissen vangen',fish.advice.context);
assert.deepEqual(fishResolved.advice.context.hobbies,['fishing']);
const bothFish=run('Allebei',fish.advice.context);
assert.deepEqual(new Set(bothFish.advice.context.hobbies),new Set(['fishing','fishAnimals']));
assert.ok(!run('niet vissen vangen',fish.advice.context).advice.context.signals.prefer.includes('fishing'));
assert.equal(run('vissen als dieren',fish.advice.context).advice.context.hobbies[0],'fishAnimals');
assert.equal(run('Ik doe aan hengelsport',{current:'free-time'}).advice.question.id,'hobby-focus');
const fishReading=run('Ik lees graag over vissen',{current:'free-time'});
const animalChoice=fishReading.advice.question.options.find(o=>o.label==='Vissen als dieren');
const animalReading=run(animalChoice.label,{...fishReading.advice.context,optionId:animalChoice.id});
assert.ok(animalReading.advice.context.signals.prefer.includes('fishAnimals'));
assert.notEqual(animalReading.advice.question?.id,'hobby-focus');
const fishNegative=run('Ik wil geen boeken over vissen',{current:'free-time'});
const negativeChoice=fishNegative.advice.question.options[0];
const negativeResolved=run(negativeChoice.label,{...fishNegative.advice.context,optionId:negativeChoice.id});
assert.ok(negativeResolved.advice.context.signals.avoid.includes('fishing'));
assert.ok(!negativeResolved.advice.context.signals.prefer.includes('fishing'));
const fishAndDrawing=run('Ik hou van vissen en tekenen',{current:'free-time'});
const fishAndDrawingResolved=run('vissen vangen',fishAndDrawing.advice.context);
assert.deepEqual(new Set(fishAndDrawingResolved.advice.context.hobbies),new Set(['drawing','fishing']));
const fishUnknown=run('geen idee',fish.advice.context);
assert.equal(fishUnknown.advice.question.id,'clarify-topic');
assert.equal(fishUnknown.advice.context.clarifyAmbiguity,'fishing');
assert.deepEqual(fishUnknown.advice.context.signals.prefer,[]);
for(const [id,parent,label,aliases,evidence] of require('../student-choice-extra-topics')){
 assert.ok(Q.some(q=>q.id==='specific-'+id),label);
 assert.ok(validateSignals({prefer:[id]}).prefer.includes(id),label);
 assert.ok(require('../student-choice-open-text').interpret(aliases[0]).prefer.includes(id),label);
}
for(const [answer,trait] of [['ik wil iets lezen over cavia’s','guineaPigs'],['ik lees graag over parkieten','parakeets'],['ik wil een boek over hockey','hockey'],['ik wil lezen over boulderen','climbing'],['ik lees graag over patisserie','pastry'],['ik wil lezen over Japanse cultuur','japan'],['ik wil lezen over LGBTQ+','queerStories'],['ik wil een boek over transgender personages','genderIdentity'],['ik wil boeken over liefde tussen twee meisjes','queerRomance']]){
 const r=run(answer,{seed:'expanded-'+trait});
 assert.ok(r.advice.context.signals.prefer.includes(trait),answer);
}
for(const answer of ['ik ben homo','ik ben transgender','ik heb ADHD','ik ben autistisch']){
 const r=run(answer,{current:'free-time'});
 assert.deepEqual(r.advice.context.signals.prefer,[],answer);
 assert.deepEqual(r.advice.context.hobbies,[],answer);
}
const disclosureWithRequest=run('Ik ben homo en ik wil een boek over sport',{current:'opening'});
assert.ok(disclosureWithRequest.advice.context.signals.prefer.includes('sport'));
assert.ok(!disclosureWithRequest.advice.context.signals.prefer.includes('sexualOrientation'));
const privateReadingRequest=require('../student-choice-conversation').privateReadingRequest;
assert.equal(privateReadingRequest({openSignals:{prefer:['genderIdentity']}}),true);
assert.equal(privateReadingRequest({questionIds:['specific-autism']}),true);
assert.equal(privateReadingRequest({openSignals:{prefer:['football']},questionIds:['specific-football']}),false);
const coverageBooks=[
 {id:'pet',title:'Alles over cavia’s',author:'A',description:'Verzorging van cavia’s.'},
 {id:'sport',title:'Padel voor beginners',author:'B',description:'Meer leren over padel.'},
 {id:'bread',title:'Brood bakken',author:'C',description:'Recepten met zuurdesem.'},
 {id:'culture',title:'Japan ontdekken',author:'D',description:'Japanse cultuur en tradities.'},
 {id:'inclusive',title:'Liefde tussen twee meisjes',author:'E',description:'Een lesbisch liefdesverhaal.'},
 {id:'gender',title:'Een eigen verhaal',author:'F',description:'Een transgender hoofdpersoon.'}
];
for(const [topic,id] of [['guineaPigs','pet'],['padel','sport'],['breadMaking','bread'],['japan','culture'],['queerRomance','inclusive'],['genderIdentity','gender']]){
 const result=rankBooks({books:coverageBooks},{route:'new',openSignals:{prefer:[topic],avoid:[]},seed:'coverage-'+topic});
 assert.equal(result.suggestions[0]?.bookId,id,topic);
}
const inclusive=run('LHBTQIA+',{current:'opening'});
assert.equal(inclusive.advice.question?.id,'specific-queerStories');
assert.equal(run('Ik wil geen dikke boeken',{current:'free-time'}).advice.context.length,'short');
const changedSport=run('Gaat allemaal over sport. Ik wil juist lezen over dieren',{current:'feedback',signals:{prefer:['sport','football','sportTraining'],avoid:[]}});
assert.ok(!changedSport.advice.context.signals.prefer.includes('football'));
assert.ok(!changedSport.advice.context.signals.prefer.includes('sportTraining'));
assert.ok(changedSport.advice.context.signals.prefer.includes('animals'));
const rejectedMotor=run('Ik wil geen boeken over motoren',{current:'free-time'});
const resolvedMotor=run('Motortechniek',rejectedMotor.advice.context);
assert.deepEqual(resolvedMotor.advice.context.signals.avoid,['engines']);
// A blank pupil can discover identity and culture through navigation without
// supplying any topic, and navigation never overwrites prior signals.
const blank=run('Weet ik niet',{current:'discover',discovery:true});
assert.equal(blank.advice.question.id,'discover-menu');
const menu=blank.advice.question.options.find(o=>o.label.includes('jezelf herkent'));
const identityRoute=run(menu.label,{...blank.advice.context,optionId:menu.id});
assert.equal(identityRoute.advice.question.id,'discover-identity');
const queerChoice=identityRoute.advice.question.options.find(o=>o.label.includes('LHBTQIA'));
const queerRoute=run(queerChoice.label,{...identityRoute.advice.context,optionId:queerChoice.id});
assert.equal(queerRoute.advice.question.id,'specific-queerStories');
const different=run('Kies een andere vraag',{...queerRoute.advice.context,navigation:'menu'});
assert.deepEqual(different.advice.context.signals,queerRoute.advice.context.signals);
const topicPage=run('Weet ik niet',blank.advice.context);
assert.equal(topicPage.advice.question.id,'discover-topics');
const nextPage=run('Weet ik niet',topicPage.advice.context);
assert.equal(nextPage.advice.question.id,'discover-topics-more');
assert.equal(run('Weet ik niet',nextPage.advice.context).advice.kind,'offer');
const many=run('Gamen, voetbal, koken, honden, geschiedenis, Japan, tekenen, zwemmen, piano en padel',{current:'discover',discovery:true});
assert.equal(many.advice.question.id,'hobby-focus');
assert.ok(many.advice.context.hobbies.length>=8);
const picked=many.advice.question.options.filter(o=>['Japan','padel'].includes(o.label));
assert.equal(picked.length,2);
const multi=run(picked.map(o=>o.label).join(', '),{...many.advice.context,optionIds:picked.map(o=>o.id)});
assert.deepEqual(new Set(multi.advice.context.signals.prefer),new Set(['japan','padel']));
assert.deepEqual(new Set(multi.advice.context.separateTopics),new Set(['japan','padel']));
assert.deepEqual(multi.advice.context.required,[]);
// Book feedback remains provisional, preserves existing preferences, and does not
// translate a rejection into a reading exclusion or accept a hidden book.
const bookCtx={current:'specific-football',signals:{prefer:['football'],avoid:['murder']},used:['opening','sport-interest']};
const rated=run('Verder met deze boeken',{...bookCtx,navigation:'book-feedback',bookVotes:[{bookId:'f',vote:'like'},{bookId:'b',vote:'dislike'},{bookId:'hidden',vote:'like'}]});
assert.equal(rated.advice.question.id,'discovery-feedback');
assert.deepEqual(rated.advice.context.signals,bookCtx.signals);
assert.deepEqual(rated.advice.context.used,bookCtx.used);
assert.ok(rated.advice.context.discoveryTraits.includes('dogs'));
assert.ok(!rated.advice.context.discoveryTraits.includes('crime'));
const dogVote=rated.advice.question.options.find(o=>o.label==='honden');
const likedDogs=run(dogVote.label,{...rated.advice.context,optionId:dogVote.id});
assert.ok(likedDogs.advice.context.signals.prefer.includes('dogs'));
assert.ok(likedDogs.advice.context.signals.prefer.includes('football'));
assert.deepEqual(likedDogs.advice.context.signals.avoid,['murder']);
const resumeVote=run('Weet ik niet',rated.advice.context);
assert.equal(resumeVote.advice.context.current,'specific-football');
const sample=rankBooks({books},{route:'surprise',discoverySample:true,openSignals:{prefer:['football'],avoid:['murder','animalLoss']},seed:'diverse'});
assert.equal(sample.suggestions[0]?.bookId,'d');
assert.equal(new Set(sample.suggestions.map(x=>x.key)).size,sample.suggestions.length);
assert.ok(!sample.suggestions.some(x=>['g','j','hidden'].includes(x.bookId)));
// Every detailed subject has a finite selectable route through the subject index.
const reached=new Set(),visited=new Set();
function visitIndex(ctx){
 const page=run('Geef voorbeelden',{...ctx,navigation:'examples'}).advice;
 const key=page.context.indexParent+'|'+page.context.indexPage;if(visited.has(key))return;visited.add(key);
 for(const opt of page.question.options.filter(o=>o.id.startsWith('topic:')||o.id==='next')){
  const next=run(opt.label,{...page.context,optionId:opt.id});
  if(opt.id.startsWith('topic:'))reached.add(opt.id.slice(6));
  if(next.advice.context.current==='discover-index')visitIndex(next.advice.context);
 }
}
visitIndex(run('Alle onderwerpen bekijken',{navigation:'index'}).advice.context);
for(const id of Object.keys(SUBTOPICS))assert.ok(reached.has(id),'No navigable subject path for '+id);
for(const text of ['Ik ben autistisch. Ik wil iets leuks lezen','Hallo, ik heb ADHD. Ik wil een boek','Ik ben homo en ik wil graag een boek lezen','Ik ben autistisch en wil een boek lezen']){
 const r=run(text,{current:'discover',discovery:true});
 assert.deepEqual(r.advice.context.signals.prefer,[],text);
}
const thirdParty=run('Mijn moeder houdt van paarden',{current:'discover',discovery:true});
assert.deepEqual(thirdParty.advice.context.signals.prefer,[]);
assert.ok(!thirdParty.advice.context.hobbies.includes('horses'));
const thirdMixed=run('Ik hou van sport en mn moeder van paarden',{current:'discover',discovery:true});
assert.ok(!thirdMixed.advice.context.hobbies.includes('horses'));
assert.notEqual(thirdMixed.advice.question?.id,'clarify-topic');
const weighted=run('Ik hou van voetbal, maar meer van gamen',{current:'discover',discovery:true});
assert.ok(weighted.advice.context.priority.includes('gaming'));
assert.ok(weighted.advice.context.hobbies.includes('football'));
// Compound answers: exclusions stay specific, independent ambiguities are
// resolved in order, and confirmed topics survive a partially unknown answer.
const lastRound={current:'discover',discovery:true};
const narrowAvoid=run('Ik wil geen boeken over voetbal',lastRound);
assert.deepEqual(narrowAvoid.advice.context.signals.avoid,['football']);
const catsAvoid=run('Ik wil lezen over honden maar niet over katten',lastRound);
assert.deepEqual(catsAvoid.advice.context.signals.avoid,['cats']);
assert.ok(catsAvoid.advice.context.signals.prefer.includes('dogs'));
assert.ok(run('Ik vind lezen niet leuk behalve strips',lastRound).advice.context.signals.prefer.includes('comics'));
const queueFish=run('Ik hou van vissen en bakken',lastRound);
const queueBaking=run('Vissen vangen',queueFish.advice.context);
assert.equal(queueBaking.advice.context.clarifyAmbiguity,'baking');
const retryFish=run('Met mijn opa',queueFish.advice.context);
assert.equal(retryFish.advice.context.clarifyAmbiguity,'fishing');
assert.deepEqual(retryFish.advice.context.clarifyQueue,[{id:'baking',negative:false}]);
const retryBaking=run('Vissen vangen',retryFish.advice.context);
assert.equal(retryBaking.advice.context.clarifyAmbiguity,'baking');
const bothThenBaking=run('Ik vind het allebei leuk',queueFish.advice.context);
assert.equal(bothThenBaking.advice.context.clarifyAmbiguity,'baking');
assert.ok(bothThenBaking.advice.context.clarifyKnown.includes('fishing'));
assert.ok(bothThenBaking.advice.context.clarifyKnown.includes('fishAnimals'));
const skipFish=run('Laat maar',queueFish.advice.context);
assert.equal(skipFish.advice.context.clarifyAmbiguity,'baking');
const queueDone=run('Taarten, brood of koekjes bakken',queueBaking.advice.context);
assert.equal(queueDone.advice.question.id,'hobby-focus');
assert.deepEqual(new Set(queueDone.advice.context.hobbies),new Set(['fishing','baking']));
const partlyKnown=run('Ik hou van voetbal, geocaching en speedcubing',lastRound);
assert.equal(partlyKnown.advice.question.id,'clarify-remainder');
const knownOnly=run('Ga verder met wat je al weet',partlyKnown.advice.context);
assert.ok(knownOnly.advice.context.hobbies.includes('football'));
assert.ok(knownOnly.advice.context.hobbies.includes('geocaching'));
const tentative=run('Ik hou van voetbal en misschien ook koken',lastRound);
assert.equal(tentative.advice.question.id,'clarify-remainder');
const tentativeNo=run('Ga verder met wat je al weet',tentative.advice.context);
assert.ok(tentativeNo.advice.context.hobbies.includes('football'));
assert.ok(!tentativeNo.advice.context.hobbies.includes('cooking'));
const onlyDogs=run('Ik wil alleen over honden lezen',{current:'feedback',signals:{prefer:['sport','football'],avoid:['murder']}});
assert.ok(onlyDogs.advice.context.signals.prefer.includes('dogs'));
assert.ok(!onlyDogs.advice.context.signals.prefer.includes('football'));
assert.deepEqual(onlyDogs.advice.context.signals.avoid,['murder']);
const othersDisclosure=run('Mijn broer is homo en ik wil een spannend boek',lastRound);
assert.ok(othersDisclosure.advice.context.signals.prefer.includes('danger'));
assert.ok(!othersDisclosure.advice.context.signals.prefer.includes('sexualOrientation'));
assert.ok(!othersDisclosure.advice.context.signals.prefer.includes('family'));
const combined=run('Ik lees graag een spannend verhaal met LHBTQIA+ personages',lastRound);
assert.ok(combined.advice.context.required.includes('danger'));
assert.ok(combined.advice.context.required.includes('queerRepresentation'));
for(const current of ['free-time','watch','media-interest']){
 const result=run('Ik wil geen dikke boeken maar ik lees graag over sport',{current});
 assert.equal(result.advice.context.length,'short');
 assert.ok(result.advice.context.signals.prefer.includes('sport'));
}
const simpleVote=analyze('Verder met deze boeken',{current:'discover',navigation:'book-feedback',bookVotes:[{bookId:'realistic',vote:'like'}]},[{id:'realistic',title:'Een avontuur',description:'Een realistisch avontuur over vriendschap.'}]);
assert.deepEqual(validateSignals({prefer:simpleVote.advice.context.discoveryTraits}).prefer,simpleVote.advice.context.discoveryTraits);
assert.ok(!simpleVote.advice.context.discoveryTraits.includes('balanced'));
assert.ok(run('Ik wil een spannend verhaal met LHBTQIA+ personages',lastRound).advice.context.required.includes('queerRepresentation'));
const skippedQueue=run('Laat maar',queueBaking.advice.context);
assert.ok(skippedQueue.advice.context.hobbies.includes('fishing'));
// Production feedback: a polite refusal of a hobby as reading material is
// neither an unknown answer nor an exclusion of its entire subject.
const horseStart=run('Paarden!',{current:'discover',discovery:true});
const horseHobby=run('Paardrijden',horseStart.advice.context);
assert.equal(horseHobby.advice.question.id,'hobby-focus');
for(const answer of ['Nee liever niet','Nee, liever niet!','Liever niet','Nee hoor','Nee bedankt','Nee, dank je','Niet echt','Nee, toch niet','Hoeft niet','Nee, dat hoeft niet','Ik wil daar liever niet over lezen','Nee ik wil daar niet over lezen','Nope']){
 const result=run(answer,{...horseHobby.advice.context,signals:{prefer:['mystery'],avoid:['horror']}});
 assert.ok(['question','offer'].includes(result.advice.kind),answer+' '+result.advice.kind);
 assert.notEqual(result.advice.question?.id,'hobby-focus',answer);
 assert.deepEqual(result.advice.context.signals,{prefer:['mystery'],avoid:['horror']},answer);
 assert.deepEqual(result.advice.context.hobbies,[],answer);
}
const contrastingRefusal=run('Nee, liever voetbal',horseHobby.advice.context);
assert.ok(contrastingRefusal.advice.context.signals.prefer.includes('football'));
const focusedChecks=[['zelf sporten',/topsport|leven van (?:een )?sporter|sport kijken|supporters|blessure/i],['fitness',/topsport|voetbal|sport kijken|supporters|blessure/i],['honden',/katten|wilde dieren|roofdieren/i],['manga tekenen',/muziek|fotografie/i],['programmeren',/ruimtevaart|astronaut|robots/i],['muziek luisteren',/muziek maken|bekend wordt|optreden/i],['planeten',/menselijk lichaam|robots|computers/i]];
for(const [topic,forbidden] of focusedChecks)for(let i=0;i<100;i++){
 const r=run(topic,{seed:'focus-'+topic+'-'+i});
 assert.ok(!forbidden.test(r.advice.question?.prompt||''),topic+': '+r.advice.question?.prompt);
}
for(const current of ['free-time','watch','media-interest']){
 const r=run('Ik lees graag over sport maar niet over moord',{current});
 assert.ok(r.advice.context.signals.avoid.includes('murder'));
 assert.ok(r.advice.context.signals.prefer.includes('sport'));
}
const topics=['mysteries','criminaliteit','sport','fantasy','dieren','geschiedenis','wetenschap','vriendschap','humor','muziek','psychologie','techniek','oorlog','reizen','natuur','gamen','kunst','maatschappij','overleven','GTA en FIFA'];
const sequences=new Map();let completed=0,turns=0,exampleCount=0;
for(let i=0;i<10000;i++){
 const topic=topics[i%topics.length];
 let r=run(topic,{seed:'simulation-'+i});
 const sequence=[],seen=new Set();
 for(let n=0;n<8;n++){
  const plan=r.advice;
  assert.ok(plan);
  if(plan.kind==='recommend'||plan.kind==='offer'){completed++;break;}
  assert.equal(plan.kind,'question');
  const q=plan.question;
  assert.ok(!seen.has(q.id),'Repeated question '+q.id+' in '+topic);
  seen.add(q.id);sequence.push(q.id);turns++;
  let context=plan.context;
  if((i+n)%4===0){
   const fallback=run('weet ik niet',context).advice;
   assert.equal(fallback.kind,'examples');
   assert.equal(fallback.question.id,q.id);
   context=fallback.context;exampleCount++;
  }
  const options=q.options;
  if(!options.length){r=run('sport',context);continue;}
  const o=options[(i*7+n*3)%options.length];
  r=run(o.label,{...context,optionId:o.id});
 }
 if(!sequences.has(topic))sequences.set(topic,new Set());
 sequences.get(topic).add(sequence.join('|'));
}
assert.equal(completed,10000,'Bounded conversations must end in recommendations or a conscious offer');
assert.ok(sequences.get('mysteries').size>1,'Different seeds must allow different dialogue paths');
console.log(JSON.stringify({simulations:10000,completed,turns,exampleCount,questionNodes:Q.length,uniqueSequences:[...sequences.values()].reduce((sum,s)=>sum+s.size,0)}));
