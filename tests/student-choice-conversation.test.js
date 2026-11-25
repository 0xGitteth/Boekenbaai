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
assert.ok(Q.length>=300&&Q.length<=400);
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
 assert.deepEqual(new Set(hobbies.advice.context.hobbies),new Set(['sport','drawing']));
 assert.deepEqual(hobbies.advice.context.signals.prefer,[]);
 assert.match(hobbies.advice.question.prompt,/sport.*tekenen|tekenen.*sport/i);
 assert.match(hobbies.advice.reaction,/Oh, leuk!/);
 const yes=run('Ja',hobbies.advice.context);
 assert.equal(yes.advice.kind,'examples');
 assert.deepEqual(yes.advice.context.signals.prefer,[]);
 const both=run('Allebei',hobbies.advice.context);
 assert.ok(both.advice.context.signals.prefer.includes('drawing'));
 assert.ok(both.advice.context.signals.prefer.includes('sport'));
 const art=run('tekenen en schilderen',hobbies.advice.context);
 assert.ok(!art.advice.context.signals.prefer.includes('music'));
 assert.ok(!/muzikant|muziek|liedjes/i.test(art.advice.question?.prompt||''));
 const sport=run('Sport',hobbies.advice.context);
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
assert.ok(run('Ik doe aan fitness',{current:'free-time'}).advice.context.hobbies.includes('sportPlaying'));
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
assert.ok(dogReading.advice.context.signals.prefer.includes('pets'));
assert.ok(run('Ik wil niet dat die doodgaat',dogReading.advice.context).avoid.includes('animalLoss'));
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
assert.equal(cosplay.advice.question.id,'clarify-topic');
assert.ok(cosplay.advice.question.options.length>=2);
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
let repeatedUnknown=run('qzxqzxqz',{current:'opening'});
for(let i=0;i<2;i++)repeatedUnknown=run('qzxqzxqz',repeatedUnknown.advice.context);
assert.equal(repeatedUnknown.advice.kind,'offer');
const subjects=require('../student-choice-topic-details');
const {SUBTOPICS}=require('../student-choice-themes');
assert.ok(Object.keys(SUBTOPICS).length>=66);
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
