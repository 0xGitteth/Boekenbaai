'use strict';
const assert=require('node:assert/strict');
const {QUESTIONS,selection,validatedAnswers,traitsForBook,preferenceWeights,
  scoreTraits}=require('../student-choice-dialogue');
const {rankBooks}=require('../student-choice-recommendations');
assert.ok(QUESTIONS.length>=45,'A broad set of distinct situation questions is needed');
assert.ok(new Set(QUESTIONS.map(q=>q.id)).size===QUESTIONS.length,
  'Every question must have a stable unique ID');
for(const q of QUESTIONS){
  assert.ok(q.options.length>=3&&q.options.length<=5);
  assert.ok(q.options.every(x=>x.traits.length>0));
  assert.ok(q.prompt.length>20);
  assert.ok(!/^(welk genre|hou je van boeken|leesniveau|makkelijk lezen)/i.test(q.prompt),
    'Never ask children to choose a genre or reading difficulty');
}
const example={
  books:Array.from({length:48},(_,i)=>({
    id:'book-'+i,title:'Boek '+i,author:'Auteur '+i,
    status:'available',pageCount:120+i,
    themes:[
      ['Mysterie','Detective','Geheimen'],['Vriendschap','School'],
      ['Fantasy','Avontuur'],['Geschiedenis','Waargebeurd'],
      ['Humor'],['Natuur','Dieren'],['Spanning','Actie'],
      ['Techniek','Wetenschap'],['Relaties','Familie'],
    ][i%9],
    tags:i%2?['Raadsels','Avontuur']:['Onderzoek','Vriendschap'],
    description:i%3?'Een groep vrienden beleeft een avontuur.':
      'Iemand ontdekt een geheim en probeert samen met anderen de waarheid te achterhalen.',
  })),
};
const routes=new Set();
for(let i=0;i<192;i++){
  const seed='learner-session-'+i;
  const answers=[];
  const seen=new Set();
  for(let step=0;step<9;step++){
    const next=selection(example,{seed,answers});
    if(next.done)break;
    assert.ok(next.question,'There must be another question before the stop');
    assert.ok(!seen.has(next.question.id),'Never ask the same question twice');
    seen.add(next.question.id);
    const option=step===2&&i%7===0?'skip':
      next.question.options[(i+step)%next.question.options.length].id;
    answers.push({questionId:next.question.id,optionId:option});
  }
  assert.ok(answers.length>=4&&answers.length<=7,
    'Adaptive conversations should ask 4–7 meaningful questions');
  assert.equal(selection(example,{seed,answers}).done,true);
  routes.add([...seen].join('>'));
}
assert.ok(routes.size>45,
  'Different sessions should not use one fixed questionnaire');
const q=QUESTIONS[0];
assert.deepEqual(validatedAnswers([
  {questionId:q.id,optionId:q.options[0].id},
  {questionId:q.id,optionId:q.options[1].id},
  {questionId:'unknown',optionId:'fake'},
]),[{questionId:q.id,optionId:q.options[0].id}],
'Invalid, duplicate and invented answers must be ignored');
assert.ok(preferenceWeights([{questionId:'curiosity-1',optionId:'secret'}])
  .get('mystery')>0);
assert.equal(traitsForBook({title:'Zomaar',tags:[],description:''}).size,0,
  'Missing metadata must never be fabricated');
assert.ok(traitsForBook({title:'X',themes:['Spanning']}).has('danger'),
  'Canonical Spanning theme should remain relevant to tense situations');
assert.equal(traitsForBook({title:'X',tags:['Transport']}).has('sport'),false,
  'Sport may not match inside an unrelated word');
assert.equal(traitsForBook({title:'X',themes:['Overleven']}).has('calm'),false,
  'Overleven must never create a calm or everyday-life preference');
assert.ok(traitsForBook({title:'X',tags:['Sporten']}).has('sport'),
  'Real inflected words should still be recognized');
assert.ok(scoreTraits(traitsForBook({title:'Het geheim',themes:['Mysterie']}),
  preferenceWeights([{questionId:'curiosity-1',optionId:'secret'}])).value>0);
const books=rankBooks(example,{
  route:'new',seed:'mysteries',
  answers:[{questionId:'curiosity-1',optionId:'secret'},
    {questionId:'curiosity-3',optionId:'clue'},
    {questionId:'tension-2',optionId:'clues'},
    {questionId:'conflict-3',optionId:'missing'}],
});
assert.equal(books.suggestions.length,3);
assert.ok(books.suggestions.some(b=>/geheimen|raadsel|onderzoek|mysterie/i.test(b.reason)),
  'Recommendations should explain verified conversational matches');
console.log('Adaptive questions: broad question bank, 192 conversation paths, skip, privacy-safe signals and ranking: OK');
